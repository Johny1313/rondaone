# Deploy — RONDA ONE v0.9.7.4

## 1. Perfil recomendado

Para 39 fontes, scraping, fallbacks, Multi-AI e Queues dedicadas, use **Cloudflare Workers Paid**. A v0.9.7.4 mantém a separação de leitura e geração, mas a produção manual usa Interactive Fast Path; não é recomendável voltar ao orçamento do Workers Free para a operação completa.

## 2. Bindings principais

- `DB` — D1;
- `AI` — Workers AI;
- `ASSETS`;
- `ROUND_JOBS_QUEUE`;
- `INTELLIGENT_JOBS_QUEUE` — compatibilidade/rotinas legadas;
- `ARTICLE_READ_QUEUE` — nova, obrigatória na configuração entregue;
- `CAROUSEL_AI_QUEUE` — nova, obrigatória na configuração entregue.

O cron permanece `* * * * *`.

## 3. Criar as novas Queues antes do primeiro deploy

Execute uma vez:

```bash
npx wrangler queues create ronda-one-article-read
npx wrangler queues create ronda-one-carousel-ai
npx wrangler queues create ronda-one-article-read-dlq
npx wrangler queues create ronda-one-carousel-ai-dlq
```

Depois confira no Cloudflare se as quatro Queues existem. O `wrangler.jsonc` já contém producers/consumers para `ronda-one-article-read` e `ronda-one-carousel-ai`.

A leitura usa concorrência máxima 3. A geração Multi-AI usa concorrência máxima 2, evitando que scraping pesado e geração editorial concorram dentro do mesmo consumidor.

## 4. D1

Não é necessário executar SQL manualmente. O Production Engine cria de forma aditiva e isolada:

- `production_jobs`;
- `evidence_packages`;
- `production_stage_events`;
- `production_state`.

As tabelas da RONDA, Mesa, versões e workflow existentes permanecem intactas.

## 5. Variáveis opcionais

```text
ROUND_EXTERNAL_REQUEST_BUDGET=120
ARTICLE_READ_TIMEOUT_MS=5000
PRODUCTION_INTERACTIVE_DEADLINE_MS=12000
ROUND_EARLY_SOURCE_TARGET=25
ROUND_EARLY_FRESH_MINIMUM=8
ARTICLE_ANALYSIS_MODEL
ARTICLE_SECONDARY_MODEL
ARTICLE_TERTIARY_MODEL
CAROUSEL_TERTIARY_AI=1
FORMA_IMAGE_MODEL=@cf/black-forest-labs/flux-1-schnell
AI_ESTIMATED_COST_PER_CALL_USD
```

Recomendação inicial: manter a terceira IA desligada. A imagem IA só é chamada manualmente no FORMA.

## 6. Testes antes do push

```bash
npm install
npm run test:all
```

Testes específicos:

```bash
npm run test:096
npm run test:097
npm run test:0973
npm run test:0974
```

## 7. Deploy

```bash
npm run deploy
```

Em GitHub + Cloudflare Workers Builds, substitua a árvore antiga pela árvore CLEAN. Não misture arquivos de pacotes anteriores.

## 8. Conferência pós-deploy

Abra `/api/platform/status` e confirme:

```text
version: 0.9.7.4
editorialVersion: 2.9.7.4
formaProductionEngineV096.enabled: true
scrapingEvidenceEngineV097.enabled: true
modules.queues.articleReadDedicated: true
modules.queues.carouselAiDedicated: true
```

Depois valide os dois caminhos separadamente:

```text
RONDA → Produzir no FORMA → leitura → Evidence Pack → Multi-AI → template
```

```text
FORMA → colar link externo → leitura → Evidence Pack → Multi-AI → template
```

Por fim teste `Gerar imagem com IA` no Banco Free do FORMA.

## 9. Diagnóstico

Uma produção pode ser consultada por:

```text
GET /api/production/jobs/:id
```

O retorno informa `stage`, `progress`, `evidence`, eventos e resultado. Use isso para distinguir falha de leitura, evidência, IA ou composição.

## 10. Browser Rendering

Não habilite browser/headless inicialmente. A v0.9.7 usa `fetch()` + parsers + adapters + AMP + conteúdo coletado. Browser rendering continua opcional e deve ser habilitado somente se métricas mostrarem portais públicos importantes que realmente dependem de JavaScript para liberar o texto.


## Fast path opcional

Os defaults da v0.9.7.2 já são conservadores. Se houver uma necessidade editorial específica, os tempos podem ser ajustados por ambiente:

- `EVIDENCE_FAST_CACHE_MINUTES` — sobrescreve a janela de reaproveitamento do Evidence Pack;
- `PRODUCTION_RESULT_CACHE_MINUTES` — sobrescreve a janela de reaproveitamento de carrossel pronto.

Não aumente esses valores sem considerar a velocidade de atualização das notícias. O botão **Releitura completa** ignora os fast paths para uma produção específica.

## Fluxo v0.9.7.2 — Content First

A produção não recebe `templateId`. O Production Engine gera primeiro o conteúdo em pt-BR e o FORMA aplica o template somente depois, sem nova chamada de IA.

Para pautas com múltiplas fontes, o scraper seleciona **uma fonte principal** por score. Somente se ela não produzir leitura útil é aberta **uma única fonte backup**. Não existe leitura paralela de vários publishers na v0.9.7.2.

A normalização de idioma usa Workers AI apenas quando a matéria não estiver em português. O Evidence Pack mantém `sourceLanguage`, `targetLanguage: pt-BR` e o status da tradução para auditoria.



## Gate obrigatório de quantidade de slides — v0.9.7.2.1

Toda chamada nova a `POST /api/production/jobs` deve enviar `slideCount` entre 3 e 15. O FORMA pergunta essa quantidade antes de criar o job; sem ela, a API responde 400 e não inicia scraping, leitura ou IA.

## Interactive Fast Path — v0.9.7.3

Ação manual no FORMA não espera Queue para começar. `POST /api/production/jobs` tenta concluir leitura + Evidence Pack + carrossel diretamente por até 12 s. Se ultrapassar esse deadline curto, o mesmo job continua via `ctx.waitUntil()` e o FORMA acompanha o status. ARTICLE_READ_QUEUE e CAROUSEL_AI_QUEUE permanecem como recovery/automação e não devem ser removidas.

## Fast Ronda 25+ — v0.9.7.4

A coleta completa usa concorrência controlada de até 14 fontes, RSS-first e timeout de primeira passada de 4,5 s. Quando há 25+ fontes disponíveis e o mínimo de respostas frescas configurado, o Worker grava `latest_round_preview`; `/api/latest` pode servir essa prévia enquanto a mesma ronda continua até o resultado final. Não há nova Queue nem nova binding obrigatória nesta versão.

## v0.9.7.4.6 — Browser Run

A versão declara `browser.binding = BROWSER` no `wrangler.jsonc`. O fallback de navegador usa Cloudflare Browser Run Quick Actions e não exige API token no código.

- Produção: `npx wrangler deploy` usa o binding configurado.
- Desenvolvimento local: Quick Actions podem exigir `wrangler dev --remote`.
- Se Browser Run falhar, o leitor continua com fetch direto, snapshot/RSS e a única fonte backup; o recurso não remove os fallbacks existentes.

