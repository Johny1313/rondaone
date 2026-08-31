import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rankTopicSources, scrapeTopicToEvidence } from '../src/production/scraping-engine.js';

const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');

const topic={id:'topic-0972',title:'Teste de fonte única',items:[
  {id:'g1',kind:'portal',url:'https://g1.globo.com/teste/noticia.ghtml',sourceName:'G1',title:'Principal'},
  {id:'cnn',kind:'portal',url:'https://www.cnnbrasil.com.br/teste/',sourceName:'CNN Brasil',title:'Backup'},
  {id:'third',kind:'portal',url:'https://example.com/terceira',sourceName:'Terceira Fonte',title:'Terceira'},
]};
const ranked=rankTopicSources(topic);
assert.equal(ranked[0].item.sourceName,'G1');
assert.equal(ranked[1].item.sourceName,'CNN Brasil');

let calls=[];
const articleBody='Conteúdo jornalístico completo, factual e contextualizado para validar a leitura da fonte backup. '.repeat(55);
const goodHtml=`<!doctype html><html><head><title>Notícia backup</title><meta name="description" content="Descrição editorial"><script type="application/ld+json">${JSON.stringify({'@context':'https://schema.org','@type':'NewsArticle',headline:'Notícia backup',articleBody})}</script></head><body><article><h1>Notícia backup</h1><p>${articleBody}</p></article></body></html>`;
const result=await scrapeTopicToEvidence(topic,{
  allowCollectedFastPath:false,
  timeoutMs:3000,
  fetcher:async url=>{
    calls.push(String(url));
    if(String(url).includes('g1.globo.com')) throw new Error('falha simulada na principal');
    if(String(url).includes('cnnbrasil.com.br')) return new Response(goodHtml,{status:200,headers:{'content-type':'text/html; charset=utf-8'}});
    throw new Error('a terceira fonte nunca deveria ser lida');
  }
});
assert.equal(result.ok,true);
assert.equal(result.selection.policy,'single-primary-one-backup');
assert.equal(result.selection.selectedRole,'backup');
assert.equal(result.attempts.length,2);
assert.equal(calls.length,2);
assert.ok(calls.every(url=>!url.includes('example.com/terceira')));

const engine=read('src/production/engine.js');
const worker=read('src/ronda/v285/index.js');
const design=read('public/design/index.html');
const articleReader=read('src/ronda/v285/article-reader.js');
const platform=read('src/index.js');
assert.match(engine,/version:(?:"0\.9\.7(?:\.\d+)+"|ENGINE_BASELINE_VERSION)/);
assert.match(engine,/contentFirst:true/);
assert.match(engine,/templateMode:"apply-after-generation"/);
assert.match(engine,/languagePolicy:"pt-BR-required"/);
assert.match(engine,/translateEvidencePackToPtBrFast/);
assert.match(engine,/single-primary-one-backup/);
assert.doesNotMatch(worker,/requestedTemplateId:body\?\.templateId/);
assert.match(worker,/engineVersion:(?:"0\.9\.7(?:\.\d+)+"|PRODUCTION_VERSIONS\.engineBaseline)/);
assert.match(articleReader,/TODO texto entregue deve estar em português do Brasil/);
assert.match(design,/Gerar conteúdo/);
assert.match(design,/Aplicar template ao carrossel pronto/);
assert.match(design,/nenhuma nova chamada de IA/);
assert.match(design,/conteúdo neutro PT-BR/);
assert.doesNotMatch(design,/templateId:\$\('#directArticleTemplate'\)\.value\|\|null/);
assert.match(platform,/singleSourceContentFirstV0972/);
assert.match(platform,/maximumPublisherReads:2/);
console.log('RONDA ONE v0.9.7.2 Single Source + Content First: OK');
