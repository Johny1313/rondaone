# Deploy — RONDA ONE v0.9.5

## 1. Bindings obrigatórios

A v0.9.5 continua usando a infraestrutura existente:

- `DB` — D1;
- `AI` — Workers AI;
- `ROUND_JOBS_QUEUE`;
- `INTELLIGENT_JOBS_QUEUE`;
- `ASSETS`.

O cron permanece:

```text
* * * * *
```

## 2. Queues dedicadas opcionais

O runtime reconhece, quando configuradas:

- `CAROUSEL_JOBS_QUEUE`;
- `ARTICLE_READ_QUEUE`.

Sem elas, a aplicação usa as Queues atuais. Não crie infraestrutura nova apenas para publicar esta versão; avalie separação quando houver backlog ou concorrência real entre leitura e carrossel.

## 3. Variáveis opcionais de IA

```text
ARTICLE_ANALYSIS_MODEL
ARTICLE_SECONDARY_MODEL
ARTICLE_TERTIARY_MODEL
CAROUSEL_MULTI_AI_MODE=failover
CAROUSEL_TERTIARY_AI=1
AI_ESTIMATED_COST_PER_CALL_USD
```

Recomendação inicial: manter `failover` e a terceira IA desativada. Isso evita pagar processamento extra sem necessidade.

## 4. Banco D1

Novas estruturas são criadas automaticamente:

- `carousel_versions`;
- `production_workflow`;
- `production_workflow_events`;
- `watchdog_events`.

Não há migração SQL manual obrigatória.

## 5. Antes do push

```bash
npm install
npm run test:all
```

## 6. Deploy

```bash
npm run deploy
```

Em GitHub + Cloudflare Workers Builds, substitua a árvore do projeto pela versão atual. Não misture arquivos de pacotes antigos.

## 7. Conferência pós-deploy

Abra:

```text
/api/platform/status
```

Confirme:

```text
version: 0.9.5
editorialVersion: 2.9.5
multiAiCarouselV0941.enabled: true
carouselVersioningV0942.enabled: true
operationsV0943.enabled: true
workflowV095.enabled: true
```

Depois confira como ADM:

```text
/api/admin/source-health
/api/admin/watchdog?hours=24
/api/admin/cost-monitor?hours=24
```

E valide o fluxo real:

```text
login → ronda → leitura → carrossel → FORMA → salvar versão → enviar revisão → aprovar → publicar
```

Faça hard refresh uma vez em `/ronda`, `/design/` e `/admin/`.
