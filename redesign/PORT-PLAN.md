# PORT-PLAN — implantar o "Neon Arena" na aplicação real

Documento de decisões do port. **Leia isto antes de editar qualquer arquivo.**

Companheiros:
- `redesign/PORT-MAP-APP.md` — o DOM que a app real emite hoje e os acoplamentos que quebram
- `redesign/README.md` + `redesign/PROGRESS.md` — racional do redesign e as 4 rodadas de crítica
- `redesign/assets/neon.css` / `neon.js` — a fonte visual
- `SPEC.md` / `SPEC-UX.md` — os requisitos de produto que continuam valendo

## Regra zero

O protótipo é **direção visual**, não código de produção. A app real tem
mecânica que o protótipo nunca enfrentou: conteúdo arbitrário de planilha,
3 idiomas, 6 alternativas, 300 participantes, estado vindo do servidor,
QR de verdade, correção manual idempotente. **Onde o protótipo e a app real
divergem, a mecânica da app real ganha e o visual do protótipo se adapta.**

Nenhum arquivo HTML novo é criado. O port é restyle no lugar:
`public/css/*.css`, os três shells em `public/*.html`, e os construtores de
cena em `public/js/host-stage.js` e `public/js/page-play.js`.

---

## D1. Tipografia: `fitRegion()` continua sendo o mestre — DECIDIDO

Os dois lados têm um sistema de encaixe de tipografia e eles brigam:

| | app real | protótipo |
|---|---|---|
| mecanismo | `fitRegion()` escreve `.scene{font-size:Npx}`, filhos em `em`, busca binária até `scrollHeight` caber | `fitQuestion()` escolhe faixa `.q-xs…q-xl` por comprimento + `clamp()` com teto `min(vw,vh)` |
| escopo | a cena inteira | só o enunciado |
| garante não-estouro? | **sim**, por medição | não — calibrado à mão para conteúdo fixo |

**Decisão: manter `fitRegion()` como mestre e expressar o neon.css em `em` dentro de `.scene`.**

Racional: as duas ideias se compõem em vez de competir, e a fatoração fica mais
limpa que a do protótipo. A faixa por comprimento escolhe um tamanho **relativo**
(`.q-xs{font-size:1.9em}` … `.q-xl{font-size:1.0em}`); `fitRegion()` escolhe a
**escala absoluta**; `data-fit-max` limita o crescimento. O resultado é o mesmo
objetivo do protótipo — proporção constante da altura da tela, legibilidade
angular — só que **medido** em vez de calibrado, o que importa porque o
conteúdo real vem de planilha do usuário e não das 4 perguntas fixas do protótipo.

Consequências obrigatórias:
- `.scene` continua na raiz de toda cena do palco, com `font-size` no CSS
  (é a unidade que `fit.js` reescreve). Perder a classe faz `fit.js:95` desistir em silêncio.
- **Tudo dentro de `.scene` é dimensionado em `em`** (mais um teto em `vh` quando
  fizer sentido). `vw`/`px` fixos dentro da cena tornam o elemento invisível para a busca.
- A faixa por comprimento vira classe relativa; **o laço de encolhimento de 10 passos
  e o piso de 70% do `fitQuestion()` são descartados** — `fitRegion()` já garante o encaixe.
- `data-fit-max` por cena é preservado (2 lobby, 3 block_intro, 3.2 reading,
  1.8/2.2 answering, 1.7 reveal, 1.9 leaderboard, 1.6 finale).
- `stage.css` tem um bloco de modo de medição (`.stage-measuring`, hoje `:486-507`)
  que zera transições/animações/transforms e fixa alturas. **Todo elemento novo com
  animação ou altura fluida precisa entrar nesse bloco**, senão a medição lê um
  valor de meio-caminho e a cena encolhe sem motivo.

Fora do palco (landing, wizard, telefone) não há `fitRegion`; ali o `clamp()`
do protótipo é portado como está.

## D2. Paleta de opções: 6 cores, não 4

O protótipo só tem 4 cores/formas (`.opt.a/.b/.c/.d`, `tri/dia/cir/sqr`). A app
real aceita **`option1`–`option6`** e já tem 6 formas
(`SHAPES` em `ui.js:38`: triangle, diamond, circle, square, hex, star).

**Decisão: manter a nomenclatura da app (`.opt-1`…`.opt-6`, `.shape-*`) e portar
as cores do neon para dentro dela, estendendo a paleta para 6.** As 4 primeiras
são as do protótipo; as duas restantes precisam ser escolhidas com o mesmo
critério de contraste (ver D6) e não podem colapsar com as outras sob o
tratamento de `.dim` do reveal.

Não renomear para `.a/.b/.c/.d`: `optionButton()` (`ui.js:49-61`) e as duas cenas
de reveal compõem a classe por índice, e o CSS legado da app já usa `opt-N`.

## D3. Verdadeiro/falso é comportamento novo, não restyle

Hoje `true_false` gera markup **idêntico** a `multiple_choice`; a única diferença
é o rótulo (`optionLabel`, `ui.js:41-47`) e o `.cols-1` que vem de
`options.length <= 2` — não de um teste de tipo.

O protótipo trata V/F como tela própria (`.options.tf`: dois cards ocupando a
tela inteira, flex coluna, forma acima do texto). Isso exige **ramificação
explícita por `q.type === 'true_false'`** nas duas superfícies.

Regra crítica da rodada 4 do crítico, que precisa sobreviver ao port
(`neon.css:1044-1048`): no reveal, **a cor vem do acerto, não do rótulo**. Todos
os cards V/F ficam roxos neutros e só `.correct` recebe o par verde. Sem isso,
numa pergunta cuja resposta é "Falso", o telão premia um card vermelho e
dessatura um verde — invertendo o código de cor que as outras 26 telas ensinaram.

## D4. i18n: todo o texto do protótipo é pt-BR fixo

As cenas da app são **`t()`-only** — não usam `data-i18n`. Copiar markup do
protótipo traz string literal em português e quebra os 3 idiomas e o teste e2e
do seletor de idioma.

**Decisão: todo texto de cena passa por `t()`.** Strings do protótipo que não têm
chave hoje precisam de chave nova nos **três** dicionários (`public/i18n/{en,es,pt}.json`),
não só em `pt.json` — `t()` cai para inglês quando falta a chave (`i18n.js:37-42`),
então uma chave só em pt aparece em inglês para todo mundo, silenciosamente.

Candidatas a chave nova (conferir antes de criar — várias já existem):
dica de múltipla seleção ("marque N"), rótulo "ainda faltam" do open_text,
estado parcial ("quase lá"), aviso de confirmação pendente, dica de rolagem
da correção, rótulos de atalho novos.

`countUp` do protótipo formata com `toLocaleString('pt-BR')` fixo
(`neon.js:178,188`) — precisa seguir o idioma da app.

## D5. O que NÃO portar

Do protótipo, descartar:
- **`LP.qr()`** — não é QR válido, é uma matriz decorativa com três olhos
  (`neon.js:390-392`). A app tem encoder real em `public/js/qr.js`. Manter o da app.
- **`LP.go()` / `data-href` / `data-go` / o índice `.screens` do `index.html`** —
  navegação entre arquivos HTML. Na app real são transições de estado vindas do
  servidor. **Preservar o contrato de teclado** (`data-primary`, `data-back`,
  `data-close`), trocar o destino por ação.
- **`LP.stageKeys({leaderboard, grading, shortcuts})`** — recebe URLs. A app já
  tem o mapa de teclado equivalente em `host-stage.js:75-99`, com overlays em vez
  de navegação. Manter o da app; usar o do protótipo só como referência de cobertura.
- **A tela `stage-shortcuts.html` e o round-trip `?from=`** — na app é overlay
  (`openShortcuts()`, `host-stage.js:821-835`), não navegação.
- **Todo dado fixo**: código `QDSKCH`, "Aulão de Agentes", `livepoll.local/j/…`,
  a persona `🦊 Ana` e o elenco Ana/Chris/Duda/…, todos os `%` de progresso e de
  distribuição, todos os placares e deltas, todos os `data-v` de count-up, os
  tempos de resposta ("4,2 s"), os contadores "N de 9".
- **`host-create.html` com `value="aulao2026"` no campo de senha** — nunca subir
  senha pré-preenchida.
- **Todos os `setInterval` de realtime simulado** (lobby enchendo, contador de
  respostas andando sozinho, pills sumindo). A app tem `poll.js` e estado do servidor.
- **`document.body.dataset.locked`** como trava de envio único — a app tem
  idempotência no servidor.
- **`txt.value.replace(/[<>&]/g,'')`** (`play-answering-open.html:82`) — não é
  sanitizador. A app constrói DOM com `textContent` via `el()`, que já é seguro.
- **Botões "Simular …"** em `play-lobby`, `play-reading` e os CTAs `data-href`
  dos reveals.
- **O seletor de idioma inerte** do `index.html` — a app tem i18n real.
- `redesign/shots.mjs`, `redesign/shots/` — ferramental do protótipo.

Bugs conhecidos do protótipo, **não portar**:
- `confetti()` adiciona listener de `resize` que nunca é removido (`neon.js:255`) —
  vazamento real numa página de vida longa.
- `SFX.fanfare()` ignora os delays das rajadas de ruído (`neon.js:125`), então as
  4 disparam juntas.
- `--ring` é token declarado e nunca referenciado (`neon.css`) — o anel de foco
  real usa `outline`. Não recriar a versão `box-shadow`: a rodada 3 mostrou que
  `box-shadow` **perde na cascata** para `.opt` e `.btn-primary`, deixando os dois
  controles principais sem anel de foco.
- `.opt.partial` (`neon.css:930-934`) é definido e nunca usado. Na app ele tem
  uso real (crédito parcial em `multiple_select`) — portar e **usar**.
- `.typing .who.done`, `.options.one-col`, `.grow`, `.hide`, `.gap-s`, `.gap-l`,
  `.glass` — código morto no protótipo. Não portar o que não for usar.

## D6. Acessibilidade: o que foi comprado com medição não pode ser perdido

O redesign passou por 4 rodadas de crítica com contraste **calculado**. Regressões
proibidas:

- Anel de foco por **`outline`**, nunca `box-shadow` (perde na cascata — rodada 3).
- `.dim` no reveal **dessatura e clareia** (`grayscale(.35) brightness(1.75)`),
  não escurece: o texto ganha contraste em vez de perder, e a correta fica a única
  colorida. Opacidade pura reprova.
- Acerto **nunca depende só de cor**: anel + `✓`/`✕` (`.mark.ok`/`.mark.no`) +
  dessaturação das erradas + texto `sr-only`.
- `.mark` precisa do separador opaco (`box-shadow:0 0 0 3px`) — verde sobre verde some.
- Alvos de toque das reações ≥ 44×44.
- `prefers-reduced-motion` zera **duração e delay** (com `animation-fill-mode:both`,
  zerar só a duração deixa o conteúdo invisível até 400ms), e o JS curto-circuita
  `countdown()`, `confetti()`, `countUp()` e `buzz()` na origem.
- `aria-live`: mudo onde o conteúdo já está presente no load (nunca é anunciado
  mesmo), falador onde muda. O contador de respostas é `aria-live="off"` — anunciava
  9× por pergunta por cima da leitura do enunciado.
- Reflow 1.4.10 a 320px de largura.

## D7. Contratos da app que o port não pode quebrar

Ver `PORT-MAP-APP.md` §5 para a lista completa. Os que mais provavelmente quebram:

- Todos os **ids** consultados por JS (`#s-*`, `#p-*`, `#s-center`, `#p-center`,
  `#options`, `#open-text`, `#flash`, `#fx-layer`, `#confetti`, `#overlay-root`).
- `#confetti` e `#fx-layer` **dentro** de `.stage` / `.ctrl` — os dois são contextos
  de empilhamento `position:fixed`; fora deles o canvas pinta por cima do chrome.
- Contrato de z-index: confetti 40, fx 45, flash 50, strip/foot 66, countdown 70,
  overlay 75, toast 80.
- `.roster { position: relative }` — é o offset parent do fold do roster
  (`host-stage.js:368-374`).
- `.stage-overlay` na classe do backdrop — o clique de fechar testa essa classe exata.
- `flash()` (`page-play.js:421`) **sobrescreve `className` inteiro**; classe extra
  posta no HTML do `#flash` morre no primeiro reveal.
- `paintRing()` consulta `.run` e `text` dentro do svg do timer; `LP.ring` do
  protótipo consulta `.bar` e `.num`. **Escolher um e ser consistente** — o da app
  já está ligado em dois lugares (`host-stage.js:886`, `page-play.js:531`).
- `#p-count` é emitido por duas cenas com classes diferentes.

## D8. Fases

Cada fase: agente implementador → agente avaliador → veredito aplicado.
**Portão em toda fase: `npm test` (97) e `npx playwright test` (18) verdes**, ou
uma mudança de teste deliberada e justificada (a tipografia muda de propósito;
`stage-type.spec.js` trava tamanhos renderizados e vai precisar de recalibração
consciente, não de afrouxamento cego).

1. **Sistema de design + shells** — tokens, atmosfera, botões, base compartilhada
   em `app.css`; `index.html`, o setup do `host.html`, o join do `play.html`.
2. **Palco** — `stage.css` + cenas em `host-stage.js` (lobby, reading, answering,
   reveal, leaderboard, block_intro, podium, overlays de atalho e correção).
3. **Telefone** — `controller.css` + cenas em `page-play.js`.
4. **Os 4 tipos de pergunta** nas duas superfícies + chaves i18n novas nos 3 idiomas.
5. **Som/FX, a11y e validação multi-viewport** — portar o conjunto de cues do
   WebAudio para `fx.js`, auditoria de contraste, 320px, reduced-motion,
   e os viewports de projetor + celular + tablet.
