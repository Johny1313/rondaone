# RONDA ONE 0.9.7.5.6 — Auditoria stuckProduction

## Diagnóstico estático comprovado

Na 0.9.7.5.4, `/api/platform/status` calcula `stuckProduction` apenas sobre `production_jobs` com `status IN ('queued','running')` e `updated_at` mais antigo que 5 minutos. As tabelas `production_workflow` e `editorial_production_tracking` não participam dessa consulta; portanto o workflow editorial humano não é contado como stuck técnico.

O recovery de `production_jobs` existia em `recoverStalledProductionJob`, mas era acionado automaticamente apenas durante `GET /api/production/jobs/:id`. O cron/scheduled recovery varria somente `intelligent_jobs`. Se o cliente interrompesse polling, fechasse a tela ou perdesse conexão antes do estado terminal, o job técnico poderia permanecer queued/running sem nenhum scanner server-side para voltar a invocar o recovery existente.

Essa é a causa sistêmica comprovada para jobs de Produção permanecerem presos apesar de leases, heartbeat, retry e fallback já existirem.

## Correção mínima

- O cron existente agora chama `autoRecoverStaleProductionJobs` a cada ciclo.
- A função apenas seleciona candidatos stale e delega a decisão para `recoverStalledProductionJob`; não existe segundo mecanismo concorrente.
- Leases ativos continuam respeitados pelo recovery existente.
- O GET do job passou a ser read-only.
- Retry/fallback explícitos continuam POST.
- Foi adicionado `/api/admin/production-jobs/diagnostics`, read-only e restrito a admin.
- `/api/platform/status` agora expõe `activeProduction`, `recoveringProduction`, `oldestActiveAgeSeconds` e `oldestHeartbeatAgeSeconds`.

## Componentes não alterados

Scraping, source collection, direct-fetch, Browser Run, RSS, snapshot, source memory, adaptive scraping, circuit breaker, stale-while-revalidate, scheduler editorial, fast lane, full round, tradução, deduplicação, clustering, Mesa, Produção editorial, Forma Design, templates, downloads, projetos, autenticação, D1 schema e topologia das Queues.

## Limitação desta auditoria

O pacote local não contém acesso ao D1 de produção. Portanto os cinco registros reais que originaram `stuckProduction = 5` não puderam ser enumerados individualmente nesta sessão. O novo endpoint administrativo foi incluído justamente para fazer essa inspeção read-only no ambiente publicado sem apagar ou reprocessar dados por consulta.

Após o deploy, consultar `/api/admin/production-jobs/diagnostics` e confirmar os cinco registros antes de qualquer ação manual. O cron fará recovery controlado usando o mecanismo existente.

## Validação local

- `npm run check`: OK
- `npm run test:current`: OK
- `npm run test:regression`: OK
- `npm run verify`: OK
- teste específico `test-09756-stuck-production-watchdog.mjs`: OK

## Declaração

ROOT CAUSE SISTÊMICA IDENTIFICADA: SIM

5 JOBS AUDITADOS INDIVIDUALMENTE NO D1 LIVE: NÃO — acesso ao D1 de produção não disponível nesta sessão

STUCK PRODUCTION FINAL LIVE: NÃO MEDIDO — depende do deploy e observação dos ciclos

REGRESSÕES DETECTADAS NA SUÍTE LOCAL: 0

NENHUMA REGRESSÃO CONHECIDA INTRODUZIDA: SIM
