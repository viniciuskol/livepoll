// Short-polling state client (SPEC §5): 700ms base interval with backoff on
// errors, plus a gentle idle backoff while the server keeps answering
// `unchanged` (halves the load of a full room sitting in the lobby).
export const BASE_INTERVAL = 700;
export const MAX_INTERVAL = 8000;
export const IDLE_INTERVAL = 1400;
export const IDLE_STEP = 175;

/**
 * @param {() => Promise<object>} fetchState called with no args, must resolve the state payload
 * @param {(state:object) => void} onState
 * @param {(error:Error) => void} [onError]
 */
export function createPoller(fetchState, onState, onError) {
  let timer = null;
  let stopped = false;
  let interval = BASE_INTERVAL;
  let inFlight = false;

  async function tick() {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const state = await fetchState();
      if (state && state.unchanged) interval = Math.min(IDLE_INTERVAL, interval + IDLE_STEP);
      else interval = BASE_INTERVAL;
      if (state) onState(state);
    } catch (e) {
      interval = Math.min(MAX_INTERVAL, Math.round(interval * 1.8));
      if (onError) onError(e);
    } finally {
      inFlight = false;
      if (!stopped) timer = setTimeout(tick, interval);
    }
  }

  return {
    start() { if (!timer) tick(); return this; },
    stop() { stopped = true; clearTimeout(timer); timer = null; },
    poke() { clearTimeout(timer); timer = null; tick(); },
    get interval() { return interval; },
  };
}
