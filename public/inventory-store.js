import { InventoryError, movementInput, nextStock, detailInput, detailValues, operationInput, operationMatches } from "./inventory.js?v=0.7";
import { isOpeningApproved } from "./opening-approval.js?v=0.7";

// The same implementation runs in browsers and in the Firestore emulator tests.
export function createInventoryStore(db, sdk, isOnline = () => navigator.onLine) {
  let confirmed = false;
  let source;
  let active = false;
  const unsubscribers = [];

  return {
    subscribe(onChange, onError) {
      active = true;
      const state = { items: [], movements: [], operations: [], details: [], source: null, online: false };
      const fresh = { items: false, movements: false, operations: false, details: false, source: false };
      const emit = () => {
        confirmed = Object.values(fresh).every(Boolean) && isOnline();
        if (active) onChange({ ...state, online: confirmed });
      };
      const listen = (ref, key, map) => {
        unsubscribers.push(sdk.onSnapshot(ref, { includeMetadataChanges: true }, snapshot => {
          if (!active) return;
          fresh[key] = !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites;
          // Never present a local, optimistic write as a confirmed balance.
          if (fresh[key]) state[key] = map(snapshot);
          if (key === "source" && fresh[key]) source = state.source;
          emit();
        }, error => { confirmed = false; fresh[key] = false; if (active) { emit(); onError(error); } }));
      };
      listen(sdk.doc(db, "settings", "inventory"), "source", s => s.exists() ? s.data() : null);
      listen(sdk.collection(db, "inventory"), "items", s => s.docs.map(d => ({ ...d.data(), id: d.id })));
      listen(sdk.collection(db, "inventoryDetails"), "details", s => s.docs.map(d => ({ ...d.data(), id: d.id })));
      listen(sdk.query(sdk.collection(db, "movements"), sdk.orderBy("createdAt", "desc"), sdk.limit(30)), "movements",
        s => s.docs.map(d => ({ ...d.data(), id: d.id })));
      listen(sdk.query(sdk.collection(db, "operations"), sdk.orderBy("createdAt", "desc"), sdk.limit(30)), "operations",
        s => s.docs.map(d => ({ ...d.data(), id: d.id })));
      return () => { active = false; confirmed = false; source = undefined; unsubscribers.splice(0).forEach(stop => stop()); };
    },
    connectionChanged() { if (!isOnline()) confirmed = false; },
    async recordOperation(input, operationId, identity) {
      if (!active || !confirmed || !isOnline()) throw new InventoryError("inventory/offline");
      if (!isOpeningApproved(source)) throw new InventoryError("inventory/not-approved");
      const data = operationInput(input);
      if (!/^[a-zA-Z0-9-]{20,80}$/.test(operationId || "")) throw new InventoryError("inventory/invalid-operation");
      const operationRef = sdk.doc(db, "operations", operationId);
      const commit = () => sdk.runTransaction(db, async transaction => {
        const previous = await transaction.get(operationRef);
        if (previous.exists()) {
          if (!operationMatches(previous.data(), data, identity.uid)) throw new InventoryError("inventory/id-conflict");
          return { id: operationId, duplicate: true };
        }
        const settings = await transaction.get(sdk.doc(db, "settings", "inventory"));
        if (!settings.exists() || !isOpeningApproved(settings.data())) throw new InventoryError("inventory/not-approved");
        const writes = [], lines = {}, createdAt = sdk.serverTimestamp();
        for (const line of data.lines) {
          const itemRef = sdk.doc(db, "inventory", line.itemId);
          const snapshot = await transaction.get(itemRef);
          if (!snapshot.exists()) throw new InventoryError("inventory/not-found");
          const item = snapshot.data();
          if (line.type === "packages") {
            const ref = sdk.doc(db, "inventoryDetails", line.itemId);
            const details = await transaction.get(ref);
            const before = details.exists() ? details.data() : null;
            const values = detailValues(item, before);
            const packagesBefore = Object.fromEntries(["cs", "car", "cxt"].map(key => [key, values[key]]));
            const packagesAfter = { cs: line.cs, car: line.car, cxt: line.cxt };
            const revisionBefore = before?.revision ?? 0;
            lines[line.itemId] = { type: line.type, packagesBefore, packagesAfter, revisionBefore, revisionAfter: revisionBefore + 1 };
            writes.push(() => transaction.set(ref, { itemId: line.itemId, ...values, ...packagesAfter,
              revision: revisionBefore + 1, lastChangeId: operationId, operationId, updatedAt: createdAt }));
          } else {
            let stockAfter;
            try { stockAfter = nextStock(item, line); }
            catch (error) { error.material = `${item.sku} · ${item.description}`; throw error; }
            lines[line.itemId] = { type: line.type, quantity: line.quantity, sku: item.sku, unit: item.unit, warehouse: item.warehouse,
              stockBefore: item.stock, stockAfter, revisionBefore: item.revision, revisionAfter: item.revision + 1 };
            writes.push(() => transaction.update(itemRef, { stock: stockAfter, revision: item.revision + 1,
              lastMovementId: operationId, lastOperationId: operationId, updatedAt: createdAt }));
          }
        }
        // Read every product first; one commit confirms all lines and their audit.
        writes.forEach(write => write());
        transaction.set(operationRef, { reference: data.reference, lines, actorUid: identity.uid, createdAt });
        return { id: operationId, duplicate: false };
      });
      try { return await commit(); }
      catch (error) { if (error.code !== "permission-denied") throw error; return commit(); }
    },
    async editDetail(input, operationId, identity) {
      if (!active || !confirmed || !isOnline()) throw new InventoryError("inventory/offline");
      if (!isOpeningApproved(source)) throw new InventoryError("inventory/not-approved");
      const data = detailInput(input);
      if (!/^[a-zA-Z0-9-]{20,80}$/.test(operationId || "")) throw new InventoryError("inventory/invalid-detail");
      const changeRef = sdk.doc(db, "inventoryDetailChanges", operationId);
      const detailRef = sdk.doc(db, "inventoryDetails", data.itemId);
      return sdk.runTransaction(db, async transaction => {
        const previous = await transaction.get(changeRef);
        if (previous.exists()) {
          const saved = previous.data();
          if (saved.actorUid !== identity.uid || saved.itemId !== data.itemId || saved.field !== data.field || saved.valueAfter !== data.value) {
            throw new InventoryError("inventory/id-conflict");
          }
          return { id: operationId, duplicate: true };
        }
        const settings = await transaction.get(sdk.doc(db, "settings", "inventory"));
        const itemSnapshot = await transaction.get(sdk.doc(db, "inventory", data.itemId));
        const detailSnapshot = await transaction.get(detailRef);
        if (!settings.exists() || !isOpeningApproved(settings.data())) throw new InventoryError("inventory/not-approved");
        if (!itemSnapshot.exists()) throw new InventoryError("inventory/not-found");
        const item = itemSnapshot.data();
        const savedDetails = detailSnapshot.exists() ? detailSnapshot.data() : null;
        const before = { ...detailValues(item, savedDetails), revision: savedDetails?.revision ?? 0 };
        const createdAt = sdk.serverTimestamp();
        transaction.set(changeRef, { itemId: data.itemId, field: data.field, valueBefore: before[data.field], valueAfter: data.value,
          revisionBefore: before.revision, revisionAfter: before.revision + 1, actorUid: identity.uid, createdAt });
        transaction.set(detailRef, { itemId: data.itemId, ...detailValues(item, before),
          [data.field]: data.value, revision: before.revision + 1, lastChangeId: operationId, updatedAt: createdAt });
        return { id: operationId, duplicate: false };
      });
    },
    async record(input, operationId, identity) {
      if (!active || !confirmed || !isOnline()) throw new InventoryError("inventory/offline");
      if (!isOpeningApproved(source)) throw new InventoryError("inventory/not-approved");
      const data = movementInput(input);
      if (!/^[a-zA-Z0-9-]{20,80}$/.test(operationId || "")) throw new InventoryError("inventory/invalid-movement");
      const movementRef = sdk.doc(db, "movements", operationId);
      const itemRef = sdk.doc(db, "inventory", data.itemId);
      const settingsRef = sdk.doc(db, "settings", "inventory");
      const commit = () => sdk.runTransaction(db, async transaction => {
        const previous = await transaction.get(movementRef);
        if (previous.exists()) {
          const saved = previous.data();
          if (saved.actorUid !== identity.uid || ["itemId", "type", "quantity", "reference"].some(k => saved[k] !== data[k])) {
            throw new InventoryError("inventory/id-conflict");
          }
          return { id: operationId, duplicate: true };
        }
        const settings = await transaction.get(settingsRef);
        const itemSnapshot = await transaction.get(itemRef);
        if (!settings.exists() || !isOpeningApproved(settings.data())) throw new InventoryError("inventory/not-approved");
        if (!itemSnapshot.exists()) throw new InventoryError("inventory/not-found");
        const item = itemSnapshot.data();
        const stockAfter = nextStock(item, data);
        const createdAt = sdk.serverTimestamp();
        transaction.set(movementRef, { ...data, unit: item.unit, sku: item.sku, warehouse: item.warehouse,
          stockBefore: item.stock, stockAfter, actorUid: identity.uid, createdAt });
        transaction.update(itemRef, { stock: stockAfter, revision: item.revision + 1, lastMovementId: operationId, updatedAt: createdAt });
        return { id: operationId, duplicate: false };
      });
      try { return await commit(); }
      catch (error) {
        if (error.code !== "permission-denied") throw error;
        // Cross-document rules may reject a stale concurrent attempt before the
        // SDK sees its write precondition. Re-read with server authorization and
        // retry once against the latest stock; never weaken the security rules.
        const settings = await sdk.getDocFromServer(settingsRef);
        const current = await sdk.getDocFromServer(itemRef);
        if (!settings.exists() || !isOpeningApproved(settings.data())) throw new InventoryError("inventory/not-approved");
        if (!current.exists()) throw new InventoryError("inventory/not-found");
        nextStock(current.data(), data);
        return commit();
      }
    }
  };
}
