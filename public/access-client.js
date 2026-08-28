(()=>{
  'use strict';
  const path=location.pathname;
  const area=path.startsWith('/design')?'design':path.startsWith('/projects')?'projects':path.startsWith('/admin')?'admin':'ronda';
  const PING_MS=5*60*1000, IDLE_MS=60*60*1000;
  let lastActivity=Date.now(), dirty=true, authenticated=false, timer=null;
  const activity=()=>{lastActivity=Date.now();dirty=true;};
  for(const eventName of ['pointerdown','keydown','input','wheel','touchstart']) addEventListener(eventName,activity,{passive:true,capture:true});

  function overlay(message='Entre no RONDA ONE para continuar.'){
    if(area==='ronda'){ window.dispatchEvent(new CustomEvent('ronda:session-expired',{detail:{message}})); return; }
    let node=document.getElementById('rondaAccessGate');
    if(!node){ node=document.createElement('div'); node.id='rondaAccessGate'; node.innerHTML=`<div class="ronda-access-card"><strong>RONDA ONE</strong><h2>Acesso necessário</h2><p></p><a href="/ronda?login=1">Ir para o login</a></div>`; document.body.appendChild(node); }
    node.querySelector('p').textContent=message;
    if(!document.getElementById('rondaAccessGateStyle')){const style=document.createElement('style');style.id='rondaAccessGateStyle';style.textContent='#rondaAccessGate{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:rgba(18,18,18,.88);font-family:Inter,Arial,sans-serif}.ronda-access-card{width:min(420px,calc(100vw - 32px));background:#fff;border-radius:18px;padding:28px;box-shadow:0 30px 80px rgba(0,0,0,.35)}.ronda-access-card strong{font-size:11px;letter-spacing:.1em}.ronda-access-card h2{margin:8px 0 6px}.ronda-access-card p{color:#6a6862;font-size:13px;line-height:1.5}.ronda-access-card a{display:inline-block;margin-top:12px;background:#171717;color:#fff;text-decoration:none;padding:10px 14px;border-radius:9px;font-size:12px;font-weight:800}';document.head.appendChild(style);}
  }

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
