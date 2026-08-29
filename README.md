# RONDA ONE Cloud v0.9.5 — Workflow + Multi-AI + Reliability Operations

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
