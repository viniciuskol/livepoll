// Room code + token generation. No ambiguous characters (no 0,1,O,I,L).
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

function randomBytes(n) {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

/** Generates a room code of CODE_LENGTH chars from CODE_ALPHABET. */
export function generateRoomCode(rand = randomBytes) {
  const bytes = rand(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

/** True when a string is a syntactically valid room code. */
export function isValidRoomCode(code) {
  if (typeof code !== 'string' || code.length !== CODE_LENGTH) return false;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return false;
  return true;
}

/** Normalizes user input (lowercase/spaces) into a candidate room code. */
export function normalizeRoomCode(input) {
  return String(input || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function generateToken(bytes = 24) {
  const b = randomBytes(bytes);
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

// 100k is the ceiling Workers' WebCrypto enforces on PBKDF2; asking for more
// throws at deriveBits() rather than degrading, so this is a hard limit.
export const PBKDF2_ITERATIONS = 100000;
const PBKDF2_HASH = 'SHA-256';
const PBKDF2_BITS = 256;

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Derives a password hash. Format: `salt$pbkdf2$iterations$hex`.
 * A single SHA-256 round is far too cheap for an offline guess of a 4-char
 * room password, so PBKDF2-HMAC-SHA256 is used with the same per-room salt.
 */
export async function hashPassword(password, salt, iterations = PBKDF2_ITERATIONS) {
  const useSalt = salt || generateToken(8);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(useSalt), iterations, hash: PBKDF2_HASH },
    key,
    PBKDF2_BITS
  );
  return `${useSalt}$pbkdf2$${iterations}$${toHex(bits)}`;
}

/** Legacy cycle-1 format (`salt$sha256hex`), kept so old rooms still open. */
export async function hashPasswordLegacy(password, salt) {
  const useSalt = salt || generateToken(8);
  const data = new TextEncoder().encode(`${useSalt}:${password}`);
  return `${useSalt}$${toHex(await crypto.subtle.digest('SHA-256', data))}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.includes('$')) return false;
  const parts = stored.split('$');
  const salt = parts[0];
  if (parts[1] === 'pbkdf2') {
    const iterations = Number(parts[2]);
    if (!Number.isFinite(iterations) || iterations < 1000) return false;
    const again = await hashPassword(password, salt, iterations);
    return timingSafeEqual(again, stored);
  }
  const again = await hashPasswordLegacy(password, salt);
  return timingSafeEqual(again, stored);
}

export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
