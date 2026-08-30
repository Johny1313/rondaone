import assert from 'node:assert/strict';
import fs from 'node:fs';

const engine=fs.readFileSync(new URL('../src/production/engine.js',import.meta.url),'utf8');
const forma=fs.readFileSync(new URL('../public/design/index.html',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../src/ronda/v285/index.js',import.meta.url),'utf8');

assert.match(engine,/PRODUCTION_SCHEMA_VERSION = "(?:0\.9\.7\.4\.[345678]|0\.9\.7\.5)"/);
assert.match(engine,/production_stage_leases/);
assert.match(engine,/acquireProductionLease/);
assert.match(engine,/Geração já está em execução; tentativa duplicada ignorada/);
assert.match(engine,/READY é terminal/);
assert.match(engine,/A geração com IA não concluiu; finalizando automaticamente pelo modo seguro/);
assert.match(engine,/job\.status==="failed"&&job\.evidenceId/);
assert.match(engine,/PRODUCTION_HARD_DEADLINE_MS = 20_000/);

assert.match(forma,/deadline=startedAt\+26\*1000/);
assert.match(forma,/Não dispara outra IA em paralelo/);
assert.match(forma,/fallbackAttempts<4/);
assert.match(forma,/A IA não concluiu\. Finalizando automaticamente com as evidências já lidas/);
assert.doesNotMatch(forma,/idle>=4000&&recoveryCalls<2/);

assert.match(index,/engineVersion:"0\.9\.7\.4\.[345678]"/);

console.log('v0.9.7.4.3 Terminal Carousel Completion OK');
