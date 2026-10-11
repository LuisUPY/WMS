import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { readInventoryWorkbook } from "./inventory-import.mjs";
import { authorizedEmail, readAccessPolicy } from "./access-policy.mjs";
import { inspectOpening, approveOpening, validateReview } from "./opening-approval.mjs";

async function main() {
  const { values } = parseArgs({ options: {
    project: { type: "string" }, file: { type: "string", default: "DB/DataBase.xlsx" },
    review: { type: "string" }, email: { type: "string" }, expect: { type: "string" },
    apply: { type: "boolean", default: false }
  } });
  if (!values.project) throw new Error("Indica --project ID_PROYECTO. Sin --apply solo se consulta.");
  if (process.env.FIRESTORE_EMULATOR_HOST && !values.project.startsWith("demo-")) throw new Error("El emulador solo admite proyectos demo-.");
  if (values.apply && (!values.review || !values.expect)) throw new Error("La aprobación requiere --review ARCHIVO_PRIVADO --expect HUELLA_REVISADA --apply.");
  const workbook = await readInventoryWorkbook(values.file);
  const review = values.review ? JSON.parse(await readFile(values.review, "utf8")) : null;
  if (review) validateReview(review);
  const { initializeApp, applicationDefault, deleteApp } = await import("firebase-admin/app");
  const { getFirestore, FieldValue, Timestamp } = await import("firebase-admin/firestore");
  const app = initializeApp({ projectId: values.project,
    ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() }) });
  try {
    const db = getFirestore(app);
    const snapshot = await inspectOpening(db, workbook);
    console.log(JSON.stringify({ project: values.project, source: workbook.sourceFile, sheet: workbook.sourceSheet,
      sourceSha256: workbook.sourceSha256, materials: workbook.recordCount, totalsByUnit: workbook.totalsByUnit,
      numericNormalizations: workbook.numericNormalizations, inventorySha256: snapshot.inventorySha256,
      declaration: review, currentStatus: snapshot.source.status }, null, 2));
    if (!values.apply) { console.log("Vista previa de solo lectura. No se ha aprobado ni escrito en Firebase."); return; }
    const email = authorizedEmail(await readAccessPolicy(), values.email, "grant");
    const { getAuth } = await import("firebase-admin/auth");
    const user = await getAuth(app).getUserByEmail(email);
    if (user.disabled || !user.emailVerified || user.customClaims?.admin !== true ||
        user.email?.toLowerCase() !== email || !user.providerData.some(provider => provider.providerId === "google.com")) {
      throw new Error("La cuenta de ejecución debe ser una administradora Google habilitada y verificada.");
    }
    const result = await approveOpening(db, workbook, review, user.uid, values.expect,
      { fromDate: date => Timestamp.fromDate(date), serverTimestamp: () => FieldValue.serverTimestamp() });
    console.log(JSON.stringify(result, null, 2));
  } finally { await deleteApp(app); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
