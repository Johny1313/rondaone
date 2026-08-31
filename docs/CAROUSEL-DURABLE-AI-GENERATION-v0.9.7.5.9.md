# RONDA ONE v0.9.7.5.9 — Durable AI Generation Retry

## Objetivo

Corrigir o caso observado no FORMA em que a produção chegava a `3 Evidências → 4 Multi-AI`, excedia a margem de segurança e o botão **Tentar novamente** repetia o mesmo estado sem concluir o carrossel.

A causa estava na coordenação: o retry da leitura já era durável pela `ARTICLE_READ_QUEUE` desde a v0.9.7.5.8, mas o retry da geração com Evidence Pack ainda chamava a geração diretamente por `waitUntil`/recovery direto. Se aquela execução terminasse junto com o ciclo do Worker, o job podia permanecer em `generating` mesmo com Evidence Pack válido.

## Alteração cirúrgica

### Retry manual de geração

Antes:

`retry → Evidence Pack → runDirectProductionRecovery() → processProductionGenerate()`

Agora:

`retry → revoga generating lease → mesmo job → CAROUSEL_AI_QUEUE → processProductionGenerate()`

- o mesmo `jobId` é preservado;
- o Evidence Pack já salvo é reutilizado;
- a lease antiga é revogada antes do reenfileiramento;
- a tentativa anterior perde autorização para concluir o mesmo job;
- execução direta só é usada se a Queue dedicada estiver indisponível.

### Recovery automático da geração

Antes:

`generating stale → geração direta retomada`

Agora:

`generating stale → sem lease ativa → CAROUSEL_AI_QUEUE → geração durável`

O watchdog deixa de preferir execução direta para uma geração Multi-AI que ficou sem progresso.

### Consumer da CAROUSEL_AI_QUEUE

O consumer aceita `deterministicOnly` na mensagem `production-generate`, preservando a possibilidade de encaminhar fallback seguro pela mesma infraestrutura durável quando necessário em evoluções futuras.

## Componentes preservados

Não foram alterados:

- `src/production/scraping-engine.js`;
- `src/ronda/v285/article-reader.js`;
- `public/design/index.html`;
- Evidence Pack;
- seleção de modelos Multi-AI;
- Quality Gate;
- Confidence Score;
- conteúdo e quantidade de slides;
- FORMA;
- Quality-First 5M / Cost Governor / Crawl read-only.

Os três arquivos críticos congelados continuam com os mesmos SHA-256 da v0.9.7.5.8.

## Proteções

- Queue é o caminho primário para retry manual da geração;
- Queue é o caminho primário para recovery automático da geração;
- `runDirectProductionRecovery()` permanece apenas depois de falha/ausência da Queue;
- lease continua garantindo single-owner na geração;
- job pronto continua idempotente e não é sobrescrito por tentativa antiga;
- Evidence Pack continua obrigatório antes de geração.

## Testes

Executados localmente:

- `npm run check` — OK;
- `npm run test:current` — OK;
- `npm run test:regression` — OK;
- `npm run verify` — OK;
- `scripts/test-09759-durable-ai-generation-retry.mjs` — OK.

A regressão histórica completa foi executada da v0.8.0 até a v0.9.7.5.9.

## Pós-deploy recomendado

Testar pelo menos:

1. URL que consiga criar Evidence Pack normalmente;
2. geração chegando a `4 Multi-AI`;
3. retry manual enquanto a geração anterior estiver stale;
4. confirmar nos eventos do job: `Retry manual de geração entregue à CAROUSEL_AI_QUEUE`;
5. confirmar que o job chega a `ready` ou termina com erro técnico específico, sem repetir indefinidamente a mensagem genérica de margem máxima.
