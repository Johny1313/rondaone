# Comparação real das versões 5.6–5.13

Comparação calculada diretamente dos ZIPs fornecidos. O objetivo é separar alterações reais de código de rótulos/descrições de release. A contagem de arquivos da linha `6.0 CLEAN` representa o snapshot antes da inclusão deste próprio relatório.

## Resumo por versão

| Versão | Arquivos | Diferentes da 5.6 | Só nesta versão | Ausentes vs 5.6 | engine.js | scraping-engine.js | article-reader.js |
|---|---:|---:|---:|---:|---|---|---|
| 5.6 | 118 | 0 | 0 | 0 | `cabecc5f75` | `d5cd2aba4f` | `944bff72b0` |
| 5.7 | 120 | 23 | 2 | 0 | `cabecc5f75` | `d5cd2aba4f` | `944bff72b0` |
| 5.8 | 122 | 25 | 4 | 0 | `ded9726719` | `d5cd2aba4f` | `944bff72b0` |
| 5.9 | 124 | 26 | 6 | 0 | `80f1388cf4` | `d5cd2aba4f` | `944bff72b0` |
| 5.10 | 122 | 22 | 4 | 0 | `cabecc5f75` | `d5cd2aba4f` | `944bff72b0` |
| 5.11 | 124 | 23 | 6 | 0 | `6cd05a6e2f` | `d5cd2aba4f` | `944bff72b0` |
| 5.12 | 125 | 22 | 7 | 0 | `cabecc5f75` | `d5cd2aba4f` | `944bff72b0` |
| 5.13 | 127 | 22 | 9 | 0 | `cabecc5f75` | `d5cd2aba4f` | `944bff72b0` |
| 6.0 CLEAN | 124 | 27 | 6 | 0 | `9c3eaafe12` | `d5cd2aba4f` | `944bff72b0` |

## Alterações entre versões consecutivas

### 5.6 → 5.7
Arquivos alterados/adicionados/removidos: **25**.

- ~ `CHANGELOG.md`
- ~ `README.md`
- + `docs/QUALITY-FIRST-COST-GOVERNOR-v0.9.7.5.7.md`
- ~ `package.json`
- ~ `public/projects/index.html`
- ~ `public/ronda/app.js`
- ~ `public/ronda/index.html`
- ~ `public/ronda/styles.css`
- ~ `scripts/smoke-production.mjs`
- ~ `scripts/test-0852-ui-source-sync.mjs`
- ~ `scripts/test-0951-round-stability.mjs`
- ~ `scripts/test-097410-forma-downloads.mjs`
- ~ `scripts/test-09744-projects-ui-security-cleanup.mjs`
- ~ `scripts/test-09747-high-volume-discovery.mjs`
- ~ `scripts/test-09751-unified-no-hang-coordinator.mjs`
- ~ `scripts/test-09756-stuck-production-watchdog.mjs`
- + `scripts/test-09757-quality-first-cost-crawl.mjs`
- ~ `scripts/verify-current.mjs`
- ~ `src/index.js`
- ~ `src/ronda/shell.js`
- ~ `src/ronda/v285/collector.js`
- ~ `src/ronda/v285/database.js`
- ~ `src/ronda/v285/index.js`
- ~ `src/ronda/v285/translation.js`
- ~ `wrangler.jsonc`

### 5.7 → 5.8
Arquivos alterados/adicionados/removidos: **19**.

- ~ `CHANGELOG.md`
- ~ `README.md`
- + `docs/CAROUSEL-DURABLE-RETRY-v0.9.7.5.8.md`
- ~ `package.json`
- ~ `public/projects/index.html`
- ~ `public/ronda/styles.css`
- ~ `scripts/smoke-production.mjs`
- ~ `scripts/test-097410-forma-downloads.mjs`
- ~ `scripts/test-09743-terminal-carousel-completion.mjs`
- ~ `scripts/test-09744-projects-ui-security-cleanup.mjs`
- ~ `scripts/test-09756-stuck-production-watchdog.mjs`
- ~ `scripts/test-09757-quality-first-cost-crawl.mjs`
- + `scripts/test-09758-durable-carousel-retry.mjs`
- ~ `scripts/verify-current.mjs`
- ~ `src/index.js`
- ~ `src/production/engine.js`
- ~ `src/ronda/shell.js`
- ~ `src/ronda/v285/collector.js`
- ~ `src/ronda/v285/index.js`

### 5.8 → 5.9
Arquivos alterados/adicionados/removidos: **17**.

- ~ `CHANGELOG.md`
- ~ `README.md`
- + `docs/CAROUSEL-DURABLE-AI-GENERATION-v0.9.7.5.9.md`
- ~ `package.json`
- ~ `public/projects/index.html`
- ~ `scripts/smoke-production.mjs`
- ~ `scripts/test-097410-forma-downloads.mjs`
- ~ `scripts/test-09742-retry-ux-same-job.mjs`
- ~ `scripts/test-09743-terminal-carousel-completion.mjs`
- ~ `scripts/test-09744-projects-ui-security-cleanup.mjs`
- ~ `scripts/test-09756-stuck-production-watchdog.mjs`
- ~ `scripts/test-09758-durable-carousel-retry.mjs`
- + `scripts/test-09759-durable-ai-generation-retry.mjs`
- ~ `scripts/verify-current.mjs`
- ~ `src/index.js`
- ~ `src/production/engine.js`
- ~ `src/ronda/shell.js`

### 5.9 → 5.10
Arquivos alterados/adicionados/removidos: **26**.

- ~ `CHANGELOG.md`
- ~ `README.md`
- - `docs/CAROUSEL-DURABLE-AI-GENERATION-v0.9.7.5.9.md`
- - `docs/CAROUSEL-DURABLE-RETRY-v0.9.7.5.8.md`
- + `docs/CAROUSEL-STABILITY-BASELINE-v0.9.7.5.10.md`
- ~ `package.json`
- ~ `public/projects/index.html`
- ~ `public/ronda/styles.css`
- ~ `scripts/smoke-production.mjs`
- ~ `scripts/test-097410-forma-downloads.mjs`
- ~ `scripts/test-09742-retry-ux-same-job.mjs`
- ~ `scripts/test-09743-terminal-carousel-completion.mjs`
- ~ `scripts/test-09744-projects-ui-security-cleanup.mjs`
- ~ `scripts/test-09751-unified-no-hang-coordinator.mjs`
- + `scripts/test-097510-carousel-stability-baseline.mjs`
- ~ `scripts/test-09756-stuck-production-watchdog.mjs`
- ~ `scripts/test-09757-quality-first-cost-crawl.mjs`
- - `scripts/test-09758-durable-carousel-retry.mjs`
- - `scripts/test-09759-durable-ai-generation-retry.mjs`
- ~ `scripts/verify-current.mjs`
- ~ `src/index.js`
- ~ `src/production/engine.js`
- ~ `src/ronda/shell.js`
- ~ `src/ronda/v285/collector.js`
- ~ `src/ronda/v285/index.js`
- ~ `wrangler.jsonc`

### 5.10 → 5.11
Arquivos alterados/adicionados/removidos: **14**.

- ~ `CHANGELOG.md`
- ~ `README.md`
- + `docs/EXTERNAL-LINK-BROWSER-READ-HOTFIX-v0.9.7.5.11.md`
- ~ `package.json`
- ~ `scripts/smoke-production.mjs`
- ~ `scripts/test-097410-forma-downloads.mjs`
- ~ `scripts/test-09744-projects-ui-security-cleanup.mjs`
- ~ `scripts/test-097510-carousel-stability-baseline.mjs`
- + `scripts/test-097511-external-link-browser-read-hotfix.mjs`
- ~ `scripts/test-09757-quality-first-cost-crawl.mjs`
- ~ `scripts/verify-current.mjs`
- ~ `src/index.js`
- ~ `src/production/engine.js`
- ~ `src/ronda/shell.js`

### 5.11 → 5.12
Arquivos alterados/adicionados/removidos: **19**.

- ~ `CHANGELOG.md`
- ~ `README.md`
- + `docs/CAROUSEL-56-FULL-LOCK-v0.9.7.5.12.md`
- - `docs/EXTERNAL-LINK-BROWSER-READ-HOTFIX-v0.9.7.5.11.md`
- ~ `package.json`
- ~ `public/projects/index.html`
- ~ `scripts/smoke-production.mjs`
- ~ `scripts/test-097410-forma-downloads.mjs`
- ~ `scripts/test-09744-projects-ui-security-cleanup.mjs`
- ~ `scripts/test-097510-carousel-stability-baseline.mjs`
- - `scripts/test-097511-external-link-browser-read-hotfix.mjs`
- + `scripts/test-097512-carousel-56-full-lock.mjs`
- ~ `scripts/test-09757-quality-first-cost-crawl.mjs`
- ~ `scripts/verify-current.mjs`
- ~ `src/index.js`
- + `src/production/carousel-56-lock.json`
- ~ `src/production/engine.js`
- ~ `src/ronda/shell.js`
- ~ `src/ronda/v285/index.js`

### 5.12 → 5.13
Arquivos alterados/adicionados/removidos: **16**.

- ~ `CHANGELOG.md`
- ~ `README.md`
- + `docs/EXTERNAL-URL-FRESH-RESET-v0.9.7.5.13.md`
- ~ `package.json`
- ~ `public/projects/index.html`
- ~ `scripts/smoke-production.mjs`
- ~ `scripts/test-097410-forma-downloads.mjs`
- ~ `scripts/test-09744-projects-ui-security-cleanup.mjs`
- ~ `scripts/test-097510-carousel-stability-baseline.mjs`
- ~ `scripts/test-097512-carousel-56-full-lock.mjs`
- + `scripts/test-097513-external-url-fresh-reset.mjs`
- ~ `scripts/verify-current.mjs`
- ~ `src/index.js`
- ~ `src/production/carousel-56-lock.json`
- ~ `src/ronda/shell.js`
- ~ `src/ronda/v285/index.js`

### 5.13 → 6.0 CLEAN
Arquivos alterados/adicionados/removidos: **29**.

- ~ `CHANGELOG.md`
- ~ `README.md`
- - `docs/CAROUSEL-56-FULL-LOCK-v0.9.7.5.12.md`
- + `docs/CAROUSEL-STABILITY-BASELINE-DEFINITIVA.md`
- - `docs/CAROUSEL-STABILITY-BASELINE-v0.9.7.5.10.md`
- - `docs/EXTERNAL-URL-FRESH-RESET-v0.9.7.5.13.md`
- ~ `package.json`
- ~ `public/projects/index.html`
- ~ `scripts/smoke-production.mjs`
- ~ `scripts/test-0971-fast-carousel-credits.mjs`
- ~ `scripts/test-0972-single-source-content-first.mjs`
- ~ `scripts/test-097410-forma-downloads.mjs`
- ~ `scripts/test-09743-terminal-carousel-completion.mjs`
- ~ `scripts/test-09744-projects-ui-security-cleanup.mjs`
- ~ `scripts/test-09746-hybrid-multi-transport.mjs`
- ~ `scripts/test-09751-unified-no-hang-coordinator.mjs`
- - `scripts/test-097510-carousel-stability-baseline.mjs`
- - `scripts/test-097512-carousel-56-full-lock.mjs`
- - `scripts/test-097513-external-url-fresh-reset.mjs`
- ~ `scripts/test-09757-quality-first-cost-crawl.mjs`
- + `scripts/test-carousel-stability-baseline-definitive.mjs`
- ~ `scripts/verify-current.mjs`
- ~ `src/index.js`
- - `src/production/carousel-56-lock.json`
- + `src/production/carousel-stability-lock.json`
- ~ `src/production/engine.js`
- + `src/production/hybrid-browser-reader.js`
- ~ `src/ronda/shell.js`
- ~ `src/ronda/v285/index.js`

## Arquivos críticos — equivalência

### `src/production/engine.js`
- `cabecc5f756746dd`: 5.6, 5.7, 5.10, 5.12, 5.13
- `ded97267195b3f6a`: 5.8
- `80f1388cf4c1a881`: 5.9
- `6cd05a6e2f43c577`: 5.11
- `9c3eaafe1242c910`: 6.0 CLEAN

### `src/production/scraping-engine.js`
- `d5cd2aba4f110ff9`: 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13, 6.0 CLEAN

### `src/ronda/v285/article-reader.js`
- `944bff72b03f3c15`: 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13, 6.0 CLEAN

### `src/ronda/v285/index.js`
- `bd28ec757412ac51`: 5.6
- `3485e761730a326b`: 5.7
- `3484d012a9c7fec1`: 5.8, 5.9
- `8246e025aacbbcfb`: 5.10, 5.11
- `91c281820cabb3ce`: 5.12
- `ac7c88f23090175d`: 5.13
- `ae81a8ae1b2e20cc`: 6.0 CLEAN

### `src/index.js`
- `eebf02582688ab34`: 5.6
- `b71c699414c821e7`: 5.7
- `5f1efa1e672c4934`: 5.8
- `21fba9181a136f40`: 5.9
- `a9968f5367d09781`: 5.10
- `9ff56874c272760c`: 5.11
- `879fd06e861737f3`: 5.12
- `bdcfebd7dc93085a`: 5.13
- `c5e36022b9ac9f58`: 6.0 CLEAN

### `public/design/index.html`
- `1af86252a341dd29`: 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13, 6.0 CLEAN

### `wrangler.jsonc`
- `2c0e9d3a802d2418`: 5.6, 5.10, 5.11, 5.12, 5.13, 6.0 CLEAN
- `a8f1aeac7da046c6`: 5.7, 5.8, 5.9

## Achados objetivos

- Os dois ZIPs fornecidos da 5.10 foram verificados anteriormente como byte a byte idênticos em todos os arquivos; a comparação usa apenas uma cópia.
- A 5.10 retorna o `engine.js` à linha da 5.6 após as mudanças de retry das 5.8/5.9.
- A 5.11 altera a leitura Browser para tratar páginas JS-heavy; a 5.12 volta a congelar o núcleo 5.6.
- A 5.13 muda o comportamento de reutilização de estado/URL, mas não deve ser usada como base incremental para empilhar novos hotfixes.
- A 6.0 CLEAN mantém `scraping-engine.js`, `article-reader.js` e FORMA congelados, e isola a nova leitura Browser em um arquivo próprio.

## Decisão de composição

```text
5.6 → engine/recovery operacional
5.7 → Quality-First 5M + Cost Governor
5.12 → árvore consolidada de partida
5.13 → conceito de incompatibilidade de cache, generalizado por versões
6.0 CLEAN → Hybrid Browser Reader isolado + lock único + diagnóstico
```
