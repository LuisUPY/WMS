import { readFile } from "node:fs/promises";

export function authorizedEmail(policy, requestedEmail, action) {
  const approved = policy?.administrators;
  if (!Array.isArray(approved) || approved.length === 0 || approved.some((email) => typeof email !== "string" || !email.trim())) {
    throw new Error("Define las cuentas aprobadas en config/access-policy.json.");
  }
  const email = (requestedEmail || (approved.length === 1 ? approved[0] : "")).trim().toLowerCase();
  if (!email) throw new Error("Indica --email para elegir una de las cuentas aprobadas.");
  if (action === "grant" && !approved.some((item) => item.trim().toLowerCase() === email)) {
    throw new Error("Esta cuenta no está aprobada en la política administrativa local.");
  }
  return email;
}

export async function readAccessPolicy() {
  try {
    return JSON.parse(await readFile(new URL("../config/access-policy.json", import.meta.url), "utf8"));
  } catch {
    throw new Error("Falta config/access-policy.json o no es válido. Usa config/access-policy.example.json como referencia.");
  }
}

export async function updateAdministrator(auth, email, action) {
  const user = await auth.getUserByEmail(email);
  if (action === "grant" && (
    user.disabled || !user.emailVerified || user.email?.toLowerCase() !== email ||
    !user.providerData.some((provider) => provider.providerId === "google.com")
  )) {
    throw new Error("La cuenta debe estar habilitada y haber verificado ese correo mediante Google.");
  }
  const claims = { ...user.customClaims };
  if (action === "grant") claims.admin = true;
  else if (action === "revoke") delete claims.admin;
  else throw new Error("Acción administrativa no válida.");
  await auth.setCustomUserClaims(user.uid, claims);
  if (action === "revoke") await auth.revokeRefreshTokens(user.uid);
}
