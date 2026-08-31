# RONDA ONE v0.9.7.5.7 — Quality-First 5M + Cost Governor + Crawl Read-Only

## Objetivo

Reduzir drasticamente processamento recorrente e represamento da `ROUND Queue` sem reduzir a qualidade editorial da Ronda e sem alterar o pipeline consolidado de geração de carrossel.

A meta operacional desta build é **US$ 1/semana de gasto adicional automático**, tratada como um alvo técnico por budgets de processamento. O Worker não possui acesso ao faturamento real da conta Cloudflare; portanto o valor em dólares deve continuar sendo acompanhado no painel Cloudflare. A geração manual de carrossel fica fora do bloqueio de custo automático para não degradar sua qualidade.

## Evidência que motivou a mudança

No D1 de produção, múltiplas rondas recentes estavam em `expired` com `items_count=0`, `topics_count=0`, `sources_count=0` e erro `Ronda expirada antes de iniciar no consumidor.` Ao mesmo tempo, a Mesa continuava recebendo novos eventos. O comportamento é compatível com congestionamento da fila/orquestração, não com ausência geral de conteúdo nas fontes.

## Quality-First 5M

- Cron automático: `*/5 * * * *`.
- Uma única Ronda automática completa por oportunidade.
- Fast Lane automático por minuto desativado; o código legado permanece disponível para compatibilidade/testes.
- `single-flight`: se existe `runs.status IN ('queued','running')`, nenhuma nova Ronda é criada.
- `round-enqueue-gate`: evita corrida entre disparos concorrentes do scheduler.
- coalescing natural: se uma execução ocupa o próximo horário, não há backlog; o próximo cron é a próxima oportunidade.
- queued stale: 7 min; running stale: 15 min.
- consumidor ignora mensagens de rondas já terminais (`success/failed/expired`) e não ressuscita jobs velhos.
- mensagens legadas `source-revalidate` são apenas confirmadas/descartadas; a próxima Ronda decide se a fonte está vencida.

## Coleta de qualidade com menor volume

As 39 fontes permanecem cadastradas.

Lote vivo por ciclo:

- very-high: 24 itens; snapshot de memória 96;
- high: 18 itens; snapshot 72;
- Brasil normal: 12 itens; snapshot 48;
- Mundo normal: 10 itens; snapshot 48.

Cadência por fonte:

- alta frequência: 5 min;
- média: 10 min;
- normal: 15 min;
- cobertura baixa pode antecipar high/normal, sem voltar a 1 min.

A coleta multi-rota de fontes de alto volume permanece, mas só é forçada enquanto a memória indicar cobertura insuficiente. Com cobertura saudável, RSS/direct pode encerrar cedo.

## Cost Governor

Defaults configuráveis:

- `ROUND_EXTERNAL_REQUEST_BUDGET`: 70 por Ronda;
- `ROUND_BROWSER_DAILY_LIMIT`: 48 execuções em janela de 24h;
- Browser Run: no máximo 1 por Ronda;
- revalidação background: sem Browser Run;
- `ROUND_TRANSLATION_DAILY_LIMIT`: 192 novos títulos em 24h;
- tradução por Ronda: máximo 8 novos títulos e sempre cache-first;
- métricas: `round_browser_runs`, `round_external_requests`, `round_translation_new_titles`.

O alvo de US$ 1/semana é para processamento **automático adicional**. A conta real depende do plano, franquias e do volume de ações manuais. O sistema não reduz a qualidade de carrossel para cumprir o budget.

## Crawl Read-Only

Novo endpoint: `GET /api/crawl?limit=100&hours=6`.

Origem exclusiva: `D1 source_discovery_items`.

O Crawl:

- não executa scraping;
- não abre Browser Run;
- não chama IA;
- não traduz;
- não cria jobs;
- não cria uma segunda coleta;
- exibe somente título, fonte, horário e URL original já capturados;
- usa ETag e cache privado de 30 s;
- só é consultado quando o usuário abre/atualiza a aba Crawl.

## Proteção do carrossel

A alteração foi deliberadamente mantida fora dos componentes críticos do carrossel. Um teste de release compara SHA-256 e falha caso qualquer um destes arquivos seja alterado:

- `src/production/engine.js`
- `src/production/scraping-engine.js`
- `src/ronda/v285/article-reader.js`
- `public/design/index.html`

Hashes congelados da base 0.9.7.5.6:

- `production/engine.js`: `cabecc5f756746ddbd79a1c6b4d7790d75e68bb58d24010fe72b640d523df651`
- `production/scraping-engine.js`: `d5cd2aba4f110ff93f319e0e8f297f51db9478fb1c9dfbb48338cd8c4dc50357`
- `article-reader.js`: `944bff72b03f3c15a10e42a12541aef9af531c676801add27474a3b5165fc722`
- `FORMA index.html`: `1af86252a341dd292218ef21aca97d6623d3a9d96ed6bff478d43b353195b156`

Portanto Evidence Pack, leitura de matéria para carrossel, Multi-AI, Quality Gate, Confidence, retry adaptativo, lease handoff, fallback determinístico e FORMA permanecem funcionalmente congelados nesta build.

## Validação local

- `npm run check`: OK
- `npm run test:current`: OK
- `npm run test:regression`: OK
- `npm run verify`: OK
- teste novo `test-09757-quality-first-cost-crawl.mjs`: OK
- Carousel Freeze SHA-256: OK

## Validação obrigatória após deploy

Observar pelo menos 3 ciclos de 5 minutos e confirmar:

1. uma Ronda válida nova a cada ~5 min quando a anterior terminou;
2. nenhuma sequência de `Ronda expirada antes de iniciar no consumidor`;
3. `queued/running` não cresce continuamente;
4. Mesa continua recebendo conteúdo;
5. Principal passa a refletir a nova Ronda;
6. fontes permanecem 39/39 cadastradas e memória de cobertura não é perdida;
7. Crawl abre notícias já captadas e o link original sem gerar jobs;
8. gerar pelo menos um carrossel por URL e um por pauta/evento, confirmando Evidence Pack → generating → ready → FORMA;
9. acompanhar o painel Cloudflare por 24–72 h para calibrar os budgets se o consumo variável ainda estiver acima da meta.

## Stop conditions

Reverter se houver:

- queda persistente de cobertura editorial;
- perda de fontes importantes em ciclos consecutivos;
- nova fila crescente de `runs`;
- regressão de Mesa/Principal;
- regressão de Evidence Pack ou geração de carrossel;
- duplicação de carrossel/IA;
- aumento de custo apesar da redução de cadência.
