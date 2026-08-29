# RONDA ONE Cloud v0.9.7 — Unified FORMA Production + Scraping Evidence Engine

A v0.9.7 é cumulativa: inclui integralmente a **v0.9.6 — Unified FORMA Production Engine** e acrescenta a **v0.9.7 — Scraping + Evidence Engine**.

A divisão operacional passa a ser explícita:

```text
RONDA
  descoberta · agrupamento · confirmação · inteligência editorial
        ↓
FORMA DESIGN
  leitura · evidências · Multi-AI · carrossel · imagem · template · revisão
```

A RONDA não é mais o ponto principal de geração. Nos cards, a ação passa a ser **Produzir no FORMA →**. Pautas da RONDA, eventos da Mesa, links externos e texto próprio entram no mesmo Production Engine.

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
- Smart Template Engine atualizado para **1.2.0**;
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
