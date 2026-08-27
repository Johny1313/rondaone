# RONDA ONE v0.8.0 — Mapa de implementação

## Implementado nesta versão

- Pipeline não bloqueante: coleta → agrupamento → eventos → enriquecimento em fila.
- Evento Editorial persistente no D1.
- Agrupamento contextual leve por títulos, contexto, entidades e tempo.
- Leitura de uma matéria por job, com status complete/partial/failed.
- Reaproveitamento de leituras concluídas e limites de retry.
- Classificação detalhada: editoria, subeditoria, tema e entidades.
- Fontes classificadas como oficial, primária, confirmação, repercussão, análise ou opinião.
- Informação nova incremental.
- Timeline significativa.
- Divergências numéricas conservadoras.
- Nível de confirmação com motivos objetivos.
- Relevância 0–100 e tração separada.
- Radar de aceleração.
- Status editorial automático.
- Pontos em aberto e sugestões de pauta.
- Resumo editorial estruturado.
- Mesa orientada por eventos.
- Detalhe do evento com fontes, URLs e leituras.
- “Desde a última ronda”.
- Alertas editoriais.
- Histórico de eventos: hoje, 24h, 7d, 30d, personalizado, status, editoria, fonte, termo, relevância e tração.
- Produção: resumo, título, subtítulo, breaking, social, carrossel, roteiro, timeline e Q&A.
- Carrossel com rastreabilidade e sem fatos não suportados.
- Imagens da matéria preservadas na leitura.
- FORMA DESIGN continua sem geração de imagem por IA.
- Compatibilidade com D1 e Queues já existentes.
- 3 rodadas automatizadas de testes.

## Decisões de arquitetura

A nova inteligência de eventos é majoritariamente determinística e incremental. Isso reduz custo, evita contaminar fatos entre matérias e mantém o caminho da coleta rápido.

A `INTELLIGENT_JOBS_QUEUE` existente também recebe mensagens `event-enrich`; o roteador separa essas mensagens pelo campo `type`, evitando criar uma Queue obrigatória nova.

Workers AI continua disponível apenas para funcionalidades editoriais legadas compatíveis. A nova camada de Evento Editorial e a coleta não dependem de IA generativa para concluir.

## Validação que depende do deploy real

Os testes locais não substituem uma validação operacional no Cloudflare. Após o deploy, conferir:

1. criação/migração das tabelas D1;
2. consumo real da Queue;
3. comportamento de leitura nos 39 portais;
4. latência por ronda;
5. estabilidade por várias horas;
6. agrupamento de acontecimentos reais ao longo de múltiplas rondas.
