// Robust CSV/TSV parser (RFC4180-ish): quoted fields, escaped quotes, CRLF, BOM.
// Pure ESM - shared by the browser and unit tests.

/** Detects the most likely delimiter of a CSV text. */
export function detectDelimiter(text) {
  const sample = String(text || '').split(/\r?\n/).slice(0, 5).join('\n');
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = -1;
  for (const d of candidates) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < sample.length; i++) {
      const ch = sample[i];
      if (ch === '"') {
        if (inQuotes && sample[i + 1] === '"') { i++; continue; }
        inQuotes = !inQuotes;
      } else if (ch === d && !inQuotes) count++;
    }
    if (count > bestCount) { bestCount = count; best = d; }
  }
  return best;
}

/**
 * Parses CSV text into a matrix of strings.
 * @param {string} text
 * @param {string} [delimiter] auto-detected when omitted
 * @returns {string[][]}
 */
export function parseCSV(text, delimiter) {
  let src = String(text == null ? '' : text);
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const d = delimiter || detectDelimiter(src);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === d) { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') {
      if (src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = ''; i++; continue;
    }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  row.push(field);
  rows.push(row);
  // Drop a trailing empty line artifact.
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
  return rows;
}

/** Serializes a matrix into CSV text with CRLF line endings. */
export function toCSV(matrix, delimiter = ',') {
  return (matrix || [])
    .map((row) => (row || [])
      .map((cell) => {
        const s = cell == null ? '' : String(cell);
        return /["\r\n]|^\s|\s$/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(delimiter))
    .join('\r\n');
}
