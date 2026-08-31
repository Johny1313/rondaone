import assert from 'node:assert/strict';
import { scrapeArticle, scrapeTopicToEvidence, evidenceSufficiency } from '../src/production/scraping-engine.js';

const longSentences = [
  'A prefeitura anunciou nesta sexta-feira um novo plano de mobilidade urbana para ampliar o transporte público nos bairros mais afastados.',
  'O projeto prevê corredores exclusivos de ônibus e novas conexões entre terminais para reduzir o tempo médio das viagens diárias.',
  'Segundo a administração municipal, a primeira etapa terá investimento de R$ 120 milhões e deverá começar ainda neste semestre.',
  'A proposta também inclui ciclovias, integração tarifária e revisão das linhas que atendem regiões com maior crescimento populacional.',
  'Técnicos da prefeitura afirmam que as mudanças serão implementadas gradualmente após audiências públicas e avaliações de demanda.',
  'O cronograma prevê novas entregas ao longo do próximo ano e monitoramento dos indicadores de velocidade e lotação do sistema.',
  'A gestão municipal informou que publicará relatórios periódicos para acompanhar custos, prazos e resultados das intervenções.',
].join(' ');

{
  const html = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
    '@context':'https://schema.org','@type':'NewsArticle',headline:'Plano de mobilidade',datePublished:'2026-08-29T20:00:00-03:00',author:{name:'Repórter Teste'},articleBody:longSentences
  })}</script><link rel="amphtml" href="https://example.com/amp"></head><body><article><p>${longSentences}</p></article></body></html>`;
  let requests = 0;
  const fetcher = async (url) => { requests += 1; return new Response(html,{status:200,headers:{'content-type':'text/html; charset=utf-8'}}); };
  const record = await scrapeArticle({url:'https://example.com/noticia',title:'Plano de mobilidade',sourceName:'Example'},{fetcher,slideCount:5,timeoutMs:3500});
  assert.equal(record.ok,true);
  assert.equal(record.extractionMethod,'json-ld-fast');
  assert.equal(requests,1,'JSON-LD suficiente não deve abrir AMP');
  assert.equal(record.evidenceSufficiency.ready,true);
}

{
  const ps = Array.from({length:8},(_,i)=>`<p>${i+1}. ${longSentences.split('. ')[i%7] || longSentences}</p>`).join('');
  const html = `<!doctype html><html><head><meta property="og:title" content="Teste G1"></head><body><div class="content-text__container">${ps}</div></body></html>`;
  const record = await scrapeArticle({url:'https://g1.globo.com/teste/noticia.ghtml',title:'Teste G1',sourceName:'G1'},{fetcher:async()=>new Response(html,{status:200,headers:{'content-type':'text/html'}}),slideCount:5,timeoutMs:3500});
  assert.equal(record.ok,true);
  assert.match(record.extractionMethod,/^adapter:g1$/);
}

{
  const primary='https://portal-a.test/materia';
  const backup='https://portal-b.test/materia';
  const backupHtml=`<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',headline:'Backup',articleBody:longSentences})}</script></head></html>`;
  const fetcher=async(url)=>{
    if(String(url).includes('portal-a.test')) throw new Error('upstream timeout');
    return new Response(backupHtml,{status:200,headers:{'content-type':'text/html'}});
  };
  const result=await scrapeTopicToEvidence({id:'topic-1',items:[
    {url:primary,title:'Principal',sourceName:'Fonte A',kind:'portal'},
    {url:backup,title:'Backup',sourceName:'Fonte B',kind:'portal'},
  ]},{fetcher,slideCount:5,timeoutMs:3500,allowCollectedFastPath:true});
  assert.equal(result.ok,true);
  assert.equal(result.selection.selectedRole,'backup');
  assert.equal(result.attempts.length,2,'a mesma tentativa deve migrar automaticamente para o único backup');
}

{
  const enough=evidenceSufficiency(longSentences,5);
  assert.equal(enough.ready,true);
  assert.ok(enough.facts>=enough.requiredFacts);
}

console.log('v0.9.7.4.5 Adaptive Scraping + Evidence Sufficiency OK');

{
  const head=`<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',headline:'Streaming',datePublished:'2026-08-29T20:00:00-03:00',author:{name:'Teste'},articleBody:longSentences})}</script></head><body>`;
  const body=(head+' '.repeat(3_000_000)+'</body></html>');
  const encoder=new TextEncoder(); const data=encoder.encode(body); let offset=0; let pulls=0;
  const stream=new ReadableStream({pull(controller){pulls++; if(offset>=data.length){controller.close();return;} const end=Math.min(data.length,offset+200_000); controller.enqueue(data.slice(offset,end)); offset=end;}});
  const record=await scrapeArticle({url:'https://stream.test/materia',title:'Streaming',sourceName:'Stream'},{fetcher:async()=>new Response(stream,{status:200,headers:{'content-type':'text/html; charset=utf-8'}}),slideCount:5,timeoutMs:3500});
  assert.equal(record.ok,true);
  assert.ok(Number(record.bytesRead)<1_200_000,'streaming deve parar quando as evidências já forem suficientes');
  assert.ok(pulls<10,'não deve consumir o corpo inteiro depois de Evidence Sufficiency');
}
