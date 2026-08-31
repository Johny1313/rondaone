# RONDA ONE — Carousel Stability Baseline Definitiva

## Base escolhida

```text
Estabilidade operacional: 0.9.7.5.6
Eficiência/custo:       0.9.7.5.7
Árvore de consolidação: 0.9.7.5.12
Nova baseline:          0.9.7.6.0
```

A nova versão não é um hotfix incremental sobre a 5.13. Ela foi montada sobre a árvore consolidada 5.12, mantendo os componentes estáveis da 5.6 e os controles da 5.7, e incorporando somente as mudanças necessárias para leitura externa, isolamento de cache e observabilidade.

## Conflitos descartados

### 5.8 / 5.9 — retry durável por filas

Não incorporado à baseline. Essas versões alteravam a coordenação do retry de leitura/geração e podiam introduzir uma segunda camada de ownership além do recovery/lease já existente.

A baseline mantém:

```text
um job
um lease por stage
um coordenador de recovery
retry manual no mesmo job
```

### 5.11 — Browser Run com networkidle2

A intenção de esperar conteúdo JS-heavy foi preservada; a implementação não.

A nova estratégia usa:

```text
domcontentloaded
+
waitForTimeout curto
+
content sufficiency
```

Isso evita transformar `networkidle2` em requisito universal para sites jornalísticos que mantêm conexões de analytics, ads ou polling.

### 5.13 — Fresh URL Reset

O conceito foi generalizado. Em vez de uma flag pontual de reset, a baseline usa versões explícitas do pipeline:

```text
readerVersion
evidenceVersion
carouselPipelineVersion
```

Estado legado continua no D1, mas deixa de ser elegível para reuse quando não é compatível.

## Arquivos removidos

```text
scripts/test-097510-carousel-stability-baseline.mjs
scripts/test-097512-carousel-56-full-lock.mjs
src/production/carousel-56-lock.json
docs/CAROUSEL-STABILITY-BASELINE-v0.9.7.5.10.md
docs/CAROUSEL-56-FULL-LOCK-v0.9.7.5.12.md
```

Motivo: eram locks parciais/anteriores que exigiam `engine.js` byte a byte igual à 5.6. Isso conflita diretamente com a nova leitura híbrida. A proteção foi consolidada em um único manifesto atual.

## Arquivos adicionados

```text
src/production/hybrid-browser-reader.js
src/production/carousel-stability-lock.json
scripts/test-carousel-stability-baseline-definitive.mjs
```

## Código removido do engine

Funções sem referências externas/internas e que duplicavam caminhos já consolidados:

```text
ensureEvidencePackPtBr
bestTopicItem
evidenceSyntheticHtml
translateArticleRecordToPtBr
splitTranslationText
```

Também foi removido `getTransportPreference`, que promovia Browser-first automaticamente com base no histórico do domínio. A baseline passa a priorizar direct no caminho normal e permite Browser-first somente em retry explícito.

## Leitor híbrido

### Caminho normal

```text
cache compatível
→ direct fetch
→ JSON-LD
→ adapter
→ parser
→ AMP
→ Browser fallback
→ snapshot/coleta
```

O `scraping-engine.js` não foi reescrito. A alteração é isolada no adaptador Browser usado por ele.

### Browser

Configuração:

```text
Quick Action: content
navegações por tentativa Browser: 1
waitUntil: domcontentloaded
JavaScript: habilitado
estabilização: 650–1200 ms normal / 1200–2500 ms deep
bloqueados: image, media, font, stylesheet
preservados: script, xhr, fetch
```

O retorno é classificado como:

```text
excellent
good
partial
insufficient
not-rendered
blocked
```

Bloqueios explícitos incluem:

```text
BOT_PROTECTION
PAYWALL
CONTENT_NOT_RENDERED
ARTICLE_INSUFFICIENT
```

## Cache / D1

Nenhuma linha histórica é apagada para forçar uma nova leitura.

A compatibilidade passa a ser verificada pelo payload:

```text
readerVersion = hybrid-reader-v1
evidenceVersion = ronda-evidence-pack-v1-reader-v1
carouselPipelineVersion = carousel-stability-baseline-v1
```

Reuse de job pronto, job ativo e Evidence Pack só ocorre quando essas versões coincidem.

## Diagnóstico

Endpoint:

```text
GET /api/admin/carousel/diagnostics
```

Principais campos:

```text
jobId
url
domain
status
stage
readerStrategy
browserUsed
browserDuration
browserMsUsed
contentChars
evidenceCount
attempts
leaseStage
heartbeatAgeSeconds
resultExists
evidenceExists
evidenceCompatible
readerVersion
evidenceVersion
pipelineVersion
lastError
reason
```

## Componentes congelados

Continuam protegidos pelos hashes da linha estável:

```text
src/production/scraping-engine.js
src/ronda/v285/article-reader.js
public/design/index.html
```

Além deles, o novo lock registra hashes de todos os arquivos críticos da baseline 0.9.7.6.0.

## Testes locais

Executado:

```bash
npm run test:all
```

Inclui:

- check sintático;
- FORMA inline JS;
- regressão funcional/editorial/estabilidade;
- Source Recovery;
- Access/Auth;
- Carousel Stability;
- Multi-AI/Quality Gate;
- Content Lock;
- workflow;
- Mandatory Slide Count;
- No-Hang;
- Adaptive Scraping;
- Hybrid Multi-Transport;
- HOTFIX LOCK;
- Mesa/Produção;
- Read Budget;
- Carousel Open Recovery;
- Retry Lease Handoff;
- Stuck Production Watchdog;
- Quality-First/Cost Governor/Crawl;
- novo Carousel Stability Baseline Definitiva.

Resultado local: aprovado.

## Limite do teste local

Não declara sucesso operacional de URLs reais. Após deploy ainda é obrigatório medir Browser Run, D1, Queues e sites reais conforme o gate descrito no README.
