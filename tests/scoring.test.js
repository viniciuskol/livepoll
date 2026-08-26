import test from 'node:test';
import assert from 'node:assert/strict';
import {
  speedFactor, streakMultiplier, correctnessRatio, scoreAnswer,
  normalizeText, buildLeaderboard, rankOf,
} from '../src/worker/lib/scoring.js';

test('speedFactor spans 1.0 (instant) down to 0.5 (last moment)', () => {
  assert.equal(speedFactor(0, 20), 1);
  assert.equal(speedFactor(20000, 20), 0.5);
  assert.equal(speedFactor(10000, 20), 0.75);
  assert.equal(speedFactor(999999, 20), 0.5, 'clamped');
  assert.equal(speedFactor(-5, 20), 1, 'clamped');
});

test('streakMultiplier adds 10% per streak capped at +50%', () => {
  assert.equal(streakMultiplier(0), 1);
  assert.equal(streakMultiplier(1), 1.1);
  assert.equal(streakMultiplier(5), 1.5);
  assert.equal(streakMultiplier(50), 1.5);
});

test('multiple_choice correctness is all or nothing', () => {
  const q = { type: 'multiple_choice', correct: [2], points: 1000, timeLimit: 20 };
  assert.equal(correctnessRatio(q, { choice: [2] }), 1);
  assert.equal(correctnessRatio(q, { choice: [1] }), 0);
  assert.equal(correctnessRatio(q, { choice: [] }), 0);
});

test('true_false behaves like a 2 option multiple choice', () => {
  const q = { type: 'true_false', correct: [1], points: 800, timeLimit: 15 };
  assert.equal(correctnessRatio(q, { choice: [1] }), 1);
  assert.equal(correctnessRatio(q, { choice: [2] }), 0);
});

test('multiple_select is partial: hits minus misses, floored at zero', () => {
  const q = { type: 'multiple_select', correct: [1, 3], points: 1000, timeLimit: 20 };
  assert.equal(correctnessRatio(q, { choice: [1, 3] }), 1);
  assert.equal(correctnessRatio(q, { choice: [1] }), 0.5);
  assert.equal(correctnessRatio(q, { choice: [1, 2] }), 0, '1 hit - 1 miss');
  assert.equal(correctnessRatio(q, { choice: [2] }), 0);
  assert.equal(correctnessRatio(q, { choice: [1, 3, 2] }), 0.5);
});

test('open_text matches the answer key after normalization', () => {
  const q = { type: 'open_text', answerKey: ['Rio de Janeiro', 'Rio'], points: 1000, timeLimit: 30 };
  assert.equal(correctnessRatio(q, { text: 'rio  de   janeiro!' }), 1);
  assert.equal(correctnessRatio(q, { text: 'RIO' }), 1);
  assert.equal(correctnessRatio(q, { text: 'Sao Paulo' }), 0);
  assert.equal(correctnessRatio(q, { text: '' }), 0);
});

test('scoreAnswer combines base points, speed and streak', () => {
  const q = { type: 'multiple_choice', correct: [1], points: 1000, timeLimit: 20 };
  assert.deepEqual(scoreAnswer(q, { choice: [1], elapsedMs: 0 }), { points: 1000, ratio: 1, correct: true });
  assert.equal(scoreAnswer(q, { choice: [1], elapsedMs: 20000 }).points, 500);
  assert.equal(scoreAnswer(q, { choice: [1], elapsedMs: 0 }, { previousStreak: 3 }).points, 1300);
  assert.equal(scoreAnswer(q, { choice: [1], elapsedMs: 0 }, { previousStreak: 9 }).points, 1500, 'streak capped');
  assert.equal(scoreAnswer(q, { choice: [2], elapsedMs: 0 }).points, 0);
});

test('scoreAnswer scales partial multiple_select credit', () => {
  const q = { type: 'multiple_select', correct: [1, 2], points: 1000, timeLimit: 20 };
  const res = scoreAnswer(q, { choice: [1], elapsedMs: 0 });
  assert.equal(res.points, 500);
  assert.equal(res.correct, true);
});

test('normalizeText strips accents, punctuation and case', () => {
  assert.equal(normalizeText('  Ação, Rápida! '), 'acao rapida');
  assert.equal(normalizeText(null), '');
});

test('leaderboard sorts by score then nickname and reports personal rank', () => {
  const players = [
    { id: 1, nickname: 'Ana', score: 100 },
    { id: 2, nickname: 'Bob', score: 300 },
    { id: 3, nickname: 'Cyd', score: 300 },
  ];
  const top = buildLeaderboard(players, 2);
  assert.deepEqual(top.map((p) => p.nickname), ['Bob', 'Cyd']);
  assert.deepEqual(top.map((p) => p.rank), [1, 2]);
  assert.equal(rankOf(players, 1), 3);
  assert.equal(rankOf(players, 99), null);
});
