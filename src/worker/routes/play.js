// Player-facing endpoints: state polling, answering, reactions.
import { json, fail, readJson, bearerToken } from '../lib/http.js';
import { getRoomByCode, getOptions, getPlayerByToken, bumpVersion, recomputePlayer } from '../lib/db.js';
import { timingSafeEqual } from '../lib/codes.js';
import { buildState, buildUnchanged } from '../lib/state.js';
import { normalizeState } from '../lib/flow.js';
import { scoreAnswer, correctnessRatio, normalizeText } from '../lib/scoring.js';
import { sanitizeAnswerText } from '../lib/text.js';

const ALLOWED_EMOJI = ['👏', '🔥', '😂', '😮', '❤️', '🎉', '🤯', '👍'];
// Clock-skew allowance only: the client disables the options the moment the
// timer reaches zero, so anything arriving later than this is a late or
// replayed request rather than an honest slow tap.
export const GRACE_MS = 400;

export async function getState(request, env, code, url) {
  const room = await getRoomByCode(env, code);
  const since = Number(url.searchParams.get('since'));
  const playerToken = url.searchParams.get('playerToken');
  // The stage is the only audience allowed to read the prompt while the room is
  // in `reading`, so it identifies itself with the host token.
  const hostToken = bearerToken(request) || url.searchParams.get('hostToken');
  const isHost = !!hostToken && timingSafeEqual(String(hostToken), String(room.host_token));
  // Hot path: nothing changed since the caller's version. Players take this
  // branch too - they get their own row plus reaction bubbles instead of a full
  // rebuild of the room state on every 700ms poll.
  if (Number.isFinite(since) && since === room.version) {
    return json(await buildUnchanged(env, room, playerToken));
  }
  return json(await buildState(env, room, { playerToken, isHost }));
}

export async function submitAnswer(request, env, code) {
  const body = await readJson(request);
  const room = await getRoomByCode(env, code);
  const player = await getPlayerByToken(env, room, body.playerToken);
  // Only the `answering` state accepts answers: during `reading` the client
  // does not even have the options yet.
  if (normalizeState(room.state) !== 'answering') fail('BAD_STATE', 'No question is currently open');

  const questionId = Number(body.questionId);
  if (!questionId || questionId !== room.current_question_id) fail('VALIDATION_ERROR', 'questionId does not match the open question');

  const question = await env.DB.prepare('SELECT * FROM questions WHERE id = ? AND room_id = ?')
    .bind(questionId, room.id).first();
  if (!question) fail('NOT_FOUND', 'Question not found');

  const existing = await env.DB.prepare('SELECT id FROM answers WHERE question_id = ? AND player_id = ?')
    .bind(questionId, player.id).first();
  if (existing) fail('ALREADY_ANSWERED', 'You already answered this question');

  const startedAt = room.question_started_at || Date.now();
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs > question.time_limit * 1000 + GRACE_MS) fail('TIME_UP', 'Time is up for this question');

  const options = await getOptions(env, questionId);
  const correctPositions = options.filter((o) => o.is_correct).map((o) => o.position);
  let answerKey = [];
  try { answerKey = JSON.parse(question.answer_key || '[]'); } catch { answerKey = []; }

  const spec = {
    type: question.type,
    points: question.points,
    timeLimit: question.time_limit,
    correct: correctPositions,
    answerKey,
  };

  let choice = [];
  let text = null;
  if (question.type === 'open_text') {
    text = sanitizeAnswerText(body.text, 200);
    if (!text) fail('VALIDATION_ERROR', 'Answer text is required', [{ field: 'text', code: 'err.answer_required' }]);
  } else {
    const raw = Array.isArray(body.choice) ? body.choice : body.choice != null ? [body.choice] : [];
    choice = [...new Set(raw.map(Number).filter((n) => options.some((o) => o.position === n)))];
    if (choice.length === 0) fail('VALIDATION_ERROR', 'A choice is required', [{ field: 'choice', code: 'err.answer_required' }]);
    if (question.type !== 'multiple_select' && choice.length > 1) {
      fail('VALIDATION_ERROR', 'Only one choice allowed', [{ field: 'choice', code: 'err.one_choice' }]);
    }
  }

  const submission = { choice, text, elapsedMs };
  let graded = 1;
  let ratio = 0;
  if (question.type === 'open_text') {
    const keys = answerKey.map(normalizeText).filter(Boolean);
    if (keys.length && keys.includes(normalizeText(text))) {
      ratio = 1;
    } else {
      const preGrade = await env.DB.prepare('SELECT correct FROM open_grades WHERE question_id = ? AND norm_text = ?')
        .bind(questionId, normalizeText(text)).first();
      if (preGrade) ratio = preGrade.correct ? 1 : 0;
      else graded = 0;
    }
  } else {
    ratio = correctnessRatio(spec, submission);
  }

  const scored = graded ? scoreAnswer(spec, submission, { ratio, previousStreak: player.streak }) : { points: 0, correct: false };
  const storedRatio = graded ? ratio : 0;

  // streak_before records the basis the points were computed from. Manual
  // grading later re-derives points from this stored value instead of from the
  // player's (by then already mutated) current streak.
  await env.DB.prepare(
    `INSERT INTO answers (room_id, question_id, player_id, choice, text, correct, points, graded, ratio, elapsed_ms, streak_before, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    room.id, questionId, player.id, JSON.stringify(choice), text,
    scored.correct ? 1 : 0, scored.points, graded, storedRatio, elapsedMs, player.streak, Date.now()
  ).run();

  await recomputePlayer(env, player.id);
  await bumpVersion(env, room.id);

  return json({ ok: true, pendingGrade: !graded, elapsedMs });
}

export async function sendReaction(request, env, code) {
  const body = await readJson(request);
  const room = await getRoomByCode(env, code);
  const player = await getPlayerByToken(env, room, body.playerToken);
  const emoji = String(body.emoji || '');
  if (!ALLOWED_EMOJI.includes(emoji)) fail('VALIDATION_ERROR', 'Unsupported emoji', [{ field: 'emoji', code: 'err.bad_emoji' }]);
  const recent = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM reactions WHERE player_id = ? AND created_at >= ?'
  ).bind(player.id, Date.now() - 5000).first();
  if ((recent && recent.n) >= 10) return json({ ok: true, throttled: true });
  const at = Date.now();
  await env.DB.prepare('INSERT INTO reactions (room_id, player_id, emoji, created_at) VALUES (?, ?, ?, ?)')
    .bind(room.id, player.id, emoji, at).run();
  // Marks the room so pollers know a reaction query is worth running at all.
  await env.DB.prepare('UPDATE rooms SET last_reaction_at = ? WHERE id = ?').bind(at, room.id).run();
  // Deliberately no bumpVersion: reactions ride the lightweight `unchanged`
  // channel, so a burst of emoji cannot force every poller into a full
  // buildState rebuild.
  return json({ ok: true });
}

export { ALLOWED_EMOJI };
