const base=String(process.env.RONDA_BASE_URL||'').replace(/\/$/,'');
if(!base){console.error('Defina RONDA_BASE_URL=https://seu-worker...');process.exit(2);}
async function get(path,opt={}){const started=Date.now();const r=await fetch(base+path,{redirect:'follow',...opt});let body={};try{body=await r.json();}catch{};if(!r.ok)throw new Error(`${path} HTTP ${r.status}: ${body.error||body.detail||'falha'}`);console.log(`${path} OK ${Date.now()-started}ms`);return body;}
const status=await get('/api/platform/status');if(status.version!=='0.9.7.2.1')throw new Error(`Versão publicada ${status.version||'desconhecida'}; esperado 0.9.7.2.1`);
await get('/api/reliability/status?hours=24');
await get('/api/health');
if(process.env.RONDA_ROUND_TOKEN){const headers={'X-Round-Token':process.env.RONDA_ROUND_TOKEN};const round=await get('/api/round',{method:'POST',headers});console.log('Ronda smoke:',round.status||round.runId||'aceita');}
console.log('Smoke production v0.9.7.2.1: OK');
