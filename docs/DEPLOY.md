# Deploy — RONDA ONE v0.9.2.1

## GitHub / Cloudflare Workers Builds

1. Substitua o conteúdo do branch de produção pelo conteúdo deste pacote.
2. Não misture arquivos de v0.9.0/v0.9.1 com a v0.9.2.1.
3. Preserve no Cloudflare os bindings existentes: `DB`, `AI`, `ROUND_JOBS_QUEUE` e `INTELLIGENT_JOBS_QUEUE`.
4. O cron permanece `* * * * *`: Fast Lane a cada minuto e ronda completa nos minutos múltiplos de 3.
5. Faça o deploy completo do Worker, não apenas dos arquivos de frontend.
6. Após o deploy, confira `/api/platform/status`:
   - `version: 0.9.2.1`
   - `editorialVersion: 2.9.2`
   - `editorialDeskV092.enabled: true`
7. Faça um hard refresh em `/ronda` e `/design/` uma vez.

## Validação antes do push

```bash
npm install
npm run test:all
```

Nenhuma nova migração obrigatória do D1 é necessária para a Mesa Operacional. Os novos campos são persistidos dentro do payload JSON do evento e também são calculados ao ler eventos antigos.
