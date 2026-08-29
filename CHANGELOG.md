# Changelog — RONDA ONE

## 0.9.5 — Workflow editorial multiusuário

- papéis `editor`, `reviewer` e `publisher` adicionados ao controle de acesso;
- workflow `draft → in_review → approved/rejected → published`;
- auditoria de transições em `production_workflow_events`;
- atribuição por usuário/grupo;
- aba Workflow no Admin;
- envio para revisão pelo FORMA;
- correção do helper `readJsonBody()` ausente em rotas da Newsroom;
- schema/runtime editorial atualizado para 2.9.5.

## 0.9.4.3 — Operations Reliability

- watchdog periódico;
- replay automático limitado para falhas transitórias;
- replay manual de jobs;
- health score por fonte;
- monitoramento de uso Multi-AI e estimativa de custo;
- eventos de watchdog persistidos no D1.

## 0.9.4.2 — Carousel Versions + FORMA Content Lock

- versionamento persistente de carrossel;
- restauração de versões no FORMA;
- Content Lock por campo semântico;
- reaplicação de template/IA preservando edição humana;
- Smart Template Engine 1.2.0.

## 0.9.4.1 — Multi-AI + Quality Gate + Confidence

- IA primária + secundária em failover;
- terceira IA opcional;
- Quality Gate editorial/factual;
- Confidence Score geral e por slide;
- `aiTrace` e métricas por papel;
- fallback determinístico permanece como última barreira segura.

## 0.9.4 — Production Hardening

- template preflight e layout seguro de fallback;
- proxy/cache de assets externos;
- recuperação de jobs órfãos;
- Reliability Dashboard e testes de chaos/smoke/stress.

## 0.9.3 — Reliability Core

- estados operacionais padronizados;
- retry e fallback centralizados;
- ações de confiabilidade persistidas;
- leitura parcial útil e contingência de Queue.

## 0.9.2.1 — Admin Login Hotfix

- correção do import de `SESSION_COOKIE_NAME` no login administrativo.

## 0.9.2 — Mesa Operacional

- decisão editorial;
- qualidade da apuração;
- saúde de fontes;
- histórico operacional;
- links diretos de apuração.

## 0.9.1 — Unified Main + Carousel Queue Recovery

- Fast Lane/Mesa integradas à coleta principal;
- Queue como dona única do processamento do carrossel;
- heartbeat e recuperação de jobs.

## 0.9.0 — Fast News Engine

- Fast Lane de descoberta;
- RSS + scraping HTML leve + fallback;
- `firstSeenAt`, `discoveredAt`, `lastSeenAt`.
