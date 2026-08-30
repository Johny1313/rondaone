import assert from 'node:assert/strict';
import { buildEditorialEvent } from '../src/ronda/editorial-events.js';

// Fixture editorial baseada em publicações reais de 26/08/2026 sobre o mesmo
// julgamento do STF. URLs originais são preservadas para rastreabilidade.
const realItems=[
  {kind:'portal',sourceName:'CNN Brasil',region:'Brasil',title:'STF deve retomar nesta quarta julgamento sobre poder de requisição do MP',description:'Supremo discute limites para que membros do Ministério Público requisitem informações, exames, perícias e recursos materiais.',publishedAt:'2026-08-26T04:15:00-03:00',url:'https://www.cnnbrasil.com.br/politica/stf-deve-retomar-nesta-quarta-julgamento-sobre-poder-de-requisicao-do-mp/'},
  {kind:'portal',sourceName:'Poder360',region:'Brasil',title:'STF suspende julgamento sobre poder do MPF de requisitar perícias',description:'Julgamento trata do alcance do poder do Ministério Público Federal de requisitar perícias, serviços e recursos materiais.',publishedAt:'2026-08-26T18:00:00-03:00',url:'https://www.poder360.com.br/poder-justica/stf-suspende-julgamento-sobre-poder-do-mpf-de-requisitar-pericias/'},
];
const topic={id:'topic-real-mpf',title:realItems[0].title,sourceNames:realItems.map(x=>x.sourceName),items:realItems,lastPublishedAt:realItems[1].publishedAt};
const first=buildEditorialEvent(topic,{runId:'run-editorial-1',now:new Date('2026-08-26T19:00:00-03:00')});
assert.equal(first.editoria,'Política');
assert.equal(first.fontes.length,2);
assert.ok(first.materias.every(item=>item.url?.startsWith('https://')),'links originais devem ser preservados');
assert.ok(first.nivelConfirmacao.reasons.length>=2);

const updatedItems=[...realItems,{kind:'portal',sourceName:'Fonte Teste',region:'Brasil',title:'STF adia conclusão e novo voto será apresentado na próxima sessão',description:'A conclusão do julgamento foi adiada e a análise continuará em nova sessão.',publishedAt:'2026-08-26T19:20:00-03:00',url:'https://example.com/atualizacao-stf'}];
const second=buildEditorialEvent({...topic,items:updatedItems,sourceNames:updatedItems.map(x=>x.sourceName),lastPublishedAt:updatedItems.at(-1).publishedAt},{previous:first,runId:'run-editorial-2',now:new Date('2026-08-26T19:30:00-03:00')});
assert.equal(second.eventId,first.eventId,'evento deve manter identidade entre rondas');
assert.ok(second.informacoesNovas.length>=1,'nova matéria deve produzir delta editorial');
assert.ok(second.mudouDesdeUltimaRonda);

const divergent=[
  {kind:'portal',sourceName:'Fonte A',title:'Acidente deixa 14 vítimas em rodovia',description:'Autoridades informaram 14 vítimas.',publishedAt:'2026-08-27T10:00:00Z',url:'https://example.com/a'},
  {kind:'portal',sourceName:'Fonte B',title:'Acidente deixa 12 vítimas em rodovia',description:'Balanço informa 12 vítimas.',publishedAt:'2026-08-27T10:05:00Z',url:'https://example.com/b'},
];
const divergenceEvent=buildEditorialEvent({id:'topic-div',title:divergent[0].title,sourceNames:['Fonte A','Fonte B'],items:divergent},{now:new Date('2026-08-27T10:10:00Z')});
assert.ok(divergenceEvent.divergencias.length>=1,'números conflitantes devem permanecer visíveis');
console.log('RODADA 2 — EDITORIAL: OK');
