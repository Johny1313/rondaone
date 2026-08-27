import { classifyEditoria, normalizeText, titleTokens, tokenSimilarity } from './v285/clustering.js';
import { plainText, stableHash } from './v285/parser.js';
import { readArticle } from './v285/article-reader.js';

const EVENT_SCHEMA_VERSION=1;
const EVENT_WINDOW_HOURS=72;
const EVENT_LIST_LIMIT=180;
const EVENT_ARTICLE_READ_LIMIT=12;
const EVENT_SOURCES_PER_ROUND=4;
const MAX_FACTS=36;
const MAX_TIMELINE=18;
const MAX_NEW_INFO=12;
const MAX_ARTICLE_CONTENT_STORE=9000;
let editorialSchemaPromise=null;
const PORTUGUESE_HINTS=/\b(que|para|com|não|uma|mais|foi|por|dos|das|sobre|segundo|após|também|entre|ainda)\b/i;

const OFFICIAL_HOST_PATTERNS=[
  /(^|\.)gov\.br$/i,
  /(^|\.)jus\.br$/i,
  /(^|\.)leg\.br$/i,
  /(^|\.)stf\.jus\.br$/i,
  /(^|\.)tse\.jus\.br$/i,
  /(^|\.)senado\.leg\.br$/i,
  /(^|\.)camara\.leg\.br$/i,
  /(^|\.)who\.int$/i,
  /(^|\.)un\.org$/i,
  /(^|\.)europa\.eu$/i,
];

const PUBLIC_IMPACT_TERMS=[
  'governo','presidente','congresso','stf','supremo','eleição','eleicoes','economia','juros','inflação','inflacao',
  'saúde','saude','hospital','vacina','segurança','seguranca','polícia','policia','justiça','justica','guerra','enchente',
  'incêndio','incendio','acidente','morte','vítima','vitima','emprego','imposto','educação','educacao','energia','água','agua',
];

const SUBEDITORIA_RULES=[
  ['Política','Congresso',['congresso','camara','câmara','senado','deputado','senador','projeto de lei','pec']],
  ['Política','Judiciário',['stf','supremo','tse','tribunal','ministro do stf','judiciario','judiciário']],
  ['Política','Executivo',['planalto','presidente','ministro','governo federal','palacio','palácio']],
  ['Economia','Mercados',['bolsa','dolar','dólar','mercado','ações','acoes','investidor']],
  ['Economia','Macroeconomia',['pib','inflação','inflacao','juros','selic','banco central','emprego','desemprego']],
  ['Esportes','Futebol',['futebol','brasileirao','brasileirão','libertadores','copa','gol','clube','time','jogador']],
  ['Esportes','Automobilismo',['formula 1','fórmula 1','f1','piloto','grand prix','gp']],
  ['Saúde','Saúde Pública',['sus','ministerio da saude','ministério da saúde','vacina','epidemia','surto']],
  ['Tecnologia','Inteligência Artificial',['inteligencia artificial','inteligência artificial','ia','modelo de linguagem','chatbot']],
  ['Mundo','Geopolítica',['guerra','onu','nato','otan','diplomacia','sanção','sancao','fronteira']],
  ['Segurança e Justiça','Criminal',['crime','prisão','prisao','homicidio','homicídio','feminicidio','feminicídio','policia','polícia']],
  ['Fofoca e Celebridades','Celebridades',['celebridade','famoso','famosa','influenciador','cantor','cantora','atriz','ator']],
  ['Reality Shows','Reality',['bbb','big brother','a fazenda','paredao','paredão','reality']],
];

function json(data,status=200,headers={}){
  return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
}

function clean(value,max=500){
  return plainText(value).replace(/\s+/g,' ').trim().slice(0,max);
}

function safeDate(value){
  const time=Date.parse(value||'');
  return Number.isFinite(time)?new Date(time).toISOString():null;
}

function safeUrl(value){
  try{
    const url=new URL(String(value||''));
    return /^https?:$/.test(url.protocol)?url.toString():null;
  }catch{return null;}
}

function hostname(value){
  try{return new URL(String(value||'')).hostname.replace(/^www\./,'').toLowerCase();}catch{return '';}
}

function unique(list){return [...new Set((Array.isArray(list)?list:[]).filter(Boolean))];}
function clamp(value,min,max){return Math.max(min,Math.min(max,Number(value)||0));}
function nowIso(now=new Date()){return new Date(now).toISOString();}
function parsePayload(value){try{return typeof value==='string'?JSON.parse(value):value||null;}catch{return null;}}
function stringify(value){return JSON.stringify(value??null);}
function normalizedTokens(value){return titleTokens(clean(value,500));}
function tokenSet(value){return new Set(normalizedTokens(value));}

function sourceIdentity(item){
  return clean(item?.sourceName||item?.collectorName||hostname(item?.url)||'Fonte',120);
}

function itemKey(item){
  const url=safeUrl(item?.url);
  if(url)return `url-${stableHash(url)}`;
  return `item-${stableHash(`${sourceIdentity(item)}|${clean(item?.title,220)}|${safeDate(item?.publishedAt)||''}`)}`;
}

function itemText(item){
  return clean(`${item?.title||''}. ${item?.description||item?.summary||''}`,1600);
}

function isOfficialSource(item){
  const host=hostname(item?.url||item?.publisherHomepageUrl);
  if(OFFICIAL_HOST_PATTERNS.some(pattern=>pattern.test(host)))return true;
  const source=normalizeText(sourceIdentity(item));
  return /\b(stf|tse|senado|camara dos deputados|governo|prefeitura|ministerio|secretaria|policia federal|policia civil|onu|who)\b/.test(source);
}

function analysisRole(item){
  const text=normalizeText(`${item?.title||''} ${item?.description||''}`);
  if(/\b(opiniao|coluna|editorial|comentario)\b/.test(text))return 'OPINIÃO';
  if(/\b(analise|entenda|explica|contexto)\b/.test(text))return 'ANÁLISE';
  return null;
}

function sourceRole(item,index,items){
  if(isOfficialSource(item))return 'FONTE OFICIAL';
  const interpretative=analysisRole(item);
  if(interpretative)return interpretative;
  if(index===0)return 'FONTE PRIMÁRIA';
  const firstTime=Date.parse(items?.[0]?.publishedAt||0);
  const time=Date.parse(item?.publishedAt||0);
  if(index<=2||(!Number.isNaN(firstTime)&&!Number.isNaN(time)&&time-firstTime<=45*60*1000))return 'CONFIRMAÇÃO';
  return 'REPERCUSSÃO';
}

function classifyDetailed(items=[]){
  const baseEditoria=classifyEditoria(items);
  const text=normalizeText(items.map(item=>itemText(item)).join(' '));
  let editoria=baseEditoria;
  if(/\b(meio ambiente|ambiental|clima|desmatamento|amazonia|amazônia|queimada|emissao|emissão)\b/.test(text)) editoria='Meio Ambiente';
  else if(baseEditoria==='Segurança e Justiça') editoria=/\b(stf|supremo|tribunal|juiz|juiza|decisao judicial|julgamento|ministerio publico|mpf)\b/.test(text)?'Justiça':'Segurança';
  else if(baseEditoria==='Curiosidades e Ciência Pop') editoria=/\b(ciencia|cientista|estudo|pesquisa|universidade|arqueologia|fossil|fóssil)\b/.test(text)?'Ciência':'Curiosidades';
  else if(baseEditoria==='Fofoca e Celebridades') editoria='Celebridades';
  else if(baseEditoria==='Notícias') editoria='Brasil';
  else if(baseEditoria==='Entretenimento'&&/\b(livro|literatura|museu|exposicao|exposição|arte|teatro|patrimonio|patrimônio)\b/.test(text)) editoria='Cultura';
  let subeditoria='Geral';
  for(const [ed,sub,terms] of SUBEDITORIA_RULES){
    if(ed!==baseEditoria&&ed!==editoria)continue;
    if(terms.some(term=>text.includes(normalizeText(term)))){subeditoria=sub;break;}
  }
  const tokens=[];
  for(const item of items){
    for(const token of normalizedTokens(item?.title||'')){
      if(!tokens.includes(token))tokens.push(token);
      if(tokens.length>=8)break;
    }
    if(tokens.length>=8)break;
  }
  return {editoria,subeditoria,tema:tokens.slice(0,5).join(' · ')||editoria};
}

function extractEntities(items=[]){
  const counts=new Map();
  const reject=new Set(['Brasil','Mundo','Hoje','Segundo','Após','Agora','Governo','Justiça','Política','Economia']);
  for(const item of items){
    const text=`${item?.title||''} ${item?.description||''}`;
    const matches=text.match(/\b(?:[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}.'’\-]+(?:\s+(?:de|da|do|dos|das|e)\s+)?){1,4}[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}.'’\-]+\b/gu)||[];
    for(const raw of matches){
      const entity=clean(raw,100);
      if(entity.length<4||reject.has(entity))continue;
      counts.set(entity,(counts.get(entity)||0)+1);
    }
  }
  return [...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'pt-BR')).slice(0,12).map(([name,count])=>({name,count}));
}

function splitCandidateSentences(value){
  return clean(value,3000)
    .split(/(?<=[.!?])\s+|\s+[•·]\s+/)
    .map(text=>clean(text,360))
    .filter(text=>text.length>=28&&text.length<=360);
}

function factFromText(text,item,kind='collected'){
  const normalized=normalizeText(text);
  if(!normalized)return null;
  return {
    factId:`fact-${stableHash(normalized)}`,
    text:clean(text,360),
    normalized,
    kind,
    evidence:[{
      sourceName:sourceIdentity(item),
      url:safeUrl(item?.url),
      publishedAt:safeDate(item?.publishedAt),
      title:clean(item?.title,220),
    }],
  };
}

function mergeFacts(facts=[]){
  const map=new Map();
  for(const fact of facts){
    if(!fact?.factId||!fact?.text)continue;
    const current=map.get(fact.factId);
    if(!current){map.set(fact.factId,{...fact,evidence:[...(fact.evidence||[])]});continue;}
    const seen=new Set(current.evidence.map(ev=>`${ev.url}|${ev.sourceName}`));
    for(const evidence of fact.evidence||[]){
      const key=`${evidence.url}|${evidence.sourceName}`;
      if(!seen.has(key)){current.evidence.push(evidence);seen.add(key);}
    }
  }
  return [...map.values()].slice(0,MAX_FACTS);
}

function extractCollectedFacts(items=[]){
  const facts=[];
  for(const item of items){
    const title=clean(item?.title,300);
    if(title){const fact=factFromText(title,item,'headline');if(fact)facts.push(fact);}
    for(const sentence of splitCandidateSentences(item?.description||'' ).slice(0,3)){
      const fact=factFromText(sentence,item,'snippet');if(fact)facts.push(fact);
    }
  }
  return mergeFacts(facts);
}

function extractArticleFacts(article,item){
  if(!article?.ok||!article.content)return [];
  if(!PORTUGUESE_HINTS.test(article.content)&&String(item?.region||'Brasil')==='Mundo')return [];
  const sentences=splitCandidateSentences(article.content);
  const ranked=sentences
    .map(text=>({text,score:(/\d/.test(text)?3:0)+(PUBLIC_IMPACT_TERMS.some(term=>normalizeText(text).includes(normalizeText(term)))?2:0)+Math.min(3,text.length/120)}))
    .sort((a,b)=>b.score-a.score)
    .slice(0,10);
  return mergeFacts(ranked.map(entry=>factFromText(entry.text,{...item,url:article.extractionUrl||article.url,title:article.title||item?.title,publishedAt:article.publishedAt||item?.publishedAt},'full-article')).filter(Boolean));
}

function numericClaims(items=[]){
  const claims=[];
  const patterns=[
    {type:'vítimas',regex:/\b(\d{1,4})\s+(?:v[ií]timas?|mortos?|mortes?|feridos?)\b/gi},
    {type:'placar',regex:/\b(\d{1,2})\s*[xX]\s*(\d{1,2})\b/g},
    {type:'percentual',regex:/\b(\d{1,3}(?:[.,]\d+)?)\s*%/g},
    {type:'valor',regex:/R\$\s*([\d.,]+)\s*(milh[oõ]es?|bilh[oõ]es?|mil)?/gi},
  ];
  for(const item of items){
    const text=itemText(item);
    for(const pattern of patterns){
      pattern.regex.lastIndex=0;
      let match;
      while((match=pattern.regex.exec(text))){
        const value=pattern.type==='placar'?`${match[1]}x${match[2]}`:clean(`${match[1]}${match[2]?` ${match[2]}`:''}`,60);
        claims.push({type:pattern.type,value,sourceName:sourceIdentity(item),url:safeUrl(item?.url),title:clean(item?.title,220)});
      }
    }
  }
  return claims;
}

function detectDivergences(items=[]){
  const byType=new Map();
  for(const claim of numericClaims(items)){
    if(!byType.has(claim.type))byType.set(claim.type,[]);
    byType.get(claim.type).push(claim);
  }
  const output=[];
  for(const [type,claims] of byType){
    const values=new Map();
    for(const claim of claims){
      if(!values.has(claim.value))values.set(claim.value,[]);
      values.get(claim.value).push(claim);
    }
    const distinct=[...values.entries()].filter(([,list])=>new Set(list.map(x=>x.sourceName)).size>=1);
    const sourceCount=new Set(claims.map(x=>x.sourceName)).size;
    if(distinct.length<2||sourceCount<2)continue;
    output.push({
      divergenceId:`div-${stableHash(type+'|'+distinct.map(([value])=>value).sort().join('|'))}`,
      type,
      description:`Fontes apresentam números diferentes para ${type}.`,
      values:distinct.slice(0,5).map(([value,list])=>({value,sources:unique(list.map(x=>x.sourceName)),evidence:list.slice(0,4)})),
    });
  }
  return output.slice(0,8);
}

function relevanceScore(items,classification,divergences,now=new Date()){
  const sources=new Set(items.map(sourceIdentity)).size;
  const official=items.some(isOfficialSource);
  const latest=Math.max(...items.map(item=>Date.parse(item?.publishedAt||0)).filter(Number.isFinite),0);
  const ageHours=latest?Math.max(0,(now.getTime()-latest)/3600000):24;
  const text=normalizeText(items.map(itemText).join(' '));
  const impactHits=PUBLIC_IMPACT_TERMS.reduce((sum,term)=>sum+(text.includes(normalizeText(term))?1:0),0);
  const categoryBoost=['Política','Economia','Saúde','Segurança','Justiça','Mundo','Meio Ambiente'].includes(classification.editoria)?10:4;
  const score=18+Math.min(28,sources*5)+Math.min(20,impactHits*3)+(official?12:0)+categoryBoost+Math.max(0,12-ageHours*1.5)-(divergences.length?2:0);
  return clamp(Math.round(score),1,100);
}

function tractionMetrics(items,now=new Date()){
  const buckets={m30:0,h2:0,prev30:0,h6:0};
  const recentSources=new Set();
  for(const item of items){
    const time=Date.parse(item?.publishedAt||0);if(!Number.isFinite(time))continue;
    const age=(now.getTime()-time)/60000;
    if(age>=0&&age<=30){buckets.m30++;recentSources.add(sourceIdentity(item));}
    if(age>30&&age<=60)buckets.prev30++;
    if(age>=0&&age<=120)buckets.h2++;
    if(age>=0&&age<=360)buckets.h6++;
  }
  const growth=buckets.prev30===0?(buckets.m30>0?Math.min(999,buckets.m30*100):0):Math.round(((buckets.m30-buckets.prev30)/buckets.prev30)*100);
  const score=clamp(Math.round(buckets.m30*16+buckets.h2*4+recentSources.size*6+Math.max(0,growth)*0.08),0,100);
  return {score,growth30m:growth,items30m:buckets.m30,items2h:buckets.h2,items6h:buckets.h6,recentSources:recentSources.size};
}

function confirmationLevel(items,divergences){
  const independent=new Set(items.map(sourceIdentity)).size;
  const official=items.some(isOfficialSource);
  let level='BAIXO';
  if((official&&independent>=2)||independent>=4)level='ALTO';
  else if(independent>=2||official)level='MÉDIO';
  if(divergences.length&&level==='ALTO')level='MÉDIO';
  return {
    level,
    independentConfirmations:Math.max(0,independent-1),
    officialSourceFound:official,
    relevantVehicles:independent,
    divergences:divergences.length,
    reasons:[
      `${independent} ${independent===1?'fonte identificada':'fontes independentes identificadas'}`,
      official?'Fonte oficial encontrada':'Nenhuma fonte oficial identificada até agora',
      divergences.length?`${divergences.length} divergência(s) objetiva(s) detectada(s)`:'Nenhuma divergência numérica objetiva detectada',
    ],
  };
}

function sourceSummary(items=[]){
  const ordered=[...items].sort((a,b)=>Date.parse(a?.publishedAt||0)-Date.parse(b?.publishedAt||0));
  return ordered.map((item,index)=>({
    sourceName:sourceIdentity(item),
    role:sourceRole(item,index,ordered),
    url:safeUrl(item?.url),
    title:clean(item?.title,220),
    publishedAt:safeDate(item?.publishedAt),
    official:isOfficialSource(item),
  }));
}

function significantTimeline(items=[],facts=[]){
  const ordered=[...items].sort((a,b)=>Date.parse(a?.publishedAt||0)-Date.parse(b?.publishedAt||0));
  const entries=[];
  const seenSources=new Set();
  for(let index=0;index<ordered.length;index++){
    const item=ordered[index];
    const source=sourceIdentity(item);
    if(index>0&&!isOfficialSource(item)&&seenSources.has(source)&&index<ordered.length-1)continue;
    seenSources.add(source);
    entries.push({
      timelineId:`tl-${itemKey(item)}`,
      at:safeDate(item?.publishedAt),
      sourceName:source,
      label:index===0?'Primeira publicação identificada':isOfficialSource(item)?'Atualização de fonte oficial':'Nova publicação relevante',
      detail:clean(item?.title,240),
      url:safeUrl(item?.url),
    });
    if(entries.length>=MAX_TIMELINE)break;
  }
  if(!entries.length&&facts.length){
    entries.push({timelineId:`tl-${facts[0].factId}`,at:null,sourceName:facts[0].evidence?.[0]?.sourceName||'Fonte',label:'Informação identificada',detail:facts[0].text,url:facts[0].evidence?.[0]?.url||null});
  }
  return entries;
}

function openQuestions(classification,confirmation,divergences){
  const questions=[];
  if(!confirmation.officialSourceFound)questions.push('Existe posicionamento ou documento de uma fonte oficial sobre o acontecimento?');
  if(confirmation.independentConfirmations<1)questions.push('Qual segunda fonte independente pode confirmar a informação principal?');
  if(divergences.length)questions.push('Qual número deve ser considerado confirmado e qual fonte possui a atualização mais recente?');
  const map={
    'Política':['Quando a medida passa a produzir efeitos?','Quem será diretamente afetado pela decisão?'],
    'Economia':['Qual é o impacto financeiro estimado?','Quais grupos ou setores serão mais afetados?'],
    'Saúde':['Qual é a orientação oficial para a população?','Há dados sobre alcance, risco ou público afetado?'],
    'Segurança':['O que já foi confirmado oficialmente pela investigação?','Há novas diligências ou operações previstas?'],
    'Justiça':['Qual é o próximo passo processual ou julgamento previsto?','Há decisão, voto ou manifestação oficial publicada?'],
    'Mundo':['Qual é o próximo marco diplomático ou operacional esperado?','Quais governos ou organismos internacionais já se posicionaram?'],
    'Meio Ambiente':['Qual é a extensão confirmada do impacto ambiental?','Existe dado oficial de órgão ambiental ou científico?'],
    'Ciência':['O estudo foi revisado por pares e quais são suas limitações?','Há confirmação independente de outros pesquisadores?'],
    'Esportes':['Qual é o próximo compromisso e o impacto na competição?','Há confirmação oficial do clube, atleta ou organização?'],
  };
  for(const q of map[classification.editoria]||['Qual é o próximo desdobramento verificável?','O que ainda precisa de confirmação independente?']){
    if(!questions.includes(q))questions.push(q);
  }
  return questions.slice(0,6);
}

function pautaSuggestions(eventLike){
  const suggestions=[
    'O que mudou desde a primeira publicação',
    'Linha do tempo do acontecimento',
    'O que está confirmado e o que ainda está em aberto',
  ];
  if(eventLike.divergencias?.length)suggestions.unshift('Por que as fontes apresentam números diferentes');
  if(eventLike.fontes?.some(source=>source.role==='FONTE OFICIAL'))suggestions.push('O que diz a fonte oficial');
  if(eventLike.entidades?.length)suggestions.push(`Quem são ${eventLike.entidades.slice(0,2).map(x=>x.name).join(' e ')}`);
  return unique(suggestions).slice(0,6);
}

function materialList(items=[]){
  return items
    .filter(item=>safeUrl(item?.url))
    .sort((a,b)=>Date.parse(a?.publishedAt||0)-Date.parse(b?.publishedAt||0))
    .map(item=>({
      articleKey:itemKey(item),
      title:clean(item?.title,260),
      description:clean(item?.description,800),
      sourceName:sourceIdentity(item),
      url:safeUrl(item?.url),
      publishedAt:safeDate(item?.publishedAt),
      region:item?.region||null,
      kind:item?.kind||'portal',
      publisherDomain:item?.publisherDomain||hostname(item?.url),
      publisherHomepageUrl:item?.publisherHomepageUrl||null,
      editorialHints:Array.isArray(item?.editorialHints)?item.editorialHints:[],
    }));
}

function matchTerms(items,terms=[]){
  const hay=normalizeText(items.map(itemText).join(' '));
  return (terms||[]).filter(term=>{
    const value=normalizeText(term?.term||term);
    return value.length>=2&&hay.includes(value);
  }).map(term=>typeof term==='string'?term:term.term).filter(Boolean);
}

function eventSimilarity(topic,event){
  const left=normalizedTokens(topic?.title||'');
  const right=normalizedTokens(event?.titulo||event?.title||'');
  const titleScore=tokenSimilarity(left,right);
  const leftSources=new Set((topic?.sourceNames||[]).map(normalizeText));
  const rightSources=new Set((event?.fontes||[]).map(source=>normalizeText(source.sourceName)));
  let overlap=0;for(const source of leftSources)if(rightSources.has(source))overlap++;
  const sourceScore=leftSources.size&&rightSources.size?overlap/Math.min(leftSources.size,rightSources.size):0;
  return titleScore*0.86+sourceScore*0.14;
}

function chooseExistingEvent(topic,existing=[]){
  let best=null,bestScore=0;
  for(const event of existing){
    const score=eventSimilarity(topic,event);
    if(score>bestScore){best=event;bestScore=score;}
  }
  return bestScore>=0.46?best:null;
}

export function buildEditorialEvent(topic,{previous=null,monitoringTerms=[],runId=null,now=new Date()}={}){
  const items=Array.isArray(topic?.items)?topic.items.filter(item=>item?.kind!=='social'):[];
  const classification=classifyDetailed(items);
  const entities=extractEntities(items);
  const facts=extractCollectedFacts(items);
  const previousFacts=new Map((previous?.fatosConhecidos||[]).map(fact=>[fact.factId,fact]));
  const newFacts=facts.filter(fact=>!previousFacts.has(fact.factId));
  const divergences=detectDivergences(items);
  const relevance=relevanceScore(items,classification,divergences,now);
  const traction=tractionMetrics(items,now);
  const confirmation=confirmationLevel(items,divergences);
  const sources=sourceSummary(items);
  const materials=materialList(items);
  const monitoredTerms=matchTerms(items,monitoringTerms);
  const firstPublishedAt=materials.map(x=>x.publishedAt).filter(Boolean).sort()[0]||safeDate(topic?.lastPublishedAt)||nowIso(now);
  const lastPublishedAt=materials.map(x=>x.publishedAt).filter(Boolean).sort().at(-1)||safeDate(topic?.lastPublishedAt)||nowIso(now);
  const isNew=!previous;
  const latestAgeMinutes=Math.max(0,(now.getTime()-Date.parse(lastPublishedAt||nowIso(now)))/60000);
  let status='ESTÁVEL';
  if(isNew&&relevance>=82&&latestAgeMinutes<=45)status='BREAKING';
  else if(traction.score>=75)status='EM ALTA';
  else if(isNew)status='NOVO';
  else if(newFacts.length&&sources.length>=3)status='EM DESENVOLVIMENTO';
  else if(newFacts.length)status='ATUALIZADO';
  else if(monitoredTerms.length)status='MONITORADO';
  else if(latestAgeMinutes>24*60)status='ENCERRADO';

  const previousId=previous?.eventId||null;
  const baseId=previousId||`event-${stableHash((topic?.id||topic?.title||facts[0]?.text||crypto.randomUUID()).replace(/^topic-/,'')+'|'+classification.editoria)}`;
  const event={
    schemaVersion:EVENT_SCHEMA_VERSION,
    eventId:baseId,
    runId,
    titulo:clean(topic?.title||materials[0]?.title||'Evento editorial',220),
    resumo:clean(facts[0]?.text||topic?.title||'Evento em acompanhamento',420),
    editoria:classification.editoria,
    subeditoria:classification.subeditoria,
    tema:classification.tema,
    entidades:entities,
    fontes:sources,
    materias:materials,
    primeiraPublicacao:firstPublishedAt,
    ultimaAtualizacao:lastPublishedAt,
    status,
    relevancia:relevance,
    tracao:traction,
    nivelConfirmacao:confirmation,
    divergencias:divergences,
    timeline:significantTimeline(items,facts),
    informacoesNovas:newFacts.slice(0,MAX_NEW_INFO).map(fact=>({factId:fact.factId,text:fact.text,evidence:fact.evidence})),
    fatosConhecidos:mergeFacts([...(previous?.fatosConhecidos||[]),...facts]),
    pontosEmAberto:[],
    sugestoesPauta:[],
    termosMonitorados:monitoredTerms,
    leitura:{
      total:materials.length,
      completas:Number(previous?.leitura?.completas)||0,
      parciais:Number(previous?.leitura?.parciais)||0,
      falhas:Number(previous?.leitura?.falhas)||0,
      ultimaLeitura:previous?.leitura?.ultimaLeitura||null,
    },
    imagens:Array.isArray(previous?.imagens)?previous.imagens:[],
    resumoEditorial:null,
    mudouDesdeUltimaRonda:newFacts.length>0,
    criadoEm:previous?.criadoEm||nowIso(now),
    atualizadoEm:nowIso(now),
  };
  event.pontosEmAberto=openQuestions(classification,confirmation,divergences);
  event.sugestoesPauta=pautaSuggestions(event);
  event.resumoEditorial={
    oQueAconteceu:event.resumo,
    quemEstaEnvolvido:entities.length?entities.slice(0,6).map(x=>x.name):[],
    onde:'Não identificado com segurança de forma estruturada nas fontes coletadas.',
    quando:{primeiraPublicacao:firstPublishedAt,ultimaAtualizacao:lastPublishedAt},
    porQueIssoImporta:`Relevância ${relevance}/100 com ${sources.length} ${sources.length===1?'fonte':'fontes'} e tração ${traction.score}/100.`,
    oQueHaDeNovo:event.informacoesNovas.map(info=>info.text),
    oQueAindaNaoSabemos:event.pontosEmAberto,
  };
  return event;
}

export function buildProductionFromEvent(event,type='carousel'){
  if(!event)throw new Error('Evento não encontrado');
  const evidenceFacts=(event.fatosConhecidos||[]).filter(fact=>fact?.text&&fact?.evidence?.length);
  const sources=(event.fontes||[]).filter(source=>source?.url);
  const sourceFooter=sources.slice(0,5).map(source=>source.sourceName).join(' · ')||'Fontes vinculadas ao evento';
  const title=clean(event.titulo,120);
  const newInfo=(event.informacoesNovas||[]).map(info=>info.text);
  const factTexts=evidenceFacts.map(fact=>fact.text);
  const supported=(index,fallback)=>clean(factTexts[index]||fallback,320);

  const images=(event.imagens||[]).filter(image=>image?.url).slice(0,12);
  const outputs={
    resumo:{title:'Resumo editorial',body:[event.resumoEditorial?.oQueAconteceu,...newInfo.slice(0,3)].filter(Boolean).join('\n\n'),sources,images},
    titulo:{title,body:title,sources},
    subtitulo:{title:'Subtítulo',body:supported(1,event.resumo),sources},
    breaking:{title:`BREAKING · ${title}`,body:supported(0,event.resumo),sources},
    social:{title,body:`${supported(0,event.resumo)}\n\n${newInfo[0]?`Atualização: ${newInfo[0]}\n\n`:''}Fontes: ${sourceFooter}`,sources},
    roteiro:{title,body:[`ABERTURA: ${title}`,`FATO PRINCIPAL: ${supported(0,event.resumo)}`,newInfo[0]?`NOVIDADE: ${newInfo[0]}`:null,`CONFIRMAÇÃO: ${event.nivelConfirmacao?.level||'N/D'}`,`FONTES: ${sourceFooter}`].filter(Boolean).join('\n\n'),sources},
    timeline:{title:'Linha do tempo',body:(event.timeline||[]).map(entry=>`${entry.at||''} — ${entry.detail}`).join('\n'),sources},
    qa:{title:'Perguntas e respostas',body:(event.pontosEmAberto||[]).map((question,index)=>`P${index+1}. ${question}\nR. Ainda em apuração; consulte as fontes vinculadas ao evento.`).join('\n\n'),sources},
  };

  if(type!=='carousel'){const selected=outputs[type]||outputs.resumo;return {...selected,images:selected.images||images};}

  const slides=[];
  const add=(role,slideTitle,body,evidence=[])=>slides.push({number:slides.length+1,role,title:clean(slideTitle,120),body:clean(body,520),evidence});
  add('Capa',title,`${event.editoria} · ${event.fontes?.length||0} fontes`,[]);
  add('O que aconteceu','O que aconteceu',supported(0,event.resumo),evidenceFacts[0]?.evidence||[]);
  if(newInfo[0])add('O que mudou','O que mudou',newInfo[0],event.informacoesNovas?.[0]?.evidence||[]);
  else add('Contexto','Contexto',supported(1,'Não houve informação nova identificada nesta rodada.'),evidenceFacts[1]?.evidence||[]);
  add('Confirmação','O que está confirmado',`Nível ${event.nivelConfirmacao?.level||'N/D'}. ${event.nivelConfirmacao?.reasons?.slice(0,2).join(' ')||''}`,[]);
  if(event.divergencias?.[0])add('Divergência','Há divergência entre fontes',event.divergencias[0].description,event.divergencias[0].values?.flatMap(value=>value.evidence||[])||[]);
  else add('Impacto','Por que acompanhar',event.resumoEditorial?.porQueIssoImporta||`Relevância ${event.relevancia}/100.`,[]);
  add('Próximos passos','O que ainda falta saber',(event.pontosEmAberto||[]).slice(0,3).map(q=>`• ${q}`).join('\n'),[]);
  add('Fontes','Continue a apuração',`${sources.length} links preservados.\n${sourceFooter}`,sources.map(source=>({sourceName:source.sourceName,url:source.url,title:source.title,publishedAt:source.publishedAt})));
  return {title,language:'pt-BR',mode:'event-evidence-only',eventId:event.eventId,slides,sources,images,unsupportedFactsAllowed:false};
}

async function exec(db,sql,bindings=[]){
  const stmt=db.prepare(sql);return bindings.length?stmt.bind(...bindings).run():stmt.run();
}

async function first(db,sql,bindings=[]){
  const stmt=db.prepare(sql);return bindings.length?stmt.bind(...bindings).first():stmt.first();
}

async function all(db,sql,bindings=[]){
  const stmt=db.prepare(sql);const result=bindings.length?await stmt.bind(...bindings).all():await stmt.all();return result?.results||[];
}

export async function ensureEditorialEventSchema(db){
  if(!db?.prepare)throw new Error('D1 indisponível');
  if(editorialSchemaPromise)return editorialSchemaPromise;
  editorialSchemaPromise=(async()=>{
  const statements=[
    `CREATE TABLE IF NOT EXISTS editorial_events (
      event_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      editoria TEXT,
      subeditoria TEXT,
      theme TEXT,
      status TEXT,
      relevance INTEGER NOT NULL DEFAULT 0,
      traction INTEGER NOT NULL DEFAULT 0,
      confirmation_level TEXT,
      first_published_at TEXT,
      last_published_at TEXT,
      run_id TEXT,
      signature TEXT,
      source_names_json TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_editorial_events_updated ON editorial_events(updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_editorial_events_status ON editorial_events(status, relevance DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_editorial_events_editoria ON editorial_events(editoria, updated_at DESC)`,
    `CREATE TABLE IF NOT EXISTS editorial_event_articles (
      event_id TEXT NOT NULL,
      article_key TEXT NOT NULL,
      url TEXT NOT NULL,
      source_name TEXT,
      title TEXT,
      published_at TEXT,
      read_status TEXT NOT NULL DEFAULT 'discovered',
      read_mode TEXT,
      word_count INTEGER NOT NULL DEFAULT 0,
      content_hash TEXT,
      article_json TEXT,
      error TEXT,
      first_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(event_id, article_key)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_event_articles_status ON editorial_event_articles(read_status, updated_at)`,
    `CREATE INDEX IF NOT EXISTS idx_event_articles_event ON editorial_event_articles(event_id, published_at DESC)`,
    `CREATE TABLE IF NOT EXISTS editorial_event_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      update_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      source_url TEXT,
      source_name TEXT,
      published_at TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_event_updates_event ON editorial_event_updates(event_id, created_at DESC)`,
  ];
  for(const sql of statements)await exec(db,sql);
  // Migrações aditivas e idempotentes para instalações que tenham criado a
  // tabela durante um deploy parcial anterior.
  await exec(db,'ALTER TABLE editorial_events ADD COLUMN signature TEXT').catch(()=>null);
  await exec(db,'ALTER TABLE editorial_events ADD COLUMN source_names_json TEXT').catch(()=>null);
  return true;
  })().catch(error=>{editorialSchemaPromise=null;throw error;});
  return editorialSchemaPromise;
}

async function storedEvent(db,eventId){
  const row=await first(db,'SELECT payload_json FROM editorial_events WHERE event_id = ? LIMIT 1',[eventId]);
  return parsePayload(row?.payload_json);
}

async function recentStoredEvents(db,{hours=EVENT_WINDOW_HOURS,limit=EVENT_LIST_LIMIT}={}){
  const cutoff=new Date(Date.now()-clamp(hours,1,720)*3600000).toISOString();
  const rows=await all(db,'SELECT event_id,title,editoria,status,source_names_json,last_published_at,updated_at FROM editorial_events WHERE updated_at >= ? ORDER BY relevance DESC, updated_at DESC LIMIT ?',[cutoff,clamp(limit,1,500)]);
  return rows.map(row=>({
    eventId:row.event_id,
    titulo:row.title,
    editoria:row.editoria,
    status:row.status,
    fontes:(parsePayload(row.source_names_json)||[]).map(sourceName=>({sourceName})),
    ultimaAtualizacao:row.last_published_at||row.updated_at,
  }));
}

async function saveEvent(db,event){
  const signature=normalizedTokens(event.titulo).join(' ');
  const sourceNames=unique((event.fontes||[]).map(source=>source.sourceName));
  await exec(db,`INSERT INTO editorial_events (
    event_id,title,editoria,subeditoria,theme,status,relevance,traction,confirmation_level,
    first_published_at,last_published_at,run_id,signature,source_names_json,payload_json,created_at,updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(event_id) DO UPDATE SET
    title=excluded.title, editoria=excluded.editoria, subeditoria=excluded.subeditoria, theme=excluded.theme,
    status=excluded.status, relevance=excluded.relevance, traction=excluded.traction,
    confirmation_level=excluded.confirmation_level, first_published_at=excluded.first_published_at,
    last_published_at=excluded.last_published_at, run_id=excluded.run_id, signature=excluded.signature,
    source_names_json=excluded.source_names_json, payload_json=excluded.payload_json, updated_at=excluded.updated_at`,[
      event.eventId,event.titulo,event.editoria,event.subeditoria,event.tema,event.status,event.relevancia,
      event.tracao?.score||0,event.nivelConfirmacao?.level||null,event.primeiraPublicacao,event.ultimaAtualizacao,
      event.runId||null,signature,stringify(sourceNames),stringify(event),event.criadoEm,event.atualizadoEm,
    ]);
}

async function upsertEventArticles(db,event){
  const candidates=[];
  const now=nowIso();
  const rows=await all(db,'SELECT article_key,url,read_status,updated_at FROM editorial_event_articles WHERE event_id=?',[event.eventId]);
  const existing=new Map(rows.map(row=>[row.article_key,row]));
  const materialMap=new Map((event.materias||[]).filter(item=>item?.url&&item?.articleKey).map(item=>[item.articleKey,item]));

  // Primeiro reaproveita tarefas pendentes já registradas. Isso evita criar
  // novos trabalhos enquanto uma leitura anterior ainda está válida.
  for(const row of rows){
    if(candidates.length>=EVENT_SOURCES_PER_ROUND)break;
    const item=materialMap.get(row.article_key);if(!item)continue;
    const staleQueued=row.read_status==='queued'&&Date.now()-Date.parse(row.updated_at||0)>15*60*1000;
    const retryFailed=row.read_status==='failed'&&Date.now()-Date.parse(row.updated_at||0)>6*3600000;
    if(row.read_status==='discovered'||staleQueued||retryFailed)candidates.push({eventId:event.eventId,articleKey:item.articleKey,item,priority:event.relevancia||0});
  }

  // Depois avança incrementalmente para matérias ainda não lidas. No máximo
  // quatro por evento em cada ronda; as demais permanecem no payload do evento
  // e entram nas rondas seguintes.
  for(const item of event.materias||[]){
    if(candidates.length>=EVENT_SOURCES_PER_ROUND)break;
    if(!item?.url||!item?.articleKey||existing.has(item.articleKey))continue;
    const reusable=await first(db,`SELECT read_mode,word_count,content_hash,article_json,error FROM editorial_event_articles
      WHERE url=? AND read_status='complete' AND article_json IS NOT NULL ORDER BY updated_at DESC LIMIT 1`,[item.url]);
    if(reusable){
      await exec(db,`INSERT INTO editorial_event_articles (
        event_id,article_key,url,source_name,title,published_at,read_status,read_mode,word_count,content_hash,article_json,error,first_seen_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
        event.eventId,item.articleKey,item.url,item.sourceName,item.title,item.publishedAt,'complete',reusable.read_mode||'full-article-cache',
        Number(reusable.word_count)||0,reusable.content_hash||null,reusable.article_json||null,null,now,now,
      ]);
      const reusedArticle=parsePayload(reusable.article_json);
      if(reusedArticle)await refreshEventReadState(db,event.eventId,reusedArticle,item).catch(()=>null);
    }else{
      await exec(db,`INSERT INTO editorial_event_articles (
        event_id,article_key,url,source_name,title,published_at,read_status,first_seen_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?)`,[event.eventId,item.articleKey,item.url,item.sourceName,item.title,item.publishedAt,'discovered',now,now]);
      candidates.push({eventId:event.eventId,articleKey:item.articleKey,item,priority:event.relevancia||0});
    }
  }
  return candidates;
}

async function recordNewInfoUpdates(db,event,previous){
  const now=nowIso();
  if(!previous){
    const evidence=event.informacoesNovas?.[0]?.evidence?.[0]||event.fatosConhecidos?.[0]?.evidence?.[0]||{};
    await exec(db,'INSERT INTO editorial_event_updates (event_id,update_type,summary,source_url,source_name,published_at,created_at) VALUES (?,?,?,?,?,?,?)',[
      event.eventId,'new-event',clean(event.titulo,420),evidence.url||null,evidence.sourceName||null,evidence.publishedAt||event.primeiraPublicacao||null,now,
    ]).catch(()=>null);
  }
  if(!event.informacoesNovas?.length||!previous)return;
  const previousIds=new Set((previous?.informacoesNovas||[]).map(info=>info.factId));
  for(const info of event.informacoesNovas){
    if(previousIds.has(info.factId))continue;
    const evidence=info.evidence?.[0]||{};
    await exec(db,'INSERT INTO editorial_event_updates (event_id,update_type,summary,source_url,source_name,published_at,created_at) VALUES (?,?,?,?,?,?,?)',[
      event.eventId,'new-information',clean(info.text,420),evidence.url||null,evidence.sourceName||null,evidence.publishedAt||null,now,
    ]).catch(()=>null);
  }
  for(const divergence of event.divergencias||[]){
    const key=`divergence:${divergence.divergenceId}`;
    const exists=await first(db,'SELECT id FROM editorial_event_updates WHERE event_id=? AND update_type=? AND summary=? LIMIT 1',[event.eventId,'divergence',key]);
    if(!exists){
      await exec(db,'INSERT INTO editorial_event_updates (event_id,update_type,summary,created_at) VALUES (?,?,?,?)',[event.eventId,'divergence',key,now]).catch(()=>null);
    }
  }
}

async function maintainEditorialStore(db,now=new Date()){
  const historyCutoff=new Date(new Date(now).getTime()-35*24*3600000).toISOString();
  const articleCutoff=new Date(new Date(now).getTime()-30*24*3600000).toISOString();
  await exec(db,'DELETE FROM editorial_event_updates WHERE created_at < ?',[historyCutoff]).catch(()=>null);
  await exec(db,'DELETE FROM editorial_event_articles WHERE updated_at < ?',[articleCutoff]).catch(()=>null);
  await exec(db,'DELETE FROM editorial_events WHERE updated_at < ?',[historyCutoff]).catch(()=>null);
}

async function expireEditorialEvents(db,now=new Date()){
  const cutoff=new Date(new Date(now).getTime()-24*3600000).toISOString();
  const rows=await all(db,"SELECT event_id,payload_json FROM editorial_events WHERE last_published_at < ? AND status <> 'ENCERRADO' LIMIT 120",[cutoff]);
  for(const row of rows){
    const event=parsePayload(row.payload_json);if(!event)continue;
    event.status='ENCERRADO';event.atualizadoEm=nowIso(now);
    await saveEvent(db,event).catch(()=>null);
  }
  return rows.length;
}

export async function syncEditorialEvents(db,topics,{monitoringTerms=[],runId=null,at=new Date()}={}){
  await ensureEditorialEventSchema(db);
  await maintainEditorialStore(db,at).catch(()=>null);
  await expireEditorialEvents(db,at).catch(()=>0);
  const previousEvents=await recentStoredEvents(db,{hours:EVENT_WINDOW_HOURS,limit:220});
  const events=[];
  const candidates=[];
  for(const topic of Array.isArray(topics)?topics:[]){
    if(!topic?.items?.length)continue;
    const previousSummary=chooseExistingEvent(topic,previousEvents);
    const previous=previousSummary?.eventId?await storedEvent(db,previousSummary.eventId):null;
    const event=buildEditorialEvent(topic,{previous,monitoringTerms,runId,now:new Date(at)});
    await saveEvent(db,event);
    await recordNewInfoUpdates(db,event,previous);
    const articleCandidates=await upsertEventArticles(db,event);
    events.push(event);
    candidates.push(...articleCandidates.slice(0,EVENT_SOURCES_PER_ROUND));
  }
  const uniqueCandidates=[];
  const seen=new Set();
  for(const candidate of candidates.sort((a,b)=>(b.priority||0)-(a.priority||0)||Date.parse(b.item?.publishedAt||0)-Date.parse(a.item?.publishedAt||0))){
    const key=`${candidate.eventId}|${candidate.articleKey}`;
    if(seen.has(key))continue;seen.add(key);uniqueCandidates.push(candidate);
    if(uniqueCandidates.length>=EVENT_ARTICLE_READ_LIMIT)break;
  }
  return {
    events,
    enrichmentCandidates:uniqueCandidates,
    summary:{
      total:events.length,
      breaking:events.filter(event=>event.status==='BREAKING').length,
      hot:events.filter(event=>event.status==='EM ALTA').length,
      developing:events.filter(event=>event.status==='EM DESENVOLVIMENTO').length,
      changed:events.filter(event=>event.mudouDesdeUltimaRonda).length,
      divergences:events.filter(event=>event.divergencias?.length).length,
      monitored:events.filter(event=>event.termosMonitorados?.length).length,
    },
  };
}

async function markArticleStatus(db,eventId,articleKey,status,fields={}){
  const now=nowIso();
  await exec(db,`UPDATE editorial_event_articles SET
    read_status=?, read_mode=COALESCE(?,read_mode), word_count=COALESCE(?,word_count),
    content_hash=COALESCE(?,content_hash), article_json=COALESCE(?,article_json), error=?, updated_at=?
    WHERE event_id=? AND article_key=?`,[
      status,fields.readMode??null,fields.wordCount??null,fields.contentHash??null,fields.articleJson??null,fields.error??null,now,eventId,articleKey,
    ]);
}

export async function enqueueEditorialEnrichmentJobs(env,db,candidates=[]){
  // Compatibilidade primeiro: reutiliza a fila inteligente que já existe no
  // projeto. Se futuramente houver uma fila editorial dedicada, ela assume
  // automaticamente sem exigir mudança de código.
  const queue=env?.EDITORIAL_JOBS_QUEUE || env?.INTELLIGENT_JOBS_QUEUE;
  if(!queue?.send && !queue?.sendBatch)return {queued:0,available:false,queue:'none'};
  const jobs=[];
  for(const candidate of candidates.slice(0,EVENT_ARTICLE_READ_LIMIT)){
    jobs.push({type:'event-enrich',eventId:candidate.eventId,articleKey:candidate.articleKey,item:candidate.item,attempt:1});
  }
  if(!jobs.length)return {queued:0,available:true};
  if(queue.sendBatch){
    await queue.sendBatch(jobs.map(body=>({body})));
  }else{
    for(let i=0;i<jobs.length;i+=6)await Promise.all(jobs.slice(i,i+6).map(body=>queue.send(body)));
  }
  for(const job of jobs)await markArticleStatus(db,job.eventId,job.articleKey,'queued').catch(()=>null);
  return {queued:jobs.length,available:true,queue:env?.EDITORIAL_JOBS_QUEUE?'editorial':'intelligent-shared'};
}

async function refreshEventReadState(db,eventId,article,item){
  const event=await storedEvent(db,eventId);if(!event)return null;
  const rows=await all(db,'SELECT read_status, article_json FROM editorial_event_articles WHERE event_id=?',[eventId]);
  const complete=rows.filter(row=>row.read_status==='complete').length;
  const partial=rows.filter(row=>row.read_status==='partial').length;
  const failed=rows.filter(row=>row.read_status==='failed').length;
  const articleFacts=extractArticleFacts(article,item);
  const previousKnown=new Set((event.fatosConhecidos||[]).map(fact=>fact.factId));
  const genuinelyNew=articleFacts.filter(fact=>!previousKnown.has(fact.factId));
  event.fatosConhecidos=mergeFacts([...(event.fatosConhecidos||[]),...articleFacts]);
  if(genuinelyNew.length){
    const combined=mergeFacts([...(event.informacoesNovas||[]).map(info=>({...info,normalized:normalizeText(info.text),kind:'full-article'})),...genuinelyNew]);
    event.informacoesNovas=combined.slice(0,MAX_NEW_INFO).map(fact=>({factId:fact.factId,text:fact.text,evidence:fact.evidence}));
    event.mudouDesdeUltimaRonda=true;
    if(!['BREAKING','EM ALTA'].includes(event.status))event.status='EM DESENVOLVIMENTO';
  }
  event.leitura={total:rows.length,completas:complete,parciais:partial,falhas:failed,ultimaLeitura:nowIso()};
  const visualCandidates=[article?.images?.primary,...(article?.images?.alternatives||[])].filter(image=>image?.url);
  if(visualCandidates.length){
    const imageMap=new Map((event.imagens||[]).map(image=>[image.url,image]));
    for(const image of visualCandidates){
      imageMap.set(image.url,{
        url:image.url,
        sourceName:image.sourceName||sourceIdentity(item),
        articleUrl:image.articleUrl||article.extractionUrl||article.url||item?.url||null,
        credit:image.credit||null,
        caption:image.caption||null,
        alt:image.alt||null,
        autoUseAllowed:Boolean(image.autoUseAllowed),
      });
    }
    event.imagens=[...imageMap.values()].slice(0,18);
  }
  event.atualizadoEm=nowIso();
  event.resumoEditorial={
    ...(event.resumoEditorial||{}),
    oQueHaDeNovo:event.informacoesNovas.map(info=>info.text),
    oQueAindaNaoSabemos:event.pontosEmAberto||[],
  };
  await saveEvent(db,event);
  return event;
}

export async function processEditorialEventMessage(message,env,body={}){
  const db=env?.DB;
  if(!db?.prepare){message?.ack?.();return;}
  await ensureEditorialEventSchema(db);
  const eventId=clean(body.eventId,120),articleKey=clean(body.articleKey,120),item=body.item||{};
  if(!eventId||!articleKey||!safeUrl(item?.url)){message?.ack?.();return;}
  const row=await first(db,'SELECT read_status FROM editorial_event_articles WHERE event_id=? AND article_key=?',[eventId,articleKey]);
  if(row?.read_status==='complete'){message?.ack?.();return;}
  await markArticleStatus(db,eventId,articleKey,'reading').catch(()=>null);
  try{
    const article=await readArticle(item,fetch,{timeoutMs:14000});
    if(article.ok){
      const stored={...article,content:clean(article.content,MAX_ARTICLE_CONTENT_STORE)};
      await markArticleStatus(db,eventId,articleKey,'complete',{
        readMode:article.readMode,
        wordCount:article.wordCount,
        contentHash:stableHash(article.content||''),
        articleJson:stringify(stored),
        error:null,
      });
      await refreshEventReadState(db,eventId,article,item).catch(()=>null);
      message?.ack?.();
      return;
    }
    const status=article.readMode==='timeout'?'partial':'failed';
    await markArticleStatus(db,eventId,articleKey,status,{readMode:article.readMode,wordCount:0,error:article.error||'Falha de leitura'});
    await refreshEventReadState(db,eventId,article,item).catch(()=>null);
    message?.ack?.();
  }catch(error){
    const attempt=Number(body.attempt)||1;
    if(attempt<3&&message?.retry){message.retry({delaySeconds:Math.min(60,attempt*15)});return;}
    await markArticleStatus(db,eventId,articleKey,'failed',{error:error instanceof Error?error.message:String(error)}).catch(()=>null);
    message?.ack?.();
  }
}

export async function runEditorialEventQueue(batch,env){
  for(const message of batch?.messages||[]){
    const body=message?.body&&typeof message.body==='object'?message.body:{};
    if(body.type!=='event-enrich'){message?.ack?.();continue;}
    await processEditorialEventMessage(message,env,body);
  }
}

export async function listEditorialEvents(db,params={}){
  await ensureEditorialEventSchema(db);
  const hours=clamp(params.hours||72,1,720);
  const explicitFrom=safeDate(params.from);
  const explicitTo=safeDate(params.to);
  const cutoff=explicitFrom||new Date(Date.now()-hours*3600000).toISOString();
  const rows=await all(db,'SELECT payload_json FROM editorial_events WHERE updated_at >= ? ORDER BY relevance DESC, traction DESC, updated_at DESC LIMIT ?',[cutoff,clamp(params.limit||100,1,300)]);
  let events=rows.map(row=>parsePayload(row.payload_json)).filter(Boolean);
  if(explicitTo)events=events.filter(event=>Date.parse(event.atualizadoEm||event.ultimaAtualizacao||0)<=Date.parse(explicitTo));
  const q=normalizeText(params.q||'');
  if(params.status)events=events.filter(event=>event.status===params.status);
  if(params.editoria)events=events.filter(event=>event.editoria===params.editoria);
  if(params.region)events=events.filter(event=>event.materias?.some(item=>item.region===params.region));
  if(params.source){const source=normalizeText(params.source);events=events.filter(event=>event.fontes?.some(item=>normalizeText(item.sourceName).includes(source)));}
  if(params.term){const term=normalizeText(params.term);events=events.filter(event=>event.termosMonitorados?.some(value=>normalizeText(value).includes(term)));}
  const minRelevance=Number(params.minRelevance);
  const minTraction=Number(params.minTraction);
  if(Number.isFinite(minRelevance)&&minRelevance>0)events=events.filter(event=>Number(event.relevancia||0)>=minRelevance);
  if(Number.isFinite(minTraction)&&minTraction>0)events=events.filter(event=>Number(event.tracao?.score||0)>=minTraction);
  if(q)events=events.filter(event=>normalizeText(`${event.titulo} ${event.tema} ${event.editoria} ${event.subeditoria} ${event.entidades?.map(x=>x.name).join(' ')} ${event.fontes?.map(x=>x.sourceName).join(' ')} ${event.termosMonitorados?.join(' ')}`).includes(q));
  return events;
}

export async function getEditorialEvent(db,eventId){
  await ensureEditorialEventSchema(db);
  const event=await storedEvent(db,eventId);if(!event)return null;
  const articles=await all(db,'SELECT article_key,url,source_name,title,published_at,read_status,read_mode,word_count,error,updated_at FROM editorial_event_articles WHERE event_id=? ORDER BY published_at ASC',[eventId]);
  const updates=await all(db,'SELECT update_type,summary,source_url,source_name,published_at,created_at FROM editorial_event_updates WHERE event_id=? ORDER BY created_at DESC LIMIT 60',[eventId]);
  return {...event,articleReadings:articles,updates};
}

export async function editorialRadar(db,{hours=6,limit=20}={}){
  const events=await listEditorialEvents(db,{hours,limit:180});
  const acceleration=events
    .filter(event=>(event.tracao?.items30m||0)>0)
    .sort((a,b)=>(b.tracao?.growth30m||0)-(a.tracao?.growth30m||0)||(b.tracao?.score||0)-(a.tracao?.score||0))
    .slice(0,clamp(limit,1,50))
    .map(event=>({eventId:event.eventId,titulo:event.titulo,editoria:event.editoria,status:event.status,relevancia:event.relevancia,tracao:event.tracao,ultimaAtualizacao:event.ultimaAtualizacao}));
  return acceleration;
}

export async function editorialChanges(db,{hours=8,limit=50}={}){
  await ensureEditorialEventSchema(db);
  const cutoff=new Date(Date.now()-clamp(hours,1,168)*3600000).toISOString();
  const rows=await all(db,'SELECT event_id,update_type,summary,source_url,source_name,published_at,created_at FROM editorial_event_updates WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?',[cutoff,clamp(limit,1,200)]);
  const eventIds=unique(rows.map(row=>row.event_id));
  const titles=new Map();
  for(const id of eventIds){const event=await storedEvent(db,id);if(event)titles.set(id,event.titulo);}
  return rows.map(row=>({...row,eventTitle:titles.get(row.event_id)||'Evento editorial'}));
}

export async function editorialAlerts(db,{hours=8,limit=40}={}){
  const events=await listEditorialEvents(db,{hours,limit:180});
  const alerts=[];
  for(const event of events){
    if(event.status==='BREAKING'&&event.relevancia>=75)alerts.push({type:'BREAKING',eventId:event.eventId,title:event.titulo,detail:'Evento novo de alta relevância',at:event.ultimaAtualizacao});
    if(event.mudouDesdeUltimaRonda&&event.informacoesNovas?.length)alerts.push({type:'ATUALIZAÇÃO IMPORTANTE',eventId:event.eventId,title:event.titulo,detail:event.informacoesNovas[0].text,at:event.ultimaAtualizacao});
    if((event.tracao?.growth30m||0)>=150)alerts.push({type:'TENDÊNCIA',eventId:event.eventId,title:event.titulo,detail:`Assunto cresceu ${event.tracao.growth30m}% nos últimos 30 minutos`,at:event.ultimaAtualizacao});
    if(event.divergencias?.length)alerts.push({type:'DIVERGÊNCIA',eventId:event.eventId,title:event.titulo,detail:event.divergencias[0].description,at:event.ultimaAtualizacao});
  }
  const priority={'BREAKING':4,'ATUALIZAÇÃO IMPORTANTE':3,'DIVERGÊNCIA':2,'TENDÊNCIA':1};
  return alerts.sort((a,b)=>(priority[b.type]||0)-(priority[a.type]||0)||Date.parse(b.at||0)-Date.parse(a.at||0)).slice(0,clamp(limit,1,100));
}

export async function handleEditorialEventsApi(request,env){
  const url=new URL(request.url);
  const db=env?.DB;
  if(!db?.prepare)return json({ok:false,error:'Banco editorial indisponível'},503);

  if(url.pathname==='/api/editorial-events'&&request.method==='GET'){
    const events=await listEditorialEvents(db,{
      hours:url.searchParams.get('hours')||72,
      limit:url.searchParams.get('limit')||100,
      status:url.searchParams.get('status')||'',
      editoria:url.searchParams.get('editoria')||'',
      region:url.searchParams.get('region')||'',
      source:url.searchParams.get('source')||'',
      term:url.searchParams.get('term')||'',
      minRelevance:url.searchParams.get('minRelevance')||'',
      minTraction:url.searchParams.get('minTraction')||'',
      q:url.searchParams.get('q')||'',
      from:url.searchParams.get('from')||'',
      to:url.searchParams.get('to')||'',
    });
    return json({ok:true,events,totals:{events:events.length,breaking:events.filter(x=>x.status==='BREAKING').length,hot:events.filter(x=>x.status==='EM ALTA').length,developing:events.filter(x=>x.status==='EM DESENVOLVIMENTO').length,changed:events.filter(x=>x.mudouDesdeUltimaRonda).length,divergences:events.filter(x=>x.divergencias?.length).length}});
  }

  if(url.pathname==='/api/editorial-alerts'&&request.method==='GET'){
    return json({ok:true,items:await editorialAlerts(db,{hours:url.searchParams.get('hours')||8,limit:url.searchParams.get('limit')||40})});
  }

  if(url.pathname==='/api/editorial-radar'&&request.method==='GET'){
    return json({ok:true,items:await editorialRadar(db,{hours:url.searchParams.get('hours')||6,limit:url.searchParams.get('limit')||20})});
  }

  if(url.pathname==='/api/editorial-changes'&&request.method==='GET'){
    return json({ok:true,items:await editorialChanges(db,{hours:url.searchParams.get('hours')||8,limit:url.searchParams.get('limit')||50})});
  }

  const eventRoute=/^\/api\/editorial-events\/([a-z0-9-]{8,140})$/i.exec(url.pathname);
  if(eventRoute&&request.method==='GET'){
    const event=await getEditorialEvent(db,eventRoute[1]);
    return event?json({ok:true,event}):json({ok:false,error:'Evento editorial não encontrado'},404);
  }

  const produceRoute=/^\/api\/editorial-events\/([a-z0-9-]{8,140})\/produce$/i.exec(url.pathname);
  if(produceRoute&&request.method==='POST'){
    const event=await getEditorialEvent(db,produceRoute[1]);
    if(!event)return json({ok:false,error:'Evento editorial não encontrado'},404);
    const body=await request.json().catch(()=>({}));
    const type=clean(body?.type||'carousel',40).toLowerCase();
    const allowed=new Set(['resumo','titulo','subtitulo','breaking','social','carousel','roteiro','timeline','qa']);
    if(!allowed.has(type))return json({ok:false,error:'Formato de produção inválido'},400);
    return json({ok:true,type,data:buildProductionFromEvent(event,type),traceability:{eventId:event.eventId,sources:event.fontes||[],facts:(event.fatosConhecidos||[]).map(fact=>({factId:fact.factId,evidence:fact.evidence}))}});
  }

  return json({ok:false,error:'Endpoint editorial não encontrado'},404);
}
