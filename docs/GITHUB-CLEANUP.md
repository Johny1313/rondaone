# Auditoria de limpeza do GitHub — v0.9.5

Repositório de referência: `Johny1313/rondaone`, branch `main`.

## Estrutura recomendada na raiz

```text
docs/
public/
scripts/
src/
.gitignore
CHANGELOG.md
README.md
package.json
wrangler.jsonc
```

## Arquivos históricos que não precisam permanecer na raiz

Podem ser removidos depois de confirmar o deploy da v0.9.5:

- `ATUALIZAR-PARA-*.txt` de versões anteriores;
- `IMPLEMENTACAO-080.md`;
- `README-HOTFIX.txt`;
- `UPLOAD-GITHUB.txt`;
- `BUILD_INFO.txt`.

O histórico de implementação já permanece no Git e no `CHANGELOG.md`.

## Scripts

Manter os scripts citados por `package.json`, especialmente:

- regressão histórica usada por `test:regression`;
- `test-093-reliability-core.mjs`;
- `test-094-production-hardening.mjs`;
- `test-094-chaos.mjs`;
- `test-0941-multi-ai-quality.mjs`;
- `test-0942-version-content-lock.mjs`;
- `test-0943-operations.mjs`;
- `test-095-workflow.mjs`;
- `verify-current.mjs`;
- `smoke-production.mjs`;
- `stress-readonly.mjs`.

Não remova um teste apenas porque o número no nome é antigo enquanto ele ainda fizer parte da regressão atual.

## Não apagar

- `src/`;
- `public/`;
- `wrangler.jsonc`;
- `package.json`;
- `.gitignore`;
- `README.md`;
- `CHANGELOG.md`;
- `docs/`.

## Nomes legados ainda ativos

Não remova nem renomeie automaticamente `src/ronda/v285/`.

O nome é herdado, mas a pasta contém partes ativas do runtime. Uma futura refatoração deve ocorrer em versão própria, com imports e regressão atualizados em conjunto.

## Infraestrutura Cloudflare

A limpeza do GitHub não inclui apagar:

- banco D1;
- tabelas D1;
- Queues;
- DLQ;
- secrets;
- bindings;
- históricos de produção.

Esses recursos devem ser avaliados separadamente pela operação/telemetria do ambiente.
