# Mapa do DOM da aplicação real (estado ANTES do port)

Gerado por agente de exploração read-only. Referência para o port do redesign.
Números de linha valem para o commit em que foi gerado — reconfira antes de editar.

## 0. Shells

| Arquivo | Papel |
|---|---|
| `public/host.html` | Setup (`#create-view`) + shell do palco (`#stage`) |
| `public/play.html` | Join (`#join-view`) + shell do controle (`#game-view`) + `#flash` |
| `public/index.html` | Landing (markup estático, sem cenas em JS) |

CSS: `app.css` (compartilhado, todas as páginas), `stage.css` (só host), `controller.css` (só play).

## 1. `el()` — o construtor de markup (`public/js/ui.js:7-21`)

```js
el(tag, attrs = {}, children = [])
```

- `v == null || v === false` → atributo **omitido** (idioma para atributo condicional)
- `class` → `node.className = v` (string inteira; classes compostas por template string)
- `text` → `node.textContent = v`
- chave começando com `on` **e** valor função → `addEventListener(k.slice(2), v)`
- resto → `setAttribute(k, v === true ? '' : String(v))`

Children: nó único, string, ou array; `null`/`undefined` são pulados (idioma para filho condicional).

Outros helpers de `ui.js`:
- `$`/`$$` (`:4-5`), `show(node, visible)` alterna `.hidden` (`:23-25`)
- `toast(msg, kind)` → `div.toast.<kind>[role=status][aria-live=polite]` no body, some em 3200ms (`:28-36`)
- `SHAPES = ['shape-triangle','shape-diamond','shape-circle','shape-square','shape-hex','shape-star']` (`:38`)
- `optionLabel(question, option)` → `t('q.true')`/`t('q.false')` para `true_false`, senão `option.text` (`:41-47`)
- `optionButton(...)` — **só telefone** (`:49-61`)
- `ringSvg(id)` (`:69-79`), `paintRing(ring, remainingMs, totalMs)` (`:82-92`), `RING_CIRCUMFERENCE = 326.7` (`:63`)

## 2. Cenas do palco — `public/js/host-stage.js`

Pipeline: `render()` (`:214-242`) → `renderStrip` (`:250`), `renderFooter` (`:269`), rebuild de `#s-center`
só quando `sceneKey` muda ou `opts.force`, senão `patchScene` (`:309-323`).
`sceneKey` (`:244-248`) = `[state, questionId, 'lb'|'', 'lobby'|''].join('|')`.
Dispatch em `buildScene` (`:295-307`).

**Toda raiz de cena é `div.scene` com `data-fit-max`.**

| Estado | Função | `data-fit-max` |
|---|---|---|
| lobby | `sceneLobby` `:325-346` | 2 |
| block_intro | `sceneBlockIntro` `:443-455` | 3 |
| reading | `sceneReading` `:432-441` | 3.2 |
| answering | `sceneAnswering` `:477-494` | 1.8 (2.2 se open_text) |
| reveal | `sceneReveal` `:524-550` | 1.7 |
| leaderboard | `sceneLeaderboard` `:565-582` | 1.9 |
| ended/pódio | `sceneEnded` `:603-676` | 1.6 |
| grading (aninhada) | `gradingBlock` `:685-748` | — |

Detalhe por cena, classes emitidas: ver seções 2.2–2.10 do relatório original
(roster com fold `trimRoster` `:357-395`, `deltaNode` `:552-563`, `openWait` `:502-509`,
`paintTiles` `:512-522`, overlays `overlay()` `:792-819`, atalhos `openShortcuts` `:821-835`,
correção `openGrading` `:841-879`).

Teclado (`:75-99`): `Esc` fecha overlay; `Space`/`Enter`/`→` = primário (pulado se foco em `button`);
tudo abaixo é pulado se `#overlay-root.childElementCount > 0`; `←` volta; `f`/`l`/`m`/`g`/`?`.

## 3. Cenas do telefone — `public/js/page-play.js`

`render()` (`:155-213`), `sceneKey` (`:189`) = `[state, questionId, 'sent'|'', 'up'|'', 'p'|''].join('|')`.
`#p-center` ganha/perde `.top` em `answering` e `leaderboard` (`:194`).

| Estado | Função |
|---|---|
| lobby | `sceneLobby` `:234-240` |
| reading | `sceneReading` `:242-252` |
| block_intro | `sceneBlockIntro` `:254-260` |
| answering | `sceneAnswering` `:262-316` |
| answering pós-envio / timeout | `sceneWaiting` `:328-350` |
| reveal | `sceneReveal` `:352-390` |
| leaderboard | `sceneLeaderboard` `:444-467` |
| ended | `sceneEnded` `:474-490` |

## 4. Ramificação por tipo de pergunta

Tipos canônicos: **`multiple_choice`, `multiple_select`, `true_false`, `open_text`**
(`public/js/shared/quiz-validate.js:4`). **Não existe `single_choice`** — o de resposta única
é `multiple_choice`.

Palco: `:436` (kicker `type.${q.type}`), `:482-485` (open_text → `openWait`), `:528` (reveal),
`:480,545` (`options.length <= 2` → `.cols-1`, é assim que true_false vira uma coluna — não é
teste de tipo), `:849` (filtro do seletor de correção), `ui.js:42` (rótulos True/False).

Telefone: `:275` (open_text), `:288` (`multiple_select` → toggle + `#submit-btn`),
`:499` (payload `text` vs `choice[]`), `ui.js:42`.

`multiple_choice` e `true_false` produzem **markup idêntico** no telefone hoje.

## 5. Acoplamentos duros — quebram se o markup mudar

### IDs lidos por JS
`#create-view` `#setup-topbar` `#stage` `#s-code` `#s-qr` `#s-primary` `#s-back` `#s-end`
`#s-lb` `#s-full` `#s-help` `#s-grade` `#s-mute` `#overlay-root` `#s-center` `#s-answers`
`#s-tiles` `#s-roster` `#s-lobby-count` `#s-ring` `#s-progress` `#s-block` `#s-qof`
`#s-players` `#s-state` `#s-codewrap` — host.
`#code` `#nickname` `#join-form` `#join-btn` `#join-view` `#join-topbar` `#game-view`
`#p-avatar` `#p-nick` `#p-score` `#p-rank` `#p-mute` `#reactions` `#p-center` `#p-count`
`#options` `#open-text` `#p-points` `#p-ring` `#flash` — play.
`#fx-layer` e `#confetti` — lidos por `fx.js:59,75`, precisam existir em cada página.

### Classes lidas/escritas por JS
`.hidden` (`ui.js:24`) · `.toast` (`ui.js:30-32`) · `.ring .run`, `.ring text`, `.warn`, `.danger`
(`ui.js:85-91`) · `.roster-chip:not(.more)`, `.roster-chip.more`, `.dense` (`host-stage.js:359-393`)
· `[data-player]`, `dataset.more` (`:403,414`) · `.scene-note` (`:417`) · `.group-row`,
`.marked-ok`, `.marked-bad` (`:702-734,874`) · `.stage-overlay` (`:802`, clique no backdrop)
· `li.me` (`page-play.js:463`) · `.ctrl-me` (`:133`) · `.run` no `#flash` (`:425-426`)
· `.top` no `#p-center` (`:194`) · `img[data-refit]` (`fit.js:102-107`)

### Geometria / medição
- `region.firstElementChild` **precisa** ter a classe `scene`, senão `fit.js:94-95` desiste em silêncio
- `data-fit-max` dirige a escala máxima; default 2.2 (`fit.js:96`)
- `scene.style.fontSize` é sobrescrito em px — `font-size` no CSS de `.scene` é só a *unidade*
  (`fit.js:57-60,81`; `stage.css:108`)
- classe de medição `stage-measuring` no **region** (`#s-center`), consumida por `stage.css:486-507`
- teste de encaixe = `scrollHeight <= availH+1 && scrollWidth <= availW+1` (`fit.js:34-41`)
- `watchRegion` liga `resize` + `fullscreenchange` + `document.fonts.ready` (`fit.js:112-123`)
- fold do roster usa `offsetTop`/`offsetHeight` — depende de `.roster { position: relative }` (`stage.css:175`)
- `drawQR` escreve `canvas.width/height` em px de dispositivo; o CSS dimensiona à parte (`qr.js:347-363`)
- confete: 140 × `i.confetti-piece` em `#confetti`, transform/opacity inline (`fx.js:74-115`)
- `#confetti` e `#fx-layer` **precisam ficar dentro** de `.stage`/`.ctrl` (ambos são contextos de
  empilhamento `position: fixed`), senão pintam por cima do chrome
- contrato de z-index: `#confetti` 40, `#fx-layer` 45, `.flash` 50, strip/foot 66,
  `.countdown` 70, `.stage-overlay` 75, `.toast` 80

## 6. i18n

Dicionários em `public/i18n/{en,es,pt}.json`. `t(key, vars)` faz lookup por dot-path com
fallback para inglês e **devolve a própria chave quando o valor não é string** (`i18n.js:37-42`).
`apply(root)` trata `[data-i18n]` e `data-i18n-{placeholder,aria-label,title,value}` (`:45-67`).
`onLangChange` re-renderiza as duas páginas (`host-stage.js:112-117`, `page-play.js:99`).

**Chaves `data-i18n` estáticas existem só nos shells externos.** Nada dentro de `#stage` ou
`#game-view` usa `data-i18n`; as cenas são `t()`-only. Isso importa: markup novo de cena
precisa de `t()`, não de `data-i18n`.

Inventário completo de chaves usadas: ver seção 7 do relatório original.

## 7. Armadilhas para o port

1. **`.opt` são dois elementos diferentes.** Palco emite `div.opt` (`host-stage.js:468`),
   telefone emite `button.opt` (`ui.js:50`). Compartilham `app.css:184` e a paleta `opt-1..6`;
   cada um adiciona seu bloco de tamanho (`stage.css:201`, `controller.css:67`).
2. **`.scene` é classe mágica.** `fit.js:95` desiste sem ela; `stage.css:108` fornece a unidade
   que `fit.js` reescreve. Manter `.scene` na raiz de toda cena do palco, com `font-size`.
3. **Tudo dentro de `.scene` precisa ser dimensionado em `em`** (mais um teto em `vh`), senão a
   busca do fit não move o elemento.
4. `#p-count` é emitido por duas cenas com classes diferentes (`.count` em `sceneAnswering:271`,
   `.ctrl-note` em `sceneWaiting:348`).
5. `.open-wait .tally` (`stage.css:458-461`) é CSS morto — nenhum JS emite.
6. `single_choice` não existe em lugar nenhum.
7. `#save-grades` recebe id mas nunca é consultado.
8. `flash()` (`page-play.js:421`) **sobrescreve `className` inteiro** — qualquer classe extra
   colocada no `#flash` no HTML é destruída no primeiro reveal.

## 8. CSS legado / não usado pela app viva

`.timer`, `.opts`, `.result-bars`/`.bar*`, `.lb-list*`, `.lb-avatar`, `.podium-crown`,
`.feedback*`, `.score-big`, `.opt.dim`, `.opt.locked`, `.big-code`, `.qr-box`, `.pill-live`,
`.open-wait .tally`.
