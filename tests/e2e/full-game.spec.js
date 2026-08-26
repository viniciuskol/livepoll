// End-to-end: the host runs the stage, two players play from their phones.
// The flow is the cycle-3 state machine: lobby -> reading -> answering ->
// reveal -> leaderboard -> ... -> ended.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { toCSV } from '../../public/js/shared/csv.js';

const template = JSON.parse(readFileSync(new URL('../../public/i18n/en.json', import.meta.url), 'utf8')).template;
const templateCsv = toCSV([template.headers, ...template.rows]);

/** Fails the test on any browser console error. */
function guardConsole(page, errors) {
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`${msg.text()}`); });
  page.on('pageerror', (err) => errors.push(String(err)));
}

/** Creates a room from a CSV and returns the stage page plus the room code. */
async function createRoom(browser, csv, errors, { viewport } = {}) {
  const ctx = await browser.newContext(viewport ? { viewport } : {});
  const host = await ctx.newPage();
  if (errors) guardConsole(host, errors);
  await host.goto('/host.html');
  await host.setInputFiles('#file', { name: 'quiz.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await host.fill('#password', 'secret1');
  await host.click('#create-btn');
  await expect(host.locator('#stage')).toBeVisible();
  await expect(host.locator('#s-code')).toHaveText(/^[A-Z2-9]{6}$/);
  const code = (await host.locator('#s-code').innerText()).trim();
  return { host, code };
}

async function joinPlayer(browser, code, nickname, errors, viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  if (errors) guardConsole(page, errors);
  await page.goto(`/play.html?code=${code}`);
  await page.fill('#nickname', nickname);
  await page.click('#join-btn');
  await expect(page.locator('#game-view')).toBeVisible();
  await expect(page.locator('#p-nick')).toHaveText(nickname);
  return { page, nickname };
}

const hostToken = (host, code) => host.evaluate((c) => localStorage.getItem(`livepoll.host.${c}`), code);

test('the host runs the stage and two players play a question through the new flow', async ({ browser }) => {
  const errors = [];
  const { host, code } = await createRoom(browser, templateCsv, errors, { viewport: { width: 1280, height: 720 } });

  // Lobby: giant code, QR for latecomers, and the strip is always there.
  await expect(host.locator('.lobby-code')).toHaveText(code);
  await expect(host.locator('.lobby-qr canvas')).toBeVisible();
  await expect(host.locator('#s-qr')).toBeVisible();
  await expect(host.locator('#s-primary')).toHaveText('Start the session');

  const players = [];
  for (const nickname of ['Ana', 'Bruno']) players.push(await joinPlayer(browser, code, nickname, errors));
  await expect(host.locator('#s-players')).toContainText('2');
  await expect(host.locator('.roster-chip')).toHaveCount(2);
  await expect(host.locator('.roster')).toContainText('Ana');
  // Every player got an emoji avatar.
  for (const { page } of players) await expect(page.locator('#p-avatar')).not.toBeEmpty();

  // 1) reading: the prompt fills the stage, the phones say "look at the stage"
  //    and carry neither prompt nor options.
  await host.click('#s-primary');
  await expect(host.locator('.scene-prompt')).toContainText('Red Planet');
  await expect(host.locator('.stage-opts')).toHaveCount(0);
  await expect(host.locator('#s-qof')).toContainText('Question 1 of 8');
  await expect(host.locator('#s-block')).toContainText('Warm up');
  for (const { page } of players) {
    await expect(page.locator('#p-center')).toContainText('Look at the stage');
    await expect(page.locator('#p-center')).not.toContainText('Red Planet');
    await expect(page.locator('.ctrl-opts')).toHaveCount(0);
  }
  await expect(host.locator('#s-primary')).toHaveText('Show options');

  // 2) answering: options land on both screens and the clock starts.
  await host.click('#s-primary');
  await expect(host.locator('.stage-opts .opt')).toHaveCount(4);
  await expect(host.locator('#s-ring')).toBeVisible();
  for (const { page } of players) {
    await expect(page.locator('.ctrl-opts .opt')).toHaveCount(4);
    // ~72px targets, and nothing scrolls at 390x844.
    const box = await page.locator('.ctrl-opts .opt').first().boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(60);
    const scrolls = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 1);
    expect(scrolls, 'the controller must not scroll while answering').toBe(false);
  }
  // No distribution while the room answers - only the count.
  await expect(host.locator('#s-answers')).toContainText('0 of 2');
  await expect(host.locator('.opt .fill')).toHaveCount(0);
  await expect(host.locator('.opt .pct')).toHaveCount(0);

  await players[0].page.locator('.ctrl-opts .opt').nth(1).click(); // Ana: correct
  await players[1].page.locator('.ctrl-opts .opt').nth(0).click(); // Bruno: wrong
  await expect(host.locator('#s-answers')).toContainText('2 of 2');
  await expect(players[0].page.locator('#p-center')).toContainText('Answer locked in');
  await expect(players[0].page.locator('#p-count')).toContainText('2 of 2');

  // 3) reveal: correct option marked, distribution animated, explanation shown.
  await host.click('#s-primary');
  await expect(host.locator('.stage-opts .opt.is-correct')).toHaveCount(1);
  await expect(host.locator('.stage-opts .opt.is-wrong')).toHaveCount(3);
  // The distribution rides inside the options at reveal (one strip each).
  await expect(host.locator('.stage-opts.revealed .opt .fill')).toHaveCount(4);
  await expect(host.locator('.stage-opts .opt.is-correct .pct')).toContainText('50%');
  await expect(host.locator('.explain')).toContainText('iron oxide');
  await expect(players[0].page.locator('.ctrl-title')).toHaveText('Correct!');
  await expect(players[0].page.locator('#p-points')).toContainText('points');
  await expect(players[1].page.locator('.ctrl-title')).toHaveText('Not this time');

  // 4) leaderboard: top 5 with movement arrows; the player sees their own row.
  await host.click('#s-primary');
  await expect(host.locator('.stage-lb li')).toHaveCount(2);
  await expect(host.locator('.stage-lb li').first()).toContainText('Ana');
  await expect(host.locator('.stage-lb .lb-delta').first()).toBeVisible();
  await expect(players[0].page.locator('.ctrl-lb li.me')).toContainText('Ana');

  // 5) the keyboard is the primary interface: Space walks the graph.
  await host.locator('body').press('Space');
  await expect(host.locator('.scene-prompt')).toContainText('Pacific');
  await expect(host.locator('#s-qof')).toContainText('Question 2 of 8');
  await host.locator('body').press('ArrowRight');
  await expect(host.locator('.stage-opts .opt')).toHaveCount(2);
  // ArrowLeft walks back to the reading screen and takes the options away.
  await host.locator('body').press('ArrowLeft');
  await expect(host.locator('.stage-opts')).toHaveCount(0);
  await expect(host.locator('#s-primary')).toHaveText('Show options');
  // ? opens the shortcut overlay, Escape closes it.
  await host.locator('body').press('?');
  await expect(host.locator('.stage-overlay')).toContainText('Keyboard shortcuts');
  await host.locator('body').press('Escape');
  await expect(host.locator('.stage-overlay')).toHaveCount(0);

  // 6) the finale: podium and a personal card on every phone.
  await host.click('#s-end');
  await expect(host.locator('.podium > div')).toHaveCount(2);
  await expect(host.locator('.champion')).toContainText('Ana');
  await expect(host.locator('#s-primary')).toBeDisabled();
  // No empty card and no QR advertising a room that refuses joins (P2-6).
  await expect(host.locator('#s-center')).not.toBeEmpty();
  await expect(host.locator('#s-qr')).toBeHidden();
  await expect(host.locator('#s-codewrap')).toBeHidden();
  for (const { page } of players) {
    await expect(page.locator('.ctrl-title')).toContainText("That's a wrap!");
    await expect(page.locator('.summary-row')).toHaveCount(3);
    await expect(page.locator('#p-center')).toContainText('Correct answers');
    await expect(page.locator('#p-center')).toContainText('Best streak');
    await expect(page.locator('#p-center')).toContainText('Final position');
  }

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a player in the reading state cannot find the options anywhere', async ({ browser }) => {
  const errors = [];
  const csv = toCSV([
    ['block', 'type', 'question', 'option1', 'option2', 'correct'],
    ['B', 'multiple_choice', 'Pick the fruit', 'Kumquat', 'Kerosene', '1'],
  ]);
  const { host, code } = await createRoom(browser, csv, errors);
  const ana = await joinPlayer(browser, code, 'Ana', errors);

  await host.click('#s-primary');
  await expect(host.locator('.scene-prompt')).toContainText('Pick the fruit');

  // The player's own payload: no options key, no prompt, no option text.
  const raw = await ana.page.evaluate(async (c) => {
    const res = await fetch(`/api/rooms/${c}/state`);
    return res.text();
  }, code);
  const body = JSON.parse(raw);
  expect(body.state).toBe('reading');
  expect(Object.keys(body.question)).not.toContain('options');
  expect(Object.keys(body.question)).not.toContain('prompt');
  expect(raw).not.toContain('Kumquat');
  expect(raw).not.toContain('Kerosene');
  expect(body.startedAt).toBeNull();
  // ...and there is nothing option-shaped in the DOM either.
  await expect(ana.page.locator('.ctrl-opts')).toHaveCount(0);
  expect(await ana.page.locator('#p-center').innerText()).not.toContain('Kumquat');

  // Showing the options is what starts the clock.
  await host.click('#s-primary');
  await expect(ana.page.locator('.ctrl-opts .opt')).toHaveCount(2);
  const after = await ana.page.evaluate(async (c) => (await fetch(`/api/rooms/${c}/state`)).json(), code);
  expect(after.question.options).toHaveLength(2);
  expect(after.startedAt).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('a double advance only moves the room one step (P2-10)', async ({ browser }) => {
  const errors = [];
  const csv = toCSV([
    ['block', 'type', 'question', 'option1', 'option2', 'correct'],
    ['B', 'multiple_choice', 'One step only?', 'yes', 'no', '1'],
  ]);
  const { host, code } = await createRoom(browser, csv, errors);
  await host.click('#s-primary'); // reading
  await expect(host.locator('.scene-prompt')).toContainText('One step only?');
  await host.click('#s-primary'); // answering
  await expect(host.locator('.stage-opts .opt')).toHaveCount(2);

  // Two advances fired at the same instant, straight at the API.
  const token = await hostToken(host, code);
  const result = await host.evaluate(async ({ c, tok }) => {
    const call = () => fetch(`/api/rooms/${c}/host/advance`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: 'answering' }),
    }).then(async (r) => ({ status: r.status, body: await r.json() }));
    return Promise.all([call(), call()]);
  }, { c: code, tok: token });
  const codes = result.map((r) => (r.body.error ? r.body.error.code : 'ok'));
  expect(codes.filter((x) => x === 'ok')).toHaveLength(1);
  expect(codes).toContain('STALE_STATE');
  // reveal, not reveal-plus-leaderboard.
  await expect(host.locator('.stage-opts.revealed')).toBeVisible();
  await expect(host.locator('#s-primary')).toHaveText('Show ranking');
  await expect(host.locator('.stage-lb')).toHaveCount(0);

  // The same through the UI: two fast clicks on the primary button.
  await Promise.all([host.click('#s-primary'), host.click('#s-primary', { force: true })]);
  await expect(host.locator('.stage-lb')).toBeVisible();
  await expect(host.locator('#s-primary')).toHaveText('Finish the session');
  // The only console noise is the 409 of the race this test fires by hand: the
  // UI path drops the duplicate click before it reaches the network.
  expect(errors.filter((e) => !/409/.test(e))).toEqual([]);
});

test('language switcher translates the landing page', async ({ page }) => {
  const consoleErrors = [];
  guardConsole(page, consoleErrors);
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('Play, learn, compete');
  await page.locator('[data-lang-switch] button', { hasText: 'PT' }).click();
  await expect(page.locator('h1')).toHaveText('Jogue, aprenda, dispute');
  await page.locator('[data-lang-switch] button', { hasText: 'ES' }).click();
  await expect(page.locator('h1')).toHaveText('Juega, aprende, compite');
  await page.reload();
  await expect(page.locator('h1')).toHaveText('Juega, aprende, compite');
  expect(consoleErrors).toEqual([]);
});

test('open text answers can be graded, including a question left behind', async ({ browser }) => {
  const errors = [];
  const csv = toCSV([
    ['block', 'type', 'question', 'option1', 'option2', 'correct', 'time_limit', 'points'],
    ['B', 'open_text', 'Name a database engine', '', '', '', '60', '1000'],
    ['B', 'multiple_choice', 'Filler question', 'a', 'b', '1', '20', '1000'],
  ]);
  const { host, code } = await createRoom(browser, csv, errors);
  const player = await joinPlayer(browser, code, 'Cyd', errors);

  await host.click('#s-primary'); // reading
  await host.click('#s-primary'); // answering
  await player.page.fill('#open-text', 'SQLite');
  await player.page.click('#submit-btn');
  await expect(host.locator('#s-answers')).toContainText('1 of 1');

  await host.click('#s-primary'); // reveal + grading rows
  await expect(host.locator('.grade-list .group-row')).toHaveCount(1);
  // No correctness cue before the host marks anything.
  await expect(host.locator('.group-row.marked-ok')).toHaveCount(0);
  await expect(player.page.locator('.ctrl-title')).toContainText('grade this one');
  await host.locator('.group-row button', { hasText: 'Correct' }).first().click();
  await host.click('#save-grades');
  await expect(host.locator('.toast')).toContainText('Grades saved');
  await expect(player.page.locator('#p-score')).not.toHaveText('0');
  const scoreAfterSave = await player.page.locator('#p-score').innerText();

  // Move on to the next question, then come back to grade the open one (P2-11).
  await host.click('#s-primary'); // leaderboard
  await host.click('#s-primary'); // reading of the filler question
  await expect(host.locator('.scene-prompt')).toContainText('Filler question');
  await host.locator('body').press('g');
  await expect(host.locator('.stage-overlay')).toBeVisible();
  await expect(host.locator('.stage-overlay .grade-pick button')).toHaveCount(1);
  await expect(host.locator('.stage-overlay .group-row')).toHaveCount(1);
  // Saving the same grade again must not inflate the score.
  await host.locator('.stage-overlay #save-grades').click();
  await expect(host.locator('.toast')).toContainText('Grades saved');
  await host.waitForTimeout(1200);
  expect(await player.page.locator('#p-score').innerText()).toBe(scoreAfterSave);
  expect(errors).toEqual([]);
});

test('an unrecognized header row is reported as a header problem', async ({ page }) => {
  const errors = [];
  guardConsole(page, errors);
  await page.goto('/host.html');
  const csv = toCSV([
    ['foo', 'bar', 'baz'],
    ['What is this?', 'a', 'b'],
  ]);
  await page.setInputFiles('#file', { name: 'weird.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  const items = page.locator('#validation .errors li');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('header row was not recognized');
  await expect(items.first()).toContainText('question');
  // Nothing is created from a sheet we could not read.
  await page.fill('#password', 'secret1');
  await page.click('#create-btn');
  await expect(page.locator('#stage')).toBeHidden();
  expect(errors).toEqual([]);
});

test('options lock themselves the moment the timer runs out', async ({ browser }) => {
  const errors = [];
  const csv = toCSV([
    ['block', 'type', 'question', 'option1', 'option2', 'correct', 'time_limit'],
    ['B', 'multiple_choice', 'Too slow?', 'yes', 'no', '1', '5'],
  ]);
  const { host, code } = await createRoom(browser, csv, errors);
  const player = await joinPlayer(browser, code, 'Slowpoke', errors);
  await host.click('#s-primary');
  await host.click('#s-primary');
  await expect(player.page.locator('.ctrl-opts .opt').first()).toBeEnabled();
  // 5s limit: once it elapses the options are replaced by the "time is up"
  // card, so a late tap cannot produce a confusing TIME_UP toast.
  await expect(player.page.locator('.ctrl-title')).toContainText('Time is up!', { timeout: 15_000 });
  await expect(player.page.locator('.ctrl-opts')).toHaveCount(0);
  await expect(player.page.locator('.toast')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the phone prompt can be turned on for accessibility', async ({ browser }) => {
  const errors = [];
  const ctx = await browser.newContext();
  const host = await ctx.newPage();
  guardConsole(host, errors);
  await host.goto('/host.html');
  const csv = toCSV([
    ['block', 'type', 'question', 'option1', 'option2', 'correct'],
    ['B', 'multiple_choice', 'Readable on the phone?', 'yes', 'no', '1'],
  ]);
  await host.setInputFiles('#file', { name: 'a11y.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await host.fill('#password', 'secret1');
  await host.check('#show-prompt');
  await host.click('#create-btn');
  await expect(host.locator('#stage')).toBeVisible();
  const code = (await host.locator('#s-code').innerText()).trim();
  const player = await joinPlayer(browser, code, 'Ana', errors);
  await host.click('#s-primary');
  await expect(player.page.locator('.ctrl-prompt')).toContainText('Readable on the phone?');
  expect(errors).toEqual([]);
});

test('template downloads round-trip back through the upload validator', async ({ page }, testInfo) => {
  const errors = [];
  guardConsole(page, errors);
  await page.goto('/host.html');

  for (const [button, filename] of [['#dl-csv', 'template.csv'], ['#dl-xlsx', 'template.xlsx']]) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.click(button)]);
    const path = testInfo.outputPath(filename);
    await download.saveAs(path);
    await page.setInputFiles('#file', path);
    await expect(page.locator('#validation')).toContainText('Spreadsheet looks good');
    await expect(page.locator('#preview tbody tr')).toHaveCount(8);
  }
  expect(errors).toEqual([]);
});

test('rows with problems are reported per line and block room creation', async ({ page }) => {
  await page.goto('/host.html');
  const csv = toCSV([
    ['block', 'type', 'question', 'option1', 'option2', 'correct'],
    ['B', 'multiple_choice', '', 'a', 'b', '1'],
    ['B', 'multiple_choice', 'Only one option', 'a', '', '1'],
    ['B', 'bogus_type', 'What type is this?', 'a', 'b', '1'],
  ]);
  await page.setInputFiles('#file', { name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await expect(page.locator('#validation')).toContainText('problem(s) found');
  const errorItems = page.locator('#validation .errors li');
  await expect(errorItems).toHaveCount(3);
  await expect(errorItems.nth(0)).toContainText('Row 2');
  await expect(errorItems.nth(0)).toContainText('question text is required');
  await expect(errorItems.nth(1)).toContainText('At least 2 options');
  await expect(errorItems.nth(2)).toContainText('Unknown question type');

  await page.fill('#password', 'secret1');
  await page.click('#create-btn');
  await expect(page.locator('.toast')).toBeVisible();
  await expect(page.locator('#stage')).toBeHidden();
});

test('joining a session that is over says so, with no console error (P2-9)', async ({ browser }) => {
  const errors = [];
  const csv = toCSV([
    ['block', 'type', 'question', 'option1', 'option2', 'correct'],
    ['B', 'multiple_choice', 'Anybody home?', 'yes', 'no', '1'],
  ]);
  const { host, code } = await createRoom(browser, csv, errors);
  await host.click('#s-end');
  await expect(host.locator('#s-center')).toContainText('Final podium');

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const late = await ctx.newPage();
  guardConsole(late, errors);
  await late.goto(`/play.html?code=${code}`);
  await late.fill('#nickname', 'Latecomer');
  await late.click('#join-btn');
  await expect(late.locator('.toast')).toContainText('This session is over');
  await expect(late.locator('#game-view')).toBeHidden();
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});
