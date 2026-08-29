# Auditoria de limpeza do GitHub

Repositório auditado: `Johny1313/rondaone`, branch `main`.

## Situação encontrada

O branch principal ainda estava identificado no `package.json` como v0.9.0, enquanto a linha de desenvolvimento já havia avançado para v0.9.1. A raiz também acumulava um arquivo de atualização para praticamente cada hotfix anterior e documentação temporária de implementação.

## Pode ser removido ao publicar a v0.9.2 completa

### Documentação histórica solta na raiz

- `ATUALIZAR-PARA-080.txt`
- `ATUALIZAR-PARA-081.txt`
- `ATUALIZAR-PARA-082.txt`
- `ATUALIZAR-PARA-083.txt`
- `ATUALIZAR-PARA-084.txt`
- `ATUALIZAR-PARA-085.txt`
- `ATUALIZAR-PARA-0852.txt`
- `ATUALIZAR-PARA-0853.txt`
- `ATUALIZAR-PARA-0854.txt`
- `ATUALIZAR-PARA-0855.txt`
- `ATUALIZAR-PARA-086.txt`
- `ATUALIZAR-PARA-087.txt`
- `ATUALIZAR-PARA-088.txt`
- `ATUALIZAR-PARA-0881.txt`
- `ATUALIZAR-PARA-089.txt`
- `ATUALIZAR-PARA-090.txt`
- `ATUALIZAR-PARA-091.txt`
- `IMPLEMENTACAO-080.md`
- `README-HOTFIX.txt`
- `UPLOAD-GITHUB.txt`
- `BUILD_INFO.txt`

O histórico continua disponível pelo Git. Este pacote substitui esses arquivos por `README.md`, `CHANGELOG.md`, `docs/DEPLOY.md` e este relatório de limpeza.

### Scripts obsoletos

Os antigos `scripts/verify-080.mjs` até `scripts/verify-091.mjs` eram verificadores amarrados a números exatos de versões antigas. A v0.9.2 usa apenas `scripts/verify-current.mjs`.

Também foram removidos do pacote os testes `test-084-auth-profile-dashboard.mjs` e `test-085-open-email-access.mjs`, porque eles validavam estados intermediários substituídos pelo fluxo de autenticação mais recente; a regressão atual mantém `test-0854-email-only-auth.mjs` e os testes posteriores.

## Deve permanecer

- `src/`
- `public/`
- `wrangler.jsonc`
- `package.json`
- `.gitignore`
- `scripts/test-*` que fazem parte de `npm run test:regression`
- `scripts/verify-current.mjs`
- `README.md`, `CHANGELOG.md` e `docs/`

## Não apagar automaticamente

Não remover tabelas D1, bindings, Queues ou arquivos funcionais só porque possuem nomes herdados, como a pasta `src/ronda/v285/`. O nome interno é legado, mas ela continua contendo o runtime ativo da Ronda. Renomeá-la agora aumentaria o risco de regressão sem benefício operacional equivalente.
