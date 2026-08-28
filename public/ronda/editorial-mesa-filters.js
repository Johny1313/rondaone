(()=>{
  'use strict';
  const root=typeof window!=='undefined'?window:globalThis;
  const DEVELOPMENT_STATUSES=new Set(['EM DESENVOLVIMENTO','NOVO','ATUALIZADO']);
  const normalize=value=>String(value||'').trim().toLocaleUpperCase('pt-BR');

  function updatedMs(event){
    const value=event?.ultimaAtualizacao||event?.atualizadoEm||event?.primeiraPublicacao||0;
    const ms=Date.parse(value);
    return Number.isFinite(ms)?ms:0;
  }

  function hasRegion(event,region){
    const target=normalize(region);
    return (event?.materias||[]).some(item=>normalize(item?.region)===target);
  }

  function matches(event,filter){
    const selected=normalize(filter||'TODOS');
    const status=normalize(event?.status);
    if(selected==='TODOS')return true;
    if(selected==='BREAKING')return status==='BREAKING';
    if(selected==='EM ALTA')return status==='EM ALTA'||Number(event?.tracao?.score||0)>=75;
    if(selected==='EM DESENVOLVIMENTO'){
      if(status==='BREAKING'||status==='EM ALTA')return false;
      return DEVELOPMENT_STATUSES.has(status)||Boolean(event?.mudouDesdeUltimaRonda);
    }
    if(selected==='MONITORADO')return Boolean(event?.termosMonitorados?.length);
    if(selected==='BRASIL')return hasRegion(event,'BRASIL');
    if(selected==='MUNDO')return hasRegion(event,'MUNDO');
    if(selected==='ULTIMAS')return true;
    return status===selected;
  }

  function filterEvents(events,filter,{latestLimit=20}={}){
    const list=Array.isArray(events)?events:[];
    const selected=normalize(filter||'TODOS');
    if(selected==='ULTIMAS'){
      return [...list]
        .sort((a,b)=>updatedMs(b)-updatedMs(a))
        .slice(0,Math.max(1,Number(latestLimit)||20));
    }
    return list.filter(event=>matches(event,selected));
  }

  function visibleIds(events,filter,options){
    return new Set(filterEvents(events,filter,options).map(event=>String(event?.eventId||'')).filter(Boolean));
  }

  function filterLinked(items,events,filter,options){
    const list=Array.isArray(items)?items:[];
    if(normalize(filter)==='TODOS')return list;
    const ids=visibleIds(events,filter,options);
    return list.filter(item=>ids.has(String(item?.eventId||'')));
  }

  function counts(events){
    const list=Array.isArray(events)?events:[];
    const values=['TODOS','BREAKING','EM ALTA','EM DESENVOLVIMENTO','MONITORADO','BRASIL','MUNDO','ULTIMAS'];
    return Object.fromEntries(values.map(value=>[value,filterEvents(list,value).length]));
  }

  function summary(events){
    const list=Array.isArray(events)?events:[];
    return {
      events:list.length,
      breaking:list.filter(event=>normalize(event?.status)==='BREAKING').length,
      hot:list.filter(event=>normalize(event?.status)==='EM ALTA'||Number(event?.tracao?.score||0)>=75).length,
      changed:list.filter(event=>Boolean(event?.mudouDesdeUltimaRonda)).length,
      divergences:list.filter(event=>event?.divergencias?.length).length,
    };
  }

  root.RondaMesaFilters={normalize,updatedMs,matches,filterEvents,filterLinked,counts,summary};
})();
