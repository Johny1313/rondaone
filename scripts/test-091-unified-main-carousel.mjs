import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mergeEditorialEventsIntoRound, topicFromEditorialEvent } from '../src/ronda/v285/unified-round.js';

const base={
  ok:true,
  runId:'run-1',
  collectedAt:'2026-08-28T21:50:00.000Z',
  items:[{
    id:'raw-1',kind:'portal',platform:'Portal',url:'https://portal.test/a',title:'Notícia A',description:'',sourceName:'Portal A',collectorName:'Portal A',region:'Brasil',publishedAt:'2026-08-28T21:45:00.000Z',firstSeenAt:'2026-08-28T21:46:00.000Z'
  }],
  topics:[{
    id:'topic-a',title:'Notícia A',editoria:'Notícias',priority:'Novidade',tone:'normal',score:55,lastPublishedAt:'2026-08-28T21:45:00.000Z',sourceNames:['Portal A'],sourceCount:1,itemCount:1,portalCount:1,socialCount:0,momentum:'Assunto recém-detectado',recommendation:'Acompanhar',items:[{
      id:'raw-1',kind:'portal',platform:'Portal',url:'https://portal.test/a',title:'Notícia A',description:'',sourceName:'Portal A',collectorName:'Portal A',region:'Brasil',publishedAt:'2026-08-28T21:45:00.000Z',firstSeenAt:'2026-08-28T21:46:00.000Z'
    }]
  }],
  totals:{items:1,topics:1,sources:1,socialItems:0}
};

const events=[{
  eventId:'event-a',titulo:'Notícia A ganhou atualização',editoria:'Brasil',status:'EM DESENVOLVIMENTO',relevancia:78,tracao:{score:67,growth30m:120},mudouDesdeUltimaRonda:true,criadoEm:'2026-08-28T21:46:00.000Z',atualizadoEm:'2026-08-28T21:49:30.000Z',primeiraPublicacao:'2026-08-28T21:45:00.000Z',ultimaAtualizacao:'2026-08-28T21:49:00.000Z',sugestoesPauta:['O que mudou'],informacoesNovas:[{text:'Nova informação',evidence:[{url:'https://portal.test/b'}]}],materias:[
    {articleKey:'a',url:'https://portal.test/a',title:'Notícia A',description:'A',sourceName:'Portal A',publishedAt:'2026-08-28T21:45:00.000Z',region:'Brasil',kind:'portal'},
    {articleKey:'b',url:'https://portal.test/b',title:'Atualização da notícia A',description:'B',sourceName:'Portal B',publishedAt:'2026-08-28T21:49:00.000Z',region:'Brasil',kind:'portal'}
  ]
},{
  eventId:'event-c',titulo:'Evento que saiu da janela bruta da última ronda',editoria:'Economia',status:'EM ALTA',relevancia:83,tracao:{score:82,growth30m:200},mudouDesdeUltimaRonda:false,criadoEm:'2026-08-28T21:40:00.000Z',atualizadoEm:'2026-08-28T21:48:00.000Z',primeiraPublicacao:'2026-08-28T21:40:00.000Z',ultimaAtualizacao:'2026-08-28T21:48:00.000Z',materias:[
    {articleKey:'c',url:'https://portal.test/c',title:'Economia em aceleração',description:'C',sourceName:'Portal C',publishedAt:'2026-08-28T21:48:00.000Z',region:'Brasil',kind:'portal'}
  ]
}];

const unified=mergeEditorialEventsIntoRound(structuredClone(base),events,new Date('2026-08-28T21:50:00.000Z'));
assert.equal(unified.editorialOverlay.enabled,true);
assert.equal(unified.editorialOverlay.mergedEvents,1);
assert.equal(unified.editorialOverlay.addedTopics,1);
assert.equal(unified.items.length,3);
assert.ok(unified.topics.some(topic=>topic.id==='event-c'));
const merged=unified.topics.find(topic=>topic.id==='topic-a');
assert.equal(merged.items.length,2);
assert.equal(merged.editorialEvent.eventId,'event-a');
assert.equal(merged.items.find(item=>item.url==='https://portal.test/b').radarAt,'2026-08-28T21:49:30.000Z');
const eventTopic=topicFromEditorialEvent(events[1]);
assert.equal(eventTopic.id,'event-c');
assert.ok(eventTopic.carousel);
assert.equal(eventTopic.sourceCount,1);

const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const worker=read('src/ronda/v285/index.js');
const db=read('src/ronda/v285/database.js');
const app=read('public/ronda/app.js');
const design=read('public/design/index.html');
const platform=read('src/index.js');
assert.match(worker,/mergeEditorialEventsIntoRound/);
assert.match(worker,/fast-lane-unified-no-heavy-enrichment/);
assert.match(worker,/http never vira um segundo consumidor|HTTP nunca vira um segundo consumidor/i);
assert.match(worker,/queueOwned/);
assert.match(worker,/touchIntelligentJob/);
assert.match(worker,/globalThis\.setInterval/);
assert.doesNotMatch(worker,/status: "failed",\n\s*progress: 100,\n\s*message: "O processamento ficou sem progresso/);
assert.match(db,/\? 45 \* 1000/);
assert.match(db,/\? 90 \* 1000/);
assert.match(db,/legacyLockConflict/);
assert.match(app,/item\.radarAt/);
assert.match(app,/ETag próprio do overlay editorial/);
assert.match(app,/todo payload novo precisa alimentar a página principal/);
assert.doesNotMatch(app,/payload\.runId !== state\.lastRunId \|\| force\)\) applyRound/);
assert.match(design,/A Queue já assumiu esta matéria/);
assert.match(platform,/unifiedMainV091/);
assert.match(platform,/carouselQueueOwnershipV091/);
console.log('RONDA ONE v0.9.1 Unified Main + Carousel Queue Ownership: OK');
