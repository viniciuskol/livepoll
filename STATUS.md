# STATUS — LivePoll

Atualizado: 2026-08-20 07:00 BRT — fim da janela de trabalho desta sessão.
Branch: `claude/live-polling-kahoot-tool-emk45g` · HEAD `b3dedca`

## O que existe hoje

Ferramenta de live polling estilo Kahoot rodando 100% local em Cloudflare
Workers + D1 + Assets, sem contas, sem build step e sem nenhuma dependência de
CDN. Cinco ciclos de fix-and-validate concluídos.

- **Apresentador**: baixa a planilha modelo (CSV ou XLSX, já no idioma da
  interface), preenche, sobe, define senha e recebe código de sala + QR. O telão
  é um palco projetável conduzido por teclado como um slide deck (espaço avança,
  `←` volta, `F` tela cheia, `L` ranking, `G` correção, `?` atalhos), com um
  único botão primário rotulado com o próximo passo.
- **Participante**: entra por código ou QR pelo celular, sem cadastro, recebe um
  emoji-avatar e joga com alvos de 141px, vibração, flash de tela cheia no
  reveal, pontos contando para cima, streak em chamas e resumo pessoal no fim.
- **Anti-cheating**: estado `reading` mostra só o enunciado para o apresentador
  ler em voz alta; as opções **não são carregadas do D1** nesse estado e o timer
  só começa quando ele libera. Durante a rodada a pontuação ao vivo é mascarada
  (era um oráculo de resposta) e a distribuição só aparece no reveal.
- 4 tipos de pergunta (escolha única, múltipla seleção, verdadeiro/falso,
  resposta aberta com correção manual e idempotente), blocos com cartela de
  virada, leaderboard com movimentação de posições, reações, i18n en/es/pt.
- **Testes**: 97 unitários + 18 e2e Playwright, incluindo asserções de tamanho
  de fonte renderizado e ausência de estouro nas duas resoluções de projetor.

## Comandos

```bash
cd /home/user/aulao_agentes
npm install
npm run db:migrate
npm run dev                              # http://127.0.0.1:8787
npm test && npm run test:e2e
node tools/screenshots.mjs --port 8788   # regera docs/screenshots/ (22 prints)
```

## O que falta (fila para a próxima sessão, em ordem)

1. **Telas ultrawide (21:9)**: `.scene { max-width: 1800px }` deixa ~380px de
   parede morta por lado a 2560x1080; o preenchimento cai para 23-64%. O ciclo 5
   começou isso e caiu no meio (erro 529 do servidor) — nada dessa parte entrou.
2. **`POST /host/grade` com chave de grupo desconhecida** responde
   `200 {ok:true, updated:0}` em silêncio; deveria ser `VALIDATION_ERROR`.
3. **Celular sem validação independente**: os 141px de alvo e os 12px de espaço
   morto abaixo da grade foram medidos pelo dev, não pelo validador. Faltam
   360x640 e paisagem 844x390.
4. **`image_url` morto na planilha** loga erro no console (a spec pede zero).
5. **Tela cheia** nunca foi verificada: o Chromium headless não concede.
6. **Contraste por amostragem de pixel**: os números atuais são aritméticos, a
   partir da paleta declarada, não observados na tela.
7. **Carga real**: nada acima de 40 participantes; `MAX_PLAYERS` é 300 e a
   saturação medida do miniflare local não representa Workers de verdade.

## Retomar o loop

```
/loop 30m Continue os ciclos de fix-and-validate do LivePoll conforme SPEC.md e SPEC-UX.md: 1 subagent dev aplica a fila do STATUS.md, 1 subagent validador valida adversarialmente, e ao final de cada ciclo commit + `node tools/screenshots.mjs --port 8788` + resumo de 2-3 linhas.
```

## Aprendizados que valem para os próximos ciclos

- `prefers-reduced-motion` é ponto cego recorrente: ele zera transforms e
  transições, então bugs que dependem deles (o reveal travado no piso da escala)
  só aparecem com movimento ligado, e `getComputedStyle` devolve valor
  pré-transição enquanto a regra de transição global estiver ativa.
- Estouro **para cima** não aparece em `scrollHeight`, então o passo de fit não
  o percebe. Duas vezes isso produziu sobreposição silenciosa.
- O `wrangler dev` deixa um `workerd` filho vivo depois de um SIGTERM no pai; um
  zumbi na porta faz a rodada seguinte conversar com um servidor apontando para
  um D1 já apagado. O script de prints mata o grupo e recusa subir com a porta
  ocupada.
- Receitas de rebuild de tabela no SQLite são proibidas aqui: `answers` e
  `reactions` têm `ON DELETE CASCADE` em `players`, e o D1 aplica FK enquanto o
  `node:sqlite` dos testes não — foi assim que uma migration apagou respostas
  com 81 testes verdes.
