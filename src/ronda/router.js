import rondaWorker from './v285/index.js';

const MODULE_BAR = `<div id="rondaOneBar"><strong>RONDA ONE <span>0.7.2</span></strong><a class="active" href="/ronda">RONDA</a><a href="/design/">DESIGN</a><a href="/projects/">PROJETOS</a><em>Ronda Editorial 2.8.5 · Design + IA</em></div>`;

const INTEGRATION_JS = `\n;(()=>{\n  const btn=document.getElementById('openRondaDesign');\n  const copy=document.getElementById('copyCarousel');\n  if(!btn||!copy)return;\n  const sync=()=>{btn.disabled=copy.disabled;};\n  sync();\n  new MutationObserver(sync).observe(copy,{attributes:true,attributeFilter:['disabled']});\n  async function openRondaDesign(){\n    const topic=(state.data?.topics||[]).find(x=>x.id===state.activeTopicId);\n    const carousel=state.activeCarousel;\n    if(!topic||!carousel?.slides?.length){document.getElementById('copyCarouselMessage').textContent='Gere e libere o roteiro antes de abrir no Ronda Design.';return;}\n    const payload={sourceVersion:'ronda-editorial-2.8.5',runId:state.data?.runId||state.lastRunId||'',topic,carousel};\n    const old=btn.textContent;btn.disabled=true;btn.textContent='Preparando…';\n    try{\n      const res=await fetch('/api/projects/from-ronda',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});\n      const out=await res.json().catch(()=>({}));\n      if(!res.ok||!out.ok)throw new Error(out.error||'Projeto compartilhado indisponível');\n      location.href='/design/?project='+encodeURIComponent(out.id);\n    }catch(err){\n      try{localStorage.setItem('rondaOne.handoff',JSON.stringify(payload));location.href='/design/?handoff=local';return;}catch{}\n      btn.disabled=false;btn.textContent=old;document.getElementById('copyCarouselMessage').textContent=err.message||'Não foi possível abrir o Ronda Design.';\n    }\n  }\n  btn.addEventListener('click',openRondaDesign);\n})();\n`;

function modifiedHeaders(response, contentType){
  const headers=new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', contentType.includes('text/html') ? 'no-store' : 'public, max-age=0, must-revalidate');
  return headers;
}

function rewriteHtml(text){
  let out=text.replace('<body>', '<body>'+MODULE_BAR);
  out=out.replace('<button class="primary" id="copyCarousel" type="button" disabled>Copiar roteiro</button>', '<button class="primary" id="copyCarousel" type="button" disabled>Copiar roteiro</button><button class="primary ronda-one-design-btn" id="openRondaDesign" type="button" disabled>RONDA DESIGN</button>');
  out=out.replace(/href="\\\/styles\\.css/g,'href="/ronda/styles.css').replace(/src="\\\/app\\.js/g,'src="/ronda/app.js');
  out=out.replace(/href="\/styles\.css/g,'href="/ronda/styles.css').replace(/src="\/app\.js/g,'src="/ronda/app.js');
  return out;
}

const BAR_CSS=`\n#rondaOneBar{position:sticky;top:0;z-index:99999;height:42px;box-sizing:border-box;background:#111;color:#fff;display:flex;align-items:center;gap:7px;padding:0 14px;font-family:Inter,Arial,sans-serif;border-bottom:1px solid #2b2b2b}#rondaOneBar strong{font-size:11px;letter-spacing:.06em;white-space:nowrap}#rondaOneBar strong span{opacity:.55}#rondaOneBar a{color:#bbb;text-decoration:none;padding:6px 10px;border-radius:7px;font-size:10px;font-weight:800;letter-spacing:.01em}#rondaOneBar a:hover,#rondaOneBar a.active{color:#fff;background:#2a2a2a}#rondaOneBar em{margin-left:auto;font-size:9px;color:#aaa;font-style:normal;white-space:nowrap}.ronda-one-design-btn{background:#6b5cff!important;border-color:#6b5cff!important}.ronda-one-design-btn:disabled{opacity:.45!important}@media(max-width:720px){#rondaOneBar{overflow-x:auto;padding:0 8px}#rondaOneBar em{display:none}#rondaOneBar a{padding:6px 8px}}\n`;

async function asset(env,request,path){
  const url=new URL(request.url);url.pathname=path;
  return env.ASSETS.fetch(new Request(url.toString(),{method:'GET',headers:request.headers}));
}

export async function handleRonda(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname==='/ronda'||url.pathname==='/ronda/'){
    const response=await asset(env,request,'/ronda/index.html');
    const text=rewriteHtml(await response.text());
    return new Response(text,{status:response.status,headers:modifiedHeaders(response,'text/html')});
  }
  if(url.pathname==='/ronda/app.js'){
    const response=await asset(env,request,'/ronda/app.js');
    let text=await response.text();
    text=text.replaceAll('"/api/','"/ronda/api/').replaceAll("'/api/","'/ronda/api/").replaceAll('`/api/','`/ronda/api/');
    text+=INTEGRATION_JS;
    return new Response(text,{status:response.status,headers:modifiedHeaders(response,'javascript')});
  }
  if(url.pathname==='/ronda/styles.css'){
    const response=await asset(env,request,'/ronda/styles.css');
    return new Response((await response.text())+BAR_CSS,{status:response.status,headers:modifiedHeaders(response,'text/css')});
  }
  if(url.pathname.startsWith('/ronda/api/')){
    const target=new URL(request.url);target.pathname=url.pathname.replace(/^\/ronda/,'');
    return rondaWorker.fetch(new Request(target.toString(),request),env,ctx);
  }
  if(url.pathname.startsWith('/ronda/')) return asset(env,request,url.pathname);
  return new Response('Not found',{status:404});
}

export async function runRondaQueue(batch,env){
  if(typeof rondaWorker.queue==='function') return rondaWorker.queue(batch,env);
}

export async function runRondaSchedule(controller,env,ctx){
  if(typeof rondaWorker.scheduled==='function') return rondaWorker.scheduled(controller,env,ctx);
}
