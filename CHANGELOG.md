# Changelog

## 0.9.2 — Mesa Operacional

- ação editorial: Pautar agora / Acompanhar / Validar / Observar;
- qualidade da apuração: Ampla / Parcial / Limitada;
- saúde persistida das fontes exibida na Mesa;
- histórico operacional do evento;
- apuração direta nos cards e detalhe;
- decoração automática de eventos antigos com os novos campos;
- limpeza de documentação e scripts obsoletos do pacote.

## 0.9.1 — Unified Main + Carousel Queue Recovery

- Mesa passa a alimentar a coleta principal;
- atualização editorial sem depender de novo `runId`;
- Queue torna-se dona única do processamento de carrossel;
- heartbeat e recuperação segura de jobs órfãos.

## 0.9.0 — Fast News Engine

- Fast Lane de 1 minuto;
- RSS + scraping HTML leve + fallback + cache;
- `firstSeenAt`, `discoveredAt` e `lastSeenAt`;
- filtros curtos baseados na descoberta recente.

As versões anteriores permanecem preservadas no histórico Git e não precisam permanecer como dezenas de arquivos `ATUALIZAR-PARA-*` na raiz do branch principal.
