import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

export async function readInventoryWorkbook(file = "DB/DataBase.xlsx") {
  const { stdout } = await promisify(execFile)(process.env.WMS_PYTHON || "python3", [
    fileURLToPath(new URL("./read-workbook.py", import.meta.url)), resolve(file)
  ], { maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(stdout);
}

export async function importOpening(db, data, timestamp) {
  // A single transaction publishes all rows and the source marker together.
  // It can never reset a live balance, even if rerun with another workbook.
  return db.runTransaction(async (transaction) => {
    const settings = db.doc("settings/inventory");
    const existing = await transaction.get(settings);
    if (existing.exists) {
      if (existing.data().sourceSha256 === data.sourceSha256) return { imported: false, count: existing.data().recordCount };
      throw new Error("Ya existe un inventario. Esta carga no puede sustituir saldos ni movimientos.");
    }
    const inventory = await transaction.get(db.collection("inventory").limit(1));
    const movements = await transaction.get(db.collection("movements").limit(1));
    if (!inventory.empty || !movements.empty) throw new Error("Existen datos sin marcador de origen. Revisa la base antes de importar.");
    const { records, ...source } = data;
    transaction.create(settings, { ...source, status: "draft", importedAt: timestamp });
    for (const { id, openingStock, ...record } of records) {
      transaction.create(db.doc(`inventory/${id}`), {
        ...record, openingStock, stock: openingStock, revision: 0, lastMovementId: null,
        sourceSha256: data.sourceSha256, updatedAt: timestamp
      });
    }
    return { imported: true, count: records.length };
  });
}

async function main() {
  const { values } = parseArgs({ options: {
    file: { type: "string", default: "DB/DataBase.xlsx" },
    project: { type: "string" }, apply: { type: "boolean", default: false }
  } });
  const data = await readInventoryWorkbook(values.file);
  console.log(JSON.stringify({ source: data.sourceFile, sheet: data.sourceSheet, sha256: data.sourceSha256,
    materials: data.recordCount, totalsByUnit: data.totalsByUnit,
    approval: "Pendiente de validación; movimientos deshabilitados", sourceAsOf: null }, null, 2));
  if (!values.apply) {
    console.log("Validación local completada. No se ha escrito en Firebase ni modificado el Excel.");
    return;
  }
  if (!values.project) throw new Error("Para importar, indica --apply --project ID_PROYECTO.");
  if (process.env.FIRESTORE_EMULATOR_HOST && !values.project.startsWith("demo-")) {
    throw new Error("El emulador solo admite proyectos demo- en este comando.");
  }
  const { initializeApp, applicationDefault, deleteApp } = await import("firebase-admin/app");
  const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
  const app = initializeApp({ projectId: values.project,
    ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() }) });
  try {
    const result = await importOpening(getFirestore(app), data, FieldValue.serverTimestamp());
    console.log(result.imported ? `${result.count} materiales importados. Saldo pendiente de validación.` : "Este archivo ya fue importado. Los saldos actuales se conservaron.");
  } finally { await deleteApp(app); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
