import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const read=(p)=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const bytes=(p)=>fs.readFileSync(new URL(`../${p}`,import.meta.url));
const pkg=JSON.parse(read('package.json'));
const engine=read('src/production/engine.js');
const worker=read('src/ronda/v285/index.js');
const platform=read('src/index.js');
const wrangler=JSON.parse(read('wrangler.jsonc'));

assert.equal(pkg.version,'0.9.7.5.10');

// Baseline comprovada: componentes críticos do carrossel devem ser byte a byte 0.9.7.5.6.
const frozen={
  'src/production/engine.js':'cabecc5f756746ddbd79a1c6b4d7790d75e68bb58d24010fe72b640d523df651',
  'src/production/scraping-engine.js':'d5cd2aba4f110ff93f319e0e8f297f51db9478fb1c9dfbb48338cd8c4dc50357',
  'src/ronda/v285/article-reader.js':'944bff72b03f3c15a10e42a12541aef9af531c676801add27474a3b5165fc722',
  'public/design/index.html':'1af86252a341dd292218ef21aca97d6623d3a9d96ed6bff478d43b353195b156',
};
for(const [file,expected] of Object.entries(frozen)){
  const actual=crypto.createHash('sha256').update(bytes(file)).digest('hex');
  assert.equal(actual,expected,`${file} divergiu da baseline estável 0.9.7.5.6`);
}

// Retry manual deve permanecer com prioridade direta da 5.6, sem mudanças 5.8/5.9.
const retryStart=engine.indexOf('export async function retryProductionJob');
const retryEnd=engine.indexOf('export async function generateProductionImage',retryStart);
const retry=engine.slice(retryStart,retryEnd);
assert.match(retry,/transport:"waitUntil-direct"/,'Retry de geração deve manter comportamento 5.6');
assert.match(retry,/launchInteractiveProduction\(env,id,\{force:retryMode!==\'snapshot\',ctx,retryMode\}\)/,'Retry de leitura deve manter prioridade interativa 5.6');
assert.doesNotMatch(retry,/ARTICLE_READ_QUEUE\.send/,'Não reintroduzir retry manual via ARTICLE_READ_QUEUE da 5.8');
assert.doesNotMatch(retry,/CAROUSEL_AI_QUEUE\.send/,'Não reintroduzir retry manual via CAROUSEL_AI_QUEUE da 5.9');

// Manutenção do carrossel 1 min, Ronda editorial 5 min.
assert.equal(wrangler.triggers.crons[0],'* * * * *');
assert.match(worker,/autoRecoverStaleProductionJobs\(env,\{limit:5,ctx\}\)/);
assert.match(worker,/minute % 5 !== 0/);
assert.match(worker,/carousel_stability_maintenance_tick/);
assert.match(worker,/scheduled_round_coalesced/);
assert.match(worker,/round-enqueue-gate/);

// Melhorias econômicas/editoriais da 5.7 continuam presentes.
assert.match(worker,/ROUND_BROWSER_DAILY_LIMIT/);
assert.match(worker,/ROUND_TRANSLATION_DAILY_LIMIT/);
assert.match(worker,/targetAdditionalUsdPerWeek: 1/);
assert.match(worker,/url\.pathname === "\/api\/crawl"/);
assert.match(platform,/qualityFirstV09757/);
assert.match(platform,/costGovernorV09757/);
assert.match(platform,/crawlReadOnlyV09757/);
assert.match(platform,/carouselStabilityBaselineV097510/);

console.log('v0.9.7.5.10 Carousel Stability Baseline 5.6 + Quality-First 5M + Cost/Crawl OK');
