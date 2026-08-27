// Short-polling state client (SPEC §5): 700ms base interval with backoff on
// errors, plus a gentle idle backoff while the server keeps answering
// `unchanged` (halves the load of a full room sitting in the lobby).
export const BASE_INTERVAL = 700;
export const MAX_INTERVAL = 4000;
export const IDLE_INTERVAL = 1400;
export const IDLE_STEP = 175;
/**
 * How hard a failure pushes the next attempt out. Gentler than doubling: a
 * phone that loses one packet in a tunnel should not be four seconds behind the
 * room for having blinked.
 */
export const BACKOFF_FACTOR = 1.5;

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
      interval = Math.min(MAX_INTERVAL, Math.round(interval * BACKOFF_FACTOR));
      if (onError) onError(e);
    } finally {
      inFlight = false;
      if (!stopped) timer = setTimeout(tick, interval);
    }
  }

  /**
   * Back to the room, now.
   *
   * Two things used to make a client look dead long after it was reachable
   * again: a backed-off interval kept its own pace once the network returned,
   * and a phone whose screen had been off simply had a timer parked in a
   * throttled tab. Both end the same way - drop whatever the backoff had grown
   * to and poll immediately - so both are wired to the same call.
   */
  function resume() {
    if (stopped) return;
    interval = BASE_INTERVAL;
    clearTimeout(timer);
    timer = null;
    tick();
  }

  const onVisible = () => { if (document.visibilityState === 'visible') resume(); };
  document.addEventListener('visibilitychange', onVisible);
  // `online` fires on the interface coming back, which is the earliest signal
  // available that a retry is worth anything.
  window.addEventListener('online', resume);
  // Returning to the tab without a visibility change (alt-tab on some
  // desktops) still means somebody is looking at this screen again.
  window.addEventListener('focus', onVisible);

  return {
    start() { if (!timer) tick(); return this; },
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', resume);
      window.removeEventListener('focus', onVisible);
    },
    poke: resume,
    get interval() { return interval; },
  };
}
