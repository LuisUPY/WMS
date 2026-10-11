import { filterInventory, inventoryMessage, detailInput, detailValues } from "./inventory.js?v=0.7";
import { prepareInventory } from "./firestore-inventory.js?v=0.7";
import { isOpeningApproved } from "./opening-approval.js?v=0.7";

import { createMovementForm } from "./movement-form.js?v=0.7";

const number = new Intl.NumberFormat("es-MX");
const time = new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: "America/Merida" });
const detailLabels = { umr: "UMR", location: "S. Loc. Ubicación" };

export function mountInventory(identity) {
  const get = id => document.getElementById(id);
  const form = get("movement-form");
  let closed = false;
  let stop;
  let store;
  let state = { items: [], movements: [], online: false, source: null };
  const movementForm = createMovementForm(() => state);
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
    get("detail-title").textContent = `Editar ${detailLabels[field]}`;
    get("detail-label").textContent = detailLabels[field];
    get("detail-material").textContent = `${item.sku} · ${item.description}`;
    get("detail-help").textContent = `Referencia visible del producto. El saldo conserva la unidad ${item.unit} y el almacén ${item.warehouse}; este cambio no convierte cantidades ni traslada existencias.`;
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
  function controls() {
    const allowed = state.online && isOpeningApproved(state.source);
    movementForm.lock(!allowed || saving || Boolean(pending));
    get("movement-submit").disabled = !allowed || saving;
    get("movement-submit").textContent = saving ? "Confirmando…" : pending ? "Reintentar confirmación" : "Guardar movimiento";
    get("inventory-print").disabled = !state.online || !state.items.length;
    get("movement-help").textContent = !isOpeningApproved(state.source)
      ? "Los movimientos se habilitarán cuando se valide el saldo inicial."
      : !state.online ? "Espera la conexión con el servidor para registrar movimientos."
      : "Elige los productos y la operación de cada uno. Usa Cambiar desglose para corregir CS, CAR y CXT sin alterar el saldo total.";
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
      for (const key of ["cs", "car", "cxt"]) cell(row, number.format(values[key])).className = "numeric";
      for (const key of ["umr", "location"]) editableCell(row, item, key, values[key]);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "text-button";
      button.textContent = "Añadir al movimiento";
      button.setAttribute("aria-label", `Añadir ${item.sku} al movimiento`);
      button.disabled = !state.online || !isOpeningApproved(state.source) || saving || Boolean(pending);
      button.addEventListener("click", () => movementForm.addProduct(item.id));
      cell(row, "").append(button);
      body.append(row);
    }
    get("inventory-empty").hidden = items.length > 0;
    get("inventory-empty").textContent = state.items.length ? "No hay materiales que coincidan con la búsqueda." : "No hay materiales confirmados por el servidor.";
    movementForm.refresh();
    const operations = get("operation-list");
    const expanded = new Set([...operations.querySelectorAll("details[open]")].map(card => card.dataset.id));
    operations.replaceChildren();
    for (const operation of state.operations || []) {
      const card = document.createElement("details"); card.className = "operation-history";
      card.dataset.id = operation.id; card.open = expanded.has(operation.id);
      const summary = document.createElement("summary");
      const date = operation.createdAt?.toDate?.();
      const lines = Object.entries(operation.lines);
      summary.textContent = `${date ? time.format(date) : "Pendiente"} · ${operation.reference} · ${lines.length} producto${lines.length === 1 ? "" : "s"}`;
      card.append(summary);
      const list = document.createElement("ul");
      for (const [itemId, line] of lines) {
        const item = state.items.find(item => item.id === itemId);
        const entry = document.createElement("li");
        const title = item ? `${item.description} · ${item.sku}` : itemId;
        entry.textContent = line.type === "packages"
          ? `${title} — Cambio de desglose: CS ${line.packagesBefore.cs} → ${line.packagesAfter.cs}, CAR ${line.packagesBefore.car} → ${line.packagesAfter.car}, CXT ${line.packagesBefore.cxt} → ${line.packagesAfter.cxt}. Saldo total sin cambio.`
          : `${title} — ${line.type === "entry" ? "Entrada" : "Salida"}: ${number.format(line.quantity)} ${line.unit}. Saldo: ${number.format(line.stockBefore)} → ${number.format(line.stockAfter)} ${line.unit}.`;
        list.append(entry);
      }
      card.append(list);
      const audit = document.createElement("p"); audit.className = "small-copy";
      audit.textContent = `Folio: ${operation.id} · Responsable: ${operation.actorUid}`; card.append(audit); operations.append(card);
    }
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
    get("legacy-history").hidden = !state.movements.length;
    get("movements-empty").hidden = state.movements.length > 0 || Boolean(state.operations?.length);
    controls();
  }
  async function submit(event) {
    event.preventDefault();
    if (saving || closed) return;
    let attempted;
    try {
      if (!pending) pending = { data: movementForm.read(), id: crypto.randomUUID() };
      saving = true;
      controls();
      message("Confirmando el movimiento con el servidor…");
      const operation = pending;
      attempted = operation;
      const result = await store.recordOperation(operation.data, operation.id, identity);
      if (closed) return;
      completed = result.id;
      pending = undefined;
      movementForm.reset();
      message(`Movimiento confirmado. Folio: ${result.id}`);
    } catch (error) {
      if (closed) return;
      if (attempted && completed === attempted.id) {
        message(`Movimiento confirmado. Folio: ${completed}`);
        return;
      }
      const definitive = ["inventory/invalid-operation", "inventory/duplicate-product", "inventory/invalid-detail", "inventory/invalid-movement", "inventory/invalid-stock", "inventory/insufficient-stock",
        "inventory/not-approved", "inventory/not-found", "inventory/id-conflict", "permission-denied", "unauthenticated", "aborted"];
      if (definitive.includes(error.code)) pending = undefined;
      message(`${error.material ? `${error.material}: ` : ""}${inventoryMessage(error)}${pending ? ` Folio pendiente: ${pending.id}. Reintenta sin cambiar los datos. Antes de recargar o cerrar sesión, comprueba este folio en el historial.` : ""}`);
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
      if (pending && next.online && next.operations?.some(m => m.id === pending.id && m.actorUid === identity.uid)) {
        completed = pending.id;
        pending = undefined;
        message(`Movimiento confirmado. Folio: ${completed}`);
        movementForm.reset();
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
    get("inventory-print").removeEventListener("click", print);
    window.removeEventListener("offline", connection);
    window.removeEventListener("online", connection);
    state = { items: [], movements: [], online: false, source: null };
    pending = undefined;
    get("inventory-rows").replaceChildren();
    get("movement-rows").replaceChildren();
    get("operation-list").replaceChildren();
    movementForm.dispose();
    form.reset();
    get("inventory-search").value = "";
    for (const id of ["material-count", "total-pac", "total-car", "source-status", "source-description"]) get(id).textContent = "";
    message("");
  };
}
