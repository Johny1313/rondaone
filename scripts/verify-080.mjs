import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { FEEDS, FEED_COUNTS } from '../src/ronda/v285/collector.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const checks=[];const check=(name,ok)=>checks.push([name,Boolean(ok)]);
const pkg=JSON.parse(read('package.json'));
const wrangler=read('wrangler.jsonc');
const index=read('src/index.js');
const worker=read('src/ronda/v285/index.js');
const events=read('src/ronda/editorial-events.js');
const shell=read('src/ronda/shell.js');
const mesa=read('public/ronda/editorial-mesa.js');
const design=read('public/design/index.html');
const articleReader=read('src/ronda/v285/article-reader.js');
const rondaHtml=read('public/ronda/index.html');

check('version 0.8.0',pkg.version==='0.8.0');
check('39 registered sources',FEED_COUNTS.total===39&&FEEDS.length===39);
check('editorial event API',index.includes('handleEditorialEventsApi'));
check('event schema',events.includes('CREATE TABLE IF NOT EXISTS editorial_events'));
check('event article schema',events.includes('editorial_event_articles'));
check('one article per editorial job',events.includes("type:'event-enrich'"));
check('editorial jobs reuse compatible queue',events.includes('INTELLIGENT_JOBS_QUEUE')&&events.includes("type:'event-enrich'"));
check('round remains isolated',wrangler.includes('ronda-one-round-jobs'));
check('carousel queue remains isolated',wrangler.includes('ronda-one-intelligent-jobs'));
check('round syncs events after collection',worker.includes('syncEditorialEvents'));
check('event enrichment non blocking',worker.includes('editorial_event_sync_failed'));
check('timeline',events.includes('significantTimeline'));
check('new information',events.includes('informacoesNovas'));
check('confirmation',events.includes('confirmationLevel'));
check('divergence',events.includes('detectDivergences'));
check('relevance',events.includes('relevanceScore'));
check('traction',events.includes('tractionMetrics'));
check('open questions',events.includes('pontosEmAberto'));
check('production',events.includes('buildProductionFromEvent'));
check('traceability',events.includes('traceability'));
check('Mesa UI',mesa.includes('/api/editorial-events'));
check('changes since last round UI',mesa.includes('/api/editorial-changes'));
check('radar UI',mesa.includes('/api/editorial-radar'));
check('shell 0.8.0',shell.includes("PLATFORM_VERSION='0.8.0'"));
check('asset cache 080',index.includes("assetCacheBust:'2.8.5-080-editorial-events'"));
check('Design remains without visible AI tab',!design.includes('<button class="tool-tab" data-panel="ai"'));
check('article reader extracts visuals',articleReader.includes('extractArticleVisualsFromHtml')&&articleReader.includes('images: articleVisuals'));
check('editorial alerts endpoint',events.includes("'/api/editorial-alerts'"));
check('history supports custom range',events.includes('params.from')&&events.includes('params.to')&&rondaHtml.includes('eventHistoryCustom'));
check('history keeps original round pane',rondaHtml.includes('roundHistoryPane')&&rondaHtml.includes('eventHistoryPane'));
check('search autofill guard',rondaHtml.includes('id="searchInput"')&&rondaHtml.includes('autocomplete="off"'));

let failed=0;
for(const [name,ok] of checks){console.log(`${ok?'OK':'FAIL'} - ${name}`);if(!ok)failed++;}
if(failed){console.error(`\n${failed} verificação(ões) estrutural(is) falharam.`);process.exit(1);}

for(const script of ['test-080-functional.mjs','test-080-editorial.mjs','test-080-stability.mjs']){
  const run=spawnSync(process.execPath,[path.join(root,'scripts',script)],{encoding:'utf8'});
  process.stdout.write(run.stdout||'');process.stderr.write(run.stderr||'');
  if(run.status!==0)process.exit(run.status||1);
}
console.log(`\nRONDA ONE Cloud v0.8.0: ${checks.length} verificações estruturais + 3 rodadas de teste OK.`);
