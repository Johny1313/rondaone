(()=>{
'use strict';
const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const next=params.get('next')&&params.get('next').startsWith('/')?params.get('next'):'/ronda';
async function api(url,opt={}){const r=await fetch(url,{cache:'no-store',credentials:'same-origin',...opt});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.detail?`${d.error||'Erro'} · ${d.detail}`:(d.error||`HTTP ${r.status}`));return d;}
document.addEventListener('click',e=>{const b=e.target.closest('[data-toggle-password]');if(!b)return;const i=$(b.dataset.togglePassword);if(!i)return;const show=i.type==='password';i.type=show?'text':'password';b.setAttribute('aria-label',show?'Ocultar senha':'Mostrar senha');b.title=show?'Ocultar senha':'Mostrar senha';});
$('adminMode').addEventListener('change',()=>{const on=$('adminMode').checked;$('adminPasswordField').hidden=!on;$('authPassword').required=on;if(!on){$('authPassword').value='';$('authPassword').type='password';}});
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();const adminMode=$('adminMode').checked;$('loginMessage').textContent=adminMode?'Validando acesso administrativo…':'Entrando…';try{await api('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:$('authEmail').value,adminMode,password:adminMode?$('authPassword').value:''})});try{sessionStorage.setItem('ronda.auth.state',JSON.stringify({at:Date.now(),email:$('authEmail').value}));}catch{}
      location.replace(adminMode?'/admin/':next);}catch(err){$('loginMessage').textContent=err.message;}});
(async()=>{try{const me=await api('/api/auth/me');if(me.authenticated)location.replace(next);}catch{}})();
})();