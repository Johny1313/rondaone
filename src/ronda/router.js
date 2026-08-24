import rondaWorker from './legacy-bundle.js';

const MODULE_BAR = `<div id="rondaOneBar" style="position:sticky;top:0;z-index:99999;height:42px;background:#111;color:#fff;display:flex;align-items:center;gap:8px;padding:0 14px;font-family:Inter,Arial,sans-serif;border-bottom:1px solid #333"><strong style="font-size:11px;letter-spacing:.06em">RONDA ONE <span style="opacity:.55">0.7</span></strong><a href="/ronda" style="color:#fff;text-decoration:none;background:#2a2a2a;padding:6px 10px;border-radius:7px;font-size:10px;font-weight:800">RONDA</a><a href="/design/" style="color:#bbb;text-decoration:none;padding:6px 10px;border-radius:7px;font-size:10px;font-weight:800">DESIGN</a><a href="/projects/" style="color:#bbb;text-decoration:none;padding:6px 10px;border-radius:7px;font-size:10px;font-weight:800">PROJETOS</a><span style="margin-left:auto;font-size:9px;color:#aaa">Editorial + Design + IA</span></div>`;

const INTEGRATION_JS = `\n;(()=>{\n  const btn=document.getElementById('openRondaDesign');\n  if(!btn)return;\n  async function openRondaDesign(){\n    const topic=(state.data?.topics||[]).find(x=>x.id===state.activeTopicId);\n    const carousel=state.smartCarousels.get(carouselCacheKey(state.activeTopicId));\n    if(!topic||!carousel){document.getElementById('copyCarouselMessage').textContent='Gere o roteiro antes de abrir no Ronda Design.';return;}\n    const payload={sourceVersion:'ronda-integrated-module',runId:state.data?.runId||state.lastRunId||'',topic,carousel};\n    const old=btn.textContent;btn.disabled=true;btn.textContent='Preparando…';\n    try{\n      const res=await fetch('/api/projects/from-ronda',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});\n      const out=await res.json().catch(()=>({}));\n      if(!res.ok||!out.ok)throw new Error(out.error||'Projeto compartilhado indisponível');\n      window.location.href='/design/?project='+encodeURIComponent(out.id);\n    }catch(err){\n      try{localStorage.setItem('rondaOne.handoff',JSON.stringify(payload));window.location.href='/design/?handoff=local';return;}catch{}\n      btn.disabled=false;btn.textContent=old;document.getElementById('copyCarouselMessage').textContent=err.message||'Não foi possível abrir o Ronda Design.';\n    }\n  }\n  btn.addEventListener('click',openRondaDesign);\n})();\n`;

function rewriteRondaText(text, contentType){
  let out=text;
  if(contentType.includes('text/html')){
    out=out.replace('<body>', '<body>'+MODULE_BAR);
    out=out.replace('<button class="primary" id="copyCarousel" type="button" disabled>Copiar roteiro</button>', '<button class="primary" id="copyCarousel" type="button" disabled>Copiar roteiro</button><button class="primary" id="openRondaDesign" type="button" disabled style="background:#6b5cff;border-color:#6b5cff">RONDA DESIGN</button>');
    out=out.replace(/href="\/styles\.css/g,'href="/ronda/styles.css').replace(/src="\/app\.js/g,'src="/ronda/app.js');
  }
  if(contentType.includes('javascript')){
    out=out.replaceAll('"/api/','"/ronda/api/').replaceAll("'/api/","'/ronda/api/").replaceAll('`/api/','`/ronda/api/');
    out=out.replace('document.getElementById("copyCarousel").disabled = loading || Boolean(message);','document.getElementById("copyCarousel").disabled = loading || Boolean(message); const roBtn=document.getElementById("openRondaDesign"); if(roBtn) roBtn.disabled=loading || Boolean(message);');
    out=out.replace('document.getElementById("copyCarousel").disabled = false;','document.getElementById("copyCarousel").disabled = false; const roBtn=document.getElementById("openRondaDesign"); if(roBtn) roBtn.disabled=false;');
    out += INTEGRATION_JS;
  }
  return out;
}

export async function handleRonda(request, env, ctx){
  const original=new URL(request.url);
  const stripped=original.pathname.replace(/^\/ronda(?=\/|$)/,'') || '/';
  const target=new URL(request.url); target.pathname=stripped;
  const forwarded=new Request(target.toString(),request);
  const response=await rondaWorker.fetch(forwarded,env,ctx);
  const ct=response.headers.get('content-type')||'';
  if(!/text\/html|javascript|text\/css/.test(ct)) return response;
  const body=rewriteRondaText(await response.text(),ct);
  const headers=new Headers(response.headers); headers.set('content-length',String(new TextEncoder().encode(body).length));
  return new Response(body,{status:response.status,headers});
}

export async function runRondaSchedule(controller,env,ctx){
  if(typeof rondaWorker.scheduled==='function') return rondaWorker.scheduled(controller,env,ctx);
}
