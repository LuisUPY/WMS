import { createHash } from "node:crypto";

function stable(value) {
  if (typeof value?.toMillis === "function") return { seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
const serialize = value => JSON.stringify(stable(value));
const digest = value => createHash("sha256").update(serialize(value)).digest("hex");

export function validateReview(review, now = new Date()) {
  const fail = message => { throw new Error(message); };
  if (!review || typeof review !== "object") fail("Falta la declaración del responsable.");
  // An explicit offset prevents the host timezone from changing the cut.
  const date = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-](\d{2}):(\d{2}))$/.exec(review.sourceAsOf || "");
  if (!date) fail("Indica el corte ISO con zona horaria, por ejemplo 2026-10-11T15:00:00-06:00.");
  const [, y, m, d, h, min, sec, , offsetH = "0", offsetM = "0"] = date;
  if (+y < 2000 || +m < 1 || +m > 12 || +d < 1 || +d > new Date(Date.UTC(+y, +m, 0)).getUTCDate() ||
      +h > 23 || +min > 59 || +sec > 59 || +offsetH > 14 || +offsetM > 59 || (+offsetH === 14 && +offsetM !== 0)) {
    fail("La fecha del corte no es válida.");
  }
  const sourceAsOf = new Date(review.sourceAsOf);
  if (!Number.isFinite(sourceAsOf.getTime()) || sourceAsOf > now) fail("El corte no puede ser futuro.");
  for (const [field, max] of [["approvedBy", 120], ["evidence", 1000]]) {
    if (typeof review[field] !== "string" || !review[field].trim() || review[field].length > max) fail(`Falta ${field} o excede ${max} caracteres.`);
  }
  if (review.stockScope !== "all-usable") fail("Esta apertura admite únicamente mercancía confirmada como utilizable.");
  for (const field of ["quantitiesAndUnitsConfirmed", "numericNormalizationsReviewed", "noUnrecordedMovementsConfirmed"]) {
    if (review[field] !== true) fail(`Falta confirmar ${field}.`);
  }
  return { sourceAsOf, approvedBy: review.approvedBy.trim(), evidence: review.evidence.trim(), stockScope: review.stockScope,
    quantitiesAndUnitsConfirmed: true, numericNormalizationsReviewed: true, noUnrecordedMovementsConfirmed: true };
}

export function validateOpening(source, items, workbook, hasMovements) {
  if (source?.status !== "draft" || source.approvalStatus !== "pending" || source.approval || source.approvalId) {
    throw new Error("La apertura debe seguir pendiente y sin una aprobación previa. No se modifica un inventario activo.");
  }
  if (hasMovements) throw new Error("Ya existen movimientos. Hay que conciliar antes de aprobar la apertura.");
  if (!/^[a-f0-9]{64}$/.test(workbook.sourceSha256) || source.sourceSha256 !== workbook.sourceSha256 ||
      source.sourceSheet !== workbook.sourceSheet || source.sourceFile !== workbook.sourceFile ||
      source.recordCount !== workbook.recordCount || items.length !== workbook.recordCount ||
      source.stockScope !== "total-unclassified" || source.sourceAsOf !== null ||
      serialize(source.numericNormalizations) !== serialize(workbook.numericNormalizations) ||
      serialize(source.totalsByUnit) !== serialize(workbook.totalsByUnit)) {
    throw new Error("El origen o el número de materiales no coincide con el archivo revisado.");
  }
  const expected = new Map(workbook.records.map(record => [record.id, record]));
  for (const item of items) {
    const record = expected.get(item.id);
    if (!record || item.sourceSha256 !== workbook.sourceSha256 || item.stock !== record.openingStock ||
        item.revision !== 0 || item.lastMovementId !== null ||
        Object.entries(record).some(([key, value]) => key !== "id" && serialize(item[key]) !== serialize(value))) {
      throw new Error(`El material ${item.id} cambió o no coincide con la fuente. No se aprueba ni sobrescribe.`);
    }
    expected.delete(item.id);
  }
  if (expected.size) throw new Error("Faltan materiales de la fuente revisada.");
  const ordered = [...items].sort((a, b) => a.id.localeCompare(b.id));
  return { source, items: ordered, inventorySha256: digest({ source, items: ordered }) };
}

async function readOpening(transaction, db, workbook) {
  const source = await transaction.get(db.doc("settings/inventory"));
  const rows = await transaction.get(db.collection("inventory"));
  const movements = await transaction.get(db.collection("movements").limit(1));
  return validateOpening(source.exists ? source.data() : null,
    rows.docs.map(doc => ({ ...doc.data(), id: doc.id })), workbook, !movements.empty);
}

export async function inspectOpening(db, workbook) {
  return db.runTransaction(transaction => readOpening(transaction, db, workbook), { readOnly: true });
}

export async function approveOpening(db, workbook, review, actorUid, expectedInventorySha256, timestamps) {
  const declaration = validateReview(review);
  if (typeof actorUid !== "string" || !actorUid.trim() || actorUid.length > 128) throw new Error("Falta la identidad administrativa verificada.");
  if (!/^[a-f0-9]{64}$/.test(expectedInventorySha256 || "")) throw new Error("Falta la huella del inventario revisado con --expect.");
  return db.runTransaction(async transaction => {
    const snapshot = await readOpening(transaction, db, workbook);
    if (snapshot.inventorySha256 !== expectedInventorySha256) throw new Error("El inventario cambió desde la revisión. Genera una nueva vista previa.");
    const approvalId = digest({ ...declaration, sourceAsOf: review.sourceAsOf, actorUid, expectedInventorySha256 });
    const approval = { ...declaration, schemaVersion: 1, sourceAsOf: timestamps.fromDate(declaration.sourceAsOf),
      approvedAt: timestamps.serverTimestamp(), approvedByUid: actorUid, inventorySha256: snapshot.inventorySha256,
      sourceSha256: workbook.sourceSha256, recordCount: workbook.recordCount };
    transaction.create(db.doc(`inventoryApprovals/${approvalId}`), { approval, sourceBefore: snapshot.source, items: snapshot.items });
    transaction.update(db.doc("settings/inventory"), { status: "active", approvalStatus: "approved", stockScope: "all-usable",
      sourceAsOf: approval.sourceAsOf, approvalId, approval });
    // Quantities, item revisions and movement history are never rewritten here.
    return { approved: true, approvalId, count: workbook.recordCount };
  });
}
