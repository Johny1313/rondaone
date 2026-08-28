import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const engineCode=fs.readFileSync(new URL('../public/design/smart-template-engine.js',import.meta.url),'utf8');
const context={console};context.globalThis=context;vm.createContext(context);vm.runInContext(engineCode,context);
const E=context.RondaSmartTemplates;assert.ok(E);assert.equal(E.VERSION,'1.0.0');

const project={title:'Notícia de teste',editoria:'Notícias',verificationLinks:[{sourceName:'Agência Brasil'}],slides:[
 {number:1,role:'Título principal',title:'Título grande que precisa se adaptar ao box do template',subtitle:'Resumo da capa',visual:{asset:{url:'https://img.test/1.jpg',credit:'Agência'}}},
 {number:2,role:'Contexto',title:'Entenda o cenário',subtitle:'Texto explicativo com várias palavras e conteúdo editorial.'},
 {number:3,role:'CTA',title:'Continue acompanhando',subtitle:'Veja as próximas atualizações.'}
]};
const model=E.buildContentModel(project);assert.equal(model.slides.length,3);assert.equal(model.slides[0].roleType,'cover');assert.equal(model.slides[2].roleType,'closing');

const tpl=E.compileTemplate({docTitle:'Modelo',artboards:[
 {id:'cover',name:'CAPA',width:1080,height:1350,bg:'#000000',elements:[{id:'t1',type:'text',name:'Título',x:80,y:700,w:900,h:220,fontSize:82,lineHeight:1,text:'PLACEHOLDER'},{id:'i1',type:'image',name:'Imagem',x:0,y:0,w:1080,h:650,src:'placeholder.jpg'}]},
 {id:'body',name:'CONTEÚDO',width:1080,height:1350,bg:'#ffffff',elements:[{id:'t2',type:'text',name:'Título',x:80,y:100,w:900,h:180,fontSize:62,lineHeight:1,text:'T'},{id:'b2',type:'text',name:'Texto',x:80,y:330,w:900,h:500,fontSize:38,lineHeight:1.1,text:'B'},{id:'s2',type:'text',name:'Fonte',x:80,y:1200,w:900,h:60,fontSize:20,lineHeight:1,text:'F'}]},
 {id:'end',name:'ENCERRAMENTO CTA',width:1080,height:1350,bg:'#111111',elements:[{id:'t3',type:'text',name:'Título',x:80,y:500,w:900,h:220,fontSize:76,lineHeight:1,text:'T'},{id:'c3',type:'text',name:'CTA',x:80,y:800,w:900,h:200,fontSize:36,lineHeight:1.1,text:'CTA'}]}
]},{id:'tpl1',name:'Modelo'});
assert.equal(tpl.smart,true);assert.ok(tpl.slotCount>=7);
const applied=E.applyTemplate(tpl,model);assert.equal(applied.boards.length,3);assert.equal(applied.boards[0].templateRole,'cover');assert.equal(applied.boards[2].templateRole,'closing');
const coverTitle=applied.boards[0].elements.find(x=>x.semanticSlot==='TITLE');assert.equal(coverTitle.text,model.slides[0].title);const coverImage=applied.boards[0].elements.find(x=>x.semanticSlot==='IMAGE');assert.equal(coverImage.src,'https://img.test/1.jpg');
const bodySource=applied.boards[1].elements.find(x=>x.semanticSlot==='SOURCE');assert.equal(bodySource.text,'Fonte: Agência Brasil');
const detached=E.detachBoards(applied.boards);assert.equal(detached[0].elements.some(x=>x.semanticSlot),false);
console.log('RONDA ONE v0.8.6 Smart Templates: engine OK');
