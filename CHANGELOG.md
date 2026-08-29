# Changelog

## 0.9.7.2.1 — Mandatory Slide Count

- Modal obrigatório pergunta a quantidade de slides antes de iniciar uma nova produção.
- Presets 3/5/7/10 e valor personalizado entre 3 e 15.
- Pauta enviada pela RONDA não começa automaticamente: aguarda a confirmação editorial.
- Link externo também pede a quantidade antes de criar o job.
- `POST /api/production/jobs` exige `slideCount` explicitamente; o default do perfil não inicia produção silenciosamente.
- Cancelamento ocorre antes de scraping, leitura e Multi-AI.
- Template continua sendo aplicado somente depois do carrossel pronto.

## 0.9.7.2 — Single Source + Content First

- Geração de conteúdo desacoplada de template: o carrossel nasce em layout neutro e o template é aplicado somente depois.
- Aplicar ou trocar template não chama IA novamente.
- Seleção de uma fonte principal por score, com apenas uma fonte backup em caso de falha real.
- Removida leitura paralela de múltiplos publishers no Production Engine.
- Normalização pt-BR de matérias estrangeiras antes do Evidence Pack quando a tradução está disponível; regra de saída pt-BR reforçada na Multi-AI.
- Telemetria de leitura, tradução, IA, tempo total e papel da fonte exibida no FORMA.
- Preservados cache rápido, URL efetivamente lida, créditos de imagem, Content Lock e exclusão de templates.

## 0.9.7.1 — Fast Carousel + Source Credits + Scraping Optimization

- reutilização imediata de carrossel pronto quando entrada, estilo e quantidade de slides não mudaram;
- fingerprint da pauta impede reutilização quando o conteúdo da RONDA evoluiu;
- Evidence Pack recente pode pular `ARTICLE_READ_QUEUE` e seguir direto para `CAROUSEL_AI_QUEUE`;
- URL de matéria normalizada remove parâmetros de tracking para aumentar acerto de cache;
- scraping de pauta prioriza conteúdo já coletado e testa as melhores fontes em ondas concorrentes limitadas;
- tempo de leitura reduzido sem remover fallback ou Quality Gate;
- FORMA mostra o URL efetivamente lido para produzir o carrossel;
- imagens recuperadas da matéria exibem origem, crédito e fotógrafo quando o portal fornece os metadados;
- Smart Template Engine 1.2.1 preserva crédito de imagem no contrato semântico;
- templates salvos podem ser apagados individualmente, mantendo intacta a composição já aberta;
- `Releitura completa` continua disponível para ignorar cache quando a notícia tiver mudado;
- nenhuma Queue nova além das já introduzidas na v0.9.7.

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
