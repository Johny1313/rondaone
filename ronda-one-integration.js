(()=>{
  'use strict';

  const btn=document.getElementById('openRondaDesign');
  const copy=document.getElementById('copyCarousel');
  const modal=document.getElementById('carouselModal');
  if(!btn)return;

  const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));

  function carouselReady(){
    try{
      return Boolean(state?.activeCarousel?.slides?.length);
    }catch{
      return false;
    }
  }

  function syncDesignButton(){
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

  // Stability First:
  // A Queue pode continuar processando depois de 75 s. O frontend anterior
  // encerrava a espera artificialmente e exibia "Roteiro não concluído",
  // mesmo com o job ainda vivo no Cloudflare. Substituímos apenas a espera
  // do navegador; o job continua sendo controlado pelo backend/D1/Queue.
  try{
    if(typeof waitForIntelligentJob==='function'){
      waitForIntelligentJob=async function(jobId,requestSerial,pollAfterMs=900){
        const startedAt=Date.now();
        const hardDeadline=startedAt+(8*60*1000);
        let transientErrors=0;

        try{
          localStorage.setItem('rondaOne.intelligentJob',JSON.stringify({
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
            if(transientErrors>=5)throw error;
            setCarouselLoading(true,
              'A conexão oscilou, mas o processamento continua na fila. Reconectando…',
              {progress:Math.min(95,Math.max(5,Number(state?.carouselLoading?.progress)||5)),
               title:'Processamento continua no Cloudflare'});
            continue;
          }

          const job=response?.job||{};

          if(job.status==='succeeded'&&response?.data?.slides?.length){
            try{localStorage.removeItem('rondaOne.intelligentJob')}catch{}
            return response.data;
          }

          if(job.status==='failed'){
            try{localStorage.removeItem('rondaOne.intelligentJob')}catch{}
            const detail=job.error||job.message||'O processamento foi interrompido.';
            throw new Error(/ciclo (?:foi )?encerrado/i.test(detail)
              ? detail
              : `${detail} O ciclo foi encerrado e o sistema está liberado para tentar uma nova leitura.`);
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

        throw new Error('A tarefa permaneceu ativa por mais de 8 minutos. O job foi preservado no Cloudflare; feche e reabra este assunto para consultar o resultado ou tentar uma nova geração.');
      };
    }
  }catch(error){
    console.error('RONDA ONE: não foi possível aplicar o polling resiliente',error);
  }

  async function openRondaDesign(){
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
      handoffVersion:'ronda-one-0.7.5'
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

  btn.addEventListener('click',openRondaDesign);

  // Mantém o botão sincronizado mesmo quando o estado muda sem alterar
  // diretamente o atributo disabled do botão Copiar roteiro.
  setInterval(syncDesignButton,1200);
})();
