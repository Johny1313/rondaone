import assert from 'node:assert/strict';
import fs from 'node:fs';

const engine=fs.readFileSync(new URL('../src/production/engine.js',import.meta.url),'utf8');
const forma=fs.readFileSync(new URL('../public/design/index.html',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../src/ronda/v285/index.js',import.meta.url),'utf8');
const waitBlock=forma.slice(forma.indexOf('async function waitFormaProductionJob'),forma.indexOf('async function startFormaProduction'));

assert.match(engine,/PRODUCTION_SCHEMA_VERSION = "(?:0\.9\.7\.4\.[345678]|0\.9\.7\.5(?:\.[1-4])?)"/);
assert.match(engine,/production_stage_leases/);
assert.match(engine,/acquireProductionLease/);
assert.match(engine,/Geração já está em execução; tentativa duplicada ignorada/);
assert.match(engine,/READY é terminal/);
assert.match(engine,/A geração com IA não concluiu; finalizando automaticamente pelo modo seguro/);
assert.match(engine,/job\.status==="failed"&&job\.evidenceId/);
assert.match(engine,/PRODUCTION_HARD_DEADLINE_MS = 45_000/);
assert.match(engine,/PRODUCTION_ABSOLUTE_DEADLINE_MS = 55_000/);
assert.match(engine,/fallbackCount>=1/);
assert.match(engine,/singleCoordinator:true/);

assert.match(forma,/clientSafetyCeiling=startedAt\+65\*1000/);
assert.doesNotMatch(waitBlock,/\/retry/);
assert.doesNotMatch(waitBlock,/\/fallback/);
assert.match(forma,/backend está executando a recuperação do mesmo job/);
assert.match(index,/engineVersion:"0\.9\.7\.5\.[1-4]"/);

console.log('v0.9.7.4.3 Terminal Completion preservado com coordenador único atual OK');
