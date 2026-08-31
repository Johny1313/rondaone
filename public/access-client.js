(()=>{
'use strict';
const REV='087-reliability-90';
const path=location.pathname;
const area=path.startsWith('/design')?'design':path.startsWith('/projects')?'projects':path.startsWith('/admin')?'admin':'ronda';
const PING_MS=5*60*1000,IDLE_MS=60*60*1000;
let lastActivity=Date.now(),dirty=true,authenticated=false,timer=null,redirecting=false;
const activity=()=>{lastActivity=Date.now();dirty=true;};
for(const eventName of ['pointerdown','keydown','input','wheel','touchstart'])addEventListener(eventName,activity,{passive:true,capture:true});

function loginUrl(message=''){
  const next=encodeURIComponent(location.pathname+location.search+location.hash);
  const reason=message?`&reason=${encodeURIComponent(message)}`:'';
  return `/?next=${next}${reason}&rev=${REV}&t=${Date.now()}`;
}
async function jsonFetch(url,options={}){
  const headers={'X-Ronda-Access-Rev':REV,...(options.headers||{})};
  const r=await fetch(url,{cache:'no-store',credentials:'same-origin',...options,headers});
  const data=await r.json().catch(()=>({}));
  return {r,data};
}
async function clearSessionAndRedirect(message){
  if(redirecting)return;
  redirecting=true;authenticated=false;
  if(timer){clearInterval(timer);timer=null;}
  try{await fetch('/api/auth/logout',{method:'POST',cache:'no-store',credentials:'same-origin'});}catch{}
  try{sessionStorage.removeItem('ronda.auth.state');}catch{}
  location.replace(loginUrl(message));
}
async function validateSession({redirect=true}={}){
  const result=await jsonFetch(`/api/auth/me?t=${Date.now()}`).catch(()=>null);
  authenticated=Boolean(result?.r?.ok&&result?.data?.authenticated);
  if(!authenticated&&redirect){
    await clearSessionAndRedirect(result?.data?.sessionRecovered
      ?'Sua sessão anterior expirou e foi limpa. Entre novamente.'
      :'Entre no RONDA ONE para usar esta área.');
  }
  return authenticated;
}
async function ping(){
  if(!authenticated||document.hidden)return;
  if(Date.now()-lastActivity>=IDLE_MS){
    await clearSessionAndRedirect('Sessão encerrada após 1 hora sem atividade.');
    return;
  }
  if(!dirty)return;
  const {r}=await jsonFetch('/api/usage/ping',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({area})
  }).catch(()=>({r:null}));
  if(!r?.ok){
    await clearSessionAndRedirect('Sua sessão terminou. O acesso anterior foi limpo; entre novamente.');
    return;
  }
  dirty=false;
}
async function init(){
  if(!(await validateSession()))return;
  await ping();
  if(timer)clearInterval(timer);
  timer=setInterval(ping,PING_MS);
}
addEventListener('visibilitychange',()=>{if(!document.hidden&&authenticated)validateSession().then(ok=>ok&&ping());});
addEventListener('online',()=>{if(authenticated)validateSession().then(ok=>ok&&ping());});
addEventListener('pageshow',event=>{if(event.persisted)validateSession();});
setInterval(()=>{if(authenticated&&Date.now()-lastActivity>=IDLE_MS)ping();},60*1000);
init();
})();
