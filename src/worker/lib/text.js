// User-supplied text hardening (nicknames, open answers).
// Runs in the Worker and in the unit tests: no DOM, no D1.

export const MAX_NICKNAME = 20;

// C0/C1 control characters (includes tab, newline, DEL). Written with escapes so
// the source file itself stays plain ASCII.
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f]', 'g');
// Soft hyphen, zero-width space, BOM, directional marks and the bidi
// embedding/override/isolate controls (U+202A..U+202E, U+2066..U+2069) used to
// spoof leaderboard entries.
// U+200C/U+200D are deliberately NOT stripped: the zero-width joiner holds
// multi-codepoint emoji together and the non-joiner is a real letter-shaping
// character in Persian and several Indic scripts.
const INVISIBLE = new RegExp('[\\u00ad\\u180e\\u200b\\u200e\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u206f\\ufeff\\ufff9-\\ufffb]', 'g');
// Characters that only exist in a nickname to smuggle markup.
const MARKUP = /[<>&"'`\\]/g;

/** Splits a string into user-perceived characters (grapheme clusters). */
export function graphemes(s) {
  const str = String(s == null ? '' : s);
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(str)].map((x) => x.segment);
  }
  return [...str];
}

/** Truncates to `max` grapheme clusters (never splits an emoji or an accent). */
export function truncateGraphemes(s, max) {
  const parts = graphemes(s);
  return parts.length <= max ? parts.join('') : parts.slice(0, max).join('');
}

/**
 * Normalizes a nickname: strips control/bidi/zero-width characters and markup,
 * collapses whitespace and caps the length by grapheme cluster.
 */
export function sanitizeNickname(raw, max = MAX_NICKNAME) {
  const cleaned = String(raw == null ? '' : raw)
    .normalize('NFC')
    .replace(CONTROL, ' ')
    .replace(INVISIBLE, '')
    .replace(MARKUP, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return truncateGraphemes(cleaned, max).trim();
}

/** Same hardening for free-text answers, which keep their punctuation. */
export function sanitizeAnswerText(raw, max = 200) {
  const cleaned = String(raw == null ? '' : raw)
    .normalize('NFC')
    .replace(CONTROL, ' ')
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .trim();
  return truncateGraphemes(cleaned, max).trim();
}
