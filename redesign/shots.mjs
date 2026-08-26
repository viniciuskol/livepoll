// Captura o redesign nas resoluções-alvo. Uso: node redesign/shots.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const OUT = resolve('redesign/shots');
mkdirSync(OUT, { recursive: true });

const STAGE = [
  'index', 'host-create', 'stage-lobby', 'stage-reading', 'stage-answering',
  'stage-reveal', 'stage-leaderboard', 'stage-block-intro', 'stage-podium',
  'stage-shortcuts',
  'stage-answering-tf', 'stage-reveal-tf', 'stage-answering-multi',
  'stage-reveal-multi', 'stage-answering-open', 'stage-grading', 'stage-reveal-open'
];
const PLAY = [
  'play-join', 'play-lobby', 'play-reading', 'play-answering', 'play-reveal',
  'play-leaderboard', 'play-summary',
  'play-answering-tf', 'play-answering-multi', 'play-answering-open',
  'play-reveal-partial'
];

const VIEWPORTS = [
  { tag: '720p', w: 1280, h: 720, pages: STAGE },
  { tag: '1080p', w: 1920, h: 1080, pages: STAGE },
  { tag: 'iphone', w: 390, h: 844, pages: PLAY.concat(['index', 'host-create']) },
  { tag: 'small', w: 375, h: 667, pages: PLAY },
  { tag: 'tablet', w: 768, h: 1024, pages: PLAY.concat(['index', 'host-create']) },
  { tag: 'desktop', w: 1440, h: 900, pages: PLAY.concat(['index', 'host-create']) },
  { tag: 'landscape', w: 844, h: 390, pages: PLAY },
  // widescreen / projetores grandes / monitores ultrawide
  { tag: 'wuxga', w: 1920, h: 1200, pages: STAGE },
  { tag: 'qhd', w: 2560, h: 1440, pages: STAGE.concat(PLAY) },
  { tag: 'ultrawide', w: 3440, h: 1440, pages: STAGE.concat(PLAY) },
  { tag: 'uhd', w: 3840, h: 2160, pages: STAGE }
];

const browser = await chromium.launch();
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce'
  });
  const page = await ctx.newPage();
  for (const name of vp.pages) {
    const url = pathToFileURL(resolve('redesign', name + '.html')).href;
    await page.goto(url);
    await page.waitForTimeout(700);
    // detecta overflow horizontal e vertical indevido
    const bad = await page.evaluate(() => {
      const d = document.documentElement;
      const out = [];
      if (d.scrollWidth > d.clientWidth + 1) out.push('overflow-x ' + d.scrollWidth + '>' + d.clientWidth);
      if (!document.body.classList.contains('scrollable') && d.scrollHeight > d.clientHeight + 1)
        out.push('overflow-y ' + d.scrollHeight + '>' + d.clientHeight);
      // "Sem rolagem na dobra" e uma regra das telas de RESPOSTA (cronometradas,
      // o polegar precisa alcancar tudo sem tirar o olho do telao). Resumo,
      // ranking e cadastro sao leitura: rolar ali e aceitavel.
      const timed = document.querySelector('.opts-mobile, .open-input');
      for (const sel of ['.play-body', '.scene']) {
        const el = document.querySelector(sel);
        if (!el || el.scrollHeight <= el.clientHeight + 4) continue;
        const isTimed = sel === '.play-body' ? !!timed : true;
        out.push((isTimed ? 'scroll em tela cronometrada ' : 'scroll (ok, leitura) ') +
                 sel + ' ' + el.scrollHeight + '>' + el.clientHeight);
      }
      return out;
    });
    if (bad.length) console.log('  ! ' + vp.tag + '/' + name + ': ' + bad.join(', '));
    await page.screenshot({ path: `${OUT}/${vp.tag}-${name}.png` });
  }
  await ctx.close();
  console.log('ok ' + vp.tag);
}
await browser.close();
console.log('shots em redesign/shots/');
