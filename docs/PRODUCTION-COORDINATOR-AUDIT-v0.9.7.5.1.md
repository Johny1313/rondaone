# Production Coordinator Audit — v0.9.7.5.1

## Invariantes

- Fast Path: 10.000 ms.
- Read stale detection: 8.000 ms.
- Generate stale detection: 10.000 ms.
- Hard recovery deadline: 45.000 ms.
- Absolute backend deadline: 55.000 ms.
- Frontend safety ceiling: 65.000 ms.
- Um único `PRODUCTION_HARD_DEADLINE_MS`.
- Um único `PRODUCTION_ABSOLUTE_DEADLINE_MS`.
- GET `/api/production/jobs/:id` é o único gatilho automático de `recoverStalledProductionJob`.
- `waitFormaProductionJob` não chama `/retry` nem `/fallback`.
- Retry manual: `alternate -> deep -> snapshot`.
- Fallback automático: no máximo uma recuperação automática registrada por job antes do encerramento absoluto.

## Núcleo editorial preservado

Os arquivos abaixo não foram alterados nesta correção:

- `src/production/scraping-engine.js`
- `src/ronda/v285/scraper.js`
- `src/ronda/v285/collector.js`
- `src/ronda/v285/article-reader.js`
