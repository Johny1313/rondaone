import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEEDS, FEED_COUNTS } from '../src/ronda/v285/collector.js';
import { parseFeed } from '../src/ronda/v285/parser.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=(rel)=>fs.readFileSync(path.join(root,rel),'utf8');
const checks=[];
const check=(name,ok)=>checks.push([name,Boolean(ok)]);

const pkg=JSON.parse(read('package.json'));
const wrangler=read('wrangler.jsonc');
const index=read('src/index.js');
const collector=read('src/ronda/v285/collector.js');
const articleReader=read('src/ronda/v285/article-reader.js');
const shell=read('src/ronda/shell.js');
const design=read('public/design/index.html');
const searchBoost=read('public/ronda/search-boost.js');
const searchNews=read('src/ronda/search-news.js');

check('version 0.7.9',pkg.version==='0.7.9');
check('39 registered sources',FEED_COUNTS.total===39 && FEEDS.length===39);
check('26 Brasil sources',FEED_COUNTS.Brasil===26);
check('13 world sources',FEED_COUNTS.Mundo===13);
check('collector budget 120',collector.includes('const PORTAL_SUBREQUEST_LIMIT = 120;'));
check('collector concurrency 8',collector.includes('runPool(due, 8'));
check('collector snapshot 900',collector.includes('flatMap((result) => result.items), 900)'));
check('collector topics 80',collector.includes('buildTopics(allItems, collectedAt, 80)'));
check('dedicated domain fallback',collector.includes('const dedicatedFallback = normalizedDomains[0]'));
check('route merge',collector.includes('let mergedItems = []'));
check('registered search endpoint',index.includes("'/api/search-news'" ) || index.includes('/api/search-news'));
check('registered search implementation',searchNews.includes('Wikimedia')===false && searchNews.includes('registeredSources:FEEDS.length'));
check('search UI boost',searchBoost.includes('/api/search-news'));
check('article resolver',articleReader.includes('publisherLinkFromAggregatorHtml'));
check('article total timeout 14s',articleReader.includes('const ARTICLE_TOTAL_TIMEOUT_MS = 14_000;'));
check('article HTML 4 MB',articleReader.includes('const MAX_HTML_BYTES = 4_000_000;'));
check('shell 0.7.9',shell.includes("PLATFORM_VERSION='0.7.9'"));
check('Design has Banco Free tab',design.includes('data-panel="freebank"'));
check('Design has no visible AI tab',!design.includes('<button class="tool-tab" data-panel="ai"'));
check('Design AI startup disabled',!design.includes("setTimeout(()=>aiTestConnection(true),350)"));
check('Design automatic AI background disabled',!design.includes('generateRondaBackground(project);return true;'));
check('backend blocks Design AI API',index.includes('DESIGN_AI_REMOVED'));
check('image generation routes not exposed',index.includes("if(url.pathname.startsWith('/api/ai/'))"));
check('intelligent queue concurrency 4',wrangler.includes('"max_concurrency": 4'));
check('intelligent queue timeout 1',wrangler.includes('"max_batch_timeout": 1'));

// Parser smoke: a feed with current items must still return them within the 24h window.
const now=new Date();
const iso1=new Date(now.getTime()-15*60*1000).toUTCString();
const iso2=new Date(now.getTime()-35*60*1000).toUTCString();
const sample=`<?xml version="1.0"?><rss><channel>
<item><title>Notícia de teste um</title><link>https://example.com/a</link><pubDate>${iso1}</pubDate><description>Texto editorial de teste com informação suficiente.</description></item>
<item><title>Notícia de teste dois</title><link>https://example.com/b</link><pubDate>${iso2}</pubDate><description>Outro texto editorial de teste para o parser.</description></item>
</channel></rss>`;
const parsed=parseFeed(sample,{id:'smoke',name:'Smoke',region:'Brasil',canonicalSource:true,sourceAliases:[],sourceDomains:[],scanLimit:20},new Date(now.getTime()-24*60*60*1000),10);
check('parser smoke returns 2 current items',parsed.length===2);

let failed=0;
for(const [name,ok] of checks){
  console.log(`${ok?'OK':'FAIL'} - ${name}`);
  if(!ok)failed++;
}
if(failed){
  console.error(`\n${failed} verificação(ões) falharam.`);
  process.exit(1);
}
console.log(`\nRONDA ONE Cloud v0.7.9: ${checks.length} verificações OK.`);
