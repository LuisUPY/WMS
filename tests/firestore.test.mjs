import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import * as sdk from "firebase/firestore";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { createInventoryStore } from "../public/inventory-store.js";
import { importOpening, readInventoryWorkbook } from "../scripts/inventory-import.mjs";
import { inspectOpening, approveOpening } from "../scripts/opening-approval.mjs";
import { isOpeningApproved } from "../public/opening-approval.js";
import { approvedSource, workbookFixture, review, sourceHash } from "./opening-fixtures.mjs";

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
  lastMovementId: null, sourceSha256: sourceHash, sourceRow: 3, updatedAt: new Date() };

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
  const source = approvedSource();
  await db.doc("settings/inventory").set(source);
  await db.doc(`inventoryApprovals/${source.approvalId}`).set({ approval: source.approval });
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
  await assertFails(sdk.setDoc(sdk.doc(c.firestore, "inventoryApprovals", "e".repeat(64)), { approval: { approvedBy: "forged" } }));
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
  c.stop();
  const snapshot = await inspectOpening(db, data);
  const approvedResult = await approveOpening(db, data, review, "test-approver", snapshot.inventorySha256,
    { fromDate: date => Timestamp.fromDate(date), serverTimestamp: () => FieldValue.serverTimestamp() });
  const audit = (await db.doc(`inventoryApprovals/${approvedResult.approvalId}`).get()).data();
  assert.equal(audit.items.length, 84);
  assert.equal(isOpeningApproved((await db.doc("settings/inventory").get()).data()), true);
  assert.equal((await db.collection("movements").get()).size, 0);
  const approved = await client();
  assert.equal(approved.current().items.length, 84);
  assert.equal(approved.current().source.stockScope, "all-usable");
});

test("incomplete approvals and missing audit cannot authorize a direct client batch", async () => {
  const c = await client();
  const good = approvedSource();
  const invalid = [{ status: "active" }, { ...good, approvalStatus: "pending" },
    { ...good, stockScope: "total-unclassified" }, { ...good, recordCount: 2 },
    { ...good, approvalId: "d".repeat(64) }];
  for (const key of Object.keys(good.approval)) {
    const approval = { ...good.approval }; delete approval[key];
    invalid.push({ ...good, approval });
  }
  for (const source of invalid) {
    await db.doc("settings/inventory").set(source);
    await assertFails(forgedBatch(c));
  }
  await db.doc("settings/inventory").set({ status: "active" });
  const incomplete = await client();
  await assert.rejects(() => incomplete.store.record(input(), operation(), incomplete.identity), { code: "inventory/not-approved" });
  assert.equal((await db.collection("movements").get()).size, 0);
});

test("approval is atomic, auditable, preserves quantities and enables tested movements", async () => {
  await env.clearFirestore();
  const workbook = workbookFixture();
  await importOpening(db, workbook, FieldValue.serverTimestamp());
  const snapshot = await inspectOpening(db, workbook);
  const timestamps = { fromDate: date => Timestamp.fromDate(date), serverTimestamp: () => FieldValue.serverTimestamp() };
  await assert.rejects(() => approveOpening(db, workbook, { ...review, evidence: "" }, "approver", snapshot.inventorySha256, timestamps));
  await assert.rejects(() => approveOpening(db, workbook, review, "approver", "0".repeat(64), timestamps), /cambió/);
  assert.equal((await db.doc("settings/inventory").get()).data().status, "draft");
  assert.equal((await db.collection("inventoryApprovals").get()).size, 0);
  const declaration = { ...review, evidence: `${review.evidence}\nRevisión técnica de prueba` };
  const result = await approveOpening(db, workbook, declaration, "approver", snapshot.inventorySha256, timestamps);
  const source = (await db.doc("settings/inventory").get()).data();
  assert.equal(isOpeningApproved(source), true);
  assert.equal(source.approval.approvedBy, review.approvedBy);
  const audit = (await db.doc(`inventoryApprovals/${result.approvalId}`).get()).data();
  assert.deepEqual(audit.approval, source.approval);
  assert.equal(audit.sourceBefore.status, "draft");
  assert.equal(audit.items[0].stock, 10);
  assert.equal((await db.doc(`inventory/${itemId}`).get()).data().revision, 0);
  assert.equal((await db.collection("movements").get()).size, 0);
  await assert.rejects(() => approveOpening(db, workbook, review, "approver", snapshot.inventorySha256, timestamps), /pendiente/);
  const c = await client();
  await assertFails(sdk.updateDoc(sdk.doc(c.firestore, "inventoryApprovals", result.approvalId), { approval: {} }));
  await assertFails(sdk.deleteDoc(sdk.doc(c.firestore, "inventoryApprovals", result.approvalId)));
  await c.store.record(input(), operation(), c.identity);
  assert.equal((await db.doc(`inventory/${itemId}`).get()).data().stock, 7);
});

test("a draft changed after preview cannot be approved and is never overwritten", async () => {
  await env.clearFirestore();
  const workbook = workbookFixture();
  await importOpening(db, workbook, FieldValue.serverTimestamp());
  const snapshot = await inspectOpening(db, workbook);
  await db.doc(`inventory/${itemId}`).update({ stock: 9 });
  await assert.rejects(() => approveOpening(db, workbook, review, "approver", snapshot.inventorySha256,
    { fromDate: date => Timestamp.fromDate(date), serverTimestamp: () => FieldValue.serverTimestamp() }), /cambió/);
  assert.equal((await db.doc(`inventory/${itemId}`).get()).data().stock, 9);
  assert.equal((await db.doc("settings/inventory").get()).data().status, "draft");
  assert.equal((await db.collection("inventoryApprovals").get()).size, 0);
});

test("editable references synchronize, retry once and preserve stock, unit and warehouse", async () => {
  const a = await client(), b = await client();
  const changeId = operation();
  const data = { itemId, field: "location", value: "A102" };
  assert.equal((await a.store.editDetail(data, changeId, a.identity)).duplicate, false);
  assert.equal((await a.store.editDetail(data, changeId, a.identity)).duplicate, true);
  await assert.rejects(() => a.store.editDetail({ ...data, value: "A103" }, changeId, a.identity), { code: "inventory/id-conflict" });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { stop(); reject(new Error("Detail listener timed out")); }, 10000);
    const stop = sdk.onSnapshot(sdk.doc(b.firestore, "inventoryDetails", itemId), { includeMetadataChanges: true }, snapshot => {
      if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites && snapshot.data()?.location === "A102") { clearTimeout(timer); stop(); resolve(); }
    }, reject);
  });
  await b.store.editDetail({ itemId, field: "umr", value: "PAQUETE" }, operation(), b.identity);
  const details = (await db.doc(`inventoryDetails/${itemId}`).get()).data();
  assert.equal(details.umr, "PAQUETE"); assert.equal(details.location, "A102"); assert.equal(details.revision, 2);
  assert.equal((await db.collection("inventoryDetailChanges").get()).size, 2);
  const change = (await db.doc(`inventoryDetailChanges/${changeId}`).get()).data();
  assert.equal(change.valueBefore, "A101"); assert.equal(change.valueAfter, "A102"); assert.equal(change.actorUid, a.identity.uid);
  const item = (await db.doc(`inventory/${itemId}`).get()).data();
  assert.equal(item.stock, 10); assert.equal(item.unit, "PAC"); assert.equal(item.warehouse, "A101"); assert.equal(item.revision, 0);
  await assertFails(sdk.updateDoc(sdk.doc(a.firestore, "inventoryDetails", itemId), { location: "A103" }));
  await assertFails(sdk.deleteDoc(sdk.doc(a.firestore, "inventoryDetails", itemId)));
  await assertFails(sdk.updateDoc(sdk.doc(a.firestore, "inventoryDetailChanges", changeId), { valueAfter: "A103" }));
  await assertFails(sdk.deleteDoc(sdk.doc(a.firestore, "inventoryDetailChanges", changeId)));
  await a.store.record(input(), operation(), a.identity);
  const movement = (await db.collection("movements").get()).docs[0].data();
  assert.equal(movement.unit, "PAC"); assert.equal(movement.warehouse, "A101"); assert.equal(movement.stockAfter, 7);
});

test("reference rules reject unpaired changes, extra fields and forged authors", async () => {
  const c = await client();
  for (const overrides of [{ actorUid: "another" }, { valueAfter: " " }, { field: "unit" }, { extra: true }]) {
    const id = operation(), batch = sdk.writeBatch(c.firestore);
    batch.set(sdk.doc(c.firestore, "inventoryDetailChanges", id), { itemId, field: "umr", valueBefore: "PAC", valueAfter: "PAQUETE",
      revisionBefore: 0, revisionAfter: 1, actorUid: c.identity.uid, createdAt: sdk.serverTimestamp(), ...overrides });
    batch.set(sdk.doc(c.firestore, "inventoryDetails", itemId), { itemId, umr: "PAQUETE", location: "A101", cs: 0, car: 1, cxt: 0,
      revision: 1, lastChangeId: id, updatedAt: sdk.serverTimestamp() });
    await assertFails(batch.commit());
  }
  await db.doc("settings/inventory").update({ status: "draft" });
  await assertFails(sdk.setDoc(sdk.doc(c.firestore, "inventoryDetails", itemId), { itemId, umr: "PAC" }));
});

test("package corrections preserve legacy references and opening stock, with idempotence and shared updates", async () => {
  await db.doc(`inventoryDetails/${itemId}`).set({ itemId, umr: "PAQUETE", location: "A102", revision: 2,
    lastChangeId: "legacy-reference-change", updatedAt: new Date() });
  const a = await client(), b = await client();
  const id = operation(), data = { itemId, field: "cs", value: "3" };
  assert.equal((await a.store.editDetail(data, id, a.identity)).duplicate, false);
  assert.equal((await a.store.editDetail(data, id, a.identity)).duplicate, true);
  const change = (await db.doc(`inventoryDetailChanges/${id}`).get()).data();
  assert.equal(change.valueBefore, 0); assert.equal(change.valueAfter, 3); assert.equal(change.actorUid, a.identity.uid);
  await b.store.editDetail({ itemId, field: "car", value: 0 }, operation(), b.identity);
  await a.store.editDetail({ itemId, field: "cxt", value: 7 }, operation(), a.identity);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { stop(); reject(new Error("Package listener timed out")); }, 10000);
    const stop = sdk.onSnapshot(sdk.doc(b.firestore, "inventoryDetails", itemId), { includeMetadataChanges: true }, snapshot => {
      if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites && snapshot.data()?.cxt === 7) { clearTimeout(timer); stop(); resolve(); }
    }, reject);
  });
  await b.store.editDetail({ itemId, field: "umr", value: "PAC" }, operation(), b.identity);
  const details = (await db.doc(`inventoryDetails/${itemId}`).get()).data();
  assert.deepEqual([details.cs, details.car, details.cxt, details.umr, details.location, details.revision], [3, 0, 7, "PAC", "A102", 6]);
  const item = (await db.doc(`inventory/${itemId}`).get()).data();
  assert.deepEqual(item.openingPackages, sample.openingPackages);
  assert.equal(item.stock, 10); assert.equal(item.revision, 0); assert.equal(item.unit, "PAC"); assert.equal(item.warehouse, "A101");
  assert.equal((await db.collection("movements").get()).size, 0);
  assert.equal((await db.collection("inventoryDetailChanges").get()).size, 4);
});

test("package rules reject invalid numbers and changes to other columns or the original balance", async () => {
  const c = await client();
  function batchFor(value, extra = {}) {
    const id = operation(), batch = sdk.writeBatch(c.firestore);
    batch.set(sdk.doc(c.firestore, "inventoryDetailChanges", id), { itemId, field: "cs", valueBefore: 0, valueAfter: value,
      revisionBefore: 0, revisionAfter: 1, actorUid: c.identity.uid, createdAt: sdk.serverTimestamp() });
    batch.set(sdk.doc(c.firestore, "inventoryDetails", itemId), { itemId, umr: "PAC", location: "A101", cs: value, car: 1, cxt: 0,
      revision: 1, lastChangeId: id, updatedAt: sdk.serverTimestamp(), ...extra });
    return batch;
  }
  for (const value of [-1, 1.5, "0", "", null, 1000000001]) await assertFails(batchFor(value).commit());
  await assertFails(batchFor(2, { car: 8 }).commit());
  await assertFails(batchFor(2, { umr: "OTRA" }).commit());
  const batch = batchFor(2);
  batch.update(sdk.doc(c.firestore, "inventory", itemId), { openingPackages: { cs: 2, car: 1, cxt: 0 }, stock: 20 });
  await assertFails(batch.commit());
  await assertSucceeds(batchFor(0).commit());
});
