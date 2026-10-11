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

export function filterInventory(items, search = "") {
  const term = search.trim().toLocaleLowerCase("es");
  return items.filter(item => `${item.sku} ${item.description} ${item.alternateCode || ""}`.toLocaleLowerCase("es").includes(term))
    .sort((a, b) => a.sku.localeCompare(b.sku, "es", { numeric: true }));
}

export function inventoryMessage(error) {
  return ({
    "inventory/not-approved": "El saldo inicial está pendiente de validación. Los movimientos aún no están habilitados.",
    "inventory/offline": "Sin conexión confirmada. Espera a que el inventario vuelva a estar en línea.",
    "inventory/invalid-movement": "Indica un material, una cantidad entera positiva y una referencia de hasta 160 caracteres.",
    "inventory/invalid-stock": "Este material tiene un saldo inválido. Solicita su revisión.",
    "inventory/insufficient-stock": "No hay saldo suficiente. Revisa la existencia actual.",
    "inventory/not-found": "El material ya no está disponible. Actualiza tu consulta.",
    "inventory/id-conflict": "Este identificador ya corresponde a otro movimiento. Revisa el historial.",
    "permission-denied": "Tu cuenta no tiene permiso para consultar o modificar el inventario.",
    "unauthenticated": "La sesión terminó. Vuelve a iniciar sesión.",
    "unavailable": "No pudimos confirmar el movimiento. Conserva el formulario y vuelve a intentarlo con la misma referencia.",
    "aborted": "Otro usuario modificó el saldo. Vuelve a intentar el movimiento.",
    "failed-precondition": "La base de datos necesita configuración. Contacta al responsable de WMS."
  })[error?.code] || "No pudimos completar la operación. Revisa la conexión y vuelve a intentarlo.";
}
