# Deploy — RONDA ONE v0.9.7.4.9 Editorial Desk Tracking

## 1. Princípio de atualização

A v0.9.7.4.9 é incremental sobre a v0.9.7.4.8. Não remova bindings, Queues, D1, Browser Run, cache ou arquivos funcionais já existentes.

## 2. Bindings necessários

- `DB` — D1;
- `AI` — Workers AI;
- `BROWSER` — Cloudflare Browser Run (já introduzido na v0.9.7.4.6);
- `ASSETS`;
- `ROUND_JOBS_QUEUE`;
- `INTELLIGENT_JOBS_QUEUE`;
- `ARTICLE_READ_QUEUE`;
- `CAROUSEL_AI_QUEUE`.

Não há nova Queue nem novo serviço obrigatório nesta versão.

## 3. D1

Não execute migração SQL manual. `ensureSchema()` adiciona de forma defensiva ao `source_state`, quando faltarem:

```text
preferred_route
circuit_state
next_retry_at
served_from
revalidation_pending
last_route_tried
```

As tabelas existentes permanecem intactas.

## 4. Variáveis opcionais

```text
ROUND_EXTERNAL_REQUEST_BUDGET=120
ROUND_BROWSER_CONCURRENCY=2
ROUND_EARLY_SOURCE_TARGET=25
ROUND_EARLY_FRESH_MINIMUM=8
ARTICLE_READ_TIMEOUT_MS=5000
PRODUCTION_INTERACTIVE_DEADLINE_MS=12000
```

`ROUND_BROWSER_CONCURRENCY` deve permanecer baixo. Browser Run é recuperação, não rota simultânea para dezenas de fontes.

## 5. Testes locais antes do deploy

```bash
npm install
npm run test:all
```

Teste específico do HOTFIX:

```bash
npm run test:09748
```

## 6. Deploy

```bash
npm run deploy
```

## 7. Conferência pós-deploy

`GET /api/platform/status` deve retornar HTTP 200 e incluir:

```text
version: 0.9.7.4.9
database: connected
schedulerHealthy: true
queues.ROUND: available
queues.INTELLIGENT: available
sources.total: 39
sources.coveragePercent: <número>
```

Também confira:

```text
/api/health
/api/status
/api/latest
/api/sources/diagnostics
```

## 8. Três ciclos reais obrigatórios

Depois do deploy:

```bash
BASE_URL=https://SEU-WORKER npm run validate:prod
```

O script executa três ciclos de conferência de status, D1, scheduler, filas, diagnostics e jobs presos. Só depois desses três ciclos remotos considere o HOTFIX LOCK certificado em produção.

## 9. Diagnóstico de fonte

`/api/sources/diagnostics` passa a expor, sem remover os campos antigos:

```text
circuitState
servedFrom
revalidationPending
nextRetryAt
preferredRoute
lastRouteTried
```

Uma fonte em `OPEN` com cache válido deve ser servida imediatamente e revalidada separadamente; ela não pode bloquear a ronda.
