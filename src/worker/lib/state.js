// Builds the public room state payload (SPEC §5, SPEC-UX state table).
import { getQuestions, getOptions, getPlayers, isOnline, touchPresence, HEARTBEAT_MS } from './db.js';
import { buildLeaderboard, rankOf, normalizeText } from './scoring.js';
import { normalizeState, optionsVisible } from './flow.js';

export const REACTION_WINDOW_MS = 5000;
/** How many nicknames the lobby ships to the stage. */
export const LOBBY_ROSTER_LIMIT = 60;

/**
 * The public shape of a question.
 *
 * Anti-cheat rule (SPEC-UX): in `lobby`/`block_intro`/`reading` the `options`
 * key is *absent*, not empty and not hidden in CSS - a player with DevTools
 * open finds nothing to read ahead. `answer_key` never leaves the server at
 * all, and `correct`/`explanation` only from `reveal` onwards.
 *
 * The prompt lives on the stage, not in the player's hand: phones only receive
 * it when the room turns on `showPromptOnPhone` (accessibility / remote
 * presenting).
 */
export function publicQuestion(question, options, { state, isHost, showPrompt } = {}) {
  const s = normalizeState(state);
  const revealed = s === 'reveal' || s === 'leaderboard' || s === 'ended';
  const payload = {
    id: question.id,
    type: question.type,
    timeLimit: question.time_limit,
    points: question.points,
    imageUrl: question.image_url || null,
    blockName: question.block_name,
  };
  if (isHost || showPrompt) payload.prompt = question.prompt;
  if (optionsVisible(s)) {
    payload.options = options.map((o) => ({ position: o.position, text: o.text }));
  }
  if (revealed) {
    payload.correct = options.filter((o) => o.is_correct).map((o) => o.position);
    payload.explanation = question.explanation || null;
  }
  return payload;
}

/**
 * The answers already banked for the question the room is *still* answering.
 *
 * Publishing their points live made the score an oracle: answer, watch the
 * number in the identity bar (or the public `/leaderboard`) move, and you know
 * whether the option you picked was the right one - then tell the table, while
 * the timer is still running. That is exactly what `reading` and the
 * "no distribution before the reveal" rule exist to prevent, and `answered.correct`
 * was already gated to `reveal` for the same reason. `answers.streak_before`
 * records the streak the answer was scored from, so the pre-question figures are
 * an exact subtraction rather than an estimate.
 */
export async function pendingAnswers(env, room) {
  const questionId = maskedQuestionId(room);
  if (questionId < 0) return new Map();
  const { results } = await env.DB.prepare(
    'SELECT player_id, points, streak_before FROM answers WHERE question_id = ?'
  ).bind(questionId).all();
  return new Map((results || []).map((a) => [a.player_id, a]));
}

/** The question whose points are masked, or -1 when nothing is being answered. */
export function maskedQuestionId(room) {
  return normalizeState(room.state) === 'answering' ? room.current_question_id || -1 : -1;
}

/** A player row as it looked before the answer of the open question. */
export function maskPending(player, pending) {
  const a = pending && pending.get ? pending.get(player.id) : null;
  if (!a) return player;
  const before = Number(a.streak_before) || 0;
  const best = Number(player.best_streak) || 0;
  // points > 0 is exactly "this answer extended the streak", so a personal best
  // that the open question set is rolled back with it.
  const scored = (Number(a.points) || 0) > 0;
  const masked = {
    ...player,
    score: Math.max(0, (Number(player.score) || 0) - (Number(a.points) || 0)),
    streak: before,
  };
  // Only when the caller selected it: /leaderboard does not, and inventing the
  // column would add a field to its payload.
  if (player.best_streak !== undefined) masked.best_streak = scored && best === before + 1 ? before : best;
  return masked;
}

/**
 * Stamps the heartbeat, but only once the last one has aged out.
 *
 * The poll is the only evidence a phone is still in the room, and it arrives
 * every 700ms. Writing on each one would put a row write on the hottest path in
 * the app; the row we would need to read to decide is already in hand from the
 * poll itself, so the check is free and the write happens ~once a beat.
 */
async function beat(env, roomId, playerToken, row, now = Date.now()) {
  if (!row || !playerToken) return;
  if ((row.last_seen || 0) >= now - HEARTBEAT_MS) return;
  await touchPresence(env, roomId, playerToken, now);
}

/**
 * Recent reaction bubbles. `rooms.last_reaction_at` is already in hand from the
 * room row, so a room with no emoji in the last 5s costs zero extra queries.
 */
export async function recentReactions(env, room) {
  const cutoff = Date.now() - REACTION_WINDOW_MS;
  if (!room.last_reaction_at || room.last_reaction_at < cutoff) return [];
  const { results } = await env.DB.prepare(
    `SELECT r.emoji, r.created_at, p.nickname
       FROM reactions r LEFT JOIN players p ON p.id = r.player_id
      WHERE r.room_id = ? AND r.created_at >= ? ORDER BY r.created_at LIMIT 60`
  ).bind(room.id, cutoff).all();
  // LEFT JOIN, not JOIN: a reaction outlives the player row it came from, and a
  // nameless bubble is better than a bubble that vanishes.
  return (results || []).map((r) => ({ emoji: r.emoji, at: r.created_at, nickname: r.nickname || '' }));
}

/**
 * Minimal payload for a poll whose `since` already matches `rooms.version`.
 * Two D1 queries (the room row plus, for a player, their own row) instead of
 * the seven+ of buildState: this is the hot path, every client hits it every
 * 700ms while nothing is happening.
 * Personal rank is omitted on purpose - it can only change together with a
 * score, which always bumps the version, so the client keeps the value it has.
 */
export async function buildUnchanged(env, room, playerToken) {
  const payload = {
    unchanged: true,
    version: room.version,
    state: normalizeState(room.state),
    serverNow: Date.now(),
    reactions: await recentReactions(env, room),
    me: null,
  };
  if (playerToken) {
    // The pre-question figures ride along on the same row via a LEFT JOIN: this
    // is the hot path (one request per player per poll), so masking the open
    // question's points must not cost it an extra query.
    const me = await env.DB.prepare(
      `SELECT p.id, p.nickname, p.avatar, p.score, p.streak, p.best_streak, p.rank_delta, p.last_seen,
              a.points AS pending_points, a.streak_before AS pending_streak
         FROM players p
         LEFT JOIN answers a ON a.player_id = p.id AND a.question_id = ?
        WHERE p.room_id = ? AND p.token = ?`
    ).bind(maskedQuestionId(room), room.id, String(playerToken)).first();
    await beat(env, room.id, playerToken, me);
    if (me) {
      const pending = me.pending_points == null ? null : new Map([[me.id, { points: me.pending_points, streak_before: me.pending_streak }]]);
      const shown = maskPending(me, pending);
      payload.me = {
        id: shown.id,
        nickname: shown.nickname,
        avatar: shown.avatar || '',
        score: shown.score,
        streak: shown.streak,
        bestStreak: shown.best_streak,
        rankDelta: me.rank_delta || 0,
      };
    }
  }
  return payload;
}

export async function buildState(env, room, { playerToken, isHost } = {}) {
  const state = normalizeState(room.state);
  const questions = await getQuestions(env, room.id);
  const index = questions.findIndex((q) => q.id === room.current_question_id);
  const current = index >= 0 ? questions[index] : null;
  const blockNames = [...new Set(questions.map((q) => q.block_name))];

  const playerRows = await getPlayers(env, room.id);
  // Scores are reported as they were before the open question: see pendingAnswers.
  const pending = await pendingAnswers(env, room);
  const players = playerRows.map((p) => maskPending(p, pending));
  const showPrompt = !!room.show_prompt_on_phone;

  const payload = {
    code: room.code,
    title: room.title,
    state,
    version: room.version,
    serverNow: Date.now(),
    // Present players, not rows ever created: this is the denominator of
    // "3 of 5 answered", and a phone that closed its browser must not hold the
    // count open forever.
    playerCount: players.filter((p) => isOnline(p)).length,
    totalQuestions: questions.length,
    totalBlocks: blockNames.length,
    questionIndex: index >= 0 ? index : null,
    blockIndex: current ? blockNames.indexOf(current.block_name) : null,
    blockName: current ? current.block_name : null,
    // The clock only runs while the room is answering.
    startedAt: state === 'answering' ? room.question_started_at || null : null,
    settings: { showPromptOnPhone: showPrompt },
    question: null,
    answerCount: 0,
    missing: null,
    results: null,
    leaderboard: null,
    players: null,
    reactions: [],
    me: null,
    summary: null,
  };

  if (current) {
    // In an optionless state the options are not even loaded, so there is
    // nothing to accidentally serialize.
    const options = optionsVisible(state) ? await getOptions(env, current.id) : [];
    payload.question = publicQuestion(current, options, { state, isHost, showPrompt });
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM answers WHERE question_id = ?')
      .bind(current.id)
      .first();
    payload.answerCount = (row && row.n) || 0;

    // The distribution is reveal-only: showing it while the room is still
    // answering biases everyone who has not answered yet (SPEC-UX).
    if (state === 'reveal') payload.results = await buildResults(env, current, options);

    // An open question has nothing to project: the prompt is being answered in
    // words, and the two obvious things to put on the wall are both wrong.
    // Showing what was typed hands the answer to everyone still thinking;
    // showing who already sent turns the wall into a public typing-speed
    // scoreboard the moment the room is bigger than a table. What is left is
    // the useful half - who the presenter is still waiting for. Host only, and
    // only while an open question is being answered, so it costs one extra
    // query in exactly one state and never reaches a player's phone.
    if (isHost && state === 'answering' && current.type === 'open_text') {
      const { results: done } = await env.DB.prepare(
        'SELECT player_id FROM answers WHERE question_id = ?'
      ).bind(current.id).all();
      const sent = new Set((done || []).map((r) => r.player_id));
      payload.missing = players
        .filter((p) => !sent.has(p.id))
        .slice(0, LOBBY_ROSTER_LIMIT)
        .map((p) => ({ id: p.id, nickname: p.nickname, avatar: p.avatar || '', online: isOnline(p) }));
    }
  }

  if (state === 'leaderboard' || state === 'ended' || state === 'reveal') {
    payload.leaderboard = buildLeaderboard(players, 10).map((p) => ({
      id: p.id,
      nickname: p.nickname,
      avatar: p.avatar || '',
      score: p.score,
      streak: p.streak,
      rank: p.rank,
      delta: p.rank_delta || 0,
    }));
  }

  // The finale is the one moment the stage can look back at the whole session,
  // so `ended` carries the room-wide numbers the podium alone cannot show.
  if (state === 'ended') payload.summary = await roomSummary(env, room, players, questions.length);

  // Lobby roster: the stage pops the nicknames in as they arrive.
  if (state === 'lobby') {
    payload.players = [...players]
      .sort((a, b) => (b.joined_at || 0) - (a.joined_at || 0))
      .slice(0, LOBBY_ROSTER_LIMIT)
      .map((p) => ({ id: p.id, nickname: p.nickname, avatar: p.avatar || '', online: isOnline(p) }));
  }

  payload.reactions = await recentReactions(env, room);

  if (playerToken) {
    const row = await env.DB.prepare('SELECT * FROM players WHERE room_id = ? AND token = ?')
      .bind(room.id, String(playerToken))
      .first();
    await beat(env, room.id, playerToken, row);
    if (row) {
      const me = maskPending(row, pending);
      let answered = null;
      if (current) {
        answered = await env.DB.prepare(
          'SELECT choice, text, correct, points, graded FROM answers WHERE question_id = ? AND player_id = ?'
        ).bind(current.id, me.id).first();
      }
      const revealed = state === 'reveal' || state === 'leaderboard' || state === 'ended';
      payload.me = {
        id: me.id,
        nickname: me.nickname,
        avatar: me.avatar || '',
        score: me.score,
        streak: me.streak,
        bestStreak: me.best_streak,
        rank: rankOf(players, me.id),
        rankDelta: me.rank_delta || 0,
        answered: answered
          ? {
              choice: answered.choice ? JSON.parse(answered.choice) : [],
              text: answered.text || '',
              correct: revealed ? !!answered.correct : null,
              points: revealed ? answered.points : null,
              graded: !!answered.graded,
            }
          : null,
      };
      if (state === 'ended') payload.me.summary = await playerSummary(env, row);
    }
  }

  return payload;
}

/**
 * Room-wide numbers for the finale: how much was played, the streak record of
 * the room and who holds it, how many players answered *everything* right, and
 * the room's overall hit rate. One extra query, only in `ended`.
 */
export async function roomSummary(env, room, players, totalQuestions) {
  const { results } = await env.DB.prepare(
    `SELECT a.player_id AS id,
            COUNT(*) AS answered,
            SUM(CASE WHEN a.graded = 1 AND a.correct = 1 THEN 1 ELSE 0 END) AS correct
       FROM answers a JOIN players p ON p.id = a.player_id
      WHERE p.room_id = ?
      GROUP BY a.player_id`
  ).bind(room.id).all();
  const rows = results || [];
  let answered = 0;
  let correct = 0;
  const perfect = [];
  rows.forEach((r) => {
    answered += Number(r.answered) || 0;
    correct += Number(r.correct) || 0;
    if (totalQuestions > 0 && Number(r.correct) === totalQuestions) perfect.push(r.id);
  });
  // The record is read from the players, not from the answers: a streak can be
  // rebuilt by a late grade and `players.best_streak` is the recomputed value.
  let bestStreak = 0;
  let holder = '';
  players.forEach((p) => {
    const b = Number(p.best_streak) || 0;
    if (b > bestStreak) { bestStreak = b; holder = p.nickname; }
  });
  const names = new Map(players.map((p) => [p.id, p.nickname]));
  return {
    questions: totalQuestions,
    players: players.length,
    bestStreak,
    bestStreakBy: holder,
    perfect: perfect.length,
    perfectNames: perfect.map((id) => names.get(id)).filter(Boolean).slice(0, 3),
    accuracy: answered ? Math.round((correct / answered) * 100) : 0,
  };
}

/** Personal end-of-game card: hits, best streak, final position. */
export async function playerSummary(env, player) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS answered,
            SUM(CASE WHEN graded = 1 AND correct = 1 THEN 1 ELSE 0 END) AS correct
       FROM answers WHERE player_id = ?`
  ).bind(player.id).first();
  return {
    answered: (row && row.answered) || 0,
    correct: (row && row.correct) || 0,
    bestStreak: player.best_streak || 0,
    score: player.score || 0,
  };
}

/** Aggregated per-option counts, or grouped texts for open questions. */
export async function buildResults(env, question, options) {
  if (question.type === 'open_text') {
    const groups = await groupOpenAnswers(env, question);
    return { type: 'open_text', groups, correctPositions: [] };
  }
  const { results } = await env.DB.prepare('SELECT choice FROM answers WHERE question_id = ?')
    .bind(question.id)
    .all();
  const counts = {};
  options.forEach((o) => { counts[o.position] = 0; });
  (results || []).forEach((a) => {
    let choice = [];
    try { choice = JSON.parse(a.choice || '[]'); } catch { choice = []; }
    choice.forEach((p) => { if (counts[p] !== undefined) counts[p] += 1; });
  });
  return {
    type: question.type,
    counts: options.map((o) => ({ position: o.position, text: o.text, count: counts[o.position], correct: !!o.is_correct })),
    correctPositions: options.filter((o) => o.is_correct).map((o) => o.position),
  };
}

/** Groups open_text answers by normalized text and joins host grades. */
export async function groupOpenAnswers(env, question) {
  const { results } = await env.DB.prepare(
    `SELECT a.text, a.correct, a.graded, p.nickname
       FROM answers a JOIN players p ON p.id = a.player_id
      WHERE a.question_id = ?`
  ).bind(question.id).all();
  const { results: grades } = await env.DB.prepare(
    'SELECT norm_text, correct FROM open_grades WHERE question_id = ?'
  ).bind(question.id).all();
  const gradeMap = new Map((grades || []).map((g) => [g.norm_text, !!g.correct]));
  const map = new Map();
  (results || []).forEach((a) => {
    const norm = normalizeText(a.text || '');
    if (!map.has(norm)) {
      // A manual grade wins; below it sits the verdict auto-grading already
      // reached against the answer key. Without that fallback a question with a
      // key opened an *empty* panel: accepted and rejected answers rendered
      // identically and one careless click overwrote a correct auto-grade.
      const auto = a.graded ? !!a.correct : null;
      map.set(norm, {
        norm, sample: a.text || '', count: 0, nicknames: [],
        correct: gradeMap.has(norm) ? gradeMap.get(norm) : auto,
      });
    }
    const g = map.get(norm);
    g.count += 1;
    if (g.nicknames.length < 12) g.nicknames.push(a.nickname);
  });
  return [...map.values()].sort((a, b) => b.count - a.count);
}
