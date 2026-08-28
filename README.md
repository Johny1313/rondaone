## v0.8.5.2 — UI + Source Sync

- Produção usa pipeline Workers Paid completo, não 1 fonte por ciclo.
- UI força a última ronda no login e reconexão.
- Backoffs legados são limitados.
- Tradução é separada da saúde operacional da fonte.

# RONDA ONE Cloud v0.8.4 — Login First + Perfil de Referências + Admin Dashboard

A v0.8.4 preserva Source Recovery, Access & Stability, Mesa Editorial e Carousel Stability, e reorganiza autenticação, perfil e administração.

## Acesso

O primeiro passo é sempre informar o e-mail. O sistema identifica se é login ou primeiro acesso e só então mostra a senha. Usuários não autenticados são redirecionados para a entrada antes de Ronda, Design, Projetos ou Admin.

A senha do administrador não fica no repositório: o primeiro acesso/recuperação usa o secret `ADMIN_BOOTSTRAP_PASSWORD` do Cloudflare.

## Perfil editorial

O Perfil deixa de ser a tela de login e passa a ser a biblioteca de referências da linguagem da IA:

- textos;
- imagens por link + descrição;
- arquivos, com leitura local de formatos textuais e cadastro de metadados/link para os demais;
- vídeos por link + descrição/transcrição;
- guia de linguagem recalculável;
- troca de senha.

Para preservar estabilidade e custo, imagens/vídeos/binários pesados não são gravados no D1. Como o objetivo desta camada é aprimorar a linguagem, a IA utiliza conteúdo textual, descrições, transcrições e observações.

## Administração

O Admin passa a ter três abas separadas: Dashboard, Usuários e Grupos. O Dashboard concentra métricas de produção, saúde e navegação por Ronda, Design, Projetos e Admin.


Versão completa do **RONDA ONE** para Cloudflare Workers, evoluindo a plataforma de agregador de notícias para uma **Mesa Editorial orientada por eventos**, sem sacrificar a prioridade de estabilidade, velocidade e coleta contínua.

## v0.8.3 — Carousel Stability

A geração de carrossel agora limita a concorrência pesada a 2 jobs simultâneos, aceita até 5 tentativas de Queue, diferencia espera em fila de execução travada, protege estados terminais e recupera resultados já salvos sem repetir leitura/IA. O polling do navegador também ficou adaptativo e tolerante a oscilações de rede.

## v0.8.2 — Access & Stability

A v0.8.2 adiciona controle de acesso para operação em equipe sem transformar o RONDA ONE em uma aplicação de telemetria pesada.

- até 10 usuários ativos únicos simultaneamente;
- administrador fora da contagem;
- idle logout em 60 minutos;
- presença consolidada a cada 5 minutos apenas quando houve interação;
- dashboard administrativo;
- grupos de edição;
- métricas agregadas de uso, produção e estabilidade;
- sem registro de mousemove/clique individual;
- dados administrativos protegidos no backend.

## Base preservada — Source Recovery v0.8.1

- Cron a cada **3 minutos**.
- Fontes prioritárias: **3 minutos**.
- Demais fontes saudáveis: **máximo 5 minutos**.
- Última rota funcional consultada primeiro.
- `304 Not Modified` é fonte saudável.
- Feed acessível sem publicação nova é `no-new`, não `failed`.
- Backoffs de 30/60/360 minutos deixam de congelar a fonte inteira.
- Estado antigo com `nextCheckAt` distante é recuperado automaticamente.
- Fallback dedicado continua ativo por domínio.

## Conceito central

A aplicação passa a trabalhar com este fluxo editorial:

```text
COLETA
  ↓
NORMALIZAÇÃO
  ↓
DEDUPLICAÇÃO / AGRUPAMENTO
  ↓
EVENTO EDITORIAL
  ↓
LEITURA DA MATÉRIA
  ↓
EVIDÊNCIAS E ENRIQUECIMENTO
  ↓
INFORMAÇÃO NOVA / DIVERGÊNCIAS
  ↓
RELEVÂNCIA / TRAÇÃO / CONFIRMAÇÃO
  ↓
MESA EDITORIAL
  ↓
PRODUÇÃO / CARROSSEL
```

A coleta continua desacoplada do processamento mais pesado. Falha de leitura ou de enriquecimento **não bloqueia uma nova ronda**.

## 1. Coleta e descoberta

A base da v0.7.9 foi preservada:

- 39 fontes cadastradas: 26 Brasil e 13 Mundo;
- budget de até 120 consultas externas por ronda;
- fallback dedicado por domínio;
- concorrência de coleta 8;
- complemento de feeds esparsos;
- até 900 itens no snapshot;
- até 80 assuntos;
- busca ampliada em `/api/search-news`;
- Cron Cloudflare a cada 3 minutos.

## 2. Evento Editorial

A v0.8.0 cria a entidade persistente **EVENTO EDITORIAL** no D1.

Cada evento mantém, conforme dados disponíveis:

- `eventId` persistente;
- título;
- editoria e subeditoria;
- tema;
- entidades relacionadas;
- fontes e matérias;
- primeira e última publicação;
- status editorial;
- relevância 0–100;
- tração e crescimento;
- nível de confirmação e motivos;
- divergências detectadas;
- timeline significativa;
- informações novas;
- pontos em aberto;
- sugestões de pauta;
- resumo editorial estruturado;
- rastreabilidade para as URLs originais.

O sistema tenta manter o mesmo `eventId` entre rondas quando novas matérias pertencem ao mesmo acontecimento.

## 3. Deduplicação e agrupamento

O agrupamento deixa de depender apenas de títulos idênticos. A camada leve de clustering considera:

- tokens normalizados;
- entidades e nomes próprios;
- contexto da descrição;
- aliases editoriais;
- proximidade temporal;
- sobreposição temática.

Isso evita embeddings caros no caminho crítico da coleta e mantém o agrupamento rápido.

## 4. Leitura completa e rastreabilidade

A leitura continua com a política **Carousel First / Source Evidence**:

- tenta chegar à URL original do portal;
- aceita leitura direta ou cache produzido por leitura direta anterior;
- extrai texto principal e imagens encontradas na matéria;
- mantém origem, URL e evidências;
- RSS/agregador pode descobrir a pauta, mas não substitui a matéria para validação factual do carrossel;
- leitura parcial/falha é registrada e não bloqueia o evento nem a ronda.

O enriquecimento trabalha com **uma matéria por mensagem de fila** para reduzir mistura entre conteúdos.

## 5. Processamento incremental

A v0.8.0 reaproveita a Queue inteligente já existente. Não é necessário criar uma nova Queue no Cloudflare.

Mensagens `event-enrich` são separadas das mensagens de carrossel pelo `type` do job.

O processamento:

- limita a quantidade de novas leituras por ronda;
- evita reler URL já concluída quando possível;
- reprocessa jobs antigos somente com limites;
- salva o resultado antes de encerrar;
- continua a ronda mesmo quando um artigo falha.

## 6. Mesa Editorial

A aba **Mesa** passa a priorizar eventos, com filtros para:

- Breaking;
- Em alta;
- Em desenvolvimento;
- Monitorados;
- Brasil;
- Mundo;
- Últimas.

Também mostra:

- **Desde a última ronda**;
- **Assuntos em aceleração**;
- **Alertas editoriais**;
- relevância;
- tração;
- confirmação;
- divergências;
- informação nova.

A operação clássica da Mesa foi preservada e pode ser reexibida pelo botão de compatibilidade.

## 7. Detalhe do evento

Ao abrir um evento, a interface apresenta:

- resumo;
- o que há de novo;
- nível de confirmação e motivos;
- timeline;
- fontes e links originais;
- matérias e status de leitura;
- divergências;
- pontos em aberto;
- sugestões de pauta;
- ações de produção.

## 8. Produção editorial

O endpoint de produção do evento suporta:

- resumo;
- título;
- subtítulo;
- breaking;
- texto social;
- carrossel;
- roteiro;
- timeline;
- perguntas e respostas.

A produção determinística usa apenas fatos/evidências presentes no evento. O carrossel mantém `unsupportedFactsAllowed: false`.

## 9. FORMA / RONDA DESIGN

A geração de imagem por IA continua **desativada** no Design.

Prioridade visual:

1. imagens encontradas na matéria;
2. Banco Free / Wikimedia Commons;
3. upload;
4. GIPHY;
5. composição gráfica.

As rotas públicas de IA do Design continuam retornando `410 DESIGN_AI_REMOVED`.

O binding Workers AI permanece configurado apenas para funcionalidades editoriais legadas compatíveis, como tradução e apoio opcional ao carrossel. A coleta e a nova camada de eventos **não dependem dele para funcionar**.

## 10. Histórico Editorial

O Histórico recebeu uma segunda visão para **Eventos editoriais**, mantendo o histórico de rondas existente.

Filtros disponíveis:

- Hoje;
- 24 horas;
- 7 dias;
- 30 dias;
- intervalo personalizado;
- status;
- busca textual.

A API também aceita filtros por editoria, região, fonte e termo monitorado.

## 11. Banco D1

As tabelas da nova camada são criadas/migradas de forma aditiva:

- `editorial_events`;
- `editorial_event_articles`;
- `editorial_event_updates`.

O banco e as tabelas atuais da Ronda são preservados.

## 12. Cloudflare

A configuração continua usando os recursos existentes:

- Workers;
- D1;
- `ROUND_JOBS_QUEUE`;
- `INTELLIGENT_JOBS_QUEUE`;
- Assets;
- Cron de 5 minutos;
- Observability.

Não há novo binding obrigatório para fazer o deploy da v0.8.0.

## 13. Testes

Antes do deploy execute:

```bash
npm install
npm run check
npm run verify:080
```

`verify:080` executa verificações estruturais e três rodadas automatizadas:

1. **Funcional** — clustering, eventos, evidências e produção;
2. **Editorial** — agrupamento e evolução de um mesmo acontecimento, URLs preservadas e divergência;
3. **Estabilidade** — idempotência, repetição, conteúdo parcial e ausência de loops de processamento.

Depois:

```bash
npm run deploy
```

## 14. Limite da verificação local

Os testes incluídos validam código e comportamento determinístico fora da infraestrutura Cloudflare. A conferência final de D1, Queues, latência e comportamento dos 39 portais deve ser feita após o deploy no ambiente Cloudflare real.
