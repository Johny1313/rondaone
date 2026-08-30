import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scrapeArticle, scrapeTopicToEvidence, portalAdapterForUrl } from '../src/production/scraping-engine.js';

const articleText = [
  'A Justiça decidiu antecipar o período de suspensão de cobranças e estabeleceu novas condições para o processo analisado nesta sexta-feira.',
  'A decisão determina que as partes cumpram prazos específicos e preservem as medidas já adotadas até nova avaliação do tribunal.',
  'Segundo o processo, a mudança foi tomada depois da análise de documentos apresentados pelas empresas e de manifestações dos envolvidos.',
  'O despacho também definiu parâmetros para os próximos passos e manteve obrigações que já estavam previstas anteriormente.',
  'As partes poderão apresentar novas informações dentro dos prazos estabelecidos e a situação continuará sendo acompanhada pelo Judiciário.',
  'A medida produz efeitos imediatos e deverá ser considerada nas próximas etapas do processo, conforme a decisão publicada.',
].join(' ');
const browserHtml = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',headline:'Decisão judicial',author:{name:'Repórter Teste'},datePublished:'2026-08-29T21:00:00-03:00',articleBody:articleText})}</script></head><body><article><p>${articleText}</p></article></body></html>`;

// 1) A mesma fonte deve mudar de transporte antes de trocar de publisher.
{
  let directCalls=0,browserCalls=0;
  const record=await scrapeArticle({url:'https://www.band.com.br/noticias/teste',title:'Teste Band',sourceName:'Band'}, {
    fetcher:async()=>{directCalls++; throw new Error('direct timeout');},
    browserFetcher:async(url)=>{browserCalls++; return {html:browserHtml,url,browserMsUsed:620};},
    slideCount:5,timeoutMs:6500,
  });
  assert.equal(record.ok,true);
  assert.equal(record.transport,'browser');
  assert.match(record.extractionMethod,/^browser:/);
  assert.equal(directCalls,1);
  assert.equal(browserCalls,1);
  assert.ok(record.attempts.some(x=>x.transport==='direct'&&!x.ok));
  assert.ok(record.attempts.some(x=>x.transport==='browser'&&x.ok));
}

// 2) Domínio aprendido como browser-first não deve desperdiçar o fetch direto quando o navegador resolve.
{
  let directCalls=0,browserCalls=0;
  const record=await scrapeArticle({url:'https://www.band.com.br/noticias/browser-first',title:'Band',sourceName:'Band'}, {
    fetcher:async()=>{directCalls++; return new Response('<html></html>',{status:200,headers:{'content-type':'text/html'}});},
    browserFetcher:async(url)=>{browserCalls++; return {html:browserHtml,url};},
    transportPreference:'browser-first',slideCount:5,timeoutMs:6500,
  });
  assert.equal(record.ok,true);
  assert.equal(record.transport,'browser');
  assert.equal(browserCalls,1);
  assert.equal(directCalls,0,'browser-first bem-sucedido deve evitar o transporte direto');
}

// 3) O backup editorial só entra depois de todos os transportes da fonte principal falharem.
{
  let primaryDirect=0,primaryBrowser=0,backupDirect=0;
  const topic={id:'topic-hybrid',items:[
    {url:'https://primary.test/a',title:'Principal',sourceName:'Fonte Principal',kind:'portal'},
    {url:'https://backup.test/b',title:'Backup',sourceName:'Fonte Backup',kind:'portal'},
  ]};
  const fetcher=async(url)=>{
    if(String(url).includes('primary.test')){primaryDirect++; throw new Error('timeout principal');}
    backupDirect++;
    return new Response(browserHtml,{status:200,headers:{'content-type':'text/html'}});
  };
  const browserFetcher=async(url)=>{
    if(String(url).includes('primary.test')){primaryBrowser++; throw new Error('browser indisponível');}
    return {html:browserHtml,url};
  };
  const result=await scrapeTopicToEvidence(topic,{fetcher,browserFetcher,slideCount:5,timeoutMs:6500,allowCollectedFastPath:false});
  assert.equal(result.ok,true);
  assert.equal(result.selection.selectedRole,'backup');
  assert.equal(primaryDirect,1);
  assert.equal(primaryBrowser,1,'Browser Run deve ser tentado na fonte principal antes do backup');
  assert.equal(backupDirect,1);
}

// 4) Adapter da Band está cadastrado para reduzir parsing genérico.
assert.equal(portalAdapterForUrl('https://www.band.com.br/noticias/x')?.id,'band');

// 5) Produção está ligada ao Browser Run, mas preserva fallback quando binding não existir.
const engine=fs.readFileSync(new URL('../src/production/engine.js',import.meta.url),'utf8');
const wrangler=JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
const platform=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
assert.equal(wrangler.browser?.binding,'BROWSER');
assert.match(engine,/BROWSER\.quickAction\("content"/);
assert.match(engine,/production_transport_stats/);
assert.match(engine,/browser-first/);
assert.match(platform,/hybridMultiTransportV09746/);

console.log('v0.9.7.4.6 Hybrid Multi-Transport Reader OK');
