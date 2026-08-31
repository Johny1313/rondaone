# RONDA ONE v0.9.7.5.10 — Carousel Stability Baseline

## Decisão
A versão 0.9.7.5.6 é adotada como baseline comprovada de estabilidade para geração de carrossel. A 0.9.7.5.10 parte da 0.9.7.5.7, cujo motor de carrossel já era byte a byte idêntico à 5.6, e remove da linha de release as mudanças de coordenação introduzidas em 5.8 e 5.9.

## Componentes congelados
- `src/production/engine.js` — SHA-256 `cabecc5f756746ddbd79a1c6b4d7790d75e68bb58d24010fe72b640d523df651`
- `src/production/scraping-engine.js` — SHA-256 `d5cd2aba4f110ff93f319e0e8f297f51db9478fb1c9dfbb48338cd8c4dc50357`
- `src/ronda/v285/article-reader.js` — SHA-256 `944bff72b03f3c15a10e42a12541aef9af531c676801add27474a3b5165fc722`
- `public/design/index.html` — SHA-256 `1af86252a341dd292218ef21aca97d6623d3a9d96ed6bff478d43b353195b156`

## Coordenação
O cron volta a ser acionado a cada minuto exclusivamente para manter a cadência de recovery/watchdog do pipeline de Produção da 5.6. Uma nova Ronda editorial somente é enfileirada quando `UTC minute % 5 === 0`. Nos demais minutos o tick encerra após a manutenção barata.

Dessa forma:
- carrossel: recovery observado a cada 1 min;
- Ronda: 1 execução a cada 5 min;
- single-flight/coalescing: mantidos;
- Browser/IA da Ronda: continuam sob Cost Governor;
- carrossel manual: não sofre redução de qualidade/budget.

## Exclusões deliberadas
Não fazem parte desta versão:
- retry manual de leitura via `ARTICLE_READ_QUEUE` da 5.8;
- retry manual de geração via `CAROUSEL_AI_QUEUE` da 5.9.

Esses mecanismos só devem voltar após teste de concorrência real com mensagens antigas e fencing token determinístico.

## Critério pós-deploy
Antes de evoluir o carrossel novamente, medir pelo menos 20 URLs reais e buscar:
- ≥95% `Evidence Pack` criado;
- ≥95% `Evidence → ready`;
- 0 jobs presos;
- 0 duplicações de IA;
- <10% necessidade de retry manual.
