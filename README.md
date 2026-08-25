# RONDA ONE 0.7.2 — Stability First

RONDA ONE reúne monitoramento editorial, produção de carrossel, Ronda Design, IA e projetos em uma única plataforma modular.

## Prioridade desta versão
**Estabilidade operacional.** O módulo YouTube foi removido do runtime, da interface, dos endpoints e do agendamento. A coleta principal fica concentrada em portais, termos monitorados, leitura inteligente e fluxo Ronda → Design.

## Módulos
- **Ronda Editorial 2.8.5 core** — monitoramento de portais, origem verificada, leitura inteligente, termos, histórico e Mesa.
- **Ronda Design** — carrosséis em pranchetas/camadas editáveis.
- **Ronda AI** — análise visual e geração de fundo via Workers AI em modo free-only.
- **Projects** — núcleo compartilhado via D1.

## Rotas
- `/ronda` — Editorial
- `/design/` — Design
- `/projects/` — Projetos
- `/api/ai/*` — IA
- `/api/projects/*` — Project Core
- `/ronda/api/*` — API editorial

## Estabilidade
- cron principal: 5 minutos
- nenhuma coleta do YouTube
- nenhum `YOUTUBE_DB`, `YOUTUBE_API_KEY` ou `YOUTUBE_JOBS_QUEUE` necessário
- health não depende de recursos opcionais
- falha da IA não bloqueia o editor
- D1 principal continua sendo `DB`

## Banco existente
Tabelas antigas do YouTube que já existam no D1 podem permanecer inertes. A 0.7.2 não as consulta, não grava nelas e não exige migração destrutiva. Isso reduz risco durante a atualização.
