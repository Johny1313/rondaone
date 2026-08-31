import assert from 'node:assert/strict';
import fs from 'node:fs';
const engine=fs.readFileSync(new URL('../src/production/engine.js',import.meta.url),'utf8');
const forma=fs.readFileSync(new URL('../public/design/index.html',import.meta.url),'utf8');

assert.match(engine,/async function ownsProductionLease\(db,lease\)/,'tentativas antigas precisam validar posse da lease antes de gravar');
assert.match(engine,/async function revokeProductionLease\(db,jobId,stage\)/,'retry manual precisa conseguir invalidar a lease anterior');
assert.match(engine,/const revoked=await revokeProductionLease\(env\.DB,id,"reading"\)/,'retry de leitura deve assumir o job antes de relançar');
assert.match(engine,/leaseRevoked:Boolean\(revoked\?\.revoked\)/,'handoff da lease deve ficar registrado no diagnóstico');
assert.match(engine,/if\(!await ownsProductionLease\(db,lease\)\)\{[\s\S]*?Leitura anterior terminou depois de uma nova tentativa assumir o job/,'leitura antiga não pode sobrescrever o novo ciclo');
assert.match(engine,/Falha de uma leitura anterior ignorada porque uma nova tentativa já assumiu o job/,'falha tardia de tentativa antiga deve ser ignorada');
assert.match(engine,/if\(current\?\.leaseBusy\|\|current\?\.deduplicated\)return current;/,'fast path não pode avançar para geração após leitura deduplicada');
assert.match(engine,/if\(!current\?\.evidenceId\)return current;/,'geração não pode iniciar sem Evidence Pack');
assert.match(engine,/Deadline absoluto: handoff da leitura para snapshot\/cache/,'deadline deve fazer handoff, não matar uma leitura ainda com lease ativa');
assert.match(forma,/\$\('#directArticleRetry'\)\.onclick=retryLastFormaProduction/,'botão Tentar novamente deve permanecer ligado ao retry do mesmo job');
assert.match(forma,/Tentando novamente no mesmo job com uma rota de leitura diferente/,'UI deve dar feedback imediato do clique');
console.log('v0.9.7.5.5 Retry Lease Handoff: OK');
