# LivePoll — Redesign AAA · PROGRESSO

Loop agentico. Parar às 09:00 (ou quando o usuário mandar).
Retomar: ler SÓ este arquivo + `ls redesign/` antes de continuar (contexto enxuto).
Não reler SPEC.md / SPEC-UX.md / prints — o briefing destilado abaixo basta.

## Briefing destilado
- 2 telas, papéis distintos: **telão** (projetor 1280x720, lido a 8m, teclado é a
  UI) e **celular** (390x844, é o controle: tátil, som, vibração, sem scroll).
- Estados: lobby → reading → answering → reveal → leaderboard →
  (reading | block_intro | ended/podium).
- Anti-cheating: em `reading` o telão mostra SÓ o enunciado; celular diz "olhe
  para o telão", sem opções. Timer só começa em `answering`.
- Nunca mostrar distribuição durante `answering` (só contagem de respostas).
- Não repetir enunciado no celular durante `answering`.
- 4 shapes+cores nas opções; streak 🔥; reações emoji; a11y: WCAG 2.1 AA,
  prefers-reduced-motion, aria-live.
- **DOR DO CLIENTE: fonte inicial das perguntas grande demais** no design antigo
  (~110px, 3 linhas estourando). Resolvido com clamp com teto + `fitQuestion()`.

## Diagnóstico do design atual (concluído)
1. Enunciado em `reading` gigantesco, sem hierarquia.
2. Palco em tema CLARO (lavanda) — ruim para projetor.
3. Zero atmosfera: cards chapados, sem profundidade.
4. Barra de ações do host = 7 botões cinza idênticos, ilegíveis.
5. Leaderboard sem setas de movimentação nem barras de score.
6. Mobile: espaço morto, timer discreto, sem streak visível.
7. Reveal mobile: vazio vertical enorme, "+916 pontos" quebra em 2 linhas.
8. Landing genérica, CTA duplicado.
9. Pódio apertado, confete estático.

## Direção adotada — "NEON ARENA"
Palco escuro #07031a + aurora animada + grain; glassmorphism; glow por cor.
Opções neon magenta/ciano/âmbar/lima com shape. Tipografia fluida COM TETO.
Som 100% sintetizado em WebAudio (sem arquivos, sem CDN). Confete em canvas.

## Feito
- [x] Navegação/análise das 22 telas atuais + leitura dos specs
- [x] `redesign/assets/neon.css` — design system completo (tokens, atmosfera,
      telão, celular, landing, wizard, a11y, responsivo)
- [x] `redesign/assets/neon.js` — LP.{boot,SFX,buzz,go,toast,fitQuestion,countUp,
      ring,timebar,countdown,confetti,floatEmoji,flash,stageKeys,qr}
- [x] 16 telas HTML navegáveis (happy path):
      index · host-create · stage-{lobby,reading,answering,reveal,leaderboard,
      block-intro,podium,shortcuts} · play-{join,lobby,reading,answering,reveal,
      leaderboard,summary}
- [x] Agente crítico `.claude/agents/design-critic.md` — 3 personas
      (UX Researcher / Jogador / Apresentador) + auditoria WCAG 2.1 AA calculada.
      NOTA: o registro de agentes só recarrega em sessão nova; até lá invocar via
      `general-purpose` mandando ler o arquivo do agente primeiro.
- [x] Rodada 1 de crítica disparada (resultado ainda pendente)
- [x] `redesign/shots.mjs` — captura Playwright em 1280x720, 1920x1080, 390x844,
      375x667 + detector de overflow. Saída em `redesign/shots/`.
- [x] CORRIGIDO: overflow-x no celular (rodapé de reações não encolhia;
      `.play-top` estourava 380>375). Zero overflow nas 4 resoluções agora.
- [x] CORRIGIDO (bug): o guarda-costas do `fitQuestion()` encolhia o enunciado a
      ~14px em answering. Agora só age em transbordo real, com piso de 70%.
- [x] Tipografia do enunciado calibrada e MEDIDA:
      reading 1280x720 → 25ch:79px/2L · 47ch:63px/2L · 78ch:52px/3L · 160ch:36px/3L
      answering/reveal → 33px em 1 linha. Nunca mais de 3 linhas, nunca <36px.

- [x] RODADA 1 DO CRITICO APLICADA (16 consertos, todos verificados por medicao):
      1. `--ring` era 1,8:1 e reprovava 2.4.7/1.4.11 nas 16 telas -> anel duplo
         `0 0 0 3px #07031a, 0 0 0 6px #22e6ff` (13,3:1 no fundo; o anel interno
         da 15:1 sobre a opcao ciano, onde o externo nao contrasta)
      2. hierarquia do telao: pergunta era 1,30x a opcao e ENCOLHIA em % de tela
         quando o projetor melhorava -> agora 5,5% (720) / 5,4% (1080), razao
         1,82x / 2,15x. `.opt` recebeu min-height e `.options{flex:0 1 auto}`
      3. `stage-block-intro` mandava o Espaco para o PODIO -> vai para reading;
         leaderboard rotula "Abrir o bloco 2"; pódio perdeu `data-primary`
         (Espaco no reflexo nao encerra mais a sessao)
      4. aurora a opacity .5 invalidava todo o calculo de contraste do fundo
         -> .22 / .12 (ink-soft sobre aurora: 4,3 -> 7,6:1)
      5. `.btn-primary` reprovava nos 3 stops -> gradiente escurecido
         (5,0 / 4,5 / 4,5:1); `.kbd` de 2,7 -> 12,4:1
      6. `--ink-dim` #7a6fae -> #a99ad6 (4,1 -> 7,3:1 no glass); `.delta.same`
         e `.delta.down` recoloridos (2,2 e 3,2 -> 8,2 e 7,2:1)
      7. base do gradiente do podio: 2,2-2,9:1 -> 4,8-7,2:1 (color-mix 40->72%)
      8. celular: grade travada em 4 -> `grid-auto-rows:minmax(56px,1fr)` (2 a 6
         opcoes); reacoes 39px -> min 44x44 com wrap; `.play-body` overflow-y auto
      9. extras: `.opt.dim` agora dessatura em vez de escurecer (3,7 -> 5,9-15,6:1
         e a correta fica a unica colorida), `.opt .bar` 2,4 -> 3,8:1,
         `.dial .track` 1,3 -> 3,1:1, `--line` 1,3 -> 3,1:1, line-height 1.5+
     10. `fitQuestion()` estava inerte (nenhum HTML declarava `[data-fit-box]`)
     11. dados que se contradiziam entre telas (streak 3 e delta na pergunta 1)
         -> exemplo movido para "pergunta 4 de 8", placares acumulados coerentes
      Verificacao: 20 de 21 pares de contraste passam AA; o unico "reprovado"
      e o anel ciano sobre a opcao clara, coberto pelo anel interno a 15:1.

- [x] JOGADOR EM TABLET E DESKTOP (pedido do usuario: mobile-first, mas tem que
      funcionar bem em tela grande). Secao 15 do CSS, no FIM do arquivo de
      proposito (precisa vencer a secao 11 na cascata):
      - >=700px: o shell vira um "console" centrado com moldura, 780px, altura
        max 940px, `position:fixed;inset:0;margin:auto` (centrar por margin-block
        gerava overflow de 42px); opcoes em 2x2; tipografia e alvos escalados
      - >=1200px: 860px de largura
      - altura <=520px (celular deitado): comprime tudo, opcoes em 2 colunas,
        moldura removida
      - teto de altura da linha `clamp(130px,27vh,290px)`: sem isso o alvo virava
        340px de espaco morto para uma palavra
      - shots.mjs agora cobre 7 viewports (+tablet 768x1024, desktop 1440x900,
        landscape 844x390). Zero overflow em todos.
- [x] RODADA 2 DO CRITICO APLICADA (8 achados, verificados por medicao):
      1. CRITICO: todo o audio morria no Chrome. `LP.SFX.*` roda no load da tela,
         e a politica de autoplay rejeita AudioContext sem gesto NA PAGINA — a
         ativacao nao sobrevive a navegacao. 18 avisos so no stage-reveal.
         Corrigido com fila: som pedido antes do 1o gesto fica pendente (TTL 4s)
         e sai no primeiro pointerdown/keydown/touchstart. Medido: 0 avisos nas
         8 telas que disparavam som.
      2. CRITICO: o podio tinha perdido o teclado (a rodada 1 removeu
         `data-primary`) mas o chip "Espaco" continuava la mentindo. Devolvido,
         com confirmacao em dois toques + toast (encerrar diante da plateia e
         irreversivel). Medido: 1o toque avisa, 2o encerra.
      3. CRITICO: `grayscale(1)` do reveal derrubava o texto das erradas para
         2,2:1 e a forma para 2,1:1, e colapsava ambar e lima na mesma cor.
         Agora `grayscale(.55) brightness(1.25)`: pior caso 5,3:1 texto / 4,6:1
         forma, com 45% da matiz preservada. Mesmo tratamento em `.opt.faded`
         (estava em 1,3:1 com opacity .28) + `aria-disabled`.
      4. Placares transbordavam os degraus do podio -> `.pod` flex column
         justify-end + overflow hidden + `.pod .score` centrado
      5. Reflow 1.4.10 a 320px: `.tag` nowrap (340px), `.steps` sem wrap (o passo
         1 ficava em left:-25px) e `.nav .right`. Medido: 320/320 em index,
         host-create e play-join
      6. A 1080p o palco ficava 47% vazio e a OPCAO era menor que metade do
         enunciado -> `.options{flex:1 1 auto}`, opcao ate 38px, pergunta ate
         70px. Agora as opcoes ocupam 66-72% da cena e a razao
         pergunta:opcao e 1,76x (720p) / 1,84x (1080p)
      7. `prefers-reduced-motion` zerava duration mas nao DELAY: com `both`, o
         conteudo ficava ate 400ms invisivel. Corrigido, mais `flash()` estatico
         e `countUp()` instantaneo sob reduced-motion
      8. Contraste residual: `.progress` trilho 1,2 -> 3,1:1; `.drop` 2,0 -> 3,3:1;
         `.lang` ativo 4,1 -> 6,2:1
      Tambem: degraus do podio voltaram a `height` fixo (o `min-height` deixava
      o conteudo achatar a hierarquia 1o/2o/3o) e o stagger do count-up e
      pulado sob reduced-motion.
- [x] `redesign/README.md` — racional, antes/depois, medicoes, escopo

- [x] OS 4 TIPOS DE PERGUNTA DO SPEC (pedido do usuario). 11 telas novas,
      total 27. Secao 17 do CSS.
      - **true_false**: `.options.tf` — 2 opcoes ocupam a tela inteira, verde/
        vermelho + shape. `stage-answering-tf` / `stage-reveal-tf` /
        `play-answering-tf`. (Bug pego no render: `.txt` herda `flex:1` e em
        coluna estica, empurrando o conteudo para o topo do card.)
      - **multiple_select**: checkbox visual (`.check`), `.multi-hint` dizendo
        quantas marcar, e **confirmacao explicita** no celular — sem ela o
        primeiro toque encerraria a resposta e ninguem marcaria a segunda.
        Reveal com DUAS corretas e `.opt.partial`. `play-reveal-partial` inventa
        um TERCEIRO estado ("Quase la!", ambar): dizer "errou" para quem acertou
        metade destroi a vontade de arriscar.
      - **open_text**: campo no celular; no telao, durante answering, so quem JA
        enviou (mostrar o texto entregaria a resposta). `stage-grading` e o
        painel de correcao manual da tecla G, com respostas agrupadas por texto
        normalizado. `stage-reveal-open` mostra os grupos com aceita/nao aceita.
      - `.many`: 5-6 alternativas viram coluna unica em todos os breakpoints.
        Medido: alvo minimo 79px com 6 opcoes a 390x844.
- [x] RODADA 3 DO CRITICO APLICADA (8 achados):
      1. CRITICO: `:focus-visible` usava `box-shadow`, que PERDE na cascata para
         `.opt` e `.btn-primary` (mesma especificidade, declaradas depois) —
         nao havia anel de foco nos dois controles principais. Trocado por
         `outline`, que box-shadow nao sobrescreve. Medido: 3px solid #22e6ff.
      2. CRITICO: apos escolher, nada era anunciado e os botoes mortos seguiam
         no ciclo de Tab. Agora `aria-pressed`, `tabIndex=-1` e `LP.say()`.
      3. A moldura do console encostava nas bordas em 1366x768 / 1280x800 /
         1440x900 -> `height:min(calc(100dvh - 48px),940px)`; >=1200px passou a
         760px (860 deixava o console quase quadrado e o `.play-top` com 700px
         de nada no meio)
      4. As reacoes voavam para FORA do console: `.floaters`, `.flash` e
         `.toast` agora ancoram no `.phone` quando ele existe
      5. `stage-shortcuts` prometia a tecla G, que nao existia; e sair de la
         jogava o apresentador no LOBBY no meio da sessao. G implementada
         (so em perguntas abertas), `Esc` fecha, e a volta usa `?from=`
      6. Contraste: moldura 2,5 -> 5,6:1 (`--line-strong`, 2px)
      7. `.many` era codigo morto — nada aplicava a classe. Aplicada no boot.
      8. `aria-live`: mudo onde importava (conteudo presente no load NUNCA e
         anunciado) e falador onde nao (o contador anunciava 9x por pergunta,
         por cima da leitura do enunciado). Agora `LP.say()` injeta depois do
         load e `.answered-count` e `aria-live="off"`.
      EXTRA nao pedido pelo critico: a barra de pontuacao do leaderboard era o
      fundo da linha inteira, entao ou ela tinha contraste ou o texto tinha —
      o roxo e claro demais para texto claro e escuro demais para texto escuro.
      Virou uma faixa neon de 7px na base: barra 5,0-13,5:1 contra o trilho e
      texto de volta aos 18,4:1.

- [x] WIDESCREEN (pedido do usuario). shots.mjs cobre 11 viewports: 1280x720,
      1920x1080, 1920x1200, 2560x1440, 3440x1440 (21:9), 3840x2160, 390x844,
      375x667, 768x1024, 1440x900, 844x390.
      Dois problemas reais, ambos de TETO EM PX:
      - a pergunta travava em 70px numa tela de 2160px de altura (3,2% contra
        6,5% em 720p). Num palco a legibilidade e ANGULAR: o teto passou a ser
        `min(Xvw, Yvh)`, entao a fonte escala com a ALTURA e, em ultrawide,
        a largura nao infla a fonte a toa. Medido: 6,5-7,2% da altura constante
        de 1280x720 ate 3840x2160, razao pergunta:opcao estavel em ~1,75x.
      - cards de 1796x829px para uma palavra. `--stage-max` (1680px, 2100px
        acima de 2600px) aplicado a TODO o palco — cena, topo, progresso e
        barra de acoes — senao o botao primario atravessava 3440px enquanto o
        conteudo ficava numa faixa central. Mais `max-height` nas opcoes.
- [x] Erradas a 80% de opacidade (pedido do usuario). Opacity pura derrubava o
      rosa para 3,7:1; com `brightness(1.45)` fica 4,7:1 e o destaque da correta
      aumenta como pedido.
- [x] RODADA 4 DO CRITICO APLICADA (8 achados):
      1. CRITICO: `stageKeys` sequestrava Espaco/Enter mesmo com um botao
         focado. No painel de correcao, Espaco sobre um `.toggle` APLICAVA a
         pontuacao e saia da tela — nao havia como marcar por teclado.
      2. CRITICO: no reveal do V/F o anel de acerto era verde sobre card verde
         (1,3:1), nao havia marcador nao-cromatico, e a cor vinha do ROTULO:
         numa pergunta cuja resposta e "Falso", o telao premiava um card
         vermelho e dessaturava um verde. Agora anel duplo com separador
         escuro, `.mark ok/no` nos dois cards, e a cor vem do ACERTO.
      3. CRITICO: na multipla selecao o tempo acabava com opcoes marcadas e
         elas sumiam sem aviso. Agora auto-envia, avisa em ambar na primeira
         marcacao e alerta aos 5s.
      4. O painel de correcao mostrava 5 de N grupos sem dizer, e nao rolava
         por teclado. Setas/PageUp/PageDown/Home/End + contador + gradiente.
      5. Respostas ERRADAS iam ao telao com o nome de quem escreveu. Nome so
         nos grupos aceitos: elogiar nominalmente e seguro, expor erro nao.
      6. Com 200 pessoas a lista de "quem enviou" cortava 674px em silencio.
         Invertida para "quem FALTA" — e a informacao acionavel e deixa de ser
         um placar publico de velocidade de digitacao.
      7. `.check`/`.mark` mediam menos que o pretendido (largura em `em`
         resolvia contra o proprio font-size reduzido) e nao contrastavam com a
         opcao. Tamanho em clamp + borda/separador opacos.
      8. O V/F reintroduzia em tablet/desktop o alvo de 672px que a secao 15
         tinha limitado.
      EXTRA: o `shots.mjs` nao detectava scroll INTERNO (`.play-body`/`.scene`).
      Agora detecta e distingue: rolar e proibido nas telas CRONOMETRADAS (o
      polegar precisa alcancar tudo sem tirar o olho do telao) e aceitavel nas
      de leitura (resumo, ranking, cadastro). Estado atual: nenhuma tela
      cronometrada rola em nenhum dos 11 viewports.
      E o anel duplo da correta era cortado pelo `overflow:hidden` da cena —
      `.scene .options` ganhou padding negativo compensado.

- [x] `redesign/flow.mjs` — percorre o happy path CLICANDO (nao capturando):
      valida que cada botao primario leva ao passo certo, que nenhum link aponta
      para arquivo inexistente, que nenhuma tela levanta erro de console, e que
      Espaco avanca nas 13 telas do telao.
      Resultado: 28 telas, ZERO problema nas 3 trilhas (telao, celular, teclado).
- [x] README.md reescrito: os 4 tipos de pergunta, widescreen, regra de rolagem,
      o erro de cascata do :focus-visible, a opacidade 80% e as 5 rodadas.
- [x] Rodada 5 do critico disparada (foco: widescreen, opacidade 80%, regra de
      rolagem, e as telas nunca auditadas a fundo — index, host-create,
      play-lobby, stage-block-intro, stage-shortcuts)

## Falta (ordem de execução)
- [ ] Aplicar os achados da rodada 5
- [ ] Rodada 6: focar no que ainda nao foi auditado apos as correcoes da 5

## Fluxo de navegacao implementado (validado por flow.mjs)

TELAO — index -> host-create -> stage-lobby -> stage-reading -> (3-2-1)
-> stage-answering -> stage-reveal -> stage-leaderboard -> stage-block-intro
-> stage-answering-tf -> stage-reveal-tf -> stage-answering-multi
-> stage-reveal-multi -> stage-answering-open -> stage-grading
-> stage-reveal-open -> stage-leaderboard (-> stage-podium -> index)
Fora do fluxo, por tecla: stage-shortcuts (?, volta via ?from=), stage-grading (G)

CELULAR — index -> play-join -> play-lobby -> play-reading -> play-answering
-> play-reveal -> play-leaderboard -> play-answering-tf -> play-answering-multi
-> play-reveal-partial -> play-answering-open -> play-summary -> index
