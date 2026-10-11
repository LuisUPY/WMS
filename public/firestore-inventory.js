import { prepareFirebaseSession } from "./firebase-client.js?v=0.5";
import { createInventoryStore } from "./inventory-store.js?v=0.5";

let database;
let firestoreSDK;

export async function prepareInventory() {
  const { app, auth } = await prepareFirebaseSession();
  if (!auth.currentUser) throw { code: "unauthenticated" };
  firestoreSDK ||= await import("https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js");
  database ||= firestoreSDK.initializeFirestore(app, { localCache: firestoreSDK.memoryLocalCache() });
  return createInventoryStore(database, firestoreSDK);
}
