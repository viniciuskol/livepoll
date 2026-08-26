// Gera prints do fluxo real do LivePoll em docs/screenshots/.
// Sobe seu próprio `wrangler dev` (porta e estado isolados) para não brigar
// com um servidor de desenvolvimento já rodando, e conduz o palco pelo mesmo
// botão primário que o apresentador usaria.
//
//   node tools/screenshots.mjs [--port 8788] [--out docs/screenshots]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { toCSV } from '../public/js/shared/csv.js';

const args = process.argv.slice(2);
const argv = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i === -1 ? fallback : args[i + 1];
};
const PORT = Number(argv('--port', '8788'));
const OUT = argv('--out', 'docs/screenshots');
const STATE = '.wrangler/state-shots';
const BASE = `http://127.0.0.1:${PORT}`;
const CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';

const template = JSON.parse(readFileSync(new URL('../public/i18n/pt.json', import.meta.url), 'utf8')).template;
const templateCsv = toCSV([template.headers, ...template.rows]);

const shots = [];
async function shot(page, name, label) {
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file });
  shots.push({ file, label });
  console.log(`  ✓ ${file} — ${label}`);
}

// `detached` para podermos matar o grupo inteiro: o wrangler deixa um workerd
// filho que sobrevive a um SIGTERM só no processo pai — e um workerd zumbi na
// porta faz a rodada seguinte falar com um servidor apontando para um D1 que já
// foi apagado (500 na criação de sala, difícil de diagnosticar).
function run(cmd, cmdArgs) {
  return spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
}

function killTree(child) {
  if (!child) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* já morreu */ }
}

async function portIsFree() {
  try {
    await fetch(`${BASE}/api/health`);
    return false;
  } catch {
    return true;
  }
}

async function requirePortFree() {
  if (await portIsFree()) return;
  console.log(`· porta ${PORT} ocupada, encerrando servidor anterior`);
  spawn('pkill', ['-f', `port ${PORT}`], { stdio: 'ignore' });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    await sleep(1000);
    if (await portIsFree()) return;
  }
  throw new Error(`porta ${PORT} continua ocupada; encerre o processo manualmente`);
}

async function waitForServer(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch { /* ainda subindo */ }
    await sleep(500);
  }
  throw new Error(`servidor não respondeu em ${BASE}/api/health`);
}

/** O palco anuncia o estado em `data-state`: espera por ele em vez do relógio. */
const stageState = (page, state) =>
  page.waitForSelector(`#stage[data-state="${state}"]`, { timeout: 30_000 });

/** Avança o palco pelo mesmo botão primário que o apresentador aperta. */
async function advance(page, toState) {
  await page.click('#s-primary');
  if (toState) await stageState(page, toState);
}

let server;
async function main() {
  await requirePortFree();
  rmSync(STATE, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  console.log('· aplicando migrations no estado isolado dos prints');
  await new Promise((resolve, reject) => {
    const m = run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'livepoll_db', '--local', '--persist-to', STATE]);
    m.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`migrations falharam (${code})`))));
  });

  console.log(`· subindo wrangler dev em :${PORT}`);
  server = run('npx', ['wrangler', 'dev', '--local', '--persist-to', STATE, '--port', String(PORT)]);
  server.on('exit', (code) => {
    if (code) console.error(`· wrangler dev saiu com código ${code}`);
  });
  await waitForServer();

  const browser = await chromium.launch({
    executablePath: existsSync(CHROMIUM) ? CHROMIUM : undefined,
  });

  // Cada contexto nasce com o idioma já escolhido, para o print não pegar a UI
  // no idioma anterior enquanto o i18n troca.
  const ctxWith = (lang, viewport) => browser.newContext({ ...viewport, baseURL: BASE })
    .then(async (ctx) => {
      await ctx.addInitScript(`localStorage.setItem('livepoll.lang', ${JSON.stringify(lang)})`);
      return ctx;
    });
  const DESKTOP = { viewport: { width: 1280, height: 720 } };   // pior caso de projetor
  const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

  // ---------- Página inicial nos três idiomas ----------
  for (const [lang, name] of [['pt', '01-landing-pt'], ['en', '02-landing-en'], ['es', '03-landing-es']]) {
    const ctx = await ctxWith(lang, DESKTOP);
    const landing = await ctx.newPage();
    await landing.goto('/');
    await landing.waitForTimeout(400);
    await shot(landing, name, `Página inicial (${lang.toUpperCase()})`);
    await ctx.close();
  }

  // ---------- Host: planilha modelo validada ----------
  const hostCtx = await ctxWith('pt', DESKTOP);
  const host = await hostCtx.newPage();
  await host.goto('/host.html');
  await host.setInputFiles('#file', {
    name: 'quiz.csv', mimeType: 'text/csv', buffer: Buffer.from(templateCsv, 'utf8'),
  });
  await host.waitForSelector('#preview tbody tr');
  await host.waitForTimeout(300);
  await shot(host, '04-host-upload-preview', 'Host: planilha validada com preview das perguntas');

  await host.fill('#title', 'Aulão de Agentes');
  await host.fill('#password', 'senha123');
  await host.click('#create-btn');
  await stageState(host, 'lobby');
  await host.waitForTimeout(700);
  const code = (await host.locator('#s-code').innerText()).trim();
  console.log(`  · sala ${code}`);

  // ---------- Participantes entram pelo celular ----------
  const players = [];
  for (const nickname of ['Ana', 'Bruno', 'Chris', 'Duda', 'Enzo']) {
    const ctx = await ctxWith('pt', PHONE);
    const page = await ctx.newPage();
    await page.goto(`/play.html?code=${code}`);
    await page.waitForTimeout(200);
    await page.fill('#nickname', nickname);
    if (players.length === 0) await shot(page, '05-play-join-mobile', 'Participante: entrada pelo celular (código + apelido)');
    await page.click('#join-btn');
    await page.waitForSelector('#game-view:not(.hidden)');
    players.push({ page, nickname });
  }
  await host.waitForTimeout(1200);
  await shot(host, '06-stage-lobby', `Palco: sala ${code} com QR e participantes entrando`);
  await shot(players[0].page, '07-play-lobby-mobile', 'Participante: sala de espera no celular');

  // ---------- reading: enunciado no telão, celular sem opções ----------
  await advance(host, 'reading');
  await host.waitForTimeout(900);
  await shot(host, '08-stage-reading', 'Palco: só o enunciado, para o apresentador ler em voz alta');
  await shot(players[0].page, '09-play-reading-mobile', 'Participante: "olhe para o telão" — sem opções, timer parado');

  // ---------- answering: opções liberadas, timer começa ----------
  await advance(host, 'answering');
  await players[0].page.waitForSelector('#options .opt', { timeout: 30_000 });
  await host.waitForTimeout(1100);
  await shot(host, '10-stage-answering', 'Palco: opções liberadas, anel de timer e contagem de respostas');
  await shot(players[0].page, '11-play-answering-mobile', 'Participante: opções na mão, alvos grandes');

  // Reações antes de responder, para o print do palco pegar os emojis subindo.
  for (const p of players.slice(0, 4)) {
    for (const i of [0, 1, 2]) await p.page.locator('#reactions button').nth(i).click();
  }
  await host.waitForTimeout(600);
  await shot(host, '12-stage-reactions', 'Palco: reações dos participantes flutuando');

  await players[0].page.locator('#options .opt').nth(1).click();
  await players[1].page.locator('#options .opt').nth(0).click();
  await players[2].page.locator('#options .opt').nth(1).click();
  await players[3].page.locator('#options .opt').nth(1).click();
  await host.waitForTimeout(900);
  await shot(players[0].page, '13-play-answered-mobile', 'Participante: resposta confirmada, aguardando os outros');

  // ---------- reveal ----------
  await advance(host, 'reveal');
  await host.waitForTimeout(1200);
  await shot(host, '14-stage-reveal', 'Palco: resposta correta em destaque e distribuição das respostas');
  await shot(players[0].page, '15-play-correct-mobile', 'Participante: acertou — pontos, streak e posição');
  await shot(players[1].page, '16-play-wrong-mobile', 'Participante: errou');

  // ---------- leaderboard ----------
  await advance(host, 'leaderboard');
  await host.waitForTimeout(1400);
  await shot(host, '17-stage-leaderboard', 'Palco: ranking com movimentação de posições');
  await shot(players[0].page, '18-play-leaderboard-mobile', 'Participante: ranking com a própria posição destacada');

  // ---------- atalhos de teclado ----------
  await host.keyboard.press('?');
  await host.waitForTimeout(500);
  await shot(host, '19-stage-shortcuts', 'Palco: atalhos de teclado para conduzir como um slide deck');
  await host.keyboard.press('Escape');
  await host.waitForTimeout(300);

  // ---------- percorre o quiz até a virada de bloco e o fim ----------
  let blockShot = false;
  for (let i = 0; i < 40; i++) {
    const state = await host.getAttribute('#stage', 'data-state');
    if (state === 'ended') break;
    if (state === 'block_intro' && !blockShot) {
      await host.waitForTimeout(700);
      await shot(host, '20-stage-block-intro', 'Palco: cartela de virada de bloco');
      blockShot = true;
    }
    if (state === 'answering') {
      // Responde com todo mundo para o ranking final ter movimento.
      for (const [idx, p] of players.entries()) {
        const opts = p.page.locator('#options .opt');
        const count = await opts.count();
        if (count) await opts.nth(idx % count).click().catch(() => {});
        const openInput = p.page.locator('#open-text');
        if (await openInput.count()) {
          await openInput.fill(idx % 2 ? 'Cloudflare D1' : 'D1');
          await p.page.locator('#submit-btn').click().catch(() => {});
        }
      }
      await host.waitForTimeout(400);
    }
    await host.click('#s-primary').catch(() => {});
    await host.waitForTimeout(700);

    // Pergunta aberta: o palco abre o painel de correção no reveal.
    if (await host.locator('#s-center .grading').count()) {
      await shot(host, '21-stage-grading-open', 'Palco: correção manual das respostas abertas agrupadas');
    }
  }

  await stageState(host, 'ended');
  await host.waitForTimeout(1800);
  await shot(host, '22-stage-podium', 'Palco: pódio final da partida');
  await shot(players[0].page, '23-play-summary-mobile', 'Participante: resumo pessoal no fim da partida');

  await browser.close();
  console.log(`\n${shots.length} prints em ${OUT}/`);
  console.log(shots.map((s) => `${s.file}\t${s.label}`).join('\n'));
}

try {
  await main();
} finally {
  killTree(server);
  await sleep(800);
}
