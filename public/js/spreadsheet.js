// Browser-side spreadsheet reading (.csv / .xlsx) and template generation.
import { parseCSV, toCSV } from './shared/csv.js';
import { readXlsx, writeXlsx } from './shared/xlsx.js';
import { raw, t } from './i18n.js';

/** Reads a user-picked file into a matrix of strings. */
export async function readSpreadsheetFile(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
    const buf = await file.arrayBuffer();
    return readXlsx(buf);
  }
  if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt') || file.type === 'text/csv') {
    const text = await file.text();
    return parseCSV(text);
  }
  const err = new Error(t('err.unsupported_file'));
  err.i18nKey = 'err.unsupported_file';
  throw err;
}

/** Localized template matrix (header row + example rows). */
export function templateMatrix() {
  const headers = raw('template.headers');
  const rows = raw('template.rows');
  return [Array.isArray(headers) ? headers : [], ...(Array.isArray(rows) ? rows : [])];
}

export function templateCsvBlob() {
  const csv = `﻿${toCSV(templateMatrix())}`;
  return new Blob([csv], { type: 'text/csv;charset=utf-8' });
}

export function templateXlsxBlob() {
  const bytes = writeXlsx(templateMatrix(), String(raw('template.sheet') || 'Questions'));
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
