# RONDA ONE Cloud v0.9.7.6.0 — Carousel Stability Baseline Definitiva

Release CLEAN reconstruída a partir da linha `0.9.7.5.12`, preservando a estabilidade operacional do carrossel `0.9.7.5.6` e o controle de custo/Quality-First da `0.9.7.5.7`.

O objetivo desta build é interromper a sequência de hotfixes concorrentes e estabelecer uma única baseline auditável para leitura externa, Evidence Pack, retry/recovery e geração no FORMA.

## O que foi preservado

A árvore mantém a cadeia editorial consolidada desde `v0.9.7.4.9` (tracking da Mesa/Principal/Novidades) e as proteções posteriores incorporadas até a baseline escolhida.

- motor editorial e de carrossel consolidado da baseline 5.6;
- `src/production/scraping-engine.js` congelado;
- `src/ronda/v285/article-reader.js` congelado;
- FORMA `public/design/index.html` congelado;
- Quality-First 5M;
- Cost Governor;
- Crawl read-only;
- watchdog/recovery de Produção a cada 1 minuto;
- Ronda automática a cada 5 minutos;
- Mesa, Produção, Principal, Novidades, Projetos e tracking editorial;
- Mandatory Slide Count, Multi-AI, Quality Gate e Confidence;
- histórico D1: nenhuma exclusão e nenhuma migration destrutiva.

## Leitor externo definitivo

O Browser Run foi isolado em `src/production/hybrid-browser-reader.js`.

Fluxo normal:

```text
URL
→ direct fetch / JSON-LD / adapter / parser / AMP
→ content sufficiency
→ Evidence Pack
```

Somente se a leitura normal for insuficiente:

```text
Browser Run
→ 1 Quick Action /content
→ JavaScript habilitado
→ domcontentloaded
→ pequena estabilização adicional
→ HTML renderizado
→ content sufficiency
→ Evidence Pack
```

O Browser não bloqueia `script`, `xhr` ou `fetch`. Recursos caros como imagem, mídia, fonte e stylesheet são bloqueados durante a leitura editorial.

`networkidle0/networkidle2` não é usado como condição padrão do carrossel, evitando espera desnecessária em portais com anúncios, analytics, polling ou conexões persistentes.

## Cache e estado incompatível

Novos jobs recebem automaticamente:

```text
readerVersion = hybrid-reader-v1
evidenceVersion = ronda-evidence-pack-v1-reader-v1
carouselPipelineVersion = carousel-stability-baseline-v1
```

Jobs, Evidence Packs e resultados antigos permanecem no D1 para auditoria, mas não são reutilizados pela baseline atual quando não possuem versões compatíveis.

## Retry / recovery

A build mantém um único coordenador de recovery. As alterações concorrentes de retry durável das 5.8/5.9 não foram incorporadas.

Retry manual continua no mesmo job e muda de estratégia:

```text
1 → alternate
2 → deep
3+ → snapshot/cache
```

Leases são revogadas no handoff manual para impedir que uma tentativa antiga sobrescreva a nova.

## Observabilidade

Novo endpoint read-only para administrador:

```text
GET /api/admin/carousel/diagnostics
```

Retorna, entre outros:

- jobId / status / stage;
- URL e domínio;
- readerStrategy;
- Browser usado e duração;
- contentChars;
- evidenceCount;
- attempts;
- lease;
- resultExists;
- readerVersion / evidenceVersion / pipelineVersion;
- lastError / reason.

## Arquivos conflitantes removidos

A baseline substitui os locks parciais 5.10/5.12 por um único lock atual:

```text
REMOVIDOS
scripts/test-097510-carousel-stability-baseline.mjs
scripts/test-097512-carousel-56-full-lock.mjs
src/production/carousel-56-lock.json
docs/CAROUSEL-STABILITY-BASELINE-v0.9.7.5.10.md
docs/CAROUSEL-56-FULL-LOCK-v0.9.7.5.12.md

NOVO LOCK ÚNICO
src/production/carousel-stability-lock.json
scripts/test-carousel-stability-baseline-definitive.mjs
```

## Código morto removido

Foram retiradas funções que não possuíam chamadas no projeto e duplicavam caminhos já consolidados:

```text
ensureEvidencePackPtBr
bestTopicItem
evidenceSyntheticHtml
translateArticleRecordToPtBr
splitTranslationText
getTransportPreference (browser-first automático por histórico)
```

O Browser-first automático por domínio foi removido do caminho normal. Browser só ganha prioridade em retry explícito `alternate/deep`.

## Validação local executada

```bash
npm run test:all
```

Resultado desta build: suíte completa aprovada, incluindo regressões históricas de 0.8.x a 0.9.7.5.7 e o teste dedicado da baseline definitiva.

A validação local não substitui o teste operacional pós-deploy com URLs reais e D1/Queues/Browser Run da conta Cloudflare.

## Gate de produção

Antes de declarar a baseline aprovada em produção, executar:

- 20+ URLs reais;
- 5 grandes nacionais;
- 5 regionais;
- 5 JS-heavy;
- 5 externas sem adapter;
- 3 ciclos completos da Ronda;
- teste 3/5/6/8/10 slides;
- zero jobs presos;
- zero carrosséis duplicados;
- zero IA duplicada;
- Evidence Pack >= 95%;
- ready >= 95%;
- retry manual < 10%;
- Browser somente como fallback na maioria dos casos.

Detalhes técnicos e decisões de limpeza: `docs/CAROUSEL-STABILITY-BASELINE-DEFINITIVA.md`.
