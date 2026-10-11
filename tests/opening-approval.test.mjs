import test from "node:test";
import assert from "node:assert/strict";
import { isOpeningApproved } from "../public/opening-approval.js";
import { validateReview, validateOpening } from "../scripts/opening-approval.mjs";
import { approvedSource, workbookFixture, review } from "./opening-fixtures.mjs";

test("active alone or missing approval metadata never enables movements", () => {
  const good = approvedSource();
  assert.equal(isOpeningApproved(good), true);
  assert.equal(isOpeningApproved({ status: "active" }), false);
  for (const key of Object.keys(good.approval)) {
    const approval = { ...good.approval };
    delete approval[key];
    assert.equal(isOpeningApproved({ ...good, approval }), false, key);
  }
  for (const change of [{ status: "draft" }, { approvalStatus: "pending" }, { stockScope: "total-unclassified" },
    { sourceSha256: "d".repeat(64) }, { recordCount: 2 }, { sourceAsOf: null }, { approvalId: "bad" }]) {
    assert.equal(isOpeningApproved({ ...good, ...change }), false);
  }
  assert.equal(isOpeningApproved(good, good.approval.sourceAsOf.toMillis() - 1), false);
});

test("review requires a real cut with explicit timezone and operational confirmations", () => {
  assert.equal(validateReview(review).sourceAsOf.toISOString(), "2026-01-01T21:00:00.000Z");
  for (const change of [{ sourceAsOf: "2026-02-30T15:00:00-06:00" }, { sourceAsOf: "2026-01-01T15:00:00" },
    { sourceAsOf: "2026-01-01T15:00:00+14:01" }, { approvedBy: " " }, { evidence: "" },
    { quantitiesAndUnitsConfirmed: false }, { numericNormalizationsReviewed: false },
    { noUnrecordedMovementsConfirmed: false }, { stockScope: "total-unclassified" }]) {
    assert.throws(() => validateReview({ ...review, ...change }));
  }
  assert.throws(() => validateReview(review, new Date("2025-12-31T00:00:00Z")), /futuro/);
});

test("opening review binds the exact imported stock, units, provenance and draft state", () => {
  const workbook = workbookFixture();
  const { records, ...metadata } = workbook;
  const source = { ...metadata, status: "draft" };
  const items = records.map(record => ({ ...record, stock: record.openingStock, revision: 0, lastMovementId: null, sourceSha256: workbook.sourceSha256 }));
  const snapshot = validateOpening(source, items, workbook, false);
  assert.match(snapshot.inventorySha256, /^[a-f0-9]{64}$/);
  for (const change of [{ stock: 9 }, { unit: "CAR" }, { revision: 1 }, { lastMovementId: "operation" },
    { description: "Otra" }, { sourceSha256: "d".repeat(64) }]) {
    assert.throws(() => validateOpening(source, [{ ...items[0], ...change }], workbook, false));
  }
  assert.throws(() => validateOpening(source, items, workbook, true), /movimientos/);
  assert.throws(() => validateOpening({ ...source, status: "active" }, items, workbook, false));
  assert.throws(() => validateOpening(source, [], workbook, false));
  assert.throws(() => validateOpening({ ...source, numericNormalizations: [{ cell: "F31" }] }, items, workbook, false));
  const changed = validateOpening({ ...source, importedAt: "changed" }, items, workbook, false);
  assert.notEqual(changed.inventorySha256, snapshot.inventorySha256);
});
