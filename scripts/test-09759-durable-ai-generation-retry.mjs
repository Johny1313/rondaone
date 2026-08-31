import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const read=(p)=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const bytes=(p)=>fs.readFileSync(new URL(`../${p}`,import.meta.url));
const engine=read('src/production/engine.js');
const platform=read('src/index.js');
const pkg=JSON.parse(read('package.json'));

assert.equal(pkg.version,'0.9.7.5.9');
assert.match(platform,/durableAiGenerationRetryV09759/);
assert.match(engine,/carouselQueue\.send\(\{type:"production-generate",jobId:id,manualRetry:true,recovery:true\}\)/,'retry manual da geração deve entrar na CAROUSEL_AI_QUEUE');
assert.match(engine,/Retry manual de geração entregue à CAROUSEL_AI_QUEUE/);
assert.match(engine,/transport:"CAROUSEL_AI_QUEUE"/,'evento do retry manual deve registrar transporte durável');
assert.match(engine,/q\.send\(\{type:"production-generate",jobId:id,recovery:true\}\)/,'recovery automático de geração deve reenfileirar na CAROUSEL_AI_QUEUE');
assert.match(engine,/Recovery automático entregue à CAROUSEL_AI_QUEUE/);
assert.doesNotMatch(engine,/Queue de IA sem progresso; geração direta retomada/,'recovery automático não pode preferir execução direta');
assert.match(engine,/body\.type==="production-generate"\) await processProductionGenerate\(env,body\.jobId,\{deterministicOnly:Boolean\(body\.deterministicOnly\)\}\)/,'consumer deve preservar opção de fallback determinístico pela Queue');

const retryStart=engine.indexOf('if(stage==="generate"&&job.evidenceId)');
const retryEnd=engine.indexOf('const retryRows=',retryStart);
assert.ok(retryStart>=0&&retryEnd>retryStart,'bloco de retry manual da geração deve existir');
const retryBlock=engine.slice(retryStart,retryEnd);
const enqueueAt=retryBlock.indexOf('carouselQueue.send');
const directAt=retryBlock.indexOf('runDirectProductionRecovery');
const queueFailureAt=retryBlock.indexOf('CAROUSEL_AI_QUEUE indisponível no retry manual de geração');
assert.ok(enqueueAt>=0,'retry manual deve tentar Queue');
assert.ok(directAt>enqueueAt,'execução direta só pode ocorrer depois da tentativa de Queue');
assert.ok(queueFailureAt>enqueueAt&&directAt>queueFailureAt,'fallback direto deve ficar atrás da falha explícita da Queue');

const recoveryStart=engine.indexOf('if((stage==="generating"||stage==="quality")&&idleMs>=PRODUCTION_GENERATE_STALE_MS)');
const recoveryEnd=engine.indexOf('if(ageMs>=PRODUCTION_HARD_DEADLINE_MS&&job.evidenceId)',recoveryStart);
assert.ok(recoveryStart>=0&&recoveryEnd>recoveryStart,'bloco de recovery automático deve existir');
const recoveryBlock=engine.slice(recoveryStart,recoveryEnd);
assert.ok(recoveryBlock.indexOf('q.send')>=0,'recovery automático deve reenfileirar');
assert.ok(recoveryBlock.indexOf('runDirectProductionRecovery')>recoveryBlock.indexOf('CAROUSEL_AI_QUEUE indisponível no recovery automático'),'fallback direto automático só pode ocorrer após falha explícita da Queue');

// Freeze das camadas editoriais/visuais: a 5.9 altera somente coordenação de geração.
const frozen={
  'src/production/scraping-engine.js':'d5cd2aba4f110ff93f319e0e8f297f51db9478fb1c9dfbb48338cd8c4dc50357',
  'src/ronda/v285/article-reader.js':'944bff72b03f3c15a10e42a12541aef9af531c676801add27474a3b5165fc722',
  'public/design/index.html':'1af86252a341dd292218ef21aca97d6623d3a9d96ed6bff478d43b353195b156',
};
for(const [file,expected] of Object.entries(frozen)){
  const actual=crypto.createHash('sha256').update(bytes(file)).digest('hex');
  assert.equal(actual,expected,`${file} mudou; bloquear release para preservar qualidade do carrossel`);
}

console.log('v0.9.7.5.9 Durable AI Generation Retry + Queue Recovery OK');
