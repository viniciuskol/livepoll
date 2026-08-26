import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, toCSV, detectDelimiter } from '../public/js/shared/csv.js';
import { readFileSync } from 'node:fs';
import {
  readXlsx, writeXlsx, parseSharedStrings, parseSheet, colIndex, crc32,
  unzip, resolveFirstSheetPath, parseWorkbookSheets, parseRels,
} from '../public/js/shared/xlsx.js';
import { matrixToRows, validateRows } from '../src/worker/lib/validation.js';

test('parseCSV handles quoted fields, escaped quotes and embedded newlines', () => {
  const csv = 'a,b,c\r\n1,"he said ""hi""",3\r\n"multi\nline",x,"trailing space "';
  assert.deepEqual(parseCSV(csv), [
    ['a', 'b', 'c'],
    ['1', 'he said "hi"', '3'],
    ['multi\nline', 'x', 'trailing space '],
  ]);
});

test('parseCSV strips the BOM and drops trailing blank lines', () => {
  assert.deepEqual(parseCSV('﻿a,b\r\n1,2\r\n\r\n'), [['a', 'b'], ['1', '2']]);
});

test('parseCSV keeps empty fields and drops fully blank trailing rows', () => {
  assert.deepEqual(parseCSV('a,,c\n,,x'), [['a', '', 'c'], ['', '', 'x']]);
  assert.deepEqual(parseCSV('a,,c\n,,'), [['a', '', 'c']]);
});

test('delimiter detection supports semicolons and tabs', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(detectDelimiter('a\tb\n1\t2'), '\t');
  assert.equal(detectDelimiter('a,b\n1,2'), ',');
  assert.deepEqual(parseCSV('a;b\n"x;y";2'), [['a', 'b'], ['x;y', '2']]);
});

test('toCSV quotes only what needs quoting and round-trips', () => {
  const matrix = [['a', 'b,c', 'say "hi"'], ['1', 'line\nbreak', '']];
  const csv = toCSV(matrix);
  assert.ok(csv.includes('"b,c"'));
  assert.deepEqual(parseCSV(csv), matrix);
});

test('a template-shaped CSV validates end to end', () => {
  const csv = [
    'block,type,question,option1,option2,option3,correct,time_limit,points',
    'Warm up,multiple_choice,"Which is 2+2?",3,4,5,2,20,1000',
    'Warm up,open_text,"Capital of France?",,,,Paris|paris,30,1000',
  ].join('\n');
  const { rows } = matrixToRows(parseCSV(csv));
  const res = validateRows(rows);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.questions.length, 2);
  assert.equal(res.questions[0].options[1].correct, true);
});

test('crc32 matches the well known check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('writeXlsx output can be read back by readXlsx', async () => {
  const matrix = [['block', 'type', 'question'], ['B1', 'mc', 'Olá & <b>2+2</b>?'], ['B1', 'open_text', 'Ok']];
  const bytes = writeXlsx(matrix, 'Questions');
  assert.equal(bytes[0], 0x50, 'zip magic');
  assert.equal(bytes[1], 0x4b);
  const back = await readXlsx(bytes);
  assert.deepEqual(back, matrix);
});

test('readXlsx tolerates gaps, numeric cells and shared strings', () => {
  const shared = parseSharedStrings('<sst><si><t>Bloco 1</t></si><si><r><t>Qual </t></r><r><t>cidade?</t></r></si></sst>');
  assert.deepEqual(shared, ['Bloco 1', 'Qual cidade?']);
  const sheet = parseSheet(
    '<worksheet><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
    '<row r="3"><c r="B3"><v>42</v></c><c r="C3" t="inlineStr"><is><t>x &amp; y</t></is></c></row>' +
    '</sheetData></worksheet>',
    shared
  );
  assert.deepEqual(sheet, [['Bloco 1', '', 'Qual cidade?'], [], ['', '42', 'x & y']]);
});

test('colIndex maps spreadsheet references to zero-based columns', () => {
  assert.equal(colIndex('A1'), 0);
  assert.equal(colIndex('B12'), 1);
  assert.equal(colIndex('Z9'), 25);
  assert.equal(colIndex('AA1'), 26);
});

test('a written xlsx round-trips through validation', async () => {
  const matrix = [
    ['bloco', 'tipo', 'pergunta', 'opcao1', 'opcao2', 'correta', 'tempo_limite', 'pontos'],
    ['Aquecimento', 'escolha_multipla', 'Quanto e 2+2?', '3', '4', '2', '20', '1000'],
    ['Aquecimento', 'verdadeiro_falso', 'O ceu e azul?', '', '', 'verdadeiro', '15', '800'],
  ];
  const back = await readXlsx(writeXlsx(matrix));
  const res = validateRows(matrixToRows(back).rows);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.questions[1].type, 'true_false');
});

test('a real deflated workbook is read from its first visible sheet', async () => {
  // Committed fixture built by tests/fixtures/make-deflated-xlsx.py: every entry
  // is DEFLATE-compressed (the app itself only ever writes STORED entries) and
  // the first sheet in the file is a hidden "Leia-me" tab.
  const bytes = new Uint8Array(readFileSync(new URL('./fixtures/deflated-two-sheets.xlsx', import.meta.url)));
  const files = await unzip(bytes);
  assert.ok(files.has('xl/worksheets/sheet2.xml'));
  assert.equal(resolveFirstSheetPath(files), 'xl/worksheets/sheet2.xml', 'the hidden sheet must be skipped');

  const matrix = await readXlsx(bytes);
  assert.deepEqual(matrix[0], ['bloco', 'tipo', 'pergunta', 'opcao1', 'opcao2', 'correta', 'tempo_limite', 'pontos']);
  assert.equal(matrix[1][2], 'Qual é a capital do Brasil?', 'accents survived the shared-string table');
  const info = matrixToRows(matrix);
  const res = validateRows(info.rows, info);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.questions.length, 2);
  assert.equal(res.questions[0].options[1].text, 'Brasília');
  assert.equal(res.questions[0].options[1].correct, true);
  assert.equal(res.questions[1].type, 'true_false');
});

test('workbook.xml and its rels are parsed into sheets and targets', () => {
  const sheets = parseWorkbookSheets(
    '<workbook><sheets><sheet name="Hidden" sheetId="1" state="hidden" r:id="rId1"/>' +
    '<sheet name="Data" sheetId="2" r:id="rId7"/></sheets></workbook>'
  );
  assert.deepEqual(sheets.map((s) => [s.name, s.state, s.rid]), [['Hidden', 'hidden', 'rId1'], ['Data', 'visible', 'rId7']]);
  const rels = parseRels('<Relationships><Relationship Id="rId7" Target="worksheets/other.xml"/></Relationships>');
  assert.equal(rels.get('rId7'), 'worksheets/other.xml');
  // Absolute targets and unusual sheet file names both resolve.
  const files = new Map([
    ['xl/workbook.xml', new TextEncoder().encode('<workbook><sheets><sheet name="D" sheetId="1" r:id="rId1"/></sheets></workbook>')],
    ['xl/_rels/workbook.xml.rels', new TextEncoder().encode('<Relationships><Relationship Id="rId1" Target="/xl/worksheets/perguntas.xml"/></Relationships>')],
    ['xl/worksheets/perguntas.xml', new TextEncoder().encode('<worksheet/>')],
  ]);
  assert.equal(resolveFirstSheetPath(files), 'xl/worksheets/perguntas.xml');
});
