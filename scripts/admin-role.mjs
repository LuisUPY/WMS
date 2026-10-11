import { parseArgs } from "node:util";
import { authorizedEmail, readAccessPolicy, updateAdministrator } from "./access-policy.mjs";

const [action, ...args] = process.argv.slice(2);
const { values } = parseArgs({ args, options: { email: { type: "string" }, project: { type: "string" } } });
if (!["grant", "revoke"].includes(action) || !values.project) {
  console.error("Uso: node scripts/admin-role.mjs grant|revoke --project ID_PROYECTO [--email CORREO_APROBADO]");
  process.exit(1);
}

try {
  const email = authorizedEmail(await readAccessPolicy(), values.email, action);
  const { initializeApp, applicationDefault, deleteApp } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  // Run only in a trusted terminal / Google Cloud Shell with project-owner credentials.
  // This script is never served or included in the Pages deployment.
  const app = initializeApp({ credential: applicationDefault(), projectId: values.project });
  try {
    const auth = getAuth(app);
    await updateAdministrator(auth, email, action);
    console.log(action === "grant" ? "Permiso asignado. Cierra sesión y vuelve a entrar con Google." : "Permiso retirado. Los tokens de acceso ya emitidos vencen según Firebase; los futuros servicios deberán verificar revocación.");
  } finally { await deleteApp(app); }
} catch (error) {
  if (error.code === "ERR_MODULE_NOT_FOUND") {
    console.error("Instala el SDK administrativo en el entorno de confianza: npm install --no-save firebase-admin");
  } else if (error.code === "auth/user-not-found") {
    console.error("Esta cuenta aún no existe en Firebase Authentication. Intenta entrar una vez con Google; después ejecuta de nuevo este comando.");
  } else {
    console.error("No se pudo modificar el permiso:", error.message);
  }
  process.exitCode = 1;
}
