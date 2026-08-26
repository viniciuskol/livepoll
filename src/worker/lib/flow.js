// The room state graph (SPEC §5, SPEC-UX "Máquina de estados").
//
//   lobby -> reading -> answering -> reveal -> leaderboard -> reading (next)
//                                                          -> block_intro -> reading
//                                                          -> ended
//
// Pure functions: no D1, no Worker runtime, so the graph is unit-testable on
// its own. `questions` is the flattened question list (block order, then
// position) and `index` is the position of the room's current question in it.

export const STATES = ['lobby', 'block_intro', 'reading', 'answering', 'reveal', 'leaderboard', 'ended'];

/** States in which `/state` must not carry the options at all (anti-cheat). */
export const OPTIONLESS_STATES = ['lobby', 'block_intro', 'reading'];

/** Cycle-2 rooms stored a single 'question' state; read it as `answering`. */
export function normalizeState(state) {
  return state === 'question' ? 'answering' : String(state || 'lobby');
}

/** True when the options may travel to the clients in this state. */
export function optionsVisible(state) {
  return !OPTIONLESS_STATES.includes(normalizeState(state));
}

/** True when the room is on a question whose clock is running. */
export function isTimed(state) {
  return normalizeState(state) === 'answering';
}

function step(questions, index) {
  const next = index + 1;
  if (next >= questions.length) return { state: 'ended', index };
  const changedBlock = index < 0 || questions[next].block_id !== questions[index].block_id;
  return { state: changedBlock && index >= 0 ? 'block_intro' : 'reading', index: next };
}

/**
 * The one primary action of the stage: what `Space`/`->`/the big button do.
 * @returns {{state:string, index:number, stamp?:boolean, clearStart?:boolean}|null}
 *          null when there is nothing left to do.
 */
export function planAdvance(state, index, questions) {
  const s = normalizeState(state);
  if (!questions.length) return s === 'ended' ? null : { state: 'ended', index: -1 };
  switch (s) {
    case 'lobby':
      return { state: 'reading', index: 0, clearStart: true };
    case 'block_intro':
      return { state: 'reading', index: Math.max(0, index), clearStart: true };
    case 'reading':
      return { state: 'answering', index: Math.max(0, index), stamp: true };
    case 'answering':
      return { state: 'reveal', index };
    case 'reveal':
      return { state: 'leaderboard', index };
    case 'leaderboard':
      return step(questions, index);
    default:
      return null;
  }
}

/**
 * One step back. `reveal` deliberately never walks back into `answering`: the
 * correct answer is already on the projector, so reopening the question would
 * hand the room a free round (SPEC-UX).
 */
export function planBack(state, index, questions) {
  const s = normalizeState(state);
  switch (s) {
    case 'reading':
    case 'block_intro':
      if (index <= 0) return { state: 'lobby', index: -1, clearStart: true };
      return { state: 'leaderboard', index: index - 1 };
    case 'answering':
      return { state: 'reading', index, clearStart: true };
    case 'leaderboard':
      return { state: 'reveal', index };
    case 'ended':
      if (!questions.length) return { state: 'lobby', index: -1, clearStart: true };
      return { state: 'leaderboard', index: index >= 0 ? index : questions.length - 1 };
    default:
      return null; // lobby (nowhere to go) and reveal (refused on purpose)
  }
}

/** Skips straight to the next question, whatever the current state. */
export function planNext(state, index, questions) {
  if (normalizeState(state) === 'lobby') return { state: 'reading', index: 0, clearStart: true };
  return step(questions, index);
}
