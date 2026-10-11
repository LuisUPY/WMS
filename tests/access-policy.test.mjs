import test from "node:test";
import assert from "node:assert/strict";
import { authorizedEmail, updateAdministrator } from "../scripts/access-policy.mjs";

test("the sole locally approved administrator is the default", () => {
  assert.equal(authorizedEmail({ administrators: ["admin@example.test"] }, undefined, "grant"), "admin@example.test");
});

test("an unapproved email cannot be granted privileges", () => {
  assert.throws(() => authorizedEmail({ administrators: ["admin@example.test"] }, "other@example.test", "grant"), /no está aprobada/);
});

test("multiple approved accounts require an explicit choice", () => {
  assert.throws(() => authorizedEmail({ administrators: ["one@example.test", "two@example.test"] }, undefined, "grant"), /Indica --email/);
});

test("a verified Google account receives the role without losing other claims", async () => {
  const writes = [];
  const auth = {
    getUserByEmail: async () => ({ uid: "uid", email: "admin@example.test", emailVerified: true, disabled: false, providerData: [{ providerId: "google.com" }], customClaims: { team: "A101" } }),
    setCustomUserClaims: async (...args) => { writes.push(args); }
  };
  await updateAdministrator(auth, "admin@example.test", "grant");
  assert.deepEqual(writes, [["uid", { team: "A101", admin: true }]]);
});

test("disabled, unverified, non-Google and mismatched accounts cannot receive a role", async () => {
  for (const change of [{ disabled: true }, { emailVerified: false }, { providerData: [] }, { email: "other@example.test" }]) {
    let writes = 0;
    const auth = {
      getUserByEmail: async () => ({ uid: "uid", email: "admin@example.test", emailVerified: true, providerData: [{ providerId: "google.com" }], ...change }),
      setCustomUserClaims: async () => { writes++; }
    };
    await assert.rejects(updateAdministrator(auth, "admin@example.test", "grant"));
    assert.equal(writes, 0);
  }
});

test("revoking an administrator preserves other claims and revokes refresh tokens", async () => {
  const calls = [];
  const auth = {
    getUserByEmail: async () => ({ uid: "uid", customClaims: { admin: true, team: "A101" } }),
    setCustomUserClaims: async (...args) => { calls.push(args); },
    revokeRefreshTokens: async (uid) => { calls.push(["revoke", uid]); }
  };
  await updateAdministrator(auth, "admin@example.test", "revoke");
  assert.deepEqual(calls, [["uid", { team: "A101" }], ["revoke", "uid"]]);
});
