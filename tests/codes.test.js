import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateRoomCode, isValidRoomCode, normalizeRoomCode, CODE_ALPHABET, CODE_LENGTH,
  generateToken, hashPassword, hashPasswordLegacy, verifyPassword, timingSafeEqual, PBKDF2_ITERATIONS,
} from '../src/worker/lib/codes.js';

test('room codes are 6 chars from the unambiguous alphabet', () => {
  for (let i = 0; i < 500; i++) {
    const code = generateRoomCode();
    assert.equal(code.length, CODE_LENGTH);
    assert.ok(isValidRoomCode(code), `invalid code ${code}`);
    assert.ok(!/[01OIL]/.test(code), `ambiguous char in ${code}`);
  }
});

test('the alphabet excludes ambiguous characters', () => {
  assert.equal(CODE_ALPHABET.length, 31);
  ['0', '1', 'O', 'I', 'L'].forEach((ch) => assert.ok(!CODE_ALPHABET.includes(ch)));
});

test('generated codes are reasonably spread out', () => {
  const seen = new Set();
  for (let i = 0; i < 300; i++) seen.add(generateRoomCode());
  assert.ok(seen.size > 290, `too many collisions: ${seen.size}`);
});

test('isValidRoomCode rejects malformed input', () => {
  assert.equal(isValidRoomCode('ABC12'), false);
  assert.equal(isValidRoomCode('abcdef'), false);
  assert.equal(isValidRoomCode('ABC1DE'), false, '1 is not in the alphabet');
  assert.equal(isValidRoomCode(null), false);
});

test('normalizeRoomCode uppercases and strips separators', () => {
  assert.equal(normalizeRoomCode(' ab-c23 '), 'ABC23');
  assert.equal(normalizeRoomCode(null), '');
});

test('tokens are long random hex strings', () => {
  const a = generateToken(24);
  assert.match(a, /^[0-9a-f]{48}$/);
  assert.notEqual(a, generateToken(24));
});

test('password hashing round-trips and rejects wrong passwords', async () => {
  const stored = await hashPassword('secret1');
  assert.match(stored, /^[0-9a-f]+\$pbkdf2\$\d+\$[0-9a-f]{64}$/);
  assert.equal(await verifyPassword('secret1', stored), true);
  assert.equal(await verifyPassword('secret2', stored), false);
  assert.equal(await verifyPassword('secret1', 'garbage'), false);
  const other = await hashPassword('secret1');
  assert.notEqual(stored, other, 'salted');
});

test('password hashing uses PBKDF2 with many iterations', async () => {
  const stored = await hashPassword('secret1');
  const iterations = Number(stored.split('$')[2]);
  assert.ok(iterations >= 100000, `iterations too low: ${iterations}`);
  assert.equal(PBKDF2_ITERATIONS, iterations);
  // A hash with an implausibly low iteration count is rejected outright.
  const salt = stored.split('$')[0];
  const weak = await hashPassword('secret1', salt, 10);
  assert.equal(await verifyPassword('secret1', weak), false);
});

test('legacy sha256 hashes from cycle 1 still verify', async () => {
  const legacy = await hashPasswordLegacy('secret1', 'abcd1234');
  assert.match(legacy, /^[0-9a-f]+\$[0-9a-f]{64}$/);
  assert.equal(await verifyPassword('secret1', legacy), true);
  assert.equal(await verifyPassword('nope', legacy), false);
});

test('timingSafeEqual compares without throwing on odd input', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'abcd'), false);
  assert.equal(timingSafeEqual('abc', null), false);
  assert.equal(timingSafeEqual(undefined, undefined), false);
});
