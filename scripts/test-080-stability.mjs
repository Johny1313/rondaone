import assert from 'node:assert/strict';
import { buildEditorialEvent, buildProductionFromEvent } from '../src/ronda/editorial-events.js';

const baseItem={kind:'portal',sourceName:'Portal Estável',region:'Brasil',title:'Governo confirma reunião para sexta-feira',description:'A reunião foi confirmada para sexta-feira.',publishedAt:'2026-08-27T15:00:00Z',url:'https://example.com/reuniao'};
const topic={id:'topic-stable',title:baseItem.title,sourceNames:[baseItem.sourceName],items:[baseItem,baseItem],lastPublishedAt:baseItem.publishedAt};
const first=buildEditorialEvent(topic,{runId:'run-1',now:new Date('2026-08-27T15:05:00Z')});
const second=buildEditorialEvent(topic,{previous:first,runId:'run-2',now:new Date('2026-08-27T15:10:00Z')});
assert.equal(second.eventId,first.eventId,'idempotência do evento');
assert.equal(second.informacoesNovas.length,0,'conteúdo repetido não deve ser reprocessado como novidade');
assert.equal(new Set(second.fatosConhecidos.map(f=>f.factId)).size,second.fatosConhecidos.length,'fatos devem ser deduplicados');
const production=buildProductionFromEvent(second,'carousel');
assert.ok(production.slides.every(slide=>typeof slide.body==='string'));
assert.ok(production.sources.every(source=>source.url),'produção deve manter rastreabilidade');

const partial=buildEditorialEvent({id:'topic-partial',title:'Fonte com leitura parcial',sourceNames:['Portal'],items:[{kind:'portal',sourceName:'Portal',title:'Fonte com leitura parcial',publishedAt:'2026-08-27T15:00:00Z',url:'https://example.com/partial'}]},{now:new Date('2026-08-27T15:10:00Z')});
assert.ok(partial.eventId,'falha/ausência de descrição não pode derrubar o evento');
assert.ok(partial.pontosEmAberto.length,'incertezas devem ser explicitadas como perguntas');
console.log('RODADA 3 — ESTABILIDADE: OK');
