// The host screen as a projected stage (SPEC-UX): a thin persistent strip, one
// scene per room state filling the viewport, a progress bar and a single big
// primary action. The keyboard is the primary interface - the presenter should
// never have to hunt for a button in front of an audience.
import { rooms, errorMessage } from './api.js';
import { t, onLangChange } from './i18n.js';
import { $, el, show, toast, optionLabel, SHAPES, ringSvg, paintRing } from './ui.js';
import { drawQR } from './qr.js';
import { createPoller } from './poll.js';
import { confetti, sfx, floatEmoji, countdown, mountMuteButton } from './fx.js';
import { fitRegion, watchRegion } from './fit.js';

const STORAGE_PREFIX = 'livepoll.host.';

export function saveHostToken(code, token) {
  try { localStorage.setItem(STORAGE_PREFIX + code, token); } catch { /* ignore */ }
}
export function loadHostToken(code) {
  try { return localStorage.getItem(STORAGE_PREFIX + code); } catch { return null; }
}

/** Label of the one primary action, per state. */
export function primaryKey(state) {
  const s = state ? state.state : 'lobby';
  const q = state && state.question;
  if (s === 'lobby') return 'stage.primary_start';
  if (s === 'block_intro') return 'stage.primary_block';
  // An open question has no options and never will, so neither the note on the
  // wall nor the button under it may promise any: "Show options" was a button
  // that did something else than it said, in front of a room.
  if (s === 'reading') return q && q.type === 'open_text' ? 'stage.primary_open' : 'stage.primary_options';
  if (s === 'answering') return 'stage.primary_reveal';
  if (s === 'reveal') return 'stage.primary_leaderboard';
  if (s === 'leaderboard') {
    const last = state.questionIndex != null && state.questionIndex + 1 >= state.totalQuestions;
    return last ? 'stage.primary_finish' : 'stage.primary_next';
  }
  return 'stage.primary_done';
}

/** States the back key can leave (reveal never reopens a question). */
export function canGoBack(state) {
  const s = state ? state.state : 'lobby';
  return s === 'reading' || s === 'block_intro' || s === 'answering' || s === 'leaderboard' || s === 'ended';
}

export function startStage(code, hostToken) {
  saveHostToken(code, hostToken);
  const ctx = {
    code,
    hostToken,
    state: null,
    serverOffset: 0,
    seenReactions: 0,
    quiz: null,
    showLb: false,
    sceneKey: null,
    busy: false,
    joinUrl: `${location.origin}/j/${code}`,
  };

  show($('#create-view'), false);
  show($('#setup-topbar'), false);
  show($('#stage'), true);
  document.body.classList.add('stage-on');
  $('#s-code').textContent = code;
  drawQR($('#s-qr'), ctx.joinUrl, { scale: 3, quiet: 2 });

  const primary = () => act(ctx, 'advance');
  $('#s-primary').addEventListener('click', () => primary());
  $('#s-back').addEventListener('click', () => act(ctx, 'back'));
  $('#s-end').addEventListener('click', () => act(ctx, 'end'));
  $('#s-lb').addEventListener('click', () => toggleLeaderboard(ctx));
  $('#s-full').addEventListener('click', toggleFullscreen);
  $('#s-help').addEventListener('click', () => openShortcuts());
  $('#s-grade').addEventListener('click', () => openGrading(ctx));
  const paintMute = mountMuteButton($('#s-mute'), () => t('stage.key_mute'));

  document.addEventListener('keydown', (e) => {
    if ($('#stage').classList.contains('hidden')) return;
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    // A focused button already turns Space/Enter into a click; running the
    // global handler as well would fire the action twice.
    const onButton = e.target && e.target.closest && e.target.closest('button');
    if (e.key === 'Escape') { closeOverlay(); return; }
    if ((e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') && !onButton) {
      e.preventDefault();
      if (!closeOverlayIfAny()) primary();
      return;
    }
    // Everything below this line acts on the room. With a sheet open the
    // presenter is looking at the sheet, not at the stage: `ArrowLeft` used to
    // walk the room a step backwards (discarding answers) behind the overlay,
    // and `G` reopened the grading picker on top of itself.
    if ($('#overlay-root').childElementCount > 0) return;
    if (e.key === 'ArrowLeft' && !onButton) { e.preventDefault(); act(ctx, 'back'); return; }
    const key = e.key.toLowerCase();
    if (key === 'f') { e.preventDefault(); toggleFullscreen(); }
    else if (key === 'l') { e.preventDefault(); toggleLeaderboard(ctx); }
    else if (key === 'm') { e.preventDefault(); $('#s-mute').click(); }
    else if (key === 'g') { e.preventDefault(); openGrading(ctx); }
    else if (e.key === '?' || key === '/') { e.preventDefault(); openShortcuts(); }
  });

  const poller = createPoller(
    () => rooms.state(code, ctx.state ? ctx.state.version : null, null, undefined, hostToken),
    (state) => {
      // `unchanged` payloads only carry reaction bubbles: no re-render.
      if (state.unchanged) floatNewReactions(ctx, state.reactions);
      else render(ctx, state);
    },
    (e) => { const m = errorMessage(e); if (m) toast(m, 'error'); }
  );
  ctx.poller = poller;
  poller.start();
  onLangChange(() => {
    paintMute();
    labelControls();
    if (ctx.state) render(ctx, ctx.state, { force: true });
  });
  labelControls();
  // The stage is a fit-to-region layout: the type ramp is re-solved whenever the
  // region changes size (window resize, entering fullscreen on the projector).
  watchRegion($('#s-center'));
  // Loaded once: the block cards need the per-block question count and the
  // grading overlay needs the list of open questions.
  rooms.hostQuiz(code, hostToken).then((quiz) => { ctx.quiz = quiz; }).catch(() => { /* not critical */ });
  requestAnimationFrame(() => tickTimer(ctx));
  return ctx;
}

function isTyping(node) {
  if (!node || !node.tagName) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) || node.isContentEditable === true;
}

function labelControls() {
  const set = (sel, key) => {
    const node = $(sel);
    if (node) { node.setAttribute('aria-label', t(key)); node.setAttribute('title', t(key)); }
  };
  set('#s-back', 'stage.key_back');
  set('#s-lb', 'stage.ranking');
  set('#s-grade', 'panel.grading_pick');
  set('#s-full', 'stage.fullscreen');
  set('#s-help', 'stage.shortcuts_title');
  set('#s-end', 'panel.end');
}

/**
 * Walking back out of `answering` makes the server throw the answers away, so
 * the round starts clean. That is the right behaviour, but it is destructive and
 * it used to happen on a single silent keypress: the presenter saw the room slide
 * back to `reading` with no hint that a correct answer worth 1080 points had just
 * been deleted. The first press now says how many answers are at stake and the
 * second one, within the window, does it.
 */
const CONFIRM_MS = 5000;
function needsBackConfirm(ctx) {
  const s = ctx.state;
  if (!s || s.state !== 'answering' || !s.answerCount) return false;
  if (ctx.confirmBackUntil && Date.now() < ctx.confirmBackUntil) return false;
  ctx.confirmBackUntil = Date.now() + CONFIRM_MS;
  toast(t('stage.back_discards', { count: s.answerCount }), 'error');
  return true;
}

/**
 * Runs one host action. The stage tells the server which state it believes it
 * is in, so a double click (or the button plus the space bar) can only ever
 * advance the room once: the loser comes back as STALE_STATE and is swallowed
 * as the duplicate it is (P2-10).
 */
async function act(ctx, action) {
  if (ctx.busy) return;
  if (action === 'back' && needsBackConfirm(ctx)) return;
  ctx.confirmBackUntil = 0;
  ctx.busy = true;
  const from = ctx.state ? ctx.state.state : undefined;
  try {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    sfx.click();
    // 3-2-1 before the options land, so nobody is caught mid-sentence.
    if (action === 'advance' && from === 'reading') await countdown(3);
    const next = await rooms.hostAction(ctx.code, action, ctx.hostToken, { from });
    if (from === 'reading') sfx.start();
    // `<-` from `reading` is spec-correct but it is the one destination a
    // presenter will not predict: it lands on the *previous* question's ranking,
    // and the primary button then says "Next question" as if nothing moved. Say
    // out loud which ranking this is.
    if (action === 'back' && from === 'reading' && next.state === 'leaderboard') {
      toast(t('stage.back_to_ranking', { index: (next.questionIndex || 0) + 1 }), 'ok');
    }
    render(ctx, next);
    ctx.poller.poke();
  } catch (e) {
    if (e && e.code === 'STALE_STATE') ctx.poller.poke();
    else toast(errorMessage(e), 'error');
  } finally {
    ctx.busy = false;
  }
}

function toggleFullscreen() {
  const doc = document;
  if (doc.fullscreenElement) doc.exitFullscreen().catch(() => {});
  else if (doc.documentElement.requestFullscreen) doc.documentElement.requestFullscreen().catch(() => {});
}

function toggleLeaderboard(ctx) {
  ctx.showLb = !ctx.showLb;
  $('#s-lb').setAttribute('aria-pressed', String(ctx.showLb));
  if (ctx.state) render(ctx, ctx.state, { force: true });
}

/* ------------------------------------------------------------------ render */

function render(ctx, state, opts = {}) {
  if (!state || state.unchanged) return;
  const prev = ctx.state;
  ctx.state = state;
  ctx.serverOffset = state.serverNow - Date.now();
  floatNewReactions(ctx, state.reactions);
  if (prev && state.answerCount > prev.answerCount) sfx.tick();

  renderStrip(ctx, state);
  renderFooter(ctx, state);

  const key = sceneKey(ctx, state);
  if (key !== ctx.sceneKey || opts.force) {
    // The room looks up when the wall changes, and it should hear why: the
    // prototype's cue set, on the transition rather than on the click.
    if (ctx.sceneKey !== null && key !== ctx.sceneKey) {
      if (state.state === 'reveal') sfx.reveal();
      else if (state.state === 'leaderboard') sfx.board();
      else sfx.whoosh();
    }
    ctx.sceneKey = key;
    ctx.gradeFocused = false;
    const center = $('#s-center');
    center.innerHTML = '';
    center.appendChild(buildScene(ctx, state));
    fitRegion(center);
    trimRoster($('#s-roster'));
  } else {
    patchScene(ctx, state);
  }

  if (state.state === 'ended' && (!prev || prev.state !== 'ended')) {
    confetti(2600);
    sfx.podium();
    setTimeout(() => confetti(1800), 900);
  }
}

function sceneKey(ctx, state) {
  const q = state.question;
  const lb = ctx.showLb && state.state !== 'lobby' && state.state !== 'leaderboard' && state.state !== 'ended';
  return [state.state, q ? q.id : 0, lb ? 'lb' : '', state.state === 'lobby' ? 'lobby' : ''].join('|');
}

function renderStrip(ctx, state) {
  // A finished room refuses joins: the code and the QR go away with it, instead
  // of inviting latecomers into a session that is over (P2-6).
  // The current state is mirrored on the stage element: the scenes are built
  // from scratch, so this is the one stable hook for tests and for CSS.
  $('#stage').setAttribute('data-state', state.state);
  const joinable = state.state !== 'ended';
  show($('#s-codewrap'), joinable);
  show($('#s-qr'), joinable);
  // On `block_intro` the block name *is* the slide - the strip chip would be
  // the third printing of the same string on one screen (SPEC-UX rule 5).
  $('#s-block').textContent = state.state === 'block_intro'
    ? ''
    : (state.blockName ? `${t('panel.block')}: ${state.blockName}` : (state.title || ''));
  $('#s-qof').textContent = state.questionIndex != null && state.state !== 'ended'
    ? t('panel.question_of', { index: state.questionIndex + 1, total: state.totalQuestions })
    : '';
  $('#s-players').textContent = t('stage.players_here', { count: state.playerCount });
  $('#s-state').textContent = t(`panel.state_${state.state}`);
}

function renderFooter(ctx, state) {
  const done = state.state === 'ended';
  const answeredQuestions = state.questionIndex == null ? 0 : state.questionIndex + (done ? 1 : 0);
  const pct = state.totalQuestions
    ? Math.round(((done ? state.totalQuestions : answeredQuestions) / state.totalQuestions) * 100)
    : 0;
  $('#s-progress').style.width = `${pct}%`;

  const btn = $('#s-primary');
  btn.textContent = t(primaryKey(state));
  btn.disabled = done;
  $('#s-back').disabled = !canGoBack(state);
  $('#s-end').disabled = done;
  // Grading is only useful once at least one open question has been answered.
  $('#s-grade').disabled = state.state === 'lobby';
}

/** Floats only the reaction bubbles we have not shown yet. */
function floatNewReactions(ctx, reactions) {
  const list = reactions || [];
  list.forEach((r) => { if (r.at > ctx.seenReactions) floatEmoji(r.emoji, 1); });
  if (list.length) ctx.seenReactions = Math.max(ctx.seenReactions, ...list.map((r) => r.at));
}

/* ------------------------------------------------------------------ scenes */

function buildScene(ctx, state) {
  if (ctx.showLb && !['lobby', 'leaderboard', 'ended'].includes(state.state)) return sceneLeaderboard(ctx, state);
  switch (state.state) {
    case 'lobby': return sceneLobby(ctx, state);
    case 'block_intro': return sceneBlockIntro(ctx, state);
    case 'reading': return sceneReading(ctx, state);
    case 'answering': return sceneAnswering(ctx, state);
    case 'reveal': return sceneReveal(ctx, state);
    case 'leaderboard': return sceneLeaderboard(ctx, state);
    case 'ended': return sceneEnded(ctx, state);
    default: return el('div', { class: 'scene' });
  }
}

function patchScene(ctx, state) {
  const answers = $('#s-answers');
  if (answers) {
    const multi = state.question && state.question.type === 'multiple_select';
    answers.textContent = t(multi ? 'stage.confirmed_in' : 'stage.answers_in',
      { count: state.answerCount, total: state.playerCount });
  }
  const tiles = $('#s-tiles');
  if (tiles) paintTiles(tiles, state.answerCount);
  const missing = $('#s-missing');
  if (missing) paintMissing(missing, state);
  const roster = $('#s-roster');
  if (roster) {
    const added = patchRoster(roster, state.players || []);
    // A newcomer changes how much type the region can carry, so the ramp is
    // re-solved (and the fold-away count recomputed) - but only then.
    if (added) { fitRegion($('#s-center')); trimRoster(roster); }
  }
  // The room count lives in the strip chip and only there: the lobby printed it
  // twice on one screen, once in the chip and once under the join URL.
}

function sceneLobby(ctx, state) {
  const qr = el('canvas', { 'aria-label': t('panel.qr_label') });
  const scene = el('div', { class: 'scene', 'data-fit-max': '2' }, [
    el('div', { class: 'lobby-grid' }, [
      el('div', {}, [
        el('p', { class: 'scene-kicker', text: t('panel.room_code') }),
        el('div', { class: 'lobby-code', text: state.code }),
        el('p', { class: 'lobby-join', text: t('stage.join_call', { url: ctx.joinUrl.replace(/^https?:\/\//, '') }) }),
      ]),
      el('div', {}, [
        el('div', { class: 'lobby-qr' }, qr),
        el('p', { class: 'scene-note', text: t('panel.scan') }),
      ]),
    ]),
    el('div', { class: 'roster', id: 's-roster' }),
  ]);
  drawQR(qr, ctx.joinUrl, { scale: 6 });
  // Silent on the first paint: only a *new* arrival gets the sound.
  patchRoster(scene.querySelector('#s-roster'), state.players || [], true);
  return scene;
}

/**
 * Folds the names that do not fit into a single "+N more" chip.
 *
 * At 40 players 19 chips were simply clipped away while the strip claimed "40
 * in the room": the stage was lying about who was in it. The roster grows into
 * whatever the region has left (see the type ramp), and whatever still does not
 * fit is *counted* rather than hidden.
 */
const DENSE_ROOM = 14;
function trimRoster(root) {
  if (!root || !root.isConnected) return;
  const names = root.querySelectorAll('.roster-chip:not(.more)').length;
  root.classList.toggle('dense', names > DENSE_ROOM);
  const existing = root.querySelector('.roster-chip.more');
  if (existing) existing.remove();
  const chips = [...root.children].filter((n) => n.classList.contains('roster-chip'));
  chips.forEach((c) => c.classList.remove('hidden'));
  // Layout boxes (`offsetTop`), not client rects: a chip that is still playing
  // its entry animation reports a rect the `scale()` shrank, which would make
  // this pass believe a row fits while it is mid-pop.
  const overflows = () => {
    const height = root.clientHeight;
    return [...root.children].some((c) => {
      if (c.classList.contains('hidden') || !c.offsetHeight) return false;
      return c.offsetTop < -1 || c.offsetTop + c.offsetHeight > height + 1;
    });
  };
  // The chips are inserted newest-first, so the ones folded away are the names
  // that have been on screen the longest.
  let hidden = 0;
  for (let i = chips.length - 1; i >= 0 && overflows(); i -= 1) {
    chips[i].classList.add('hidden');
    hidden += 1;
  }
  if (!hidden) return;
  // The counter needs a slot of its own, and it is a chip like any other: its
  // *label* has to be in place before the fit is measured, or the number that
  // appears at the end pushes the counter onto a row that does not exist.
  const more = el('span', {
    class: 'roster-chip more', 'data-more': '1', text: t('stage.roster_more', { count: hidden }),
  });
  root.appendChild(more);
  for (let i = chips.length - hidden - 1; i >= 0 && overflows(); i -= 1) {
    chips[i].classList.add('hidden');
    hidden += 1;
    more.textContent = t('stage.roster_more', { count: hidden });
  }
}

/** Adds the newcomers with a pop, keeps the chips already on screen still. */
function patchRoster(root, players, quiet) {
  const seen = new Set();
  let changed = false;
  players.forEach((p, i) => {
    seen.add(String(p.id));
    if (root.querySelector(`[data-player="${p.id}"]`)) return;
    changed = true;
    root.insertBefore(el('span', {
      class: 'roster-chip', 'data-player': p.id, style: `animation-delay:${Math.min(i, 8) * 45}ms`,
    }, [
      el('span', { 'aria-hidden': 'true', text: p.avatar || '🙂' }),
      el('span', { text: p.nickname }),
    ]), root.firstChild);
    if (!quiet) sfx.join();
  });
  [...root.children].forEach((node) => {
    if (node.dataset.more) return;
    if (!seen.has(node.getAttribute('data-player'))) { node.remove(); changed = true; }
  });
  if (!players.length && !root.querySelector('.scene-note')) {
    root.appendChild(el('span', { class: 'scene-note', text: t('stage.nobody_yet') }));
  }
  return changed;
}

/**
 * The prompt, in one of five length bands (PORT-PLAN D1).
 *
 * The band is *relative*: `.q-xs`...`.q-xl` pick a multiple of the scene unit,
 * and `fitRegion()` picks the absolute scale by measurement. That is the half
 * of the prototype's `fitQuestion()` worth keeping - its 10-step shrink loop
 * and its 70% floor exist to catch overflow a hand-calibrated `clamp()` cannot
 * see, and a measured fit cannot overflow.
 *
 * The band it replaces was binary (`.long`, at 90 characters), which meant one
 * size for everything from four words to a full paragraph: a 51-character
 * question was projected at the same 2.25em as "Why does ice float?" and ate
 * 93px of a 720p wall for a line the room had already heard read out loud.
 */
const BANDS = [[26, 'q-xs'], [48, 'q-s'], [84, 'q-m'], [140, 'q-l']];
function promptBand(text) {
  const len = text.trim().length;
  const band = BANDS.find(([max]) => len <= max);
  return band ? band[1] : 'q-xl';
}
function promptNode(q) {
  const text = (q && q.prompt) || '';
  return el('h1', { class: `scene-prompt ${promptBand(text)}`, text });
}

function questionImage(q) {
  return q && q.imageUrl ? el('img', { class: 'scene-image', src: q.imageUrl, alt: '' }) : null;
}

function sceneReading(ctx, state) {
  const q = state.question || {};
  // The prompt is the only thing on the stage here, so it gets the whole room.
  return el('div', { class: 'scene big-prompt', 'data-fit-max': '3.2' }, [
    el('p', { class: 'scene-kicker', text: t(`type.${q.type}`) }),
    promptNode(q),
    questionImage(q),
    // The instruction reads as a control, not as fine print: the prototype's
    // pill, with the speaking emoji as the only decoration (aria-hidden - the
    // sentence already says it).
    el('p', { class: 'scene-note read-hint' }, [
      el('span', { class: 'wave', 'aria-hidden': 'true', text: '\u{1f5e3}️' }),
      el('span', { text: t(q.type === 'open_text' ? 'stage.read_aloud_open' : 'stage.read_aloud') }),
    ]),
  ]);
}

function sceneBlockIntro(ctx, state) {
  const inBlock = ctx.quiz
    ? (ctx.quiz.questions || []).filter((q) => q.blockName === state.blockName).length
    : 0;
  return el('div', { class: 'scene', 'data-fit-max': '3' }, [
    el('div', { class: 'block-card' }, [
      el('p', { class: 'block-index', text: t('stage.block_card', { index: (state.blockIndex || 0) + 1 }) }),
      el('h1', { class: 'block-name', text: state.blockName || '' }),
      el('div', { class: 'block-rule', 'aria-hidden': 'true' }),
      inBlock ? el('p', { class: 'scene-note', text: t('stage.block_count', { count: inBlock }) }) : null,
    ]),
  ]);
}

/**
 * One option on the stage. At reveal the distribution rides *inside* the
 * option as a strip along its bottom edge plus a percentage: a separate bar
 * chart below the grid did not fit a six-option question at 1280x720, and the
 * strip cannot touch the contrast of the label either (it is drawn in the same
 * ink the label already clears 4.5:1 against).
 */
function optionNode(q, option, i, revealed, share) {
  const correct = new Set(q.correct || []);
  const isCorrect = revealed && correct.has(option.position);
  const cls = `opt opt-${i + 1}${revealed ? (isCorrect ? ' is-correct' : ' is-wrong') : ''}`;
  // A multiple_select question has to *look* multiple-choice-able before the
  // first tap: an empty checkbox on every card is the only cue on the wall that
  // says "more than one of these" without reading the hint (D3's sibling case).
  const multi = q.type === 'multiple_select';
  return el('div', { class: cls, style: `animation-delay:${i * 70}ms` }, [
    el('span', { class: `shape ${SHAPES[i % SHAPES.length]}`, 'aria-hidden': 'true' }),
    multi && !revealed ? el('span', { class: 'check', 'aria-hidden': 'true', text: '✓' }) : null,
    el('span', { class: 'txt', text: optionLabel(q, option) }),
    // `.tick` on a single answer, `.mark` on the types where every row carries a
    // verdict: true_false and multiple_select both go neutral at the reveal
    // (PORT-PLAN D3), so a row with no marker at all would read as "not
    // evaluated" rather than as "wrong".
    isCorrect && !multi && q.type !== 'true_false'
      ? el('span', { class: 'tick', 'aria-hidden': 'true', text: '✔' })
      : null,
    revealed && (multi || q.type === 'true_false')
      ? el('span', { class: `mark ${isCorrect ? 'ok' : 'no'}`, 'aria-hidden': 'true', text: isCorrect ? '✓' : '✕' })
      : null,
    revealed
      ? el('span', {
          class: 'sr-only',
          text: t(isCorrect ? 'panel.verdict_accepted' : 'panel.verdict_rejected'),
        })
      : null,
    share ? el('b', { class: 'pct', text: `${share.pct}% · ${share.count}` }) : null,
    share ? el('i', { class: 'fill', style: `width:${share.pct}%` }) : null,
  ]);
}

/**
 * The option grid's shape, by type (PORT-PLAN D3, §4 of the port map).
 *
 * Until now the single column came from `options.length <= 2` and nothing ever
 * tested the type, which is why true_false rendered as a squeezed
 * multiple_choice. The branch is explicit now:
 *
 * - `true_false` gets `.tf`: two cards that own the whole scene, shape above
 *   text, no third and fourth row of void underneath them.
 * - two options of any other type keep the full-width single column they had.
 * - five and six options get `.many`, the case the prototype never had - real
 *   spreadsheet content reaches six.
 */
function gridClass(q, options, revealed) {
  const parts = ['stage-opts'];
  if (revealed) parts.push('revealed');
  if (q.type === 'true_false') parts.push('tf');
  else if (options.length <= 2) parts.push('cols-1');
  else if (options.length > 4) parts.push('many');
  if (q.type === 'multiple_select') parts.push('multi');
  return parts.join(' ');
}

/**
 * How many marks a multiple_select expects. The answering payload deliberately
 * withholds `correct` (anti-cheat), so the number comes from the host's own
 * copy of the quiz - which may not have landed yet, hence the countless
 * fallback rather than a "Mark undefined".
 */
function multiHint(ctx, q) {
  const quizQ = ctx.quiz && (ctx.quiz.questions || []).find((x) => x.id === q.id);
  const count = quizQ ? (quizQ.options || []).filter((o) => o.correct).length : 0;
  return el('p', { class: 'multi-hint' }, [
    el('span', { 'aria-hidden': 'true', text: '☑️' }),
    el('span', { text: count > 0 ? t('stage.multi_hint', { count }) : t('stage.multi_hint_any') }),
  ]);
}

function sceneAnswering(ctx, state) {
  const q = state.question || {};
  const options = q.options || [];
  const grid = el('div', { class: gridClass(q, options, false) },
    options.map((o, i) => optionNode(q, o, i, false)));
  const open = q.type === 'open_text';
  const multi = q.type === 'multiple_select';
  return el('div', { class: 'scene', 'data-fit-max': open ? '2.2' : '1.8' }, [
    promptNode(q),
    questionImage(q),
    // The rule of the round belongs on the wall, above the grid it governs:
    // "you may mark more than one" is not something a player can infer from
    // four cards that look exactly like a single-answer question.
    multi ? multiHint(ctx, q) : null,
    open ? openWait(state) : grid,
    el('div', { class: 'timer-row' }, [
      ringSvg('s-ring'),
      // Answer *count* only: the distribution before the reveal would bias
      // everyone still deciding (SPEC-UX).
      // `aria-live="off"`, explicitly: `#s-center` is a polite live region, so
      // without this the counter inherits it and is announced on every single
      // answer - nine times per question, straight over the reading of the
      // prompt (PORT-PLAN D6).
      // "Answered" is the wrong verb for a multiple_select: a phone with two
      // options marked and nothing confirmed has *not* answered, and the
      // counter is the only thing telling the presenter whether the room is
      // still working or already done.
      el('span', {
        class: 'stage-answers', id: 's-answers', 'aria-live': 'off',
        text: t(multi ? 'stage.confirmed_in' : 'stage.answers_in',
          { count: state.answerCount, total: state.playerCount }),
      }),
    ]),
  ]);
}

/**
 * An open question has no options to project, and projecting what the room is
 * typing would leak the guesses - so the wait used to be one grey line on 68%
 * of an empty wall. It is now the region itself: one anonymous tile per answer
 * landing, so the room can see itself filling up without seeing a single word.
 */
function openWait(state) {
  const wrap = el('div', { class: 'open-wait' }, [
    // One headline, repainted with the room: it used to read "Waiting for
    // answers" *next to* "EVERYONE ANSWERED", so the scene contradicted itself
    // on the one screen the presenter reads to decide whether to move on.
    el('p', { class: 'scene-note', id: 's-wait-note' }),
    el('div', { class: 'tiles', id: 's-tiles', 'aria-hidden': 'true' }),
    // Who the room is still waiting *for* - never who already sent. The list of
    // people who are done is a public typing-speed scoreboard, and it grows
    // instead of shrinking, so at 200 players it is also the thing that
    // overflows the scene. This one empties itself as the answers land.
    el('p', { class: 'scene-kicker missing-label', id: 's-missing-label' }),
    el('div', { class: 'typing', id: 's-missing' }),
  ]);
  paintTiles(wrap.querySelector('#s-tiles'), state.answerCount);
  paintMissing(wrap.querySelector('#s-missing'), state);
  return wrap;
}

/** How many names the wall shows before it starts counting the rest. */
const MAX_MISSING_CHIPS = 24;

/** Repaints the "still to answer" chips in place, so the fold does not flicker. */
function paintMissing(root, state) {
  if (!root) return;
  const list = state.missing || [];
  // Relative to the node, not to the document: `openWait` paints the list while
  // the scene is still detached, so a document-wide lookup found nothing and
  // the label stayed blank until the first answer bumped the room's version.
  const label = (root.parentNode && root.parentNode.querySelector('#s-missing-label'))
    || $('#s-missing-label');
  // The headline says whether the room is done; the label below it only names
  // the people still missing, and says nothing at all once there are none.
  const note = (root.parentNode && root.parentNode.querySelector('#s-wait-note'))
    || $('#s-wait-note');
  if (note) note.textContent = list.length ? t('stage.waiting_answers') : t('stage.all_in');
  if (label) label.textContent = list.length ? t('stage.still_missing') : '';
  // Whatever does not fit is counted, never silently clipped - the same rule the
  // lobby roster follows. The server already caps the list it sends, so the
  // count comes from the room's own numbers, not from the array's length.
  const shown = list.slice(0, MAX_MISSING_CHIPS);
  const hidden = Math.max(0,
    (Number(state.playerCount) || 0) - (Number(state.answerCount) || 0) - shown.length);
  const seen = new Set();
  shown.forEach((p) => {
    seen.add(String(p.id));
    if (root.querySelector(`[data-player="${p.id}"]`)) return;
    root.appendChild(el('span', {
      class: 'who', 'data-player': p.id,
      text: `${p.avatar || '\u{1f642}'} ${p.nickname}`,
    }));
  });
  [...root.children].forEach((node) => {
    const key = node.getAttribute('data-player');
    if (key !== 'more' && !seen.has(key)) node.remove();
  });
  let more = root.querySelector('[data-player="more"]');
  if (hidden > 0) {
    if (!more) more = el('span', { class: 'who more', 'data-player': 'more' });
    // Re-appended so the counter stays last as names leave the list.
    root.appendChild(more);
    more.textContent = t('stage.roster_more', { count: hidden });
  } else if (more) {
    more.remove();
  }
}

/** Keeps exactly `count` tiles on screen, popping the new ones in. */
function paintTiles(root, count) {
  if (!root) return;
  const n = Math.max(0, Number(count) || 0);
  while (root.children.length > n) root.lastElementChild.remove();
  while (root.children.length < n) {
    root.appendChild(el('span', {
      class: 'tile', text: '\u270d\ufe0f',
      style: `animation-delay:${Math.min(root.children.length, 10) * 40}ms`,
    }));
  }
}

function sceneReveal(ctx, state) {
  const q = state.question || {};
  const results = state.results || {};
  const children = [promptNode(q)];
  if (results.type === 'open_text') {
    const groups = results.groups || [];
    // Every distinct answer appears exactly *once*. The reveal used to print
    // the same strings twice - as distribution bars and again as grading rows -
    // which is both a stutter to read and the thing that overflowed the scene.
    // The share of the room now rides inside the grading row itself.
    const quizQ = ctx.quiz && (ctx.quiz.questions || []).find((x) => x.id === q.id);
    // The reveal only has room for the head of a long tail: with 200 people a
    // free-text question can produce forty distinct strings, and forty rows is
    // not a slide. The top groups are shown with their verdicts, the counter
    // says how many were left out, and `G` opens the full, scrollable list.
    children.push(gradingBlock(ctx, q.id, groups, quizQ && quizQ.answerKey, { limit: REVEAL_GROUPS }));
  } else {
    const options = q.options || [];
    const counts = results.counts || [];
    const total = counts.reduce((n, c) => n + c.count, 0) || 1;
    const shareOf = (position) => {
      const row = counts.find((c) => c.position === position);
      const count = row ? row.count : 0;
      return { count, pct: Math.round((count / total) * 100) };
    };
    children.push(el('div', { class: gridClass(q, options, true) },
      options.map((o, i) => optionNode(q, o, i, true, shareOf(o.position)))));
  }
  if (q.explanation) children.push(el('p', { class: 'explain', text: `${t('panel.explanation')}: ${q.explanation}` }));
  return el('div', { class: 'scene', 'data-fit-max': '1.7' }, children);
}

function deltaNode(delta) {
  const n = Number(delta) || 0;
  // Traço, não ponto: um `·` solto ao lado de um número de 54px no telão é lido
  // como erro de digitação, enquanto um traço lê como "sem mudança".
  if (!n) return el('span', { class: 'lb-delta held', text: '–', 'aria-label': t('lb.delta_same') });
  const up = n > 0;
  return el('span', {
    class: `lb-delta ${up ? 'up' : 'down'}`,
    text: `${up ? '↑' : '↓'} ${Math.abs(n)}`,
    'aria-label': t(up ? 'lb.delta_up' : 'lb.delta_down', { count: Math.abs(n) }),
  });
}

function sceneLeaderboard(ctx, state) {
  const rows = (state.leaderboard || []).slice(0, 5);
  const list = el('ol', { class: 'stage-lb' });
  if (!rows.length) list.appendChild(el('li', { text: t('lb.empty') }));
  // How far behind the leader each row is, as a lane along the bottom edge of
  // the row: the numbers alone do not say whether second place is 20 points or
  // 2000 points away, which is the whole tension of a ranking slide. Absolutely
  // positioned, so it never becomes a sixth grid track.
  const best = rows.length ? Math.max(1, ...rows.map((p) => Number(p.score) || 0)) : 1;
  rows.forEach((p, i) => {
    list.appendChild(el('li', { class: i === 0 ? 'top1' : '', style: `animation-delay:${i * 90}ms` }, [
      el('i', {
        class: 'lb-fill', 'aria-hidden': 'true',
        style: `--w:${Math.max(0, Math.min(100, Math.round(((Number(p.score) || 0) / best) * 100)))}%`,
      }),
      el('span', { class: 'lb-rank', text: String(p.rank) }),
      el('span', { 'aria-hidden': 'true', text: p.avatar || '🙂' }),
      el('span', { class: 'name', text: p.nickname }),
      deltaNode(p.delta),
      el('span', { class: 'lb-score', text: String(p.score) }),
    ]));
  });
  return el('div', { class: 'scene', 'data-fit-max': '1.9' }, [
    el('p', { class: 'scene-kicker', text: t('lb.title') }),
    list,
  ]);
}

const MEDALS = ['\u{1f947}', '\u{1f948}', '\u{1f949}'];

function statNode(value, label, note) {
  return el('div', { class: 'stat' }, [
    el('b', { text: String(value) }),
    el('span', { class: 'stat-label', text: label }),
    note ? el('span', { class: 'stat-note', text: note }) : null,
  ]);
}

/**
 * The finale. It is the loudest moment of the session, so it is the one scene
 * built as a *composition* rather than as a stack: the podium is anchored to the
 * floor of the region and given the room to be a podium, and the space next to
 * it carries what the top three cannot say - the rest of the standings and the
 * numbers of the whole session. Before this, `ended` was a kicker, one line and
 * three small bars floating in the middle of the stage: the emptiest screen of
 * the session was also its climax.
 */
function sceneEnded(ctx, state) {
  const rows = state.leaderboard || [];
  const top = rows.slice(0, 3);
  const rest = rows.slice(3, 8);
  const place = new Map(top.map((p, i) => [p, i]));
  const stageOrder = [top[1], top[0], top[2]].filter(Boolean);
  const podium = el('div', { class: 'podium' });
  stageOrder.forEach((p, i) => {
    const rank = place.get(p);
    podium.appendChild(el('div', { class: `p${rank + 1}`, style: `animation-delay:${i * 220}ms` }, [
      el('span', { class: 'medal', 'aria-hidden': 'true', text: MEDALS[rank] }),
      el('span', { class: 'name', text: `${p.avatar || ''} ${p.nickname}`.trim() }),
      el('span', { class: 'score', text: String(p.score) }),
    ]));
  });

  const sum = state.summary || {};
  const stats = el('div', { class: 'finale-stats' }, [
    statNode(sum.questions != null ? sum.questions : (state.totalQuestions || 0), t('stage.stat_questions')),
    statNode(sum.players != null ? sum.players : (state.playerCount || 0), t('stage.stat_players')),
    statNode(`\u{1f525} ${sum.bestStreak || 0}`, t('stage.stat_best_streak'), sum.bestStreakBy || null),
    statNode(`${sum.accuracy || 0}%`, t('stage.stat_accuracy')),
    statNode(sum.perfect || 0, t('stage.stat_perfect'),
      (sum.perfectNames || []).length ? sum.perfectNames.join(', ') : null),
  ]);

  const side = el('div', { class: 'finale-side' });
  if (rest.length) {
    const list = el('ol', { class: 'finale-rest' });
    // A coluna divide a altura com o painel de números, então a lista mostra o
    // que cabe e conta o resto — como o lobby faz. Sem isso a última linha era
    // recortada no meio, o que parece defeito e não resumo.
    const MAX_ROWS = 3;
    const shown = rest.slice(0, MAX_ROWS);
    const hidden = rest.length - shown.length;
    shown.forEach((p) => {
      list.appendChild(el('li', {}, [
        el('span', { class: 'lb-rank', text: String(p.rank) }),
        el('span', { 'aria-hidden': 'true', text: p.avatar || '\u{1f642}' }),
        el('span', { class: 'name', text: p.nickname }),
        el('span', { class: 'lb-score', text: String(p.score) }),
      ]));
    });
    if (hidden > 0) {
      list.appendChild(el('li', { class: 'rest-more' }, [
        el('span', { class: 'name', text: t('stage.roster_more', { count: hidden }) }),
      ]));
    }
    side.append(
      el('p', { class: 'scene-kicker', text: t('stage.finale_standings') }),
      list
    );
  }
  side.appendChild(stats);

  const champion = top[0];
  // The champion line, the podium and the thanks are one column: the name has to
  // sit *over* the podium it belongs to, not floating between the two columns.
  const main = el('div', { class: 'finale-main' }, [
    el('div', { class: 'finale-head' }, [
      el('p', { class: 'scene-kicker', text: t('panel.final_title') }),
      champion
        ? el('p', { class: 'champion' }, [
            el('span', { 'aria-hidden': 'true', class: 'cup', text: '\u{1f3c6}' }),
            el('span', { class: 'who', text: `${champion.avatar || ''} ${champion.nickname}`.trim() }),
          ])
        : el('p', { class: 'scene-note', text: t('lb.empty') }),
      el('p', { class: 'scene-note', text: t('panel.podium_cheer') }),
    ]),
    podium,
    el('p', { class: 'scene-note finale-thanks', text: t('stage.thanks') }),
  ]);
  return el('div', { class: `scene finale${rest.length ? '' : ' solo'}`, 'data-fit-max': '1.6' }, [main, side]);
}

/* ----------------------------------------------------------------- grading */

/**
 * Open-answer grading rows. Nothing is marked until the host says so: the
 * groups arrive unmarked, so the projected screen shows no correctness cue
 * before the host acts.
 */
const REVEAL_GROUPS = 6;

function gradingBlock(ctx, questionId, groups, answerKey, opts = {}) {
  // The marks belong to *this* block, not to the panel: the reveal scene and the
  // "grade an earlier question" overlay can be on screen at the same time, and
  // a shared map would save one question's marks against the other.
  const grades = new Map();
  const wrap = el('div', { class: 'grade-list' });
  if (!groups.length) {
    wrap.appendChild(el('p', { class: 'scene-note', text: t('panel.no_answers') }));
  }
  const total = groups.reduce((n, g) => n + g.count, 0) || 1;
  // `groups` arrives sorted by count, so a cap keeps the head of the
  // distribution - the answers the room actually gave - and drops the tail.
  const shown = opts.limit ? groups.slice(0, opts.limit) : groups;
  shown.forEach((g) => {
    if (g.correct !== null && g.correct !== undefined) grades.set(g.norm, g.correct);
    const pct = Math.round((g.count / total) * 100);
    const row = el('div', { class: 'group-row' });
    // A toggle group, not two buttons: `aria-pressed` was set and nothing in
    // the CSS matched it, so the panel showed no trace of what was already
    // marked. `.verdict-pick` gives the pair its pressed treatment.
    const okBtn = el('button', { class: 'btn btn-sm btn-secondary verdict-pick pick-ok', type: 'button', text: t('panel.mark_correct') });
    const badBtn = el('button', { class: 'btn btn-sm btn-secondary verdict-pick pick-no', type: 'button', text: t('panel.mark_wrong') });
    // Correctness is never colour-only, here as anywhere else (D6): the row
    // border is joined by a mark with its own opaque separator.
    const mark = el('span', { class: 'mark', 'aria-hidden': 'true' });
    const verdict = el('span', { class: 'sr-only' });
    // Names ride on *accepted* groups only. Praising by name is a reward the
    // room enjoys; projecting who wrote the wrong answer - or the joke answer -
    // is a punishment nobody agreed to when they typed it.
    const who = el('span', { class: 'who-count' });
    const names = (g.nicknames || []).slice(0, 6).join(', ');
    const paint = () => {
      const value = grades.get(g.norm);
      row.classList.toggle('marked-ok', value === true);
      row.classList.toggle('marked-bad', value === false);
      okBtn.setAttribute('aria-pressed', String(value === true));
      badBtn.setAttribute('aria-pressed', String(value === false));
      mark.classList.toggle('ok', value === true);
      mark.classList.toggle('no', value === false);
      mark.textContent = value === true ? '✓' : (value === false ? '✕' : '');
      verdict.textContent = value == null
        ? ''
        : t(value ? 'panel.verdict_accepted' : 'panel.verdict_rejected');
      who.textContent = value === true && names ? t('panel.accepted_by', { names }) : '';
    };
    okBtn.addEventListener('click', () => { grades.set(g.norm, true); paint(); sfx.click(); });
    badBtn.addEventListener('click', () => { grades.set(g.norm, false); paint(); sfx.click(); });
    row.append(
      mark,
      el('strong', { class: 'grow', text: g.sample || '—' }),
      who,
      verdict,
      // The count *and* the share: this row is now the only place the string is
      // printed, so it carries the distribution the bars used to duplicate.
      el('span', { class: 'pill', text: `${g.count} · ${pct}%` }),
      okBtn,
      badBtn,
      el('i', { class: 'share', style: `width:${pct}%`, 'aria-hidden': 'true' })
    );
    paint();
    wrap.appendChild(row);
  });
  // Grading was the one job that still forced the presenter to the trackpad:
  // the buttons were focusable but nothing put focus near them. Up/Down walk
  // the answers, and Enter/Space mark the focused one.
  wrap.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = [...wrap.querySelectorAll('.group-row')];
    const here = e.target.closest('.group-row');
    const at = rows.indexOf(here);
    const next = rows[e.key === 'ArrowDown' ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1)];
    if (!next) return;
    e.preventDefault();
    const btn = next.querySelector('button');
    if (btn) btn.focus();
  });
  const save = el('button', {
    class: 'btn', id: 'save-grades', type: 'button', text: t('panel.save_grades'),
    onclick: () => saveGrades(ctx, questionId, grades),
  });
  const keys = (answerKey || []).filter(Boolean);
  // A capped list has to say so. Silently dropping the tail of a distribution
  // is the difference between "these are the answers" and "these are some of
  // the answers", and only one of those is true on the reveal slide.
  const capped = shown.length < groups.length;
  // The list is the one element on the stage allowed to scroll, so it says so
  // and takes focus itself: `tabindex` makes the arrow keys scroll it even
  // before the presenter has tabbed onto a mark button.
  wrap.setAttribute('tabindex', '0');
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', t('panel.grading_title'));
  return el('div', { class: 'scene', style: 'gap:10px' }, [
    // The overlay already carries this string in its <h2>, two lines up.
    opts.titled === false ? null : el('p', { class: 'scene-kicker', text: t('panel.grading_title') }),
    keys.length ? el('p', { class: 'scene-note', text: `${t('panel.answer_key')}: ${keys.join(', ')}` }) : null,
    el('p', { class: 'scene-note', text: `${t('panel.grading_hint')} ${t('stage.grade_hint')} · ${t('stage.grade_keys')}` }),
    groups.length
      ? el('p', { class: 'scene-note grade-count' }, [
          el('span', { text: t('panel.showing_groups', { shown: shown.length, total: groups.length }) }),
          capped ? el('span', { class: 'grade-more', text: ` · ${t('panel.grade_all_hint')}` }) : null,
        ])
      : null,
    wrap,
    groups.length ? save : null,
  ]);
}

async function saveGrades(ctx, questionId, grades) {
  if (!questionId) return;
  const groups = [...grades.entries()].map(([norm, correct]) => ({ norm, correct }));
  if (!groups.length) return;
  try {
    await rooms.hostGrade(ctx.code, ctx.hostToken, questionId, groups);
    toast(t('panel.grades_saved'), 'ok');
    sfx.correct();
    ctx.poller.poke();
  } catch (e) {
    toast(errorMessage(e), 'error');
  }
}

/* ---------------------------------------------------------------- overlays */

/**
 * A sheet declared itself `role="dialog" aria-modal="true"` and then left focus
 * on `document.body`: Tab walked the whole stage before reaching it, which is
 * why the grading rows were mouse-only in practice. Focus now moves in, stays
 * in while the sheet is up, and returns to whatever opened it.
 */
let overlayReturn = null;

function focusables(root) {
  return [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((n) => !n.disabled && n.offsetParent !== null);
}

function closeOverlay() {
  const root = $('#overlay-root');
  const had = root.childElementCount > 0;
  root.innerHTML = '';
  if (had && overlayReturn && overlayReturn.isConnected && overlayReturn.focus) overlayReturn.focus();
  overlayReturn = null;
}
function closeOverlayIfAny() {
  const had = $('#overlay-root').childElementCount > 0;
  closeOverlay();
  return had;
}

function overlay(titleKey, body) {
  const sheet = el('div', { class: 'sheet', tabindex: '-1' }, [
    el('h2', { text: t(titleKey) }),
    body,
    el('button', { class: 'btn btn-secondary', type: 'button', text: t('common.close'), onclick: closeOverlay }),
  ]);
  const root = $('#overlay-root');
  root.innerHTML = '';
  const dialog = el('div', {
    class: 'stage-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': t(titleKey),
    onclick: (e) => { if (e.target.classList.contains('stage-overlay')) closeOverlay(); },
    onkeydown: (e) => {
      if (e.key !== 'Tab') return;
      const list = focusables(dialog);
      if (!list.length) return;
      e.preventDefault();
      const at = list.indexOf(document.activeElement);
      const step = e.shiftKey ? -1 : 1;
      const next = at < 0 ? (e.shiftKey ? list.length - 1 : 0) : (at + step + list.length) % list.length;
      list[next].focus();
    },
  }, sheet);
  overlayReturn = document.activeElement;
  root.appendChild(dialog);
  // The sheet itself first: a screen reader reads the title before the controls.
  sheet.focus();
  return sheet;
}

function openShortcuts() {
  const keys = [
    ['Space / → / Enter', 'stage.key_primary'],
    ['←', 'stage.key_back'],
    ['F', 'stage.fullscreen'],
    ['L', 'stage.ranking'],
    ['M', 'stage.key_mute'],
    ['G', 'panel.grading_pick'],
    ['?', 'stage.key_help'],
  ];
  overlay('stage.shortcuts_title', el('ul', { class: 'keys' }, keys.map(([k, key]) => el('li', {}, [
    el('kbd', { text: k }),
    el('span', { text: t(key) }),
  ]))));
}

/** The reveal scene's own grading panel, when it is the one on screen. */
function inlineGradeList() {
  const center = $('#s-center');
  return center ? center.querySelector('.grade-list') : null;
}

/**
 * Grading is reachable for *any* answered open question, not only the one on
 * screen: a host who moved on had no way back before (P2-11).
 */
async function openGrading(ctx) {
  // Two panels with two `grades` maps meant that marking a group inline,
  // opening `G` and saving from the overlay silently discarded the inline work
  // and left the stage showing two verdicts for one answer. So `G` reaches for
  // the panel already on the scene first; only from inside it does a second
  // press open the picker, which is the one thing the inline panel cannot do
  // (grade an *earlier* question).
  const inline = inlineGradeList();
  if (inline && !ctx.gradeFocused) {
    ctx.gradeFocused = true;
    (inline.querySelector('.group-row button') || inline).focus();
    toast(t('panel.grading_here'));
    return;
  }
  const body = el('div', {});
  overlay('panel.grading_pick', body);
  try {
    // Refetched every time the overlay opens: the cached copy was loaded when
    // the stage started, so the picker always advertised "0 answers" and told
    // the presenter there was nothing to grade.
    ctx.quiz = await rooms.hostQuiz(ctx.code, ctx.hostToken);
    const open = (ctx.quiz.questions || []).filter((q) => q.type === 'open_text');
    if (!open.length) {
      body.appendChild(el('p', { class: 'muted', text: t('panel.grading_none') }));
      return;
    }
    const picker = el('div', { class: 'grade-pick' });
    const host = el('div', {});
    body.append(picker, host);
    const load = async (q) => {
      host.innerHTML = '';
      const data = await rooms.hostAnswers(ctx.code, ctx.hostToken, q.id);
      host.appendChild(el('h3', { text: q.prompt }));
      host.appendChild(gradingBlock(ctx, q.id, data.groups || [], data.answerKey, { titled: false }));
    };
    open.forEach((q, i) => {
      picker.appendChild(el('button', {
        class: 'btn btn-sm btn-secondary',
        type: 'button',
        text: `${i + 1}. ${q.prompt.slice(0, 40)} · ${t('panel.grading_answers', { count: q.answerCount })}`,
        onclick: () => load(q).catch((e) => toast(errorMessage(e), 'error')),
      }));
    });
    await load(open.find((q) => q.id === (ctx.state && ctx.state.question && ctx.state.question.id)) || open[0]);
    // The rows arrive after the sheet: put the presenter on the first mark
    // button so grading is a keyboard job from the first keystroke.
    const first = host.querySelector('.group-row button');
    if (first) first.focus();
  } catch (e) {
    toast(errorMessage(e), 'error');
  }
}

/* ------------------------------------------------------------------- timer */

/** Seconds left when the clock stops ticking and starts insisting. */
const URGENT_FROM = 5;

/** Animates the timer ring between polls. */
function tickTimer(ctx) {
  const state = ctx.state;
  const ring = $('#s-ring');
  if (ring && state && state.state === 'answering' && state.question && state.startedAt) {
    const total = state.question.timeLimit * 1000;
    const remaining = Math.max(0, total - (Date.now() + ctx.serverOffset - state.startedAt));
    paintRing(ring, remaining, total);
    ring.setAttribute('aria-label', t('panel.time_left', { seconds: Math.ceil(remaining / 1000) }));
    // One beep per whole second inside the last five, and only while the clock
    // is really running: the room hears the round ending instead of watching a
    // ring nobody at the back can resolve.
    const second = Math.ceil(remaining / 1000);
    if (remaining > 0 && second <= URGENT_FROM && ctx.urgentAt !== second) {
      ctx.urgentAt = second;
      sfx.urgent();
    }
    if (second > URGENT_FROM) ctx.urgentAt = null;
  }
  requestAnimationFrame(() => tickTimer(ctx));
}
