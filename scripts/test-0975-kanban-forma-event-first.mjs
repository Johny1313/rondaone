import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const engine=read('src/production/engine.js');
const design=read('public/design/index.html');
const production=read('public/ronda/editorial-mesa.js');
assert.doesNotMatch(engine,/editorial-event-first/);
assert.match(engine,/scrapeTopicToEvidence\(topic/);
assert.match(design,/editorialEventId/); // mantém vínculo apenas para status/rastreio
assert.match(production,/gerenciamento sem pipeline/i);
console.log('RONDA ONE v0.9.7.5 Kanban desacoplado do FORMA / leitura completa restaurada: OK');
