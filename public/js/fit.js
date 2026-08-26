// Fit-to-region typography for the stage.
//
// The stage is a slide, not a document: the type has to be as big as the region
// allows, and the region is a fixed budget shared by the prompt, the options,
// the timer and the explanation. Sizing every element with an independent
// `clamp()` means sizing all of them for the worst case - a six-option question
// with a 232-character prompt - so a two-option question with a four-word
// prompt ends up whispering on 700px of empty wall.
//
// Instead the CSS declares one unit - the scene's own `font-size` - and sizes
// everything else in `em` multiples of it. This module measures the built scene
// and searches for the largest scale of that unit which still fits the centre
// region. Every multiple is also capped in `vh` so a scene that could grow
// forever (three words on a 1080p wall) stops at a sane size instead of turning
// into a single letter.
//
// The scale is applied as an inherited `font-size`, deliberately not as a custom
// property: Chromium does not reliably re-resolve a descendant `font-size` that
// reads a custom property set in the same task, so the search kept measuring
// the scene at 1x, concluding that anything fitted, and left a 232-character
// prompt 1587px past the bottom of the screen (it only showed up under
// `prefers-reduced-motion`, where the 3-2-1 countdown no longer hid the race).
//
// The measurement runs synchronously inside one task, with the region in a
// "measuring" mode where the scene is laid out at its natural height, so the
// browser never paints an intermediate size: no flicker, no reflow storm.

const MEASURING = 'stage-measuring';
/** Below this the type stops being legible at 8 m; better to let the scene's
    own scroll container (the grading list) take the overflow. */
const FLOOR = 0.55;
const STEPS = 7; // 1/128 of the range: finer than a rendered pixel

function boxHeight(node) {
  const cs = getComputedStyle(node);
  return node.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
}
function boxWidth(node) {
  const cs = getComputedStyle(node);
  return node.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
}

/**
 * Scales `scene` to the largest multiple of the stage unit in [FLOOR, max] that
 * fits `region`. Returns the multiple it settled on.
 */
export function fitScene(region, scene, max = 2.2) {
  if (!region || !scene) return 1;
  const availH = boxHeight(region);
  const availW = boxWidth(region);
  if (availH <= 0) return 1;
  // Measuring mode first: it is what turns transitions off, and the unit below
  // is read back from the element - a refit would otherwise read a size still
  // animating away from the previous scale.
  region.classList.add(MEASURING);
  // The unit the CSS asked for, before any scale of ours.
  scene.style.removeProperty('font-size');
  const unit = parseFloat(getComputedStyle(scene).fontSize);
  if (!unit) { region.classList.remove(MEASURING); return 1; }
  const apply = (v) => { scene.style.fontSize = `${Math.round(unit * v * 100) / 100}px`; };
  const fits = (v) => {
    apply(v);
    // +1 for the sub-pixel rounding of a fractional font size.
    return scene.scrollHeight <= availH + 1 && scene.scrollWidth <= availW + 1;
  };
  let value;
  if (fits(max)) {
    value = max;
  } else if (!fits(FLOOR)) {
    value = FLOOR;
  } else {
    let lo = FLOOR;
    let hi = max;
    for (let i = 0; i < STEPS; i += 1) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    value = lo;
  }
  apply(value);
  region.classList.remove(MEASURING);
  return value;
}

/**
 * Refits the scene currently inside `region` (and keeps doing it on resize /
 * fullscreen, where the whole budget changes). `max` comes from the scene
 * itself: a `reading` slide may grow far past the unit, a scene carrying an
 * option grid much less.
 */
export function fitRegion(region) {
  if (!region) return;
  const scene = region.firstElementChild;
  if (!scene || !scene.classList.contains('scene')) return;
  const max = Number(scene.dataset.fitMax) || 2.2;
  fitScene(region, scene, max);
  // A question image has no intrinsic size until it arrives, so the search
  // above measured the scene with a 0x0 box where up to 32vh of picture is
  // about to land: at 1024x768 that left the `reading` slide 108px past the
  // bottom of the region. Whatever loads late gets one refit.
  scene.querySelectorAll('img').forEach((img) => {
    if (img.complete || img.dataset.refit) return;
    img.dataset.refit = '1';
    const again = () => { if (scene.isConnected) fitRegion(region); };
    img.addEventListener('load', again, { once: true });
    img.addEventListener('error', again, { once: true });
  });
}

let scheduled = false;
export function watchRegion(region) {
  const refit = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; fitRegion(region); });
  };
  window.addEventListener('resize', refit);
  document.addEventListener('fullscreenchange', refit);
  // Web fonts and late images change the measurement after the first paint.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit).catch(() => {});
  return refit;
}
