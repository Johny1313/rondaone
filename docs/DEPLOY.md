# Deploy — RONDA ONE v0.9.7.6.1

## Escopo

Atualização cirúrgica sobre `0.9.7.6.0`. Não executar migration destrutiva nem apagar D1.

## Alterações

- Band Adapter V2;
- JSON-LD estruturado e `VideoObject` com conteúdo suficiente;
- Retry 1: `direct-first` com adapter/AMP antes do Browser;
- Retry 2: `deep` com Browser prioritário;
- versões de reader/evidence/pipeline incrementadas;
- aviso no FORMA quando o canvas preservado ainda contém conteúdo anterior.

## Bindings obrigatórios

- `DB` — D1 `ronda-one-db`;
- `AI` — Workers AI;
- `BROWSER` — Browser Rendering;
- `ASSETS`;
- `ROUND_JOBS_QUEUE`;
- `INTELLIGENT_JOBS_QUEUE`;
- `ARTICLE_READ_QUEUE`;
- `CAROUSEL_AI_QUEUE`.

## Cron

`* * * * *` permanece intencional: recovery a cada minuto e Ronda editorial somente quando `minute % 5 === 0`.

## Pré-deploy

```bash
npm run check
npm run test:current
npm run test:regression
npm run verify
```

## Pós-deploy

Confirmar `/api/platform/status` com `version = 0.9.7.6.1` e testar pelo menos uma matéria Band que antes caía em `BROWSER_TIMEOUT`. Verificar no diagnóstico que o retry 1 inicia em leitura direta e só aciona Browser depois de JSON-LD/adapter/AMP insuficientes.
