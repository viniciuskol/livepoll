// Scoring rules (SPEC §4). Pure functions - no Worker runtime needed.

export const STREAK_STEP = 0.1;
export const STREAK_CAP = 0.5;

/** Speed factor in [0.5, 1]: 0.5 + 0.5 * remaining/total. */
export function speedFactor(elapsedMs, timeLimitSec) {
  const total = Math.max(1, Number(timeLimitSec) || 0) * 1000;
  const elapsed = Math.min(Math.max(Number(elapsedMs) || 0, 0), total);
  const remaining = total - elapsed;
  return 0.5 + 0.5 * (remaining / total);
}

/** Streak multiplier: +10% per consecutive correct answer, capped at +50%. */
export function streakMultiplier(previousStreak) {
  const s = Math.max(0, Number(previousStreak) || 0);
  return 1 + Math.min(s * STREAK_STEP, STREAK_CAP);
}

function sameSet(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

/**
 * Correctness ratio in [0,1] for a submitted answer.
 * multiple_choice/true_false: 1 or 0.
 * multiple_select: (hits - misses) / correctCount, floored at 0.
 * open_text: 1 when normalized text matches the answer key.
 */
export function correctnessRatio(question, submission) {
  const type = question.type;
  const correct = (question.correct || []).map(Number);
  if (type === 'open_text') {
    const keys = (question.answerKey || []).map(normalizeText).filter(Boolean);
    const given = normalizeText(submission.text || '');
    if (!given) return 0;
    return keys.includes(given) ? 1 : 0;
  }
  const choice = (submission.choice || []).map(Number);
  if (type === 'multiple_select') {
    if (correct.length === 0) return 0;
    const hits = choice.filter((c) => correct.includes(c)).length;
    const misses = choice.filter((c) => !correct.includes(c)).length;
    return Math.max(0, (hits - misses) / correct.length);
  }
  return sameSet(choice, correct) ? 1 : 0;
}

/**
 * Awarded points for an answer.
 * @returns {{points:number, ratio:number, correct:boolean}}
 */
export function scoreAnswer(question, submission, opts = {}) {
  const ratio = typeof opts.ratio === 'number' ? opts.ratio : correctnessRatio(question, submission);
  const base = Math.max(0, Number(question.points) || 0);
  if (ratio <= 0 || base === 0) return { points: 0, ratio, correct: false };
  const speed = speedFactor(submission.elapsedMs, question.timeLimit);
  const streak = streakMultiplier(opts.previousStreak || 0);
  const points = Math.round(base * speed * ratio * streak);
  return { points, ratio, correct: ratio > 0 };
}

/** Normalization used for open_text grouping and matching. */
export function normalizeText(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Top-N leaderboard rows plus optional personal position. */
export function buildLeaderboard(players, limit = 10) {
  const sorted = [...players].sort(
    (a, b) => b.score - a.score || String(a.nickname).localeCompare(String(b.nickname))
  );
  return sorted.map((p, i) => ({ ...p, rank: i + 1 })).slice(0, limit);
}

export function rankOf(players, playerId) {
  const sorted = [...players].sort(
    (a, b) => b.score - a.score || String(a.nickname).localeCompare(String(b.nickname))
  );
  const idx = sorted.findIndex((p) => String(p.id) === String(playerId));
  return idx < 0 ? null : idx + 1;
}
