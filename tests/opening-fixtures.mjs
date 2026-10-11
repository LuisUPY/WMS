import { Timestamp } from "firebase-admin/firestore";

export const sourceHash = "a".repeat(64);
export const review = { sourceAsOf: "2026-01-01T15:00:00-06:00", approvedBy: "Responsable de prueba",
  evidence: "Declaración ficticia, solo para pruebas", stockScope: "all-usable", quantitiesAndUnitsConfirmed: true,
  numericNormalizationsReviewed: true, noUnrecordedMovementsConfirmed: true };

export function approvedSource() {
  const sourceAsOf = Timestamp.fromDate(new Date(review.sourceAsOf));
  return { status: "active", approvalStatus: "approved", stockScope: "all-usable", sourceSha256: sourceHash,
    sourceAsOf, recordCount: 1, approvalId: "b".repeat(64), approval: { ...review, schemaVersion: 1,
      sourceAsOf, approvedAt: Timestamp.fromDate(new Date("2026-01-02T00:00:00Z")),
      inventorySha256: "c".repeat(64), sourceSha256: sourceHash, recordCount: 1, approvedByUid: "test-approver" } };
}

export function workbookFixture() {
  return { sourceFile: "test.xlsx", sourceSheet: "FISICO - A101", sourceSha256: sourceHash, sourceAsOf: null,
    approvalStatus: "pending", stockScope: "total-unclassified", numericNormalizations: [], totalsByUnit: { PAC: 10 },
    recordCount: 1, records: [{ id: "A101__12345678", sku: "12345678", description: "Material de prueba",
      warehouse: "A101", unit: "PAC", openingStock: 10, openingPackages: { cs: 0, car: 1, cxt: 0 },
      alternateCode: "", sourceRow: 3 }] };
}
