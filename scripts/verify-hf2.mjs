import { readFile, access } from 'node:fs/promises';

const base=new URL('../',import.meta.url);
const read=(p)=>readFile(new URL(p,base),'utf8');
const [integration,shell,service]=await Promise.all([
  read('public/ronda/ronda-one-integration.js'),
  read('src/ronda/shell.js'),
  read('src/projects/service.js'),
]);

const checks=[
  ['service no caminho correto', async()=>{ await access(new URL('src/projects/service.js',base)); return true;}],
  ['HF2 cache bust', ()=>/HOTFIX_REV='0\.7\.7-hf2'/.test(shell)],
  ['HF2 integration build', ()=>/hf2-visual-flow-stable/.test(integration)],
  ['recovery lock preservado', ()=>/if\(recoveryPromise\)return recoveryPromise/.test(integration)],
  ['observer do modal só childList', ()=>/observe\(modalNode,\{\s*subtree:true,\s*childList:true\s*\}\)/m.test(integration)],
  ['sem observer amplo disabled-class', ()=>!(/attributeFilter:\['disabled','hidden','class'\]/.test(integration))],
  ['visuals preservados no handoff', ()=>/fetchArticleVisualsForHandoff/.test(integration)],
  ['botões abaixo do gerar novamente', ()=>/ensureRondaDesignFlow/.test(integration)],
  ['multi image preservado', ()=>/multi-image-per-carousel/.test(service)],
  ['Fonte da foto preservada', ()=>/Fonte da foto/.test(service)],
];

let failed=0;
for(const [label,test] of checks){
  let ok=false; try{ok=await test();}catch{}
  console.log(`${ok?'OK':'FAIL'} - ${label}`);
  if(!ok)failed++;
}
if(failed)process.exit(1);
console.log('\nHF2 recovery verificado com sucesso.');
