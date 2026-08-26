// Minimal XLSX reader + writer. No dependencies.
// Reader: unzips with DecompressionStream('deflate-raw') (also handles STORED
// entries), resolves the first visible sheet through workbook.xml + its rels,
// and parses that worksheet + xl/sharedStrings.xml with regexes.
// Writer: builds a valid zip using STORED (uncompressed) entries only.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- zip reading

function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('DecompressionStream unavailable');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Reads a zip archive into a Map of path -> Uint8Array.
 * @param {ArrayBuffer|Uint8Array} data
 */
export async function unzip(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  // Locate the End Of Central Directory record.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--) {
    if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = u16(bytes, eocd + 10);
  let offset = u32(bytes, eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (u32(bytes, offset) !== 0x02014b50) break;
    const method = u16(bytes, offset + 10);
    const compSize = u32(bytes, offset + 20);
    const nameLen = u16(bytes, offset + 28);
    const extraLen = u16(bytes, offset + 30);
    const commentLen = u16(bytes, offset + 32);
    const localOffset = u32(bytes, offset + 42);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    // Local header: skip its own name + extra fields.
    const lNameLen = u16(bytes, localOffset + 26);
    const lExtraLen = u16(bytes, localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + compSize);
    files.set(name, method === 0 ? raw : await inflateRaw(raw));
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

// --------------------------------------------------------------- xlsx reading

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXmlText(s) {
  return String(s == null ? '' : s).replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (m, g) => {
    if (g[0] === '#') return String.fromCodePoint(g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10));
    return XML_ENTITIES[g] != null ? XML_ENTITIES[g] : m;
  });
}

/** Extracts shared strings from xl/sharedStrings.xml. */
export function parseSharedStrings(xml) {
  const out = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  let m;
  while ((m = siRe.exec(xml)) !== null) {
    const inner = m[1] || '';
    let text = '';
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    while ((t = tRe.exec(inner)) !== null) text += decodeXmlText(t[1]);
    out.push(text);
  }
  return out;
}

/** "B12" -> 1 (0-based column index). */
export function colIndex(ref) {
  const letters = String(ref).match(/^[A-Z]+/i);
  if (!letters) return 0;
  let n = 0;
  for (const ch of letters[0].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Parses a worksheet XML into a matrix of strings. */
export function parseSheet(xml, sharedStrings = []) {
  const rows = [];
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g;
  let rm;
  while ((rm = rowRe.exec(xml)) !== null) {
    const attrs = rm[1] || '';
    const inner = rm[2] || '';
    const rAttr = attrs.match(/\br="(\d+)"/);
    const rowNumber = rAttr ? Number(rAttr[1]) : rows.length + 1;
    const cells = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(inner)) !== null) {
      const cAttrs = cm[1] || '';
      const body = cm[2] || '';
      const refMatch = cAttrs.match(/\br="([A-Z]+\d+)"/i);
      const idx = refMatch ? colIndex(refMatch[1]) : cells.length;
      const typeMatch = cAttrs.match(/\bt="([^"]+)"/);
      const type = typeMatch ? typeMatch[1] : 'n';
      let value = '';
      if (type === 'inlineStr') {
        const t = body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
        value = t ? decodeXmlText(t[1]) : '';
      } else if (type === 's') {
        const v = body.match(/<v>([\s\S]*?)<\/v>/);
        value = v ? sharedStrings[Number(v[1])] || '' : '';
      } else if (type === 'str') {
        const v = body.match(/<v>([\s\S]*?)<\/v>/);
        value = v ? decodeXmlText(v[1]) : '';
      } else {
        const v = body.match(/<v>([\s\S]*?)<\/v>/);
        value = v ? decodeXmlText(v[1]) : '';
      }
      while (cells.length < idx) cells.push('');
      cells[idx] = value;
    }
    while (rows.length < rowNumber - 1) rows.push([]);
    rows[rowNumber - 1] = cells;
  }
  return rows;
}

/** Maps relationship ids to their targets from a .rels part. */
export function parseRels(xml) {
  const map = new Map();
  const re = /<Relationship\b([^>]*)\/?>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1] || '';
    const id = (attrs.match(/\bId="([^"]+)"/) || [])[1];
    const target = (attrs.match(/\bTarget="([^"]+)"/) || [])[1];
    if (id && target) map.set(id, decodeXmlText(target));
  }
  return map;
}

/** Sheet entries declared by xl/workbook.xml, in workbook order. */
export function parseWorkbookSheets(xml) {
  const out = [];
  const re = /<sheet\b([^>]*)\/?>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1] || '';
    out.push({
      name: decodeXmlText((attrs.match(/\bname="([^"]*)"/) || [])[1] || ''),
      sheetId: (attrs.match(/\bsheetId="([^"]*)"/) || [])[1] || '',
      state: ((attrs.match(/\bstate="([^"]*)"/) || [])[1] || 'visible').toLowerCase(),
      rid: (attrs.match(/r:id="([^"]*)"/) || [])[1] || '',
    });
  }
  return out;
}

function normalizeZipPath(target) {
  const clean = String(target).replace(/^\/+/, '');
  if (/^xl\//i.test(clean)) return clean;
  return `xl/${clean.replace(/^\.\//, '')}`;
}

/**
 * Resolves the path of the first *visible* worksheet through
 * xl/workbook.xml + xl/_rels/workbook.xml.rels, instead of assuming
 * xl/worksheets/sheet1.xml (which is not the first sheet in files written by
 * Excel/LibreOffice when sheets were reordered, renamed or hidden).
 */
export function resolveFirstSheetPath(files) {
  const decoder = new TextDecoder();
  const findKey = (re) => [...files.keys()].find((k) => re.test(k));
  const workbookKey = findKey(/^xl\/workbook\.xml$/i);
  if (workbookKey) {
    const sheets = parseWorkbookSheets(decoder.decode(files.get(workbookKey)));
    const relsKey = findKey(/^xl\/_rels\/workbook\.xml\.rels$/i);
    const rels = relsKey ? parseRels(decoder.decode(files.get(relsKey))) : new Map();
    const visible = sheets.filter((sh) => sh.state !== 'hidden' && sh.state !== 'veryhidden');
    for (const sheet of visible.length ? visible : sheets) {
      const target = sheet.rid && rels.get(sheet.rid);
      if (!target) continue;
      const path = normalizeZipPath(target);
      const key = [...files.keys()].find((k) => k.toLowerCase() === path.toLowerCase());
      if (key) return key;
    }
  }
  return findKey(/^xl\/worksheets\/sheet1\.xml$/i) || findKey(/^xl\/worksheets\/.*\.xml$/i) || null;
}

/**
 * Reads the first visible worksheet of an .xlsx file into a matrix of strings.
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {Promise<string[][]>}
 */
export async function readXlsx(data) {
  const files = await unzip(data);
  const decoder = new TextDecoder();
  const sharedName = [...files.keys()].find((k) => /^xl\/sharedStrings\.xml$/i.test(k));
  const shared = sharedName ? parseSharedStrings(decoder.decode(files.get(sharedName))) : [];
  const sheetName = resolveFirstSheetPath(files);
  if (!sheetName) throw new Error('No worksheet found in workbook');
  return parseSheet(decoder.decode(files.get(sheetName)), shared);
}

// --------------------------------------------------------------- xlsx writing

export function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colName(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheetXml(matrix) {
  const rows = matrix.map((row, r) => {
    const cells = (row || []).map((cell, c) => {
      const value = cell == null ? '' : String(cell);
      if (value === '') return '';
      return `<c r="${colName(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

function workbookXml(sheetTitle) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetTitle).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
}

/** Builds a zip archive (STORED entries) from [{name, data:Uint8Array}]. */
export function zipStore(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const enc = new TextEncoder();
  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const data = entry.data;
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);      // version needed
    lv.setUint16(6, 0, true);       // flags
    lv.setUint16(8, 0, true);       // method: stored
    lv.setUint16(10, 0, true);      // time
    lv.setUint16(12, 0x21, true);   // date (1996-01-01)
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    chunks.push(local, data);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);
    offset += local.length + data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const all = [...chunks, ...central, eocd];
  const total = all.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

/**
 * Builds a single-sheet .xlsx file from a matrix of values.
 * @param {Array<Array<string|number>>} matrix
 * @param {string} [sheetTitle]
 * @returns {Uint8Array}
 */
export function writeXlsx(matrix, sheetTitle = 'Sheet1') {
  const enc = new TextEncoder();
  return zipStore([
    { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: enc.encode(ROOT_RELS) },
    { name: 'xl/workbook.xml', data: enc.encode(workbookXml(sheetTitle)) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(WORKBOOK_RELS) },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheetXml(matrix)) },
  ]);
}
