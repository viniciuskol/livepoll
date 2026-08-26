# LivePoll — Especificação (fonte da verdade)

Ferramenta de **live polling estilo Kahoot!** para engajar participantes em apresentações.
Stack obrigatória: **Cloudflare Workers + D1** (+ Assets binding). **Tudo roda local** via `wrangler dev --local`.
Sem contas/login. Sem build step (JS/CSS vanilla servido como asset estático).

## 1. Papéis e fluxo

### Apresentador (host)
1. Abre `/` → "Criar sala".
2. Baixa a **planilha modelo** (`.csv` e `.xlsx`), preenche localmente, faz upload.
3. Define **senha da sala** (host password) — usada para reabrir o painel de controle.
4. Recebe **código da sala** (6 chars A-Z2-9, sem caracteres ambíguos) + **QR Code** (gerado localmente, sem CDN).
5. **Telão** (não é um painel de controle, é o palco projetado — ver SPEC-UX):
   faixa fina com código/QR/bloco/progresso, uma cena por estado ocupando o
   resto da tela, um único botão primário no rodapé e **teclado como interface
   principal** (`Espaço`/`→`/`Enter` avança, `←` volta, `F` tela cheia, `L`
   ranking, `M` mudo, `G` corrigir abertas, `?` atalhos).

### Participante (player)
1. `/` → "Entrar na sala" (ou escaneia QR → `/j/CODE`).
2. Digita código + apelido. Sem senha.
3. Responde no celular/navegador; vê pontuação, streak, posição, reações.
4. Pode enviar **reações** (emoji) a qualquer momento → aparecem flutuando na tela do host e dos players.

## 2. Tipos de pergunta
- `multiple_choice`: 2–6 opções, 1 correta.
- `multiple_select`: 2–6 opções, N corretas (pontuação parcial: acertos - erros, mínimo 0).
- `true_false`: atalho de 2 opções.
- `open_text`: resposta livre. Respostas agrupadas por texto normalizado no painel do host; host **marca quais são corretas** (aceita também `answer_key` opcional para auto-marcar por match normalizado).

## 3. Planilha (template)
Colunas (case-insensitive, aceitar cabeçalhos em EN/PT/ES):
```
block, type, question, option1..option6, correct, time_limit, points, image_url, explanation
```
- `block`: nome do bloco de perguntas (agrupa; vazio = nome default **no idioma da interface**, `panel.default_block`).
- `type`: multiple_choice | multiple_select | true_false | open_text (aliases aceitos).
- `correct`: índice(s) 1-based separados por `,` ou `;` (ou letras A-F); para open_text = lista de respostas aceitas separadas por `|`.
- `time_limit`: segundos (default 20). `points`: default 1000.
- Validação com mensagens de erro por linha, i18n, exibidas no upload. Nada é salvo se houver erro fatal.

## 4. Pontuação
- Base `points` da pergunta; bônus por velocidade: `round(points * (0.5 + 0.5 * tempo_restante/tempo_total))` quando correto.
- `multiple_select`: proporcional aos acertos.
- Streak bonus: +10% por acerto consecutivo, teto +50%.
- Leaderboard top 10 + posição pessoal.

## 5. Realtime e máquina de estados
- Sem WebSocket obrigatório: **long/short polling** em `/api/rooms/:code/state?since=<version>`; D1 guarda `version` incremental na sala. Client faz poll a cada 700ms com backoff (e backoff extra enquanto o servidor responde `unchanged`). Reações em janela dos últimos 5s.
- Estado da sala (SPEC-UX vence o ciclo 1):
  `lobby | block_intro | reading | answering | reveal | leaderboard | ended`

```
lobby → reading → answering → reveal → leaderboard → reading (próxima)
                                                   → block_intro → reading
                                                   → ended
```

- **`reading` é o coração do anti-cheating**: o payload de `/state` **não contém
  as opções** (a chave `options` está ausente, não vazia nem escondida no CSS) e
  não contém o enunciado para o celular. `answer_key` nunca sai do servidor.
- O **cronômetro começa na transição para `answering`**: é aí que
  `rooms.question_started_at` e `questions.started_at` são gravados. Respostas
  só são aceitas em `answering`.
- `block_intro` aparece quando a próxima pergunta pertence a outro bloco.
- **Enunciado no celular** é opcional por sala (`showPromptOnPhone`, default
  off): quando ligado, o enunciado também vai para os participantes.
- Transições são **atômicas e idempotentes**: o `UPDATE` é condicionado ao estado
  e à `version` lidos no início da requisição, e o cliente envia `{from}` com o
  estado em que acredita estar. Dois `advance` simultâneos nunca avançam dois
  passos - o perdedor recebe `STALE_STATE`.
- `back` volta um passo (`answering → reading` devolve o cronômetro,
  `leaderboard → reveal`, `reading → leaderboard anterior`). `reveal` **não**
  volta para `answering`: a resposta já está projetada.

## 6. API (JSON, prefixo `/api`)
- `POST /api/rooms` {password, quiz:{title, blocks[]}, showPromptOnPhone?} → {code, hostToken}
- `POST /api/rooms/:code/host-login` {password} → {hostToken}
  Throttle de senha errada por **(código, IP)** via `cf-connecting-ip`; a senha
  correta sempre passa (o código é público, projetado na parede).
- `POST /api/rooms/:code/join` {nickname} → {playerId, playerToken, avatar}
- `GET  /api/rooms/:code/state?since=&playerToken=` → estado público. O telão se
  identifica com `Authorization: Bearer <hostToken>` (ou `?hostToken=`) para
  receber o enunciado em `reading`.
- `POST /api/rooms/:code/answer` {playerToken, questionId, choice[]|text}
- `POST /api/rooms/:code/reaction` {playerToken, emoji}
- `POST /api/rooms/:code/host/<action>` (Bearer hostToken), body opcional
  `{from, version}` como guarda de concorrência.
  Ações: `advance` (caminha o grafo), `back`, `options` (mostra as opções e liga
  o cronômetro), `start`, `reveal`, `leaderboard`, `next`, `end`.
- `POST /api/rooms/:code/host/settings` {showPromptOnPhone}
- `POST /api/rooms/:code/host/grade` {questionId, groups[]} - aceita **qualquer**
  pergunta aberta já respondida, não só a atual; recalcula a cadeia de streak do
  jogador em ordem de pergunta, de forma que o estado gravado é sempre igual a um
  recálculo do zero.
- `GET  /api/rooms/:code/host/answers?questionId=` (host) → agrupamento open_text
- `GET  /api/rooms/:code/host/quiz` (host) → quiz completo
- `GET  /api/rooms/:code/leaderboard`
Erros: `{error:{code, message}}` com códigos estáveis (`ROOM_NOT_FOUND`,
`BAD_PASSWORD`, `NICKNAME_TAKEN`, `ROOM_FULL`, `ALREADY_ANSWERED`, `TIME_UP`,
`UNAUTHORIZED`, `VALIDATION_ERROR`, `BAD_STATE`, `STALE_STATE`, `ROOM_ENDED`,
`PAYLOAD_TOO_LARGE`, `TOO_MANY_ATTEMPTS`).

## 7. D1 schema (migrations em `migrations/`)
`rooms`, `blocks`, `questions`, `options`, `players`, `answers`, `reactions`, `open_grades`.
Índices em (room_id), (question_id), (room_id, score DESC). `rooms.version` bump em toda mutação.
Colunas do ciclo 3: `rooms.show_prompt_on_phone`, `questions.started_at`,
`players.avatar|prev_rank|rank_delta`, `answers.ratio` (proporção de acerto, para
recompor pontos de resposta parcial ao refazer a cadeia de streak).
**Migrations só usam `ALTER TABLE ADD COLUMN` / `CREATE INDEX`**: a receita de
reconstruir tabela apaga `answers`/`reactions` por cascata de `players`.

## 8. i18n
`en`, `es`, `pt` — arquivo `public/i18n/{lang}.json`, seletor no header, autodetect via `navigator.language`, persistido em localStorage. **Zero strings hardcoded** na UI.

## 9. UX / engajamento
- Design vibrante tipo Kahoot: formas/cores por opção (triângulo/diamante/círculo/quadrado + 2 extras), gradientes, dark-friendly.
- Animações: contagem 3-2-1, barra de timer, contagem de respostas, barras de resultado animadas, pódio com confete, entrada de leaderboard escalonada, reações emoji flutuantes, feedback de acerto/erro com haptics (`navigator.vibrate`).
- Sons opcionais gerados por WebAudio (sem arquivos), toggle mute.
- Mobile-first, área de toque grande, funciona em retrato/paisagem. Respeitar `prefers-reduced-motion`.
- Acessibilidade: contraste, labels ARIA, navegação por teclado.

## 10. Estrutura de arquivos
```
wrangler.toml            # d1 binding DB=livepoll_db, assets ./public
migrations/000X_*.sql
src/worker/index.js      # router
src/worker/routes/*.js
src/worker/lib/*.js      # scoring, codes, validation, spreadsheet parse
public/index.html|host.html|play.html
public/js/host-stage.js  # telão: cenas por estado + teclado
public/js/page-play.js   # celular: controle de jogo
public/css/app.css|stage.css|controller.css
src/worker/lib/flow.js   # grafo de estados (puro, testável)
public/js/*  public/css/*  public/i18n/*
tests/                   # node --test (unit) + tests/e2e (playwright)
```

## 11. Comandos
- `npm run dev` → wrangler dev local em :8787
- `npm run db:migrate` → aplica migrations local
- `npm test` → unit
- `npm run test:e2e` → playwright (usa PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, nunca baixar browser)

## 12. Definition of Done por ciclo
Nenhum erro no console do browser; fluxo host+2 players ponta a ponta passando em e2e; i18n completo nos 3 idiomas; sem dependências de CDN/rede externa.
