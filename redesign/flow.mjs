// Percorre o happy path CLICANDO, não capturando: valida que os destinos
// existem, que o botão primário leva ao próximo passo e que nenhuma tela
// levanta erro de console. Uso: node redesign/flow.mjs
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';

const url = f => pathToFileURL(resolve('redesign', f)).href;
const name = u => decodeURIComponent(u.split('/').pop().split('?')[0]);

// cada passo: [tela, o que clicar, destino esperado]
const HOST = [
  ['index.html', 'a[href="host-create.html"]', 'host-create.html'],
  ['host-create.html', '[data-href="stage-lobby.html"]', 'stage-lobby.html'],
  ['stage-lobby.html', '[data-primary]', 'stage-reading.html'],
  ['stage-reading.html', '[data-primary]', 'stage-answering.html'],
  ['stage-answering.html', '[data-primary]', 'stage-reveal.html'],
  ['stage-reveal.html', '[data-primary]', 'stage-leaderboard.html'],
  ['stage-leaderboard.html', '[data-primary]', 'stage-block-intro.html'],
  ['stage-block-intro.html', '[data-primary]', 'stage-answering-tf.html'],
  ['stage-answering-tf.html', '[data-primary]', 'stage-reveal-tf.html'],
  ['stage-reveal-tf.html', '[data-primary]', 'stage-answering-multi.html'],
  ['stage-answering-multi.html', '[data-primary]', 'stage-reveal-multi.html'],
  ['stage-reveal-multi.html', '[data-primary]', 'stage-answering-open.html'],
  ['stage-answering-open.html', '[data-primary]', 'stage-grading.html'],
  ['stage-grading.html', '[data-primary]', 'stage-reveal-open.html'],
  ['stage-reveal-open.html', '[data-primary]', 'stage-leaderboard.html']
];

const PLAY = [
  ['index.html', 'a[href="play-join.html"]', 'play-join.html'],
  ['play-join.html', '[data-href="play-lobby.html"]', 'play-lobby.html'],
  ['play-lobby.html', '[data-href="play-reading.html"]', 'play-reading.html'],
  ['play-reading.html', '[data-href="play-answering.html"]', 'play-answering.html'],
  ['play-answering.html', '.opt.b', 'play-reveal.html'],
  ['play-reveal.html', '[data-href="play-leaderboard.html"]', 'play-leaderboard.html'],
  ['play-leaderboard.html', '[data-href="play-answering-tf.html"]', 'play-answering-tf.html'],
  ['play-answering-tf.html', '.opt.tf-true', 'play-answering-multi.html'],
  ['play-answering-multi.html', '.opt.a', null],           // marca, não navega
  ['play-answering-multi.html', '#send', 'play-reveal-partial.html', ['.opt.a']],
  ['play-reveal-partial.html', '[data-href="play-answering-open.html"]', 'play-answering-open.html'],
  ['play-answering-open.html', '#send', 'play-summary.html', ['#txt:Perseverance']],
  ['play-summary.html', 'a[href="index.html"]', 'index.html']
];

const browser = await chromium.launch();
let fail = 0;

// 1. todo href/data-href aponta para arquivo que existe?
const files = new Set(readdirSync(resolve('redesign')).filter(f => f.endsWith('.html')));
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  for (const f of files) {
    await page.goto(url(f));
    const targets = await page.evaluate(() =>
      [...document.querySelectorAll('[href],[data-href]')]
        .map(e => e.getAttribute('data-href') || e.getAttribute('href'))
        .filter(h => h && h.endsWith('.html')));
    for (const t of new Set(targets)) {
      if (!existsSync(resolve('redesign', t.split('?')[0]))) {
        console.log(`  ! link morto  ${f} -> ${t}`);
        fail++;
      }
    }
  }
  await ctx.close();
  console.log('links verificados em ' + files.size + ' telas');
}

// 2. percorre cada trilha clicando
for (const [label, steps, vp] of [
  ['TELÃO', HOST, { width: 1280, height: 720 }],
  ['CELULAR', PLAY, { width: 390, height: 844 }]
]) {
  console.log('\n== ' + label);
  const ctx = await browser.newContext({ viewport: vp, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  for (const [from, sel, to, pre] of steps) {
    errs.length = 0;
    await page.goto(url(from));
    await page.waitForTimeout(450);
    // pré-condições (marcar opção, digitar texto)
    for (const p of pre || []) {
      const [s, val] = p.split(':');
      if (val) await page.fill(s, val); else await page.click(s);
      await page.waitForTimeout(250);
    }
    const el = await page.$(sel);
    if (!el) { console.log(`  ! ${from}: seletor não existe (${sel})`); fail++; continue; }
    await el.click();
    await page.waitForTimeout(to ? 2600 : 500);
    const at = name(page.url());
    if (to === null) {
      const ok = at === from;
      console.log(`  ${ok ? 'ok' : '!'} ${from} + ${sel} -> ficou na tela${ok ? '' : ' (foi para ' + at + ')'}`);
      if (!ok) fail++;
    } else {
      const ok = at === to;
      console.log(`  ${ok ? 'ok' : '!'} ${from} -> ${at}${ok ? '' : ' (esperado ' + to + ')'}`);
      if (!ok) fail++;
    }
    if (errs.length) { console.log('    erro de console: ' + errs.slice(0, 2).join(' | ')); fail++; }
  }
  await ctx.close();
}

// 3. teclado do apresentador: Espaço avança em toda tela do telão
console.log('\n== TECLADO (Espaço avança)');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  for (const [from, , to] of HOST.filter(s => s[1] === '[data-primary]')) {
    await page.goto(url(from));
    await page.waitForTimeout(400);
    await page.keyboard.press('Space');
    await page.waitForTimeout(2600);
    const at = name(page.url());
    const ok = at === to;
    console.log(`  ${ok ? 'ok' : '!'} ${from} + Espaço -> ${at}`);
    if (!ok) fail++;
  }
  await ctx.close();
}

await browser.close();
console.log(fail ? `\n${fail} problema(s)` : '\nfluxo completo sem problemas');
process.exit(fail ? 1 : 0);
