const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');

const base = process.env.WMS_TEST_URL || 'http://localhost:4173';
const gatewayStub = `
  export async function prepareGoogleAccess() {
    return {
      async signIn() {
        if (window.__testMode === 'cancel') throw { code: 'auth/popup-closed-by-user' };
        return { uid: 'test-admin', displayName: 'Administrador de prueba', email: 'admin@example.test', emailVerified: true, providerData: [{ providerId: 'google.com' }], async getIdTokenResult() { return { claims: { admin: window.__testMode === 'admin', firebase: { sign_in_provider: 'google.com' } } }; } };
      },
      async signOut() {}
    };
  }
`;

(async () => {
  await mkdir('test-results', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => {
      for (const type of ['localStorage', 'sessionStorage']) {
        Object.defineProperty(window, type, { get() { throw new Error('Browser storage is disabled in this test'); } });
      }
      window.__testMode = 'admin';
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    // Isolate the missing-config case even when this checkout has a real project.
    await page.route('**/config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'export const firebaseConfig = null;' }));
    await page.goto(base);
    await page.getByRole('button', { name: 'Continuar con Google' }).click();
    await page.getByRole('alert').filter({ hasText: 'pendiente de activación' }).waitFor();
    assert.equal(await page.locator('#account-view').isVisible(), false);
    await page.reload();
    await page.screenshot({ path: 'test-results/login-desktop.png', fullPage: true });
    assert.equal(await page.locator('.brand img').evaluate(img => img.complete && img.naturalWidth > 0), true);

    // These are mocked UI integration tests, never represented as live Google authentication.
    await page.route('**/firebase-client.js*', route => route.fulfill({ contentType: 'text/javascript', body: gatewayStub }));
    await page.route('**/firestore-inventory.js*', route => route.fulfill({ contentType: 'text/javascript', body: `export async function prepareInventory() { throw { code: 'failed-precondition' }; }` }));
    await page.reload();
    await page.getByRole('button', { name: 'Continuar con Google' }).click();
    await page.getByRole('heading', { name: 'Inventario.' }).waitFor();
    assert.equal(await page.locator('#account-email').textContent(), 'admin@example.test');
    await page.screenshot({ path: 'test-results/account-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await page.getByRole('button', { name: 'Continuar con Google' }).waitFor();
    assert.equal(await page.locator('#account-email').textContent(), '');

    await page.evaluate(() => { window.__testMode = 'denied'; });
    await page.getByRole('button', { name: 'Continuar con Google' }).click();
    await page.getByRole('alert').filter({ hasText: 'no tiene permiso' }).waitFor();
    assert.equal(await page.locator('#account-view').isVisible(), false);

    await page.evaluate(() => { window.__testMode = 'cancel'; });
    await page.getByRole('button', { name: 'Continuar con Google' }).click();
    await page.getByRole('alert').filter({ hasText: 'Se cerró la ventana' }).waitFor();

    await page.evaluate(() => { window.__testMode = 'admin'; });
    await page.getByRole('button', { name: 'Continuar con Google' }).click();
    await page.getByRole('heading', { name: 'Inventario.' }).waitFor();
    await page.reload();
    assert.equal(await page.locator('#account-view').isVisible(), false);

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal overflow');
      await page.getByRole('button', { name: 'Continuar con Google' }).waitFor();
      if (width === 390) await page.screenshot({ path: 'test-results/login-mobile.png', fullPage: true });
    }
    const documents = await page.request.get(`${base}/Information/Diagnostico_documental_W28_Merida.md`);
    assert.equal(documents.status(), 404);
    const configFiles = await page.request.get(`${base}/scripts/admin-role.mjs`);
    assert.equal(configFiles.status(), 404);
    const accessPolicy = await page.request.get(`${base}/config/access-policy.json`);
    assert.equal(accessPolicy.status(), 404);
    assert.equal((await page.request.get(`${base}/DB/DataBase.xlsx`)).status(), 404);
    assert.equal((await page.request.get(`${base}/firestore.rules`)).status(), 404);

    // Exercise the actual Firebase SDK loader with an isolated, non-production config.
    // This checks SDK initialization without a real sign-in or Google account.
    await page.unroute('**/firebase-client.js*');
    await page.unroute('**/config.js*');
    await page.route('**/config.js*', route => route.fulfill({ contentType: 'text/javascript', body: `export const firebaseConfig = { apiKey: 'AIzaSyTEST_CONFIG_NOT_A_REAL_API_KEY', authDomain: 'wms-login-test.firebaseapp.com', projectId: 'wms-login-test', appId: '1:123456789:web:localtest' };` }));
    await page.reload();
    const actualSDK = await page.evaluate(async () => {
      const module = await import('./firebase-client.js?v=0.7');
      const service = await module.prepareGoogleAccess();
      const { app } = await module.prepareFirebaseSession();
      const sdk = await import('https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js');
      const database = sdk.initializeFirestore(app, { localCache: sdk.memoryLocalCache() });
      const { createInventoryStore } = await import('./inventory-store.js?v=0.7');
      const store = createInventoryStore(database, sdk);
      return { signIn: typeof service.signIn, signOut: typeof service.signOut, record: typeof store.record, recordOperation: typeof store.recordOperation };
    });
    assert.deepEqual(actualSDK, { signIn: 'function', signOut: 'function', record: 'function', recordOperation: 'function' });
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: missing config, administrator, denial, cancellation, sign-out, reload, disabled storage, mobile layout, private file isolation and actual Firebase SDK initialization. This test does not exercise live OAuth.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
