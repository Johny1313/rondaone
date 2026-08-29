# Changelog — RONDA ONE

## 0.9.7 — Scraping + Evidence Engine

- Evidence Pack persistente para pautas, eventos, links externos e texto próprio;
- parser genérico + adapters por portal + AMP + fallback de conteúdo coletado;
- adapters iniciais: G1/ge, CNN Brasil, Folha, Estadão, O Globo, Poder360, Agência Brasil, Metrópoles, UOL e InfoMoney;
- cache de evidências por 7 dias;
- fatos, entidades, números, datas, imagens, método e qualidade de leitura armazenados;
- Multi-AI gera a partir do Evidence Pack sem reabrir o portal;
- browser rendering reservado para fallback futuro, sem bypass de paywall/CAPTCHA.

## 0.9.6 — Unified FORMA Production Engine

- FORMA passa a ser o centro único de produção;
- RONDA troca “Gerar roteiro” por “Produzir no FORMA”;
- endpoint único `/api/production/jobs` para pauta, evento, URL e texto;
- pipeline persistente `source → reading → evidence → generating → ready`;
- tabelas `production_jobs`, `evidence_packages`, `production_stage_events` e `production_state`;
- `ARTICLE_READ_QUEUE` e `CAROUSEL_AI_QUEUE` dedicadas;
- leitura e Multi-AI deixam de compartilhar o mesmo job monolítico;
- geração de imagem IA volta ao FORMA como ação manual em `/api/production/image`;
- endpoints antigos de carrossel permanecem por compatibilidade, mas deixam de ser a interface principal.

## 0.9.5.1 — Round Stability + History Hygiene

- Fast Lane passa a usar `trigger_type=fast-lane` e deixa de poluir o Histórico editorial por padrão.
- falhas técnicas com 0 fontes/0 conteúdos permanecem registradas no D1/watchdog, mas saem da visão editorial padrão; podem ser consultadas com `?technical=1`.
- termos monitorados, ronda anterior e source-state tornam-se dependências degradáveis: falha nelas não impede o coletor de tentar as fontes.
- orçamento externo da coleta passa a aceitar `ROUND_EXTERNAL_REQUEST_BUDGET`; padrão continua 120.
- banner de status ignora Fast Lane e tentativas técnicas vazias ao decidir se a "última tentativa" editorial falhou.
- watchdog pesado roda na ronda completa, reduzindo carga da Fast Lane.
- Workers Paid passa a ser recomendação operacional explícita para 39 fontes + fallback.

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
