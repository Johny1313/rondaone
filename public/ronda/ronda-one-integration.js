(()=>{
  'use strict';

  const VERSION='0.7.7';
  const JOB_KEY='rondaOne.intelligentJob';
  const MAX_LOCAL_JOB_AGE_MS=12*60*1000;
  const btn=document.getElementById('openRondaDesign');
  const copy=document.getElementById('copyCarousel');
  const modal=document.getElementById('carouselModal');
  const statusLabelEl=document.getElementById('statusLabel');
  const statusSubEl=document.getElementById('statusSub');
  const runBtn=document.getElementById('runRound');

  const textOf=(el)=>String(el?.textContent||'').replace(/\s+/g,' ').trim();

  function currentCopyButton(){
    return document.getElementById('copyCarousel') || copy;
  }

  function currentDesignButton(){
    return document.getElementById('openRondaDesign') || btn;
  }

  function findGenerateAgainButton(){
    return [...document.querySelectorAll('button')].find((node)=>/gerar novamente/i.test(textOf(node))) || null;
  }

  function ensureRondaDesignFlow(){
    const copyBtn=currentCopyButton();
    const designBtn=currentDesignButton();
    const regenBtn=findGenerateAgainButton();
    if(!copyBtn || !designBtn || !regenBtn) return false;
    const anchor=regenBtn.parentElement;
    if(!anchor) return false;
    let host=document.getElementById('rondaOneFlowActions');
    if(!host){
      host=document.createElement('div');
      host.id='rondaOneFlowActions';
      host.className='ronda-one-flow-actions';
      anchor.insertAdjacentElement('afterend',host);
    }
    if(copyBtn.parentElement!==host) host.appendChild(copyBtn);
    if(designBtn.parentElement!==host) host.appendChild(designBtn);
    copyBtn.classList.add('ronda-one-flow-btn');
    designBtn.classList.add('ronda-one-flow-btn');
    return true;
  }

  const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));

  function readStoredJob(){
    try{
      const raw=localStorage.getItem(JOB_KEY);
      if(!raw)return null;
      const job=JSON.parse(raw);
      const started=Date.parse(job?.startedAt||'');
      if(!job?.jobId||!Number.isFinite(started)){
        localStorage.removeItem(JOB_KEY);
        return null;
      }
      return {...job,startedMs:started,ageMs:Date.now()-started};
    }catch{
      try{localStorage.removeItem(JOB_KEY)}catch{}
      return null;
    }
  }

  function clearStoredJob(jobId=null){
    try{
      if(!jobId){
        localStorage.removeItem(JOB_KEY);
        return true;
      }
      const current=readStoredJob();
      if(!current||current.jobId===jobId){
        localStorage.removeItem(JOB_KEY);
        return true;
      }
    }catch{}
    return false;
  }

  function storeJob(jobId){
    try{
      localStorage.setItem(JOB_KEY,JSON.stringify({
        jobId,
        topicId:typeof state!=='undefined' ? (state?.pendingCarouselTopicId||state?.activeTopicId||null) : null,
        slideCount:typeof state!=='undefined' ? (state?.activeSlideCount||null) : null,
        startedAt:new Date().toISOString()
      }));
    }catch{}
  }

  function clearStaleStoredJob(){
    const job=readStoredJob();
    if(job && job.ageMs>MAX_LOCAL_JOB_AGE_MS){
      clearStoredJob(job.jobId);
      try{
        if(typeof state!=='undefined'){
          state.carouselLoading=false;
          state.pendingCarouselTopicId=null;
        }
      }catch{}
      return true;
    }
    return false;
  }

  function isReconnectUi(){
    const label=String(statusLabelEl?.textContent||'');
    const sub=String(statusSubEl?.textContent||'');
    return /reconect|fila inteligente|retomada automática/i.test(`${label} ${sub}`);
  }

  async function withTimeout(promise,ms){
    let timer;
    try{
      return await Promise.race([
        promise,
        new Promise((_,reject)=>{
          timer=setTimeout(()=>reject(new Error('recovery-timeout')),ms);
        })
      ]);
    }finally{
      clearTimeout(timer);
    }
  }

  async function recoverCoreUi({force=false}={}){
    const stale=clearStaleStoredJob();
    if(!force && !stale && !isReconnectUi())return false;

    try{
      if(typeof state!=='undefined'){
        state.serverRunning=false;
        if(stale)state.carouselLoading=false;
      }
    }catch{}

    try{
      if(typeof checkHealth==='function'){
        await withTimeout(Promise.resolve(checkHealth()),8000).catch(()=>null);
      }
      if(typeof pollStatus==='function'){
        await withTimeout(Promise.resolve(pollStatus({force:true})),8000).catch(()=>null);
      }
      if(typeof loadLatest==='function'){
        await withTimeout(Promise.resolve(loadLatest({quiet:true,force:true})),12000).catch(()=>null);
      }
      if(typeof render==='function'){
        try{render()}catch{}
      }

      if(isReconnectUi() && typeof setStatus==='function'){
        const last=(()=>{
          try{
            return state?.data?.collectedAt||state?.data?.storedAt||state?.health?.lastSuccessAt||null;
          }catch{return null;}
        })();
        setStatus(last?'ok':'warn','Serviço online',last?'Última ronda carregada':'Aguardando próxima ronda');
      }

      if(runBtn){
        try{runBtn.disabled=Boolean(typeof state!=='undefined' && state.running)}catch{runBtn.disabled=false}
      }
      return true;
    }catch(error){
      console.warn('RONDA ONE UI recovery',error);
      return false;
    }
  }

  function carouselReady(){
    try{
      return Boolean(typeof state!=='undefined' && state?.activeCarousel?.slides?.length);
    }catch{
      return false;
    }
  }

  function syncDesignButton(){
    if(!btn)return;
    const ready=carouselReady();
    btn.disabled=!ready;
    if(ready){
      const reviewRequired=Boolean(currentCopyButton()?.disabled);
      btn.title=reviewRequired
        ? 'Abrir no Ronda Design para editar. A publicação ainda depende da revisão editorial.'
        : 'Abrir este carrossel no Ronda Design.';
    }else{
      btn.title='Gere o roteiro para abrir no Ronda Design.';
    }
  }

  if(btn){
    syncDesignButton();
    if(modal){
      new MutationObserver(syncDesignButton).observe(modal,{
        subtree:true,
        childList:true,
        attributes:true,
        attributeFilter:['disabled','hidden','class']
      });
    }
    if(copy){
      new MutationObserver(syncDesignButton).observe(copy,{
        attributes:true,
        attributeFilter:['disabled']
      });
    }
  }

  // Polling resiliente: 70 s é apenas aviso; 8 min libera a UI local.
  try{
    if(typeof waitForIntelligentJob==='function'){
      waitForIntelligentJob=async function(jobId,requestSerial,pollAfterMs=900){
        const startedAt=Date.now();
        const hardDeadline=startedAt+(8*60*1000);
        let transientErrors=0;

        storeJob(jobId);

        while(Date.now()<hardDeadline){
          if(requestSerial!==state.carouselRequestSerial){
            clearStoredJob(jobId);
            return null;
          }

          await sleep(Math.max(700,Number(pollAfterMs)||900));
          if(requestSerial!==state.carouselRequestSerial){
            clearStoredJob(jobId);
            return null;
          }

          let response;
          try{
            response=await api(`/api/intelligent-jobs/${encodeURIComponent(jobId)}?t=${Date.now()}`);
            transientErrors=0;
          }catch(error){
            transientErrors+=1;
            if(transientErrors>=5){
              // O job pode continuar no servidor, mas deixa de bloquear o navegador.
              clearStoredJob(jobId);
              try{state.carouselLoading=false}catch{}
              throw new Error('A conexão com a tarefa foi interrompida. A interface foi liberada; tente novamente sem atualizar a página.');
            }
            if(typeof setCarouselLoading==='function'){
              setCarouselLoading(true,
                'A conexão oscilou, mas o processamento continua na fila. Reconectando…',
                {progress:5,title:'Processamento continua no Cloudflare'});
            }
            continue;
          }

          const job=response?.job||{};

          if(job.status==='succeeded'&&response?.data?.slides?.length){
            clearStoredJob(jobId);
            return response.data;
          }

          if(job.status==='failed'||job.stale===true){
            clearStoredJob(jobId);
            const detail=job.error||job.message||(job.stale?'A tarefa anterior ficou sem atualização.':'O processamento foi interrompido.');
            throw new Error(`${detail} O sistema foi liberado para iniciar uma nova leitura.`);
          }

          const elapsed=Date.now()-startedAt;
          if(elapsed>=70_000){
            if(typeof setCarouselLoading==='function'){
              setCarouselLoading(true,
                `${job.message||'Processando a matéria.'} O job continua em segundo plano; não é necessário atualizar a página.`,
                {
                  progress:Number(job.progress)||1,
                  title:job.status==='queued'
                    ? 'Leitura ainda na fila'
                    : 'Leitura inteligente continua em segundo plano'
                }
              );
            }
          }else if(typeof setCarouselJobProgress==='function'){
            setCarouselJobProgress(job);
          }
        }

        clearStoredJob(jobId);
        try{state.carouselLoading=false}catch{}
        throw new Error('A tarefa não recebeu conclusão em 8 minutos. A tela foi liberada para uma nova tentativa; a Ronda principal continua operacional.');
      };
    }
  }catch(error){
    console.error('RONDA ONE: não foi possível aplicar o polling resiliente',error);
  }

  function resolveActiveArticleMeta(){
    const carousel=state?.activeCarousel || {};
    const reading=carousel.reading || {};
    const selected=reading.selectedSource || reading.source || {};
    const verificationLinks=Array.isArray(carousel.verificationLinks) ? carousel.verificationLinks : [];
    const fallback=verificationLinks.find((item)=>item?.url) || {};
    const url=selected.url || reading.articleUrl || fallback.url || '';
    const sourceName=selected.sourceName || selected.publisher || fallback.sourceName || fallback.title || '';
    return {
      url: String(url || '').trim(),
      sourceName: String(sourceName || '').trim(),
    };
  }

  async function fetchArticleVisualsForHandoff(){
    const meta=resolveActiveArticleMeta();
    if(!meta.url) return null;
    const qs=new URLSearchParams({url:meta.url});
    if(meta.sourceName) qs.set('sourceName',meta.sourceName);
    const response=await withTimeout(fetch(`/api/article-visuals?${qs.toString()}`, {headers:{'Accept':'application/json'}}), 7000);
    const out=await response.json().catch(()=>({}));
    if(!response.ok || !out?.ok || !out?.articleVisuals) return null;
    return out;
  }

  async function openRondaDesign(){
    if(!btn)return;
    const topic=(state.data?.topics||[]).find(x=>x.id===state.activeTopicId);
    const carousel=state.activeCarousel;

    if(!topic||!carousel?.slides?.length){
      const message=document.getElementById('copyCarouselMessage');
      if(message)message.textContent='Gere o roteiro antes de abrir no Ronda Design.';
      syncDesignButton();
      return;
    }

    const payload={
      sourceVersion:'ronda-editorial-2.8.5',
      runId:state.data?.runId||state.lastRunId||'',
      topic,
      carousel,
      editorialReviewRequired:Boolean(currentCopyButton()?.disabled),
      handoffVersion:'ronda-one-0.7.7'
    };

    const old=btn.textContent;
    btn.disabled=true;
    btn.textContent='Preparando…';

    try{
      const visualsPayload=await fetchArticleVisualsForHandoff().catch(()=>null);
      if(visualsPayload?.articleVisuals){
        payload.articleVisuals=visualsPayload.articleVisuals;
        payload.carousel={
          ...carousel,
          articleVisuals:visualsPayload.articleVisuals,
          visualSource:{
            articleUrl:visualsPayload.articleUrl||'',
            resolvedUrl:visualsPayload.resolvedUrl||'',
            sourceName:visualsPayload.sourceName||''
          }
        };
        try{ state.activeCarousel=payload.carousel; }catch{}
      }

      const res=await fetch('/api/projects/from-ronda',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      });
      const out=await res.json().catch(()=>({}));
      if(!res.ok||!out.ok)throw new Error(out.error||'Projeto compartilhado indisponível');
      location.href='/design/?project='+encodeURIComponent(out.id);
    }catch(err){
      try{
        localStorage.setItem('rondaOne.handoff',JSON.stringify(payload));
        location.href='/design/?handoff=local';
        return;
      }catch{}
      btn.textContent=old;
      syncDesignButton();
      const message=document.getElementById('copyCarouselMessage');
      if(message)message.textContent=err?.message||'Não foi possível abrir o Ronda Design.';
    }
  }

  if(btn)btn.addEventListener('click',openRondaDesign);
  ensureRondaDesignFlow();

  try{
    const modalNode=document.getElementById('carouselModal') || document.body;
    new MutationObserver(()=>{ ensureRondaDesignFlow(); syncDesignButton(); }).observe(modalNode,{subtree:true,childList:true,attributes:true});
  }catch{}

  // Recupera mais rápido quando o navegador volta ao foco ou a rede retorna.
  window.addEventListener('online',()=>recoverCoreUi({force:true}));
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)recoverCoreUi({force:isReconnectUi()||clearStaleStoredJob()});
  });

  setTimeout(()=>{ ensureRondaDesignFlow(); recoverCoreUi({force:clearStaleStoredJob()}); },1800);
  setInterval(()=>{
    ensureRondaDesignFlow();
    syncDesignButton();
    if(isReconnectUi()||clearStaleStoredJob())recoverCoreUi({force:true});
  },3000);

  console.info(`RONDA ONE integration ${VERSION} loaded`);
})();
