import { filterInventory, detailValues, operationInput, MAX_OPERATION_PRODUCTS } from "./inventory.js?v=0.7";

const number = new Intl.NumberFormat("es-MX");

export function createMovementForm(getState) {
  const get = id => document.getElementById(id);
  let lines = [{}];
  let locked = true;

  function current(line) { return getState().items.find(item => item.id === line.itemId); }
  function values(item) { return detailValues(item, getState().details?.find(detail => detail.id === item.id)); }
  function hint(line, node) {
    const item = current(line);
    node.textContent = !item ? "Selecciona el producto que vas a incluir." : line.type === "packages"
      ? `Desglose actual: ${values(item).cs} CS · ${values(item).car} CAR · ${values(item).cxt} CXT. Escribe los nuevos valores; el saldo total no cambia.`
      : `Saldo actual: ${number.format(item.stock)} ${item.unit}. ${line.type === "exit" ? "La cantidad se restará." : "La cantidad se sumará."}`;
  }
  function label(parent, title, control) {
    const wrapper = document.createElement("label"); wrapper.textContent = title; wrapper.append(control); parent.append(wrapper); return wrapper;
  }
  function select(options, value, name) {
    const node = document.createElement("select"); node.setAttribute("aria-label", name);
    for (const [value, title] of options) node.add(new Option(title, value));
    node.value = value || ""; return node;
  }
  function quantity(line, field, title, parent, index, minimum) {
    const input = document.createElement("input");
    input.type = "number"; input.min = minimum; input.max = "1000000000"; input.step = "1"; input.inputMode = "numeric";
    input.value = line[field] ?? ""; input.required = true; input.setAttribute("aria-label", `${title} ${index + 1}`);
    input.addEventListener("input", () => { line[field] = input.value; });
    label(parent, title, input); return input;
  }
  function render(focusIndex) {
    const container = get("movement-lines"); container.replaceChildren();
    lines.forEach((line, index) => {
      line.type ||= "entry";
      const card = document.createElement("div"); card.className = "movement-product";
      const header = document.createElement("div"); header.className = "product-heading";
      const title = document.createElement("h3"); title.textContent = `Producto ${index + 1}`; header.append(title);
      if (lines.length > 1) {
        const remove = document.createElement("button"); remove.type = "button"; remove.className = "text-button";
        remove.textContent = "Quitar"; remove.setAttribute("aria-label", `Quitar producto ${index + 1}`);
        remove.addEventListener("click", () => { lines.splice(index, 1); render(Math.max(0, index - 1)); }); header.append(remove);
      }
      card.append(header);
      const fields = document.createElement("div"); fields.className = "product-fields"; card.append(fields);
      const product = select([["", "Selecciona un producto"], ...filterInventory(getState().items).map(item => [item.id, `${item.description} · ${item.sku}`])], line.itemId, `Producto ${index + 1}`);
      product.required = true; label(fields, "Producto", product);
      const type = select([["entry", "Entrada"], ["exit", "Salida"], ["packages", "Cambiar desglose"]], line.type, `Operación ${index + 1}`);
      label(fields, "Qué vas a hacer", type);
      product.addEventListener("change", () => {
        line.itemId = product.value; line.quantity = "";
        if (current(line)) Object.assign(line, values(current(line)));
        render(index);
      });
      type.addEventListener("change", () => { line.type = type.value; render(index); });
      if (line.type === "packages") {
        const packages = document.createElement("div"); packages.className = "package-fields"; card.append(packages);
        for (const [key, name] of [["cs", "CS CARTONES"], ["car", "CAR PAQUETES"], ["cxt", "CXT"]]) quantity(line, key, name, packages, index, "0");
      } else {
        quantity(line, "quantity", `Cantidad${current(line) ? ` en ${current(line).unit}` : ""}`, fields, index, "1");
      }
      const help = document.createElement("p"); help.className = "small-copy product-hint"; help.dataset.index = index; hint(line, help); card.append(help);
      container.append(card);
    });
    get("movement-add").disabled = locked || lines.length >= MAX_OPERATION_PRODUCTS;
    get("movement-summary").textContent = `${lines.length} de ${MAX_OPERATION_PRODUCTS} productos · Se guardarán juntos con un solo folio.`;
    if (focusIndex !== undefined) container.children[focusIndex]?.querySelector("select")?.focus();
  }
  function addProduct(itemId) {
    if (locked) return;
    const existing = lines.findIndex(line => line.itemId === itemId && itemId);
    if (existing >= 0) { render(existing); return; }
    let index = lines.findIndex(line => !line.itemId);
    if (index < 0) {
      if (lines.length >= MAX_OPERATION_PRODUCTS) { get("movement-summary").textContent = "Ya hay 5 productos. Guarda este movimiento antes de añadir otros."; return; }
      lines.push({}); index = lines.length - 1;
    }
    const item = getState().items.find(item => item.id === itemId);
    lines[index] = { itemId: itemId || "", type: "entry", ...(item ? values(item) : {}) };
    render(index); get("movement-title").focus();
  }
  const add = () => {
    if (locked || lines.length >= MAX_OPERATION_PRODUCTS) return;
    lines.push({}); render(lines.length - 1);
  };
  get("movement-add").addEventListener("click", add);
  render();
  let itemSignature = "";
  return {
    read: () => operationInput({ reference: get("movement-reference").value, lines }),
    addProduct,
    reset() { lines = [{}]; get("movement-reference").value = ""; render(); },
    refresh() {
      const signature = getState().items.map(item => `${item.id}:${item.description}`).join("|");
      if (signature !== itemSignature) { itemSignature = signature; render(); }
      for (const node of get("movement-lines").querySelectorAll(".product-hint")) hint(lines[Number(node.dataset.index)], node);
    },
    lock(value) { locked = value; get("movement-fields").disabled = value; get("movement-add").disabled = value || lines.length >= MAX_OPERATION_PRODUCTS; },
    dispose() { get("movement-add").removeEventListener("click", add); lines = [{}]; get("movement-lines").replaceChildren(); get("movement-reference").value = ""; }
  };
}
