RONDA ONE v0.8.5.1 — ADMIN LOGIN HOTFIX

Problema:
Cloudflare runtime rejeita PBKDF2 acima de 10.000 iterações.
A v0.8.5 tentava 120.000 no primeiro login ADM.

Correção:
- ADM passa a autenticar diretamente contra o Secret ADMIN_BOOTSTRAP_PASSWORD.
- O Secret continua apenas no Cloudflare.
- Usuários comuns continuam com acesso somente por e-mail.
- Nenhuma alteração em coleta, carrossel, D1 schema, Design ou Queues.

Substitua:
src/index.js

Adicione:
src/ronda/admin-auth-hotfix.js

Depois faça deploy.
