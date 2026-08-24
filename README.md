RONDA ONE 0.7 — Editorial + Design
==================================

RONDA ONE reúne a Ronda Editorial e o editor visual em uma única plataforma,
mas mantém os módulos separados internamente para facilitar manutenção.

ARQUITETURA
- Editorial = módulo Ronda / monitoramento e carrossel
- Design = editor visual em camadas
- AI = serviço compartilhado via Cloudflare Workers AI
- Projects = núcleo compartilhado via D1
- Um Worker Cloudflare + um repositório GitHub

ROTAS
/                  -> redireciona para /ronda
/ronda             -> módulo Editorial
/design/           -> Ronda Design
/projects/         -> Ronda Projects
/api/ai/*          -> Ronda AI
/api/projects/*    -> Project Core
/ronda/api/*       -> API do módulo Editorial
/api/platform/status -> status da plataforma

FLUXO EDITORIAL -> DESIGN
1. Gere o roteiro de 7 slides na Ronda.
2. Ao lado de “Copiar roteiro”, clique “RONDA DESIGN”.
3. O Project Core salva o roteiro no D1 quando o binding DB está disponível.
4. O Design abre 7 pranchetas 1080x1350.
5. Título, subtítulo, origem, overlay e imagem ficam em camadas separadas.
6. Uma única imagem de fundo pode ser solicitada ao Workers AI Free e aplicada
   como camada editável nas 7 pranchetas.
7. Se a IA falhar, o projeto continua aberto e editável com placeholder.

MVP R$ 0
- Sem API paga e sem fallback pago.
- Workers AI somente no modo free-only.
- Uma imagem por carrossel por padrão para preservar a franquia gratuita.
- O editor continua funcionando mesmo quando a IA estiver indisponível.

D1
A Ronda precisa do binding DB para histórico, rondas persistentes e projetos
compartilhados entre dispositivos. O ID do banco pertence à sua conta
Cloudflare e não pode ser preenchido automaticamente neste ZIP.

Se você já usa um D1 na Ronda Editorial atual e quer preservar o histórico,
reutilize esse banco. Se for começar um banco novo, crie `ronda-one-db`.
Depois copie o database_id real para o wrangler.jsonc conforme
CONFIGURAR-D1.txt.

IMPORTANTE SOBRE O MÓDULO EDITORIAL DESTA BASE
O bundle editorial recuperável usado nesta base não pode ser confirmado como a
Ronda Editorial v2.8.5. A arquitetura foi criada para que a atualização exata
da 2.8.5 substitua apenas o módulo editorial, sem reescrever Design, AI e
Projects.
