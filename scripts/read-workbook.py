"""Read saved XLSX values without recalculating formulas or following external links."""
import argparse
import hashlib
import json
import re
import zipfile
from decimal import Decimal, InvalidOperation
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_ID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def read_workbook(path):
    raw = Path(path).read_bytes()
    with zipfile.ZipFile(path) as archive:
        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = ["".join(t.text or "" for t in item.findall(".//m:t", NS))
                       for item in ET.fromstring(archive.read("xl/sharedStrings.xml"))]
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        sheets = workbook.find("m:sheets", NS)
        sheet = next((s for s in sheets if s.get("name") == "FISICO - A101"), None)
        if sheet is None:
            raise ValueError("Falta la hoja FISICO - A101.")
        targets = {r.get("Id"): r.get("Target") for r in
                   ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))}
        target = targets[sheet.get(REL_ID)]
        target = target.lstrip("/") if target.startswith("/") else "xl/" + target
        root = ET.fromstring(archive.read(target))
        cells, formulas = {}, {}
        for cell in root.findall("m:sheetData/m:row/m:c", NS):
            address, kind = cell.get("r"), cell.get("t")
            value = cell.find("m:v", NS)
            value = value.text if value is not None else None
            if kind == "s" and value is not None:
                value = strings[int(value)]
            elif kind == "inlineStr":
                value = "".join(t.text or "" for t in cell.findall("m:is//m:t", NS))
            if kind == "e":
                raise ValueError(f"Error guardado en {address}: {value}")
            cells[address] = value
            formula = cell.find("m:f", NS)
            if formula is not None:
                formulas[address] = formula.text or ""

        expected = {"C2": "Material", "D2": "Texto breve de material",
                    "E2": "S.Loc. Ubicación", "F2": "Stock", "G2": "CS CARTONES",
                    "H2": "CAR PAQUETES", "I2": "CXT", "J2": "UMB"}
        for address, label in expected.items():
            if str(cells.get(address, "")).strip() != label:
                raise ValueError(f"Encabezado inesperado en {address}; se esperaba {label}.")

        normalizations = []

        def integer(address):
            try:
                number = Decimal(cells.get(address) or "NaN")
            except InvalidOperation:
                raise ValueError(f"Cantidad inválida en {address}.") from None
            if not number.is_finite() or number < 0 or number > 9007199254740991:
                raise ValueError(f"Se requiere una cantidad entera no negativa en {address}.")
            whole = number.to_integral_value()
            # Excel floating-point residue is preserved in the import audit.
            # Actual fractional stock is rejected, never silently rounded.
            if abs(number - whole) > Decimal("0.00000001"):
                raise ValueError(f"Cantidad fraccionaria no aprobada en {address}.")
            if number != whole:
                normalizations.append({"cell": address, "savedValue": str(number), "importedValue": int(whole)})
            return int(whole)

        records, seen = [], set()
        row_numbers = sorted({int(re.search(r"\d+$", addr)[0]) for addr in cells if addr.startswith("C")})
        for row in row_numbers:
            if row < 3:
                continue
            if not any(cells.get(f"{col}{row}") is not None for col in "CDEFJ"):
                continue
            sku = str(cells.get(f"C{row}") or "").strip()
            warehouse = str(cells.get(f"E{row}") or "").strip()
            unit = str(cells.get(f"J{row}") or "").strip()
            description = str(cells.get(f"D{row}") or "").strip()
            if not re.fullmatch(r"[0-9]{1,20}", sku) or warehouse != "A101" or unit not in ("PAC", "CAR") or not description:
                raise ValueError(f"Identidad, almacén o unidad inválidos en la fila {row}.")
            key = warehouse + "__" + sku
            if key in seen:
                raise ValueError(f"Material duplicado: {key}.")
            seen.add(key)
            records.append({"id": key, "sku": sku, "description": description,
                            "warehouse": warehouse, "unit": unit, "openingStock": integer(f"F{row}"),
                            "alternateCode": str(cells.get(f"B{row}") or ""), "sourceRow": row,
                            "openingPackages": {"cs": integer(f"G{row}"), "car": integer(f"H{row}"), "cxt": integer(f"I{row}")}})
        if not records or len(records) > 400:
            raise ValueError("La carga inicial debe contener entre 1 y 400 materiales.")
        totals = {}
        for record in records:
            totals[record["unit"]] = totals.get(record["unit"], 0) + record["openingStock"]
        return {"schemaVersion": 1, "sourceFile": Path(path).name,
                "sourceSheet": sheet.get("name"), "sourceSha256": hashlib.sha256(raw).hexdigest(),
                "sourceAsOf": None, "approvalStatus": "pending", "stockScope": "total-unclassified",
                "dateCellIsTodayFormula": formulas.get("I1", "").upper() == "TODAY()",
                "formulaCount": len(formulas), "numericNormalizations": normalizations, "totalsByUnit": totals,
                "recordCount": len(records), "records": records}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("file")
    args = parser.parse_args()
    try:
        print(json.dumps(read_workbook(args.file), ensure_ascii=False))
    except (ValueError, KeyError, zipfile.BadZipFile, OSError) as error:
        parser.exit(1, f"No se pudo leer el libro: {error}\n")
