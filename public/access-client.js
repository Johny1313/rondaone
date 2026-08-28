(()=>{
  'use strict';
  const path=location.pathname;
  const area=path.startsWith('/design')?'design':path.startsWith('/projects')?'projects':path.startsWith('/admin')?'admin':'ronda';
  const PING_MS=5*60*1000, IDLE_MS=60*60*1000;
  let lastActivity=Date.now(), dirty=true, authenticated=false, timer=null;
  const activity=()=>{lastActivity=Date.now();dirty=true;};
  for(const eventName of ['pointerdown','keydown','input','wheel','touchstart']) addEventListener(eventName,activity,{passive:true,capture:true});

  function loginUrl(message=''){ const next=encodeURIComponent(location.pathname+location.search+location.hash); const reason=message?`&reason=${encodeURIComponent(message)}`:''; return `/?next=${next}${reason}`; }
  function overlay(message='Entre no RONDA ONE para continuar.'){ location.replace(loginUrl(message)); }

  async function jsonFetch(url,options){const r=await fetch(url,{cache:'no-store',credentials:'same-origin',...options});const data=await r.json().catch(()=>({}));return {r,data};}
  async function ping(){
    if(!authenticated||document.hidden)return;
    if(Date.now()-lastActivity>=IDLE_MS){ await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'}).catch(()=>null);authenticated=false;overlay('Sessão encerrada após 1 hora sem atividade.');return; }
    if(!dirty)return;
    const {r}=await jsonFetch('/api/usage/ping',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({area})}).catch(()=>({r:null}));
    if(!r?.ok){authenticated=false;overlay('Sua sessão terminou. Entre novamente para liberar um novo acesso.');return;}
    dirty=false;
  }
  async function init(){
    const result=await jsonFetch('/api/auth/me').catch(()=>null);
    authenticated=Boolean(result?.r?.ok&&result?.data?.authenticated);
    if(!authenticated){overlay('Entre no RONDA ONE para usar esta área.');return;}
    await ping(); timer=setInterval(ping,PING_MS);
    setInterval(()=>{if(authenticated&&Date.now()-lastActivity>=IDLE_MS)ping();},60*1000);
  }
  addEventListener('visibilitychange',()=>{if(!document.hidden&&authenticated)ping();});
  init();
})();
