export class InventoryError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function movementInput(input) {
  const quantity = Number(input.quantity);
  const reference = typeof input.reference === "string" ? input.reference.trim() : "";
  if (!/^[A-Z0-9]+__[0-9]{1,20}$/.test(input.itemId || "") || !["entry", "exit"].includes(input.type) ||
      !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1000000000 || !reference || reference.length > 160) {
    throw new InventoryError("inventory/invalid-movement");
  }
  return { itemId: input.itemId, type: input.type, quantity, reference };
}

export function nextStock(item, input) {
  if (!Number.isSafeInteger(item.stock) || item.stock < 0) throw new InventoryError("inventory/invalid-stock");
  const stock = item.stock + (input.type === "entry" ? input.quantity : -input.quantity);
  if (stock < 0) throw new InventoryError("inventory/insufficient-stock");
  if (!Number.isSafeInteger(stock)) throw new InventoryError("inventory/invalid-stock");
  return stock;
}

export function detailInput(input) {
  const numeric = ["cs", "car", "cxt"].includes(input.field);
  const raw = typeof input.value === "string" ? input.value.trim() : input.value;
  const value = numeric ? Number(raw) : raw;
  const maximum = input.field === "umr" ? 20 : 80;
  if (!/^[A-Z0-9]+__[0-9]{1,20}$/.test(input.itemId || "") || !["umr", "location", "cs", "car", "cxt"].includes(input.field) ||
      (numeric ? !/^[0-9]+$/.test(String(raw)) || !Number.isSafeInteger(value) || value < 0 || value > 1000000000
        : typeof value !== "string" || !value || value.length > maximum)) throw new InventoryError("inventory/invalid-detail");
  return { itemId: input.itemId, field: input.field, value };
}

export function detailValues(item, details) {
  return { umr: details?.umr ?? item.unit, location: details?.location ?? item.warehouse,
    cs: details?.cs ?? item.openingPackages.cs, car: details?.car ?? item.openingPackages.car,
    cxt: details?.cxt ?? item.openingPackages.cxt };
}

export const MAX_OPERATION_PRODUCTS = 5;

export function operationInput(input) {
  const reference = typeof input.reference === "string" ? input.reference.trim() : "";
  if (!reference || reference.length > 160 || !Array.isArray(input.lines) || !input.lines.length ||
      input.lines.length > MAX_OPERATION_PRODUCTS) throw new InventoryError("inventory/invalid-operation");
  const seen = new Set();
  const lines = input.lines.map(line => {
    if (seen.has(line.itemId)) throw new InventoryError("inventory/duplicate-product");
    seen.add(line.itemId);
    if (line.type !== "packages") {
      const { itemId, type, quantity } = movementInput({ ...line, reference });
      return { itemId, type, quantity };
    }
    const values = Object.fromEntries(["cs", "car", "cxt"].map(field =>
      [field, detailInput({ itemId: line.itemId, field, value: line[field] }).value]));
    return { itemId: line.itemId, type: "packages", ...values };
  });
  return { reference, lines };
}

export function operationMatches(saved, data, actorUid) {
  return saved.actorUid === actorUid && saved.reference === data.reference &&
    Object.keys(saved.lines).length === data.lines.length && data.lines.every(line => {
      const previous = saved.lines[line.itemId];
      return previous?.type === line.type && (line.type === "packages"
        ? ["cs", "car", "cxt"].every(field => previous.packagesAfter[field] === line[field])
        : previous.quantity === line.quantity);
    });
}

export function filterInventory(items, search = "") {
  const term = search.trim().toLocaleLowerCase("es");
  return items.filter(item => `${item.sku} ${item.description} ${item.alternateCode || ""}`.toLocaleLowerCase("es").includes(term))
    .sort((a, b) => a.description.localeCompare(b.description, "es", { sensitivity: "base", numeric: true }) ||
      a.sku.localeCompare(b.sku, "es", { numeric: true }));
}

export function inventoryMessage(error) {
  return ({
    "inventory/not-approved": "El saldo inicial está pendiente de validación. Los movimientos aún no están habilitados.",
    "inventory/offline": "Sin conexión confirmada. Espera a que el inventario vuelva a estar en línea.",
    "inventory/invalid-movement": "Indica un material, una cantidad entera positiva y una referencia de hasta 160 caracteres.",
    "inventory/invalid-operation": "Añade de 1 a 5 productos e indica el documento o motivo del movimiento.",
    "inventory/duplicate-product": "Cada producto puede aparecer una vez por movimiento. Revisa los productos seleccionados.",
    "inventory/invalid-stock": "Este material tiene un saldo inválido. Solicita su revisión.",
    "inventory/insufficient-stock": "No hay saldo suficiente. Revisa la existencia actual.",
    "inventory/not-found": "El material ya no está disponible. Actualiza tu consulta.",
    "inventory/id-conflict": "Este identificador ya corresponde a otro movimiento. Revisa el historial.",
    "inventory/invalid-detail": "Indica un entero entre 0 y 1,000,000,000 para CS, CAR o CXT; UMR admite hasta 20 caracteres y ubicación hasta 80.",
    "permission-denied": "Tu cuenta no tiene permiso para consultar o modificar el inventario.",
    "unauthenticated": "La sesión terminó. Vuelve a iniciar sesión.",
    "unavailable": "No pudimos confirmar el movimiento. Conserva el formulario y vuelve a intentarlo con la misma referencia.",
    "aborted": "Otro usuario modificó el saldo. Vuelve a intentar el movimiento.",
    "failed-precondition": "La base de datos necesita configuración. Contacta al responsable de WMS."
  })[error?.code] || "No pudimos completar la operación. Revisa la conexión y vuelve a intentarlo.";
}
