import { createAccessController } from "./auth.js?v=0.5";
import { prepareGoogleAccess } from "./firebase-client.js?v=0.5";
import { mountInventory } from "./inventory-view.js?v=0.5";

const login = document.querySelector("#login-view");
const account = document.querySelector("#account-view");
const googleButton = document.querySelector("#google-signin");
const buttonText = document.querySelector("#google-label");
const notice = document.querySelector("#access-notice");
let stopInventory;

function render(state) {
  const granted = state.status === "authorized";
  login.hidden = granted;
  account.hidden = !granted;
  googleButton.disabled = state.status === "loading";
  googleButton.setAttribute("aria-busy", String(state.status === "loading"));
  buttonText.textContent = state.status === "loading" ? "Verificando acceso…" : "Continuar con Google";
  notice.hidden = !state.message;
  notice.textContent = state.message || "";
  if (granted) {
    document.querySelector("#account-name").textContent = state.identity.name;
    document.querySelector("#account-email").textContent = state.identity.email;
    document.querySelector("#account-initial").textContent = state.identity.name.slice(0, 1).toUpperCase();
    document.querySelector("#account-title").focus();
    document.title = "Inventario · WMS";
    if (!stopInventory) stopInventory = mountInventory(state.identity);
  } else {
    stopInventory?.();
    stopInventory = undefined;
    document.querySelector("#account-name").textContent = "";
    document.querySelector("#account-email").textContent = "";
    document.querySelector("#account-initial").textContent = "";
    document.title = "Acceso de administrador · WMS";
  }
}

const access = createAccessController({ gateway: prepareGoogleAccess, render });
googleButton.addEventListener("click", () => access.signIn());
document.querySelector("#signout").addEventListener("click", async () => {
  await access.signOut();
  googleButton.focus();
});

// Preload the provider before a user gesture so the popup opens without delay.
prepareGoogleAccess().catch(() => {});
// Do not restore a signed-in screen from a browser's back/forward cache.
window.addEventListener("pagehide", () => { access.lock(); });
window.addEventListener("pageshow", (event) => { if (event.persisted) access.signOut(); });

render({ status: "ready" });
