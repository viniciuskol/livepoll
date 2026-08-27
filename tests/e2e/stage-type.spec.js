// The stage measured as a projection, not as a web page.
//
// "Readable at 8 metres on a 100-inch 1080p wall" is a number, so it is
// asserted like one: every text run the room has to read is measured in
// rendered pixels at both realistic projector resolutions. The floors below are
// deliberately under the design targets (~25 px at 720p, ~38 px at 1080p) so
// the test fails on a regression rather than on a rounding difference.
import { test, expect } from '@playwright/test';
import { toCSV } from '../../public/js/shared/csv.js';

const LONG = 'In the context of distributed database systems, which of the following consistency guarantees does a single-leader replicated store provide to a client that always reads from the same replica it wrote to, assuming no failover?';

const QUIZ = toCSV([
  ['block', 'type', 'question', 'option1', 'option2', 'option3', 'option4', 'option5', 'option6', 'correct', 'time_limit', 'points', 'explanation'],
  ['Warm up', 'multiple_choice', LONG, 'Read-your-writes on that replica only', 'Full linearizability everywhere', 'Eventual consistency, bounded staleness', 'Causal consistency for all clients', 'Snapshot isolation across shards', 'No guarantee at all', '1', '60', '1000',
    'A single-leader store gives read-your-writes on the replica you wrote to and nothing stronger across the cluster.'],
  ['Warm up', 'multiple_choice', 'Why does ice float?', 'Lower density', 'Higher density', '', '', '', '', '1', '60', '1000', 'Ice is about 9% less dense than water.'],
]);

const SIZES = {
  720: { viewport: { width: 1280, height: 720 }, option: 24, count: 26, lb: 28, explain: 20, prompt: 90, code: 28 },
  1080: { viewport: { width: 1920, height: 1080 }, option: 34, count: 38, lb: 40, explain: 28, prompt: 110, code: 40 },
};

function guardConsole(page, errors) {
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));
}

/** Rendered font size of the first match, in CSS pixels. */
const fontOf = (page, selector) => page.locator(selector).first().evaluate(
  (n) => parseFloat(getComputedStyle(n).fontSize)
);

/**
 * How far any ink inside the centre region falls outside it. The stage never
 * scrolls, so this has to be 0 in every state: the one element allowed to
 * scroll is the grading list, which is skipped.
 */
const overflowOf = (page) => page.evaluate(() => {
  const center = document.querySelector('#s-center');
  const box = center.getBoundingClientRect();
  let over = 0;
  for (const n of center.querySelectorAll('*')) {
    const cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const list = n.closest('.grade-list');
    if (list && n !== list) continue;
    const r = n.getBoundingClientRect();
    if (r.height === 0) continue;
    over = Math.max(over, r.bottom - box.bottom, box.top - r.top);
  }
  return Math.max(0, Math.round(over)) + Math.max(0,
    document.documentElement.scrollHeight - window.innerHeight,
    document.documentElement.scrollWidth - window.innerWidth);
});

/** Advances the room and waits for the state to actually change (3-2-1). */
async function step(host) {
  const before = await host.getAttribute('#stage', 'data-state');
  await host.click('#s-primary');
  await host.waitForFunction(
    (prev) => document.querySelector('#stage').dataset.state !== prev, before, { timeout: 20_000 }
  );
}

async function createRoom(browser, viewport, errors, csv = QUIZ, locale) {
  // `locale` drives navigator.language, which is what detectLang() reads: it is
  // the only way to get the app into pt or es without touching its storage.
  const ctx = await browser.newContext(locale ? { viewport, locale } : { viewport });
  const host = await ctx.newPage();
  guardConsole(host, errors);
  await host.goto('/host.html');
  await host.setInputFiles('#file', { name: 'quiz.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await host.fill('#password', 'secret1');
  await host.click('#create-btn');
  await expect(host.locator('#stage')).toBeVisible();
  return { host, code: (await host.locator('#s-code').innerText()).trim() };
}

/** Joins straight through the API: these tests need a crowd, not browsers. */
const joinMany = (host, code, names) => host.evaluate(async ({ c, list }) => {
  const out = [];
  for (const nickname of list) {
    const res = await fetch(`/api/rooms/${c}/join`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname }),
    });
    out.push((await res.json()).playerToken);
  }
  return out;
}, { c: code, list: names });

const answerAs = (host, code, token, position) => host.evaluate(async ({ c, tok, pos }) => {
  const st = await (await fetch(`/api/rooms/${c}/state?playerToken=${tok}`)).json();
  const res = await fetch(`/api/rooms/${c}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerToken: tok, questionId: st.question.id, ...(pos ? { choice: [pos] } : { text: 'SQLite' }) }),
  });
  return res.status;
}, { c: code, tok: token, pos: position });

for (const [label, spec] of Object.entries(SIZES)) {
  test(`the stage type is readable at 8 metres at ${spec.viewport.width}x${spec.viewport.height}`, async ({ browser }) => {
    const errors = [];
    const { host, code } = await createRoom(browser, spec.viewport, errors);
    const tokens = await joinMany(host, code, ['Ana', 'Bruno', 'Cyd', 'Dora']);

    // lobby: the room code is the one thing a latecomer has to read from the back.
    expect(await fontOf(host, '.strip-code b')).toBeGreaterThanOrEqual(spec.code);
    expect(await overflowOf(host), `lobby overflow at ${label}p`).toBe(0);

    // reading, worst case: a 232-character prompt still gets real type.
    await step(host);
    await expect(host.locator('.scene-prompt')).toContainText('distributed database');
    expect(await fontOf(host, '.scene-prompt')).toBeGreaterThanOrEqual(spec.option);
    expect(await overflowOf(host), `reading long overflow at ${label}p`).toBe(0);

    // answering, worst case: six options *and* the long prompt *and* the ring.
    await step(host);
    await expect(host.locator('.stage-opts .opt')).toHaveCount(6);
    expect(await fontOf(host, '.stage-opts .opt .txt'),
      `six-option label at ${label}p`).toBeGreaterThanOrEqual(spec.option);
    expect(await fontOf(host, '#s-answers')).toBeGreaterThanOrEqual(spec.count);
    expect(await overflowOf(host), `answering worst case overflow at ${label}p`).toBe(0);

    for (const [i, token] of tokens.entries()) expect(await answerAs(host, code, token, (i % 6) + 1)).toBe(200);
    await expect(host.locator('#s-answers')).toContainText('4 of 4');

    // reveal: the share of the room, and the explanation as prose.
    await step(host);
    expect(await fontOf(host, '.stage-opts .opt .txt')).toBeGreaterThanOrEqual(spec.option);
    expect(await fontOf(host, '.stage-opts .opt .pct')).toBeGreaterThanOrEqual(spec.option * 0.8);
    expect(await fontOf(host, '.explain')).toBeGreaterThanOrEqual(spec.explain);
    expect(await overflowOf(host), `reveal overflow at ${label}p`).toBe(0);

    // leaderboard: a show moment used to carry the smallest type on the stage.
    await step(host);
    await expect(host.locator('.stage-lb li')).toHaveCount(4);
    expect(await fontOf(host, '.stage-lb .name'), `ranking row at ${label}p`).toBeGreaterThanOrEqual(spec.lb);
    expect(await overflowOf(host), `leaderboard overflow at ${label}p`).toBe(0);

    // A four-word question grows into the region it has instead of sitting at
    // the same size as the 232-character one.
    await step(host);
    await expect(host.locator('.scene-prompt')).toContainText('ice float');
    const short = await fontOf(host, '.scene-prompt');
    expect(short, `short prompt at ${label}p`).toBeGreaterThanOrEqual(spec.prompt);
    expect(await overflowOf(host), `reading short overflow at ${label}p`).toBe(0);

    // ...and the two options that follow it get the slack too.
    await step(host);
    await expect(host.locator('.stage-opts .opt')).toHaveCount(2);
    expect(await fontOf(host, '.stage-opts .opt .txt')).toBeGreaterThan(spec.option);
    expect(await overflowOf(host), `answering two options overflow at ${label}p`).toBe(0);

    // The reveal of a *full-width* option grid: `.opt.is-correct` grows the
    // correct option by 3.5%, and on a single-column grid that overhang lands
    // in the scene's scrollWidth. It does not shrink when the type does, so it
    // failed the fit search's width test at every candidate scale and pinned
    // the whole scene at the 0.55 floor - 14 px option labels at 720p, in the
    // one state the room is being asked to read.
    for (const [i, token] of tokens.entries()) expect(await answerAs(host, code, token, (i % 2) + 1)).toBe(200);
    await step(host);
    await expect(host.locator('.stage-opts .opt.is-correct')).toHaveCount(1);
    expect(await fontOf(host, '.stage-opts .opt .txt'),
      `two-option reveal label at ${label}p`).toBeGreaterThanOrEqual(spec.option);
    expect(await overflowOf(host), `reveal two options overflow at ${label}p`).toBe(0);

    expect(errors, `console: ${errors.join(' | ')}`).toEqual([]);
  });
}

test('a 40-player lobby says how many names it could not show', async ({ browser }) => {
  const errors = [];
  const { host, code } = await createRoom(browser, { width: 1280, height: 720 }, errors);
  const names = Array.from({ length: 40 }, (_, i) => `Player${i + 1}`);
  await joinMany(host, code, names);
  await expect(host.locator('#s-players')).toContainText('40');
  await expect(host.locator('.roster-chip:not(.more)')).toHaveCount(40, { timeout: 20_000 });

  // Whatever does not fit is counted, never silently clipped: visible chips
  // plus the "+N more" chip must add up to the 40 the strip claims.
  const shown = await host.locator('.roster-chip:not(.more):not(.hidden)').count();
  const more = host.locator('.roster-chip.more');
  if (shown < 40) {
    await expect(more).toBeVisible();
    const n = Number((await more.innerText()).replace(/\D+/g, ''));
    expect(shown + n).toBe(40);
  } else {
    await expect(more).toHaveCount(0);
  }
  expect(await overflowOf(host)).toBe(0);
  expect(errors).toEqual([]);
});

test('an open answer is printed once at the reveal, with its share', async ({ browser }) => {
  const errors = [];
  const csv = toCSV([
    ['block', 'type', 'question', 'option1', 'option2', 'correct', 'time_limit', 'points'],
    ['B', 'open_text', 'Name a database engine', '', '', '', '60', '1000'],
  ]);
  const { host, code } = await createRoom(browser, { width: 1280, height: 720 }, errors, csv);
  const tokens = await joinMany(host, code, ['Ana', 'Bruno', 'Cyd']);
  await step(host); // reading
  await step(host); // answering
  // The wait is a composition, not a grey line: one anonymous tile per answer.
  for (const token of tokens) expect(await answerAs(host, code, token, 0)).toBe(200);
  await expect(host.locator('#s-answers')).toContainText('3 of 3');
  await expect(host.locator('.open-wait .tile')).toHaveCount(3);
  expect(await overflowOf(host)).toBe(0);

  await step(host); // reveal
  // Exactly one row for the one distinct answer, and no second list repeating it.
  await expect(host.locator('.grade-list .group-row')).toHaveCount(1);
  await expect(host.locator('.group-row .pill')).toContainText('100%');
  const occurrences = await host.locator('#s-center').evaluate(
    (n) => (n.innerText.match(/SQLite/g) || []).length
  );
  expect(occurrences, 'the same answer must not be listed twice').toBe(1);
  expect(await overflowOf(host)).toBe(0);
  expect(errors).toEqual([]);
});

test('a sheet takes focus, keeps it, and gives it back', async ({ browser }) => {
  const errors = [];
  const { host } = await createRoom(browser, { width: 1280, height: 720 }, errors);
  await host.locator('#s-help').click();
  await expect(host.locator('.stage-overlay')).toBeVisible();
  // Focus moved *into* the dialog (it used to stay on <body>).
  expect(await host.evaluate(() => !!document.activeElement.closest('.stage-overlay'))).toBe(true);
  // ...and Tab cannot walk out of it onto the stage behind.
  for (let i = 0; i < 6; i += 1) {
    await host.keyboard.press('Tab');
    expect(await host.evaluate(() => !!document.activeElement.closest('.stage-overlay'))).toBe(true);
  }
  await host.keyboard.press('Escape');
  await expect(host.locator('.stage-overlay')).toHaveCount(0);
  // Focus came back to the button that opened the sheet.
  expect(await host.evaluate(() => document.activeElement.id)).toBe('s-help');
  expect(errors).toEqual([]);
});

test('open answers can be graded without touching the mouse', async ({ browser }) => {
  const errors = [];
  const csv = toCSV([
    ['block', 'type', 'question', 'option1', 'option2', 'correct', 'time_limit', 'points'],
    ['B', 'open_text', 'Name a database engine', '', '', '', '60', '1000'],
    ['B', 'multiple_choice', 'Filler', 'a', 'b', '1', '20', '1000'],
  ]);
  const { host, code } = await createRoom(browser, { width: 1280, height: 720 }, errors, csv);
  const [token] = await joinMany(host, code, ['Ana']);
  await step(host);
  await step(host);
  expect(await answerAs(host, code, token, 0)).toBe(200);
  await step(host); // reveal + grading rows

  // `G` on a reveal that already carries this question's panel must *reach*
  // that panel, not open a second one: two panels meant two independent
  // `grades` maps, and saving from the overlay silently discarded whatever had
  // been marked inline, leaving two verdicts on the wall for one answer.
  await host.locator('body').press('g');
  await expect(host.locator('.stage-overlay')).toHaveCount(0);
  const inlineRows = host.locator('#s-center .grade-list .group-row');
  await expect(inlineRows).toHaveCount(1);
  await expect(inlineRows.locator('button').first()).toBeFocused();

  // Keyboard only from here: Enter marks the focused group, and the pressed
  // state is real CSS, not just an ARIA attribute nothing paints.
  await host.keyboard.press('Enter');
  await expect(inlineRows.first()).toHaveClass(/marked-ok/);
  const pressedBg = await host.locator('#s-center .pick-ok').first()
    .evaluate((n) => getComputedStyle(n).backgroundColor);
  expect(pressedBg).not.toBe('rgba(0, 0, 0, 0)');
  await host.locator('#s-center #save-grades').press('Enter');
  await expect(host.locator('.toast')).toContainText(/aved|alv|uard/);

  // Only *then* does `G` escalate to the picker - the one thing the inline
  // panel cannot do is grade an earlier question. The saved verdict comes back
  // with it, and the overlay inherits the stage's grading styling now that it
  // lives inside `.stage`: the mark used to render 0x0 with no separator.
  await host.keyboard.press('g');
  await expect(host.locator('.stage-overlay .group-row')).toHaveCount(1);
  await expect(host.locator('.stage-overlay .group-row.marked-ok')).toHaveCount(1);
  const markBox = await host.locator('.stage-overlay .group-row .mark').first().boundingBox();
  expect(markBox.width, 'the overlay verdict mark has a size').toBeGreaterThan(10);
  const rowFont = await fontOf(host, '.stage-overlay .group-row');
  expect(rowFont, 'the overlay grading rows carry the projector type ramp').toBeGreaterThanOrEqual(20);
  expect(errors).toEqual([]);
});

test('two hosts pressing Space produce no console error (SPEC 12)', async ({ browser }) => {
  const errors = [];
  const csv = toCSV([
    ['block', 'type', 'question', 'option1', 'option2', 'correct'],
    ['B', 'multiple_choice', 'One step only?', 'yes', 'no', '1'],
  ]);
  const { host, code } = await createRoom(browser, { width: 1280, height: 720 }, errors, csv);
  await step(host);

  // Two independent stages, both convinced the room is in `reading`.
  const token = await host.evaluate((c) => localStorage.getItem(`livepoll.host.${c}`), code);
  const result = await host.evaluate(async ({ c, tok }) => {
    const call = () => fetch(`/api/rooms/${c}/host/advance`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: 'reading' }),
    }).then(async (r) => ({ status: r.status, code: (await r.json()).error?.code || 'ok' }));
    return Promise.all([call(), call()]);
  }, { c: code, tok: token });

  // One wins, the loser is still STALE_STATE - but as a 200 with an error body,
  // because a 4xx is logged by the browser whatever the JS does with it.
  expect(result.map((r) => r.code).sort()).toEqual(['STALE_STATE', 'ok']);
  expect(result.every((r) => r.status === 200)).toBe(true);
  expect(errors, `console: ${errors.join(' | ')}`).toEqual([]);
});

/**
 * The true/false verdict badge, in the languages where the words are long.
 *
 * `.mark` used to be absolutely positioned in the top-right corner of a card
 * whose label spans the whole centred column, so any word wider than the
 * English "True" ran under the glyph: 51.4x47.6px of overlap on "Verdadeiro" at
 * 1280x720, 117.2x53.5px at 1920x1080, and nothing at all in English - which is
 * exactly why a green English suite never saw it. So this one runs in pt and
 * es, and it measures the intersection rather than trusting a screenshot.
 */
const LOCALE_CASES = [
  { locale: 'pt-BR', viewport: { width: 1280, height: 720 }, words: /Verdadeiro|Falso/ },
  { locale: 'es-ES', viewport: { width: 1920, height: 1080 }, words: /Verdadero|Falso/ },
];

for (const { locale, viewport, words } of LOCALE_CASES) {
  test(`the true/false verdict mark never covers its label (${locale} at ${viewport.width}x${viewport.height})`, async ({ browser }) => {
    const errors = [];
    const csv = toCSV([
      ['block', 'type', 'question', 'option1', 'option2', 'correct', 'time_limit', 'points'],
      ['B', 'true_false', 'The Pacific is the largest ocean on Earth.', '', '', 'true', '60', '1000'],
    ]);
    const { host, code } = await createRoom(browser, viewport, errors, csv, locale);
    const tokens = await joinMany(host, code, ['Ana', 'Bruno']);
    await step(host); // reading
    await step(host); // answering
    for (const [i, token] of tokens.entries()) expect(await answerAs(host, code, token, (i % 2) + 1)).toBe(200);
    await step(host); // reveal - every card carries a mark

    // The labels really are translated: without this the assertion below would
    // pass on an English stage that never had the bug.
    await expect(host.locator('.stage-opts.tf .opt .txt').first()).toHaveText(words);
    await expect(host.locator('.stage-opts.tf .opt .mark')).toHaveCount(2);

    const overlaps = await host.evaluate(() => [...document.querySelectorAll('.stage-opts.tf .opt')].map((opt) => {
      const mark = opt.querySelector('.mark');
      const txt = opt.querySelector('.txt');
      if (!mark || !txt) return null;
      const a = mark.getBoundingClientRect();
      const b = txt.getBoundingClientRect();
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      return w > 0 && h > 0 ? Math.round(w * h) : 0;
    }));
    expect(overlaps, `verdict mark overlapping the label in ${locale}`).toEqual([0, 0]);
    expect(await overflowOf(host), `tf reveal overflow in ${locale}`).toBe(0);
    expect(errors, `console: ${errors.join(' | ')}`).toEqual([]);
  });
}
