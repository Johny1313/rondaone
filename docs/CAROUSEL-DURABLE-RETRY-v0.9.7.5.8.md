# RONDA ONE v0.9.7.5.8 — Durable Carousel Retry

## Sintoma
Três tentativas manuais podiam terminar com a mesma mensagem de margem máxima, mantendo o job em `reading`.

## Root cause
O retry manual trocava a estratégia, porém lançava a leitura prioritariamente como background direto via `waitUntil`. Se a execução fosse interrompida fora da vida útil da requisição, o job permanecia em leitura. Como o GET do job é read-only e o watchdog automático está na cadência operacional, o frontend chegava ao teto de segurança antes de uma recuperação durável.

## Correção
1. Revoga a lease de leitura anterior.
2. Mantém o mesmo job e calcula `alternate`, `deep` ou `snapshot`.
3. Enfileira a nova leitura na `ARTICLE_READ_QUEUE` com o `retryMode`.
4. O consumer repassa o `retryMode` ao Scraping Engine.
5. Somente jobs com `evidenceId` podem seguir para a `CAROUSEL_AI_QUEUE`.
6. `waitUntil` direto fica apenas como contingência se a Queue não aceitar a mensagem.

## Freeze de qualidade
Sem alterações em `src/production/scraping-engine.js`, `src/ronda/v285/article-reader.js` e `public/design/index.html`. Logo, extração, Evidence Pack, Multi-AI, Quality Gate e FORMA permanecem iguais à base 5.7.
