// Room lifecycle: create, host login, join, leaderboard.
import { json, fail, readJson, MAX_QUIZ_BODY_BYTES } from '../lib/http.js';
import { generateRoomCode, generateToken, hashPassword, verifyPassword, isValidRoomCode } from '../lib/codes.js';
import { validateQuiz } from '../lib/validation.js';
import { getRoomByCode, getPlayers, bumpVersion, pickAvatar, MAX_PLAYERS } from '../lib/db.js';
import { buildLeaderboard, rankOf } from '../lib/scoring.js';
import { pendingAnswers, maskPending } from '../lib/state.js';
import { sanitizeNickname, MAX_NICKNAME } from '../lib/text.js';

// Throttle for host-login attempts. In-memory (per isolate) on purpose: it
// costs no D1 writes and only has to blunt online guessing of a short room
// password.
//
// The key is (room code, client IP), never the room code alone: the code is
// public by design - it is projected on the wall and encoded in the QR - so a
// per-room counter let any member of the audience lock the presenter out of
// their own control panel with eight wrong guesses (P1-1). A correct password
// is also checked *before* the throttle and always let through, so even a
// throttled IP can still be the presenter typing the right password.
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_ATTEMPTS = 8;
const loginAttempts = new Map();

/** Client IP as seen by Cloudflare; `local` when running under wrangler dev. */
export function clientIp(request) {
  const headers = (request && request.headers) || null;
  const ip = headers ? headers.get('cf-connecting-ip') : null;
  return String(ip || 'local');
}

export function throttleKey(code, request) {
  return `${String(code || '').toUpperCase()}|${clientIp(request)}`;
}

export function loginThrottle(key, now = Date.now()) {
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt <= now) return { blocked: false, count: 0 };
  return { blocked: entry.count >= LOGIN_MAX_ATTEMPTS, count: entry.count, retryInMs: entry.resetAt - now };
}

function recordLoginFailure(key, now = Date.now()) {
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

export function clearLoginThrottle(key) {
  if (key === undefined) loginAttempts.clear();
  else loginAttempts.delete(key);
}

export async function createRoom(request, env) {
  const body = await readJson(request, MAX_QUIZ_BODY_BYTES);
  const password = String(body.password || '');
  if (password.length < 4 || password.length > 64) {
    fail('VALIDATION_ERROR', 'Password must be 4-64 characters', [{ field: 'password', code: 'err.bad_password_length' }]);
  }
  // Accessibility / remote presenting: off by default (SPEC-UX).
  const showPromptOnPhone = body.showPromptOnPhone ? 1 : 0;
  const result = validateQuiz(body.quiz);
  if (!result.ok) fail('VALIDATION_ERROR', 'Quiz payload is invalid', result.errors);

  const quiz = result.quiz;
  const hostToken = generateToken(24);
  const passwordHash = await hashPassword(password);
  const now = Date.now();

  let code = null;
  let roomId = null;
  for (let attempt = 0; attempt < 10 && !roomId; attempt++) {
    const candidate = generateRoomCode();
    try {
      const row = await env.DB.prepare(
        `INSERT INTO rooms (code, title, password_hash, host_token, state, version, show_prompt_on_phone, created_at)
         VALUES (?, ?, ?, ?, 'lobby', 1, ?, ?) RETURNING id`
      ).bind(candidate, quiz.title || '', passwordHash, hostToken, showPromptOnPhone, now).first();
      roomId = row.id;
      code = candidate;
    } catch (e) {
      if (!/UNIQUE/i.test(String(e && e.message))) throw e;
    }
  }
  if (!roomId) fail('INTERNAL', 'Could not allocate a room code');

  let blockPos = 0;
  let questionPos = 0;
  for (const block of quiz.blocks) {
    const b = await env.DB.prepare(
      'INSERT INTO blocks (room_id, name, position) VALUES (?, ?, ?) RETURNING id'
    ).bind(roomId, block.name, blockPos++).first();
    for (const q of block.questions) {
      const qr = await env.DB.prepare(
        `INSERT INTO questions (room_id, block_id, position, type, prompt, time_limit, points, image_url, explanation, answer_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
      ).bind(
        roomId, b.id, questionPos++, q.type, q.prompt, q.timeLimit, q.points,
        q.imageUrl, q.explanation, JSON.stringify(q.answerKey || [])
      ).first();
      let optPos = 1;
      for (const o of q.options) {
        await env.DB.prepare(
          'INSERT INTO options (question_id, position, text, is_correct) VALUES (?, ?, ?, ?)'
        ).bind(qr.id, optPos++, o.text, o.correct ? 1 : 0).run();
      }
    }
  }

  return json({ code, hostToken, questionCount: questionPos, blockCount: blockPos });
}

export async function hostLogin(request, env, code) {
  const body = await readJson(request);
  if (!isValidRoomCode(String(code || '').toUpperCase())) fail('ROOM_NOT_FOUND', 'Invalid room code');
  const room = await getRoomByCode(env, code);
  const key = throttleKey(code, request);
  // Verify first: the presenter typing the right password is never locked out,
  // whatever the audience has been doing with the projected room code.
  const ok = await verifyPassword(String(body.password || ''), room.password_hash);
  if (ok) {
    clearLoginThrottle(key);
    return json({ hostToken: room.host_token, code: room.code, title: room.title, state: room.state });
  }
  if (loginThrottle(key).blocked) {
    fail('TOO_MANY_ATTEMPTS', 'Too many failed attempts, try again in a minute');
  }
  recordLoginFailure(key);
  return fail('BAD_PASSWORD', 'Wrong room password');
}

export async function joinRoom(request, env, code) {
  const body = await readJson(request);
  const room = await getRoomByCode(env, code);
  if (room.state === 'ended') fail('ROOM_ENDED', 'This session is over');
  const nickname = sanitizeNickname(body.nickname, MAX_NICKNAME);
  if (nickname.length < 2) fail('VALIDATION_ERROR', 'Nickname too short', [{ field: 'nickname', code: 'err.nickname_short' }]);

  const players = await getPlayers(env, room.id);
  if (players.length >= MAX_PLAYERS) fail('ROOM_FULL', 'Room is full');
  if (players.some((p) => p.nickname.toLowerCase() === nickname.toLowerCase())) {
    fail('NICKNAME_TAKEN', 'Nickname already taken');
  }

  const token = generateToken(18);
  const avatar = pickAvatar(players.length);
  try {
    const row = await env.DB.prepare(
      'INSERT INTO players (room_id, nickname, token, avatar, joined_at) VALUES (?, ?, ?, ?, ?) RETURNING id'
    ).bind(room.id, nickname, token, avatar, Date.now()).first();
    await bumpVersion(env, room.id);
    return json({ playerId: row.id, playerToken: token, nickname, avatar, code: room.code, title: room.title });
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) fail('NICKNAME_TAKEN', 'Nickname already taken');
    throw e;
  }
}

export async function leaderboard(request, env, code, url) {
  const room = await getRoomByCode(env, code);
  // This endpoint needs no token at all, which made it the easiest oracle in the
  // API: polling it during `answering` showed exactly whose score moved, and so
  // which option was the right one, before the reveal. Like `/state`, it reports
  // the standings as they were before the question that is still open.
  const pending = await pendingAnswers(env, room);
  const players = (await getPlayers(env, room.id)).map((p) => maskPending(p, pending));
  const playerToken = url.searchParams.get('playerToken');
  let me = null;
  if (playerToken) {
    const p = await env.DB.prepare('SELECT id, nickname, score, streak FROM players WHERE room_id = ? AND token = ?')
      .bind(room.id, playerToken).first();
    if (p) { const shown = maskPending(p, pending); me = { ...shown, rank: rankOf(players, p.id) }; }
  }
  return json({
    code: room.code,
    playerCount: players.length,
    top: buildLeaderboard(players, 10).map((p) => ({
      id: p.id, nickname: p.nickname, avatar: p.avatar || '', score: p.score, streak: p.streak, rank: p.rank,
    })),
    me,
  });
}
