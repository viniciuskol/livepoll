// Minimal self-contained QR Code encoder (byte mode, ECC level M, versions 1-10).
// No dependencies, no network. Returns a boolean matrix; helper draws it on a canvas.

const ECC_M_BITS = 0b00;
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]);

// [ecCodewordsPerBlock, blocksG1, dataCwG1, blocksG2, dataCwG2] for ECC level M.
const VERSION_M = {
  1: [10, 1, 16, 0, 0],
  2: [16, 1, 28, 0, 0],
  3: [26, 1, 44, 0, 0],
  4: [18, 2, 32, 0, 0],
  5: [24, 2, 43, 0, 0],
  6: [16, 4, 27, 0, 0],
  7: [18, 4, 31, 0, 0],
  8: [22, 2, 38, 2, 39],
  9: [22, 3, 36, 2, 37],
  10: [26, 4, 43, 1, 44],
};

const ALIGNMENT = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

function dataCapacity(version) {
  const [ec, g1, d1, g2, d2] = VERSION_M[version];
  return g1 * d1 + g2 * d2;
}

function pickVersion(byteLength) {
  for (let v = 1; v <= 10; v++) {
    const countBits = v <= 9 ? 8 : 16;
    const needed = 4 + countBits + byteLength * 8;
    if (needed <= dataCapacity(v) * 8) return v;
  }
  throw new Error('QR payload too long');
}

class BitBuffer {
  constructor() { this.bits = []; }
  put(value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
  get length() { return this.bits.length; }
  toBytes() {
    const bytes = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | (this.bits[i + j] || 0);
      bytes.push(b);
    }
    return bytes;
  }
}

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const res = new Array(ecLen).fill(0);
  for (const byte of data) {
    const factor = byte ^ res[0];
    res.shift();
    res.push(0);
    for (let i = 0; i < ecLen; i++) res[i] ^= gfMul(gen[i + 1], factor);
  }
  return res;
}

function buildCodewords(text, version) {
  const bytes = new TextEncoder().encode(text);
  const buf = new BitBuffer();
  buf.put(0b0100, 4); // byte mode
  buf.put(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) buf.put(b, 8);
  const capacityBits = dataCapacity(version) * 8;
  const terminator = Math.min(4, capacityBits - buf.length);
  buf.put(0, terminator);
  while (buf.length % 8 !== 0) buf.put(0, 1);
  const data = buf.toBytes();
  const padBytes = [0xec, 0x11];
  let p = 0;
  while (data.length < dataCapacity(version)) data.push(padBytes[p++ % 2]);

  const [ecLen, g1, d1, g2, d2] = VERSION_M[version];
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < g1; i++) { blocks.push(data.slice(offset, offset + d1)); offset += d1; }
  for (let i = 0; i < g2; i++) { blocks.push(data.slice(offset, offset + d2)); offset += d2; }
  const ecBlocks = blocks.map((b) => rsEncode(b, ecLen));

  const maxData = Math.max(...blocks.map((b) => b.length));
  const out = [];
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ecLen; i++) for (const b of ecBlocks) out.push(b[i]);
  return out;
}

function bchFormat(data) {
  let d = data << 10;
  while (bitLength(d) - 11 >= 0) d ^= 0x537 << (bitLength(d) - 11);
  return ((data << 10) | d) ^ 0x5412;
}

function bchVersion(version) {
  let d = version << 12;
  while (bitLength(d) - 13 >= 0) d ^= 0x1f25 << (bitLength(d) - 13);
  return (version << 12) | d;
}

function bitLength(n) {
  let len = 0;
  while (n !== 0) { len++; n >>>= 1; }
  return len;
}

function blankMatrix(size) {
  return Array.from({ length: size }, () => new Array(size).fill(null));
}

function placeFinder(m, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
      const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      m[rr][cc] = inRing || inCore;
    }
  }
}

function placeAlignment(m, version) {
  const centers = ALIGNMENT[version];
  for (const r of centers) {
    for (const c of centers) {
      if ((r === 6 && c === 6) || (r === 6 && c === centers[centers.length - 1]) ||
          (c === 6 && r === centers[centers.length - 1])) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const ring = Math.max(Math.abs(dr), Math.abs(dc));
          m[r + dr][c + dc] = ring !== 1;
        }
      }
    }
  }
}

function reserveFormat(m, version) {
  const size = m.length;
  for (let i = 0; i < 9; i++) {
    if (m[8][i] === null) m[8][i] = false;
    if (m[i][8] === null) m[i][8] = false;
  }
  for (let i = 0; i < 8; i++) {
    if (m[8][size - 1 - i] === null) m[8][size - 1 - i] = false;
    if (m[size - 1 - i][8] === null) m[size - 1 - i][8] = false;
  }
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        m[size - 11 + j][i] = false;
        m[i][size - 11 + j] = false;
      }
    }
  }
}

function buildFunctionMatrix(version) {
  const size = version * 4 + 17;
  const m = blankMatrix(size);
  placeFinder(m, 0, 0);
  placeFinder(m, 0, size - 7);
  placeFinder(m, size - 7, 0);
  for (let i = 8; i < size - 8; i++) {
    m[6][i] = i % 2 === 0;
    m[i][6] = i % 2 === 0;
  }
  placeAlignment(m, version);
  m[size - 8][8] = true; // dark module
  reserveFormat(m, version);
  return m;
}

function maskAt(mask, r, c) {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

function penalty(m) {
  const size = m.length;
  let score = 0;
  const runScore = (line) => {
    let total = 0;
    let run = 1;
    for (let i = 1; i < line.length; i++) {
      if (line[i] === line[i - 1]) run++;
      else { if (run >= 5) total += 3 + (run - 5); run = 1; }
    }
    if (run >= 5) total += 3 + (run - 5);
    return total;
  };
  for (let r = 0; r < size; r++) score += runScore(m[r]);
  for (let c = 0; c < size; c++) score += runScore(m.map((row) => row[c]));
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
  }
  const pattern = [true, false, true, true, true, false, true, false, false, false, false];
  const rpattern = [false, false, false, false, true, false, true, true, true, false, true];
  const matches = (line, start, pat) => pat.every((v, i) => line[start + i] === v);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c + 11 <= size; c++) {
      if (matches(m[r], c, pattern) || matches(m[r], c, rpattern)) score += 40;
    }
  }
  for (let c = 0; c < size; c++) {
    const col = m.map((row) => row[c]);
    for (let r = 0; r + 11 <= size; r++) {
      if (matches(col, r, pattern) || matches(col, r, rpattern)) score += 40;
    }
  }
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c]) dark++;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

/**
 * Encodes text into a QR matrix (array of arrays of booleans, true = dark).
 * @param {string} text
 * @param {{mask?:number}} [opts] force a mask (testing only)
 * @returns {{size:number, version:number, modules:boolean[][], mask:number}}
 */
export function encodeQR(text, opts = {}) {
  const bytes = new TextEncoder().encode(String(text));
  const version = pickVersion(bytes.length);
  const codewords = buildCodewords(String(text), version);
  const size = version * 4 + 17;
  const fn = buildFunctionMatrix(version);
  const reserved = fn.map((row) => row.map((v) => v !== null));

  // Zigzag data placement.
  const bits = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
  const base = fn.map((row) => row.slice());
  let bitIndex = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5;
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (reserved[row][c]) continue;
        base[row][c] = bitIndex < bits.length ? bits[bitIndex] === 1 : false;
        bitIndex++;
      }
    }
    upward = !upward;
  }

  // Pick the best mask.
  let best = null;
  const masks = opts.mask == null ? [0, 1, 2, 3, 4, 5, 6, 7] : [opts.mask];
  for (const mask of masks) {
    const m = base.map((row, r) => row.map((v, c) => (reserved[r][c] ? v : v !== maskAt(mask, r, c))));
    applyFormatInfo(m, mask);
    if (version >= 7) applyVersionInfo(m, version);
    const score = penalty(m);
    if (!best || score < best.score) best = { score, modules: m, mask };
  }
  return { size, version, mask: best.mask, modules: best.modules.map((row) => row.map((v) => !!v)) };
}

function applyFormatInfo(m, mask) {
  const size = m.length;
  const bits = bchFormat((ECC_M_BITS << 3) | mask);
  for (let i = 0; i < 15; i++) {
    const on = ((bits >> i) & 1) === 1;
    // Vertical copy, next to the top-left finder.
    if (i < 6) m[i][8] = on;
    else if (i < 8) m[i + 1][8] = on;
    else m[size - 15 + i][8] = on;
    // Horizontal copy.
    if (i < 8) m[8][size - 1 - i] = on;
    else if (i === 8) m[8][7] = on;
    else m[8][14 - i] = on;
  }
  m[size - 8][8] = true; // dark module
}

function applyVersionInfo(m, version) {
  const size = m.length;
  const bits = bchVersion(version);
  for (let i = 0; i < 18; i++) {
    const on = ((bits >> i) & 1) === 1;
    const a = Math.floor(i / 3);
    const b = i % 3;
    m[size - 11 + b][a] = on;
    m[a][size - 11 + b] = on;
  }
}

/**
 * Renders a QR code for `text` into a canvas element.
 * @param {HTMLCanvasElement} canvas
 * @param {string} text
 * @param {{scale?:number, quiet?:number, dark?:string, light?:string}} [opts]
 */
export function drawQR(canvas, text, opts = {}) {
  const { modules, size } = encodeQR(text);
  const quiet = opts.quiet == null ? 3 : opts.quiet;
  const scale = opts.scale || 6;
  const px = (size + quiet * 2) * scale;
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = opts.light || '#ffffff';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = opts.dark || '#0b0b18';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
    }
  }
  return { size, scale, px };
}
