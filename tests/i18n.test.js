import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { LANGS_EXPECTED, flatten, dict } from './helpers/i18n-helpers.js';

test('the three dictionaries exist', () => {
  const files = readdirSync(new URL('../public/i18n/', import.meta.url));
  LANGS_EXPECTED.forEach((lang) => assert.ok(files.includes(`${lang}.json`), `missing ${lang}.json`));
});

test('all dictionaries share exactly the same keys', () => {
  const en = flatten(dict('en'));
  LANGS_EXPECTED.filter((l) => l !== 'en').forEach((lang) => {
    const other = flatten(dict(lang));
    const missing = [...en.keys()].filter((k) => !other.has(k));
    const extra = [...other.keys()].filter((k) => !en.has(k));
    assert.deepEqual(missing, [], `${lang} is missing keys`);
    assert.deepEqual(extra, [], `${lang} has extra keys`);
  });
});

test('no dictionary value is empty and placeholders match English', () => {
  const en = flatten(dict('en'));
  LANGS_EXPECTED.forEach((lang) => {
    const other = flatten(dict(lang));
    for (const [key, value] of other) {
      assert.notEqual(String(value).trim(), '', `${lang}.${key} is empty`);
      const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      assert.deepEqual(vars(value), vars(en.get(key)), `${lang}.${key} placeholders differ`);
    }
  });
});

test('every error code used by the worker has a translation', () => {
  const en = flatten(dict('en'));
  const codes = ['ROOM_NOT_FOUND', 'BAD_PASSWORD', 'NICKNAME_TAKEN', 'ROOM_FULL', 'ALREADY_ANSWERED',
    'TIME_UP', 'UNAUTHORIZED', 'VALIDATION_ERROR', 'BAD_STATE', 'NOT_FOUND', 'INTERNAL'];
  codes.forEach((code) => assert.ok(en.has(`err.${code}`), `missing err.${code}`));
});

test('validation error codes emitted by the validator are translated', () => {
  const en = flatten(dict('en'));
  const source = readFileSync(new URL('../public/js/shared/quiz-validate.js', import.meta.url), 'utf8');
  const used = [...source.matchAll(/'(err\.[a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(used.length > 5);
  [...new Set(used)].forEach((code) => assert.ok(en.has(code), `missing translation for ${code}`));
});

test('the localized template has 8 rows covering all four question types', () => {
  LANGS_EXPECTED.forEach((lang) => {
    const d = dict(lang);
    assert.ok(Array.isArray(d.template.headers));
    assert.equal(d.template.rows.length, 8);
    const blocks = new Set(d.template.rows.map((r) => r[0]));
    assert.equal(blocks.size, 2, `${lang} should use 2 blocks`);
    assert.equal(d.template.headers.length, d.template.rows[0].length, `${lang} row width`);
  });
});

const DIACRITICS = /[À-ſ]/; // Latin-1 Supplement + Latin Extended-A
const strings = (lang) => [...flatten(dict(lang)).entries()]
  .flatMap(([key, value]) => (Array.isArray(value)
    ? value.flat().map((v, i) => [`${key}[${i}]`, String(v)])
    : [[key, String(value)]]));

test('pt and es actually use their diacritics', () => {
  ['pt', 'es'].forEach((lang) => {
    const all = strings(lang);
    const accented = all.filter(([, v]) => DIACRITICS.test(v));
    assert.ok(accented.length > 40, `${lang} has only ${accented.length} accented strings`);
    // Words that are simply wrong without their accents.
    const mustBeAccented = {
      pt: ['index.code_label', 'play.you_are', 'panel.final_title', 'type.multiple_choice', 'host.step_settings', 'panel.save_grades', 'lb.you'],
      es: ['index.code_label', 'host.file_label', 'host.password_label', 'panel.explanation', 'type.multiple_choice'],
    }[lang];
    mustBeAccented.forEach((key) => {
      const value = flatten(dict(lang)).get(key);
      assert.ok(DIACRITICS.test(String(value)), `${lang}.${key} lost its diacritics: "${value}"`);
    });
  });
});

test('spanish questions and exclamations use the opening marks', () => {
  const es = strings('es');
  const questions = es.filter(([, v]) => v.trim().endsWith('?'));
  const exclamations = es.filter(([, v]) => v.trim().endsWith('!'));
  assert.ok(questions.length > 0 && exclamations.length > 0);
  questions.forEach(([key, v]) => assert.ok(v.includes('¿'), `es.${key} is missing the opening question mark: "${v}"`));
  exclamations.forEach(([key, v]) => assert.ok(v.includes('¡'), `es.${key} is missing the opening exclamation mark: "${v}"`));
});

test('language names are written in their own language', () => {
  LANGS_EXPECTED.forEach((lang) => {
    const d = flatten(dict(lang));
    assert.equal(d.get('lang.es'), 'Español', `${lang}.lang.es`);
    assert.equal(d.get('lang.pt'), 'Português', `${lang}.lang.pt`);
    assert.equal(d.get('lang.en'), 'English', `${lang}.lang.en`);
  });
});

test('no dictionary value (including template cells) is blank', () => {
  LANGS_EXPECTED.forEach((lang) => {
    for (const [key, value] of flatten(dict(lang))) {
      if (Array.isArray(value)) {
        assert.ok(value.length > 0, `${lang}.${key} is an empty array`);
        continue;
      }
      assert.notEqual(String(value).trim(), '', `${lang}.${key} is blank`);
    }
  });
});

test('every text-bearing element in the pages is bound with data-i18n', () => {
  ['index.html', 'host.html', 'play.html'].forEach((page) => {
    const html = readFileSync(new URL(`../public/${page}`, import.meta.url), 'utf8');
    const offenders = [];
    for (const m of html.matchAll(/<([a-z0-9]+)([^>]*)>([^<>]*[A-Za-z]{4,}[^<>]*)<\//g)) {
      const [, tag, attrs, text] = m;
      if (tag === 'title') continue;
      if (/data-i18n/.test(attrs)) continue;
      if (text.trim() === 'LivePoll') continue; // brand name, identical in every language
      offenders.push(`${tag}: ${text.trim()}`);
    }
    assert.deepEqual(offenders, [], `${page} has UI text that is not bound to a translation key`);
  });
});
