import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeQR } from '../public/js/qr.js';

const isFinder = (m, r, c) => {
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 7; j++) {
      const ring = Math.max(Math.abs(i - 3), Math.abs(j - 3));
      const expected = ring !== 2;
      if (m[r + i][c + j] !== expected) return false;
    }
  }
  return true;
};

test('encodes short payloads as version 1 with the right size', () => {
  const qr = encodeQR('ABC');
  assert.equal(qr.version, 1);
  assert.equal(qr.size, 21);
  assert.equal(qr.modules.length, 21);
  assert.equal(qr.modules[0].length, 21);
});

test('picks a bigger version as the payload grows', () => {
  assert.equal(encodeQR('http://localhost:8787/j/FVAJB7').version, 3);
  assert.ok(encodeQR('x'.repeat(120)).version >= 6);
  assert.throws(() => encodeQR('x'.repeat(400)), /too long/);
});

test('places the three finder patterns, timing patterns and dark module', () => {
  const { modules: m, size } = encodeQR('http://localhost:8787/j/AB2C3D');
  assert.ok(isFinder(m, 0, 0), 'top-left finder');
  assert.ok(isFinder(m, 0, size - 7), 'top-right finder');
  assert.ok(isFinder(m, size - 7, 0), 'bottom-left finder');
  for (let i = 8; i < size - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0, `horizontal timing at ${i}`);
    assert.equal(m[i][6], i % 2 === 0, `vertical timing at ${i}`);
  }
  assert.equal(m[size - 8][8], true, 'dark module');
});

test('output is deterministic and roughly balanced between dark and light', () => {
  const text = 'http://192.168.1.55:8787/j/QW2X9Z';
  const a = encodeQR(text);
  const b = encodeQR(text);
  assert.deepEqual(a.modules, b.modules);
  const dark = a.modules.flat().filter(Boolean).length;
  const ratio = dark / (a.size * a.size);
  assert.ok(ratio > 0.35 && ratio < 0.65, `unbalanced modules: ${ratio}`);
});

test('different payloads produce different matrices', () => {
  const a = encodeQR('http://localhost:8787/j/AAAAAA');
  const b = encodeQR('http://localhost:8787/j/AAAAAB');
  assert.notDeepEqual(a.modules, b.modules);
});
