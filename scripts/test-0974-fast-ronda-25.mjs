import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectFeed, collectRound } from '../src/ronda/v285/collector.js';

const collector=fs.readFileSync('src/ronda/v285/collector.js','utf8');
const worker=fs.readFileSync('src/ronda/v285/index.js','utf8');
const database=fs.readFileSync('src/ronda/v285/database.js','utf8');
assert.match(collector,/earlySourceTarget = 25/);
assert.match(collector,/skipScrapeWhenDirectHealthy: true/);
assert.match(collector,/timeoutMs: 4_500/);
assert.match(collector,/optionsFullConcurrency/);
assert.match(worker,/saveRoundPreview/);
assert.match(worker,/round_early_preview_published/);
assert.match(database,/latest_round_preview/);

const now=new Date();
const feeds=Array.from({length:30},(_,i)=>({
  id:`source-${i+1}`,name:`Fonte ${i+1}`,region:'Brasil',canonicalSource:true,
  directUrl:`https://source${i+1}.test/rss`,urls:[`https://source${i+1}.test/rss`],scrapeUrls:[],sourceAliases:[],sourceDomains:[`source${i+1}.test`],limit:12,scanLimit:40,refreshMinutes:1,
}));
const rssFor=(name)=>`<?xml version="1.0"?><rss version="2.0"><channel>${Array.from({length:8},(_,j)=>`<item><title>${name} notícia ${j+1} com atualização relevante</title><link>https://${name.toLowerCase().replace(/\s+/g,'')}.test/${j+1}</link><pubDate>${now.toUTCString()}</pubDate><description>Descrição factual ${j+1} com informação suficiente para a ronda editorial.</description></item>`).join('')}</channel></rss>`;
const fetcher=async(url)=>{
  if(String(url).includes('bsky.app')) return new Response(JSON.stringify({posts:[]}),{status:200,headers:{'content-type':'application/json'}});
  const match=/source(\d+)\.test/.exec(String(url));
  const n=Number(match?.[1]||1);
  return new Response(rssFor(`Fonte ${n}`),{status:200,headers:{'content-type':'application/rss+xml'}});
};

let rssCalls=0,htmlCalls=0;
const perfFeed={id:'perf',name:'Perf',region:'Brasil',directUrl:'https://perf.test/rss',urls:['https://perf.test/rss','https://perf.test/'],scrapeUrls:['https://perf.test/'],sourceAliases:[],sourceDomains:['perf.test'],limit:12,refreshMinutes:1};
const perfResult=await collectFeed(perfFeed,new Date(now.getTime()-86400000),async url=>{if(String(url).endsWith('/rss')){rssCalls+=1;return new Response(rssFor('Perf'),{status:200,headers:{'content-type':'application/rss+xml'}});}htmlCalls+=1;return new Response('<html><body>não deveria ser necessário</body></html>',{status:200,headers:{'content-type':'text/html'}});},null,null,{timeoutMs:4500,skipScrapeWhenDirectHealthy:true});
assert.equal(perfResult.status.ok,true);assert.equal(rssCalls,1);assert.equal(htmlCalls,0);

let early=null;let earlyCalls=0;
const result=await collectRound({fetcher,now,feeds,mode:'full',forceRefresh:true,externalRequestLimit:120,earlySourceTarget:25,earlyFreshMinimum:8,onEarlySnapshot:async(value)=>{earlyCalls+=1;early=value;}});
assert.equal(result.ok,true);
assert.ok(result.totals.sources>=25);
assert.equal(earlyCalls,1);
assert.ok(early?.earlyPreview);
assert.ok(Number(early?.operational?.availableSources)>=25);
assert.ok(Number(early?.operational?.freshSources)>=8);
console.log('v0.9.7.4 Fast Ronda 25+ OK');
