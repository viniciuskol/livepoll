// Integration tests for the Worker routes against a real SQLite database
// carrying the actual migrations (see tests/helpers/d1.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv, countQueries, jsonRequest, getRequest, call } from './helpers/d1.js';
import { createRoom, joinRoom, hostLogin } from '../src/worker/routes/rooms.js';
import { getState, submitAnswer, sendReaction, GRACE_MS } from '../src/worker/routes/play.js';
import { hostAction, hostGrade, hostAnswers } from '../src/worker/routes/host.js';
import { recomputePlayer, OFFLINE_MS } from '../src/worker/lib/db.js';
import { scoreAnswer } from '../src/worker/lib/scoring.js';
import { clearLoginThrottle } from '../src/worker/routes/rooms.js';

const BASE = 'http://localhost/api/rooms';

function quiz(questions) {
  return { title: 'T', blocks: [{ name: 'B', questions }] };
}
const openQ = (prompt, points = 1000) => ({ type: 'open_text', prompt, points, timeLimit: 60, answerKey: [], options: [] });
const mcQ = (prompt, points = 1000) => ({
  type: 'multiple_choice', prompt, points, timeLimit: 60,
  options: [{ text: 'a', correct: true }, { text: 'b', correct: false }],
});

async function makeRoom(env, questions) {
  const { body } = await call(() => createRoom(jsonRequest(BASE, { password: 'secret1', quiz: quiz(questions) }), env));
  assert.ok(body.code, JSON.stringify(body));
  return body; // { code, hostToken }
}

// The clock starts on the transition to `answering`, so opening a question is
// now two steps: `reading` (prompt only, no options) then `options`.
async function beginQuestion(env, code, hostToken) {
  await call(() => hostAction(getRequest('x', { token: hostToken }), env, code, 'start'));
  await call(() => hostAction(getRequest('x', { token: hostToken }), env, code, 'options'));
}
async function nextQuestion(env, code, hostToken) {
  await call(() => hostAction(getRequest('x', { token: hostToken }), env, code, 'next'));
  await call(() => hostAction(getRequest('x', { token: hostToken }), env, code, 'options'));
}

async function join(env, code, nickname) {
  const { body } = await call(() => joinRoom(jsonRequest(`${BASE}/${code}/join`, { nickname }), env, code));
  return body;
}

const players = (env) => env.__sqlite.prepare('SELECT id, nickname, score, streak, best_streak FROM players ORDER BY id').all();
const answers = (env) => env.__sqlite.prepare('SELECT * FROM answers ORDER BY id').all();
const roomRow = (env) => env.__sqlite.prepare('SELECT * FROM rooms').get();

test('every migration applies cleanly and answers carry streak_before', () => {
  const env = createTestEnv();
  assert.ok(env.migrations.length >= 2, `migrations: ${env.migrations}`);
  const cols = env.__sqlite.prepare("SELECT name FROM pragma_table_info('answers')").all().map((c) => c.name);
  assert.ok(cols.includes('streak_before'), cols.join(','));
});

test('players.nickname uniqueness is case-insensitive at the DB level', async () => {
  const env = createTestEnv();
  const { code } = await makeRoom(env, [mcQ('Q1')]);
  const ana = await join(env, code, 'Ana');
  assert.equal(ana.nickname, 'Ana');
  // The JS pre-check rejects it...
  const dup = await call(() => joinRoom(jsonRequest(`${BASE}/${code}/join`, { nickname: 'aNA' }), env, code));
  assert.equal(dup.body.error.code, 'NICKNAME_TAKEN');
  // ...and so does the schema, which used to be case-sensitive.
  assert.throws(
    () => env.__sqlite.prepare('INSERT INTO players (room_id, nickname, token, joined_at) VALUES (1, ?, ?, ?)')
      .run('ANA', 'tok', Date.now()),
    /UNIQUE/i
  );
});

test('nicknames are stripped of markup, bidi overrides and zero-width characters', async () => {
  const env = createTestEnv();
  const { code } = await makeRoom(env, [mcQ('Q1')]);
  const spoof = `‮Ana​<b>x</b>`;
  const res = await join(env, code, spoof);
  assert.equal(res.nickname, 'Ana b x /b');
  const stored = players(env)[0].nickname;
  assert.ok(!/[‪-‮​<>]/.test(stored), `unsafe characters survived: ${JSON.stringify(stored)}`);
  // Length is capped by grapheme cluster, never mid-emoji.
  const long = await join(env, code, 'a'.repeat(40));
  assert.equal(long.nickname.length, 20);
});

test('grading the same open answers repeatedly is idempotent', async () => {
  const env = createTestEnv();
  const { code, hostToken } = await makeRoom(env, [openQ('Q1'), mcQ('Q2'), openQ('Q3')]);
  const ana = await join(env, code, 'Ana');
  const bruno = await join(env, code, 'Bruno');

  // Q1 (open): both answer, nothing is graded yet.
  await beginQuestion(env, code, hostToken);
  const q1 = roomRow(env).current_question_id;
  for (const p of [ana, bruno]) {
    const r = await call(() => submitAnswer(jsonRequest(`${BASE}/${code}/answer`, { playerToken: p.playerToken, questionId: q1, text: 'SQLite' }), env, code));
    assert.equal(r.body.pendingGrade, true, JSON.stringify(r.body));
  }
  // Q2 (multiple choice): Ana correct, so her live streak moves on.
  await nextQuestion(env, code, hostToken);
  const q2 = roomRow(env).current_question_id;
  await call(() => submitAnswer(jsonRequest('x', { playerToken: ana.playerToken, questionId: q2, choice: [1] }), env, code));
  await call(() => submitAnswer(jsonRequest('x', { playerToken: bruno.playerToken, questionId: q2, choice: [2] }), env, code));

  const grade = () => call(() => hostGrade(
    jsonRequest(`${BASE}/${code}/host/grade`, { questionId: q1, groups: [{ norm: 'sqlite', correct: true }] }, { token: hostToken }),
    env, code
  ));

  const first = await grade();
  assert.equal(first.body.updated, 2);
  const afterFirst = players(env);
  const answersAfterFirst = answers(env).map((a) => [a.id, a.correct, a.points]);
  assert.ok(afterFirst[0].score > 0);

  for (let i = 0; i < 4; i++) {
    const again = await grade();
    assert.equal(again.body.updated, 0, `save #${i + 2} rewrote rows`);
    assert.deepEqual(players(env), afterFirst, `save #${i + 2} changed a score`);
    assert.deepEqual(answers(env).map((a) => [a.id, a.correct, a.points]), answersAfterFirst);
  }

  // Flipping a grade and flipping it back also lands on the original numbers.
  await call(() => hostGrade(
    jsonRequest('x', { questionId: q1, groups: [{ norm: 'sqlite', correct: false }] }, { token: hostToken }), env, code
  ));
  assert.notDeepEqual(players(env), afterFirst);
  await grade();
  assert.deepEqual(players(env), afterFirst, 'flip back should restore the exact scores');
});

test('grading rebuilds the whole streak chain, matching a from-scratch recompute', async () => {
  const env = createTestEnv();
  const { code, hostToken } = await makeRoom(env, [openQ('Q1'), mcQ('Q2'), mcQ('Q3'), mcQ('Q4'), mcQ('Q5')]);
  const ana = await join(env, code, 'Ana');

  await beginQuestion(env, code, hostToken);
  const q1 = roomRow(env).current_question_id;
  await call(() => submitAnswer(jsonRequest('x', { playerToken: ana.playerToken, questionId: q1, text: 'D1' }), env, code));
  // Four correct answers afterwards, all scored while Q1 was still ungraded.
  for (const _ of [1, 2, 3, 4]) {
    await nextQuestion(env, code, hostToken);
    const qid = roomRow(env).current_question_id;
    await call(() => submitAnswer(jsonRequest('x', { playerToken: ana.playerToken, questionId: qid, choice: [1] }), env, code));
  }
  assert.equal(players(env)[0].streak, 4);
  // Deterministic elapsed time so the expectation below is exact.
  env.__sqlite.prepare('UPDATE answers SET elapsed_ms = 1000').run();
  await recomputePlayer(env, ana.playerId);

  const before = answers(env);
  assert.deepEqual(before.map((a) => a.streak_before), [0, 0, 1, 2, 3], 'ungraded Q1 must not count as a hit');

  await call(() => hostGrade(jsonRequest('x', { questionId: q1, groups: [{ norm: 'd1', correct: true }] }, { token: hostToken }), env, code));

  // From-scratch expectation: five hits in a row, streak basis 0..4.
  const spec = { points: 1000, timeLimit: 60 };
  const expected = [0, 1, 2, 3, 4].map((streak) => scoreAnswer(spec, { elapsedMs: 1000 }, { ratio: 1, previousStreak: streak }).points);
  const after = answers(env);
  assert.deepEqual(after.map((a) => a.streak_before), [0, 1, 2, 3, 4], 'the streak chain was not propagated');
  assert.deepEqual(after.map((a) => a.points), expected, 'points do not match a from-scratch recompute');
  assert.equal(players(env)[0].score, expected.reduce((n, p) => n + p, 0));
  assert.equal(players(env)[0].streak, 5);
  assert.equal(players(env)[0].best_streak, 5);

  // ...and the stored state is a fixed point: recomputing changes nothing.
  const snapshot = { rows: after.map((a) => [a.id, a.points, a.streak_before]), player: players(env) };
  await recomputePlayer(env, ana.playerId);
  assert.deepEqual(answers(env).map((a) => [a.id, a.points, a.streak_before]), snapshot.rows);
  assert.deepEqual(players(env), snapshot.player);
});

test('a player poll with an unchanged version short-circuits to a few queries', async () => {
  const env = createTestEnv();
  const { code, hostToken } = await makeRoom(env, [mcQ('Q1'), mcQ('Q2')]);
  const ana = await join(env, code, 'Ana');
  await beginQuestion(env, code, hostToken);

  const url = (since) => new URL(`${BASE}/${code}/state?since=${since}&playerToken=${ana.playerToken}`);
  const full = await countQueries(env, () => call(() => getState(getRequest('x'), env, code, url(1))));
  assert.equal(full.value.body.unchanged, undefined);
  const version = full.value.body.version;

  const cheap = await countQueries(env, () => call(() => getState(getRequest('x'), env, code, url(version))));
  assert.equal(cheap.value.body.unchanged, true);
  assert.ok(cheap.value.body.me, 'the player still gets their own row');
  assert.equal(cheap.value.body.me.nickname, 'Ana');
  assert.equal(cheap.value.body.state, 'answering');
  // Two queries with no live reactions (room row + the player's own row); the
  // reactions table is only touched when rooms.last_reaction_at says so.
  assert.ok(cheap.queries <= 2, `unchanged poll used ${cheap.queries} queries: ${env.__queries.log.slice(-5).join(' | ')}`);
  assert.ok(cheap.queries < full.queries, `full poll used ${full.queries}, unchanged ${cheap.queries}`);
});

test('reactions do not bump the room version but still reach pollers', async () => {
  const env = createTestEnv();
  const { code } = await makeRoom(env, [mcQ('Q1')]);
  const ana = await join(env, code, 'Ana');
  const before = roomRow(env).version;
  await call(() => sendReaction(jsonRequest('x', { playerToken: ana.playerToken, emoji: '\u{1f525}' }), env, code));
  assert.equal(roomRow(env).version, before, 'a reaction must not invalidate every poller');
  const url = new URL(`${BASE}/${code}/state?since=${before}&playerToken=${ana.playerToken}`);
  const { body } = await call(() => getState(getRequest('x'), env, code, url));
  assert.equal(body.unchanged, true);
  assert.equal(body.reactions.length, 1);
  assert.equal(body.reactions[0].emoji, '\u{1f525}');
});

test('oversized request bodies are rejected instead of being truncated', async () => {
  const env = createTestEnv();
  const { code, hostToken } = await makeRoom(env, [{ ...openQ('Q1'), timeLimit: 300 }]);
  const ana = await join(env, code, 'Ana');
  await beginQuestion(env, code, hostToken);
  const questionId = roomRow(env).current_question_id;

  const huge = 'x'.repeat(2 * 1024 * 1024);
  const res = await call(() => submitAnswer(
    jsonRequest('x', { playerToken: ana.playerToken, questionId, text: huge }), env, code
  ));
  assert.equal(res.status, 413);
  assert.equal(res.body.error.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(answers(env).length, 0, 'nothing should have been stored');

  // A normal answer still works.
  const ok = await call(() => submitAnswer(
    jsonRequest('x', { playerToken: ana.playerToken, questionId, text: 'fine' }), env, code
  ));
  assert.equal(ok.body.ok, true);
});

test('answers past the documented grace period are refused', async () => {
  const env = createTestEnv();
  assert.ok(GRACE_MS <= 500, `grace period too generous: ${GRACE_MS}ms`);
  const { code, hostToken } = await makeRoom(env, [{ ...mcQ('Q1'), timeLimit: 5 }]);
  const ana = await join(env, code, 'Ana');
  await beginQuestion(env, code, hostToken);
  const questionId = roomRow(env).current_question_id;
  // Pretend the question started 5s + grace + 1ms ago.
  env.__sqlite.prepare('UPDATE rooms SET question_started_at = ?').run(Date.now() - (5000 + GRACE_MS + 50));
  const res = await call(() => submitAnswer(jsonRequest('x', { playerToken: ana.playerToken, questionId, choice: [1] }), env, code));
  assert.equal(res.body.error.code, 'TIME_UP');
});

test('repeated wrong host passwords are throttled per room', async () => {
  const env = createTestEnv();
  const { code } = await makeRoom(env, [mcQ('Q1')]);
  clearLoginThrottle();
  let blocked = null;
  for (let i = 0; i < 12 && !blocked; i++) {
    const res = await call(() => hostLogin(jsonRequest('x', { password: `wrong${i}` }), env, code));
    if (res.body.error.code === 'TOO_MANY_ATTEMPTS') blocked = i;
    else assert.equal(res.body.error.code, 'BAD_PASSWORD');
  }
  assert.ok(blocked !== null && blocked <= 10, `never throttled (stopped at ${blocked})`);
  clearLoginThrottle();
  const ok = await call(() => hostLogin(jsonRequest('x', { password: 'secret1' }), env, code));
  assert.ok(ok.body.hostToken);
});

test('host endpoints reject a wrong bearer token', async () => {
  const env = createTestEnv();
  const { code } = await makeRoom(env, [openQ('Q1')]);
  const res = await call(() => hostAnswers(getRequest('x', { token: 'nope' }), env, code, new URL(`${BASE}/${code}/host/answers?questionId=1`)));
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
});

test('the reading state ships no options at all - not even hidden in the JSON', async () => {
  const env = createTestEnv();
  const { code, hostToken } = await makeRoom(env, [mcQ('Which planet?'), openQ('Name a database')]);
  const ana = await join(env, code, 'Ana');
  await call(() => hostAction(getRequest('x', { token: hostToken }), env, code, 'start'));
  assert.equal(roomRow(env).state, 'reading');

  const playerUrl = new URL(`${BASE}/${code}/state?playerToken=${ana.playerToken}`);
  const { body } = await call(() => getState(getRequest('x'), env, code, playerUrl));
  assert.equal(body.state, 'reading');
  const raw = JSON.stringify(body);
  assert.equal('options' in body.question, false, `options key present: ${raw}`);
  assert.equal('prompt' in body.question, false, 'the prompt lives on the stage, not on the phone');
  assert.equal(body.question.correct, undefined);
  assert.equal(body.question.explanation, undefined);
  assert.equal(body.results, null);
  assert.ok(!/Venus|Mars|answerKey|answer_key/.test(raw), `option text leaked: ${raw}`);
  // The clock has not started yet.
  assert.equal(body.startedAt, null);
  assert.equal(roomRow(env).question_started_at, null);

  // The stage identifies itself with the host token and does get the prompt,
  // but still no options: it is being projected to the whole room.
  const hostState = await call(() => getState(getRequest('x', { token: hostToken }), env, code, new URL(`${BASE}/${code}/state`)));
  assert.equal(hostState.body.question.prompt, 'Which planet?');
  assert.equal('options' in hostState.body.question, false);

  // Answering is refused while the room is reading.
  const early = await call(() => submitAnswer(
    jsonRequest('x', { playerToken: ana.playerToken, questionId: roomRow(env).current_question_id, choice: [1] }), env, code
  ));
  assert.equal(early.body.error.code, 'BAD_STATE');

  // Showing the options starts the clock and hands them over.
  await call(() => hostAction(getRequest('x', { token: hostToken }), env, code, 'options'));
  const open = await call(() => getState(getRequest('x'), env, code, playerUrl));
  assert.equal(open.body.state, 'answering');
  assert.equal(open.body.question.options.length, 2);
  assert.ok(open.body.startedAt > 0);
  assert.ok(roomRow(env).question_started_at > 0);
  const qRow = env.__sqlite.prepare('SELECT started_at FROM questions WHERE id = ?').get(roomRow(env).current_question_id);
  assert.ok(qRow.started_at > 0, 'questions.started_at is stamped on the transition to answering');
});

test('the prompt only reaches phones when the room turns on showPromptOnPhone', async () => {
  const env = createTestEnv();
  const { body: created } = await call(() => createRoom(jsonRequest(BASE, {
    password: 'secret1', showPromptOnPhone: true, quiz: quiz([mcQ('Which planet?')]),
  }), env));
  const code = created.code;
  const ana = await join(env, code, 'Ana');
  await call(() => hostAction(getRequest('x', { token: created.hostToken }), env, code, 'start'));
  const url = new URL(`${BASE}/${code}/state?playerToken=${ana.playerToken}`);
  const { body } = await call(() => getState(getRequest('x'), env, code, url));
  assert.equal(body.settings.showPromptOnPhone, true);
  assert.equal(body.question.prompt, 'Which planet?');
  // ...and still no options while reading.
  assert.equal('options' in body.question, false);
});

test('two simultaneous advances cannot double-step the room (P2-10)', async () => {
  const env = createTestEnv();
  const { code, hostToken } = await makeRoom(env, [mcQ('Q1'), mcQ('Q2')]);
  await join(env, code, 'Ana');
  await call(() => hostAction(getRequest('x', { token: hostToken }), env, code, 'start'));
  await call(() => hostAction(getRequest('x', { token: hostToken }), env, code, 'options'));
  assert.equal(roomRow(env).state, 'answering');

  const advance = () => call(() => hostAction(jsonRequest('x', { from: 'answering' }, { token: hostToken }), env, code, 'advance'));
  const [a, b] = await Promise.all([advance(), advance()]);
  const codes = [a.body.error && a.body.error.code, b.body.error && b.body.error.code];
  assert.equal(roomRow(env).state, 'reveal', `one click, one step (got ${roomRow(env).state})`);
  assert.ok(codes.includes('STALE_STATE'), `the loser must be rejected: ${JSON.stringify(codes)}`);
  assert.equal(codes.filter((c) => c === undefined).length, 1, 'exactly one advance may win');

  // A client that believes in an older state is rejected outright.
  const stale = await call(() => hostAction(jsonRequest('x', { from: 'answering' }, { token: hostToken }), env, code, 'advance'));
  assert.equal(stale.body.error.code, 'STALE_STATE');
  assert.equal(roomRow(env).state, 'reveal');
  // A stale version is rejected too, even with the right state.
  const staleVersion = await call(() => hostAction(
    jsonRequest('x', { from: 'reveal', version: 1 }, { token: hostToken }), env, code, 'advance'
  ));
  assert.equal(staleVersion.body.error.code, 'STALE_STATE');
  // The honest click still works.
  const ok = await call(() => hostAction(jsonRequest('x', { from: 'reveal' }, { token: hostToken }), env, code, 'advance'));
  assert.equal(ok.body.state, 'leaderboard');
});

test('the host can walk back a step, and never from reveal into answering', async () => {
  const env = createTestEnv();
  const { code, hostToken } = await makeRoom(env, [mcQ('Q1'), mcQ('Q2')]);
  const act = (action) => call(() => hostAction(getRequest('x', { token: hostToken }), env, code, action));
  await act('start');
  await act('options');
  assert.ok(roomRow(env).question_started_at > 0);
  // answering -> reading gives the clock back.
  const back = await act('back');
  assert.equal(back.body.state, 'reading');
  assert.equal(roomRow(env).question_started_at, null);
  await act('options');
  await act('advance'); // reveal
  const refused = await act('back');
  assert.equal(refused.body.state, 'reveal', 'back from reveal must be a no-op, not a re-open');
  await act('advance'); // leaderboard
  const toReveal = await act('back');
  assert.equal(toReveal.body.state, 'reveal');
});

test('the block name changes with an interstitial between blocks', async () => {
  const env = createTestEnv();
  const { body } = await call(() => createRoom(jsonRequest(BASE, {
    password: 'secret1',
    quiz: { title: 'T', blocks: [{ name: 'Warm up', questions: [mcQ('Q1')] }, { name: 'Finals', questions: [mcQ('Q2')] }] },
  }), env));
  const { code, hostToken } = body;
  const act = (action) => call(() => hostAction(getRequest('x', { token: hostToken }), env, code, action));
  await act('start');
  await act('options');
  await act('advance'); // reveal
  await act('advance'); // leaderboard
  const intro = await act('advance');
  assert.equal(intro.body.state, 'block_intro');
  assert.equal(intro.body.blockName, 'Finals');
  assert.equal(intro.body.blockIndex, 1);
  assert.equal('options' in intro.body.question, false, 'a block card must not leak the next options');
  const reading = await act('advance');
  assert.equal(reading.body.state, 'reading');
});

test('players get an emoji avatar and the lobby roster reaches the stage', async () => {
  const env = createTestEnv();
  const { code } = await makeRoom(env, [mcQ('Q1')]);
  const ana = await join(env, code, 'Ana');
  const bruno = await join(env, code, 'Bruno');
  assert.ok(ana.avatar && bruno.avatar && ana.avatar !== bruno.avatar, `${ana.avatar} / ${bruno.avatar}`);
  const { body } = await call(() => getState(getRequest('x'), env, code, new URL(`${BASE}/${code}/state`)));
  assert.equal(body.players.length, 2);
  assert.deepEqual(body.players.map((p) => p.nickname).sort(), ['Ana', 'Bruno']);
  assert.ok(body.players.every((p) => p.avatar));
});

test('leaderboard rows carry the movement delta snapshotted at the reveal', async () => {
  const env = createTestEnv();
  const { code, hostToken } = await makeRoom(env, [mcQ('Q1'), mcQ('Q2')]);
  const ana = await join(env, code, 'Ana');
  const bruno = await join(env, code, 'Bruno');
  const act = (action) => call(() => hostAction(getRequest('x', { token: hostToken }), env, code, action));

  await act('start'); await act('options');
  const q1 = roomRow(env).current_question_id;
  await call(() => submitAnswer(jsonRequest('x', { playerToken: bruno.playerToken, questionId: q1, choice: [1] }), env, code));
  await act('advance'); // reveal: Bruno first, Ana second, no history yet
  let state = await act('leaderboard');
  assert.deepEqual(state.body.leaderboard.map((p) => [p.nickname, p.delta]), [['Bruno', 0], ['Ana', 0]]);

  await act('advance'); await act('options');
  const q2 = roomRow(env).current_question_id;
  await call(() => submitAnswer(jsonRequest('x', { playerToken: ana.playerToken, questionId: q2, choice: [1] }), env, code));
  await call(() => submitAnswer(jsonRequest('x', { playerToken: bruno.playerToken, questionId: q2, choice: [2] }), env, code));
  state = await act('advance'); // reveal: Ana overtakes Bruno
  const rows = state.body.leaderboard;
  assert.equal(rows[0].nickname, 'Ana');
  assert.equal(rows[0].delta, 1, 'Ana went up one place');
  assert.equal(rows[1].delta, -1, 'Bruno went down one place');
});

test('joining a finished session is refused with a dedicated code (P2-9)', async () => {
  const env = createTestEnv();
  const { code, hostToken } = await makeRoom(env, [mcQ('Q1')]);
  await call(() => hostAction(getRequest('x', { token: hostToken }), env, code, 'end'));
  const res = await call(() => joinRoom(jsonRequest(`${BASE}/${code}/join`, { nickname: 'Late' }), env, code));
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'ROOM_ENDED');
});

test('the host login throttle is per (code, ip) and never blocks the right password (P1-1)', async () => {
  const env = createTestEnv();
  const { code } = await makeRoom(env, [mcQ('Q1')]);
  clearLoginThrottle();
  const attempt = (password, ip) => call(() => hostLogin(
    new Request('http://localhost/api/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
      body: JSON.stringify({ password }),
    }), env, code
  ));

  // An audience member hammers the projected room code from their phone.
  for (let i = 0; i < 8; i++) {
    const res = await attempt(`wrong${i}`, '203.0.113.9');
    assert.equal(res.body.error.code, 'BAD_PASSWORD', `attempt ${i}`);
  }
  const blocked = await attempt('wrong-again', '203.0.113.9');
  assert.equal(blocked.body.error.code, 'TOO_MANY_ATTEMPTS', 'the guesser is throttled');

  // The presenter, on another IP, is untouched...
  const other = await attempt('nope', '198.51.100.4');
  assert.equal(other.body.error.code, 'BAD_PASSWORD', 'the throttle must not be shared across clients');
  const ok = await attempt('secret1', '198.51.100.4');
  assert.ok(ok.body.hostToken);

  // ...and even the throttled IP gets in with the correct password.
  const rescued = await attempt('secret1', '203.0.113.9');
  assert.ok(rescued.body.hostToken, 'a correct password must always be let through');
  clearLoginThrottle();
});

test('the personal end-of-game summary is part of the player state', async () => {
  const env = createTestEnv();
  const { code, hostToken } = await makeRoom(env, [mcQ('Q1'), mcQ('Q2')]);
  const ana = await join(env, code, 'Ana');
  const act = (action) => call(() => hostAction(getRequest('x', { token: hostToken }), env, code, action));
  await act('start'); await act('options');
  await call(() => submitAnswer(jsonRequest('x', { playerToken: ana.playerToken, questionId: roomRow(env).current_question_id, choice: [1] }), env, code));
  await act('advance'); await act('advance'); await act('advance'); await act('options');
  await call(() => submitAnswer(jsonRequest('x', { playerToken: ana.playerToken, questionId: roomRow(env).current_question_id, choice: [2] }), env, code));
  await act('end');
  const { body } = await call(() => getState(getRequest('x'), env, code, new URL(`${BASE}/${code}/state?playerToken=${ana.playerToken}`)));
  assert.equal(body.state, 'ended');
  assert.deepEqual(body.me.summary, { answered: 2, correct: 1, bestStreak: 1, score: body.me.score });
  assert.equal(body.me.rank, 1);
});


/* ------------------------------------------------------- presence & rejoin */

/** Backdates a player's heartbeat, which is what "closed the browser" looks like. */
function goOffline(env, nickname, ago = OFFLINE_MS + 1000) {
  env.__sqlite.prepare('UPDATE players SET last_seen = ? WHERE nickname = ?')
    .run(Date.now() - ago, nickname);
}

test('a player who dropped reclaims their nickname, their row and their score', async () => {
  const env = createTestEnv();
  const { code, hostToken } = await makeRoom(env, [mcQ('Q1'), mcQ('Q2')]);
  const ana = await join(env, code, 'Ana');
  await beginQuestion(env, code, hostToken);
  await call(() => submitAnswer(jsonRequest(`${BASE}/${code}/answer`,
    { playerToken: ana.playerToken, questionId: roomRow(env).current_question_id, choice: [1] }), env, code));
  const scored = players(env)[0];
  assert.ok(scored.score > 0, 'the first answer scored');

  goOffline(env, 'Ana');
  const back = await join(env, code, 'Ana');

  assert.equal(back.resumed, true);
  assert.equal(back.playerId, ana.playerId, 'the same row, not a second Ana');
  assert.notEqual(back.playerToken, ana.playerToken, 'a fresh token is issued');
  assert.equal(back.score, scored.score, 'the score survives the round trip');
  assert.equal(players(env).length, 1, 'no duplicate player was created');

  // The old token is dead, so a phone still holding it cannot keep playing.
  const stale = await call(() => getState(getRequest('x'), env, code,
    new URL(`${BASE}/${code}/state?playerToken=${ana.playerToken}`)));
  assert.equal(stale.body.me, null);
});

test('a nickname whose phone is still polling is refused', async () => {
  const env = createTestEnv();
  const { code } = await makeRoom(env, [mcQ('Q1')]);
  await join(env, code, 'Ana');
  const dup = await call(() => joinRoom(jsonRequest(`${BASE}/${code}/join`, { nickname: 'Ana' }), env, code));
  assert.equal(dup.body.error.code, 'NICKNAME_TAKEN');
});

test('the state poll is what keeps a player present', async () => {
  const env = createTestEnv();
  const { code } = await makeRoom(env, [mcQ('Q1')]);
  const ana = await join(env, code, 'Ana');
  goOffline(env, 'Ana');

  const seenBefore = env.__sqlite.prepare('SELECT last_seen FROM players').get().last_seen;
  await call(() => getState(getRequest('x'), env, code,
    new URL(`${BASE}/${code}/state?playerToken=${ana.playerToken}`)));
  const seenAfter = env.__sqlite.prepare('SELECT last_seen FROM players').get().last_seen;
  assert.ok(seenAfter > seenBefore, 'the poll stamped the heartbeat');

  // ...and a poll that arrives inside the throttle window does not write again.
  const second = await countQueries(env, () => call(() => getState(getRequest('x'), env, code,
    new URL(`${BASE}/${code}/state?playerToken=${ana.playerToken}`))));
  assert.equal(env.__sqlite.prepare('SELECT last_seen FROM players').get().last_seen, seenAfter);
  assert.ok(!env.__queries.log.slice(-second.queries).some((q) => /UPDATE players SET last_seen/.test(q)),
    'no heartbeat write inside the throttle window');
});

test('playerCount counts phones in the room, not rows ever created', async () => {
  const env = createTestEnv();
  const { code } = await makeRoom(env, [mcQ('Q1')]);
  await join(env, code, 'Ana');
  await join(env, code, 'Bo');
  const full = await call(() => getState(getRequest('x'), env, code, new URL(`${BASE}/${code}/state`)));
  assert.equal(full.body.playerCount, 2);

  goOffline(env, 'Bo');
  const after = await call(() => getState(getRequest('x'), env, code, new URL(`${BASE}/${code}/state`)));
  assert.equal(after.body.playerCount, 1, 'a closed browser stops holding the denominator open');
  // Still named on the stage, but marked as gone.
  const bo = (after.body.players || []).find((p) => p.nickname === 'Bo');
  assert.equal(bo.online, false);
});

test('a reaction carries the nickname that sent it', async () => {
  const env = createTestEnv();
  const { code } = await makeRoom(env, [mcQ('Q1')]);
  const ana = await join(env, code, 'Ana');
  await call(() => sendReaction(jsonRequest(`${BASE}/${code}/reaction`,
    { playerToken: ana.playerToken, emoji: '🔥' }), env, code));
  const state = await call(() => getState(getRequest('x'), env, code, new URL(`${BASE}/${code}/state`)));
  assert.deepEqual(
    state.body.reactions.map((r) => [r.emoji, r.nickname]),
    [['🔥', 'Ana']]
  );
});
