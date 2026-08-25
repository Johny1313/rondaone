(()=>{
  'use strict';

  const VERSION='0.7.6';
  const JOB_KEY='rondaOne.intelligentJob';
  const MAX_LOCAL_JOB_AGE_MS=12*60*1000;
  const btn=document.getElementById('openRondaDesign');
  const copy=document.getElementById('copyCarousel');
  const modal=document.getElementById('carouselModal');
  const statusLabelEl=document.getElementById('statusLabel');
  const statusSubEl=document.getElementById('statusSub');
  const runBtn=document.getElementById('runRound');

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

  function clearStaleStoredJob(){
    const job=readStoredJob();
    if(job && job.ageMs>MAX_LOCAL_JOB_AGE_MS){
      try{localStorage.removeItem(JOB_KEY)}catch{}
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

    // Nunca deixa uma tarefa antiga bloquear a tela principal.
    try{
      if(typeof state!=='undefined'){
        state.serverRunning=false;
        if(stale) state.carouselLoading=false;
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

      // checkHealth/loadLatest devem definir o status real. Caso um texto antigo
      // tenha permanecido no DOM, substitui apenas o aviso de reconexão.
      if(isReconnectUi() && typeof setStatus==='function'){
        const last=(()=>{
          try{
            return state?.data?.collectedAt||state?.data?.storedAt||state?.health?.lastSuccessAt||null;
          }catch{return null;}
        })();
        setStatus(last?'ok':'warn',last?'Serviço online':'Serviço online',last?'Última ronda carregada':'Aguardando próxima ronda');
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
      const reviewRequired=Boolean(copy?.disabled);
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

  // Polling resiliente do carrossel. 70 s é aviso, não falha.
  try{
    if(typeof waitForIntelligentJob==='function'){
      waitForIntelligentJob=async function(jobId,requestSerial,pollAfterMs=900){
        const startedAt=Date.now();
        const hardDeadline=startedAt+(8*60*1000);
        let transientErrors=0;

        try{
          localStorage.setItem(JOB_KEY,JSON.stringify({
            jobId,
            topicId:state?.pendingCarouselTopicId||state?.activeTopicId||null,
            slideCount:state?.activeSlideCount||null,
            startedAt:new Date().toISOString()
          }));
        }catch{}

        while(Date.now()<hardDeadline){
          if(requestSerial!==state.carouselRequestSerial)return null;
          await sleep(Math.max(700,Number(pollAfterMs)||900));
          if(requestSerial!==state.carouselRequestSerial)return null;

          let response;
          try{
            response=await api(`/api/intelligent-jobs/${encodeURIComponent(jobId)}?t=${Date.now()}`);
            transientErrors=0;
          }catch(error){
            transientErrors+=1;
            if(transientErrors>=5){
              // libera a UI principal; a tarefa continua no servidor
              try{state.carouselLoading=false}catch{}
              throw error;
            }
            setCarouselLoading(true,
              'A conexão oscilou, mas o processamento continua na fila. Reconectando…',
              {progress:5,title:'Processamento continua no Cloudflare'});
            continue;
          }

          const job=response?.job||{};

          if(job.status==='succeeded'&&response?.data?.slides?.length){
            try{localStorage.removeItem(JOB_KEY)}catch{}
            return response.data;
          }

          if(job.status==='failed'||job.stale===true){
            try{localStorage.removeItem(JOB_KEY)}catch{}
            const detail=job.error||job.message||(job.stale?'A tarefa anterior ficou sem atualização.':'O processamento foi interrompido.');
            throw new Error(`${detail} O sistema foi liberado para iniciar uma nova leitura.`);
          }

          const elapsed=Date.now()-startedAt;
          if(elapsed>=70_000){
            setCarouselLoading(true,
              `${job.message||'Processando a matéria.'} O job continua em segundo plano; não é necessário atualizar a página.`,
              {
                progress:Number(job.progress)||1,
                title:job.status==='queued'
                  ? 'Leitura ainda na fila'
                  : 'Leitura inteligente continua em segundo plano'
              }
            );
          }else{
            setCarouselJobProgress(job);
          }
        }

        try{localStorage.removeItem(JOB_KEY)}catch{}
        try{state.carouselLoading=false}catch{}
        throw new Error('A tarefa não recebeu conclusão em 8 minutos. A tela foi liberada para uma nova tentativa; a Ronda principal continua operacional.');
      };
    }
  }catch(error){
    console.error('RONDA ONE: não foi possível aplicar o polling resiliente',error);
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
      editorialReviewRequired:Boolean(copy?.disabled),
      handoffVersion:'ronda-one-0.7.6'
    };

    const old=btn.textContent;
    btn.disabled=true;
    btn.textContent='Preparando…';

    try{
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

  // Recuperação automática da tela principal:
  // - job local com mais de 12 min é descartado;
  // - status preso em "reconectando" não impede /api/latest;
  // - nenhuma recarga manual é necessária.
  setTimeout(()=>recoverCoreUi({force:clearStaleStoredJob()}),1800);
  setInterval(()=>{
    syncDesignButton();
    if(isReconnectUi()||clearStaleStoredJob()) recoverCoreUi({force:true});
  },15000);

  console.info(`RONDA ONE integration ${VERSION} loaded`);
})();
