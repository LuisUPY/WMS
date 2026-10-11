import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { filterInventory, movementInput, nextStock, detailInput, operationInput } from "../public/inventory.js";
import { readInventoryWorkbook, importOpening } from "../scripts/inventory-import.mjs";

const item = { id: "A101__12345678", sku: "12345678", description: "Material de prueba", stock: 10 };
const input = { itemId: item.id, type: "exit", quantity: "4", reference: " Documento 1 " };

test("movements validate units, integer quantity and document reference", () => {
  assert.deepEqual(movementInput(input), { ...input, quantity: 4, reference: "Documento 1" });
  for (const bad of [{ quantity: "" }, { quantity: 0 }, { quantity: -1 }, { quantity: 1.5 }, { quantity: Infinity },
    { quantity: "1,000" }, { quantity: 1000000001 }, { reference: " " }, { reference: "x".repeat(161) },
    { itemId: "../../settings" }, { type: "adjustment" }]) {
    assert.throws(() => movementInput({ ...input, ...bad }), { code: "inventory/invalid-movement" });
  }
});

test("stock cannot be negative or exceed integer precision", () => {
  assert.equal(nextStock(item, movementInput(input)), 6);
  assert.equal(nextStock(item, { type: "exit", quantity: 10 }), 0);
  assert.throws(() => nextStock(item, { type: "exit", quantity: 11 }), { code: "inventory/insufficient-stock" });
  assert.throws(() => nextStock({ stock: Number.MAX_SAFE_INTEGER }, { type: "entry", quantity: 1 }), { code: "inventory/invalid-stock" });
  assert.throws(() => nextStock({ stock: null }, { type: "entry", quantity: 1 }), { code: "inventory/invalid-stock" });
});

test("package corrections accept zero and integers, rejecting empty, fractional and invalid values", () => {
  for (const field of ["cs", "car", "cxt"]) {
    for (const value of [0, "0", " 12 ", 1000000000]) {
      assert.deepEqual(detailInput({ itemId: item.id, field, value }), { itemId: item.id, field, value: Number(value) });
    }
    for (const value of ["", " ", null, undefined, false, -1, 1.5, "1e3", "1,000", 1000000001, Infinity]) {
      assert.throws(() => detailInput({ itemId: item.id, field, value }), { code: "inventory/invalid-detail" });
    }
  }
  assert.equal(detailInput({ itemId: item.id, field: "umr", value: " PAC " }).value, "PAC");
});

test("one operation validates a shared reference, distinct products and complete package values", () => {
  const lines = [{ itemId: item.id, type: "entry", quantity: "4" }, { itemId: "A101__87654321", type: "packages", cs: "0", car: "2", cxt: "1" }];
  const data = operationInput({ reference: " TEST ", lines });
  assert.equal(data.reference, "TEST"); assert.equal(data.lines[0].quantity, 4); assert.equal(data.lines[1].cs, 0);
  assert.throws(() => operationInput({ reference: "TEST", lines: [lines[0], lines[0]] }), { code: "inventory/duplicate-product" });
  for (const bad of [{ reference: " " }, { lines: [] }, { lines: Array(6).fill(lines[0]) }, { lines: [{ ...lines[1], cs: "" }] }]) {
    assert.throws(() => operationInput({ reference: "TEST", lines, ...bad }));
  }
});

test("search matches SKU, description and alternate code", () => {
  const items = [item, { ...item, id: "A101__87654321", sku: "87654321", description: "Otro", alternateCode: "70.10.10" }];
  assert.deepEqual(filterInventory(items, "PRUEBA"), [item]);
  assert.equal(filterInventory(items, "70.10")[0].sku, "87654321");
  assert.equal(filterInventory(items, "no existe").length, 0);
  const alphabetic = [{ ...item, sku: "1", description: "Zorro" }, { ...item, sku: "9", description: "Álamo" }];
  assert.deepEqual(filterInventory(alphabetic).map(row => row.sku), ["9", "1"]);
});

test("opening import is idempotent and refuses replacement of an existing source", async () => {
  const db = { doc: path => path, runTransaction: task => task({ get: async () => ({ exists: true, data: () => ({ sourceSha256: "original", recordCount: 1 }) }) }) };
  assert.deepEqual(await importOpening(db, { sourceSha256: "original" }), { imported: false, count: 1 });
  await assert.rejects(() => importOpening(db, { sourceSha256: "changed" }), /no puede sustituir/);
});

test("real workbook is readable, remains pending and preserves source provenance", async t => {
  try { await access("DB/DataBase.xlsx"); } catch { t.skip("Private operational workbook is absent in this checkout"); return; }
  const data = await readInventoryWorkbook();
  assert.equal(data.recordCount, 84);
  assert.equal(data.approvalStatus, "pending");
  assert.equal(data.sourceAsOf, null);
  assert.equal(data.dateCellIsTodayFormula, true);
  assert.equal(new Set(data.records.map(r => r.id)).size, data.records.length);
  assert.equal(data.sourceSha256.length, 64);
  assert.ok(data.records.every(r => Number.isSafeInteger(r.openingStock) && r.openingStock >= 0));
  assert.equal(data.numericNormalizations.length, 2);
});

test("workbook reader handles zero, cache failures, duplicate keys and floating-point residue", async () => {
  await promisify(execFile)(process.env.WMS_PYTHON || "python3", ["-m", "unittest", "discover", "-s", "tests", "-p", "workbook_reader_test.py"]);
});
