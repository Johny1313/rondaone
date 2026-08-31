import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scrapeArticle } from '../src/production/scraping-engine.js';
import { READER_VERSION, EVIDENCE_VERSION, CAROUSEL_PIPELINE_VERSION } from '../src/production/hybrid-browser-reader.js';

const read=(p)=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const engine=read('src/production/engine.js');
const design=read('public/design/index.html');

assert.equal(READER_VERSION,'hybrid-reader-v1.1-band-v2');
assert.equal(EVIDENCE_VERSION,'ronda-evidence-pack-v1-reader-v1.1');
assert.equal(CAROUSEL_PIPELINE_VERSION,'carousel-stability-baseline-v1.1');

const paragraphs=[
  'A reportagem apresenta o contexto principal do debate e descreve como o desempenho recente mudou ao longo das últimas rodadas.',
  'Os comentaristas analisam fatores táticos, decisões técnicas e o efeito das ausências no rendimento coletivo da equipe durante os jogos.',
  'O conteúdo também compara resultados anteriores e destaca pontos que ajudam a explicar por que a produção ofensiva perdeu regularidade.',
  'Entre os elementos citados estão organização do meio-campo, aproveitamento das chances e dificuldade para manter intensidade durante os noventa minutos.',
  'A análise ressalta que o problema não depende de um único jogador e envolve o funcionamento do conjunto em diferentes momentos das partidas.',
  'Os dados apresentados no programa servem como apoio para diferenciar uma oscilação pontual de uma tendência que merece atenção da comissão técnica.',
  'O debate ainda aborda alternativas de escalação e ajustes possíveis para recuperar equilíbrio sem comprometer a proteção defensiva da equipe.',
  'Ao final, os participantes reforçam que a sequência de jogos será determinante para confirmar se as mudanças propostas produzem uma reação consistente.'
];
const serialized=JSON.stringify(`<div class="article__content">${paragraphs.map(p=>`<p>${p}</p>`).join('')}</div>`);
const bandHtml=`<!doctype html><html><head><title>Band teste</title></head><body><script>window.__BAND_STATE__={"article":{"content":${serialized}}};</script></body></html>`;
let browserCalls=0;
const record=await scrapeArticle({url:'https://www.band.com.br/nacional/brasil/debate-teste',title:'Debate Band',sourceName:'Band'}, {
  slideCount:5,
  allowCollectedFastPath:false,
  transportPreference:'direct-first',
  fetcher:async()=>new Response(bandHtml,{status:200,headers:{'content-type':'text/html; charset=utf-8'}}),
  browserFetcher:async()=>{browserCalls+=1;throw new Error('Browser não deveria ser chamado');},
});
assert.equal(record.ok,true);
assert.equal(record.transport,'direct');
assert.equal(record.adapter,'band');
assert.equal(record.extractionMethod,'adapter:band-v2');
assert.equal(record.evidenceSufficiency.ready,true);
assert.equal(browserCalls,0);

const transcript=paragraphs.concat(paragraphs.slice(0,3)).join(' ');
const videoHtml=`<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
  '@context':'https://schema.org','@type':'VideoObject',name:'Debate em vídeo',description:'Resumo do vídeo',transcript,uploadDate:'2026-08-31T12:00:00-03:00'
})}</script></head><body></body></html>`;
const video=await scrapeArticle({url:'https://www.band.com.br/esportes/programa/videos/debate-video',title:'Debate em vídeo',sourceName:'Band'}, {
  slideCount:5,
  allowCollectedFastPath:false,
  transportPreference:'direct-first',
  fetcher:async()=>new Response(videoHtml,{status:200,headers:{'content-type':'text/html'}}),
  browserFetcher:async()=>{browserCalls+=1;throw new Error('Browser não deveria ser chamado para transcript suficiente');},
});
assert.equal(video.ok,true);
assert.equal(video.extractionMethod,'json-ld-video-transcript');
assert.equal(video.evidenceSufficiency.ready,true);
assert.equal(video.transport,'direct');
assert.equal(browserCalls,0);

// Retry 1: leitura renovada ainda começa por direct/adapters/AMP e só usa Browser no fim.
assert.match(engine,/const transportPreference=retryMode==="deep"&&browserFetcher\?"browser-first":"direct-first"/);
assert.doesNotMatch(engine,/\(retryMode==="alternate"\|\|retryMode==="deep"\).*browser-first/);
assert.match(engine,/alternate:'leitura direta renovada \+ adapter\/AMP antes do Browser'/);
assert.match(engine,/retryMode===\"deep\"&&browserFetcher\?\"browser-first\":\"direct-first\"/);

// FORMA deixa explícito quando o canvas preservado é conteúdo anterior após uma nova leitura falhar.
assert.match(design,/O canvas continua mostrando o conteúdo anterior e NÃO corresponde ao novo link/);
assert.match(design,/>0\.9\.7\.6\.1<\/b>/);

console.log('RONDA ONE v0.9.7.6.1 Band Reader V2 + Retry Order: OK');
