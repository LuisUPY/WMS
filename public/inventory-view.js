import { filterInventory, inventoryMessage, movementInput, detailInput, detailValues } from "./inventory.js?v=0.6";
import { prepareInventory } from "./firestore-inventory.js?v=0.6";
import { isOpeningApproved } from "./opening-approval.js?v=0.6";

const number = new Intl.NumberFormat("es-MX");
const time = new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: "America/Merida" });
const detailLabels = { umr: "UMR", location: "S. Loc. Ubicación", cs: "CS CARTONES", car: "CAR PAQUETES", cxt: "CXT" };

export function mountInventory(identity) {
  const get = id => document.getElementById(id);
  const form = get("movement-form");
  const select = get("movement-item");
  let closed = false;
  let stop;
  let store;
  let state = { items: [], movements: [], online: false, source: null };
  let saving = false;
  let pending;
  let completed;
  const dialog = get("detail-dialog");
  let editing;
  let editPending;
  let editSaving = false;

  function message(text) { get("inventory-notice").textContent = text; get("inventory-notice").hidden = !text; }
  function cell(row, value) { const td = document.createElement("td"); td.textContent = value; row.append(td); return td; }
  function detailControls() {
    const allowed = state.online && isOpeningApproved(state.source);
    get("detail-value").disabled = editSaving || Boolean(editPending);
    get("detail-cancel").disabled = editSaving || Boolean(editPending);
    get("detail-submit").disabled = !allowed || editSaving;
    get("detail-submit").textContent = editSaving ? "Guardando…" : editPending ? "Reintentar confirmación" : "Guardar cambio";
  }
  function edit(item, field, value) {
    if (editSaving || editPending || !state.online || !isOpeningApproved(state.source)) return;
    editing = { itemId: item.id, field };
    const numeric = ["cs", "car", "cxt"].includes(field);
    get("detail-title").textContent = `Editar ${detailLabels[field]}`;
    get("detail-label").textContent = detailLabels[field];
    get("detail-material").textContent = `${item.sku} · ${item.description}`;
    get("detail-help").textContent = numeric
      ? `Corrige el desglose visible. El saldo total de ${number.format(item.stock)} ${item.unit} no cambia. Para modificar existencias, registra una entrada o salida. La apertura original se conserva en el historial.`
      : `Referencia visible del producto. El saldo conserva la unidad ${item.unit} y el almacén ${item.warehouse}; este cambio no convierte cantidades ni traslada existencias.`;
    get("detail-value").type = numeric ? "number" : "text";
    get("detail-value").inputMode = numeric ? "numeric" : "text";
    for (const [name, value] of Object.entries({ min: "0", max: "1000000000", step: "1" })) {
      if (numeric) get("detail-value").setAttribute(name, value); else get("detail-value").removeAttribute(name);
    }
    get("detail-value").maxLength = field === "umr" ? 20 : 80;
    get("detail-value").value = value;
    get("detail-notice").textContent = "";
    detailControls();
    dialog.showModal();
    get("detail-value").select();
  }
  function editableCell(row, item, field, value) {
    const td = cell(row, "");
    const displayed = document.createElement("span"); displayed.textContent = typeof value === "number" ? number.format(value) : value; td.append(displayed);
    if (typeof value === "number") td.className = "numeric";
    const button = document.createElement("button");
    button.type = "button"; button.className = "text-button cell-edit"; button.textContent = "Cambiar";
    button.setAttribute("aria-label", `Cambiar ${field === "location" ? "ubicación" : detailLabels[field]} de ${item.sku}`);
    button.disabled = !state.online || !isOpeningApproved(state.source) || editSaving || Boolean(editPending);
    button.addEventListener("click", () => edit(item, field, value)); td.append(button);
  }
  function selection() {
    const item = state.items.find(item => item.id === select.value);
    get("movement-unit").textContent = item ? `Cantidad en ${item.unit}` : "Cantidad";
    const p = item ? detailValues(item, state.details?.find(detail => detail.id === item.id)) : null;
    get("opening-packages").textContent = p ? `Desglose visible: ${number.format(p.cs)} CS CARTONES, ${number.format(p.car)} CAR PAQUETES y ${number.format(p.cxt)} CXT. Puede corregirse en la tabla. No se recalcula con los movimientos ni modifica el saldo total.` : "";
  }
  function controls() {
    const allowed = state.online && isOpeningApproved(state.source);
    get("movement-fields").disabled = !allowed || saving || Boolean(pending);
    get("movement-submit").disabled = !allowed || saving;
    get("movement-submit").textContent = saving ? "Confirmando…" : pending ? "Reintentar confirmación" : "Confirmar movimiento";
    get("inventory-print").disabled = !state.online || !state.items.length;
    get("movement-help").textContent = !isOpeningApproved(state.source)
      ? "Los movimientos se habilitarán cuando se valide el saldo inicial."
      : !state.online ? "Espera la conexión con el servidor para registrar movimientos."
      : "El saldo y su movimiento se guardan juntos. Las salidas no pueden dejar saldo negativo.";
    detailControls();
  }
  function draw() {
    if (closed) return;
    get("inventory-status").textContent = state.online ? "En línea · actualización en tiempo real" : "Sin conexión confirmada";
    get("inventory-status").dataset.online = String(state.online);
    get("source-status").textContent = !state.source
      ? state.online ? "Aún no se ha importado la base de inventario." : "Conectando con el inventario…"
      : !isOpeningApproved(state.source) ? "Saldo inicial pendiente de validación · movimientos deshabilitados"
      : `Corte inicial: ${time.format(state.source.approval.sourceAsOf.toDate())} · validado por ${state.source.approval.approvedBy}`;
    get("source-description").textContent = state.source
      ? `${state.source.sourceFile} · ${state.source.sourceSheet}. ${isOpeningApproved(state.source)
        ? "Saldo inicial validado como mercancía utilizable. Operaciones en la unidad de cada material."
        : "Stock total sin clasificación aprobada. Pendiente de validar para surtido."}` : "";
    get("material-count").textContent = state.source ? number.format(state.items.length) : "—";
    for (const unit of ["PAC", "CAR"]) {
      get(`total-${unit.toLowerCase()}`).textContent = state.source
        ? number.format(state.items.filter(i => i.unit === unit).reduce((sum, i) => sum + i.stock, 0)) : "—";
    }
    const items = filterInventory(state.items, get("inventory-search").value);
    get("inventory-count").textContent = `${items.length} materiales`;
    const body = get("inventory-rows");
    body.replaceChildren();
    for (const item of items) {
      const row = document.createElement("tr");
      cell(row, item.sku);
      cell(row, item.description);
      cell(row, `${number.format(item.stock)} ${item.unit}`).className = "numeric";
      const details = state.details?.find(detail => detail.id === item.id);
      const values = detailValues(item, details);
      for (const key of ["cs", "car", "cxt", "umr", "location"]) editableCell(row, item, key, values[key]);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "text-button";
      button.textContent = "Ver material";
      button.setAttribute("aria-label", `Ver material ${item.sku}`);
      button.disabled = saving || Boolean(pending);
      button.addEventListener("click", () => { select.value = item.id; selection(); get("movement-title").focus(); });
      cell(row, "").append(button);
      body.append(row);
    }
    get("inventory-empty").hidden = items.length > 0;
    get("inventory-empty").textContent = state.items.length ? "No hay materiales que coincidan con la búsqueda." : "No hay materiales confirmados por el servidor.";
    const selected = select.value;
    select.replaceChildren(new Option("Selecciona un material", ""));
    for (const item of filterInventory(state.items)) select.add(new Option(`${item.sku} · ${item.description}`, item.id));
    select.value = selected;
    selection();
    const history = get("movement-rows");
    history.replaceChildren();
    for (const m of state.movements) {
      const row = document.createElement("tr");
      const date = m.createdAt?.toDate?.();
      cell(row, date ? time.format(date) : "Pendiente");
      cell(row, m.sku);
      cell(row, m.type === "entry" ? "Entrada" : "Salida");
      cell(row, `${number.format(m.quantity)} ${m.unit}`).className = "numeric";
      cell(row, m.reference);
      cell(row, m.id).className = "folio";
      cell(row, m.actorUid);
      history.append(row);
    }
    get("movements-empty").hidden = state.movements.length > 0;
    controls();
  }
  async function submit(event) {
    event.preventDefault();
    if (saving || closed) return;
    let attempted;
    try {
      if (!pending) pending = { data: movementInput({ itemId: select.value,
        type: get("movement-type").value, quantity: get("movement-quantity").value,
        reference: get("movement-reference").value }), id: crypto.randomUUID() };
      saving = true;
      controls();
      message("Confirmando el movimiento con el servidor…");
      const operation = pending;
      attempted = operation;
      const result = await store.record(operation.data, operation.id, identity);
      if (closed) return;
      completed = result.id;
      pending = undefined;
      form.reset();
      selection();
      message(`Movimiento confirmado. Folio: ${result.id}`);
    } catch (error) {
      if (closed) return;
      if (attempted && completed === attempted.id) {
        message(`Movimiento confirmado. Folio: ${completed}`);
        return;
      }
      const definitive = ["inventory/invalid-movement", "inventory/invalid-stock", "inventory/insufficient-stock",
        "inventory/not-approved", "inventory/not-found", "inventory/id-conflict", "permission-denied", "unauthenticated", "aborted"];
      if (definitive.includes(error.code)) pending = undefined;
      message(`${inventoryMessage(error)}${pending ? ` Folio pendiente: ${pending.id}. Reintenta sin cambiar los datos. Antes de recargar o cerrar sesión, comprueba este folio en el historial.` : ""}`);
    } finally { saving = false; if (!closed) controls(); }
  }
  async function saveDetail(event) {
    event.preventDefault();
    if (editSaving || closed || !editing) return;
    try {
      editPending ||= { data: detailInput({ ...editing, value: get("detail-value").value }), id: crypto.randomUUID() };
      editSaving = true; detailControls();
      get("detail-notice").textContent = "Confirmando el cambio con el servidor…";
      const operation = editPending;
      await store.editDetail(operation.data, operation.id, identity);
      if (closed) return;
      editPending = undefined; editing = undefined;
      dialog.close(); message(`Referencia actualizada. Folio: ${operation.id}`);
    } catch (error) {
      if (closed) return;
      if (["inventory/invalid-detail", "inventory/not-approved", "inventory/not-found", "inventory/id-conflict", "permission-denied", "unauthenticated"].includes(error.code)) editPending = undefined;
      get("detail-notice").textContent = `${inventoryMessage(error)}${editPending ? ` Folio pendiente: ${editPending.id}. Reintenta sin cambiar el valor. Antes de cerrar sesión o recargar, verifica este valor en la tabla.` : ""}`;
    } finally { editSaving = false; if (!closed) { detailControls(); draw(); } }
  }
  const cancelDetail = () => { if (!editSaving && !editPending) { editing = undefined; dialog.close(); } };
  const escapeDetail = event => { if (editSaving || editPending) event.preventDefault(); };
  const search = () => draw();
  const connection = () => { store?.connectionChanged(); if (!navigator.onLine) { state.online = false; draw(); } };
  const print = () => { if (state.online) window.print(); };
  get("inventory-search").addEventListener("input", search);
  select.addEventListener("change", selection);
  form.addEventListener("submit", submit);
  get("detail-form").addEventListener("submit", saveDetail);
  get("detail-cancel").addEventListener("click", cancelDetail);
  dialog.addEventListener("cancel", escapeDetail);
  get("inventory-print").addEventListener("click", print);
  window.addEventListener("offline", connection);
  window.addEventListener("online", connection);
  draw();
  prepareInventory().then(service => {
    if (closed) return;
    store = service;
    stop = store.subscribe(next => {
      state = next;
      // A confirmed snapshot can settle an earlier response lost with the network.
      if (pending && next.online && next.movements.some(m => m.id === pending.id && m.actorUid === identity.uid)) {
        completed = pending.id;
        pending = undefined;
        message(`Movimiento confirmado. Folio: ${completed}`);
        form.reset();
      }
      draw();
    }, error => { message(inventoryMessage(error)); });
  }).catch(error => { if (!closed) message(inventoryMessage(error)); });

  return () => {
    closed = true;
    stop?.();
    form.removeEventListener("submit", submit);
    get("detail-form").removeEventListener("submit", saveDetail);
    get("detail-cancel").removeEventListener("click", cancelDetail);
    dialog.removeEventListener("cancel", escapeDetail);
    dialog.close(); get("detail-form").reset(); get("detail-notice").textContent = "";
    editing = undefined; editPending = undefined;
    get("inventory-search").removeEventListener("input", search);
    select.removeEventListener("change", selection);
    get("inventory-print").removeEventListener("click", print);
    window.removeEventListener("offline", connection);
    window.removeEventListener("online", connection);
    state = { items: [], movements: [], online: false, source: null };
    pending = undefined;
    get("inventory-rows").replaceChildren();
    get("movement-rows").replaceChildren();
    select.replaceChildren();
    form.reset();
    get("inventory-search").value = "";
    for (const id of ["material-count", "total-pac", "total-car", "source-status", "source-description", "opening-packages"]) get(id).textContent = "";
    message("");
  };
}
