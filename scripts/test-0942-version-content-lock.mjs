import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const engineCode=read('public/design/smart-template-engine.js');
const context={console,location:{origin:'https://ronda.test'}};context.globalThis=context;vm.createContext(context);vm.runInContext(engineCode,context);
const E=context.RondaSmartTemplates;
assert.equal(E.VERSION,'1.2.0');
const template={id:'t1',name:'T1',project:{artboards:[{id:'b1',name:'Content',templateRole:'content',width:1080,height:1080,elements:[
  {id:'title',type:'text',name:'Title',semanticSlot:'TITLE',x:0,y:0,w:900,h:200,fontSize:64,text:''},
  {id:'body',type:'text',name:'Body',semanticSlot:'BODY',x:0,y:220,w:900,h:400,fontSize:32,text:''}
]}]}};
const model1={version:1,title:'A',source:'Fonte',slides:[{number:1,index:0,role:'Conteúdo',roleType:'content',title:'Título IA 1',subtitle:'Texto 1',body:'Texto 1',source:'Fonte'}]};
const first=E.applyTemplate(template,model1);
assert.equal(first.boards[0].elements.find(e=>e.semanticSlot==='TITLE').text,'Título IA 1');
const locked=structuredClone(first.boards);
const title=locked[0].elements.find(e=>e.semanticSlot==='TITLE');title.text='Título editado pelo jornalista';title.semanticContentLocked=true;
const model2={...model1,slides:[{...model1.slides[0],title:'Título IA 2',subtitle:'Texto 2',body:'Texto 2'}]};
const second=E.applyTemplate(template,model2,{preserveLockedBoards:locked});
assert.equal(second.boards[0].elements.find(e=>e.semanticSlot==='TITLE').text,'Título editado pelo jornalista');
assert.equal(second.boards[0].elements.find(e=>e.semanticSlot==='BODY').text,'Texto 2');
assert.equal(second.stats.contentLocksPreserved,1);
const db=read('src/ronda/v285/database.js'),worker=read('src/ronda/v285/index.js'),design=read('public/design/index.html'),platform=read('src/index.js');
assert.match(db,/CREATE TABLE IF NOT EXISTS carousel_versions/);
assert.match(worker,/\/api\/carousel-versions/);
assert.match(design,/saveCloudRevision/);
assert.match(design,/semanticContentLocked/);
assert.match(platform,/carouselVersioningV0942/);
console.log('RONDA ONE v0.9.4.2 Versionamento + Content Lock: OK');
