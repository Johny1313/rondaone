import { readFile } from 'node:fs/promises';
const router = await readFile(new URL('../src/ronda/router.js', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../src/ronda/v285/free-runtime.js', import.meta.url), 'utf8');
const checks = [
  ['router usa runtime gratuito', /runFreeRoundQueue/.test(router)],
  ['mensagens intelligent continuam no worker original', /rondaWorker\.queue/.test(router)],
  ['batch de fontes = 3', /FREE_SOURCE_BATCH_SIZE\s*=\s*3/.test(runtime)],
  ['persistência antecipada do source state', /saveSourceStates\(db, core\.sourceStateUpdates\)/.test(runtime)],
  ['tradução separada', /round-enrich/.test(runtime)],
  ['Mesa separada', /round-newsroom/.test(runtime)],
  ['tradução progressiva = 4', /FREE_TRANSLATIONS_PER_JOB\s*=\s*4/.test(runtime)],
  ['payload reduzido', /FREE_PAYLOAD_ITEM_LIMIT\s*=\s*240/.test(runtime)],
  ['fallback pesado evitado no modo free', /function freeFeedVariant/.test(runtime)],
];
let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'OK' : 'FAIL'} - ${label}`);
  if (!ok) failed++;
}
if (failed) process.exit(1);
console.log('HF3.1 Free Rotation verificado.');
