export class AccessError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function validateConfiguration(config) {
  return Boolean(config && ["apiKey", "authDomain", "projectId", "appId"].every(
    (key) => typeof config[key] === "string" && config[key].trim().length > 0
  ));
}

export async function administratorIdentity(user) {
  if (!user || !user.emailVerified || !user.providerData?.some((p) => p.providerId === "google.com")) {
    throw new AccessError("access/not-authorized");
  }
  const token = await user.getIdTokenResult(true);
  if (token.claims.admin !== true || token.claims.firebase?.sign_in_provider !== "google.com") {
    throw new AccessError("access/not-authorized");
  }
  return { name: user.displayName || "Administrador", email: user.email, uid: user.uid };
}

export function accessMessage(error) {
  const messages = {
    "access/not-configured": "El acceso está pendiente de activación. Contacta al responsable de WMS.",
    "access/not-authorized": "Esta cuenta no tiene permiso de administrador. Selecciona tu cuenta autorizada o solicita acceso al responsable de WMS.",
    "auth/popup-closed-by-user": "Se cerró la ventana de Google. Puedes intentarlo de nuevo.",
    "auth/cancelled-popup-request": "La solicitud anterior se canceló. Puedes intentarlo de nuevo.",
    "auth/popup-blocked": "El navegador bloqueó la ventana de Google. Permite las ventanas emergentes para este sitio e inténtalo de nuevo.",
    "auth/network-request-failed": "No pudimos conectar con Google. Revisa tu conexión e inténtalo de nuevo.",
    "auth/unauthorized-domain": "Este sitio todavía no está habilitado para iniciar sesión. Contacta al responsable de WMS.",
    "auth/operation-not-allowed": "El acceso con Google todavía no está habilitado. Contacta al responsable de WMS.",
    "auth/user-disabled": "Esta cuenta está deshabilitada. Contacta al responsable de WMS.",
    "auth/invalid-api-key": "El acceso está pendiente de activación. Contacta al responsable de WMS."
  };
  return messages[error?.code] || "No pudimos verificar el acceso. Inténtalo de nuevo en unos momentos.";
}

export function createAccessController({ gateway, render }) {
  let busy = false;
  let authenticated = false;
  let generation = 0;
  let expiryTimer;

  const reset = () => {
    generation += 1;
    clearTimeout(expiryTimer);
    authenticated = false;
    render({ status: "ready" });
  };

  return {
    async signIn() {
      if (busy || authenticated) return;
      busy = true;
      const attempt = ++generation;
      render({ status: "loading" });
      let service;
      try {
        service = await gateway();
        const user = await service.signIn();
        const identity = await administratorIdentity(user);
        if (attempt !== generation) {
          await service.signOut();
          return;
        }
        authenticated = true;
        render({ status: "authorized", identity });
        // A fixed, short app session requires reauthentication even if a tab stays open.
        expiryTimer = setTimeout(() => this.signOut(), 30 * 60 * 1000);
      } catch (error) {
        try { await service?.signOut(); } catch { /* Keep the app locked even if cleanup fails. */ }
        if (attempt === generation) {
          authenticated = false;
          render({ status: "error", message: accessMessage(error) });
        }
      } finally {
        busy = false;
      }
    },
    async signOut() {
      reset();
      try { await (await gateway()).signOut(); } catch { /* The visible app is already locked. */ }
    },
    lock() { reset(); }
  };
}
