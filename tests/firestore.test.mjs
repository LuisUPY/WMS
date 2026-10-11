import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import * as sdk from "firebase/firestore";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { createInventoryStore } from "../public/inventory-store.js";
import { importOpening, readInventoryWorkbook } from "../scripts/inventory-import.mjs";

const projectId = "demo-wms-inventory";
const itemId = "A101__12345678";
const claims = { admin: true, email_verified: true, firebase: { sign_in_provider: "google.com" } };
let env;
let adminApp;
let db;
let uid = 0;
const subscriptions = [];
const sample = { sku: "12345678", description: "Material de prueba", warehouse: "A101", unit: "PAC", stock: 10,
  openingStock: 10, openingPackages: { cs: 0, car: 1, cxt: 0 }, alternateCode: "", revision: 0,
  lastMovementId: null, sourceSha256: "test-source", sourceRow: 3, updatedAt: new Date() };

before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("These tests require the local Firestore emulator.");
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(":");
  env = await initializeTestEnvironment({ projectId, firestore: { host, port: Number(port), rules: await readFile("firestore.rules", "utf8") } });
  adminApp = initializeApp({ projectId }, "wms-inventory-tests");
  db = getFirestore(adminApp);
});
beforeEach(async () => {
  subscriptions.splice(0).forEach(stop => stop());
  await env.clearFirestore();
  await db.doc("settings/inventory").set({ status: "active", sourceAsOf: "2026-01-01", approvedBy: "Test", sourceSha256: "test-source" });
  await db.doc(`inventory/${itemId}`).set(sample);
});
after(async () => { subscriptions.splice(0).forEach(stop => stop()); await env?.cleanup(); if (adminApp) await deleteApp(adminApp); });

async function client(customClaims = claims) {
  const identity = { uid: `test-${++uid}` };
  const firestore = env.authenticatedContext(identity.uid, customClaims).firestore();
  const store = createInventoryStore(firestore, sdk, () => true);
  let current;
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const stop = store.subscribe(state => { current = state; if (state.online) resolveReady(); }, rejectReady);
  subscriptions.push(stop);
  await ready;
  return { firestore, store, identity, current: () => current, stop };
}
function input(type = "exit", quantity = 3) { return { itemId, type, quantity, reference: "TEST-DOC" }; }
function operation() { return crypto.randomUUID(); }

test("transaction confirms stock and immutable movement; retry is idempotent", async () => {
  const c = await client();
  const id = operation();
  assert.deepEqual(await c.store.record(input(), id, c.identity), { id, duplicate: false });
  assert.deepEqual(await c.store.record(input(), id, c.identity), { id, duplicate: true });
  assert.equal((await db.doc(`inventory/${itemId}`).get()).data().stock, 7);
  assert.equal((await db.collection("movements").get()).size, 1);
  await assert.rejects(() => c.store.record(input("entry", 3), id, c.identity), { code: "inventory/id-conflict" });
});

test("two concurrent exits cannot overdraw the same opening stock", async () => {
  const a = await client(), b = await client();
  const results = await Promise.allSettled([a.store.record(input("exit", 7), operation(), a.identity), b.store.record(input("exit", 7), operation(), b.identity)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.find(r => r.status === "rejected").reason.code, "inventory/insufficient-stock");
  assert.equal((await db.doc(`inventory/${itemId}`).get()).data().stock, 3);
  assert.equal((await db.collection("movements").get()).size, 1);
});

test("entries accumulate; separate clients receive confirmed changes", async () => {
  const a = await client(), b = await client();
  await a.store.record(input("entry", 5), operation(), a.identity);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { stop(); reject(new Error("Realtime listener timed out")); }, 10000);
    const stop = sdk.onSnapshot(sdk.doc(b.firestore, "inventory", itemId), { includeMetadataChanges: true }, snapshot => {
      if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites && snapshot.data().stock === 15) { clearTimeout(timer); stop(); resolve(); }
    }, reject);
  });
  assert.equal((await db.collection("movements").get()).size, 1);
});

test("concurrent entries preserve both changes", async () => {
  const a = await client(), b = await client();
  await Promise.all([a.store.record(input("entry", 5), operation(), a.identity), b.store.record(input("entry", 8), operation(), b.identity)]);
  assert.equal((await db.doc(`inventory/${itemId}`).get()).data().stock, 23);
  assert.equal((await db.collection("movements").get()).size, 2);
});

test("draft balance rejects movements in client and rules", async () => {
  await db.doc("settings/inventory").update({ status: "draft" });
  const c = await client();
  await assert.rejects(() => c.store.record(input(), operation(), c.identity), { code: "inventory/not-approved" });
  await assertFails(sdk.updateDoc(sdk.doc(c.firestore, "inventory", itemId), { stock: 8 }));
});

test("anonymous, non-admin, unverified and non-Google identities cannot read", async () => {
  const guests = [env.unauthenticatedContext(), env.authenticatedContext("nonadmin", { ...claims, admin: false }),
    env.authenticatedContext("unverified", { ...claims, email_verified: false }),
    env.authenticatedContext("password", { ...claims, firebase: { sign_in_provider: "password" } })];
  for (const c of guests) await assertFails(sdk.getDoc(sdk.doc(c.firestore(), "inventory", itemId)));
  const c = env.authenticatedContext("valid", claims).firestore();
  await assertSucceeds(sdk.getDoc(sdk.doc(c, "inventory", itemId)));
});

function forgedBatch(c, changes = {}, stockChanges = {}, includeStock = true) {
  const id = operation();
  const movement = { ...input(), sku: sample.sku, warehouse: "A101", unit: "PAC", stockBefore: 10,
    stockAfter: 7, actorUid: c.identity.uid, createdAt: sdk.serverTimestamp(), ...changes };
  const batch = sdk.writeBatch(c.firestore);
  batch.set(sdk.doc(c.firestore, "movements", id), movement);
  if (includeStock) batch.update(sdk.doc(c.firestore, "inventory", itemId), {
    stock: 7, revision: 1, lastMovementId: id, updatedAt: sdk.serverTimestamp(), ...stockChanges
  });
  return batch.commit();
}

test("rules reject unpaired writes, forged quantity, identity, unit, negatives and metadata changes", async () => {
  const c = await client();
  await assertFails(sdk.updateDoc(sdk.doc(c.firestore, "inventory", itemId), { stock: 100 }));
  await assertFails(forgedBatch(c, {}, {}, false));
  for (const changes of [{ quantity: 100 }, { quantity: 1.5 }, { quantity: 0 }, { actorUid: "another-user" },
    { unit: "CAR" }, { sku: "99999999" }, { stockAfter: -1 }, { reference: " " }, { extra: "field" }]) {
    await assertFails(forgedBatch(c, changes));
  }
  await assertFails(forgedBatch(c, {}, { description: "Changed" }));
  await assertFails(forgedBatch(c, {}, { stock: -1 }));
  await assertFails(sdk.setDoc(sdk.doc(c.firestore, "settings", "inventory"), { status: "active" }));
  await assertFails(sdk.setDoc(sdk.doc(c.firestore, "inventory", "A101__99999999"), sample));
});

test("confirmed history cannot be edited, deleted or reused to change stock", async () => {
  const c = await client(), id = operation();
  await c.store.record(input(), id, c.identity);
  const movement = sdk.doc(c.firestore, "movements", id);
  await assertFails(sdk.updateDoc(movement, { reference: "rewritten" }));
  await assertFails(sdk.deleteDoc(movement));
  await assertFails(sdk.updateDoc(sdk.doc(c.firestore, "inventory", itemId), {
    stock: 4, revision: 2, lastMovementId: id, updatedAt: sdk.serverTimestamp()
  }));
  c.stop();
  await assert.rejects(() => c.store.record(input(), operation(), c.identity), { code: "inventory/offline" });
});

test("initial import is atomic, stays draft and cannot reset later balances", async () => {
  await env.clearFirestore();
  const data = { sourceFile: "test.xlsx", sourceSheet: "FISICO - A101", sourceSha256: "fixture", sourceAsOf: null,
    approvalStatus: "pending", recordCount: 1, records: [{ id: itemId, sku: sample.sku, warehouse: "A101", unit: "PAC", openingStock: 10 }] };
  assert.deepEqual(await importOpening(db, data, FieldValue.serverTimestamp()), { imported: true, count: 1 });
  assert.equal((await db.doc("settings/inventory").get()).data().status, "draft");
  await db.doc(`inventory/${itemId}`).update({ stock: 4 });
  assert.equal((await importOpening(db, data, FieldValue.serverTimestamp())).imported, false);
  assert.equal((await db.doc(`inventory/${itemId}`).get()).data().stock, 4);
  await assert.rejects(() => importOpening(db, { ...data, sourceSha256: "new" }, FieldValue.serverTimestamp()), /no puede sustituir/);
});

test("private workbook imports every material with saved stock and provenance", async t => {
  let data;
  try { await readFile("DB/DataBase.xlsx"); } catch { t.skip("Private source absent"); return; }
  data = await readInventoryWorkbook();
  await env.clearFirestore();
  const result = await importOpening(db, data, FieldValue.serverTimestamp());
  assert.equal(result.count, 84);
  const rows = await db.collection("inventory").get();
  assert.equal(rows.size, data.recordCount);
  for (const record of data.records) {
    const stored = rows.docs.find(d => d.id === record.id).data();
    assert.equal(stored.stock, record.openingStock);
    assert.equal(stored.unit, record.unit);
    assert.equal(stored.sourceRow, record.sourceRow);
    assert.equal(stored.sourceSha256, data.sourceSha256);
  }
  const c = await client();
  assert.equal(c.current().source.status, "draft");
  assert.equal(c.current().items.length, 84);
  assert.equal(c.current().movements.length, 0);
});
