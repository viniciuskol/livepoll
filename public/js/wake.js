// Keeps the screen on while a game is in front of someone.
//
// Both screens in this app are watched, not touched: the projector sits on a
// scene for minutes at a time, and a player who has locked in an answer has no
// reason to tap anything until the reveal. Every phone and most laptops read
// that as idle and dim, so the room ends up waking devices in the middle of a
// question - or worse, the stage blanks mid-round.
//
// Screen Wake Lock is the only web API that says "do not dim" without lying to
// the device (the old trick was a hidden looping video, which burns battery and
// audio focus). It needs a secure context, which we have, and it is silently
// absent on Safari before 16.4 and on Firefox for Android - hence every call
// being guarded rather than assumed.

let sentinel = null;
let wanted = false;
let wired = false;

async function acquire() {
  if (!wanted || sentinel) return;
  if (!('wakeLock' in navigator)) return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    // The lock is dropped by the platform whenever the page stops being
    // visible - switching tabs, locking the phone, an incoming call. Clearing
    // the handle here is what lets the visibility listener below take it again
    // instead of believing it still holds one.
    sentinel.addEventListener('release', () => { sentinel = null; });
  } catch {
    // Denied (a backgrounded tab, battery saver, an unsupported surface).
    // Nothing to recover: the screen dims as it did before.
    sentinel = null;
  }
}

/**
 * Asks the device to keep this screen awake, and keeps asking.
 *
 * Safe to call more than once; the listeners are wired a single time.
 */
export function keepAwake() {
  wanted = true;
  acquire();
  if (wired) return;
  wired = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') acquire();
  });
  // Rotating a phone re-creates the surface on some Androids and takes the
  // lock with it.
  window.addEventListener('orientationchange', () => { setTimeout(acquire, 250); });
}

/** Releases the lock - used when a session ends and the screen may sleep. */
export async function releaseWake() {
  wanted = false;
  const held = sentinel;
  sentinel = null;
  try { await (held && held.release()); } catch { /* already gone */ }
}

/** True when the browser can honour keepAwake() at all. */
export const wakeSupported = () => 'wakeLock' in navigator;
