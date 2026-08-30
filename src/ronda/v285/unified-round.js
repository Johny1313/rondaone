import { buildCarouselBrief } from './clustering.js';

function clean(value,max=500){
  return String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
}

function safeDate(value){
  const time=Date.parse(value||'');
  return Number.isFinite(time)?new Date(time).toISOString():null;
}

function safeUrl(value){
  try{
    const url=new URL(String(value||''));
    if(!/^https?:$/.test(url.protocol))return null;
    url.hash='';
    return url.toString();
  }catch{return null;}
}

function eventPriority(event){
  const status=String(event?.status||'').toUpperCase();
  if(status==='BREAKING')return 'Urgente';
  if(status==='EM ALTA')return 'Em aceleração';
  if(status==='EM DESENVOLVIMENTO'||status==='ATUALIZADO')return 'Atualização importante';
  if(status==='MONITORADO')return 'Monitorado';
  return 'Novidade';
}

function eventTone(event){
  const status=String(event?.status||'').toUpperCase();
  if(status==='BREAKING')return 'urgent';
  if(status==='EM ALTA')return 'rising';
  return 'normal';
}

function eventUpdateUrls(event){
  const urls=new Set();
  for(const info of event?.informacoesNovas||[]){
    for(const evidence of info?.evidence||[]){
      const url=safeUrl(evidence?.url);
      if(url)urls.add(url);
    }
  }
  return urls;
}

function eventMaterialItem(material,event,index=0){
  const url=safeUrl(material?.url);
  if(!url)return null;
  const firstSeen=safeDate(event?.criadoEm)||safeDate(event?.primeiraPublicacao)||safeDate(material?.publishedAt)||new Date().toISOString();
  const eventUpdated=safeDate(event?.atualizadoEm)||safeDate(event?.ultimaAtualizacao)||firstSeen;
  const updateUrls=eventUpdateUrls(event);
  const eventChanged=Boolean(event?.mudouDesdeUltimaRonda);
  const isNewEvidence=eventChanged&&updateUrls.has(url);
  return {
    id:clean(material?.articleKey||`${event?.eventId||'event'}-material-${index}`,180),
    kind:material?.kind||'portal',
    platform:'Portal',
    url,
    title:clean(material?.title||event?.titulo||'Matéria da ronda',320),
    description:clean(material?.description||event?.resumo||'',900),
    content:clean(material?.description||event?.resumo||'',900),
    sourceName:clean(material?.sourceName||'Fonte',160),
    collectorName:clean(material?.sourceName||'Fonte',160),
    publisherDomain:material?.publisherDomain||null,
    publisherHomepageUrl:material?.publisherHomepageUrl||null,
    region:material?.region||null,
    editorialHints:Array.isArray(material?.editorialHints)?material.editorialHints:[],
    publishedAt:safeDate(material?.publishedAt)||safeDate(event?.ultimaAtualizacao)||firstSeen,
    firstSeenAt:firstSeen,
    discoveredAt:firstSeen,
    lastSeenAt:eventUpdated,
    // Se o evento mudou, a Principal deve enxergar a atividade editorial recente.
    // publishedAt continua intacto como data original da fonte.
    radarAt:eventChanged?eventUpdated:firstSeen,
    editorialNewEvidence:isNewEvidence,
    editorialEventId:event?.eventId||null,
    editorialStatus:event?.status||null,
    collectionRoute:'editorial-event-overlay',
  };
}

export function topicFromEditorialEvent(event){
  if(!event?.eventId)return null;
  const items=(event.materias||[]).map((item,index)=>eventMaterialItem(item,event,index)).filter(Boolean);
  if(!items.length)return null;
  const sourceNames=[...new Set(items.map(item=>item.sourceName).filter(Boolean))];
  const lastPublishedAt=items.map(item=>safeDate(item.publishedAt)).filter(Boolean).sort().at(-1)||safeDate(event?.ultimaAtualizacao)||new Date().toISOString();
  const growth=Number(event?.tracao?.growth30m)||0;
  const topic={
    id:event.eventId,
    title:clean(event?.titulo||items[0]?.title||'Evento editorial',240),
    editoria:clean(event?.editoria||'Notícias',100),
    priority:eventPriority(event),
    tone:eventTone(event),
    score:Math.max(0,Math.min(100,Number(event?.relevancia)||0)),
    lastPublishedAt,
    sourceNames,
    sourceCount:sourceNames.length,
    itemCount:items.length,
    portalCount:items.filter(item=>item.kind!=='social').length,
    socialCount:items.filter(item=>item.kind==='social').length,
    views:null,
    comments:null,
    interactions:null,
    momentum:growth>0?`Tração +${growth}% em 30 min`:event?.status==='EM ALTA'?'Assunto em aceleração':'Evento acompanhado pela Mesa Editorial',
    recommendation:clean(event?.sugestoesPauta?.[0]||'Confirmar os fatos nas fontes originais e acompanhar novas atualizações.',320),
    items,
    editorialEvent:{
      eventId:event.eventId,
      status:event.status||null,
      relevance:Number(event.relevancia)||0,
      traction:event.tracao||null,
      changed:Boolean(event.mudouDesdeUltimaRonda),
      updatedAt:safeDate(event.atualizadoEm)||safeDate(event.ultimaAtualizacao)||null,
    },
  };
  return {...topic,carousel:buildCarouselBrief(topic)};
}

function urlKey(value){return safeUrl(value)||null;}

function newestIso(...values){
  const valid=values.flat().map(safeDate).filter(Boolean).sort();
  return valid.at(-1)||null;
}

function mergeTopicWithEvent(topic,eventTopic){
  const existingByUrl=new Map((topic.items||[]).map(item=>[urlKey(item?.url),item]).filter(([key])=>key));
  const items=[...(topic.items||[])];
  for(const item of eventTopic.items||[]){
    const key=urlKey(item?.url);
    if(key&&existingByUrl.has(key)){
      const current=existingByUrl.get(key);
      Object.assign(current,{
        editorialEventId:item.editorialEventId,
        editorialStatus:item.editorialStatus,
        radarAt:item.radarAt||current.radarAt,
        firstSeenAt:current.firstSeenAt||item.firstSeenAt,
        discoveredAt:current.discoveredAt||item.discoveredAt,
        lastSeenAt:newestIso(current.lastSeenAt,item.lastSeenAt)||current.lastSeenAt||item.lastSeenAt,
      });
      continue;
    }
    if(key)existingByUrl.set(key,item);
    items.push(item);
  }
  const sourceNames=[...new Set(items.map(item=>item.sourceName).filter(Boolean))];
  const merged={
    ...topic,
    editoria:eventTopic.editoria||topic.editoria,
    priority:eventTopic.tone==='urgent'?eventTopic.priority:topic.priority||eventTopic.priority,
    tone:eventTopic.tone==='urgent'?'urgent':topic.tone||eventTopic.tone,
    score:Math.max(Number(topic.score)||0,Number(eventTopic.score)||0),
    lastPublishedAt:newestIso(topic.lastPublishedAt,eventTopic.lastPublishedAt)||topic.lastPublishedAt||eventTopic.lastPublishedAt,
    sourceNames,
    sourceCount:sourceNames.length,
    itemCount:items.length,
    portalCount:items.filter(item=>item.kind!=='social').length,
    socialCount:items.filter(item=>item.kind==='social').length,
    momentum:eventTopic.editorialEvent?.changed?eventTopic.momentum:(topic.momentum||eventTopic.momentum),
    recommendation:topic.recommendation||eventTopic.recommendation,
    items,
    editorialEvent:eventTopic.editorialEvent,
  };
  return {...merged,carousel:buildCarouselBrief(merged)};
}

export function mergeEditorialEventsIntoRound(payload,events=[],now=new Date()){
  if(!payload||typeof payload!=='object'||!Array.isArray(payload.items)||!Array.isArray(payload.topics))return payload;
  const items=[...payload.items];
  const topics=[...payload.topics];
  const itemUrls=new Set(items.map(item=>urlKey(item?.url)).filter(Boolean));
  const topicUrls=topics.map(topic=>new Set((topic.items||[]).map(item=>urlKey(item?.url)).filter(Boolean)));
  let mergedEvents=0;
  let addedTopics=0;
  let addedItems=0;
  let latestEventAt=null;

  for(const event of Array.isArray(events)?events:[]){
    if(!event?.eventId||String(event.status||'').toUpperCase()==='ENCERRADO')continue;
    const eventTopic=topicFromEditorialEvent(event);
    if(!eventTopic)continue;
    latestEventAt=newestIso(latestEventAt,eventTopic.editorialEvent?.updatedAt,event?.atualizadoEm,event?.ultimaAtualizacao);
    const eventUrls=new Set(eventTopic.items.map(item=>urlKey(item.url)).filter(Boolean));
    let target=-1;
    for(let index=0;index<topicUrls.length;index++){
      const overlap=[...eventUrls].some(url=>topicUrls[index].has(url));
      if(overlap){target=index;break;}
    }
    if(target>=0){
      topics[target]=mergeTopicWithEvent(topics[target],eventTopic);
      topicUrls[target]=new Set((topics[target].items||[]).map(item=>urlKey(item?.url)).filter(Boolean));
      mergedEvents+=1;
    }else{
      topics.push(eventTopic);
      topicUrls.push(eventUrls);
      addedTopics+=1;
    }
    for(const item of eventTopic.items){
      const key=urlKey(item.url);
      if(key&&itemUrls.has(key))continue;
      if(key)itemUrls.add(key);
      items.push(item);
      addedItems+=1;
    }
  }

  topics.sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0)||Date.parse(b.lastPublishedAt||0)-Date.parse(a.lastPublishedAt||0));
  const sourceCount=new Set(items.map(item=>item.sourceName).filter(Boolean)).size;
  const socialItems=items.filter(item=>item.kind==='social').length;
  return {
    ...payload,
    items,
    topics,
    totals:{
      ...(payload.totals||{}),
      items:items.length,
      topics:topics.length,
      sources:sourceCount,
      socialItems,
    },
    editorialOverlay:{
      enabled:true,
      eventsConsidered:(Array.isArray(events)?events:[]).length,
      mergedEvents,
      addedTopics,
      addedItems,
      updatedAt:latestEventAt||safeDate(payload.collectedAt)||new Date(now).toISOString(),
      mode:'main-round-unified',
    },
  };
}
