import { readFile } from 'node:fs/promises';
const file = new URL('../src/ronda/v285/free-runtime.js', import.meta.url);
const text = await readFile(file, 'utf8');
const checks = [
  ['HF3.2', /freeMode:\s*'hf3\.2'/.test(text)],
  ['1 fonte por job', /FREE_SOURCE_BATCH_SIZE\s*=\s*1/.test(text)],
  ['2 itens por fonte', /FREE_ITEMS_PER_SOURCE\s*=\s*2/.test(text)],
  ['payload 96', /FREE_PAYLOAD_ITEM_LIMIT\s*=\s*96/.test(text)],
  ['24 tópicos', /FREE_TOPIC_LIMIT\s*=\s*24/.test(text)],
  ['pipeline snapshot', /round-snapshot/.test(text)],
  ['coleta direta collectFeed', /collectFeed\(/.test(text)],
  ['não usa collectRound completo', !/collectRound as collectCoreRound/.test(text)],
  ['source state persistido antes do snapshot', /saveSourceStates\(db,\s*\[update\]\)/.test(text)],
  ['leitura compacta D1', /json_extract\(items_json,\s*'\$\[0\]'\)/.test(text)],
  ['tradução separada', /round-enrich/.test(text)],
  ['Mesa separada', /round-newsroom/.test(text)],
  ['monitoramento separado', /round-monitor/.test(text)],
  ['social separado', /round-social/.test(text)],
];
let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'OK' : 'FAIL'} - ${label}`);
  if (!ok) failed++;
}
if (failed) process.exit(1);
console.log('HF3.2 Free Pipeline verificado.');
