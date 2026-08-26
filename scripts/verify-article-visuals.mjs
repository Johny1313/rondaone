import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractArticleVisualsFromHtml, handleArticleVisualsApi, validatePublicArticleUrl } from '../src/ronda/article-visuals.js';

const articleUrl='https://noticias.exemplo.com.br/politica/materia-1';

const withJsonLd=`<!doctype html><html><head>
<meta property="og:image" content="/fallback.jpg">
<script type="application/ld+json">{
  "@context":"https://schema.org",
  "@type":"NewsArticle",
  "image":{"@type":"ImageObject","url":"/foto-principal.jpg","caption":"Autoridade durante evento","creditText":"Foto: Maria Silva / Agência Exemplo"}
}</script></head><body></body></html>`;
const a=extractArticleVisualsFromHtml(withJsonLd,{articleUrl,sourceName:'Portal Exemplo'});
assert.equal(a.primary.url,'https://noticias.exemplo.com.br/foto-principal.jpg');
assert.equal(a.primary.credit,'Foto: Maria Silva / Agência Exemplo');
assert.equal(a.primary.creditConfidence,'high');
assert.equal(a.primary.autoUseAllowed,true);
assert.equal(a.canAutoUsePrimary,true);

const withFigure=`<html><body><article><figure class="photo-credit">
<img src="/img/reportagem.webp" alt="Cena da reportagem">
<figcaption>Foto: João Souza / Reuters</figcaption>
</figure></article></body></html>`;
const b=extractArticleVisualsFromHtml(withFigure,{articleUrl,sourceName:'Portal Exemplo'});
assert.equal(b.primary.method,'figure');
assert.match(b.primary.credit,/João Souza/);
assert.equal(b.primary.autoUseAllowed,true);

const withoutCredit=`<html><head><meta property="og:image" content="https://cdn.exemplo.com/foto.jpg"><meta property="og:image:alt" content="Imagem da notícia"></head></html>`;
const c=extractArticleVisualsFromHtml(withoutCredit,{articleUrl,sourceName:'Portal Exemplo'});
assert.equal(c.primary.credit,'');
assert.equal(c.primary.creditConfidence,'low');
assert.equal(c.primary.autoUseAllowed,false);
assert.equal(c.policy.aiFallbackRecommended,true);

const dedupe=`<html><head><meta property="og:image" content="/same.jpg"><meta name="twitter:image" content="/same.jpg"></head><body><figure class="image-credit"><img src="/same.jpg"><figcaption>Foto: Ana Lima / Reuters</figcaption></figure></body></html>`;
const d=extractArticleVisualsFromHtml(dedupe,{articleUrl});
assert.equal(d.totalCandidates,1);
assert.match(d.primary.credit,/Ana Lima/);
assert.equal(d.primary.autoUseAllowed,true);

assert.throws(()=>validatePublicArticleUrl('http://127.0.0.1/test'));
assert.throws(()=>validatePublicArticleUrl('file:///tmp/a'));
assert.equal(validatePublicArticleUrl(articleUrl),articleUrl);

const originalFetch=globalThis.fetch;
globalThis.fetch=async ()=>new Response(withFigure,{status:200,headers:{'Content-Type':'text/html; charset=utf-8'}});
const apiResponse=await handleArticleVisualsApi(new Request(`https://ronda.exemplo/api/article-visuals?url=${encodeURIComponent(articleUrl)}&sourceName=Portal%20Exemplo`));
const apiPayload=await apiResponse.json();
assert.equal(apiResponse.status,200);
assert.equal(apiPayload.ok,true);
assert.equal(apiPayload.mode,'patch-a-read-only');
assert.match(apiPayload.articleVisuals.primary.credit,/João Souza/);
globalThis.fetch=originalFetch;

const badResponse=await handleArticleVisualsApi(new Request('https://ronda.exemplo/api/article-visuals?url=http%3A%2F%2F127.0.0.1%2Fsecret'));
assert.equal(badResponse.status,400);

const index=await readFile(new URL('../src/index.js',import.meta.url),'utf8');
assert.match(index,/handleArticleVisualsApi/);
assert.match(index,/url\.pathname==='\/api\/article-visuals'/);
assert.match(index,/version:'0\.7\.7'/);
assert.match(index,/editorialVersion:'2\.8\.5'/);
assert.match(index,/runRondaQueue/);
assert.match(index,/runRondaSchedule/);

console.log('PATCH A article visuals: testes concluídos com sucesso.');
