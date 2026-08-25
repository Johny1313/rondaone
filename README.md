# RONDA ONE 0.7.7 — Stability + Navigation

RONDA ONE reúne monitoramento editorial, produção de carrossel, Ronda Design, IA e projetos em uma única plataforma modular.

## Base consolidada

A 0.7.7 consolida a linha já publicada no repositório:

- **0.7.4** — Queue First + Multi Image Engine.
- **0.7.5** — polling resiliente do carrossel + handoff Ronda → Design.
- **0.7.6** — recuperação automática da interface + proteção contra job local stale.
- **0.7.7** — cache bust robusto, navegação/shell idempotente, recuperação ao voltar online/à aba e preservação do status editorial no handoff.

## Módulos

- **Ronda Editorial 2.8.5** — monitoramento de portais, origem verificada, leitura inteligente, termos, histórico e Mesa.
- **Ronda Design** — carrosséis em pranchetas/camadas editáveis e importação do projeto criado na Ronda.
- **Ronda AI** — Workers AI com SDXL Lightning, FLUX.1 Schnell e FLUX.2 Klein 4B.
- **Projects** — núcleo compartilhado via D1, com fallback local no navegador para o handoff.

## Rotas principais

- `/ronda` — Editorial
- `/design/` — Design
- `/projects/` — Projetos
- `/api/platform/status` — estado da plataforma
- `/api/ai/*` — IA
- `/api/projects/*` — Project Core
- `/api/*` — API editorial
- `/ronda/api/*` — compatibilidade com URLs editoriais antigas

## Estabilidade 0.7.7

- cron principal: 5 minutos;
- Queue First preservado;
- aviso do carrossel após 70 s sem tratar o job como falha;
- acompanhamento do job por até 8 minutos;
- tolerância a até 5 erros transitórios consecutivos no polling do navegador;
- job local com mais de 12 minutos é descartado;
- recuperação ao voltar online ou retornar à aba;
- `app.js` e `styles.css` recebem revisão `2.8.5-077`, mesmo quando o HTML original não tem query string;
- botão **RONDA DESIGN** é habilitado quando existem slides, independentemente da aprovação para copiar/publicar;
- `reading`, `facts`, `verificationLinks`, `editorialGate` e `editorialStatus` são preservados no projeto.

## Infraestrutura mantida

A 0.7.7 não altera os nomes dos bindings existentes:

- `AI`
- `DB`
- `ASSETS`
- `ROUND_JOBS_QUEUE`
- `INTELLIGENT_JOBS_QUEUE`

O arquivo `wrangler.jsonc` permanece compatível com o repositório atual.

## Atualização

Este pacote é um **patch cumulativo** para o repositório `rondaone` atual. Copie os arquivos para a raiz do repositório e substitua os caminhos correspondentes. Não apague os arquivos do Ronda Editorial 2.8.5 que não aparecem no pacote.

Depois da cópia, execute:

```bash
npm run verify:077
npm run check
```

Após o deploy, confira `/api/platform/status`, `/ronda`, `/design/` e `/projects/`.

## GitHub verificado

A compatibilidade deste pacote foi conferida contra a branch `main` do repositório `Johny1313/rondaone`, no estado do commit `5167355d53ce9bbffa9bbd82a9b9b9094c68633d`, em 25/08/2026.
