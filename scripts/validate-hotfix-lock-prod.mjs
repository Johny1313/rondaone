const base=String(process.env.BASE_URL||process.argv[2]||'').replace(/\/$/,'');
if(!/^https?:\/\//i.test(base)){console.error('Uso: BASE_URL=https://seu-worker.example npm run validate:prod');process.exit(2);}
const endpoints=['/api/platform/status','/api/health','/api/status','/api/latest','/api/sources/diagnostics'];
async function get(path){const r=await fetch(base+path,{headers:{accept:'application/json'}});let j=null;try{j=await r.json();}catch{}return {path,status:r.status,json:j};}
let failed=false;
for(let cycle=1;cycle<=3;cycle++){
  console.log(`\nCICLO ${cycle}/3`);
  const results=await Promise.all(endpoints.map(get));
  for(const result of results){const ok=result.status===200&&result.json;console.log(`${ok?'✓':'✕'} ${result.path} HTTP ${result.status}`);if(!ok)failed=true;}
  const p=results.find(x=>x.path==='/api/platform/status')?.json||{};
  console.log(`  D1=${p.database} scheduler=${p.schedulerHealthy} ROUND=${p.queues?.ROUND} INTELLIGENT=${p.queues?.INTELLIGENT} coverage=${p.sources?.coveragePercent ?? '?'}% stuck=${(p.jobs?.stuckIntelligent||0)+(p.jobs?.stuckProduction||0)}`);
  if(p.database!=='connected'||p.queues?.ROUND!=='available'||p.queues?.INTELLIGENT!=='available'||p.schedulerHealthy!==true||(p.jobs?.stuckIntelligent||0)>0||(p.jobs?.stuckProduction||0)>0)failed=true;
  if(cycle<3)await new Promise(r=>setTimeout(r,Number(process.env.VALIDATION_DELAY_MS)||2000));
}
if(failed){console.error('\nHOTFIX LOCK: validação de produção encontrou pendências.');process.exit(1);}console.log('\nHOTFIX LOCK: 3 ciclos de produção OK.');
