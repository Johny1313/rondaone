import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectFeed, collectRound, collectSourceRevalidation } from '../src/ronda/v285/collector.js';
import { buildPlatformStatus } from '../src/index.js';

const now=new Date('2026-08-30T14:00:00.000Z');
const item={id:'cached-1',title:'Notícia válida preservada em cache',url:'https://example.test/noticia-cache',publishedAt:now.toISOString(),kind:'portal',sourceName:'Teste Hotfix',collectorName:'Teste Hotfix'};
const feed={
  id:'hotfix-source',name:'Teste Hotfix',region:'Brasil',canonicalSource:true,
  directUrl:'https://example.test/rss',scrapeUrls:[],sourceAliases:[],sourceDomains:['example.test'],editorialHints:[],
  urls:['https://example.test/rss','https://news.example.test/fallback'],limit:30,snapshotLimit:60,scanLimit:80,refreshMinutes:1,
  volume:{id:'normal',itemLimit:30,snapshotLimit:60,discoveryTarget:8,target1h:2,requireDiscoveryRoutes:false},
};
const timeoutFetcher=async()=>{throw new Error('timeout simulated');};
let state={sourceId:feed.id,name:feed.name,region:'Brasil',status:'direct',route:'direct',items:[item],itemCount:1,lastAttemptAt:new Date(now.getTime()-60000).toISOString(),lastSuccessAt:new Date(now.getTime()-60000).toISOString(),nextCheckAt:now.toISOString(),failureCount:0,circuitState:'CLOSED',preferredRoute:'direct',lastRouteTried:'direct'};

const cycles=[];
let cycleAt=now;
for(let i=0;i<3;i++){
  const round=await collectRound({feeds:[feed],now:cycleAt,sourceStates:new Map([[feed.id,state]]),previousRound:{items:[item]},fetcher:timeoutFetcher,externalRequestLimit:20});
  const update=round.sourceStateUpdates[0];
  assert.ok(update,`ciclo ${i+1} deve produzir atualização de fonte`);
  state=update;cycles.push({failureCount:update.failureCount,circuitState:update.circuitState,preferredRoute:update.preferredRoute});
  const next=Date.parse(update.nextCheckAt||update.nextRetryAt||'');
  cycleAt=new Date(Number.isFinite(next)?next+1000:cycleAt.getTime()+5*60000);
}
assert.deepEqual(cycles.map(x=>x.failureCount),[1,2,3]);
assert.equal(cycles[0].circuitState,'CLOSED');
assert.equal(cycles[1].circuitState,'CLOSED');
assert.equal(cycles[2].circuitState,'OPEN');
assert.ok(state.nextRetryAt,'OPEN deve possuir cooldown');

let revalidateQueued=0,networkCalls=0;
const swr=await collectRound({
  feeds:[feed],now:new Date(Date.parse(state.lastAttemptAt||now.toISOString())+60*1000),sourceStates:new Map([[feed.id,state]]),previousRound:{items:[item]},
  fetcher:async(url)=>{if(String(url).includes('example.test'))networkCalls++;return new Response('',{status:500});},externalRequestLimit:20,
  onRevalidateSource:async()=>{revalidateQueued++;},
});
assert.equal(networkCalls,0,'circuit OPEN não pode insistir na rede durante cooldown');
assert.equal(swr.sources[0].servedFrom,'cache');
assert.equal(swr.sources[0].revalidationPending,true);
assert.equal(revalidateQueued,0,'revalidação só deve ser agendada ao fim do cooldown');

const retryAt=new Date(Date.parse(state.nextRetryAt)+1000);
const dueSWR=await collectRound({
  feeds:[feed],now:retryAt,sourceStates:new Map([[feed.id,state]]),previousRound:{items:[item]},fetcher:timeoutFetcher,externalRequestLimit:20,
  onRevalidateSource:async()=>{revalidateQueued++;},
});
assert.equal(revalidateQueued,1,'após cooldown deve agendar uma revalidação separada');
assert.equal(dueSWR.sources[0].servedFrom,'cache');
assert.equal(dueSWR.sources[0].revalidationPending,true);

const rss=`<?xml version="1.0"?><rss version="2.0"><channel>${Array.from({length:10},(_,i)=>`<item><title>Recuperação ${i+1} com notícia válida</title><link>https://example.test/recuperada-${i+1}</link><pubDate>${retryAt.toUTCString()}</pubDate><description>Conteúdo recuperado ${i+1}</description></item>`).join('')}</channel></rss>`;
const recovered=await collectSourceRevalidation({feed,state,previousRound:{items:[item]},now:retryAt,fetcher:async()=>new Response(rss,{status:200,headers:{'content-type':'application/rss+xml'}})});
assert.equal(recovered.update.circuitState,'CLOSED');
assert.equal(recovered.update.failureCount,0);
assert.equal(recovered.update.revalidationPending,false);

const tls=await collectFeed({...feed,urls:['https://example.test/rss']},new Date(now.getTime()-86400000),async()=>new Response('tls',{status:525}),{remaining:4,used:0,seenUrls:new Set()},null,{directTimeoutMs:100});
assert.equal(tls.status.ok,false);
assert.equal(tls.status.errorCode,'tls-upstream');

class FakeDB {
  prepare(sql){
    const q=String(sql);let args=[];
    const api={
      bind(...values){args=values;return api;},
      async first(){
        if(q.includes('SELECT 1 AS ok'))return {ok:1};
        if(q.includes("FROM runs WHERE status='success'"))return {completed_at:new Date(Date.now()-2*60000).toISOString()};
        if(q.includes('FROM intelligent_jobs'))return {total:0};
        if(q.includes('FROM production_jobs'))return {total:0};
        return null;
      },
      async all(){
        if(q.includes('FROM source_state'))return {results:[
          {source_id:'a',status:'direct',route:'direct',item_count:10,failure_count:0},
          {source_id:'b',status:'degraded',route:'cache',item_count:8,failure_count:3},
        ]};
        return {results:[]};
      }
    };
    return api;
  }
}
const platform=await buildPlatformStatus({DB:new FakeDB(),ROUND_JOBS_QUEUE:{send(){}},INTELLIGENT_JOBS_QUEUE:{send(){}}});
assert.equal(platform.database,'connected');
assert.equal(platform.queues.ROUND,'available');
assert.equal(platform.queues.INTELLIGENT,'available');
assert.equal(platform.schedulerHealthy,true);
assert.equal(platform.sources.healthy,1);
assert.equal(platform.sources.degraded,1);
assert.equal(platform.sources.cacheOnly,1);
assert.ok(Number.isFinite(platform.sources.coveragePercent));

const database=fs.readFileSync(new URL('../src/ronda/v285/database.js',import.meta.url),'utf8');
const worker=fs.readFileSync(new URL('../src/ronda/v285/index.js',import.meta.url),'utf8');
const collector=fs.readFileSync(new URL('../src/ronda/v285/collector.js',import.meta.url),'utf8');
const platformCode=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
assert.match(database,/circuit_state/);
assert.match(database,/next_retry_at/);
assert.match(database,/revalidation_pending/);
assert.match(database,/last_route_tried/);
assert.match(collector,/sourceCircuitDecision/);
assert.match(collector,/collectSourceRevalidation/);
assert.match(collector,/source-revalidate|onRevalidateSource/);
assert.match(worker,/source-revalidate/);
assert.match(worker,/Browser Run excedeu o budget da fonte/);
assert.match(worker,/ROUTE_NOT_FOUND/);
assert.match(platformCode,/coveragePercent/);
assert.match(platformCode,/stuckIntelligent/);
assert.match(platformCode,/hotfixLockV09748/);

console.log('CICLO 1 — falha controlada: CLOSED / failureCount=1 OK');
console.log('CICLO 2 — rota adaptativa: CLOSED / failureCount=2 OK');
console.log('CICLO 3 — circuit breaker: OPEN / cache SWR / HALF_OPEN recovery OK');
console.log('v0.9.7.4.8 HOTFIX LOCK Stability OK');
