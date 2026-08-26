// Shared helpers for the i18n tests.
import { readFileSync } from 'node:fs';

export const LANGS_EXPECTED = ['en', 'es', 'pt'];

export function dict(lang) {
  return JSON.parse(readFileSync(new URL(`../../public/i18n/${lang}.json`, import.meta.url), 'utf8'));
}

/** Flattens nested objects into a Map of dot-path -> value (arrays kept whole). */
export function flatten(obj, prefix = '', out = new Map()) {
  Object.entries(obj).forEach(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, path, out);
    else out.set(path, value);
  });
  return out;
}
