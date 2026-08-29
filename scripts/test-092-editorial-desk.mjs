import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildEditorialEvent } from '../src/ronda/editorial-events.js';

const now=new Date('2026-08-28T22:45:00.000Z');
const item=(sourceName,url,title,description='')=>({
  kind:'portal',sourceName,collectorName:sourceName,url,title,description,
  publishedAt:'2026-08-28T22:42:00.000Z',region:'Brasil'
});

const strongTopic={
  id:'topic-governo-emprego',
  title:'Governo anuncia medida de emprego e economia com impacto nacional',
  items:[
    item('Agência Oficial','https://noticias.gov.br/emprego','Governo anuncia medida de emprego e economia com impacto nacional','Presidente e governo detalham emprego, imposto e economia.'),
    item('Portal A','https://a.test/emprego','Governo anuncia medida nacional para emprego e economia','Medida afeta emprego, imposto e economia.'),
    item('Portal B','https://b.test/emprego','Nova medida do governo muda regras de emprego','Congresso e governo acompanham impacto no emprego.'),
    item('Portal C','https://c.test/emprego','Economia: medida do governo entra no radar nacional','Emprego e juros estão entre os impactos.'),
    item('Portal D','https://d.test/emprego','Governo detalha nova política de emprego','Presidente apresenta dados da economia e emprego.'),
  ]
};
const strong=buildEditorialEvent(strongTopic,{now});
assert.equal(strong.qualidadeApuracao.level,'AMPLA');
assert.ok(strong.qualidadeApuracao.score>=70);
assert.equal(strong.acaoEditorial.action,'PAUTAR AGORA');
assert.ok(strong.acaoEditorial.reason.length>20);

const conflictTopic={
  id:'topic-acidente',
  title:'Acidente deixa vítimas e mobiliza autoridades',
  items:[
    item('Portal 1','https://p1.test/acidente','Acidente deixa 10 vítimas e mobiliza polícia','Governo e hospital acompanham 10 vítimas.'),
    item('Portal 2','https://p2.test/acidente','Acidente deixa 12 vítimas segundo nova atualização','Polícia informa 12 vítimas.'),
    item('Portal 3','https://p3.test/acidente','Autoridades acompanham acidente com vítimas','Hospital e polícia acompanham o caso.'),
  ]
};
const conflict=buildEditorialEvent(conflictTopic,{now});
assert.ok(conflict.divergencias.length>=1);
assert.equal(conflict.acaoEditorial.action,'VALIDAR');

const limited=buildEditorialEvent({id:'single',title:'Nota isolada',items:[item('Portal Único','https://single.test/a','Nota isolada sem confirmação')]},{now});
assert.equal(limited.qualidadeApuracao.level,'LIMITADA');

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const mesa=read('public/ronda/editorial-mesa.js');
const css=read('public/ronda/editorial-mesa.css');
const platform=read('src/index.js');
assert.match(mesa,/Saúde das fontes/);
assert.match(mesa,/api\/sources\/diagnostics/);
assert.match(mesa,/PAUTAR AGORA/);
assert.match(mesa,/BASE \$\{esc\(quality\)\}/);
assert.match(mesa,/Histórico do evento/);
assert.match(mesa,/Abrir para apuração/);
assert.match(css,/event-source-health-summary/);
assert.match(css,/event-storyline-row/);
assert.match(platform,/editorialDeskV092/);
console.log('RONDA ONE v0.9.2 Mesa Operacional: OK');
