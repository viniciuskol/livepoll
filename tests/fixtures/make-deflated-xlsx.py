#!/usr/bin/env python3
"""Regenerates tests/fixtures/deflated-two-sheets.xlsx.

The app only ever writes STORED (uncompressed) zip entries, so the round-trip
test never exercised the DEFLATE path of the reader. This fixture is a real
deflated workbook, and its first sheet is hidden so the reader also has to
resolve the first *visible* sheet through workbook.xml + its rels instead of
assuming xl/worksheets/sheet1.xml.
"""
import pathlib
import zipfile

OUT = pathlib.Path(__file__).with_name("deflated-two-sheets.xlsx")

SHARED = [
    "bloco", "tipo", "pergunta", "opcao1", "opcao2", "correta", "tempo_limite", "pontos",
    "Aquecimento", "escolha_multipla", "Qual é a capital do Brasil?", "São Paulo", "Brasília",
    "verdadeiro_falso", "O céu é azul?", "verdadeiro",
]
IDX = {s: i for i, s in enumerate(SHARED)}

ROWS = [
    ["bloco", "tipo", "pergunta", "opcao1", "opcao2", "correta", "tempo_limite", "pontos"],
    ["Aquecimento", "escolha_multipla", "Qual é a capital do Brasil?", "São Paulo", "Brasília", 2, 20, 1000],
    ["Aquecimento", "verdadeiro_falso", "O céu é azul?", None, None, "verdadeiro", 15, 800],
]


def col(i):
    s = ""
    n = i + 1
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def sheet_xml(rows):
    out = []
    for r, row in enumerate(rows, start=1):
        cells = []
        for c, value in enumerate(row):
            if value is None or value == "":
                continue
            ref = f"{col(c)}{r}"
            if isinstance(value, int):
                cells.append(f'<c r="{ref}"><v>{value}</v></c>')
            else:
                cells.append(f'<c r="{ref}" t="s"><v>{IDX[value]}</v></c>')
        out.append(f'<row r="{r}">{"".join(cells)}</row>')
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(out)}</sheetData></worksheet>'
    )


CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
    "</Types>"
)

ROOT_RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    "</Relationships>"
)

# Note the deliberately shuffled rIds: "Leia-me" is hidden and lives in
# sheet1.xml, the real data is the second (first visible) sheet.
WORKBOOK = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
    '<sheet name="Leia-me" sheetId="1" state="hidden" r:id="rId1"/>'
    '<sheet name="Perguntas" sheetId="2" r:id="rId2"/>'
    "</sheets></workbook>"
)

WORKBOOK_RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
    "</Relationships>"
)

SHARED_XML = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    f' count="{len(SHARED)}" uniqueCount="{len(SHARED)}">'
    + "".join(
        f'<si><t xml:space="preserve">{s.replace("&", "&amp;").replace("<", "&lt;")}</t></si>'
        for s in SHARED
    )
    + "</sst>"
)

HIDDEN_SHEET = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    '<row r="1"><c r="A1" t="inlineStr"><is><t>NAO EDITE ESTA ABA</t></is></c></row>'
    "</sheetData></worksheet>"
)


def main():
    with zipfile.ZipFile(OUT, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", ROOT_RELS)
        z.writestr("xl/workbook.xml", WORKBOOK)
        z.writestr("xl/_rels/workbook.xml.rels", WORKBOOK_RELS)
        z.writestr("xl/sharedStrings.xml", SHARED_XML)
        z.writestr("xl/worksheets/sheet1.xml", HIDDEN_SHEET)
        z.writestr("xl/worksheets/sheet2.xml", sheet_xml(ROWS))
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
