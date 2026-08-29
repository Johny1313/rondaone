# Deploy — RONDA ONE v0.9.7

## 1. Perfil recomendado

Para 39 fontes, scraping, fallbacks, Multi-AI e Queues dedicadas, use **Cloudflare Workers Paid**. A v0.9.7 aumenta a previsibilidade separando leitura de geração; não é recomendável voltar ao orçamento do Workers Free para a operação completa.

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
ARTICLE_READ_TIMEOUT_MS=16000
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
```

## 7. Deploy

```bash
npm run deploy
```

Em GitHub + Cloudflare Workers Builds, substitua a árvore antiga pela árvore CLEAN. Não misture arquivos de pacotes anteriores.

## 8. Conferência pós-deploy

Abra `/api/platform/status` e confirme:

```text
version: 0.9.7
editorialVersion: 2.9.7
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

Não habilite browser/headless inicialmente. A v0.9.7 usa `fetch()` + parsers + adapters + AMP + conteúdo coletado. Browser rendering deve ser uma v0.9.7.1 somente se as métricas mostrarem portais importantes que dependem de JavaScript para liberar o texto público.
