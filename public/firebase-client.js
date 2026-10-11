import { AccessError, validateConfiguration } from "./auth.js?v=0.7";
import { firebaseConfig } from "./config.js?v=0.7";

let prepared;
let session;

export async function prepareFirebaseSession() {
  await prepareGoogleAccess();
  return session;
}

export function prepareGoogleAccess() {
  if (!validateConfiguration(firebaseConfig)) return Promise.reject(new AccessError("access/not-configured"));
  if (!prepared) {
    prepared = Promise.all([
      import("https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js")
    ]).then(([appSDK, authSDK]) => {
      const app = appSDK.initializeApp(firebaseConfig);
      const auth = authSDK.initializeAuth(app, {
        persistence: authSDK.inMemoryPersistence,
        popupRedirectResolver: authSDK.browserPopupRedirectResolver
      });
      const provider = new authSDK.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      auth.languageCode = "es";
      session = { app, auth };
      return {
        async signIn() { return (await authSDK.signInWithPopup(auth, provider)).user; },
        async signOut() { await authSDK.signOut(auth); }
      };
    }).catch((error) => { prepared = undefined; throw error; });
  }
  return prepared;
}
