// The room state graph (SPEC §5 / SPEC-UX). Pure functions, no D1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planAdvance, planBack, planNext, optionsVisible, normalizeState, isTimed } from '../src/worker/lib/flow.js';

// Two blocks: q0,q1 in block 1 and q2 in block 2.
const questions = [
  { id: 10, block_id: 1 },
  { id: 11, block_id: 1 },
  { id: 12, block_id: 2 },
];

test('the primary action walks lobby -> reading -> answering -> reveal -> leaderboard', () => {
  assert.deepEqual(planAdvance('lobby', -1, questions), { state: 'reading', index: 0, clearStart: true });
  assert.deepEqual(planAdvance('reading', 0, questions), { state: 'answering', index: 0, stamp: true });
  assert.deepEqual(planAdvance('answering', 0, questions), { state: 'reveal', index: 0 });
  assert.deepEqual(planAdvance('reveal', 0, questions), { state: 'leaderboard', index: 0 });
  // Same block: straight into the next question's reading screen.
  assert.deepEqual(planAdvance('leaderboard', 0, questions), { state: 'reading', index: 1 });
  assert.equal(planAdvance('ended', 2, questions), null);
});

test('a block change inserts a block_intro interstitial', () => {
  assert.deepEqual(planAdvance('leaderboard', 1, questions), { state: 'block_intro', index: 2 });
  assert.deepEqual(planAdvance('block_intro', 2, questions), { state: 'reading', index: 2, clearStart: true });
  // Last question of the last block: the session is over.
  assert.deepEqual(planAdvance('leaderboard', 2, questions), { state: 'ended', index: 2 });
});

test('back walks one step and never reopens a revealed question', () => {
  assert.deepEqual(planBack('reading', 0, questions), { state: 'lobby', index: -1, clearStart: true });
  assert.deepEqual(planBack('reading', 1, questions), { state: 'leaderboard', index: 0 });
  assert.deepEqual(planBack('block_intro', 2, questions), { state: 'leaderboard', index: 1 });
  assert.deepEqual(planBack('answering', 1, questions), { state: 'reading', index: 1, clearStart: true });
  assert.deepEqual(planBack('leaderboard', 1, questions), { state: 'reveal', index: 1 });
  assert.equal(planBack('reveal', 1, questions), null, 'reveal must not fall back into answering');
  assert.equal(planBack('lobby', -1, questions), null);
  assert.deepEqual(planBack('ended', 2, questions), { state: 'leaderboard', index: 2 });
});

test('next skips straight to the following question', () => {
  assert.deepEqual(planNext('lobby', -1, questions), { state: 'reading', index: 0, clearStart: true });
  assert.deepEqual(planNext('answering', 0, questions), { state: 'reading', index: 1 });
  assert.deepEqual(planNext('reveal', 1, questions), { state: 'block_intro', index: 2 });
  assert.deepEqual(planNext('reveal', 2, questions), { state: 'ended', index: 2 });
});

test('options are only ever visible from answering onwards', () => {
  ['lobby', 'block_intro', 'reading'].forEach((s) => assert.equal(optionsVisible(s), false, s));
  ['answering', 'reveal', 'leaderboard', 'ended'].forEach((s) => assert.equal(optionsVisible(s), true, s));
});

test('a cycle-2 room parked in the old `question` state reads as answering', () => {
  assert.equal(normalizeState('question'), 'answering');
  assert.equal(optionsVisible('question'), true);
  assert.equal(isTimed('question'), true);
  assert.equal(isTimed('reading'), false);
});
