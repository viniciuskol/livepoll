// Small DOM helpers shared by the pages.
import { t } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (v == null || v === false) return;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c == null) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
}

export function show(node, visible = true) {
  if (node) node.classList.toggle('hidden', !visible);
}

let toastTimer = null;
export function toast(message, kind = '') {
  if (!message) return;
  const existing = $('.toast');
  if (existing) existing.remove();
  const node = el('div', { class: `toast ${kind}`, role: 'status', 'aria-live': 'polite', text: message });
  document.body.appendChild(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), 3200);
}

export const SHAPES = ['shape-triangle', 'shape-diamond', 'shape-circle', 'shape-square', 'shape-hex', 'shape-star'];

/** Localized label for an option (true/false questions use i18n words). */
export function optionLabel(question, option) {
  if (question.type === 'true_false') {
    const key = String(option.text).toLowerCase() === 'true' ? 'q.true' : 'q.false';
    return t(key);
  }
  return option.text;
}

export function optionButton(question, option, index, onClick) {
  // A multiple_select target carries a checkbox: it is the only thing that
  // tells a thumb, before the first tap, that this question does not end on it.
  const multi = question.type === 'multiple_select';
  return el('button', {
    class: `opt opt-${index + 1}`,
    type: 'button',
    'data-position': option.position,
    'aria-pressed': 'false',
    style: `animation-delay:${index * 60}ms`,
    onclick: onClick,
  }, [
    el('span', { class: `shape ${SHAPES[index % SHAPES.length]}`, 'aria-hidden': 'true' }),
    el('span', { class: 'txt', text: optionLabel(question, option) }),
    multi ? el('span', { class: 'check', 'aria-hidden': 'true', text: '✓' }) : null,
  ]);
}

export const RING_CIRCUMFERENCE = 326.7; // 2 * PI * r, r = 52

/**
 * Countdown ring shared by the stage and the phone. `id` lets the page find it
 * again from its animation frame without re-querying the whole scene.
 */
export function ringSvg(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('class', 'ring');
  svg.setAttribute('id', id);
  svg.setAttribute('role', 'timer');
  svg.innerHTML = '<circle class="track" cx="60" cy="60" r="52"></circle>'
    + '<circle class="run" cx="60" cy="60" r="52" stroke-dasharray="326.7" stroke-dashoffset="0"></circle>'
    + '<text x="60" y="73">0</text>';
  return svg;
}

/** Paints a ring built by ringSvg with the remaining fraction of its time. */
export function paintRing(ring, remainingMs, totalMs) {
  if (!ring || !totalMs) return;
  const fraction = Math.max(0, Math.min(1, remainingMs / totalMs));
  const run = ring.querySelector('.run');
  if (run) run.setAttribute('stroke-dashoffset', String(RING_CIRCUMFERENCE * (1 - fraction)));
  const seconds = String(Math.ceil(remainingMs / 1000));
  const text = ring.querySelector('text');
  if (text && text.textContent !== seconds) text.textContent = seconds;
  ring.classList.toggle('warn', remainingMs <= totalMs * 0.4 && remainingMs > 5000);
  ring.classList.toggle('danger', remainingMs <= 5000);
}

export function formatSeconds(ms) {
  return Math.max(0, Math.ceil(ms / 1000));
}
