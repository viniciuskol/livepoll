// Player page: the phone as a game controller (SPEC-UX). The prompt lives on
// the stage; this screen gives the command, the feedback and the bragging.
import { initI18n, t, onLangChange } from './i18n.js';
import { $, el, show, toast, optionButton, optionLabel, SHAPES, ringSvg, paintRing } from './ui.js';
import { mountMuteButton, sfx, vibrate, confetti, floatEmoji, reducedMotion } from './fx.js';
import { rooms, errorMessage } from './api.js';
import { createPoller } from './poll.js';

const EMOJIS = ['👏', '🔥', '😂', '😮', '❤️', '🎉', '🤯', '👍'];
/** Mirrors the `maxlength` the server enforces on an open answer. */
const OPEN_MAX = 200;
/** How long before zero a marked-but-unconfirmed phone is warned. */
const CONFIRM_WARN_MS = 5000;
/** ...and how long before zero those marks are sent for the player. The server
 *  allows 400ms of clock skew (play.js GRACE_MS), so this stays inside it. */
const AUTOSEND_MS = 250;
const STORAGE = 'livepoll.player';

await initI18n();
mountMuteButton($('#mute'), () => t('common.mute_toggle'));

const ctx = {
  code: '',
  playerToken: '',
  nickname: '',
  avatar: '',
  state: null,
  serverOffset: 0,
  selection: new Set(),
  roundKey: null,
  submitted: false,
  timeUp: false,
  questionId: null,
  seenReactions: Date.now(),
  sceneKey: null,
  shownReveal: null,
  poller: null,
};

const params = new URLSearchParams(location.search);
$('#code').value = (params.get('code') || '').toUpperCase();
$('#nickname').value = params.get('nickname') || '';
$('#code').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
});

// Resume a previous session in the same room.
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE) || 'null');
  if (saved && saved.code && (!$('#code').value || saved.code === $('#code').value)) {
    $('#code').value = saved.code;
    $('#nickname').value = saved.nickname || '';
    enterRoom(saved.code, saved.playerToken, saved.nickname, saved.avatar);
  }
} catch { /* ignore */ }

$('#join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('#code').value.trim().toUpperCase();
  const nickname = $('#nickname').value.trim();
  const btn = $('#join-btn');
  btn.disabled = true;
  btn.textContent = t('play.joining');
  try {
    // A finished session is checked before we try to join: POSTing into it
    // answers 409, which the browser also logs as a console error, and the
    // generic "not possible right now" toast said nothing useful (P2-9).
    const room = await rooms.state(code);
    if (room && room.state === 'ended') {
      toast(t('play.session_over'), 'error');
      return;
    }
    const res = await rooms.join(code, nickname);
    localStorage.setItem(STORAGE, JSON.stringify({
      code, playerToken: res.playerToken, nickname: res.nickname, avatar: res.avatar,
    }));
    sfx.join();
    vibrate(30);
    enterRoom(code, res.playerToken, res.nickname, res.avatar);
  } catch (err) {
    toast(err && err.code === 'ROOM_ENDED' ? t('play.session_over') : errorMessage(err), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = t('play.join_btn');
  }
});

function enterRoom(code, playerToken, nickname, avatar) {
  ctx.code = code;
  ctx.playerToken = playerToken;
  ctx.nickname = nickname;
  ctx.avatar = avatar || '';
  show($('#join-view'), false);
  show($('#join-topbar'), false);
  show($('#game-view'), true);
  document.body.classList.add('ctrl-on');
  paintIdentity({ nickname, avatar: ctx.avatar });
  mountReactions();
  const paintMute = mountMuteButton($('#p-mute'), () => t('common.mute_toggle'));
  ctx.poller = createPoller(
    () => rooms.state(code, ctx.state ? ctx.state.version : null, playerToken),
    render,
    (e) => { const m = errorMessage(e); if (m) toast(m, 'error'); }
  );
  ctx.poller.start();
  onLangChange(() => { paintMute(); if (ctx.state) render(ctx.state, true); });
  requestAnimationFrame(tickTimer);
}

function mountReactions() {
  const wrap = $('#reactions');
  wrap.innerHTML = '';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', t('play.reactions'));
  EMOJIS.forEach((emoji) => {
    wrap.appendChild(el('button', {
      type: 'button',
      text: emoji,
      'aria-label': emoji,
      onclick: async () => {
        floatEmoji(emoji, 2);
        sfx.click();
        try { await rooms.reaction(ctx.code, ctx.playerToken, emoji); } catch { /* non critical */ }
      },
    }));
  });
}

/** Floats only the reaction bubbles we have not shown yet. */
function floatNewReactions(reactions) {
  const list = reactions || [];
  list.forEach((r) => { if (r.at > ctx.seenReactions) floatEmoji(r.emoji, 1); });
  if (list.length) ctx.seenReactions = Math.max(ctx.seenReactions, ...list.map((r) => r.at));
}

function paintIdentity(me) {
  const nickname = (me && me.nickname) || ctx.nickname;
  $('#p-avatar').textContent = (me && me.avatar) || ctx.avatar || '🙂';
  $('#p-nick').textContent = nickname;
  $('.ctrl-me').setAttribute('aria-label', t('play.you_are', { nickname }));
  $('#p-score').textContent = String((me && me.score) || 0);
  $('#p-rank').textContent = t('play.rank', { rank: (me && me.rank) || '-' });
}

/**
 * Lightweight `unchanged` poll response: nothing about the room moved, so only
 * the identity bar and the reaction bubbles are refreshed. Rank is not part of
 * this payload (it cannot change without a version bump), so the value already
 * on screen is kept.
 */
function applyUnchanged(state) {
  ctx.serverOffset = state.serverNow - Date.now();
  if (ctx.state) {
    if (state.me) ctx.state.me = { ...(ctx.state.me || {}), ...state.me };
    ctx.state.serverNow = state.serverNow;
  }
  const me = (ctx.state && ctx.state.me) || state.me || {};
  paintIdentity({ ...me, rank: me.rank });
  floatNewReactions(state.reactions);
}

function render(state, force = false) {
  if (!state) return;
  if (state.unchanged) { applyUnchanged(state); return; }
  const prev = ctx.state;
  ctx.state = state;
  ctx.serverOffset = state.serverNow - Date.now();
  const me = state.me || {};
  if (me.avatar) ctx.avatar = me.avatar;
  paintIdentity(me);
  floatNewReactions(state.reactions);

  const q = state.question;
  // A *round* is a question plus the clock it was opened with, not just the
  // question: when the presenter walks back out of `answering` the server
  // throws the answers away and stamps a new `startedAt`, so the same question
  // comes back as a new round. Keying the reset on the question id alone left
  // `submitted`/`timeUp` set, and the phone showed "answer locked in" for a
  // round it had no answer in - the options never came back and the player
  // could only score again by reloading the page.
  const roundKey = q ? `${q.id}:${state.startedAt || 0}` : null;
  if (roundKey !== ctx.roundKey) {
    ctx.roundKey = roundKey;
    ctx.questionId = q ? q.id : null;
    ctx.selection = new Set();
    ctx.submitted = false;
    ctx.timeUp = false;
    ctx.confirmWarned = false;
    ctx.autoSent = false;
  }
  if (me.answered) ctx.submitted = true;

  $('#game-view').setAttribute('data-state', state.state);
  // The accessibility prompt is part of the scene identity: toggled mid-question
  // it used to leave the old scene on screen, so turning the setting *off* left
  // the prompt sitting on every phone.
  const prompt = state.settings && state.settings.showPromptOnPhone ? 'p' : '';
  const key = [state.state, q ? q.id : 0, ctx.submitted ? 'sent' : '', ctx.timeUp ? 'up' : '', prompt].join('|');
  if (key !== ctx.sceneKey || force) {
    ctx.sceneKey = key;
    const center = $('#p-center');
    center.innerHTML = '';
    center.classList.toggle('top', state.state === 'answering' || state.state === 'leaderboard');
    center.appendChild(buildScene(state));
  } else {
    patchScene(state);
  }

  if (state.state === 'reveal' && ctx.shownReveal !== (q && q.id)) {
    ctx.shownReveal = q ? q.id : null;
    revealFeedback(state);
  }
  if (state.state !== 'reveal' && ctx.shownReveal && state.state !== 'leaderboard') ctx.shownReveal = null;

  if (state.state === 'ended' && (!prev || prev.state !== 'ended')) {
    const top3 = (me.rank || 99) <= 3;
    if (top3) confetti(2400);
    sfx.podium();
  }
  // Nothing else will ever change: stop hammering the server.
  if (state.state === 'ended' && ctx.poller) ctx.poller.stop();
}

/* ------------------------------------------------------------------ scenes */

function buildScene(state) {
  switch (state.state) {
    case 'reading': return sceneReading(state);
    case 'answering': return ctx.submitted || ctx.timeUp ? sceneWaiting(state) : sceneAnswering(state);
    case 'reveal': return sceneReveal(state);
    case 'leaderboard': return sceneLeaderboard(state);
    case 'block_intro': return sceneBlockIntro(state);
    case 'ended': return sceneEnded(state);
    default: return sceneLobby(state);
  }
}

function patchScene(state) {
  const count = $('#p-count');
  if (count) count.textContent = t('play.waiting_others', { count: state.answerCount, total: state.playerCount });
}

/**
 * The three pulsing orbs from the redesign: "something is coming" without a
 * fake progress bar. Decorative dots plus one real, translated sentence.
 */
function waitOrbs(text) {
  return el('div', { class: 'ctrl-wait' }, [
    el('span', { class: 'orb', 'aria-hidden': 'true' }),
    el('span', { class: 'orb', 'aria-hidden': 'true' }),
    el('span', { class: 'orb', 'aria-hidden': 'true' }),
    el('span', { text }),
  ]);
}

function sceneLobby(state) {
  return el('div', { class: 'watch' }, [
    el('div', { class: 'ctrl-big', 'aria-hidden': 'true', text: ctx.avatar || '🙂' }),
    el('h1', { class: 'ctrl-title', text: t('play.waiting_title') }),
    el('p', { class: 'ctrl-note', text: t('play.waiting_desc') }),
    waitOrbs(t('play.waiting_host')),
  ]);
}

function sceneReading(state) {
  const showPrompt = state.settings && state.settings.showPromptOnPhone && state.question && state.question.prompt;
  return el('div', { class: 'watch' }, [
    el('div', { class: 'eyes', 'aria-hidden': 'true', text: '👀' }),
    el('h1', { class: 'ctrl-title', text: t('play.look_at_stage') }),
    // No prompt and no options here: that is what stops the room from looking
    // the answer up while the presenter is still reading.
    showPrompt ? el('p', { class: 'ctrl-prompt', text: state.question.prompt }) : null,
    waitOrbs(t('play.look_hint')),
  ]);
}

function sceneBlockIntro(state) {
  return el('div', { class: 'watch' }, [
    el('div', { class: 'ctrl-big', 'aria-hidden': 'true', text: '🚩' }),
    el('h1', { class: 'ctrl-title', text: t('play.new_block') }),
    el('p', { class: 'ctrl-note', text: state.blockName || t('play.get_ready') }),
  ]);
}

function sceneAnswering(state) {
  const q = state.question || {};
  const showPrompt = state.settings && state.settings.showPromptOnPhone && q.prompt;
  // `ctrl-scene`, not `summary`: a flex column whose option grid absorbs the
  // slack of the whole centre region. Four 72px buttons used to leave 290px of
  // unused screen right where the player's thumbs are.
  const scene = el('div', { class: 'ctrl-scene' });
  scene.appendChild(el('div', { class: 'ctrl-ring' }, [
    ringSvg('p-ring'),
    el('span', { class: 'count', id: 'p-count', text: t('play.waiting_others', { count: state.answerCount, total: state.playerCount }) }),
  ]));
  if (showPrompt) scene.appendChild(el('p', { class: 'ctrl-prompt', text: q.prompt }));

  if (q.type === 'open_text') {
    scene.classList.add('open');
    const chars = el('span', { class: 'open-chars', 'aria-live': 'off' });
    const input = el('input', {
      id: 'open-text', class: 'open-input', type: 'text', maxlength: String(OPEN_MAX),
      autocomplete: 'off', autocapitalize: 'sentences',
      placeholder: t('play.open_placeholder'), 'aria-label': t('play.open_placeholder'),
      'aria-describedby': 'open-chars',
    });
    const send = el('button', {
      class: 'btn btn-block', id: 'submit-btn', type: 'button',
      text: t('play.submit'), onclick: () => submitAnswer(),
    });
    // The counter is the only thing standing between a player and a silently
    // truncated answer: `maxlength` stops the typing without saying why.
    const paintChars = () => {
      const n = input.value.length;
      chars.textContent = `${n}/${OPEN_MAX}`;
      chars.setAttribute('aria-label', t('play.chars_used', { count: n, max: OPEN_MAX }));
      chars.classList.toggle('full', n >= OPEN_MAX);
      send.disabled = input.value.trim().length === 0;
    };
    input.addEventListener('input', paintChars);
    // Enter is `send` on a phone keyboard; without this the player has to
    // dismiss the keyboard first to reach a button the keyboard is covering.
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitAnswer(); } });
    scene.append(
      el('div', { class: 'ctrl-big', 'aria-hidden': 'true', text: '✍️' }),
      el('p', { class: 'ctrl-note', text: t('play.answer_hint_open') }),
      el('div', { class: 'open-field' }, [input, el('span', { id: 'open-chars' }, chars)]),
      send
    );
    paintChars();
    return scene;
  }

  const multi = q.type === 'multiple_select';
  // `many`: above four options the desktop console drops back to one column -
  // a 2x3 grid makes every target too short for a thumb. Real spreadsheet
  // content reaches five and six options; the prototype never had more than four.
  const optionCount = (q.options || []).length;
  // `tf`: two targets, shape over word, each one owning half the scene - the
  // explicit type branch PORT-PLAN D3 asks for, instead of two cards that
  // happen to be alone because `options.length <= 2`.
  const gridCls = ['ctrl-opts'];
  if (q.type === 'true_false') gridCls.push('tf');
  if (optionCount > 4) gridCls.push('many');
  if (multi) gridCls.push('multi');
  const grid = el('div', { class: gridCls.join(' '), id: 'options' });
  (q.options || []).forEach((option, i) => {
    const btn = optionButton(q, option, i, () => {
      if (ctx.submitted || ctx.timeUp) return;
      // Marking an option is not the same gesture as pressing a button, so it
      // does not get the same sound.
      sfx.pick();
      vibrate(12);
      if (multi) {
        if (ctx.selection.has(option.position)) ctx.selection.delete(option.position);
        else ctx.selection.add(option.position);
        paintSelection();
      } else {
        ctx.selection = new Set([option.position]);
        paintSelection();
        // The pick is locked in the same frame it happens: the submit is a
        // round trip, and until it lands the other options were still live,
        // still focusable and still silent to a screen reader.
        lockOptions(grid, btn, optionLabel(q, option), scene);
        submitAnswer();
      }
    });
    grid.appendChild(btn);
  });
  scene.append(
    el('p', { class: 'ctrl-hint', text: multi ? t('play.select_hint_multi') : t('play.select_hint_single') }),
    grid
  );
  // Multiple selection needs an explicit confirmation, and it needs it to be
  // visible: without it the first tap would end the answer and nobody would
  // ever mark the second. The count next to the button is what makes the
  // button look required rather than optional - a marked-but-unconfirmed phone
  // is the one way to lose a question you actually knew.
  if (multi) {
    scene.appendChild(el('div', { class: 'confirm-bar' }, [
      el('span', { class: 'count', id: 'p-marked', role: 'status' }),
      el('button', {
        class: 'btn btn-block', id: 'submit-btn', type: 'button',
        text: t('play.submit'), onclick: () => submitAnswer(),
      }),
    ]));
  }
  // The options landing in the hand get a short buzz.
  vibrate(18);
  paintSelection(grid);
  return scene;
}

function paintSelection(root) {
  const grid = root || $('#options');
  if (!grid) return;
  [...grid.children].forEach((btn) => {
    const position = Number(btn.getAttribute('data-position'));
    btn.setAttribute('aria-pressed', String(ctx.selection.has(position)));
  });
  paintConfirm(grid);
}

/**
 * The confirm bar's own state. `n` marks and nothing sent is a *pending*
 * answer, not an answer, so the bar says so and the button is only live once
 * there is something to send.
 */
function paintConfirm(grid) {
  const scene = grid && grid.parentNode;
  const bar = scene && scene.querySelector('.confirm-bar');
  if (!bar) return;
  const n = ctx.selection.size;
  const count = bar.querySelector('.count');
  const send = bar.querySelector('#submit-btn');
  if (count) count.textContent = n ? t('play.marked_count', { count: n }) : '';
  bar.classList.toggle('pending', n > 0 && !ctx.submitted);
  if (send) send.disabled = n === 0;
}

/**
 * Freezes the option grid on the chosen answer: the pick keeps the white ring,
 * the rest fade (desaturated and *lifted*, never dimmed - the player still
 * wants to read what else was on offer), get `aria-disabled` and leave the tab
 * cycle. The choice itself is announced into the polite region (D6).
 */
function lockOptions(grid, chosen, label, scene) {
  if (!grid) return;
  [...grid.children].forEach((btn) => {
    if (btn === chosen) { btn.classList.add('picked'); return; }
    btn.classList.add('faded');
    btn.setAttribute('aria-disabled', 'true');
    btn.tabIndex = -1;
  });
  if (scene && label) {
    scene.appendChild(el('p', { class: 'sr-only', role: 'status', text: t('play.answer_sent', { answer: label }) }));
  }
}

/** After answering: the chosen shape plus a live counter, never a dead screen. */
function sceneWaiting(state) {
  const q = state.question || {};
  const chosen = [...(ctx.selection.size ? ctx.selection : new Set(((state.me || {}).answered || {}).choice || []))];
  const index = (q.options || []).findIndex((o) => o.position === chosen[0]);
  const answered = (state.me || {}).answered || {};
  const body = [];
  if (ctx.timeUp && !ctx.submitted) {
    body.push(el('div', { class: 'ctrl-big', 'aria-hidden': 'true', text: '⏱️' }));
    body.push(el('h1', { class: 'ctrl-title', text: t('play.time_up') }));
  } else {
    if (index >= 0) {
      body.push(el('div', { class: `sent-wrap opt opt-${index + 1}` },
        el('span', { class: `sent-shape ${SHAPES[index % SHAPES.length]}`, 'aria-hidden': 'true' })));
      body.push(el('p', { class: 'ctrl-prompt', text: optionLabel(q, (q.options || [])[index]) }));
    } else if (answered.text) {
      body.push(el('div', { class: 'ctrl-big', 'aria-hidden': 'true', text: '✍️' }));
      body.push(el('p', { class: 'ctrl-prompt', text: answered.text }));
    }
    body.push(el('h1', { class: 'ctrl-title', text: t('play.locked_in') }));
  }
  body.push(el('p', { class: 'ctrl-note', id: 'p-count', text: t('play.waiting_others', { count: state.answerCount, total: state.playerCount }) }));
  return el('div', { class: 'sent-card' }, body);
}

/**
 * What a multiple_select answer was actually worth, from data the phone already
 * has: at the reveal the payload carries `question.correct`, and `me.answered`
 * carries what was marked. The server reports `correct: true` for any ratio
 * above zero, so without this a player who found one of two right answers and
 * banked half the points is told "Correct!" - and so is a player who found one
 * right answer and one wrong one.
 */
function markRecap(q, answered) {
  if (!q || q.type !== 'multiple_select') return null;
  const options = q.options || [];
  const correct = new Set(q.correct || []);
  if (!options.length || !correct.size || !answered) return null;
  const chosen = new Set(answered.choice || []);
  const hits = [...chosen].filter((c) => correct.has(c)).length;
  const misses = chosen.size - hits;
  return {
    options, correct, chosen, hits, misses, total: correct.size,
    partial: hits > 0 && (hits < correct.size || misses > 0),
  };
}

/**
 * The player's own marks, replayed. Right marks keep their ring, wrong marks
 * desaturate, and a correct option that was never marked gets `.opt.partial` -
 * the amber ring is exactly "neither credited nor penalised", which is what the
 * missed half of a partial answer is. (`.opt.partial` is declared and never
 * used in the prototype; this is the real use PORT-PLAN D5 asks for.)
 */
function recapNode(recap) {
  const list = el('div', { class: 'ctrl-recap', role: 'list', 'aria-label': t('play.recap_title') });
  recap.options.forEach((option, i) => {
    const isRight = recap.correct.has(option.position);
    const picked = recap.chosen.has(option.position);
    // Only the rows that say something: what was marked, plus what should have
    // been. The options the player correctly left alone are not news.
    if (!picked && !isRight) return;
    const kind = picked ? (isRight ? 'is-correct' : 'is-wrong') : 'partial';
    const mark = picked ? (isRight ? 'ok' : 'no') : 'miss';
    const glyph = mark === 'ok' ? '\u2713' : (mark === 'no' ? '\u2715' : '\u25cb');
    const label = mark === 'ok' ? 'panel.verdict_accepted'
      : (mark === 'no' ? 'panel.verdict_rejected' : 'play.recap_missed');
    list.appendChild(el('span', { class: `opt opt-${i + 1} ${kind}`, role: 'listitem' }, [
      el('span', { class: `shape ${SHAPES[i % SHAPES.length]}`, 'aria-hidden': 'true' }),
      el('span', { class: 'txt', text: option.text }),
      el('span', { class: `mark ${mark}`, 'aria-hidden': 'true', text: glyph }),
      el('span', { class: 'sr-only', text: t(label) }),
    ]));
  });
  return list.childElementCount ? list : null;
}

function sceneReveal(state) {
  const me = state.me || {};
  const answered = me.answered;
  const recap = markRecap(state.question, answered);
  const body = [];
  if (!answered) {
    body.push(el('div', { class: 'ctrl-big', 'aria-hidden': 'true', text: '⏱️' }));
    body.push(el('h1', { class: 'ctrl-title', text: t('play.time_up') }));
  } else if (answered.graded === false) {
    body.push(el('div', { class: 'ctrl-big', 'aria-hidden': 'true', text: '✍️' }));
    body.push(el('h1', { class: 'ctrl-title', text: t('play.pending_grade') }));
  } else if (answered.correct && recap && recap.partial) {
    // Neither green nor red. Telling someone who got half of it right that they
    // were simply wrong is what kills the willingness to risk a second mark.
    body.push(el('div', { class: 'ctrl-big', 'aria-hidden': 'true', text: '🌗' }));
    body.push(el('h1', { class: 'ctrl-title warn', text: t('play.partial') }));
    body.push(el('div', { class: 'points partial', id: 'p-points', text: '0' }));
    body.push(el('p', { class: 'ctrl-note', text: t('play.partial_note', { hits: recap.hits, total: recap.total }) }));
  } else if (answered.correct) {
    body.push(el('div', { class: 'ctrl-big', 'aria-hidden': 'true', text: '✅' }));
    body.push(el('h1', { class: 'ctrl-title ok', text: t('play.correct') }));
    body.push(el('div', { class: 'points', id: 'p-points', text: '0' }));
  } else {
    body.push(el('div', { class: 'ctrl-big', 'aria-hidden': 'true', text: '❌' }));
    body.push(el('h1', { class: 'ctrl-title bad', text: t('play.wrong') }));
  }
  const badges = el('div', { class: 'badges' });
  // A correct answer always says something about the run it just started: the
  // streak badge only appeared from 2 onwards, so the first correct answer of
  // the game - the most triumphant moment a player has - was labelled
  // "Position held".
  if (me.streak > 1) {
    badges.appendChild(el('span', { class: 'badge fire', text: `🔥 ${t('play.streak_fire', { streak: me.streak })}` }));
  } else if (me.streak === 1 && answered && answered.correct) {
    const firstEver = (me.bestStreak || 0) <= 1;
    badges.appendChild(el('span', {
      class: 'badge spark',
      text: firstEver ? `🎯 ${t('play.first_blood')}` : `✨ ${t('play.streak_started')}`,
    }));
  }
  // "Position held" is worth saying when nothing else happened; next to a fresh
  // streak it is just noise stealing the moment.
  if (Number(me.rankDelta) || badges.childElementCount === 0) badges.appendChild(deltaBadge(me.rankDelta));
  badges.appendChild(el('span', { class: 'badge', text: t('play.rank', { rank: me.rank || '-' }) }));
  const marks = answered && recap ? recapNode(recap) : null;
  if (marks) body.push(marks);
  body.push(badges);
  return el('div', { class: 'sent-card' }, body);
}

function deltaBadge(delta) {
  const n = Number(delta) || 0;
  if (!n) return el('span', { class: 'badge', text: t('play.delta_hold') });
  const up = n > 0;
  return el('span', {
    class: `badge ${up ? 'up' : 'down'}`,
    text: `${up ? '↑' : '↓'} ${t(up ? 'play.delta_up' : 'play.delta_down', { count: Math.abs(n) })}`,
  });
}

/** Flash, haptics, sound and the points counting up. */
function revealFeedback(state) {
  const me = state.me || {};
  const answered = me.answered;
  if (!answered || answered.graded === false) return;
  const recap = markRecap(state.question, answered);
  if (answered.correct) {
    // Partial credit gets the amber flash and the shorter buzz: the celebration
    // has to be smaller than the one a complete answer earns, or "almost" and
    // "right" feel identical and the second mark stops being worth risking.
    const half = recap && recap.partial;
    flash(half ? 'warn' : 'ok');
    sfx.correct();
    vibrate(half ? [16, 40, 16] : [18, 40, 26]);
    countUp($('#p-points'), Number(answered.points) || 0);
  } else {
    flash('bad');
    sfx.wrong();
    vibrate(140);
  }
}

function flash(kind) {
  const node = $('#flash');
  if (!node || reducedMotion()) return;
  node.className = `flash ${kind}`;
  show(node, true);
  void node.offsetWidth;
  node.classList.add('run');
  setTimeout(() => { show(node, false); node.classList.remove('run'); }, 800);
}

/** Points ticking up from zero - the little dopamine hit of the reveal. */
function countUp(node, target) {
  if (!node) return;
  const label = (value) => t('play.points_earned', { points: value });
  if (reducedMotion() || target <= 0) { node.textContent = label(target); return; }
  const started = performance.now();
  const duration = 700;
  const step = (now) => {
    const p = Math.min(1, (now - started) / duration);
    node.textContent = label(Math.round(target * (1 - (1 - p) ** 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function sceneLeaderboard(state) {
  const rows = state.leaderboard || [];
  const meId = (state.me || {}).id;
  const list = el('ol', { class: 'ctrl-lb' });
  if (!rows.length) list.appendChild(el('li', { text: t('lb.empty') }));
  rows.slice(0, 10).forEach((p) => {
    list.appendChild(el('li', { class: `${p.rank === 1 ? 'top1' : ''}${p.id === meId ? ' me' : ''}`.trim() }, [
      el('span', { class: 'lb-rank', text: String(p.rank) }),
      el('span', { 'aria-hidden': 'true', text: p.avatar || '🙂' }),
      el('span', { class: 'name', text: p.id === meId ? `${p.nickname} (${t('lb.you')})` : p.nickname }),
      el('span', { class: 'lb-score', text: String(p.score) }),
    ]));
  });
  const scene = el('div', { class: 'summary' }, [
    el('h1', { class: 'ctrl-title', text: t('lb.title') }),
    list,
    waitOrbs(t('play.next_coming')),
  ]);
  // Keep the player's own row on screen even in a crowded room.
  requestAnimationFrame(() => {
    const mine = scene.querySelector('li.me');
    if (mine) mine.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  });
  return scene;
}

/**
 * Personal end-of-game card. This used to never render: `render` caught
 * `ended` in the "no question" branch and hid #feedback before the ended
 * branch could run (P2-2). It is now a scene of its own.
 */
function sceneEnded(state) {
  const me = state.me || {};
  const summary = me.summary || { correct: 0, answered: 0, bestStreak: me.bestStreak || 0, score: me.score || 0 };
  // Three stats side by side instead of three stacked rows: the whole card
  // fits a 375x667 screen without scrolling, and the score keeps the big type
  // to itself.
  const stat = (labelKey, value) => el('div', { class: 'sum-stat' }, [
    el('div', { class: 'v', text: String(value) }),
    el('div', { class: 'k', text: t(labelKey) }),
  ]);
  return el('div', { class: 'summary' }, [
    el('div', { class: 'ctrl-big', 'aria-hidden': 'true', text: (me.rank || 99) <= 3 ? '🏆' : '🏁' }),
    el('h1', { class: 'ctrl-title', text: t('play.ended_title') }),
    el('div', { class: 'points', text: String(summary.score) }),
    el('p', { class: 'ctrl-note', text: t('play.summary_title') }),
    el('div', { class: 'sum-stats' }, [
      stat('play.summary_correct', `${summary.correct}/${state.totalQuestions || summary.answered}`),
      stat('play.summary_streak', summary.bestStreak),
      stat('play.summary_rank', me.rank || '-'),
    ]),
    el('p', { class: 'ctrl-note', text: t('play.ended_desc') }),
  ]);
}

/* ------------------------------------------------------------------ actions */

async function submitAnswer() {
  const state = ctx.state;
  if (!state || !state.question || ctx.submitted || ctx.timeUp) return;
  const q = state.question;
  const payload = { playerToken: ctx.playerToken, questionId: q.id };
  if (q.type === 'open_text') {
    const input = $('#open-text');
    const text = input ? input.value.trim() : '';
    if (!text) { toast(t('err.answer_required'), 'error'); return; }
    payload.text = text;
  } else {
    if (!ctx.selection.size) { toast(t('err.answer_required'), 'error'); return; }
    payload.choice = [...ctx.selection];
  }
  ctx.submitted = true;
  try {
    await rooms.answer(ctx.code, payload);
    vibrate(24);
    sfx.click();
    render(state, true);
    ctx.poller.poke();
  } catch (err) {
    ctx.submitted = false;
    toast(errorMessage(err), 'error');
  }
}

/** Seconds left when the clock stops ticking and starts insisting. */
const URGENT_FROM = 5;

/**
 * Locks the answer UI the instant the timer reaches zero, so a late tap can no
 * longer produce a confusing TIME_UP toast (the server only tolerates a few
 * hundred ms of clock skew).
 */
function tickTimer() {
  const state = ctx.state;
  if (state && state.state === 'answering' && state.question && state.startedAt) {
    const total = state.question.timeLimit * 1000;
    const remaining = Math.max(0, total - (Date.now() + ctx.serverOffset - state.startedAt));
    const ring = $('#p-ring');
    paintRing(ring, remaining, total);
    if (ring) ring.setAttribute('aria-label', t('panel.time_left', { seconds: Math.ceil(remaining / 1000) }));
    // The phone counts the last five seconds out loud - but only while this
    // player still has something to lose by not answering.
    const second = Math.ceil(remaining / 1000);
    if (remaining > 0 && second <= URGENT_FROM && ctx.urgentAt !== second && !ctx.submitted) {
      ctx.urgentAt = second;
      sfx.urgent();
    }
    if (second > URGENT_FROM) ctx.urgentAt = null;
    // Marked but not confirmed, with the clock running out. Losing a question
    // you knew because you did not press a button nobody said was mandatory is
    // the worst way to lose a quiz, so the phone warns once and then sends the
    // marks itself - inside the server's skew allowance, before the round ends.
    const multi = state.question.type === 'multiple_select';
    if (multi && !ctx.submitted && ctx.selection.size) {
      if (remaining <= CONFIRM_WARN_MS && !ctx.confirmWarned) {
        ctx.confirmWarned = true;
        toast(t('play.confirm_now'), 'error');
        vibrate([20, 40, 20]);
        const bar = $('.confirm-bar');
        if (bar) bar.classList.add('urgent');
      }
      // No early return: the frame loop has to keep running, the send is async
      // and `submitAnswer` sets `ctx.submitted` in the same tick.
      if (remaining <= AUTOSEND_MS && !ctx.autoSent) {
        ctx.autoSent = true;
        submitAnswer();
      }
    }
    if (remaining <= 0 && !ctx.timeUp) {
      ctx.timeUp = true;
      render(state, true);
    }
  }
  requestAnimationFrame(tickTimer);
}
