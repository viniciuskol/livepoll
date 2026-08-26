# LivePoll — Design de telas (Game Design + UX)

Complementa o SPEC.md. Onde houver conflito, este documento vence para
**layout, fluxo de estados e sensação de jogo**.

## Princípio

São **duas telas com papéis diferentes**, nunca a mesma interface encolhida:

- **Telão (host)** — está sendo projetado/compartilhado. É o palco. Tem que ser
  auto-suficiente: o apresentador conduz a sessão inteira olhando só para ela,
  como um slide deck. Ninguém lê texto pequeno a 8 metros.
- **Celular (participante)** — está na mão, a 30cm do olho. É o controle do
  videogame. Tem que dar prazer tátil: resposta imediata, som, vibração,
  pontos subindo, streak pegando fogo.

Corolário: **informação não se duplica, se divide**. O enunciado vive no telão;
o celular dá o comando. Isso mata a tentação de ler o celular em vez de olhar
para o apresentador.

## Máquina de estados (muda o SPEC §5)

```
lobby → reading → answering → reveal → [leaderboard] → reading (próxima)
                                                     → block_intro → reading
                                                     → ended
```

`reading` é novo e é o coração do anti-cheating:

| estado | telão | celular | timer |
|---|---|---|---|
| `lobby` | código gigante + QR + participantes entrando | "você está dentro", identidade | — |
| `reading` | **só o enunciado**, tipografia enorme; o apresentador lê em voz alta | "olhe para o telão", sem opções | parado |
| `answering` | opções aparecem com forma/cor + timer | **opções aparecem agora** | **começa aqui** |
| `reveal` | resposta correta + distribuição + explicação | acertou/errou, pontos subindo | parado |
| `leaderboard` | top 5 com setas de movimentação | posição própria destacada | parado |
| `block_intro` | "Bloco 2 — Nome do bloco" | "novo bloco" | — |
| `ended` | pódio | resumo pessoal | — |

**Regra de ouro do anti-cheating**: em `reading`, o payload de `/state` **não
contém as opções**. Não é esconder no CSS — os dados não são enviados. Quem
abrir o DevTools não acha nada. O tempo de resposta só começa a contar quando o
apresentador clica em "Mostrar opções", então a janela para pesquisar no Google
é a janela que o apresentador escolher dar.

`questions.started_at` passa a ser gravado na transição para `answering`, não ao
entrar na pergunta.

## Telão: comandar como um slide deck

**Teclado é a interface principal** — quem apresenta não quer caçar botão com o
mouse na frente da plateia:

| tecla | ação |
|---|---|
| `Espaço` / `→` / `Enter` | próximo passo (o mesmo botão primário da tela) |
| `←` | voltar um passo (reveal → answering não volta; volta de leaderboard para reveal) |
| `F` | tela cheia |
| `L` | mostrar/esconder ranking |
| `M` | mudo |
| `?` | atalhos |

Um único **botão primário grande** por estado, com o rótulo do que vem a seguir
("Mostrar opções", "Revelar resposta", "Ver ranking", "Próxima pergunta"), mais
os secundários discretos. O apresentador nunca precisa decidir entre seis botões.

**Layout do palco** (1280×720 é o pior caso realista de projetor):

- Faixa superior fina e persistente: código da sala + QR pequeno (para quem
  chegou atrasado), bloco atual, "Pergunta 3 de 12", contador de participantes.
- Centro: o conteúdo do estado, ocupando o resto da tela. Tipografia fluida
  (`clamp`), enunciado até ~4 linhas sem estourar.
- Rodapé: barra de progresso do quiz + o botão primário.
- Sem topbar de app, sem seletor de idioma no meio da apresentação (escolhe
  antes de começar), sem card vazio. **Nada de espaço morto**: cada estado
  preenche o palco.
- Modo tela cheia com fundo escuro: contraste alto para projetor, cores das
  opções saturadas.

**Momentos de show** no telão:
- Lobby: nomes dos participantes entrando com "pop", contador subindo, e uma
  chamada clara "entre em livepoll.local/j/ABC123".
- `reading → answering`: contagem 3-2-1 curta e as opções entrando em cascata.
- Durante `answering`: **contagem de respostas, nunca a distribuição** (mostrar
  a distribuição antes do reveal enviesa quem ainda não respondeu). Um anel de
  timer que muda de cor nos últimos 5 segundos.
- `reveal`: a opção correta cresce e brilha, as erradas dessaturam; barras de
  distribuição animando; explicação em corpo legível.
- `leaderboard`: top 5 subindo com setas ↑↓ e delta de posição.
- `block_intro`: cartela de transição, respiro entre blocos.
- `ended`: pódio 2-1-3 com confete e o nome do campeão em destaque.

## Celular: sensação de jogo

- **Identidade**: ao entrar, o participante recebe um emoji-avatar. Aparece no
  telão junto do nome. Barato e cria pertencimento.
- `reading`: tela limpa com "👀 Olhe para o telão" e pulso de expectativa. Sem
  enunciado, sem opções — é o que impede a pesquisa antecipada.
- `answering`: as opções entram com vibração curta. Alvos gigantes (mínimo 44px,
  na prática ~72px de altura), forma + cor + texto. Anel de timer no topo.
  Depois de responder: confirmação com a forma escolhida, e "aguardando os
  outros" com contador — não uma tela morta.
- `reveal`: flash verde/vermelho de tela inteira, pontos ganhos **contando para
  cima**, streak em chamas ("🔥 3 seguidas"), e a mudança de posição
  ("↑ subiu 3"). Vibração diferente para acerto e erro.
- `leaderboard`: a própria linha destacada e ancorada na tela.
- **Reações** sempre acessíveis, sem tirar o foco da pergunta.
- `ended`: resumo pessoal — acertos, melhor sequência, posição final, e confete
  para o top 3.
- Nada de rolagem durante a resposta: tudo cabe na primeira dobra a 390×844.

## Ajustes de conteúdo

- A planilha modelo vem com exemplos **no idioma da interface** (quem baixa em
  pt-BR não recebe um arquivo de perguntas em inglês).
- Idioma do participante é independente do idioma do apresentador.

## O que não fazer

- Não mostrar a resposta correta no telão antes do `reveal` (a tela está sendo
  projetada — qualquer dica vaza para a plateia inteira).
- Não mostrar distribuição de respostas durante `answering`.
- Não repetir o enunciado no celular durante `answering` (só as opções), a não
  ser que a sala ligue o modo acessibilidade.
- Não deixar o participante sem feedback: todo estado tem uma mensagem e uma
  animação.

## Acessibilidade

Modo "enunciado no celular" opcional por sala, para quem apresenta remoto ou
tem participante com baixa visão. Fora isso: contraste ≥4.5:1, `aria-live` nas
transições, `prefers-reduced-motion` respeitado, navegação por teclado no telão.
