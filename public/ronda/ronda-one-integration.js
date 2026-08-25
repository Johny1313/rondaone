(()=>{
  'use strict';
  const btn=document.getElementById('openRondaDesign');
  const copy=document.getElementById('copyCarousel');
  if(!btn||!copy)return;

  const sync=()=>{ btn.disabled=copy.disabled; };
  sync();
  new MutationObserver(sync).observe(copy,{attributes:true,attributeFilter:['disabled']});

  async function openRondaDesign(){
    const topic=(state.data?.topics||[]).find(x=>x.id===state.activeTopicId);
    const carousel=state.activeCarousel;
    if(!topic||!carousel?.slides?.length){
      const message=document.getElementById('copyCarouselMessage');
      if(message)message.textContent='Gere e libere o roteiro antes de abrir no Ronda Design.';
      return;
    }

    const payload={
      sourceVersion:'ronda-editorial-2.8.5',
      runId:state.data?.runId||state.lastRunId||'',
      topic,
      carousel
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
      btn.disabled=false;
      btn.textContent=old;
      const message=document.getElementById('copyCarouselMessage');
      if(message)message.textContent=err?.message||'Não foi possível abrir o Ronda Design.';
    }
  }

  btn.addEventListener('click',openRondaDesign);
})();
