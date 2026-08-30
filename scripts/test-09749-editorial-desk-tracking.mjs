import assert from 'node:assert/strict';
import fs from 'node:fs';
import { topicFromEditorialEvent } from '../src/ronda/v285/unified-round.js';

const updatedAt='2026-08-30T14:30:00.000Z';
const publishedAt='2026-08-29T10:00:00.000Z';
const topic=topicFromEditorialEvent({
  eventId:'event-desk-test-001',titulo:'Evento atualizado',editoria:'Notícias',status:'EM DESENVOLVIMENTO',relevancia:70,
  mudouDesdeUltimaRonda:true,criadoEm:'2026-08-29T09:00:00.000Z',atualizadoEm:updatedAt,ultimaAtualizacao:updatedAt,
  materias:[{articleKey:'a1',url:'https://example.test/a',title:'Matéria original',sourceName:'Fonte Teste',publishedAt}],
  informacoesNovas:[{text:'Informação nova sem vínculo de URL',evidence:[]}],fontes:[],tracao:{score:20,growth30m:0},sugestoesPauta:[]
});
assert.ok(topic);
assert.equal(topic.items[0].publishedAt,publishedAt,'publishedAt original deve ser preservado');
assert.equal(topic.items[0].radarAt,updatedAt,'evento atualizado precisa aparecer como atividade recente na Principal');

const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const db=read('src/ronda/v285/database.js');
const worker=read('src/ronda/v285/index.js');
const mesa=read('public/ronda/editorial-mesa.js');
const production=read('public/ronda/production-view.js');
const app=read('public/ronda/app.js');
const design=read('public/design/index.html');
const platform=read('src/index.js');

assert.match(db,/editorial_production_tracking/);
assert.match(db,/editorial_production_events/);
assert.match(db,/send_to_forma/);
assert.match(db,/completed_by_user_id/);
assert.match(worker,/\/api\/newsroom\/event-production/);
assert.match(mesa,/Mesa Editorial/);
assert.match(production,/Produção/);
assert.match(production,/Aprovação/);
assert.match(production,/Finalização/);
assert.match(production,/Concluído/);
assert.match(app,/main.*Principal|Eventos editoriais atualizados precisam permanecer visíveis na Principal/s);
assert.match(design,/markEditorialProductionComplete/);
assert.match(design,/action:'complete'/);
assert.match(design,/aiDownloadImage/);
assert.doesNotMatch(design,/function aiDownloadImage[\s\S]{0,300}action:'complete'/);
assert.match(platform,/editorialDeskTrackingV09749/);

console.log('RONDA ONE v0.9.7.4.9 Editorial Desk Tracking + Main/Novidades: OK');
