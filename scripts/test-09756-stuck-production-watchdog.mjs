import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync(new URL('../src/ronda/v285/index.js',import.meta.url),'utf8');
const engine=fs.readFileSync(new URL('../src/production/engine.js',import.meta.url),'utf8');
const platform=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const db=fs.readFileSync(new URL('../src/ronda/v285/database.js',import.meta.url),'utf8');

assert.match(engine,/autoRecoverStaleProductionJobs/);
assert.match(engine,/recoverStalledProductionJob\(env,row\.id,\{ctx\}\)/);
assert.match(worker,/autoRecoverStaleProductionJobs\(env,\{limit:1,ctx\}\)/);
assert.match(worker,/\/api\/admin\/production-jobs\/diagnostics/);
assert.match(worker,/getProductionOperationalDiagnostics/);

// GET de status do job deve ser observacional; recovery pertence ao scheduler/POST.
const getStart=worker.indexOf('if (productionJobMatch && request.method === "GET")');
const getEnd=worker.indexOf('const productionRetryMatch',getStart);
assert.ok(getStart>0&&getEnd>getStart);
assert.doesNotMatch(worker.slice(getStart,getEnd),/recoverStalledProductionJob/);

// A métrica técnica não pode usar workflow editorial humano.
assert.match(platform,/FROM production_jobs WHERE status IN \('queued','running'\)/);
assert.doesNotMatch(platform,/FROM production_workflow .*stuck/i);
assert.match(platform,/activeProduction/);
assert.match(platform,/recoveringProduction/);
assert.match(platform,/oldestActiveAgeSeconds/);
assert.match(platform,/oldestHeartbeatAgeSeconds/);

// Garante que tabelas editoriais continuam separadas no schema legado/consolidado.
assert.match(db,/CREATE TABLE IF NOT EXISTS production_workflow/);
assert.match(db,/CREATE TABLE IF NOT EXISTS editorial_production_tracking/);
assert.match(engine,/CREATE TABLE IF NOT EXISTS production_jobs/);

assert.match(engine,/PRODUCTION_SCHEMA_VERSION = "0\.9\.7\.5\.[68]"/);
console.log('OK 0.9.7.5.6 stuckProduction watchdog hotfix');
