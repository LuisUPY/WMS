import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("reader", Path(__file__).parent.parent / "scripts/read-workbook.py")
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class WorkbookReaderTest(unittest.TestCase):
    def workbook(self, stock="12", packages="2", duplicate=False, header="Stock", error=False):
        def text(address, value):
            return f'<c r="{address}" t="inlineStr"><is><t>{value}</t></is></c>'
        def numeric(address, value, formula=""):
            kind = ' t="e"' if error and address == "F3" else ""
            return f'<c r="{address}"{kind}>{formula}' + (f'<v>{value}</v>' if value is not None else "") + '</c>'
        headers = {"C": "Material", "D": "Texto breve de material", "E": "S.Loc. Ubicación", "F": header,
                   "G": "CS CARTONES", "H": "CAR PAQUETES", "I": "CXT", "J": "UMB"}
        cells = text("D1", "ALMACEN") + numeric("I1", "45000", "<f>TODAY()</f>")
        cells += "".join(text(col + "2", label) for col, label in headers.items())
        for row in ([3, 4] if duplicate else [3]):
            cells += text(f"C{row}", "12345678") + text(f"D{row}", "Material de prueba")
            cells += text(f"E{row}", "A101") + text(f"J{row}", "PAC")
            cells += numeric(f"F{row}", stock, "<f>'[1]SAP'!L3</f>")
            cells += numeric(f"G{row}", "1") + numeric(f"H{row}", packages) + numeric(f"I{row}", "0")
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = Path(folder.name) / "fixture.xlsx"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="FISICO - A101" r:id="rId1"/></sheets></workbook>')
            archive.writestr("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
            archive.writestr("xl/worksheets/sheet1.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row>' + cells + '</row></sheetData></worksheet>')
        return path

    def test_saved_values_and_zero_are_preserved_without_date_assumption(self):
        path = self.workbook(stock="0")
        original = path.read_bytes()
        data = reader.read_workbook(path)
        self.assertEqual(data["records"][0]["openingStock"], 0)
        self.assertIsNone(data["sourceAsOf"])
        self.assertTrue(data["dateCellIsTodayFormula"])
        self.assertEqual(original, path.read_bytes())

    def test_excel_residue_is_audited_but_real_fraction_is_rejected(self):
        data = reader.read_workbook(self.workbook(stock="11.999999999998"))
        self.assertEqual(data["records"][0]["openingStock"], 12)
        self.assertEqual(data["numericNormalizations"][0]["savedValue"], "11.999999999998")
        with self.assertRaisesRegex(ValueError, "fraccionaria"):
            reader.read_workbook(self.workbook(stock="11.5"))

    def test_duplicate_keys_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "duplicado"):
            reader.read_workbook(self.workbook(duplicate=True))

    def test_bad_header_missing_cached_value_errors_and_negative_are_rejected(self):
        for options in [{"header": "Otro"}, {"stock": None}, {"stock": "#REF!", "error": True}, {"stock": "-1"}]:
            with self.subTest(options=options), self.assertRaises(ValueError):
                reader.read_workbook(self.workbook(**options))


if __name__ == "__main__":
    unittest.main()
