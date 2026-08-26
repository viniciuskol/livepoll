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

function audio() {
  if (muted) return null;
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, start, duration, type = 'sine', gain = 0.15) {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ac.currentTime + start);
  amp.gain.setValueAtTime(0.0001, ac.currentTime + start);
  amp.gain.exponentialRampToValueAtTime(gain, ac.currentTime + start + 0.02);
  amp.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + duration);
  osc.connect(amp).connect(ac.destination);
  osc.start(ac.currentTime + start);
  osc.stop(ac.currentTime + start + duration + 0.05);
}

export const sfx = {
  click: () => tone(660, 0, 0.08, 'triangle', 0.08),
  tick: () => tone(880, 0, 0.04, 'square', 0.05),
  correct: () => { tone(523, 0, 0.14); tone(659, 0.1, 0.16); tone(784, 0.2, 0.28); },
  wrong: () => { tone(220, 0, 0.22, 'sawtooth', 0.12); tone(155, 0.14, 0.3, 'sawtooth', 0.1); },
  join: () => { tone(392, 0, 0.1, 'triangle'); tone(587, 0.09, 0.16, 'triangle'); },
  countdown: () => tone(440, 0, 0.12, 'square', 0.1),
  start: () => { tone(523, 0, 0.1); tone(659, 0.08, 0.1); tone(880, 0.18, 0.24); },
  podium: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.12, 0.3)); },
};

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
      sfx.countdown();
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
  button.addEventListener('click', () => { toggleMuted(); paint(); if (!muted) sfx.click(); });
  paint();
  return paint;
}
