import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectFeed, FEEDS, sourceVolumeProfile } from '../src/ronda/v285/collector.js';
import { parseDiscoveryHtml } from '../src/ronda/v285/scraper.js';

const g1=FEEDS.find(feed=>feed.id==='g1');
assert.ok(g1,'G1 deve existir no catálogo');
assert.equal(g1.volume.id,'very-high');
assert.ok(g1.limit>=60,'G1 deve reter volume maior que o limite legado de 24');
assert.ok(g1.discoveryUrls.length>=3,'G1 deve ter RSS + home + busca dedicada');
assert.equal(sourceVolumeProfile('g1').requireDiscoveryRoutes,true);

const now=new Date();
const cutoff=new Date(now.getTime()-86400000);
const rss=`<?xml version="1.0"?><rss version="2.0"><channel>${Array.from({length:8},(_,i)=>`<item><title>G1 notícia RSS ${i+1} com informação relevante</title><link>https://g1.globo.com/politica/noticia/2026/08/30/rss-${i+1}.ghtml</link><pubDate>${now.toUTCString()}</pubDate><description>Descrição ${i+1}</description></item>`).join('')}</channel></rss>`;
const home=`<!doctype html><html><body>${Array.from({length:22},(_,i)=>`<h2><a href="/economia/noticia/2026/08/30/home-${i+1}-noticia-com-titulo-longo.ghtml">Home G1 notícia inédita número ${i+1} com título editorial suficientemente longo</a></h2>`).join('')}</body></html>`;
const google=`<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>`;

let rssCalls=0,homeCalls=0,googleCalls=0,sharedCalls=0;
const fetcher=async(url)=>{
  const value=String(url);
  if(value===g1.directUrl){rssCalls+=1;return new Response(rss,{status:200,headers:{'content-type':'application/rss+xml'}});}
  if(g1.scrapeUrls.includes(value)){homeCalls+=1;return new Response(home,{status:200,headers:{'content-type':'text/html'}});}
  if(value===g1.dedicatedFallbackUrl){googleCalls+=1;return new Response(google,{status:200,headers:{'content-type':'application/rss+xml'}});}
  sharedCalls+=1;return new Response(google,{status:200,headers:{'content-type':'application/rss+xml'}});
};

const result=await collectFeed(g1,cutoff,fetcher,{remaining:120,used:0,seenUrls:new Set()},null,{timeoutMs:4500,skipScrapeWhenDirectHealthy:true});
assert.equal(result.status.ok,true);
assert.equal(rssCalls,1);
assert.equal(homeCalls,1,'fonte de alto volume não pode encerrar após RSS mínimo');
assert.equal(googleCalls,1,'busca dedicada do domínio deve ser consultada antes de encerrar a descoberta');
assert.ok(result.items.length>8,'a cobertura deve superar o volume do RSS isolado');
assert.equal(result.status.coverage.profile,'very-high');
assert.ok(result.status.coverage.counts.h1>=20,'home discovery deve ampliar a cobertura da última hora');
assert.ok(result.status.coverage.routeCounts.scrape>=10);

const discovered=parseDiscoveryHtml(home,g1,g1.scrapeUrls[0],{limit:30,discoveredAt:now.toISOString()});
assert.ok(discovered.length>=20);
assert.ok(discovered.every(item=>item.publishedAtEstimated===true));
assert.ok(discovered.every(item=>item.discoveryMethod==='html-heading-first-seen'));

const database=fs.readFileSync(new URL('../src/ronda/v285/database.js',import.meta.url),'utf8');
const worker=fs.readFileSync(new URL('../src/ronda/v285/index.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/ronda/app.js',import.meta.url),'utf8');
assert.match(database,/source_discovery_items/);
assert.match(database,/getSourceDiscoveryMetrics/);
assert.match(worker,/saveSourceDiscoveryItems/);
assert.match(worker,/coverageTarget1h/);
assert.match(app,/cobertura baixa/);
assert.match(app,/\/h · cobertura/);

console.log('v0.9.7.4.7 High-Volume Source Discovery Engine OK');
