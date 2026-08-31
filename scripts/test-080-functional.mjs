import assert from 'node:assert/strict';
import { buildTopics } from '../src/ronda/v285/clustering.js';
import { buildEditorialEvent, buildProductionFromEvent } from '../src/ronda/editorial-events.js';

const now=new Date('2026-08-27T18:00:00-03:00');
const items=[
  {id:'a',kind:'portal',sourceName:'Agência Brasil',region:'Brasil',title:'STF inicia julgamento sobre acesso a registros de conexão',description:'Supremo analisa regra sobre acesso a endereços IP e registros de conexão.',publishedAt:'2026-08-27T17:10:00-03:00',url:'https://agenciabrasil.ebc.com.br/justica/noticia/teste-stf'},
  {id:'b',kind:'portal',sourceName:'CNN Brasil',region:'Brasil',title:'Supremo começa análise sobre acesso de autoridades a registros de conexão',description:'Julgamento discute a necessidade de decisão judicial para acessar registros de conexão.',publishedAt:'2026-08-27T17:22:00-03:00',url:'https://www.cnnbrasil.com.br/politica/teste-stf'},
  {id:'c',kind:'portal',sourceName:'Poder360',region:'Brasil',title:'STF julga regra do Marco Civil sobre registros de conexão',description:'Corte discute acesso de autoridades a endereços IP no Marco Civil da Internet.',publishedAt:'2026-08-27T17:35:00-03:00',url:'https://www.poder360.com.br/poder-justica/teste-stf'},
];
const topics=buildTopics(items,now,20);
assert.equal(topics.length,1,'as três matérias devem formar um assunto');
const separated=buildTopics([...items,{id:'d',kind:'portal',sourceName:'ge',region:'Brasil',title:'Seleção brasileira convoca jogadores para amistoso',description:'Técnico anuncia lista para partida de futebol.',publishedAt:'2026-08-27T17:40:00-03:00',url:'https://ge.globo.com/teste-selecao'}],now,20);
assert.ok(separated.length>=2,'assuntos sem relação não devem ser fundidos');
const event=buildEditorialEvent(topics[0],{runId:'run-functional',now});
assert.ok(event.eventId.startsWith('event-'));
assert.equal(event.editoria,'Política');
assert.ok(event.fontes.length>=3);
assert.ok(event.timeline.length>=2);
assert.ok(event.fatosConhecidos.every(f=>f.evidence?.length),'todo fato deve manter evidência');
assert.ok(['NOVO','BREAKING','EM ALTA'].includes(event.status));
const carousel=buildProductionFromEvent(event,'carousel');
assert.ok(carousel.slides.length>=6);
assert.equal(carousel.unsupportedFactsAllowed,false);
assert.ok(carousel.sources.length>=3);
console.log('RODADA 1 — FUNCIONAL: OK');
