# RONDA ONE Cloud v0.9.7.5 — Produção leve + Adaptive Retry

Build consolidada sobre a 0.9.7.4.12 com duas correções principais: retry adaptativo sem repetição cega e separação completa entre gerenciamento de produção e pipeline editorial.

## Produção leve
- nova aba **Produção**: Produção → Aprovação → Finalização → Concluído;
- serve somente para mover/indicar status das tarefas;
- não executa scraping, diagnóstico de fontes, Evidence Pack, IA ou geração;
- tarefas vindas da Ronda entram em Produção ao serem enviadas ao FORMA;
- tarefas geradas diretamente no FORMA também entram em Produção;
- cards exibem título, responsável/quem gerou e comentários;
- comentários não disparam processamento editorial;
- download final conclui a tarefa.

## Qualidade de leitura restaurada
- pautas da Ronda voltam ao pipeline completo `topic → scraping → Evidence Pack → geração`;
- o gerenciamento da Produção não fornece conteúdo substituto para a leitura;
- núcleos `scraper`, `collector`, `article-reader` e `production/scraping-engine` são idênticos aos da 0.9.7.4.12.

## Retry adaptativo
- preserva o mesmo job e o Evidence Pack válido;
- cada retry muda de estratégia em vez de repetir cegamente a rota que falhou.

# RONDA ONE Cloud v0.9.7.4.12 — Newsroom Operating System Hardening

Build consolidada para quem não baixou as duas versões anteriores. Inclui integralmente **v0.9.7.4.10 (FORMA Download Flex + All Slides)** e **v0.9.7.4.11 (Newsroom Operating System · Phase 1)**, mais a camada de hardening de performance e estabilidade.

## Incluído nesta build
- download de carrossel sem obrigatoriedade de revisão;
- download de todos os slides;
- Kanban editorial, trava de dupla produção e histórico operacional;
- Principal/Novidades/Mesa sobre a mesma base;
- evolução do mesmo evento;
- scheduler adaptativo, saúde e cobertura das fontes;
- handoff profundo Ronda → FORMA e retorno FORMA → Ronda com projeto/preview;
- redução de renderizações e requisições redundantes;
- redução de gravações redundantes no D1;
- preview FORMA mais leve e sincronização deduplicada.

# RONDA ONE Cloud v0.9.7.4.11 — Newsroom Operating System · Phase 1

Atualização incremental sobre a v0.9.7.4.10, preservando HOTFIX LOCK, scraping híbrido, Evidence Pack, filas e integração FORMA.

## Prioridades implementadas
- Mesa em **Kanban editorial**: Disponível → Em produção → FORMA → Revisão → Concluído, com drag-and-drop;
- **trava de produção** no backend para evitar duas pessoas assumindo a mesma pauta;
- Principal, Novidades e Mesa mantidas como visões da **mesma base editorial**;
- **Evolução do evento** consolidada em timeline;
- scheduler de fontes passa a adaptar a próxima leitura conforme volume e cobertura;
- saúde das fontes e **captado/meta 1h** visíveis na Mesa;
- handoff Ronda → FORMA leva snapshot editorial, fontes e evolução do evento;
- retorno FORMA → Ronda grava projeto, preview e permite reabrir a arte diretamente pela pauta.

# RONDA ONE Cloud v0.9.7.4.10 — FORMA Download Flex + All Slides

Atualização incremental sobre a v0.9.7.4.9. Não redesenha interface, não troca a arquitetura editorial e não remove cache, fallback, filas, scraping híbrido, Browser Run, Evidence Pack ou mecanismos de recuperação.

## Objetivo

Liberar a exportação operacional do FORMA sem depender da etapa de revisão e acelerar a saída de carrosséis completos.

## FORMA Download Flex
- permite baixar o slide atual mesmo quando o carrossel não foi enviado para revisão;
- adiciona botão dedicado para **baixar todos os slides** do projeto em sequência com um único clique;
- mantém a revisão como etapa opcional do fluxo, sem bloquear a exportação da arte;
- ao exportar um conteúdo ligado à Mesa, tenta concluir a pauta automaticamente sem impedir o download caso o registro editorial falhe.

## Compatibilidade
- mantém a rastreabilidade da Mesa editorial da v0.9.7.4.9;
- mantém o HOTFIX LOCK v0.9.7.4.8, circuit breaker, SWR, Browser Run limitado e descoberta de alto volume sem reescrita arquitetural.

# RONDA ONE Cloud v0.9.7.4.9 — Editorial Desk Tracking + Main/Novidades

Atualização incremental sobre a v0.9.7.4.7. Não redesenha interface, não troca a arquitetura editorial e não remove cache, fallback, filas, scraping híbrido, Browser Run, Evidence Pack ou mecanismos de recuperação.

## Objetivo

Fechar os requisitos operacionais do HOTFIX LOCK:

- Circuit Breaker formal por fonte: `CLOSED → OPEN → HALF_OPEN`;
- Stale-While-Revalidate: cache válido é servido imediatamente e a revalidação ocorre fora do caminho crítico;
- budgets progressivos por rota e troca adaptativa de método;
- HTTP `403`, `404`, `525` e timeout com políticas distintas;
- `/api/platform/status` leve e operacional, sem iniciar scraping/coleta;
- estado de D1, scheduler, filas, cobertura e jobs presos no status;
- observabilidade por fonte com `circuitState`, `servedFrom`, `revalidationPending`, `nextRetryAt`, `preferredRoute` e `lastRouteTried`;
- revalidação de fonte via `ROUND_JOBS_QUEUE`, com retry limitado;
- Browser Run apenas como recuperação controlada, com concorrência limitada;
- continuidade da Ronda mesmo com fontes degradadas.

## Fluxo de fonte degradada

```text
fonte falha
↓
cache válido?
├─ sim → serve imediatamente na ronda
│        ↓
│      source-revalidate na ROUND queue
│        ↓
│      tentativa controlada
│
└─ não → rota adaptativa / fallback

3 falhas consecutivas
↓
OPEN
↓ cooldown
HALF_OPEN (uma tentativa)
├─ sucesso → CLOSED / failureCount=0
└─ falha   → OPEN novamente
```

## Platform Status

`GET /api/platform/status` consolida apenas estado já persistido e bindings. Não inicia ronda, Browser Run, scraping ou geração.

Campos principais:

```text
database
schedulerHealthy
lastSuccessAt
queues.ROUND
queues.INTELLIGENT
sources.total
sources.healthy
sources.degraded
sources.unavailable
sources.cacheOnly
sources.coveragePercent
jobs.intelligentStuck
jobs.productionStuck
```

## Validação

Teste local específico:

```bash
npm run test:09748
```

Validação completa:

```bash
npm run test:all
```

Após o deploy, execute três ciclos reais no ambiente Cloudflare:

```bash
BASE_URL=https://SEU-WORKER npm run validate:prod
```

A certificação de produção do HOTFIX LOCK só deve ser considerada concluída após esses três ciclos remotos.

## Não regressão

Preservados: High-Volume Source Discovery, Hybrid Multi-Transport Reader, Browser Run, Fast Ronda 25+, Adaptive Scraping, Evidence Sufficiency, Single Source + 1 backup, PT-BR, Multi-AI, Quality Gate, Content First, Mandatory Slide Count, Retry Same Job, Terminal Completion, Projects, Content Lock e segurança das integrações.

---

# RONDA ONE Cloud v0.9.7.4.6 — Hybrid Multi-Transport Reader

A v0.9.7.4.6 combina a tolerância de aquisição das versões que retornavam mais conteúdo com o controle editorial consolidado nas versões atuais. A regra é: **tentar vários transportes para a mesma fonte antes de trocar de publisher**.

## Fluxo híbrido

```text
Evidence Pack / cache
        ↓
fetch direto
        ↓ falhou ou insuficiente
Browser Run na mesma URL
        ↓ falhou ou insuficiente
snapshot / RSS já capturado
        ↓ insuficiente
única fonte backup (pauta RONDA)
        ↓
Evidence Pack → PT-BR → Multi-AI → Quality Gate → FORMA
```

### O que foi acrescentado

- binding `BROWSER` do Cloudflare Browser Run usando `quickAction("content")`;
- Browser Run bloqueia imagens, mídia, fontes e CSS durante a leitura para reduzir tempo de renderização;
- o Browser Run nunca tenta contornar paywall, CAPTCHA ou autenticação;
- `production_transport_stats` aprende a taxa de sucesso por domínio;
- domínios com histórico ruim no fetch direto e bom no navegador passam para `browser-first`;
- a fonte backup editorial só é aberta depois que os transportes da fonte principal falham;
- adapter específico da Band (`band.com.br`);
- a rota vencedora (`cache`, `direct`, `browser` ou `snapshot`) fica registrada no Evidence Pack;
- não há retorno ao comportamento antigo de abrir múltiplos publishers em paralelo.

### Garantias preservadas

Single Source + um backup, escolha obrigatória de slides, Content First, PT-BR, Evidence Pack, créditos de imagem, Multi-AI, Quality Gate, Confidence Score, Content Lock, Projects, Retry Same Job, Terminal Completion, No-Hang e Fast Ronda 25+ continuam ativos.

## Browser Run

O `wrangler.jsonc` já contém:

```json
"browser": { "binding": "BROWSER" }
```

Não é necessário colocar token de Browser Run no frontend. O Worker usa o binding autenticado da Cloudflare. Para desenvolvimento local com Quick Actions, use ambiente remoto da Cloudflare quando necessário.

---

# RONDA ONE Cloud v0.9.7.4.5 — Adaptive Scraping + Evidence Sufficiency

A v0.9.7.4.5 é cumulativa sobre a v0.9.7.4.4 e ataca o principal gargalo observado no FORMA: matérias que ficavam presas em **Leitura** e exigiam múltiplas tentativas manuais. A primeira produção agora percorre uma escada adaptativa de leitura e muda de rota automaticamente.

## Leitura adaptativa

```text
Evidence/cache existente
        ↓
JSON-LD / NewsArticle
        ↓
Adapter do portal
        ↓
HTML genérico
        ↓
AMP somente se necessário
        ↓
1 fonte backup (pautas da Ronda)
        ↓
Fallback parcial seguro
```

O leitor para assim que o **Evidence Sufficiency Gate** identifica evidências distintas suficientes para a quantidade de slides pedida. Isso evita esperar uma matéria maior, abrir AMP ou repetir o mesmo parser apenas para elevar a contagem de palavras.

## Performance

- streaming do HTML com early-stop quando as evidências já bastam;
- teto de leitura do HTML reduzido de 4,5 MB para 2,5 MB;
- adapters conhecidos e JSON-LD vêm antes do parser genérico;
- schema D1 do Production Engine é inicializado uma vez por isolate, em vez de repetir DDL em cada evento do job;
- falhas registram as rotas tentadas para distinguir timeout, ausência de JSON-LD, adapter insuficiente e ausência de snapshot.

## Política de retry

O botão **Tentar novamente** continua no FORMA, mas não substitui a escada automática. Quando usado, o mesmo `jobId` é mantido e a recuperação pode reaproveitar cache/snapshot e Evidence Pack existente.

# RONDA ONE Cloud v0.9.7.4.2 — Retry UX + Same Job Recovery

A v0.9.7.4.2 é cumulativa e preserva toda a linha anterior. Além da consistência de snapshots e do Fast Path assíncrono, o FORMA agora oferece recuperação explícita: quando uma produção falha ou excede o Fast Path, o operador pode **Tentar novamente** e retomar o mesmo job, reaproveitando o Evidence Pack quando ele já existe.


## v0.9.7.4.2 — Retry UX + Same Job Recovery

- POST de produção retorna rapidamente e o processamento direto continua com `waitUntil`; Queue continua como recovery.
- Retry curto de transporte para 502/503/504 sem duplicação: jobs ativos equivalentes são reaproveitados.
- Snapshot continuity: fonte não-due usa `source_state` ou ronda anterior; se não existir snapshot, ela vira due imediatamente.
- “Desde a última ronda” usa o timestamp da última ronda editorial concluída.
- botão **Tentar novamente** aparece quando há um job preservado;
- retry mantém o mesmo `jobId` e o histórico de diagnóstico;
- se o Evidence Pack existe, retoma diretamente da geração;
- se a falha ocorreu antes das evidências, relê a fonte no mesmo job;
- retry usa o Fast Path direto assíncrono e não obriga espera de Queue.

## v0.9.7.4 — Fast Ronda 25+

- mantém as 39 fontes cadastradas;
- coleta completa sobe para concorrência controlada de até 14 fontes;
- RSS saudável com volume suficiente encerra a fonte sem obrigar uma segunda consulta HTML;
- timeout da primeira passada é reduzido para 4,5 s por rota;
- quando há **25+ fontes disponíveis** e pelo menos 8 respostas frescas na rodada, uma prévia é publicada imediatamente;
- a prévia em produção mantém somente conteúdo seguro em PT-BR;
- a coleta continua e substitui a prévia pela ronda final quando terminar;
- a última ronda final continua preservada se a coleta em andamento falhar;
- `ROUND_EARLY_SOURCE_TARGET` permite alterar a meta (padrão 25);
- `ROUND_EARLY_FRESH_MINIMUM` controla o mínimo de respostas frescas antes da prévia (padrão 8).

## v0.9.7.3 — Interactive Fast Path

Para ações manuais no FORMA, Queue deixa de ser caminho obrigatório. O fluxo principal é:

```text
usuário confirma nº de slides
        ↓
leitura direta / cache
        ↓
Evidence Pack
        ↓
IA principal
        ↓
Quality Gate
        ↓
carrossel neutro
```

- `POST /api/production/jobs` tenta concluir diretamente na própria interação por até 12 s;
- se não concluir nesse intervalo, o mesmo job continua em background e o FORMA acompanha sem criar outro;
- ARTICLE_READ_QUEUE e CAROUSEL_AI_QUEUE continuam disponíveis para recovery e automações;
- o carrossel é gerado diretamente do Evidence Pack, sem reconstruir HTML sintético nem reler a matéria;
- prompt usa somente as evidências necessárias, limitado a aproximadamente 18 itens;
- IA secundária só entra quando a principal não passa no Quality Gate;
- matérias estrangeiras usam tradução **evidence-first**: título, subtítulo e evidências necessárias são traduzidos, sem traduzir 20 mil caracteres antes de começar;
- o texto original continua preservado para auditoria;
- deadline visível pós-Fast-Path foi reduzido para 20 s; o sistema não volta ao comportamento de espera de minutos.

### Metas de engenharia

- produção nova típica: **5–12 s** quando portal e Workers AI respondem normalmente;
- cache/Evidence Pack: caminho ainda mais curto;
- Ronda: primeira visão útil com **25+ fontes** antes da conclusão das 39, sempre que a disponibilidade real permitir.

A divisão operacional passa a ser explícita:

```text
RONDA
  descoberta · agrupamento · confirmação · inteligência editorial
        ↓
FORMA DESIGN
  leitura · evidências · Multi-AI · carrossel · imagem · template · revisão
```

A RONDA não é mais o ponto principal de geração. Nos cards, a ação passa a ser **Produzir no FORMA →**. Pautas da RONDA, eventos da Mesa, links externos e texto próprio entram no mesmo Production Engine.


## v0.9.7.2.2 — No-Hang Production

- remove o antigo polling de minutos e aplica recuperação automática por etapa;
- fallback determinístico continua disponível quando o Evidence Pack já existe;
- jobs parados são recuperados pelo backend sem duplicar a produção;
- a v0.9.7.4 reduz ainda mais esses limites: 12 s de Fast Path + até 20 s de acompanhamento visível.

## v0.9.7.2.1 — Mandatory Slide Count

Antes de uma produção nova começar, o FORMA pergunta obrigatoriamente **quantos slides terá o carrossel**. A confirmação acontece antes de scraping, leitura, Evidence Pack ou Multi-AI.

- presets rápidos: 3, 5, 7 e 10 slides;
- quantidade personalizada entre 3 e 15;
- vale para pauta da RONDA/Mesa, link externo e texto próprio;
- o backend rejeita produção sem `slideCount`;
- cancelar a escolha não cria job e não dispara leitura/IA;
- trocar template ou editar um carrossel já pronto não pergunta novamente.

## v0.9.7.2 — Single Source + Content First

- o conteúdo do carrossel é gerado primeiro em um layout editorial neutro;
- templates não participam da leitura nem da Multi-AI e podem ser aplicados/trocados depois sem nova geração;
- pautas escolhem uma fonte principal por score e usam somente uma fonte backup se a principal falhar;
- não há leitura paralela de vários publishers para a mesma produção;
- matérias em inglês ou espanhol são normalizadas para pt-BR antes da criação do Evidence Pack quando Workers AI está disponível;
- a IA de redação recebe regra estrutural de saída em pt-BR;
- o FORMA mostra fonte principal/backup, URL efetivamente lida e tempos de leitura, tradução, IA e total;
- carrossel pronto continua independente de falhas ou exclusão de templates.

## v0.9.7.1 — geração mais ágil e auditável

A produção agora tenta o caminho mais curto seguro antes de executar uma leitura externa completa:

```text
mesma entrada + mesmo estilo + resultado recente
        ↓
reutiliza carrossel pronto

sem resultado pronto, mas Evidence Pack recente
        ↓
pula a leitura e vai direto para Multi-AI

sem Evidence Pack
        ↓
scraping/leitura → evidências → Multi-AI
```

Para evitar conteúdo editorial obsoleto, pautas da RONDA usam fingerprint do conteúdo: mudança de fonte, título, atualização ou texto invalida o resultado reutilizável. Para URLs externas, o cache rápido é curto e o operador pode marcar **Releitura completa** para obrigar nova leitura.

### Fonte realmente utilizada

Ao concluir a geração, o FORMA mostra o link efetivamente usado na leitura, o portal, a qualidade e o método de extração. Isso facilita abrir a matéria original e conferir a apuração.

### Crédito das imagens

O Evidence Engine passa a preservar, quando disponíveis no HTML/JSON-LD da matéria:

- fotógrafo/autor da foto;
- crédito/agência/copyright;
- portal de origem;
- URL da matéria associada.

O FORMA exibe essas informações junto das imagens recuperadas. Se o portal não publicar autoria, o sistema informa que o crédito autoral não foi fornecido, em vez de inventar um nome.

### Templates

Cada template salvo possui ação **Apagar template**. A exclusão remove o modelo da biblioteca local, mas não apaga nem altera a composição já aberta no FORMA.

### Otimização do scraping

- conteúdo completo já coletado pela RONDA pode ser reutilizado antes de novo `fetch()`;
- URLs equivalentes com `utm_*`, `fbclid`, `gclid` e outros parâmetros de tracking compartilham a mesma identidade de leitura;
- pautas com várias fontes testam as duas fontes mais promissoras em paralelo;
- uma segunda onda só é aberta quando a primeira não alcança qualidade suficiente;
- adapters, JSON-LD, parser genérico, AMP e fallback continuam disponíveis;
- Quality Gate e Multi-AI não foram removidos para ganhar velocidade.

Os tempos de cache rápido são conservadores por padrão: aproximadamente 30 min para resultado pronto de URL, 5 min para pauta/evento, 60 min para Evidence Pack de URL e 10 min para pauta/evento. Todos podem ser invalidados por releitura forçada.

## v0.9.6 — Unified FORMA Production Engine

### Endpoint único de produção

```text
POST /api/production/jobs
GET  /api/production/jobs/:id
POST /api/production/jobs/:id/retry
POST /api/production/image
```

Entradas aceitas:

- `sourceType=url` — matéria externa;
- `sourceType=topic` — pauta da RONDA;
- `sourceType=event` — evento editorial;
- `sourceType=text` — texto próprio.

Toda produção percorre os mesmos estados:

```text
SOURCE
  ↓
READING
  ↓
EVIDENCE
  ↓
GENERATING
  ↓
QUALITY GATE
  ↓
READY / FORMA
```

O FORMA mostra essa progressão ao operador. Se leitura falhar, o erro fica na etapa de leitura; se a IA falhar, o Evidence Pack continua salvo e a geração pode ser repetida sem acessar o portal novamente.

### Separação de Queues

A produção passa a ter filas próprias:

- `ARTICLE_READ_QUEUE` → scraping/leitura;
- `CAROUSEL_AI_QUEUE` → Multi-AI/Quality Gate.

As Queues antigas permanecem para compatibilidade, mas o `wrangler.jsonc` da v0.9.7 já declara as duas filas dedicadas. Crie as filas antes do primeiro deploy desta versão; veja `docs/DEPLOY.md`.

### Persistência do Production Engine

O módulo cria estruturas isoladas do schema principal da RONDA:

- `production_jobs`;
- `evidence_packages`;
- `production_stage_events`;
- `production_state`.

Essa separação é proposital: falha na evolução do Production Engine não deve impedir a coleta da RONDA.

### Imagem no FORMA

A geração de imagem por Workers AI volta como ação **opcional e manual dentro do FORMA** via `/api/production/image`.

Prioridade editorial continua sendo:

1. imagem factual encontrada na matéria;
2. imagens recuperadas pelo Scraping/Evidence Engine;
3. Banco Free / Wikimedia;
4. upload;
5. GIPHY;
6. imagem IA somente quando o operador optar por gerar.

Modelo padrão: `@cf/black-forest-labs/flux-1-schnell`, substituível por `FORMA_IMAGE_MODEL`.

## v0.9.7 — Scraping + Evidence Engine

A leitura deixa de ser apenas um passo interno do carrossel e passa a gerar um artefato persistente: **Evidence Pack**.

Fluxo:

```text
URL / pauta
   ↓
HTML direto
   ↓
parser genérico: JSON-LD / conteúdo semântico / JSON embutido
   ↓
adapter específico do portal, quando disponível
   ↓
AMP
   ↓
conteúdo já coletado pela RONDA
   ↓
Evidence Pack
```

Browser rendering não é executado por padrão. O código possui o ponto de fallback, mas ele só deve ser ativado quando métricas reais mostrarem necessidade. O sistema não tenta contornar login, CAPTCHA ou paywall fechado.

### Adapters iniciais

- G1 + ge;
- CNN Brasil;
- Folha;
- Estadão;
- O Globo;
- Poder360;
- Agência Brasil;
- Metrópoles;
- UOL;
- InfoMoney.

O adapter não substitui o parser genérico: os dois resultados são avaliados e o melhor conteúdo é preservado.

### Evidence Pack

Cada leitura útil persiste, conforme disponibilidade:

- URL original e canônica;
- portal;
- título e subtítulo;
- autor;
- publicação;
- texto principal;
- quantidade de palavras;
- fatos/evidências determinísticas;
- entidades;
- números;
- datas;
- imagens e créditos encontrados;
- método de leitura;
- adapter utilizado;
- qualidade de leitura 0–100;
- tentativas/fallbacks.

A Multi-AI recebe uma cópia sintética construída a partir do Evidence Pack. Portanto, **a IA não precisa reabrir o portal** para gerar ou regerar o carrossel.

### Resultado operacional esperado

A mudança não promete que todos os portais permitirão leitura completa. O ganho estrutural é outro:

- falha de scraping não destrói o restante da produção;
- Evidence Pack bem-sucedido pode ser reutilizado;
- troca de template não relê a matéria;
- regeração Multi-AI não relê a matéria;
- diagnóstico identifica exatamente `reading`, `evidence` ou `generating`;
- pauta da RONDA e link externo usam a mesma esteira.

## v0.9.5.1 — estabilidade da Ronda em produção

Esta revisão separa **Fast Lane** de **Ronda editorial**, remove incidentes técnicos vazios da visão padrão do Histórico e impede dependências auxiliares de abortarem a coleta antes das fontes.

Para a configuração completa de 39 fontes com RSS + HTML + fallback, o perfil recomendado é **Cloudflare Workers Paid**. O Workers Free possui apenas 50 subrequests externos por invocação; o coletor completo trabalha com orçamento interno de até 120. Em Workers Free, configure `ROUND_EXTERNAL_REQUEST_BUDGET=45` e aceite cobertura/fallback reduzidos.

A v0.9.5 consolida, de forma cumulativa, as evoluções **v0.9.4.1 → v0.9.5** sobre a base de Reliability/Production Hardening da v0.9.4.

O objetivo desta linha é simples: aumentar a chance de toda ação editorial terminar com um resultado útil, preservar o trabalho humano e permitir operação profissional em equipe.

## v0.9.4.1 — Multi-AI + Quality Gate + Confidence Score

O carrossel deixa de depender de uma única tentativa de IA.

Fluxo padrão:

```text
Evidências da matéria
  ↓
IA primária
  ↓
Quality Gate
  ├─ aprovado → resultado
  └─ rejeitado/erro → IA secundária
                       ↓
                    Quality Gate
                       ├─ aprovado → resultado
                       └─ falhou → IA terciária opcional
                                      ↓
                                   Quality Gate
                                      └─ falhou → motor determinístico seguro
```

- primária: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`;
- secundária: `@cf/meta/llama-3.1-8b-instruct-fast`;
- terciária: `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b`, opcional;
- modo padrão: **failover**, não execução paralela;
- Quality Gate padrão: **88/100**;
- Confidence Score geral e por slide;
- rastreio `aiTrace` com modelo, papel, duração, resultado e score;
- geração determinística continua sendo o último fallback sem fatos inventados.

A IA redige a partir das evidências já extraídas. O sistema não permite que um modelo acrescente fatos sem suporte na matéria lida.

## v0.9.4.2 — Versionamento + Content Lock no FORMA

- tabela persistente `carousel_versions`;
- botão **Salvar versão** no FORMA;
- visualização/recuperação de versões anteriores;
- cada versão preserva Quality Score e Confidence Score quando disponíveis;
- **Content Lock** por campo semântico: título, corpo ou imagem editados manualmente podem ser travados;
- reaplicar IA/template preserva os campos travados e atualiza somente os demais;
- Smart Template Engine base atualizado para **1.2.0**; na v0.9.7.1 o motor passa a **1.2.1** com metadados de crédito de imagem;
- envio para revisão diretamente do FORMA.

## v0.9.4.3 — Watchdog + Replay + Saúde + Custos

O Admin passa a funcionar também como painel operacional.

- watchdog automático no scheduler;
- alerta de ronda atrasada;
- detecção de jobs sem heartbeat;
- alerta quando várias fontes entram em estado crítico;
- replay automático limitado para falhas transitórias;
- replay manual de carrossel pelo backend;
- `/api/admin/source-health` com score de saúde por fonte;
- `/api/admin/watchdog`;
- `/api/admin/cost-monitor`;
- métricas de chamadas de IA primária/secundária/terciária, failovers, Quality Score e Confidence Score;
- estimativa opcional de custo por chamada via `AI_ESTIMATED_COST_PER_CALL_USD`.

A estimativa interna é indicativa. O faturamento real continua sendo o informado pelo Cloudflare.

## v0.9.5 — Workflow de aprovação e operação multiusuário

Novos papéis editoriais:

- `user` — usuário padrão;
- `editor` — cria, edita, atribui e envia conteúdo para revisão;
- `reviewer` — revisa, aprova ou rejeita;
- `publisher` — revisa, aprova e publica;
- `admin` — mantém os poderes administrativos existentes.

Fluxo:

```text
RASCUNHO
   ↓
EM REVISÃO
  ↙     ↘
REJEITADO  APROVADO
   ↓          ↓
RASCUNHO   PUBLICADO
```

- `production_workflow` mantém o estado atual;
- `production_workflow_events` mantém auditoria das transições;
- dono, responsável e grupo editorial podem ser registrados;
- Admin ganhou aba **Workflow**;
- FORMA pode salvar uma versão e enviá-la para revisão;
- aprovar/publicar é protegido por papel;
- histórico de versões e workflow não sobrescreve o projeto local do operador.

## Correção adicional de confiabilidade

Durante a implementação foi localizado um erro latente nas rotas da Newsroom: duas ações chamavam `readJsonBody()` sem uma implementação local. A função foi adicionada ao runtime, evitando um possível HTTP 500 nessas ações.

## Infraestrutura

A v0.9.5 continua compatível com os bindings atuais:

- `DB` — Cloudflare D1;
- `AI` — Workers AI;
- `ROUND_JOBS_QUEUE`;
- `INTELLIGENT_JOBS_QUEUE`;
- `ASSETS`.

Queues dedicadas continuam opcionais:

- `CAROUSEL_JOBS_QUEUE`;
- `ARTICLE_READ_QUEUE`.

Não existe migração SQL manual obrigatória: novas tabelas são criadas de forma aditiva por `ensureSchema()`.

## Custo e processamento

**Não é obrigatório contratar outro serviço para fazer o deploy da v0.9.5.**

O modo Multi-AI é em cascata: a segunda IA só é usada quando a primeira falha ou não passa no Quality Gate. A terceira IA permanece desativada por padrão e pode ser habilitada com:

```text
CAROUSEL_TERTIARY_AI=1
```

Também é possível substituir modelos por variáveis:

```text
ARTICLE_ANALYSIS_MODEL
ARTICLE_SECONDARY_MODEL
ARTICLE_TERTIARY_MODEL
CAROUSEL_MULTI_AI_MODE
```

Portanto, consumo adicional de Workers AI cresce principalmente conforme a taxa de failover. Recomenda-se medir `/api/admin/cost-monitor?hours=24` e o painel do Cloudflare antes de elevar concorrência ou habilitar a terceira IA permanentemente.

## Testes

```bash
npm install
npm run test:all
```

A regressão cobre desde a v0.8.0 até a v0.9.5, incluindo testes específicos de:

- Reliability Core;
- Production Hardening;
- Chaos local;
- Multi-AI / Quality Gate / Confidence;
- Versionamento / Content Lock;
- Watchdog / Replay / Saúde / Custos;
- Workflow multiusuário.

## Deploy

Consulte `docs/DEPLOY.md`.


## v0.9.7.4.4 — Projetos e superfície operacional

O botão **Salvar projeto** grava o projeto do FORMA no D1 e o item aparece em `/projects/`. Controles de versão/revisão e o painel de integrações não são exibidos no FORMA. Para manter Remove.bg sem expor credenciais no navegador, configure `REMOVEBG_API_KEY` como Cloudflare secret.
