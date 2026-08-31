# RONDA ONE v0.9.7.5.13 — Carousel 5.6 Fresh URL Reset

## Problema comprovado
A v0.9.7.5.12 restaurou e travou os arquivos centrais da geração na baseline 0.9.7.5.6, porém novas tentativas por uma mesma URL ainda podiam reutilizar estado persistido no D1.

O fluxo existente aceitava:
- resultado `ready` reutilizável da mesma URL por até 90 minutos na rota HTTP;
- Evidence Pack da mesma URL por até 60 minutos no leitor;
- job ativo equivalente por até 3 minutos.

Assim, um deploy com o motor 5.6 podia continuar exibindo o mesmo comportamento observado anteriormente porque o novo request não necessariamente executava uma leitura nova.

## Correção
A correção fica na fronteira da API, sem alterar o motor 5.6.

Para `sourceType=url`:
1. cada novo job recebe `carouselBaseline=carousel-5.6-fresh-url-v1`;
2. um resultado pronto só pode ser reutilizado se já tiver sido criado nessa baseline;
3. um job ativo só pode ser reutilizado se já pertencer a essa baseline;
4. quando um job novo é criado, a primeira leitura usa `force=true`, impedindo o reaproveitamento de Evidence Pack legado;
5. depois que existe um job válido da baseline nova, dedupe e cache voltam a funcionar normalmente.

## O que não foi alterado
- `src/production/engine.js` — hash da 5.6 preservado;
- `src/production/scraping-engine.js` — hash da 5.6 preservado;
- `src/ronda/v285/article-reader.js` — hash da 5.6 preservado;
- `src/ronda/v285/parser.js` — hash da 5.6 preservado;
- `src/ronda/article-visuals.js` — hash da 5.6 preservado;
- `public/design/index.html` — hash da 5.6 preservado;
- schema D1;
- dados existentes;
- Quality-First 5M;
- Mesa, Produção e FORMA.

## Validação local
Passaram:
- `npm run check`;
- `npm run test:current`;
- `npm run test:regression`;
- `npm run verify`;
- `test-097513-external-url-fresh-reset.mjs`.

## Validação pós-deploy
Teste uma URL que falhou anteriormente. A resposta inicial do POST deve indicar `urlBaseline: carousel-5.6-fresh-url-v1` e `freshUrlRead: true` quando um job novo for criado. Depois acompanhe `source → reading → evidence → generating → ready`.
