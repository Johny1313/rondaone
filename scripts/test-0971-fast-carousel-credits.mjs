import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeArticleIdentity, scrapeArticle } from '../src/production/scraping-engine.js';
import { productionInputFingerprint } from '../src/production/engine.js';
import { extractArticleVisualsFromHtml } from '../src/ronda/article-visuals.js';

const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');

assert.equal(
  normalizeArticleIdentity('https://example.com/noticia?utm_source=x&b=2&a=1#topo'),
  'https://example.com/noticia?a=1&b=2'
);

const html=`<!doctype html><html><head>
<link rel="canonical" href="https://noticias.example.com/materia">
<meta property="og:title" content="Título editorial">
<script type="application/ld+json">{
  "@context":"https://schema.org","@type":"NewsArticle","headline":"Título editorial",
  "image":{"@type":"ImageObject","contentUrl":"https://cdn.example.com/foto.jpg","creator":{"@type":"Person","name":"Maria Fotógrafa"},"creditText":"Agência Exemplo"}
}</script></head><body><article><h1>Título editorial</h1>
<figure><img src="https://cdn.example.com/foto2.jpg" alt="Cena"><figcaption>Foto: João Silva / Agência XPTO</figcaption></figure>
<p>${'Conteúdo jornalístico completo para teste de extração. '.repeat(20)}</p></article></body></html>`;
const visuals=extractArticleVisualsFromHtml(html,{articleUrl:'https://noticias.example.com/materia',sourceName:'Notícias Exemplo'});
assert.ok(visuals.primary);
assert.ok([visuals.primary,...visuals.alternatives].some(x=>x.photographer==='Maria Fotógrafa'));
assert.ok([visuals.primary,...visuals.alternatives].some(x=>/João Silva/i.test(x.photographer||x.credit||'')));
assert.ok([visuals.primary,...visuals.alternatives].every(x=>x.sourceName==='Notícias Exemplo'));
assert.match([visuals.primary,...visuals.alternatives].map(x=>x.creditLine||'').join(' '),/Origem: Notícias Exemplo/);

const fetched=await scrapeArticle({
  url:'https://example.com/noticia?utm_source=feed',
  sourceName:'Exemplo',
  title:'Título',
  content:'Trecho editorial confiável com detalhes e contexto. '.repeat(45),
  collectionRoute:'direct-html',
},{fetcher:async()=>{throw new Error('não deveria buscar no fast path')}});
assert.equal(fetched.ok,true);
assert.equal(fetched.cacheHit,true);
assert.equal(fetched.extractionMethod,'ronda-collected-article-fastpath');

const base={topic:{id:'t1',title:'Pauta',lastChangedAt:'2026-08-29T10:00:00Z',items:[{id:'i1',url:'https://example.com/a',title:'A',content:'texto A'}]}};
assert.equal(productionInputFingerprint(base,'topic','t1'),productionInputFingerprint(structuredClone(base),'topic','t1'));
const changed=structuredClone(base);changed.topic.items[0].content='texto B';
assert.notEqual(productionInputFingerprint(base,'topic','t1'),productionInputFingerprint(changed,'topic','t1'));

const production=read('src/production/engine.js');
const worker=read('src/ronda/v285/index.js');
const design=read('public/design/index.html');
const platform=read('src/index.js');
const smart=read('public/design/smart-template-engine.js');
assert.match(production,/Fast path: Evidence Pack recente reutilizado/);
assert.match(production,/findReusableProductionJob/);
assert.match(production,/productionInputFingerprint/);
assert.match(worker,/engineVersion:"0\.9\.7\.1"/);
assert.match(design,/productionSourceLink/);
assert.match(design,/productionImageCredits/);
assert.match(design,/deleteTemplateRecord/);
assert.match(design,/Apagar template/);
assert.match(design,/cache rápido/);
assert.match(platform,/fastCarouselSourceCreditsV0971/);
assert.match(smart,/const VERSION='1\.2\.1'/);
console.log('RONDA ONE v0.9.7.1 Fast Carousel + Source Credits: OK');
