// Sound effects (WebAudio), confetti, floating emoji and haptics.
const STORAGE_KEY = 'livepoll.muted';
let ctx = null;
let muted = localStorage.getItem(STORAGE_KEY) === '1';

export const reducedMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function isMuted() { return muted; }
export function setMuted(value) {
  muted = !!value;
  localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
}
export function toggleMuted() { setMuted(!muted); return muted; }

/* ---------------------------------------------------------------- the cues
 * The prototype's cue set (neon.js §2), synthesized - no files, no CDN.
 *
 * Chrome refuses to start an AudioContext that was not created inside a user
 * gesture *on the current page*, and the permission does not survive a
 * navigation. The cues that matter (reveal, correct, fanfare) fire on a render,
 * never on a click, so on a cold page they were simply silent. Anything asked
 * for before the first gesture therefore waits in a short queue and is released
 * by it - dropped if it has gone stale, because a "correct" chime arriving ten
 * seconds after the reveal is worse than no chime. The app is a single
 * long-lived page, so this happens once per session and the queue stays small.
 */
const QUEUE_TTL = 4000;
let armed = false;
const pending = [];

function arm() {
  if (armed) return;
  armed = true;
  try { audio(); } catch { return; }
  const now = Date.now();
  pending.splice(0).forEach((job) => { if (now - job.at < QUEUE_TTL) job.run(); });
}
['pointerdown', 'keydown', 'touchstart'].forEach((evt) => {
  window.addEventListener(evt, arm, { once: true, capture: true });
});

function audio() {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** True when the cue was parked for the first gesture instead of played now. */
function deferred(run) {
  if (muted) return true;
  if (armed) return false;
  pending.push({ at: Date.now(), run });
  return true;
}

/**
 * One oscillator note. `sweepTo` glides the pitch across the note, which is the
 * whole of `whoosh` and half of `reveal`.
 */
function tone(freq, duration, type = 'sine', gain = 0.15, delay = 0, sweepTo = 0) {
  if (deferred(() => tone(freq, duration, type, gain, delay, sweepTo))) return;
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, t0 + duration);
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.014);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(amp).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.04);
}

/**
 * A filtered noise burst - the cymbal half of the fanfare.
 *
 * The prototype computed a delay for each of its four bursts and then never
 * passed it (neon.js:125), so all four fired on the same sample and the fanfare
 * was one flat hiss. Here the delay reaches `start()`.
 */
function noise(duration, gain = 0.12, highpass = 900, delay = 0) {
  if (deferred(() => noise(duration, gain, highpass, delay))) return;
  const ac = audio();
  if (!ac) return;
  const frames = Math.max(1, Math.floor(ac.sampleRate * duration));
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = highpass;
  const amp = ac.createGain();
  amp.gain.value = gain;
  src.connect(filter).connect(amp).connect(ac.destination);
  src.start(ac.currentTime + delay);
}

export const sfx = {
  /** Any UI press. */
  click: () => tone(560, 0.05, 'triangle', 0.09),
  /** An option being marked on the phone - two notes, so it is not a click. */
  pick: () => { tone(420, 0.07, 'square', 0.07); tone(660, 0.09, 'triangle', 0.09, 0.04); },
  /** Somebody arrived, or an answer landed. */
  join: () => { tone(523, 0.1, 'sine', 0.1); tone(784, 0.14, 'sine', 0.1, 0.07); },
  /** The clock, once per second. */
  tick: () => tone(1180, 0.035, 'square', 0.045),
  /** The last five seconds: same gesture, higher and louder. */
  urgent: () => tone(1500, 0.05, 'square', 0.08),
  /** A scene changing under the room. */
  whoosh: () => tone(180, 0.4, 'sawtooth', 0.05, 0, 900),
  /** 3 - 2 - 1, rising. */
  countdown: (n = 1) => tone(400 + n * 120, 0.16, 'triangle', 0.13),
  /** The round opening. */
  start: () => { tone(523, 0.1, 'triangle', 0.12); tone(659, 0.09, 'triangle', 0.12, 0.08); tone(880, 0.24, 'triangle', 0.13, 0.18); },
  /** The answer going up. */
  reveal: () => tone(300, 0.25, 'sawtooth', 0.06, 0, 720),
  /** Right: a major arpeggio. */
  correct: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.32, 'triangle', 0.13, i * 0.075)),
  /** Wrong: a two-note buzz, low enough not to be mistaken for the arpeggio. */
  wrong: () => { tone(196, 0.3, 'sawtooth', 0.11); tone(146, 0.4, 'square', 0.08, 0.06); },
  /** The leaderboard sliding in. */
  board: () => [392, 494, 587].forEach((f, i) => tone(f, 0.4, 'sine', 0.1, i * 0.1)),
  /** The podium: five notes over four cymbal bursts that actually stagger. */
  podium: () => {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.5, 'triangle', 0.14, i * 0.12));
    [0, 0.12, 0.24, 0.36].forEach((d) => noise(0.5, 0.06, 2200, d));
  },
};
/** The prototype's name for the podium fanfare, kept as an alias. */
sfx.fanfare = sfx.podium;

export function vibrate(pattern) {
  if (navigator.vibrate && !reducedMotion()) navigator.vibrate(pattern);
}

/** Floating emoji reactions rendered in #fx-layer. */
export function floatEmoji(emoji, count = 1) {
  const layer = document.getElementById('fx-layer');
  if (!layer || reducedMotion()) return;
  for (let i = 0; i < count; i++) {
    const node = document.createElement('span');
    node.className = 'float-emoji';
    node.textContent = emoji;
    node.style.left = `${6 + Math.random() * 88}%`;
    node.style.animationDelay = `${Math.random() * 0.4}s`;
    node.style.fontSize = `${1.5 + Math.random() * 1.4}rem`;
    layer.appendChild(node);
    setTimeout(() => node.remove(), 3600);
  }
}

/** Hand-rolled DOM confetti burst, rendered full-page in a fixed layer. */
export function confetti(durationMs = 4200) {
  const layer = document.getElementById('confetti');
  if (!layer || reducedMotion()) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const colors = ['#ffd166', '#e8455f', '#2f6df6', '#23a67a', '#9b5de5', '#00b4d8'];
  const pieces = Array.from({ length: 140 }, () => ({
    el: document.createElement('i'),
    x: Math.random() * vw,
    y: -Math.random() * vh * 0.4,
    w: 6 + Math.random() * 8,
    h: 8 + Math.random() * 12,
    vy: 2 + Math.random() * 4,
    vx: (Math.random() - 0.5) * 3,
    rot: Math.random() * 360,
    vr: (Math.random() - 0.5) * 12,
    color: colors[(Math.random() * colors.length) | 0],
  }));
  pieces.forEach((p) => {
    p.el.className = 'confetti-piece';
    p.el.style.width = `${p.w}px`;
    p.el.style.height = `${p.h}px`;
    p.el.style.background = p.color;
    layer.appendChild(p.el);
  });
  const started = performance.now();
  function frame(now) {
    const elapsed = now - started;
    const alpha = Math.max(0, 1 - elapsed / durationMs);
    pieces.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      if (p.y > vh + 20) p.y = -20;
      p.el.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${p.rot}deg)`;
      p.el.style.opacity = String(alpha);
    });
    if (elapsed < durationMs) requestAnimationFrame(frame);
    else pieces.forEach((p) => p.el.remove());
  }
  requestAnimationFrame(frame);
}

/** 3-2-1 overlay; resolves when finished. */
export function countdown(from = 3) {
  return new Promise((resolve) => {
    if (reducedMotion()) { resolve(); return; }
    const overlay = document.createElement('div');
    overlay.className = 'countdown';
    overlay.setAttribute('aria-hidden', 'true');
    const span = document.createElement('span');
    overlay.appendChild(span);
    document.body.appendChild(overlay);
    let n = from;
    const step = () => {
      if (n === 0) { overlay.remove(); resolve(); return; }
      span.textContent = String(n);
      span.style.animation = 'none';
      void span.offsetWidth;
      span.style.animation = '';
      sfx.countdown(n);
      n -= 1;
      setTimeout(step, 850);
    };
    step();
  });
}

/** Wires a mute button that keeps its label translated. */
export function mountMuteButton(button, label) {
  const paint = () => {
    button.textContent = muted ? '🔇' : '🔊';
    button.setAttribute('aria-label', label());
    button.setAttribute('aria-pressed', String(muted));
  };
  button.addEventListener('click', () => { arm(); toggleMuted(); paint(); if (!muted) sfx.click(); });
  paint();
  return paint;
}
