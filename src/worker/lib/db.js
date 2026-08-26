// D1 access helpers.
import { fail } from './http.js';
import { normalizeRoomCode, timingSafeEqual } from './codes.js';
import { bearerToken } from './http.js';
import { scoreAnswer } from './scoring.js';

export const MAX_PLAYERS = 300;

export async function getRoomByCode(env, code) {
  const norm = normalizeRoomCode(code);
  const room = await env.DB.prepare('SELECT * FROM rooms WHERE code = ?').bind(norm).first();
  if (!room) fail('ROOM_NOT_FOUND', `Room ${norm} not found`);
  return room;
}

export async function bumpVersion(env, roomId) {
  await env.DB.prepare('UPDATE rooms SET version = version + 1 WHERE id = ?').bind(roomId).run();
}

export async function getQuestions(env, roomId) {
  const { results } = await env.DB.prepare(
    `SELECT q.*, b.name AS block_name, b.position AS block_position
       FROM questions q JOIN blocks b ON b.id = q.block_id
      WHERE q.room_id = ?
      ORDER BY b.position, q.position`
  ).bind(roomId).all();
  return results || [];
}

export async function getOptions(env, questionId) {
  const { results } = await env.DB.prepare(
    'SELECT id, position, text, is_correct FROM options WHERE question_id = ? ORDER BY position'
  ).bind(questionId).all();
  return results || [];
}

export async function getPlayers(env, roomId) {
  const { results } = await env.DB.prepare(
    `SELECT id, nickname, avatar, score, streak, best_streak, prev_rank, rank_delta, joined_at
       FROM players WHERE room_id = ? ORDER BY score DESC, nickname`
  ).bind(roomId).all();
  return results || [];
}

// Emoji avatars handed out on join. Cheap identity: the phone shows it next to
// the nickname and the stage shows it in the lobby and on the leaderboard.
export const AVATARS = [
  '\u{1f98a}', '\u{1f43c}', '\u{1f419}', '\u{1f984}', '\u{1f427}', '\u{1f981}',
  '\u{1f438}', '\u{1f989}', '\u{1f42c}', '\u{1f41d}', '\u{1f996}', '\u{1f99c}',
  '\u{1f680}', '\u{1f3b8}', '\u{1f355}', '\u{1f36d}', '\u{1f3b2}', '\u{1f30b}',
  '\u{1f334}', '\u{1f335}', '\u{1f347}', '\u{1f353}', '\u{1f951}', '\u{1f966}',
];

/** Next avatar for a room: walks the list so early joiners never collide. */
export function pickAvatar(playerCount) {
  return AVATARS[Math.max(0, Number(playerCount) || 0) % AVATARS.length];
}

export async function requireHost(request, room) {
  const token = bearerToken(request);
  if (!token || !timingSafeEqual(token, String(room.host_token))) fail('UNAUTHORIZED', 'Host token required');
  return true;
}

export async function getPlayerByToken(env, room, token) {
  if (!token) fail('UNAUTHORIZED', 'playerToken required');
  const player = await env.DB.prepare('SELECT * FROM players WHERE room_id = ? AND token = ?')
    .bind(room.id, String(token))
    .first();
  if (!player) fail('UNAUTHORIZED', 'Unknown player token');
  return player;
}

/**
 * Rebuilds a player's whole answer chain in question order.
 *
 * Points are re-derived from stored data only (elapsed time, correctness ratio,
 * question base points) with the streak multiplier the answer *should* have had
 * given every earlier answer. That matters for retroactive grading: marking an
 * open answer correct after later questions were already scored used to leave
 * those later answers on the streak basis they were awarded with (0,0,1,2)
 * while the player was shown `streak 4`, so the stored score no longer matched
 * a from-scratch recompute. Rebuilding the chain keeps the two identical.
 *
 * Deterministic and idempotent: calling it twice changes nothing.
 */
export async function recomputePlayer(env, playerId) {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.correct, a.points, a.graded, a.ratio, a.elapsed_ms, a.streak_before,
            q.points AS q_points, q.time_limit AS q_time_limit
       FROM answers a
       JOIN questions q ON q.id = a.question_id
       JOIN blocks b ON b.id = q.block_id
      WHERE a.player_id = ?
      ORDER BY b.position, q.position, a.id`
  ).bind(playerId).all();
  let score = 0;
  let streak = 0;
  let best = 0;
  for (const a of results || []) {
    if (!a.graded) {
      // Waiting for manual grading: worth nothing yet and does not break the
      // streak (the host may still mark it correct).
      score += Number(a.points) || 0;
      continue;
    }
    // Rows written before answers.ratio existed only recorded a boolean.
    const stored = Number(a.ratio) || 0;
    const ratio = stored > 0 ? stored : (a.correct ? 1 : 0);
    const scored = scoreAnswer(
      { points: a.q_points, timeLimit: a.q_time_limit },
      { elapsedMs: a.elapsed_ms },
      { ratio, previousStreak: streak }
    );
    if (Number(a.points) !== scored.points || Number(a.streak_before) !== streak) {
      await env.DB.prepare('UPDATE answers SET points = ?, streak_before = ? WHERE id = ?')
        .bind(scored.points, streak, a.id).run();
    }
    score += scored.points;
    if (ratio > 0) {
      streak += 1;
      if (streak > best) best = streak;
    } else {
      streak = 0;
    }
  }
  await env.DB.prepare('UPDATE players SET score = ?, streak = ?, best_streak = ? WHERE id = ?')
    .bind(score, streak, best, playerId).run();
  return { score, streak, bestStreak: best };
}

/**
 * Snapshots leaderboard positions so the next reveal can show movement arrows.
 * Called when the room enters `reveal`, which is the moment the scores for the
 * question have settled: the reveal screen and the leaderboard that follows it
 * therefore show the same delta.
 */
export async function snapshotRanks(env, roomId) {
  const players = await getPlayers(env, roomId);
  const sorted = [...players].sort(
    (a, b) => b.score - a.score || String(a.nickname).localeCompare(String(b.nickname))
  );
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const rank = i + 1;
    const delta = p.prev_rank == null ? 0 : Number(p.prev_rank) - rank;
    await env.DB.prepare('UPDATE players SET prev_rank = ?, rank_delta = ? WHERE id = ?')
      .bind(rank, delta, p.id).run();
  }
}

export function nowMs() {
  return Date.now();
}
