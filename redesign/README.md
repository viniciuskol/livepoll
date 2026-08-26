# LivePoll — Redesign "Neon Arena"

Protótipo navegável, HTML puro, sem build e sem CDN. Abra
[`index.html`](index.html) no navegador — ele é o hub com as 27 telas.

```
redesign/
  index.html              hub + landing
  host-create.html        wizard de criação da sala
  stage-*.html            o telão (15 telas)
  play-*.html             o celular (11 telas)
  assets/neon.css         design system compartilhado
  assets/neon.js          runtime compartilhado (som, animação, navegação)
  shots.mjs               captura nas 11 resoluções-alvo + detector de overflow
  flow.mjs                percorre o happy path clicando e valida os destinos
  shots/                  saída da captura
  PROGRESS.md             estado do trabalho (usado pelo loop agentico)
```

---

## O problema que este redesign resolve

O design anterior funcionava, mas se comportava como uma aplicação web que por
acaso é projetada — não como um jogo. Nove problemas concretos:

| # | Diagnóstico | Onde doía |
|---|---|---|
| 1 | Enunciado a ~110px estourando em 3 linhas | **a dor declarada pelo cliente** |
| 2 | Palco em tema claro (lavanda) | projetor lavado, contraste baixo |
| 3 | Cards chapados, zero profundidade | nada parece um jogo |
| 4 | 7 botões cinza idênticos na barra do host | o apresentador caça o botão |
| 5 | Leaderboard sem movimentação nem barras | ranking sem tensão |
| 6 | Mobile com espaço morto e timer discreto | o celular não é um controle |
| 7 | Reveal mobile: vazio vertical, texto quebrado | o momento de recompensa desperdiçado |
| 8 | Landing genérica, CTA duplicado | não promete um jogo |
| 9 | Pódio apertado, confete estático | o encerramento não fecha |

---

## A resposta: duas superfícies, um sistema

O princípio do SPEC-UX é levado ao pé da letra: **informação não se duplica, se
divide.** O enunciado vive no telão; o celular dá o comando.

### 🖥️ O telão é um palco

Fundo `#07031a` com aurora animada em `mix-blend-mode: screen` e grain — o
contrário do tema claro anterior. Faixa superior fina e persistente (código, QR,
bloco, progresso, contador), a cena ocupando o resto, e **um único botão
primário** no rodapé rotulado com o próximo passo, com o atalho impresso dentro
dele.

### 📱 O celular é o controle

`100dvh` sem scroll, alvos de 108–132px conforme a tela, vibração diferenciada
para escolha/acerto/erro, streak em chamas, pontos contando para cima e o rodapé
de reações sempre ancorado.

---

## A correção do tamanho da fonte

Era o ponto que o cliente apontou. A causa no design antigo era um tamanho único
gigante, sem teto útil e indiferente ao comprimento do texto.

A solução tem três camadas:

1. **Faixa por comprimento.** `fitQuestion()` mede o enunciado e aplica
   `.q-xs`…`.q-xl` (≤26, ≤48, ≤84, ≤140, >140 caracteres).
2. **`clamp()` com teto por faixa,** e uma escala à parte para `reading` — onde o
   enunciado é o único conteúdo do palco e pode ocupar mais.
3. **Guarda-costas com piso.** Se ainda transbordar a caixa `[data-fit-box]`,
   reduz em passos — mas nunca abaixo de 70% do tamanho da faixa. Um enunciado
   ilegível a 8 metros é pior que um enunciado com uma linha a mais.

Medido com Playwright, estado `reading`:

| Enunciado | 1280×720 | 1920×1080 |
|---|---|---|
| 25 caracteres | 79px · 2 linhas | 98px · 2 linhas |
| 47 caracteres | 63px · 2 linhas | 78px · 2 linhas |
| 78 caracteres | 52px · 3 linhas | 62px · 3 linhas |
| 160 caracteres | 36px · 3 linhas | 44px · 3 linhas |

Nunca passa de 3 linhas, nunca cai abaixo de 36px.

Em `answering` e `reveal` o enunciado recua para dar o palco às opções, mantendo
proporção constante da tela e razão de ~1,75× sobre o texto das opções. O
caminho até esse número passou por dois extremos: numa versão o teto fixo fazia a
pergunta *encolher* em termos relativos quando o projetor melhorava; noutra, ao
subir a fonte das opções, a hierarquia sumiu. A crítica pegou as duas.

---

## Os quatro tipos de pergunta

O spec define quatro, e cada um exigiu uma decisão própria — não é o mesmo layout
com rótulos diferentes.

**Escolha única.** O caso base: 4 cores, 4 formas, grade 2×2 no telão.

**Verdadeiro/falso.** Duas opções ocupam o palco inteiro. Espremê-las na grade de
quatro deixaria metade da tela vazia. No reveal a cor vem do **acerto**, não do
rótulo: numa pergunta cuja resposta é "Falso", premiar um card vermelho e
dessaturar um verde inverteria o código de cor que as outras telas ensinaram.

**Múltipla seleção.** Checkbox visual, a instrução "marque 2" projetada no telão
(é regra do jogo), e **confirmação explícita** no celular — sem ela o primeiro
toque encerraria a resposta e ninguém marcaria a segunda. Se o tempo acabar com
opções marcadas, envia automaticamente: perder por não ter apertado um botão que
ninguém disse ser obrigatório é a pior forma de perder num quiz. O reveal tem um
**terceiro estado** — "Quase lá!", em âmbar — porque dizer "errou" para quem
acertou metade destrói a vontade de arriscar.

**Resposta aberta.** Campo de texto no celular. No telão, durante a resposta,
aparece só **quem ainda falta** — nunca o texto digitado (entregaria a resposta) e
nunca a lista de quem já enviou (com 200 pessoas não cabe na cena e vira um placar
público de velocidade de digitação). Depois vem [`stage-grading.html`](stage-grading.html),
o painel de correção manual da tecla `G`: respostas agrupadas por texto
normalizado, rolagem por teclado, e o nome de quem escreveu aparece **apenas nos
grupos aceitos** — elogiar nominalmente é seguro, expor um erro projetado para a
sala não é.

---

## Engajamento

- **Som sintetizado em WebAudio** — sem um único arquivo de áudio: tick do timer,
  urgência nos últimos 5s, whoosh de transição, acorde de acerto, buzz de erro,
  entrada de participante, fanfarra do pódio. Mudo persistido em `localStorage`,
  tecla `M`.
- **Contagem 3-2-1** entre `reading` e `answering`, com as opções entrando em
  cascata.
- **Confete em canvas** no pódio e no resumo pessoal.
- **Count-up** dos pontos e das estatísticas.
- **Flash de tela cheia** verde/vermelho no reveal do celular + vibração
  diferenciada.
- **Reações flutuantes** subindo pela tela — ancoradas ao console em telas
  grandes, senão o emoji aterrissa fora do quadro.
- **Leaderboard com barras de score e delta de posição** (↑2 / ↓1 / — 0).

Tudo respeitando `prefers-reduced-motion`: o CSS zera as animações e o JS
curto-circuita `countdown()`, `confetti()` e `buzz()` na origem.

---

## Acessibilidade — WCAG 2.1 AA

O contraste foi **calculado**, não estimado: composição de camadas translúcidas,
os dois extremos de cada gradiente, e a aurora considerada como fundo real
(`screen` a .22) e não como decoração ignorável.

**O erro mais caro foi de cascata, não de cor.** `:focus-visible` usava
`box-shadow`, que perde para `.opt` e `.btn-primary` — mesma especificidade,
declaradas depois no arquivo. Resultado: **não havia anel de foco** nos dois
controles mais importantes do produto, justamente onde se joga por teclado no
desktop. `outline` não pode ser sobrescrito assim, e é o que está lá agora.

Outras correções que saíram da auditoria:

- **`--ink-dim`** #7a6fae → #a99ad6: reprovava em toda superfície translúcida.
- **Botão primário**: o gradiente original dava 2,6–4,1:1 com texto branco.
- **Base do pódio**: o gradiente escurecia até 2,2:1 exatamente onde ficam o nome
  e o placar do campeão.
- **Respostas erradas a 80% de opacidade** para a correta dominar. A opacidade
  sozinha derrubaria o texto do rosa para 3,7:1, porque a mistura com o fundo
  escuro come o contraste; `brightness(1.45)` compensa e devolve 4,7:1,
  preservando 45% da matiz — o jogador ainda reconhece "a rosa do triângulo".
- **A barra de pontuação do ranking** era o fundo da linha inteira, e aí ou a
  barra tinha contraste ou o texto tinha: o roxo é claro demais para texto claro
  e escuro demais para texto escuro. Virou uma faixa neon de 7px na base — barra
  a 5,0–13,5:1 contra o trilho, texto de volta aos 18,4:1.
- **Alvos de toque** das reações passaram de 39px para ≥44×44.
- **1.4.1**: o acerto nunca depende só de cor — anel verde + `✓` + dessaturação
  das erradas + texto `sr-only`.

O único par fora de AA é o anel ciano externo sobre a opção ciano clara (1,1:1) —
coberto pelo anel interno escuro no mesmo elemento, a 15:1.

---

## Responsividade

`shots.mjs` renderiza as 27 telas em **11 resoluções** e falha em qualquer
overflow:

| | |
|---|---|
| Projetor | 1280×720, 1920×1080, 1920×1200 |
| Widescreen | 2560×1440, 3440×1440 (21:9), 3840×2160 |
| Celular | 390×844, 375×667, 844×390 (deitado) |
| Tablet / desktop | 768×1024, 1440×900 |

```bash
node redesign/shots.mjs    # captura + detector de overflow
node redesign/flow.mjs     # percorre o happy path clicando
```

**O telão em widescreen.** Teto de fonte em px é uma armadilha: a pergunta
travava em 70px numa tela de 2160px de altura — 3,2% contra os 6,5% de 720p.
Quanto melhor o projetor, *menor* a pergunta. Num palco a legibilidade é angular,
então o teto virou `min(Xvw, Yvh)`: a fonte escala com a **altura** e a largura
extra de um ultrawide não infla o texto à toa. Medido, a proporção fica estável em
**6,5–7,2% da altura** de 1280×720 até 3840×2160.

Um `--stage-max` (1680px, 2100px acima de 2600px) limita a coluna do palco —
cena, faixa superior, progresso e barra de ações juntos. Sem aplicá-lo a tudo, o
botão primário atravessava 3440px enquanto o conteúdo ficava numa faixa central.

**O celular em tablet e desktop.** A partir de 700px o shell vira um console
centrado com moldura (780px, teto de 940px de altura) e as opções passam para
2×2; acima de 1200px, 760px de largura. Celular deitado (altura ≤520px) comprime
tudo e remove a moldura. Isso vive na **seção 15** do CSS, que fica no fim do
arquivo de propósito: media query não aumenta especificidade, então colocada
antes ela perderia para as regras base da seção 11.

**Rolagem.** "Sem rolagem na dobra" vale para as telas **cronometradas** — o
polegar precisa alcançar tudo sem tirar o olho do telão. Resumo, ranking e
cadastro são leitura: rolar ali é aceitável, e o `shots.mjs` distingue os dois
casos. Nenhuma tela cronometrada rola em nenhum dos 11 viewports.

A grade de opções do celular é `grid-auto-rows: minmax(56px, 1fr)` e vira coluna
única com 5 ou 6 alternativas (o wizard aceita `option1–6`) — em 2×3 os alvos
ficariam baixos demais, e com 5 sobraria uma célula órfã do tamanho de um alvo.

---

## Como isso foi verificado

Cinco rodadas de crítica adversarial por um agente com três personas — UX
Researcher, Jogador e Apresentador — definido em
[`.claude/agents/design-critic.md`](../.claude/agents/design-critic.md), com
auditoria WCAG **calculada em `node`**, não estimada.

Achados que só apareceram porque alguém foi procurar:

- todo o áudio estava **mudo no Chrome** — os sons disparam no load da tela
  seguinte, e a política de autoplay rejeita `AudioContext` sem gesto naquela
  página; a ativação não sobrevive à navegação. Hoje há uma fila com TTL de 4s.
- `stage-block-intro` mandava a tecla Espaço direto para o **pódio**: o
  apresentador encerrava a sessão com confete no meio do bloco 2.
- `stageKeys` sequestrava Espaço/Enter mesmo com um botão focado — no painel de
  correção, marcar uma resposta **aplicava a pontuação e saía da tela**.
- `prefers-reduced-motion` zerava a duração mas não o *delay*: quem desliga
  animação via até 400ms de tela em branco por transição.
- `aria-live` estava mudo onde importava (conteúdo presente no load nunca é
  anunciado) e falador onde não — o contador anunciava nove vezes por pergunta,
  por cima da leitura do enunciado.
- o `.many` para 5–6 alternativas existia no CSS e **nada aplicava a classe**.

`flow.mjs` fecha o ciclo: percorre as duas trilhas clicando, confere que cada
botão primário leva ao passo certo, que nenhum link aponta para arquivo
inexistente e que nenhuma tela levanta erro de console — mais o teclado do
apresentador nas 13 telas do telão.

---

## Escopo do protótipo

Happy path apenas. Não há backend, validação real de planilha, estados de erro
nem i18n funcional (o seletor de idioma é decorativo). Os dados são fixos. O
objetivo é a direção visual e a sensação de jogo — a mecânica já existe na
implementação real em [`../src`](../src).
