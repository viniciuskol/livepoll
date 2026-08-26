// Host control endpoints (Bearer hostToken).
import { json, fail, readJson, readJsonOptional } from '../lib/http.js';
import {
  getRoomByCode, getQuestions, getOptions, requireHost, bumpVersion,
  recomputePlayer, snapshotRanks,
} from '../lib/db.js';
import { buildState, groupOpenAnswers } from '../lib/state.js';
import { scoreAnswer, normalizeText } from '../lib/scoring.js';
import { normalizeState, planAdvance, planBack, planNext } from '../lib/flow.js';

/**
 * Applies one state transition, atomically.
 *
 * The UPDATE is conditional on the state *and* the version the request read a
 * moment ago, so two `advance` calls that race (a double click, or the button
 * plus the space bar) can never both win: the loser's UPDATE matches no row and
 * is reported as STALE_STATE instead of silently double-stepping the room
 * through reveal *and* leaderboard.
 */
async function commit(env, room, fields) {
  const keys = Object.keys(fields);
  const sql = `UPDATE rooms SET ${keys.map((k) => `${k} = ?`).join(', ')}, version = version + 1
                WHERE id = ? AND state = ? AND version = ?`;
  const res = await env.DB.prepare(sql)
    .bind(...keys.map((k) => fields[k]), room.id, room.state, room.version)
    .run();
  const changes = res && res.meta ? res.meta.changes : 1;
  if (changes !== 1) fail('STALE_STATE', 'The room already moved on');
}

/** Turns a flow plan into the room columns it implies. */
async function applyPlan(env, room, questions, plan) {
  const fields = { state: plan.state };
  const target = plan.index >= 0 && plan.index < questions.length ? questions[plan.index] : null;
  if (plan.state === 'ended') {
    // The finale keeps the last question loaded so a host who walks back lands
    // on the leaderboard of the question they just finished.
  } else if (target) {
    fields.current_question_id = target.id;
  } else {
    fields.current_question_id = null;
  }
  if (plan.stamp) fields.question_started_at = Date.now();
  if (plan.clearStart) fields.question_started_at = null;
  await commit(env, room, fields);

  // The question clock starts on the transition to `answering` - never when the
  // question opens (SPEC-UX anti-cheat rule).
  if (plan.stamp && target) {
    await env.DB.prepare('UPDATE questions SET started_at = ? WHERE id = ?')
      .bind(fields.question_started_at, target.id).run();
  }
  if (plan.clearStart && target) {
    await env.DB.prepare('UPDATE questions SET started_at = NULL WHERE id = ?').bind(target.id).run();
    // Walking back out of `answering` gives the clock back, so it has to give
    // the question back too. Leaving the rows in place locked whoever had
    // already tapped out of the reopened round (ALREADY_ANSWERED) while
    // everyone else got a fresh full window, and kept a speed bonus measured
    // against a `question_started_at` that no longer exists.
    const { results: hit } = await env.DB.prepare(
      'SELECT DISTINCT player_id FROM answers WHERE question_id = ?'
    ).bind(target.id).all();
    if ((hit || []).length) {
      await env.DB.prepare('DELETE FROM answers WHERE question_id = ?').bind(target.id).run();
      for (const row of hit) await recomputePlayer(env, row.player_id);
      await bumpVersion(env, room.id);
    }
  }
  // Entering the reveal freezes the movement arrows for this question.
  if (plan.state === 'reveal') {
    await snapshotRanks(env, room.id);
    await bumpVersion(env, room.id);
  }
}

export async function hostAction(request, env, code, action) {
  const room = await getRoomByCode(env, code);
  await requireHost(request, room);
  const body = await readJsonOptional(request);
  const state = normalizeState(room.state);

  // Optimistic concurrency: the stage tells the server which state it believes
  // it is in (and optionally the version it saw). A stale claim is rejected
  // before anything moves.
  if (body.from && normalizeState(body.from) !== state) {
    fail('STALE_STATE', `Room is in ${state}, not ${body.from}`);
  }
  if (body.version != null && Number(body.version) !== Number(room.version)) {
    fail('STALE_STATE', 'The room already moved on');
  }

  const questions = await getQuestions(env, room.id);
  const index = questions.findIndex((q) => q.id === room.current_question_id);

  let plan = null;
  switch (action) {
    case 'start':
      if (questions.length === 0) fail('BAD_STATE', 'Room has no questions');
      if (state !== 'lobby') fail('BAD_STATE', 'The session already started');
      plan = { state: 'reading', index: 0, clearStart: true };
      break;
    case 'advance':
      if (questions.length === 0) fail('BAD_STATE', 'Room has no questions');
      plan = planAdvance(state, index, questions);
      if (!plan) fail('BAD_STATE', 'Nothing left to advance to');
      break;
    case 'back':
      plan = planBack(state, index, questions);
      break; // a refused step is a no-op, not an error (the stage hides the key)
    case 'options':
      if (state !== 'reading') fail('BAD_STATE', 'Options can only be shown from the reading state');
      plan = { state: 'answering', index, stamp: true };
      break;
    case 'reveal':
      if (!room.current_question_id) fail('BAD_STATE', 'No open question');
      if (state !== 'answering' && state !== 'reading') fail('BAD_STATE', 'No open question');
      plan = { state: 'reveal', index };
      break;
    case 'leaderboard':
      // `leaderboard` is a revealed state: its payload carries the options and
      // the correct positions. Reachable from `reading` it was the one route
      // that published the answer to every phone while the presenter still
      // believed the room was reading - so it may only follow a reveal.
      if (room.current_question_id && !['reveal', 'leaderboard', 'ended'].includes(state)) {
        fail('BAD_STATE', 'Reveal the answer before showing the ranking');
      }
      plan = { state: 'leaderboard', index };
      break;
    case 'next':
      if (questions.length === 0) fail('BAD_STATE', 'Room has no questions');
      plan = planNext(state, index, questions);
      break;
    case 'end':
      plan = state === 'ended' ? null : { state: 'ended', index };
      break;
    default:
      fail('NOT_FOUND', `Unknown host action ${action}`);
  }

  if (plan) await applyPlan(env, room, questions, plan);

  const fresh = await getRoomByCode(env, code);
  return json(await buildState(env, fresh, { isHost: true }));
}

/** Room settings the host can flip after creation (accessibility mode). */
export async function hostSettings(request, env, code) {
  const room = await getRoomByCode(env, code);
  await requireHost(request, room);
  const body = await readJson(request);
  if (body.showPromptOnPhone === undefined) fail('VALIDATION_ERROR', 'Nothing to update');
  await env.DB.prepare('UPDATE rooms SET show_prompt_on_phone = ?, version = version + 1 WHERE id = ?')
    .bind(body.showPromptOnPhone ? 1 : 0, room.id).run();
  const fresh = await getRoomByCode(env, code);
  return json(await buildState(env, fresh, { isHost: true }));
}

/** Grouped open_text answers for manual grading. */
export async function hostAnswers(request, env, code, url) {
  const room = await getRoomByCode(env, code);
  await requireHost(request, room);
  const questionId = Number(url.searchParams.get('questionId')) || room.current_question_id;
  if (!questionId) fail('VALIDATION_ERROR', 'questionId is required');
  const question = await env.DB.prepare('SELECT * FROM questions WHERE id = ? AND room_id = ?')
    .bind(questionId, room.id).first();
  if (!question) fail('NOT_FOUND', 'Question not found');
  if (question.type !== 'open_text') {
    const options = await getOptions(env, questionId);
    const { results } = await env.DB.prepare('SELECT choice FROM answers WHERE question_id = ?').bind(questionId).all();
    const counts = options.map((o) => ({ position: o.position, text: o.text, correct: !!o.is_correct, count: 0 }));
    (results || []).forEach((a) => {
      let ch = [];
      try { ch = JSON.parse(a.choice || '[]'); } catch { ch = []; }
      ch.forEach((p) => { const c = counts.find((x) => x.position === p); if (c) c.count += 1; });
    });
    return json({ questionId, type: question.type, counts, groups: [] });
  }
  const groups = await groupOpenAnswers(env, question);
  let answerKey = [];
  try { answerKey = JSON.parse(question.answer_key || '[]'); } catch { answerKey = []; }
  return json({ questionId, type: question.type, prompt: question.prompt, answerKey, groups });
}

/** Manual grading of open_text answer groups; rescores affected players. */
export async function hostGrade(request, env, code) {
  const room = await getRoomByCode(env, code);
  await requireHost(request, room);
  const body = await readJson(request);
  const questionId = Number(body.questionId) || room.current_question_id;
  const question = await env.DB.prepare('SELECT * FROM questions WHERE id = ? AND room_id = ?')
    .bind(questionId, room.id).first();
  if (!question) fail('NOT_FOUND', 'Question not found');
  if (question.type !== 'open_text') fail('VALIDATION_ERROR', 'Only open_text questions can be graded manually');

  const groups = Array.isArray(body.groups) ? body.groups : [];
  if (!groups.length) fail('VALIDATION_ERROR', 'groups is required');
  for (const g of groups) {
    const norm = normalizeText(g.norm != null ? g.norm : g.text);
    await env.DB.prepare(
      `INSERT INTO open_grades (room_id, question_id, norm_text, correct) VALUES (?, ?, ?, ?)
       ON CONFLICT(question_id, norm_text) DO UPDATE SET correct = excluded.correct`
    ).bind(room.id, questionId, norm, g.correct ? 1 : 0).run();
  }

  const gradeRows = await env.DB.prepare('SELECT norm_text, correct FROM open_grades WHERE question_id = ?')
    .bind(questionId).all();
  const gradeMap = new Map((gradeRows.results || []).map((g) => [g.norm_text, !!g.correct]));

  const { results: answers } = await env.DB.prepare(
    `SELECT id, player_id, text, correct, points, graded, ratio, elapsed_ms, streak_before
       FROM answers WHERE question_id = ?`
  ).bind(questionId).all();

  const spec = { type: 'open_text', points: question.points, timeLimit: question.time_limit, correct: [], answerKey: [] };
  let updated = 0;
  const touched = new Set();
  for (const a of answers || []) {
    const norm = normalizeText(a.text || '');
    if (!gradeMap.has(norm)) continue;
    const isCorrect = gradeMap.get(norm);
    const ratio = isCorrect ? 1 : 0;
    // Points depend only on stored data (elapsed time and the streak basis the
    // chain rebuild derives), never on the player's live streak, so re-saving
    // the same grades is a no-op.
    const scored = scoreAnswer(spec, { elapsedMs: a.elapsed_ms }, { ratio, previousStreak: a.streak_before || 0 });
    const nextCorrect = isCorrect ? 1 : 0;
    const sameOutcome = Number(a.graded) === 1
      && Number(a.correct) === nextCorrect
      && Number(a.points) === scored.points
      && Number(a.ratio) === ratio;
    if (!sameOutcome) {
      await env.DB.prepare('UPDATE answers SET correct = ?, points = ?, ratio = ?, graded = 1 WHERE id = ?')
        .bind(nextCorrect, scored.points, ratio, a.id).run();
      updated += 1;
    }
    // The player is rebuilt either way: a grade that lands on the same points
    // for *this* answer can still be the first time the streak chain of the
    // answers that came after it is repaired.
    touched.add(a.player_id);
  }
  // Score, streak and the points of every later answer are rebuilt from the
  // answer rows in question order, so the stored state always equals a
  // from-scratch recompute however many times the host saves.
  for (const playerId of touched) await recomputePlayer(env, playerId);
  await bumpVersion(env, room.id);
  return json({ ok: true, updated });
}

/** Full quiz (including correct answers) for the host control panel. */
export async function hostQuiz(request, env, code) {
  const room = await getRoomByCode(env, code);
  await requireHost(request, room);
  const questions = await getQuestions(env, room.id);
  const out = [];
  for (const q of questions) {
    const options = await getOptions(env, q.id);
    let answerKey = [];
    try { answerKey = JSON.parse(q.answer_key || '[]'); } catch { answerKey = []; }
    const answered = await env.DB.prepare('SELECT COUNT(*) AS n FROM answers WHERE question_id = ?')
      .bind(q.id).first();
    out.push({
      id: q.id,
      blockName: q.block_name,
      type: q.type,
      prompt: q.prompt,
      timeLimit: q.time_limit,
      points: q.points,
      imageUrl: q.image_url,
      explanation: q.explanation,
      answerKey,
      answerCount: (answered && answered.n) || 0,
      options: options.map((o) => ({ position: o.position, text: o.text, correct: !!o.is_correct })),
    });
  }
  return json({ code: room.code, title: room.title, state: room.state, questions: out });
}
