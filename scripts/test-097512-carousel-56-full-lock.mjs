import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const read=(p)=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const bytes=(p)=>fs.readFileSync(new URL(`../${p}`,import.meta.url));
const sha=(buffer)=>crypto.createHash('sha256').update(buffer).digest('hex');
const pkg=JSON.parse(read('package.json'));
const manifest=JSON.parse(read('src/production/carousel-56-lock.json'));
const engine=read('src/production/engine.js');
const translation=read('src/ronda/v285/translation.js');
const worker=read('src/ronda/v285/index.js');
const platform=read('src/index.js');
const wrangler=JSON.parse(read('wrangler.jsonc'));

assert.equal(pkg.version,'0.9.7.5.12');
assert.equal(manifest.release,'0.9.7.5.12');
assert.equal(manifest.baseline,'0.9.7.5.6');
assert.equal(manifest.qualityFirstPreserved,true);
assert.equal(manifest.d1SchemaChange,false);

// Full binary lock of the carousel 5.6 core and immutable dependencies.
for(const [file,expected] of Object.entries(manifest.lockedFiles)){
  const actual=sha(bytes(file));
  assert.equal(actual,expected,`${file} saiu do Carousel 5.6 Full Lock`);
}

// translation.js is shared with Quality-First. Lock only the API actually used by carousel,
// allowing the Ronda title-budget section to retain the 5.7 cost controls.
const model=(translation.match(/export const TRANSLATION_MODEL = .*?;\n/)||[])[0];
assert.ok(model,'TRANSLATION_MODEL ausente');
const start=translation.indexOf('const PORTUGUESE_WORDS');
const end=translation.indexOf('\nasync function runLimited',start);
assert.ok(start>=0&&end>start,'Não foi possível delimitar a API crítica de tradução');
const translationCritical=model+translation.slice(start,end);
assert.equal(sha(Buffer.from(translationCritical)),manifest.translationCriticalApiSha256,'translateText/isLikelyPortuguese divergiu da 5.6');

// Manual retry/recovery remains the proven 5.6 behavior.
const retryStart=engine.indexOf('export async function retryProductionJob');
const retryEnd=engine.indexOf('export async function generateProductionImage',retryStart);
assert.ok(retryStart>=0&&retryEnd>retryStart,'retryProductionJob não encontrado');
const retry=engine.slice(retryStart,retryEnd);
assert.match(retry,/transport:"waitUntil-direct"/);
assert.match(retry,/launchInteractiveProduction\(env,id,\{force:retryMode!==\'snapshot\',ctx,retryMode\}\)/);
assert.doesNotMatch(retry,/ARTICLE_READ_QUEUE\.send/);
assert.doesNotMatch(retry,/CAROUSEL_AI_QUEUE\.send/);

// The production engine itself must still declare the 5.6 production schema.
assert.match(engine,/const PRODUCTION_SCHEMA_VERSION = "0\.9\.7\.5\.6"/);
assert.match(engine,/gotoOptions:\{waitUntil:"domcontentloaded"/,'Browser read must remain the proven 5.6 path');

// Quality-First Ronda remains outside the manual carousel quality budget.
assert.equal(wrangler.triggers.crons[0],'* * * * *');
assert.match(worker,/minute % 5 !== 0/);
assert.match(worker,/autoRecoverStaleProductionJobs\(env,\{limit:5,ctx\}\)/);
assert.match(worker,/ROUND_BROWSER_DAILY_LIMIT/);
assert.match(worker,/ROUND_TRANSLATION_DAILY_LIMIT/);
assert.match(worker,/url\.pathname === "\/api\/crawl"/);
assert.match(platform,/qualityFirstV09757/);
assert.match(platform,/costGovernorV09757/);
assert.match(platform,/carouselStabilityBaselineV097510/);
assert.match(platform,/carousel56FullLockV097512/);
assert.match(platform,/manualProductionQualityBudgetExempt:true/);

console.log('v0.9.7.5.12 Carousel 5.6 Full Lock + Quality-First 5M OK');
