import { filterInventory, inventoryMessage, movementInput } from "./inventory.js";
import { prepareInventory } from "./firestore-inventory.js";

const number = new Intl.NumberFormat("es-MX");
const time = new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: "America/Merida" });

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

  function message(text) { get("inventory-notice").textContent = text; get("inventory-notice").hidden = !text; }
  function cell(row, value) { const td = document.createElement("td"); td.textContent = value; row.append(td); return td; }
  function selection() {
    const item = state.items.find(item => item.id === select.value);
    get("movement-unit").textContent = item ? `Cantidad en ${item.unit}` : "Cantidad";
    const p = item?.openingPackages;
    get("opening-packages").textContent = p ? `Desglose guardado de apertura: ${number.format(p.cs)} CS CARTONES, ${number.format(p.car)} CAR PAQUETES y ${number.format(p.cxt)} CXT. No se recalcula con los movimientos; faltan factores validados.` : "";
  }
  function controls() {
    const allowed = state.online && state.source?.status === "active";
    get("movement-fields").disabled = !allowed || saving || Boolean(pending);
    get("movement-submit").disabled = !allowed || saving;
    get("movement-submit").textContent = saving ? "Confirmando…" : pending ? "Reintentar confirmación" : "Confirmar movimiento";
    get("inventory-print").disabled = !state.online || !state.items.length;
    get("movement-help").textContent = state.source?.status === "draft"
      ? "Los movimientos se habilitarán cuando se valide el saldo inicial."
      : !state.online ? "Espera la conexión con el servidor para registrar movimientos."
      : "El saldo y su movimiento se guardan juntos. Las salidas no pueden dejar saldo negativo.";
  }
  function draw() {
    if (closed) return;
    get("inventory-status").textContent = state.online ? "En línea · actualización en tiempo real" : "Sin conexión confirmada";
    get("inventory-status").dataset.online = String(state.online);
    get("source-status").textContent = !state.source
      ? state.online ? "Aún no se ha importado la base de inventario." : "Conectando con el inventario…"
      : state.source.status === "draft" ? "Saldo inicial pendiente de validación · movimientos deshabilitados"
      : `Corte inicial: ${state.source.sourceAsOf} · validado por ${state.source.approvedBy}`;
    get("source-description").textContent = state.source
      ? `${state.source.sourceFile} · ${state.source.sourceSheet}. Stock total sin clasificación. No equivale a disponibilidad libre para surtido.` : "";
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
      cell(row, number.format(item.stock)).className = "numeric";
      cell(row, item.unit);
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
  const search = () => draw();
  const connection = () => { store?.connectionChanged(); if (!navigator.onLine) { state.online = false; draw(); } };
  const print = () => { if (state.online) window.print(); };
  get("inventory-search").addEventListener("input", search);
  select.addEventListener("change", selection);
  form.addEventListener("submit", submit);
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
