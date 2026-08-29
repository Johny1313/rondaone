# RONDA ONE Cloud v0.9.2 — Mesa Operacional

A v0.9.2 parte integralmente da v0.9.1 e transforma a Mesa Editorial em uma camada mais operacional para redação, sem alterar o desenho de coleta rápida, a unificação da página principal ou a recuperação de carrossel.

## O que muda na Mesa

- **Ação editorial separada do status do fato**: `PAUTAR AGORA`, `ACOMPANHAR`, `VALIDAR` ou `OBSERVAR`.
- **Qualidade da apuração visível**: `AMPLA`, `PARCIAL` ou `LIMITADA`, com score e motivos.
- **Saúde das fontes dentro da Mesa**: quantidade saudável, com conteúdo, em atenção e falhando; o painel usa o diagnóstico persistido de `/api/sources/diagnostics`.
- **Histórico operacional do evento**: combina detecção, publicações e atualizações significativas em uma linha do tempo única.
- **Apuração a um clique**: os cards possuem atalho direto para a melhor fonte disponível e cada matéria mantém seu link original no detalhe.
- **Compatibilidade com eventos antigos**: eventos salvos antes da v0.9.2 recebem decisão editorial e qualidade de apuração ao serem lidos, sem migração obrigatória do D1.

## Base preservada da v0.9.1

- Fast Lane a cada 1 minuto e ronda completa a cada 3 minutos.
- RSS + scraping HTML leve + fallback por domínio + cache.
- `firstSeenAt` / `radarAt` para filtros curtos.
- Mesa e coleta principal unificadas.
- Queue única para geração de carrossel, heartbeat e recuperação de jobs órfãos.
- Smart Templates, Direct Article, Access & Stability e Reliability 90.

## Estrutura do repositório

```text
public/       interface e assets
src/          Worker, coleta, eventos, IA e serviços
scripts/      testes de regressão + teste da versão atual
docs/         deploy, changelog e auditoria de limpeza
package.json  comandos de validação e deploy
wrangler.jsonc configuração Cloudflare
```

## Validação

```bash
npm install
npm run test:all
```

`test:all` executa verificação de sintaxe, regressão desde a base v0.8.0 e a verificação estrutural da versão atual.

## Deploy

Consulte [`docs/DEPLOY.md`](docs/DEPLOY.md). Para a auditoria de limpeza do GitHub, consulte [`docs/GITHUB-CLEANUP.md`](docs/GITHUB-CLEANUP.md).
