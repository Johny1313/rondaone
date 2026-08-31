import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const read=(p)=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const bytes=(p)=>fs.readFileSync(new URL(`../${p}`,import.meta.url));
const engine=read('src/production/engine.js');
const pkg=JSON.parse(read('package.json'));

assert.ok(['0.9.7.5.8','0.9.7.5.9'].includes(pkg.version));
assert.match(engine,/retryMode:body\.retryMode\|\|null/,'ARTICLE_READ_QUEUE deve preservar a estratégia do retry manual');
assert.match(engine,/readQueue\.send\(\{type:"production-read",jobId:id,force:retryMode!=="snapshot",retryMode,manualRetry:true,retryNumber\}\)/,'retry manual deve ser durável na ARTICLE_READ_QUEUE');
assert.match(engine,/Retry manual \$\{retryNumber\} entregue à ARTICLE_READ_QUEUE/);
assert.match(engine,/Consumer de leitura terminou sem Evidence Pack; geração bloqueada/,'nenhuma geração pode iniciar sem Evidence Pack');
assert.match(engine,/if\(job\.status!=="failed"&&job\.evidenceId\)/,'CAROUSEL_AI só pode receber job com Evidence Pack');
assert.match(engine,/ARTICLE_READ_QUEUE indisponível no retry manual; contingência direta acionada/,'execução direta só pode ser fallback da Queue');
assert.match(engine,/const retryMode=retryNumber===1\?'alternate':retryNumber===2\?'deep':'snapshot'/,'escada alternate → deep → snapshot deve permanecer');
assert.match(engine,/revokeProductionLease\(env\.DB,id,"reading"\)/,'retry deve revogar lease anterior antes de requeue');

const frozen={
  'src/production/scraping-engine.js':'d5cd2aba4f110ff93f319e0e8f297f51db9478fb1c9dfbb48338cd8c4dc50357',
  'src/ronda/v285/article-reader.js':'944bff72b03f3c15a10e42a12541aef9af531c676801add27474a3b5165fc722',
  'public/design/index.html':'1af86252a341dd292218ef21aca97d6623d3a9d96ed6bff478d43b353195b156',
};
for(const [file,expected] of Object.entries(frozen)){
  const actual=crypto.createHash('sha256').update(bytes(file)).digest('hex');
  assert.equal(actual,expected,`${file} mudou; bloquear release para preservar qualidade do carrossel`);
}

console.log('v0.9.7.5.8 Durable Carousel Retry Queue + Evidence Gate OK');
