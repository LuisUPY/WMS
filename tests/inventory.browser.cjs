const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');
const base = process.env.WMS_TEST_URL || 'http://localhost:4173';

const authStub = `export async function prepareGoogleAccess() { return {
  async signIn() { return { uid:'test-admin', displayName:'Administrador de prueba', email:'admin@example.test', emailVerified:true,
    providerData:[{providerId:'google.com'}], async getIdTokenResult() { return {claims:{admin:true,firebase:{sign_in_provider:'google.com'}}}; } }; },
  async signOut() {}
}; }`;
const inventoryStub = `
const sample = {id:'A101__12345678',sku:'12345678',description:'Material de prueba PAC',warehouse:'A101',unit:'PAC',stock:120,
  openingPackages:{cs:1,car:2,cxt:0},alternateCode:'70.10.10'};
let state = {items:[sample,{...sample,id:'A101__87654321',sku:'87654321',description:'Material de prueba CAR',unit:'CAR',stock:30}],movements:[],details:[],online:true,
  source:{status:'draft',sourceFile:'test.xlsx',sourceSheet:'FISICO - A101',sourceAsOf:null}};
window.__pushInventory = (changes) => {state={...state,...changes}; window.__subscriber?.(state);};
window.__subscriptions=0; window.__records=[]; window.__detailRecords=[];
export async function prepareInventory() {
  if(window.__delayInventory) await new Promise(resolve=>window.__resolveInventory=resolve);
  return {
    subscribe(callback) {window.__subscriber=callback;window.__subscriptions++;callback(state);
      return ()=>{window.__subscriber=undefined;window.__subscriptions--;};},
    connectionChanged() {},
    async editDetail(data,id,identity) {
      window.__detailRecords.push({data,id,identity});
      if(window.__failDetail) throw {code:'unavailable'};
      const item=state.items.find(i=>i.id===data.itemId);
      const before=state.details.find(d=>d.id===data.itemId)||{id:data.itemId,umr:item.unit,location:item.warehouse};
      state={...state,details:[...state.details.filter(d=>d.id!==data.itemId),{...before,[data.field]:data.value,lastChangeId:id}]};
      window.__subscriber?.(state); return {id};
    },
    async record(data,id,identity) {
      window.__records.push({data,id,identity});
      if(window.__failRecord) throw {code:'unavailable'};
      if(window.__holdRecord) await new Promise(resolve=>window.__resolveRecord=resolve);
      const item=state.items.find(i=>i.id===data.itemId);
      state={...state,items:state.items.map(i=>i.id===data.itemId?{...i,stock:i.stock+(data.type==='entry'?data.quantity:-data.quantity)}:i),
        movements:[{...data,id,sku:item.sku,unit:item.unit,actorUid:identity.uid},...state.movements]};
      window.__subscriber?.(state); return {id};
    }
  };
}`;

(async () => {
  await mkdir('test-results', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await context.addInitScript(() => {
      for (const name of ['localStorage','sessionStorage','indexedDB']) Object.defineProperty(window, name, {get(){throw new Error('Persistent browser storage is disabled');}});
    });
    const page = await context.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/firebase-client.js*', route => route.fulfill({contentType:'text/javascript',body:authStub}));
    await page.route('**/firestore-inventory.js*', route => route.fulfill({contentType:'text/javascript',body:inventoryStub}));
    await page.goto(base);
    await page.getByRole('button',{name:'Continuar con Google'}).click();
    await page.locator('#inventory-rows tr').first().waitFor();
    assert.equal(await page.locator('#source-status').textContent(),'Saldo inicial pendiente de validación · movimientos deshabilitados');
    assert.equal(await page.locator('#movement-submit').isDisabled(),true);
    assert.equal(await page.locator('#material-count').textContent(),'2');
    assert.equal(await page.locator('#total-pac').textContent(),'120');
    assert.equal(await page.locator('#total-car').textContent(),'30');
    assert.equal(await page.locator('.inventory-table th').count(),9);
    assert.equal(await page.locator('#inventory-rows tr').first().locator('td').first().textContent(),'87654321','alphabetic description precedes SKU');
    const material=page.locator('#inventory-rows tr').filter({hasText:'12345678'});
    assert.deepEqual(await material.locator('td').allTextContents(),['12345678','Material de prueba PAC','120 PAC','1','2','0','PACCambiar','A101Cambiar','Ver material']);
    assert.equal(await page.getByRole('button',{name:'Cambiar UMR de 12345678'}).isDisabled(),true);
    await page.screenshot({path:'test-results/inventory-desktop.png',fullPage:true});
    await page.locator('#inventory-search').fill('70.10');
    assert.equal(await page.locator('#inventory-rows tr').count(),2);
    await page.locator('#inventory-search').fill('87654321');
    assert.equal(await page.locator('#inventory-rows tr').count(),1);
    await page.locator('#inventory-search').fill('sin coincidencia');
    assert.equal(await page.locator('#inventory-empty').isVisible(),true);
    await page.locator('#inventory-search').fill('');

    await page.evaluate(() => window.__pushInventory({source:{status:'active',sourceFile:'test.xlsx',sourceSheet:'FISICO - A101'}}));
    assert.equal(await page.locator('#movement-submit').isDisabled(),true,'active without approval remains blocked');
    assert.match(await page.locator('#source-status').textContent(),/pendiente de validación/);
    assert.doesNotMatch(await page.locator('#source-status').textContent(),/null|undefined/);
    await page.evaluate(() => {
      const stamp = value => ({toMillis:()=>new Date(value).getTime(),toDate:()=>new Date(value)});
      const sourceAsOf=stamp('2026-01-01T21:00:00Z');
      window.__pushInventory({source:{status:'active',approvalStatus:'approved',stockScope:'all-usable',
        sourceFile:'test.xlsx',sourceSheet:'FISICO - A101',sourceAsOf,sourceSha256:'a'.repeat(64),recordCount:2,approvalId:'b'.repeat(64),
        approval:{schemaVersion:1,stockScope:'all-usable',sourceSha256:'a'.repeat(64),recordCount:2,inventorySha256:'c'.repeat(64),
          sourceAsOf,approvedAt:stamp('2026-01-02T00:00:00Z'),approvedBy:'Responsable de prueba',approvedByUid:'test-approver',
          evidence:'Declaración ficticia de prueba',quantitiesAndUnitsConfirmed:true,numericNormalizationsReviewed:true,noUnrecordedMovementsConfirmed:true}}});
    });
    assert.equal(await page.locator('#movement-submit').isDisabled(),false);
    assert.match(await page.locator('#source-description').textContent(),/mercancía utilizable/);
    assert.match(await page.locator('#source-status').textContent(),/Responsable de prueba/);
    await page.getByRole('button',{name:'Cambiar ubicación de 12345678'}).click();
    await page.locator('#detail-value').fill('A102');
    await page.getByRole('button',{name:'Guardar cambio',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('#detail-dialog').open);
    assert.match(await material.locator('td').nth(7).textContent(),/A102/);
    assert.equal(await page.locator('#total-pac').textContent(),'120');
    await page.getByRole('button',{name:'Cambiar UMR de 12345678'}).click();
    await page.locator('#detail-value').fill('PAQUETE');
    await page.evaluate(()=>window.__failDetail=true);
    await page.locator('#detail-submit').click();
    await page.getByRole('button',{name:'Reintentar confirmación',exact:true}).click({trial:true});
    assert.equal(await page.locator('#detail-value').isDisabled(),true);
    assert.equal(await page.locator('#detail-cancel').isDisabled(),true);
    await page.evaluate(()=>window.__failDetail=false);
    await page.locator('#detail-submit').click();
    await page.waitForFunction(()=>!document.querySelector('#detail-dialog').open);
    assert.equal(await page.evaluate(()=>window.__detailRecords[1].id===window.__detailRecords[2].id),true,'detail retry keeps ID');
    assert.match(await material.locator('td').nth(6).textContent(),/PAQUETE/);
    assert.equal(await material.locator('td').nth(2).textContent(),'120 PAC','editable reference never changes the balance unit');
    await page.screenshot({path:'test-results/inventory-approved-desktop.png',fullPage:true});
    await page.getByRole('button',{name:'Ver material 12345678'}).click();
    assert.equal(await page.locator('#movement-item').inputValue(),'A101__12345678');
    assert.match(await page.locator('#opening-packages').textContent(),/No se recalcula/);
    await page.locator('#movement-quantity').fill('5');
    await page.locator('#movement-reference').fill('TEST-ENTRADA');
    await page.evaluate(()=>{window.__holdRecord=true;});
    await page.locator('#movement-submit').click();
    assert.equal(await page.locator('#movement-submit').isDisabled(),true);
    assert.equal(await page.locator('#total-pac').textContent(),'120','no optimistic balance');
    await page.evaluate(()=>{window.__resolveRecord();window.__holdRecord=false;});
    await page.waitForFunction(()=>document.querySelector('#total-pac').textContent==='125');
    assert.match(await page.locator('#inventory-notice').textContent(),/Movimiento confirmado/);
    assert.equal(await page.locator('#movement-rows tr').count(),1);
    assert.equal(await page.locator('#movement-rows .folio').textContent(),await page.evaluate(()=>window.__records[0].id));
    await page.locator('#movement-item').selectOption('A101__12345678');
    await page.locator('#movement-quantity').fill('2');
    await page.locator('#movement-reference').fill('TEST-REINTENTO');
    await page.evaluate(()=>{window.__failRecord=true;});
    await page.locator('#movement-submit').click();
    await page.getByRole('button',{name:'Reintentar confirmación'}).waitFor();
    assert.equal(await page.locator('#movement-reference').isDisabled(),true);
    await page.evaluate(()=>{window.__failRecord=false;});
    await page.getByRole('button',{name:'Reintentar confirmación'}).click();
    await page.waitForFunction(()=>document.querySelector('#total-pac').textContent==='127');
    assert.equal(await page.evaluate(()=>window.__records[1].id===window.__records[2].id),true,'retry keeps operation ID');

    await context.setOffline(true);
    await page.waitForFunction(()=>document.querySelector('#inventory-status').textContent==='Sin conexión confirmada');
    assert.equal(await page.locator('#movement-submit').isDisabled(),true);
    assert.equal(await page.locator('#inventory-print').isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'Cambiar UMR de 12345678'}).isDisabled(),true);
    await context.setOffline(false);
    await page.evaluate(()=>window.__pushInventory({online:true}));
    for(const width of [390,320]) {
      await page.setViewportSize({width,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no mobile overflow');
      if(width===390) await page.screenshot({path:'test-results/inventory-mobile.png',fullPage:true});
    }
    await page.emulateMedia({media:'print'});
    assert.equal(await page.locator('.movement-panel').isVisible(),false);
    assert.equal(await page.locator('.table-scroll').first().evaluate(e=>getComputedStyle(e).maxHeight),'none');
    await page.emulateMedia({media:'screen'});
    await page.getByRole('button',{name:'Cerrar sesión'}).click();
    assert.equal(await page.locator('#inventory-rows tr').count(),0);
    assert.equal(await page.evaluate(()=>window.__subscriptions),0);
    assert.equal(await page.locator('#total-pac').textContent(),'');
    await page.evaluate(()=>{window.__delayInventory=true;});
    await page.getByRole('button',{name:'Continuar con Google'}).click();
    await page.waitForFunction(()=>typeof window.__resolveInventory==='function');
    await page.getByRole('button',{name:'Cerrar sesión'}).click();
    await page.evaluate(()=>window.__resolveInventory());
    assert.equal(await page.evaluate(()=>window.__subscriptions),0,'late gateway cannot reopen data listeners');
    assert.deepEqual(errors,[]);
    console.log('Inventory browser checks passed: draft, search, separate units, confirmed balances, retry ID, offline blocking, session cleanup, late response, print and mobile. Uses synthetic data only.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
