# RONDA ONE v0.9.7.5.12 — Carousel 5.6 Full Lock + Quality-First 5M

## Decisão
A geração de carrossel volta a ser tratada como um subsistema congelado na baseline comprovada `0.9.7.5.6`. A Ronda editorial, Mesa, Produção, Crawl e controles de custo permanecem na linha Quality-First atual.

## O que foi restaurado e congelado
Os seguintes arquivos foram copiados explicitamente da `0.9.7.5.6` e protegidos por SHA-256:

- `src/production/engine.js`
- `src/production/scraping-engine.js`
- `src/ronda/v285/article-reader.js`
- `src/ronda/v285/parser.js`
- `src/ronda/article-visuals.js`
- `public/design/index.html`

O manifesto de lock fica em `src/production/carousel-56-lock.json`.

## Dependência compartilhada de tradução
`src/ronda/v285/translation.js` é compartilhado com a Ronda Quality-First. Copiar o arquivo inteiro da 5.6 removeria o limite de tradução introduzido para controlar custo da Ronda. Por isso a 5.12 congela por hash somente o trecho crítico usado pelo carrossel (`TRANSLATION_MODEL`, detecção de português e `translateText`), que permanece idêntico à 5.6.

## Coordenação
- recovery/watchdog de Produção: verificado a cada 1 minuto;
- nova Ronda editorial: somente a cada 5 minutos;
- single-flight/coalescing da Ronda: preservado;
- Cost Governor: continua aplicado à operação automática da Ronda;
- carrossel manual: qualidade fora do bloqueio de custo automático;
- mudanças de retry manual durável da 5.8/5.9: não reintroduzidas;
- Browser Run do carrossel: comportamento 5.6 (`domcontentloaded`) restaurado, sem a alteração experimental da 5.11.

## Banco de dados
Nenhuma migration ou alteração de schema D1 foi adicionada nesta release.

## Gate de regressão
`scripts/test-097512-carousel-56-full-lock.mjs` falha se qualquer componente congelado divergir da 5.6 ou se a API crítica de tradução usada pelo carrossel mudar.

## Validação pós-deploy
Usar pelo menos 20 casos reais, com prioridade para URLs externas, e medir:

- Evidence Pack criado;
- Evidence Pack chegando a `ready`;
- jobs presos;
- duplicações de IA;
- retries manuais;
- tempo por estágio (`reading`, `evidence`, `generating`, `ready`).

A 5.10 deve permanecer disponível como rollback imediato até essa amostra ser concluída.
