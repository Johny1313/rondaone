import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const read=(p)=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const bytes=(p)=>fs.readFileSync(new URL(`../${p}`,import.meta.url));
const worker=read('src/ronda/v285/index.js');
const collector=read('src/ronda/v285/collector.js');
const database=read('src/ronda/v285/database.js');
const platform=read('src/index.js');
const ui=read('public/ronda/app.js');
const html=read('public/ronda/index.html');
const wrangler=JSON.parse(read('wrangler.jsonc'));

assert.equal(wrangler.triggers.crons[0],'*/5 * * * *','Ronda automática deve rodar em cadência de 5 minutos');
assert.match(worker,/const triggerType = "scheduled"/);
assert.match(worker,/const mode = "full"/);
assert.match(worker,/scheduled_round_coalesced/);
assert.match(worker,/round-enqueue-gate/);
assert.match(worker,/getActiveRunSummary/);
assert.match(worker,/round_queue_terminal_skipped/,'mensagens antigas terminais não podem ressuscitar jobs');
assert.match(worker,/source_revalidation_legacy_skipped/,'backlog legado de source-revalidate deve ser drenado sem rede');
assert.match(worker,/onRevalidateSource:null/,'Ronda não pode alimentar a própria ROUND Queue com revalidação por fonte');
assert.match(worker,/ROUND_BROWSER_DAILY_LIMIT/);
assert.match(worker,/maxRuns:browserRemaining > 0 \? 1 : 0/);
assert.match(worker,/ROUND_TRANSLATION_DAILY_LIMIT/);
assert.match(worker,/targetAdditionalUsdPerWeek: 1/);
assert.match(collector,/itemLimit:24, snapshotLimit:96/);
assert.match(collector,/itemLimit:18, snapshotLimit:72/);
assert.match(collector,/if \(HIGH_FREQUENCY_SOURCES\.has\(id\)\) return 5/);
assert.match(collector,/return feedCount>=30\?10/);
assert.match(database,/export async function listCrawlItems/);
assert.match(database,/FROM source_discovery_items d/);
assert.match(worker,/url\.pathname === "\/api\/crawl"/);
assert.match(worker,/scraping:false, browser:false, ai:false, translation:false/);
assert.match(html,/id="navCrawl"/);
assert.match(html,/id="crawlView"/);
assert.match(ui,/Abrir matéria ↗/);
assert.match(ui,/\/api\/crawl\?limit=100&hours=6/);
assert.match(platform,/qualityFirstV09757/);
assert.match(platform,/costGovernorV09757/);
assert.match(platform,/crawlReadOnlyV09757/);

// Freeze dos componentes críticos de geração do carrossel: esta versão não pode alterá-los.
const frozen={
  'src/production/engine.js':'cabecc5f756746ddbd79a1c6b4d7790d75e68bb58d24010fe72b640d523df651',
  'src/production/scraping-engine.js':'d5cd2aba4f110ff93f319e0e8f297f51db9478fb1c9dfbb48338cd8c4dc50357',
  'src/ronda/v285/article-reader.js':'944bff72b03f3c15a10e42a12541aef9af531c676801add27474a3b5165fc722',
  'public/design/index.html':'1af86252a341dd292218ef21aca97d6623d3a9d96ed6bff478d43b353195b156',
};
for(const [file,expected] of Object.entries(frozen)){
  const actual=crypto.createHash('sha256').update(bytes(file)).digest('hex');
  assert.equal(actual,expected,`${file} mudou; bloquear release para evitar regressão do carrossel`);
}

console.log('v0.9.7.5.7 Quality-First 5M + Cost Governor + Crawl read-only + Carousel Freeze OK');
