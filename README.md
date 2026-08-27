# RONDA ONE Cloud v0.7.9 — Carousel First + Coleta Boost

Versão completa do RONDA ONE para Cloudflare Workers.

## Prioridades desta versão

1. ampliar a captação real dos portais cadastrados;
2. abrir e ler a matéria original antes de gerar o carrossel;
3. nunca criar fatos que não estejam sustentados pela matéria;
4. garantir que o processamento do carrossel termine em um estado claro;
5. usar imagens da própria matéria ou bancos de imagem livres;
6. manter o FORMA/RONDA DESIGN sem geração de imagem por IA.

## Coleta

O catálogo possui 39 fontes: 26 Brasil e 13 Mundo.

A v0.7.9 acrescenta:

- orçamento de consultas externas de até 120 por ronda;
- fallback dedicado por domínio para cada portal;
- complemento de feeds com poucos resultados;
- concorrência de coleta 8;
- fontes médias consultadas a cada 10 minutos;
- demais fontes consultadas a cada 15 minutos;
- até 900 itens no snapshot;
- até 80 assuntos;
- parser de feed com até 6 MB de XML.

O teto de 120 é um limite de segurança, não uma meta de consumo. O coletor encerra rotas adicionais quando já obteve cobertura suficiente e reaproveita cache/validators.

## Busca ampliada

O campo de busca mantém o filtro do snapshot atual e, com 3 ou mais caracteres, consulta também `/api/search-news` nos domínios cadastrados no RONDA.

A busca ampliada mantém a janela editorial de 24 horas e pode retornar até 80 itens.

## Leitura das matérias

Antes do carrossel, o RONDA tenta chegar à matéria original e extrair o texto principal.

A v0.7.9 usa:

- até 4 MB de HTML;
- até 20 mil caracteres úteis;
- 6,5 s para a página principal;
- 3,5 s para AMP;
- até 14 s de orçamento total de leitura;
- resolvedor de URL do portal quando a descoberta chega por agregador.

O carrossel só é aprovado quando existe leitura direta da matéria ou cache produzido por uma leitura direta anterior. RSS e agregadores podem descobrir uma pauta, mas não substituem a leitura da matéria para validação factual.

## Carrossel

A regra editorial é obrigatória:

- nenhuma notícia é inventada;
- nenhuma lacuna factual é preenchida por suposição;
- fatos, datas, nomes e números precisam ser sustentados pela matéria;
- se uma fonte não puder ser lida, o sistema tenta outras fontes do mesmo assunto;
- se nenhuma fonte puder ser validada, o job termina bloqueado com um motivo claro;
- o fallback determinístico usa somente evidências extraídas da matéria.

O Workers AI pode permanecer disponível internamente para redação editorial e traduções existentes, mas o carrossel possui fallback determinístico e não depende da IA para terminar o processamento.

## FORMA / RONDA DESIGN

A geração de imagem por IA está desativada no produto.

Prioridade visual:

1. imagem da matéria;
2. Banco Free (Wikimedia Commons);
3. upload manual;
4. GIPHY;
5. composição gráfica.

As rotas públicas `/api/ai/*` usadas pelo Design retornam `410 DESIGN_AI_REMOVED`.

Imagens obtidas de matérias mantêm origem/crédito para revisão editorial. A presença de uma imagem em uma notícia não garante automaticamente direito de republicação; a redação deve conferir a autorização/licença antes de publicar.

## Cloudflare

A aplicação usa:

- Workers;
- D1;
- Queues;
- Assets;
- cron a cada 5 minutos;
- observability.

A fila de carrossel está configurada com `max_concurrency: 4` e `max_batch_timeout: 1`, aproveitando o Workers Paid.

## Deploy

```bash
npm install
npm run check
npm run verify:079
npm run deploy
```

No GitHub, este pacote pode substituir o conteúdo do repositório atual. Não é necessário aplicar os ZIPs de patch 0.7.8 ou 0.7.9 separadamente.

## Verificação

`npm run verify:079` confere versão, 39 fontes, coleta ampliada, busca, leitura de matérias, remoção funcional da IA no Design, Queue e parser.
