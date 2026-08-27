// Tiny i18n runtime: JSON dictionaries, {var} interpolation, data-i18n binding.
export const LANGS = ['en', 'es', 'pt'];
const STORAGE_KEY = 'livepoll.lang';
const dictionaries = {};
let current = 'en';
const listeners = new Set();

export function detectLang() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && LANGS.includes(stored)) return stored;
  const candidates = [navigator.language, ...(navigator.languages || [])].filter(Boolean);
  for (const c of candidates) {
    const short = String(c).slice(0, 2).toLowerCase();
    if (LANGS.includes(short)) return short;
  }
  return 'en';
}

async function load(lang) {
  if (dictionaries[lang]) return dictionaries[lang];
  const res = await fetch(`/i18n/${lang}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Missing dictionary ${lang}`);
  dictionaries[lang] = await res.json();
  return dictionaries[lang];
}

export function currentLang() { return current; }

/** Raw value at a dot path (may be object/array), falling back to English. */
export function raw(key) {
  const walk = (dict) => String(key).split('.').reduce((acc, part) => (acc == null ? undefined : acc[part]), dict);
  const value = walk(dictionaries[current]);
  return value === undefined ? walk(dictionaries.en) : value;
}

/** `<key>_one` / `<key>_other` when a count is given, else the plain key. */
function plural(key, vars) {
  if (vars && vars.count !== undefined) {
    const n = Number(vars.count);
    const variant = raw(`${key}${Math.abs(n) === 1 ? '_one' : '_other'}`);
    if (typeof variant === 'string') return variant;
  }
  return raw(key);
}

/**
 * Translated string with {placeholder} interpolation and plural selection.
 *
 * A string given a `count` looks for `<key>_one` / `<key>_other` first, so a
 * dictionary can spell both forms out instead of projecting "1 perguntas neste
 * bloco" at 82px on a wall. Keys with no variants fall through to the plain
 * key, so nothing that does not need a plural has to declare one. English rules
 * pick the bucket; es and pt agree with English on the 1/not-1 split, which is
 * the only distinction any string in this app needs.
 */
export function t(key, vars) {
  const value = plural(key, vars);
  if (typeof value !== 'string') return String(key);
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (m, name) => (vars[name] === undefined ? m : String(vars[name])));
}

/** Applies translations to every [data-i18n*] node inside root. */
export function apply(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'), datasetVars(el));
  });
  const attrs = [
    ['data-i18n-placeholder', 'placeholder'],
    ['data-i18n-aria-label', 'aria-label'],
    ['data-i18n-title', 'title'],
    ['data-i18n-value', 'value'],
  ];
  attrs.forEach(([dataAttr, target]) => {
    root.querySelectorAll(`[${dataAttr}]`).forEach((el) => {
      el.setAttribute(target, t(el.getAttribute(dataAttr), datasetVars(el)));
    });
  });
  document.documentElement.lang = current;
}

function datasetVars(el) {
  const json = el.getAttribute('data-i18n-vars');
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

export async function setLang(lang) {
  const next = LANGS.includes(lang) ? lang : 'en';
  await load(next);
  current = next;
  localStorage.setItem(STORAGE_KEY, next);
  apply(document);
  listeners.forEach((fn) => fn(next));
}

export function onLangChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function initI18n() {
  await load('en');
  await setLang(detectLang());
  document.querySelectorAll('[data-lang-switch]').forEach(mountLangSwitcher);
  return current;
}

/** Renders the language buttons inside a container element. */
export function mountLangSwitcher(container) {
  container.classList.add('lang-switch');
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', t('lang.label'));
  container.innerHTML = '';
  LANGS.forEach((lang) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = lang.toUpperCase();
    btn.title = t(`lang.${lang}`);
    btn.setAttribute('aria-label', t(`lang.${lang}`));
    btn.setAttribute('aria-pressed', String(lang === current));
    btn.addEventListener('click', () => setLang(lang));
    container.appendChild(btn);
  });
  onLangChange(() => {
    container.setAttribute('aria-label', t('lang.label'));
    [...container.children].forEach((btn, i) => {
      btn.setAttribute('aria-pressed', String(LANGS[i] === current));
      btn.title = t(`lang.${LANGS[i]}`);
      btn.setAttribute('aria-label', t(`lang.${LANGS[i]}`));
    });
  });
}
