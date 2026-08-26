/* ============================================================
   LivePoll — NEON ARENA · runtime compartilhado
   Sem dependências. Tudo sintetizado/desenhado localmente.
   ============================================================ */
(function (global) {
  'use strict';

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 1. Atmosfera (injetada em toda tela) ---------- */
  function atmosphere() {
    if (document.querySelector('.atmos')) return;
    const el = document.createElement('div');
    el.className = 'atmos';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<div class="aurora a"></div><div class="aurora b"></div>' +
      '<div class="aurora c"></div><div class="grain"></div>';
    document.body.prepend(el);
  }

  /* ---------- 2. Som — WebAudio puro, zero arquivos ---------- */
  const SFX = (function () {
    let ctx = null;
    let muted = localStorage.getItem('lp.muted') === '1';

    // A politica de autoplay do Chrome rejeita qualquer AudioContext criado sem
    // gesto do usuario NESTA pagina — e a ativacao nao sobrevive a navegacao.
    // Sem isto, reveal/correct/fanfare (os momentos que importam) sao mudos:
    // eles rodam no load da tela seguinte, nao num clique.
    // Solucao: enfileirar o que for pedido antes da ativacao e soltar no
    // primeiro gesto real, descartando o que ja passou do tempo de ser ouvido.
    let armed = false;
    const pending = [];
    const QUEUE_TTL = 4000;

    function arm() {
      if (armed) return;
      armed = true;
      try { ac(); } catch (e) { return; }
      const now = Date.now();
      pending.splice(0).forEach(function (job) {
        if (now - job.t < QUEUE_TTL) job.run();
      });
    }
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (evt) {
      addEventListener(evt, arm, { once: true, capture: true });
    });

    function ac() {
      if (!ctx) ctx = new (global.AudioContext || global.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function tone(freq, dur, type, gain, delay, sweepTo) {
      if (muted) return;
      if (!armed) {
        pending.push({ t: Date.now(), run: function () { tone(freq, dur, type, gain, delay, sweepTo); } });
        return;
      }
      const c = ac();
      const t0 = c.currentTime + (delay || 0);
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain == null ? 0.16 : gain, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    }
    function noise(dur, gain, hp) {
      if (muted) return;
      if (!armed) {
        pending.push({ t: Date.now(), run: function () { noise(dur, gain, hp); } });
        return;
      }
      const c = ac();
      const n = c.sampleRate * dur;
      const buf = c.createBuffer(1, n, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = c.createBufferSource();
      src.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = hp || 900;
      const g = c.createGain();
      g.gain.value = gain == null ? 0.12 : gain;
      src.connect(f).connect(g).connect(c.destination);
      src.start();
    }

    const api = {
      get muted() { return muted; },
      arm: arm,
      get armed() { return armed; },
      toggle() {
        arm();
        muted = !muted;
        localStorage.setItem('lp.muted', muted ? '1' : '0');
        document.querySelectorAll('[data-sfx-toggle]').forEach(function (b) {
          b.textContent = muted ? '🔇' : '🔊';
          b.setAttribute('aria-pressed', String(muted));
        });
        if (!muted) api.tap();
        return muted;
      },
      tap()     { tone(560, 0.05, 'triangle', 0.09); },
      pick()    { tone(420, 0.07, 'square', 0.07); tone(660, 0.09, 'triangle', 0.09, 0.04); },
      join()    { tone(523, 0.1, 'sine', 0.1); tone(784, 0.14, 'sine', 0.1, 0.07); },
      tick()    { tone(1180, 0.035, 'square', 0.045); },
      urgent()  { tone(1500, 0.05, 'square', 0.08); },
      whoosh()  { tone(180, 0.4, 'sawtooth', 0.05, 0, 900); },
      count(n)  { tone(400 + n * 120, 0.16, 'triangle', 0.13); },
      reveal()  { tone(300, 0.25, 'sawtooth', 0.06, 0, 720);  },
      correct() { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.32, 'triangle', 0.13, i * 0.075); }); },
      wrong()   { tone(196, 0.3, 'sawtooth', 0.11); tone(146, 0.4, 'square', 0.08, 0.06); },
      board()   { [392, 494, 587].forEach(function (f, i) { tone(f, 0.4, 'sine', 0.1, i * 0.1); }); },
      fanfare() {
        [523, 659, 784, 1047, 1319].forEach(function (f, i) { tone(f, 0.5, 'triangle', 0.14, i * 0.12); });
        [0, 0.12, 0.24, 0.36].forEach(function (d) { noise(0.5, 0.06, 2200); });
      }
    };
    return api;
  })();

  /* ---------- 3. Vibração ---------- */
  function buzz(pattern) {
    if (navigator.vibrate && !reduced) { try { navigator.vibrate(pattern); } catch (e) {} }
  }

  /* ---------- 4. fitQuestion — a correção do tamanho da fonte ----------
     O design atual usava um tamanho único gigante. Aqui o tamanho reage
     ao comprimento do enunciado e ao espaço disponível. */
  function fitQuestion(el) {
    if (!el) return;
    const len = (el.textContent || '').trim().length;
    el.classList.remove('q-xs', 'q-s', 'q-m', 'q-l', 'q-xl');
    el.classList.add(
      len <= 26  ? 'q-xs' :
      len <= 48  ? 'q-s'  :
      len <= 84  ? 'q-m'  :
      len <= 140 ? 'q-l'  : 'q-xl'
    );
    // Guarda-costas: só age quando há transbordo REAL, e nunca encolhe abaixo
    // de 70% do tamanho da classe (um enunciado ilegível a 8m é pior que
    // um enunciado com uma linha a mais).
    requestAnimationFrame(function () {
      const base = parseFloat(getComputedStyle(el).fontSize);
      const floor = base * 0.7;
      // caixa de referência: um ancestral que realmente limita a altura
      const box = el.closest('[data-fit-box]');
      let size = base;
      let guard = 10;
      while (guard-- > 0) {
        const tooWide = el.scrollWidth > el.clientWidth + 1;
        const tooTall = box && box.clientHeight > 0 &&
                        el.getBoundingClientRect().height > box.clientHeight + 1;
        if (!tooWide && !tooTall) break;
        size *= 0.94;
        if (size < floor) { size = floor; el.style.fontSize = size + 'px'; break; }
        el.style.fontSize = size + 'px';
      }
    });
  }
  function fitAllQuestions() {
    document.querySelectorAll('.question').forEach(function (q) { q.style.fontSize = ''; fitQuestion(q); });
  }

  /* ---------- 5. Contador crescente ---------- */
  function countUp(el, to, ms) {
    if (!el) return;
    if (reduced) {
      el.textContent = (el.dataset.prefix || '') + to.toLocaleString('pt-BR');
      return;
    }
    const dur = ms || 900;
    const from = 0;
    const t0 = performance.now();
    const prefix = el.dataset.prefix || '';
    (function step(t) {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = prefix + Math.round(from + (to - from) * eased).toLocaleString('pt-BR');
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }

  /* ---------- 6. Anel de timer ---------- */
  function ring(dialEl, seconds, onEnd) {
    if (!dialEl) return { stop: function () {} };
    const bar = dialEl.querySelector('.bar');
    const num = dialEl.querySelector('.num');
    const R = bar ? Number(bar.getAttribute('r')) : 44;
    const C = 2 * Math.PI * R;
    if (bar) { bar.style.strokeDasharray = C; bar.style.strokeDashoffset = 0; }
    let left = seconds;
    if (num) num.textContent = left;
    const id = setInterval(function () {
      left--;
      if (num) num.textContent = Math.max(0, left);
      if (bar) bar.style.strokeDashoffset = C * (1 - left / seconds);
      dialEl.classList.toggle('warn', left <= seconds * 0.5 && left > 5);
      dialEl.classList.toggle('danger', left <= 5);
      if (left <= 5 && left > 0) SFX.urgent(); else if (left > 0) SFX.tick();
      if (left <= 0) { clearInterval(id); if (onEnd) onEnd(); }
    }, 1000);
    return { stop: function () { clearInterval(id); } };
  }

  /* ---------- 7. Barra de tempo (celular) ---------- */
  function timebar(el, seconds, onEnd) {
    if (!el) return { stop: function () {} };
    const i = el.querySelector('i');
    let left = seconds;
    const id = setInterval(function () {
      left--;
      if (i) i.style.width = Math.max(0, (left / seconds) * 100) + '%';
      el.classList.toggle('warn', left <= seconds * 0.5 && left > 5);
      el.classList.toggle('danger', left <= 5);
      if (left <= 0) { clearInterval(id); if (onEnd) onEnd(); }
    }, 1000);
    return { stop: function () { clearInterval(id); } };
  }

  /* ---------- 8. Contagem 3-2-1 ---------- */
  function countdown(done) {
    if (reduced) { done && done(); return; }
    const wrap = document.createElement('div');
    wrap.className = 'countdown';
    wrap.setAttribute('aria-hidden', 'true');
    document.body.appendChild(wrap);
    let n = 3;
    (function beat() {
      wrap.innerHTML = '<div class="n">' + n + '</div>';
      SFX.count(4 - n);
      n--;
      if (n >= 0) setTimeout(beat, 750);
      else { SFX.whoosh(); wrap.remove(); done && done(); }
    })();
  }

  /* ---------- 9. Confete (canvas) ---------- */
  function confetti(ms) {
    if (reduced) return;
    let cv = document.getElementById('confetti');
    if (!cv) { cv = document.createElement('canvas'); cv.id = 'confetti'; document.body.appendChild(cv); }
    const ctx = cv.getContext('2d');
    const dpr = Math.min(2, devicePixelRatio || 1);
    function size() { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    size(); addEventListener('resize', size);
    const colors = ['#ff2e83', '#00d5ff', '#ffb020', '#3ddc84', '#8b5cff', '#ffffff'];
    const parts = [];
    for (let i = 0; i < 170; i++) {
      parts.push({
        x: Math.random() * innerWidth,
        y: -20 - Math.random() * innerHeight * 0.6,
        w: 6 + Math.random() * 8,
        h: 9 + Math.random() * 12,
        vy: 2 + Math.random() * 3.4,
        vx: -1.4 + Math.random() * 2.8,
        rot: Math.random() * Math.PI,
        vr: -0.12 + Math.random() * 0.24,
        c: colors[(Math.random() * colors.length) | 0]
      });
    }
    const stopAt = performance.now() + (ms || 5200);
    (function frame(t) {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      parts.forEach(function (p) {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        if (p.y > innerHeight + 30) { p.y = -20; p.x = Math.random() * innerWidth; }
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.c; ctx.globalAlpha = 0.92;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (t < stopAt) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, innerWidth, innerHeight);
    })(performance.now());
  }

  /* ---------- 10. Reações flutuantes ---------- */
  // Em tablet/desktop o jogador vive dentro de um console com moldura: a
  // recompensa visual tem que cair dentro dele, nao no fundo da pagina.
  function fxHost() { return document.querySelector('.phone') || document.body; }

  function floatEmoji(emoji) {
    const host = fxHost();
    let layer = host.querySelector(':scope > .floaters');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'floaters';
      layer.setAttribute('aria-hidden', 'true');
      host.appendChild(layer);
    }
    const e = document.createElement('span');
    e.className = 'floater';
    e.textContent = emoji;
    e.style.left = (8 + Math.random() * 84) + '%';
    e.style.setProperty('--r', (-40 + Math.random() * 80) + 'deg');
    layer.appendChild(e);
    setTimeout(function () { e.remove(); }, 3300);
  }

  /* ---------- 11. Flash de acerto/erro ---------- */
  function flash(kind) {
    const host = fxHost();
    let el = host.querySelector(':scope > .flash');
    if (!el) { el = document.createElement('div'); el.className = 'flash'; host.appendChild(el); }
    el.className = 'flash ' + kind;
    if (reduced) {
      // sem animacao, mas o retorno de acerto/erro nao pode simplesmente sumir
      el.style.opacity = '.9';
      setTimeout(function () { el.style.opacity = '0'; }, 600);
      return;
    }
    el.style.opacity = '';
    void el.offsetWidth;
    el.classList.add('on');
    setTimeout(function () { el.classList.remove('on'); }, 800);
  }

  /* ---------- 12. Toast ---------- */
  let toastTimer;
  function toast(msg) {
    const host = fxHost();
    let el = host.querySelector(':scope > .toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); host.appendChild(el); }
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('on'); }, 2200);
  }

  /* ---------- 13. Navegação do happy path ---------- */
  function go(href) {
    document.body.style.transition = 'opacity .22s';
    document.body.style.opacity = '0';
    setTimeout(function () { location.href = href; }, reduced ? 0 : 190);
  }

  /* ---------- 14. Teclado do telão ---------- */
  function stageKeys(opts) {
    const o = opts || {};
    addEventListener('keydown', function (e) {
      const k = e.key;
      // Espaco/Enter pertencem ao controle focado. Sequestra-los faz o
      // apresentador aplicar a acao primaria achando que marcou uma caixa.
      if ((k === ' ' || k === 'Enter') && e.target &&
          e.target.closest('button,a,input,textarea,select,[contenteditable]') &&
          !e.target.closest('[data-primary]')) return;
      if (k === ' ' || k === 'Enter' || k === 'ArrowRight') {
        e.preventDefault();
        const btn = document.querySelector('[data-primary]');
        if (btn) btn.click();
      } else if (k === 'ArrowLeft') {
        const b = document.querySelector('[data-back]');
        if (b) b.click();
      } else if (k === 'f' || k === 'F') {
        toggleFullscreen();
      } else if (k === 'm' || k === 'M') {
        toast(SFX.toggle() ? 'Som desligado' : 'Som ligado');
      } else if (k === 'l' || k === 'L') {
        if (o.leaderboard) go(o.leaderboard);
      } else if (k === 'g' || k === 'G') {
        if (o.grading) go(o.grading);
        else toast('Correcao manual so em perguntas de resposta aberta');
      } else if (k === '?') {
        if (o.shortcuts) {
          const from = location.pathname.split('/').pop();
          go(o.shortcuts + '?from=' + encodeURIComponent(from));
        }
      } else if (k === 'Escape') {
        const b = document.querySelector('[data-close]');
        if (b) b.click();
      }
    });
  }
  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(function () {});
    else document.exitFullscreen();
  }

  /* ---------- 15. QR local (matriz decorativa determinística) ----------
     Não é um QR válido — é um placeholder visual estável para o protótipo,
     desenhado localmente (sem CDN), com os 3 olhos de posicionamento. */
  function qr(el, seed, cells) {
    if (!el) return;
    const N = cells || 25;
    let h = 0;
    const s = String(seed || 'LIVEPOLL');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    function rnd() { h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; }
    let d = '';
    function eye(x, y) {
      d += 'M' + x + ' ' + y + 'h7v7h-7z M' + (x + 1) + ' ' + (y + 1) + 'h5v5h-5z ';
      d += 'M' + (x + 2) + ' ' + (y + 2) + 'h3v3h-3z ';
    }
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const inEye = (x < 8 && y < 8) || (x > N - 9 && y < 8) || (x < 8 && y > N - 9);
        if (inEye) continue;
        if (rnd() > 0.52) d += 'M' + x + ' ' + y + 'h1v1h-1z ';
      }
    }
    eye(0, 0); eye(N - 7, 0); eye(0, N - 7);
    el.innerHTML =
      '<svg viewBox="0 0 ' + N + ' ' + N + '" width="100%" height="100%" shape-rendering="crispEdges" role="img" aria-label="QR code da sala">' +
      '<rect width="' + N + '" height="' + N + '" fill="#fff"/>' +
      '<path d="' + d + '" fill="#0b0620" fill-rule="evenodd"/></svg>';
  }

  /* ---------- 16. Boot comum ---------- */
  function boot() {
    atmosphere();
    fitAllQuestions();
    addEventListener('resize', function () { clearTimeout(boot._t); boot._t = setTimeout(fitAllQuestions, 120); });

    // links internos com transição
    document.querySelectorAll('a[data-go]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); go(a.getAttribute('href')); });
    });
    // botões com destino
    document.querySelectorAll('[data-href]').forEach(function (b) {
      b.addEventListener('click', function () { go(b.dataset.href); });
    });
    // toggle de som
    document.querySelectorAll('[data-sfx-toggle]').forEach(function (b) {
      b.textContent = SFX.muted ? '🔇' : '🔊';
      b.setAttribute('aria-pressed', String(SFX.muted));
      b.addEventListener('click', function () { SFX.toggle(); });
    });
    document.querySelectorAll('[data-fullscreen]').forEach(function (b) {
      b.addEventListener('click', toggleFullscreen);
    });
    // reações
    document.querySelectorAll('[data-react]').forEach(function (b) {
      b.addEventListener('click', function () {
        floatEmoji(b.dataset.react); SFX.tap(); buzz(12);
      });
    });
    // 5 ou 6 alternativas viram coluna unica (em 2x3 o alvo fica baixo demais,
    // e com 5 sobra uma celula orfa do tamanho de um alvo)
    document.querySelectorAll('.opts-mobile').forEach(function (g) {
      g.classList.toggle('many', g.children.length > 4);
    });
    // QRs
    document.querySelectorAll('[data-qr]').forEach(function (el) { qr(el, el.dataset.qr); });
    // som no clique de botões
    document.querySelectorAll('.btn').forEach(function (b) {
      b.addEventListener('pointerdown', function () { SFX.tap(); });
    });
    // fade-in da página
    document.body.style.opacity = '0';
    requestAnimationFrame(function () {
      document.body.style.transition = 'opacity .3s';
      document.body.style.opacity = '1';
    });
  }

  /* ---------- 17. Anuncio para leitor de tela ----------
     Uma live region so dispara se o conteudo chegar DEPOIS do load. */
  function say(msg) {
    let el = document.getElementById('lp-say');
    if (!el) {
      el = document.createElement('p');
      el.id = 'lp-say';
      el.className = 'sr-only';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    requestAnimationFrame(function () { el.textContent = msg; });
  }

  global.LP = {
    boot: boot, SFX: SFX, buzz: buzz, go: go, toast: toast, say: say,
    fitQuestion: fitQuestion, fitAllQuestions: fitAllQuestions,
    countUp: countUp, ring: ring, timebar: timebar, countdown: countdown,
    confetti: confetti, floatEmoji: floatEmoji, flash: flash,
    stageKeys: stageKeys, qr: qr, reduced: reduced
  };

  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
