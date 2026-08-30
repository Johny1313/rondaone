import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCarouselFromEvidencePack } from '../src/ronda/v285/article-reader.js';

const engine=fs.readFileSync('src/production/engine.js','utf8');
const worker=fs.readFileSync('src/ronda/v285/index.js','utf8');
const design=fs.readFileSync('public/design/index.html','utf8');

assert.match(engine,/runInteractiveProduction/);
assert.match(engine,/buildCarouselFromEvidencePack/);
assert.match(engine,/PRODUCTION_INTERACTIVE_DEADLINE_MS = 12_000/);
assert.match(engine,/mode:"evidence-first"/);
assert.match(worker,/runInteractiveProduction\(env,job\.id/);
assert.match(design,/deadline=startedAt\+20\*1000/);

const evidence={
  id:'evidence-fast-test',sourceName:'Agência Teste',url:'https://example.test/noticia',canonicalUrl:'https://example.test/noticia',resolvedUrl:'https://example.test/noticia',
  title:'Governo anuncia novo programa de mobilidade',publishedAt:new Date().toISOString(),reading:{quality:96},translation:{sourceLanguage:'pt',targetLanguage:'pt-BR',status:'not-needed'},
  facts:Array.from({length:14},(_,i)=>({id:`E${String(i+1).padStart(2,'0')}`,evidence:`A informação factual número ${i+1} detalha uma etapa diferente do programa de mobilidade, com medida específica confirmada pela matéria publicada.`}))
};
const result=await buildCarouselFromEvidencePack(evidence,{ai:null,slideCount:7});
assert.equal(result.slides.length,7);
assert.equal(result.performance.evidencePackFastPath,true);
assert.ok(result.performance.promptEvidenceCount<=18);
assert.equal(result.language,'pt-BR');
console.log('v0.9.7.3 Interactive Fast Path OK');
