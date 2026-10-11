const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');
const base = process.env.WMS_TEST_URL || 'http://localhost:4173';
const authStub = `export async function prepareGoogleAccess() { return {
 async signIn(){return {uid:'test-admin',displayName:'Administrador de prueba',email:'admin@example.test',emailVerified:true,
 providerData:[{providerId:'google.com'}],async getIdTokenResult(){return {claims:{admin:true,firebase:{sign_in_provider:'google.com'}}};}};},async signOut(){}
};}`;
const inventoryStub = `
const sample={id:'A101__12345678',sku:'12345678',description:'Material de prueba PAC',warehouse:'A101',unit:'PAC',stock:120,openingPackages:{cs:1,car:2,cxt:0},alternateCode:'70.10.10'};
let state={items:[sample,{...sample,id:'A101__87654321',sku:'87654321',description:'Material de prueba CAR',unit:'CAR',stock:30},
 {...sample,id:'A101__44444444',sku:'44444444',description:'Otro material',stock:50}],movements:[],operations:[],details:[],online:true,
 source:{status:'draft',sourceFile:'test.xlsx',sourceSheet:'FISICO - A101',sourceAsOf:null}};
window.__pushInventory=changes=>{state={...state,...changes};window.__subscriber?.(state);};
window.__subscriptions=0;window.__records=[];window.__detailRecords=[];
export async function prepareInventory(){
 if(window.__delayInventory)await new Promise(resolve=>window.__resolveInventory=resolve);
 return {subscribe(callback){window.__subscriber=callback;window.__subscriptions++;callback(state);return ()=>{window.__subscriber=undefined;window.__subscriptions--;};},connectionChanged(){},
 async editDetail(data,id,identity){
 window.__detailRecords.push({data,id,identity});if(window.__failDetail)throw {code:'unavailable'};
 const item=state.items.find(i=>i.id===data.itemId),before=state.details.find(d=>d.id===data.itemId)||{id:data.itemId,umr:item.unit,location:item.warehouse};
 state={...state,details:[...state.details.filter(d=>d.id!==data.itemId),{...before,[data.field]:data.value,lastChangeId:id}]};window.__subscriber?.(state);return {id};},
 async recordOperation(data,id,identity){
 window.__records.push({data,id,identity});if(window.__failRecord)throw {code:'unavailable'};
 if(window.__holdRecord)await new Promise(resolve=>window.__resolveRecord=resolve);
 const lines={};let items=[...state.items],details=[...state.details];
 for(const line of data.lines){
 const item=items.find(i=>i.id===line.itemId);
 if(line.type==='packages'){
 const before=details.find(d=>d.id===line.itemId)||{id:line.itemId,umr:item.unit,location:item.warehouse,...item.openingPackages};
 lines[line.itemId]={type:line.type,packagesBefore:{cs:before.cs,car:before.car,cxt:before.cxt},packagesAfter:{cs:line.cs,car:line.car,cxt:line.cxt}};
 details=[...details.filter(d=>d.id!==line.itemId),{...before,cs:line.cs,car:line.car,cxt:line.cxt}];
 }else{const stockAfter=item.stock+(line.type==='entry'?line.quantity:-line.quantity);
 lines[line.itemId]={...line,sku:item.sku,unit:item.unit,stockBefore:item.stock,stockAfter};items=items.map(i=>i.id===line.itemId?{...i,stock:stockAfter}:i);}}
 state={...state,items,details,operations:[{id,reference:data.reference,lines,actorUid:identity.uid},...state.operations]};window.__subscriber?.(state);return {id};}
 };}
`;
(async()=>{
 await mkdir('test-results',{recursive:true});const browser=await chromium.launch({headless:true});
 try{
 const context=await browser.newContext({viewport:{width:1440,height:1100}});
 await context.addInitScript(()=>{for(const name of ['localStorage','sessionStorage','indexedDB'])Object.defineProperty(window,name,{get(){throw Error('Persistent browser storage disabled');}});});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/firebase-client.js*',route=>route.fulfill({contentType:'text/javascript',body:authStub}));
 await page.route('**/firestore-inventory.js*',route=>route.fulfill({contentType:'text/javascript',body:inventoryStub}));
 await page.goto(base);await page.getByRole('button',{name:'Continuar con Google'}).click();await page.locator('#inventory-rows tr').first().waitFor();
 assert.equal(await page.locator('#movement-submit').isDisabled(),true);assert.equal(await page.locator('#material-count').textContent(),'3');
 assert.equal(await page.locator('#total-pac').textContent(),'170');assert.equal(await page.locator('#total-car').textContent(),'30');
 assert.equal(await page.locator('.inventory-table th').count(),9);
 assert.equal(await page.locator('#inventory-rows tr').first().locator('td').first().textContent(),'87654321');
 assert.equal(await page.getByRole('button',{name:/Cambiar CS CARTONES/}).count(),0);
 const material=page.locator('#inventory-rows tr').filter({hasText:'12345678'});
 assert.equal(await material.locator('td').nth(3).textContent(),'1');
 await page.locator('#inventory-search').fill('70.10');assert.equal(await page.locator('#inventory-rows tr').count(),3);
 await page.locator('#inventory-search').fill('87654321');assert.equal(await page.locator('#inventory-rows tr').count(),1);
 await page.locator('#inventory-search').fill('sin coincidencia');assert.equal(await page.locator('#inventory-empty').isVisible(),true);await page.locator('#inventory-search').fill('');
 await page.evaluate(()=>window.__pushInventory({source:{status:'active',sourceFile:'test.xlsx',sourceSheet:'FISICO - A101'}}));assert.equal(await page.locator('#movement-submit').isDisabled(),true);
 await page.evaluate(()=>{
 const stamp=value=>({toMillis:()=>new Date(value).getTime(),toDate:()=>new Date(value)}),sourceAsOf=stamp('2026-01-01T21:00:00Z');
 window.__pushInventory({source:{status:'active',approvalStatus:'approved',stockScope:'all-usable',sourceFile:'test.xlsx',sourceSheet:'FISICO - A101',sourceAsOf,sourceSha256:'a'.repeat(64),recordCount:3,approvalId:'b'.repeat(64),
 approval:{schemaVersion:1,stockScope:'all-usable',sourceSha256:'a'.repeat(64),recordCount:3,inventorySha256:'c'.repeat(64),sourceAsOf,approvedAt:stamp('2026-01-02T00:00:00Z'),approvedBy:'Responsable de prueba',approvedByUid:'test-approver',evidence:'Declaración ficticia de prueba',quantitiesAndUnitsConfirmed:true,numericNormalizationsReviewed:true,noUnrecordedMovementsConfirmed:true}}});});
 assert.equal(await page.locator('#movement-submit').isDisabled(),false);
 await page.getByRole('button',{name:'Cambiar ubicación de 12345678'}).click();await page.locator('#detail-value').fill('A102');await page.locator('#detail-submit').click();await page.waitForFunction(()=>!document.querySelector('#detail-dialog').open);
 assert.match(await material.locator('td').nth(7).textContent(),/A102/);
 await page.getByRole('button',{name:'Cambiar UMR de 12345678'}).click();await page.locator('#detail-value').fill('PAQUETE');await page.evaluate(()=>window.__failDetail=true);await page.locator('#detail-submit').click();
 await page.getByRole('button',{name:'Reintentar confirmación',exact:true}).waitFor();assert.equal(await page.locator('#detail-value').isDisabled(),true);await page.evaluate(()=>window.__failDetail=false);await page.locator('#detail-submit').click();await page.waitForFunction(()=>!document.querySelector('#detail-dialog').open);
 assert.equal(await page.evaluate(()=>window.__detailRecords[1].id===window.__detailRecords[2].id),true);
 await page.getByRole('button',{name:'Añadir 12345678 al movimiento'}).click();
 assert.equal(await page.getByLabel('Producto 1',{exact:true}).inputValue(),'A101__12345678');
 await page.getByRole('spinbutton',{name:'Cantidad en PAC 1',exact:true}).fill('5');
 await page.locator('#movement-add').click();await page.getByRole('button',{name:'Quitar producto 2'}).click();
 assert.equal(await page.getByRole('spinbutton',{name:'Cantidad en PAC 1',exact:true}).inputValue(),'5','adding/removing retains the first product');
 await page.locator('#movement-add').click();await page.getByLabel('Producto 2',{exact:true}).selectOption('A101__87654321');await page.getByLabel('Operación 2',{exact:true}).selectOption('exit');await page.getByRole('spinbutton',{name:'Cantidad en CAR 2',exact:true}).fill('2');
 await page.locator('#movement-add').click();await page.getByLabel('Producto 3',{exact:true}).selectOption('A101__44444444');await page.getByLabel('Operación 3',{exact:true}).selectOption('packages');
 for(const [name,value]of [['CS CARTONES','8'],['CAR PAQUETES','0'],['CXT','3']])await page.getByRole('spinbutton',{name:`${name} 3`,exact:true}).fill(value);
 assert.match(await page.locator('.product-hint').nth(2).textContent(),/saldo total no cambia/);
 await page.locator('#movement-reference').fill('TEST-MIXTO');
 await page.locator('#movement-add').click();await page.locator('#movement-add').click();assert.equal(await page.locator('#movement-add').isDisabled(),true);
 await page.getByRole('button',{name:'Quitar producto 5'}).click();await page.getByRole('button',{name:'Quitar producto 4'}).click();
 await page.screenshot({path:'test-results/operations-desktop-0.7.png',fullPage:true});
 for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'multi-product draft fits mobile');if(width===390)await page.screenshot({path:'test-results/operations-draft-mobile-0.7.png',fullPage:true});}
 await page.setViewportSize({width:1440,height:1100});
 await page.evaluate(()=>window.__holdRecord=true);await page.locator('#movement-submit').click();assert.equal(await page.locator('#movement-submit').isDisabled(),true);assert.equal(await page.locator('#total-pac').textContent(),'170');
 await page.evaluate(()=>{window.__resolveRecord();window.__holdRecord=false;});await page.waitForFunction(()=>document.querySelector('#total-pac').textContent==='175');
 assert.equal(await page.locator('#total-car').textContent(),'28');assert.equal(await page.locator('#operation-list details').count(),1);
 await page.locator('#operation-list summary').click();assert.equal(await page.locator('#operation-list li').count(),3);
 assert.match(await page.locator('#operation-list').textContent(),/TEST-MIXTO/);assert.match(await page.locator('#operation-list').textContent(),/CS 1 → 8/);
 assert.equal(await page.locator('#movement-lines .movement-product').count(),1);assert.equal(await page.locator('#movement-reference').inputValue(),'');
 await page.getByLabel('Producto 1',{exact:true}).selectOption('A101__12345678');await page.getByRole('spinbutton',{name:'Cantidad en PAC 1',exact:true}).fill('2');await page.locator('#movement-reference').fill('TEST-REINTENTO');
 await page.evaluate(()=>window.__failRecord=true);await page.locator('#movement-submit').click();await page.getByRole('button',{name:'Reintentar confirmación',exact:true}).waitFor();assert.equal(await page.getByLabel('Producto 1',{exact:true}).isDisabled(),true);
 await page.evaluate(()=>window.__failRecord=false);await page.locator('#movement-submit').click();await page.waitForFunction(()=>document.querySelector('#total-pac').textContent==='177');assert.equal(await page.evaluate(()=>window.__records[1].id===window.__records[2].id),true);
 await context.setOffline(true);await page.waitForFunction(()=>document.querySelector('#inventory-status').textContent==='Sin conexión confirmada');assert.equal(await page.locator('#movement-submit').isDisabled(),true);assert.equal(await page.locator('#movement-add').isDisabled(),true);
 await context.setOffline(false);await page.evaluate(()=>window.__pushInventory({online:true}));
 for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no mobile overflow');if(width===390)await page.screenshot({path:'test-results/operations-mobile-0.7.png',fullPage:true});}
 await page.emulateMedia({media:'print'});assert.equal(await page.locator('.movement-panel').isVisible(),false);await page.emulateMedia({media:'screen'});
 await page.getByRole('button',{name:'Cerrar sesión'}).click();assert.equal(await page.locator('#inventory-rows tr').count(),0);assert.equal(await page.locator('#operation-list details').count(),0);assert.equal(await page.evaluate(()=>window.__subscriptions),0);
 await page.evaluate(()=>window.__delayInventory=true);await page.getByRole('button',{name:'Continuar con Google'}).click();await page.waitForFunction(()=>typeof window.__resolveInventory==='function');await page.getByRole('button',{name:'Cerrar sesión'}).click();await page.evaluate(()=>window.__resolveInventory());assert.equal(await page.evaluate(()=>window.__subscriptions),0);
 assert.deepEqual(errors,[]);console.log('Inventory browser checks passed: clean table, multiple products, mixed operations, package corrections, grouped history, atomic confirmation, retry, offline, session cleanup, print and mobile. Synthetic data only.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
