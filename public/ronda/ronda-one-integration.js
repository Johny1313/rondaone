(()=>{
  'use strict';

  const VERSION='0.7.7';
  const BUILD='hf1-ui-freeze-fix';
  const JOB_KEY='rondaOne.intelligentJob';
  const MAX_LOCAL_JOB_AGE_MS=12*60*1000;
  const RECOVERY_COOLDOWN_MS=10*1000;
  const btn=document.getElementById('openRondaDesign');
  const copy=document.getElementById('copyCarousel');
  const slidesHost=document.getElementById('carouselSlides');
  const statusLabelEl=document.getElementById('statusLabel');
  const statusSubEl=document.getElementById('statusSub');
  const runBtn=document.getElementById('runRound');

  const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
  let recoveryPromise=null;
  let lastRecoveryAt=0;
  let designSyncQueued=false;

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
    return /reconect|retomada automática|conexão oscil|serviço indisponível|sem resposta/i.test(`${label} ${sub}`);
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
    if(recoveryPromise)return recoveryPromise;
    if(!force && Date.now()-lastRecoveryAt<RECOVERY_COOLDOWN_MS)return false;

    recoveryPromise=(async()=>{
      lastRecoveryAt=Date.now();

      try{
        if(stale && typeof state!=='undefined')state.carouselLoading=false;
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

        if(isReconnectUi() && typeof setStatus==='function'){
          const last=(()=>{
            try{
              return state?.data?.collectedAt||state?.data?.storedAt||state?.health?.lastSuccessAt||null;
            }catch{return null;}
          })();
          setStatus(last?'ok':'warn','Serviço online',last?'Última ronda carregada':'Aguardando próxima ronda');
        }

        if(runBtn){
          const shouldDisable=Boolean(typeof state!=='undefined' && state.running);
          if(runBtn.disabled!==shouldDisable)runBtn.disabled=shouldDisable;
        }
        scheduleDesignSync();
        return true;
      }catch(error){
        console.warn('RONDA ONE UI recovery',error);
        return false;
      }
    })();

    try{
      return await recoveryPromise;
    }finally{
      recoveryPromise=null;
    }
  }

  function carouselReady(){
    try{
      return Boolean(typeof state!=='undefined' && state?.activeCarousel?.slides?.length);
    }catch{
      return false;
    }
  }

  function syncDesignButtonNow(){
    if(!btn)return;
    const ready=carouselReady();
    const shouldDisable=!ready;

    // Importante: não grava novamente o mesmo atributo.
    // Isso impede ciclos de MutationObserver e reduz trabalho na thread principal.
    if(btn.disabled!==shouldDisable)btn.disabled=shouldDisable;

    const reviewRequired=Boolean(copy?.disabled);
    const nextTitle=ready
      ? (reviewRequired
        ? 'Abrir no Ronda Design para editar. A publicação ainda depende da revisão editorial.'
        : 'Abrir este carrossel no Ronda Design.')
      : 'Gere o roteiro para abrir no Ronda Design.';

    if(btn.title!==nextTitle)btn.title=nextTitle;
  }

  function scheduleDesignSync(){
    if(designSyncQueued)return;
    designSyncQueued=true;
    requestAnimationFrame(()=>{
      designSyncQueued=false;
      syncDesignButtonNow();
    });
  }

  if(btn){
    scheduleDesignSync();

    // Observa apenas a região que recebe os slides.
    // Não observa mais o modal inteiro nem o próprio botão RONDA DESIGN.
    if(slidesHost){
      new MutationObserver(scheduleDesignSync).observe(slidesHost,{
        subtree:true,
        childList:true
      });
    }

    // O estado editorial pode habilitar/desabilitar "Copiar roteiro".
    // Isso atualiza apenas o tooltip do Design e não cria ciclo.
    if(copy){
      new MutationObserver(scheduleDesignSync).observe(copy,{
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
        let lastUiUpdateAt=0;

        const updateUi=(callback,minGap=1200)=>{
          const now=Date.now();
          if(now-lastUiUpdateAt<minGap)return;
          lastUiUpdateAt=now;
          try{callback()}catch{}
        };

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
              clearStoredJob(jobId);
              try{state.carouselLoading=false}catch{}
              throw new Error('A conexão com a tarefa foi interrompida. A interface foi liberada; tente novamente sem atualizar a página.');
            }

            if(typeof setCarouselLoading==='function'){
              updateUi(()=>setCarouselLoading(
                true,
                'A conexão oscilou, mas o processamento continua na fila. Reconectando…',
                {progress:5,title:'Processamento continua no Cloudflare'}
              ),2500);
            }
            continue;
          }

          const job=response?.job||{};

          if(job.status==='succeeded'&&response?.data?.slides?.length){
            clearStoredJob(jobId);
            scheduleDesignSync();
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
              updateUi(()=>setCarouselLoading(
                true,
                `${job.message||'Processando a matéria.'} O job continua em segundo plano; não é necessário atualizar a página.`,
                {
                  progress:Number(job.progress)||1,
                  title:job.status==='queued'
                    ? 'Leitura ainda na fila'
                    : 'Leitura inteligente continua em segundo plano'
                }
              ));
            }
          }else if(typeof setCarouselJobProgress==='function'){
            updateUi(()=>setCarouselJobProgress(job));
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

  async function openRondaDesign(){
    if(!btn)return;

    const topic=(state.data?.topics||[]).find(x=>x.id===state.activeTopicId);
    const carousel=state.activeCarousel;

    if(!topic||!carousel?.slides?.length){
      const message=document.getElementById('copyCarouselMessage');
      if(message)message.textContent='Gere o roteiro antes de abrir no Ronda Design.';
      scheduleDesignSync();
      return;
    }

    const payload={
      sourceVersion:'ronda-editorial-2.8.5',
      runId:state.data?.runId||state.lastRunId||'',
      topic,
      carousel,
      editorialReviewRequired:Boolean(copy?.disabled),
      handoffVersion:'ronda-one-0.7.7-hf1'
    };

    const old=btn.textContent;
    if(!btn.disabled)btn.disabled=true;
    btn.textContent='Preparando…';

    try{
      const res=await fetch('/api/projects/from-ronda',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      });

      const out=await res.json().catch(()=>({}));

      if(!res.ok||!out.ok){
        throw new Error(out.error||'Projeto compartilhado indisponível');
      }

      location.href='/design/?project='+encodeURIComponent(out.id);
    }catch(err){
      try{
        localStorage.setItem('rondaOne.handoff',JSON.stringify(payload));
        location.href='/design/?handoff=local';
        return;
      }catch{}

      btn.textContent=old;
      scheduleDesignSync();

      const message=document.getElementById('copyCarouselMessage');
      if(message)message.textContent=err?.message||'Não foi possível abrir o Ronda Design.';
    }
  }

  if(btn)btn.addEventListener('click',openRondaDesign);

  // Recuperação controlada: nunca inicia duas recuperações em paralelo.
  window.addEventListener('online',()=>recoverCoreUi({force:true}));

  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)return;

    scheduleDesignSync();
    const stale=clearStaleStoredJob();

    if(stale||isReconnectUi()){
      recoverCoreUi({force:true});
    }
  });

  setTimeout(()=>{
    scheduleDesignSync();
    const stale=clearStaleStoredJob();

    if(stale||isReconnectUi()){
      recoverCoreUi({force:true});
    }
  },1800);

  // Antes era 15 s. Agora é 30 s e não executa recovery sem necessidade.
  setInterval(()=>{
    scheduleDesignSync();
    const stale=clearStaleStoredJob();

    if(stale||isReconnectUi()){
      recoverCoreUi();
    }
  },30000);

  console.info(`RONDA ONE integration ${VERSION} ${BUILD} loaded`);
})();
