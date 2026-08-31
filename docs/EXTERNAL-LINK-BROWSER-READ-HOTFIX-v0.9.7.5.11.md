# RONDA ONE v0.9.7.5.11 — External Link Browser Read Hotfix

## Problema observado
Links externos apresentavam inconsistência de leitura antes da criação do Evidence Pack, principalmente em páginas que montam o corpo da matéria após `DOMContentLoaded`.

## Causa técnica
A baseline 5.6/5.10 usava Browser Run `/content` com `waitUntil: domcontentloaded` e budget padrão de 5,5 s. Em páginas JS-heavy isso pode retornar HTML parcial. Além disso, respostas HTTP/JSON de erro podiam avançar até a camada de parsing sem validação explícita de `response.ok` / `success`.

## Correção
1. Browser Run tenta primeiro `networkidle2` para aguardar a renderização dinâmica.
2. Se a página não estabilizar, faz fallback para `domcontentloaded`.
3. Cada resposta é validada antes do parsing.
4. Budget padrão do Browser Run passa a 9,5 s no fluxo de produção.
5. Direct fetch, adapters, AMP, Evidence Pack, Multi-AI, Quality Gate e FORMA não foram redesenhados.

## Proteções
- `src/ronda/v285/article-reader.js` permanece byte a byte igual à v0.9.7.5.10.
- `public/design/index.html` permanece byte a byte igual à v0.9.7.5.10.
- `src/production/scraping-engine.js` permanece byte a byte igual à v0.9.7.5.10.
- a alteração funcional está concentrada em `src/production/engine.js`.
- v0.9.7.5.10 continua sendo o rollback baseline.
