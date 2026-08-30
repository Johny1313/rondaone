# v0.9.7.4.4 — Projects + UI Security Cleanup

- **Salvar projeto** agora persiste o documento completo no D1 e o torna visível na aba **Projetos**.
- Projetos criados diretamente no FORMA podem ser reabertos pelo mesmo editor, preservando pranchetas, camadas, Content Lock e metadados.
- Controles visíveis de **Versões / Enviar revisão** saíram da operação do FORMA; infraestrutura de histórico permanece no backend.
- Painel de **Integrações** removido da interface.
- Remove.bg deixou de usar chave no navegador/localStorage e passa por endpoint autenticado com secret `REMOVEBG_API_KEY`.
- GIPHY continua pelo backend e não exibe chave/configuração na interface.

# RONDA ONE Cloud v0.9.7.4.3 — Terminal Carousel Completion

## 0.9.7.4.3

- Corrigida corrida entre geração principal, retry e fallback determinístico.
- Adicionados `production_stage_leases` para deduplicar execução por estágio.
- `ready` não pode mais ser sobrescrito por erro tardio de outra tentativa.
- IA que falha após Evidence Pack dispara fallback determinístico automaticamente.
- Recuperação de job falho com Evidence Pack acontece sem exigir recriação da produção.
- Polling do FORMA deixou de abrir novas gerações concorrentes.
- Deadline visual alinhado ao deadline do backend.

# RONDA ONE Cloud v0.9.7.4.2 — Retry UX + Same Job Recovery

## 0.9.7.4.2 — recuperação explícita no FORMA

- adiciona botão **Tentar novamente** quando uma produção falha ou excede o Fast Path;
- retry reutiliza o mesmo `production_job`;
- quando existe Evidence Pack, retoma da geração e não relê a matéria;
- quando a falha ocorreu na leitura, relê no mesmo job;
- retry usa execução direta assíncrona, mantendo Queues como proteção e não como espera obrigatória;
- botão desaparece após sucesso ou ao limpar a produção;
- status informa se a recuperação retomará leitura ou geração.

# RONDA ONE Cloud v0.9.7.4.2 — Consistency + Async Fast Path

## 0.9.7.4.2 — Snapshot Continuity + No-503 Production

- O FORMA não mantém scraping/IA dentro do request POST: cria o job e inicia o Fast Path direto via `waitUntil`, retornando `202` rapidamente.
- Requisições transitórias `502/503/504` recebem uma reconexão curta no cliente; o backend reaproveita um job ativo equivalente para não duplicar processamento.
- Fontes adiadas sem snapshot utilizável deixam de ser silenciosamente omitidas: são coletadas imediatamente.
- Fontes adiadas com snapshot no `source_state` ou na ronda anterior permanecem visíveis até a atualização, evitando a ronda encolher para 1–3 fontes.
- “Desde a última ronda” agora consulta mudanças realmente posteriores à última ronda editorial concluída, em vez de usar uma janela fixa de 8 horas.
- Preserva v0.9.7.4 Performance Engine, Fast Ronda 25+, RSS-first, Single Source, Content First, PT-BR, Multi-AI, Quality Gate, No-Hang, créditos e templates.

## 0.9.7.4 — Fast Ronda 25+

- mantém as 39 fontes e eleva a concorrência controlada da coleta completa para até 14;
- RSS suficiente encerra a fonte sem scraper HTML redundante;
- timeout de primeira passada reduzido;
- preview de ronda em D1 (`latest_round_preview`) publicado ao atingir 25+ fontes disponíveis e mínimo de respostas frescas;
- `/api/latest` pode servir a prévia enquanto a mesma ronda ainda finaliza;
- a ronda final substitui e limpa a prévia automaticamente;
- parâmetros `ROUND_EARLY_SOURCE_TARGET` e `ROUND_EARLY_FRESH_MINIMUM`.

## 0.9.7.3 — Interactive Fast Path

- produção manual tenta leitura + Evidence Pack + geração diretamente na requisição, sem Queue como caminho obrigatório;
- deadline interativo padrão de 12 s, com continuação do mesmo job em background quando necessário;
- geração direta a partir de Evidence Pack, sem parsing sintético intermediário;
- prompt compacto com até 18 evidências;
- tradução evidence-first para conteúdo estrangeiro;
- IA secundária somente quando a principal falha ou é rejeitada pelo Quality Gate;
- polling visível pós-Fast-Path reduzido para 20 s;
- Queues dedicadas permanecem como recovery/automação, sem regressão de confiabilidade.

# RONDA ONE Cloud v0.9.7.2.2 — No-Hang Production

- Remove o polling de 8 minutos do FORMA; deadline visual passa a 55 s.
- Recuperação automática quando leitura ou IA ficam sem progresso.
- Após 32 s com Evidence Pack pronto, o FORMA aciona fallback determinístico seguro.
- Backend também detecta jobs parados ao consultar o status e tenta recuperar sem duplicar o conteúdo final.
- Leitura interativa usa deadlines menores (6–7 s por fonte) e mantém uma única fonte backup.
- Production Engine usa `fast-failover`: se o Quality Gate passar, não executa uma revisão extra da mesma IA.
- Primeiro resultado pronto vence; recuperações concorrentes não sobrescrevem um carrossel já concluído.

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
