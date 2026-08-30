import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectRound } from '../src/ronda/v285/collector.js';

const collector=fs.readFileSync('src/ronda/v285/collector.js','utf8');
const engine=fs.readFileSync('src/production/engine.js','utf8');
const worker=fs.readFileSync('src/ronda/v285/index.js','utf8');
const mesa=fs.readFileSync('public/ronda/editorial-mesa.js','utf8');
const events=fs.readFileSync('src/ronda/editorial-events.js','utf8');
const design=fs.readFileSync('public/design/index.html','utf8');

assert.match(engine,/launchInteractiveProduction/);
assert.match(engine,/findActiveProductionJob/);
assert.match(engine,/waitUntil-direct/);
assert.match(worker,/launchInteractiveProduction\(env,job\.id/);
assert.match(worker,/reusedActive:true/);
assert.doesNotMatch(worker,/await runInteractiveProduction\(env,job\.id/);
assert.match(design,/\[502,503,504\]/);
assert.match(mesa,/editorial-changes\?sinceLastRound=1/);
assert.match(events,/sinceLastRound/);
assert.match(events,/trigger_type <> 'fast-lane'/);
assert.match(collector,/hasSafeSnapshot/);
assert.match(collector,/previous-round/);

// Regressão observada em produção: se uma fonte ainda não está due mas perdeu
// o snapshot de source_state, ela não pode desaparecer da ronda. Quando a ronda
// anterior possui conteúdo, ele deve continuar visível; quando não possui, a
// fonte precisa ser consultada imediatamente.
const now=new Date();
const feeds=Array.from({length:30},(_,i)=>({
  id:`continuity-${i+1}`,name:`Continuidade ${i+1}`,region:'Brasil',canonicalSource:true,
  directUrl:`https://continuity${i+1}.test/rss`,urls:[`https://continuity${i+1}.test/rss`],scrapeUrls:[],sourceAliases:[],sourceDomains:[`continuity${i+1}.test`],limit:10,refreshMinutes:5,
}));
const published=now.toISOString();
const previousItems=feeds.slice(0,26).map((feed,i)=>({
  id:`old-${i}`,kind:'portal',url:`https://continuity${i+1}.test/noticia`,title:`Notícia preservada ${i+1}`,description:'Conteúdo anterior válido para continuidade do snapshot.',sourceName:feed.name,collectorName:feed.name,publishedAt:published,
}));
const previousRound={ok:true,items:previousItems,sources:[],dedicatedMonitoring:{enabled:false,terms:[],items:[],statuses:[],totals:{terms:0,items:0,sources:0}}};
const future=new Date(now.getTime()+4*60000).toISOString();
const sourceStates=new Map(feeds.map((feed)=>[feed.id,{sourceId:feed.id,name:feed.name,region:'Brasil',status:'direct',route:'direct',items:[],itemCount:0,lastAttemptAt:now.toISOString(),lastSuccessAt:now.toISOString(),nextCheckAt:future,failureCount:0,validators:{}}]));
let networkCalls=0;
const fetcher=async(url)=>{
  networkCalls+=1;
  if(String(url).includes('bsky.app'))return new Response(JSON.stringify({posts:[]}),{status:200,headers:{'content-type':'application/json'}});
  const n=Number(/continuity(\d+)/.exec(String(url))?.[1]||1);
  const rss=`<?xml version="1.0"?><rss version="2.0"><channel><item><title>Atualização ${n}</title><link>https://continuity${n}.test/nova</link><pubDate>${now.toUTCString()}</pubDate><description>Atualização factual nova e válida.</description></item></channel></rss>`;
  return new Response(rss,{status:200,headers:{'content-type':'application/rss+xml'}});
};
const result=await collectRound({fetcher,now,feeds,previousRound,sourceStates,mode:'full',forceRefresh:false,externalRequestLimit:120});
assert.equal(result.ok,true);
assert.ok(result.totals.sources>=26,`esperado preservar >=26 fontes; recebido ${result.totals.sources}`);
assert.ok(networkCalls>=4,'fontes sem snapshot anterior devem voltar a ser coletadas');
console.log('v0.9.7.4.1 Consistency + Async Fast Path OK');
