const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const text = (value, max) => typeof value === "string" && /\S/.test(value) && value.length <= max;
const millis = value => typeof value?.toMillis === "function" ? value.toMillis() : NaN;

// Keep this contract aligned with approved() in firestore.rules. The server
// also requires an identical, client-immutable inventoryApprovals document.
export function isOpeningApproved(source, now = Date.now()) {
  const a = source?.approval;
  return Boolean(source?.status === "active" && source.approvalStatus === "approved" &&
    source.stockScope === "all-usable" && hash(source.approvalId) && a?.schemaVersion === 1 &&
    hash(a.inventorySha256) && hash(a.sourceSha256) && a.sourceSha256 === source.sourceSha256 &&
    Number.isInteger(a.recordCount) && a.recordCount > 0 && a.recordCount <= 400 && a.recordCount === source.recordCount &&
    a.stockScope === source.stockScope && Number.isFinite(millis(a.sourceAsOf)) &&
    millis(source.sourceAsOf) === millis(a.sourceAsOf) && Number.isFinite(millis(a.approvedAt)) &&
    millis(a.sourceAsOf) <= millis(a.approvedAt) && millis(a.approvedAt) <= now &&
    text(a.approvedBy, 120) && text(a.approvedByUid, 128) && text(a.evidence, 1000) &&
    a.quantitiesAndUnitsConfirmed === true && a.numericNormalizationsReviewed === true &&
    a.noUnrecordedMovementsConfirmed === true);
}
