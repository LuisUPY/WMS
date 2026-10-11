import test from "node:test";
import assert from "node:assert/strict";
import { administratorIdentity, createAccessController, validateConfiguration } from "../public/auth.js";

function googleUser(claims = { admin: true, firebase: { sign_in_provider: "google.com" } }, changes = {}) {
  return {
    uid: "test-user", email: "admin@example.test", emailVerified: true,
    displayName: "Administrador de prueba", providerData: [{ providerId: "google.com" }],
    getIdTokenResult: async () => ({ claims }), ...changes
  };
}

test("access fails closed until the actual Firebase configuration exists", () => {
  assert.equal(validateConfiguration(null), false);
  assert.equal(validateConfiguration({ apiKey: "x" }), false);
  assert.equal(validateConfiguration({ apiKey: "x", projectId: "x", appId: "x", authDomain: "x" }), true);
});

test("a Google identity without the trusted admin claim is denied", async () => {
  await assert.rejects(administratorIdentity(googleUser({ firebase: { sign_in_provider: "google.com" } })), { code: "access/not-authorized" });
  await assert.rejects(administratorIdentity(googleUser({ admin: "true", firebase: { sign_in_provider: "google.com" } })), { code: "access/not-authorized" });
});

test("an unverified or non-Google identity is denied even with an admin claim", async () => {
  await assert.rejects(administratorIdentity(googleUser(undefined, { emailVerified: false })), { code: "access/not-authorized" });
  await assert.rejects(administratorIdentity(googleUser(undefined, { providerData: [] })), { code: "access/not-authorized" });
  await assert.rejects(administratorIdentity(googleUser({ admin: true, firebase: { sign_in_provider: "password" } })), { code: "access/not-authorized" });
});

test("a verified Google administrator returns only account display fields", async () => {
  assert.deepEqual(await administratorIdentity(googleUser()), { uid: "test-user", name: "Administrador de prueba", email: "admin@example.test" });
});

test("denied access signs out and never renders the administrator view", async () => {
  const states = []; let signouts = 0;
  const controller = createAccessController({ gateway: async () => ({ signIn: async () => googleUser({}), signOut: async () => { signouts++; } }), render: (state) => states.push(state) });
  await controller.signIn();
  assert.equal(signouts, 1);
  assert.equal(states.some((state) => state.status === "authorized"), false);
  assert.match(states.at(-1).message, /no tiene permiso/);
});

test("double click cannot open two sign-in requests", async () => {
  let resolveSignIn; let requests = 0;
  const pending = new Promise((resolve) => { resolveSignIn = resolve; });
  const controller = createAccessController({ gateway: async () => ({ signIn: () => { requests++; return pending; }, signOut: async () => {} }), render: () => {} });
  const first = controller.signIn();
  await controller.signIn();
  resolveSignIn(googleUser());
  await first;
  assert.equal(requests, 1);
  await controller.signOut();
});

test("logout hides account information before network cleanup finishes", async () => {
  const states = []; let resolveSignOut;
  const controller = createAccessController({ gateway: async () => ({ signIn: async () => googleUser(), signOut: () => new Promise((resolve) => { resolveSignOut = resolve; }) }), render: (state) => states.push(state) });
  await controller.signIn();
  const closing = controller.signOut();
  assert.equal(states.at(-1).status, "ready");
  await Promise.resolve();
  resolveSignOut();
  await closing;
});

test("an access result arriving after a lock cannot reopen the account", async () => {
  const states = []; let resolveSignIn;
  const controller = createAccessController({ gateway: async () => ({ signIn: () => new Promise((resolve) => { resolveSignIn = resolve; }), signOut: async () => {} }), render: (state) => states.push(state) });
  const pending = controller.signIn();
  await Promise.resolve();
  controller.lock();
  resolveSignIn(googleUser());
  await pending;
  assert.equal(states.some((state) => state.status === "authorized"), false);
});
