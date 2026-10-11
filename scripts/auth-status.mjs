import { firebaseConfig } from "../public/config.js";
import { validateConfiguration } from "../public/auth.js";
import { readAccessPolicy } from "./access-policy.mjs";

try {
  const policy = await readAccessPolicy();
  console.log(`Cuentas aprobadas localmente: ${policy.administrators.length}`);
  console.log(`Proyecto Firebase: ${validateConfiguration(firebaseConfig) ? firebaseConfig.projectId : "pendiente de configuración"}`);
  console.log("Vista local: http://localhost:4173 (npm run dev)");
  console.log("La aprobación local no asigna el permiso en Firebase ni verifica el acceso real.");
  if (!validateConfiguration(firebaseConfig)) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
