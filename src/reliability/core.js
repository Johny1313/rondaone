const TERMINAL = new Set(['completed','completed_partial','completed_fallback','failed_input','failed_final']);
const ACTIVE = new Set(['queued','fetching','reading','analyzing','generating','rendering','running']);

function text(value, limit=500){return String(value??'').replace(/\s+/g,' ').trim().slice(0,limit);}
function jsonParse(value,fallback=null){try{return value?JSON.parse(value):fallback;}catch{return fallback;}}
function now(){return new Date().toISOString();}

export const RELIABILITY_STATES = Object.freeze({
  QUEUED:'queued',FETCHING:'fetching',READING:'reading',ANALYZING:'analyzing',GENERATING:'generating',RENDERING:'rendering',RUNNING:'running',
  COMPLETED:'completed',COMPLETED_PARTIAL:'completed_partial',COMPLETED_FALLBACK:'completed_fallback',FAILED_INPUT:'failed_input',FAILED_FINAL:'failed_final',
});

export function classifyReliabilityError(error){
  const code=text(error?.code||'',100).toUpperCase();
  const detail=text(error?.message||error,500);
  const source=`${code} ${detail}`.toLowerCase();
  if(/invalid|inválid|não permitido|unsupported|missing|required|não encontrado|not found/.test(source))return {category:'input',retryable:false,code:code||'INVALID_INPUT'};
  if(/429|rate.?limit|quota|503|502|504|timeout|timed out|network|fetch failed|temporar|queue|fila|lock/.test(source))return {category:'transient',retryable:true,code:code||'TRANSIENT_FAILURE'};
  if(/paywall|blocked|403|401|robots|captcha/.test(source))return {category:'source-blocked',retryable:false,code:code||'SOURCE_BLOCKED'};
  if(/ai|model|inference/.test(source))return {category:'ai',retryable:true,code:code||'AI_FAILURE'};
  return {category:'internal',retryable:false,code:code||'INTERNAL_FAILURE'};
}

export async function ensureReliabilitySchema(db){
  if(!db?.prepare)return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS reliability_actions (
    action_id TEXT PRIMARY KEY,
    action_type TEXT NOT NULL,
    subject_id TEXT,
    status TEXT NOT NULL,
    stage TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    fallback_level INTEGER NOT NULL DEFAULT 0,
    recovered INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_detail TEXT,
    metadata_json TEXT,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    duration_ms INTEGER NOT NULL DEFAULT 0
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_reliability_actions_type_time ON reliability_actions(action_type, started_at DESC)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_reliability_actions_status_time ON reliability_actions(status, updated_at DESC)').run();
}

export async function startReliabilityAction(db,{actionId=crypto.randomUUID(),actionType='generic',subjectId=null,status='queued',stage=null,metadata=null}={}){
  await ensureReliabilitySchema(db);
  const at=now();
  await db.prepare(`INSERT INTO reliability_actions(action_id,action_type,subject_id,status,stage,attempts,fallback_level,recovered,error_code,error_detail,metadata_json,started_at,updated_at,completed_at,duration_ms)
    VALUES(?,?,?,?,?,0,0,0,NULL,NULL,?,?,?,NULL,0)
    ON CONFLICT(action_id) DO UPDATE SET action_type=excluded.action_type,subject_id=COALESCE(excluded.subject_id,reliability_actions.subject_id),updated_at=excluded.updated_at`)
    .bind(actionId,text(actionType,80),subjectId?text(subjectId,180):null,text(status,40),stage?text(stage,80):null,metadata?JSON.stringify(metadata).slice(0,12000):null,at,at).run();
  return actionId;
}

export async function advanceReliabilityAction(db,actionId,{status='running',stage=null,attemptIncrement=0,fallbackLevel=null,recovered=null,metadata=null,error=null}={}){
  if(!actionId||!db?.prepare)return;
  await ensureReliabilitySchema(db);
  const classified=error?classifyReliabilityError(error):null;
  const detail=error?text(error?.message||error,700):null;
  await db.prepare(`UPDATE reliability_actions SET status=?,stage=COALESCE(?,stage),attempts=attempts+?,fallback_level=COALESCE(?,fallback_level),recovered=COALESCE(?,recovered),error_code=?,error_detail=?,metadata_json=COALESCE(?,metadata_json),updated_at=? WHERE action_id=?`)
    .bind(text(status,40),stage?text(stage,80):null,Number(attemptIncrement)||0,fallbackLevel==null?null:Number(fallbackLevel),recovered==null?null:(recovered?1:0),classified?.code||null,detail,metadata?JSON.stringify(metadata).slice(0,12000):null,now(),actionId).run();
}

export async function finishReliabilityAction(db,actionId,{status='completed',stage='completed',fallbackLevel=null,recovered=null,error=null,metadata=null}={}){
  if(!actionId||!db?.prepare)return;
  await ensureReliabilitySchema(db);
  const at=now();
  const row=await db.prepare('SELECT started_at FROM reliability_actions WHERE action_id=? LIMIT 1').bind(actionId).first();
  const started=Date.parse(row?.started_at||at);const duration=Math.max(0,Date.now()-(Number.isFinite(started)?started:Date.now()));
  const classified=error?classifyReliabilityError(error):null;
  await db.prepare(`UPDATE reliability_actions SET status=?,stage=?,fallback_level=COALESCE(?,fallback_level),recovered=COALESCE(?,recovered),error_code=?,error_detail=?,metadata_json=COALESCE(?,metadata_json),updated_at=?,completed_at=?,duration_ms=? WHERE action_id=?`)
    .bind(text(status,40),text(stage,80),fallbackLevel==null?null:Number(fallbackLevel),recovered==null?null:(recovered?1:0),classified?.code||null,error?text(error?.message||error,700):null,metadata?JSON.stringify(metadata).slice(0,12000):null,at,at,duration,actionId).run();
}

export async function getReliabilitySummary(db,{hours=24}={}){
  await ensureReliabilitySchema(db);
  const cutoff=new Date(Date.now()-Math.max(1,Number(hours)||24)*3600000).toISOString();
  const result=await db.prepare(`SELECT action_type,status,COUNT(*) AS total,AVG(duration_ms) AS avg_ms,SUM(recovered) AS recovered,AVG(fallback_level) AS avg_fallback FROM reliability_actions WHERE started_at>=? GROUP BY action_type,status`).bind(cutoff).all();
  const rows=result?.results||[];const byType={};
  for(const row of rows){const type=row.action_type||'generic';const item=byType[type]||(byType[type]={type,total:0,useful:0,failed:0,recovered:0,avgMs:0,_duration:0,_samples:0,statuses:{}});const count=Number(row.total)||0;item.total+=count;item.statuses[row.status]=count;item.recovered+=Number(row.recovered)||0;item._duration+=(Number(row.avg_ms)||0)*count;item._samples+=count;if(['completed','completed_partial','completed_fallback'].includes(row.status))item.useful+=count;if(['failed_input','failed_final'].includes(row.status))item.failed+=count;}
  for(const item of Object.values(byType)){item.avgMs=item._samples?Math.round(item._duration/item._samples):0;item.successPercent=item.total?Number((item.useful/item.total*100).toFixed(2)):null;delete item._duration;delete item._samples;}
  const all=Object.values(byType);const total=all.reduce((s,x)=>s+x.total,0),useful=all.reduce((s,x)=>s+x.useful,0),failed=all.reduce((s,x)=>s+x.failed,0);
  const recent=(await db.prepare(`SELECT action_id,action_type,subject_id,status,stage,attempts,fallback_level,recovered,error_code,error_detail,started_at,updated_at,completed_at,duration_ms FROM reliability_actions WHERE started_at>=? ORDER BY updated_at DESC LIMIT 30`).bind(cutoff).all())?.results||[];
  return {hours:Number(hours)||24,total,useful,failed,successPercent:total?Number((useful/total*100).toFixed(2)):null,byType,active:recent.filter(x=>ACTIVE.has(x.status)).length,recent};
}

export async function cleanupReliabilityActions(db,{days=30,maxRows=5000}={}){
  await ensureReliabilitySchema(db);const cutoff=new Date(Date.now()-Math.max(1,days)*86400000).toISOString();
  await db.prepare('DELETE FROM reliability_actions WHERE completed_at IS NOT NULL AND completed_at < ?').bind(cutoff).run().catch(()=>null);
  await db.prepare(`DELETE FROM reliability_actions WHERE action_id NOT IN (SELECT action_id FROM reliability_actions ORDER BY updated_at DESC LIMIT ${Math.max(200,Number(maxRows)||5000)})`).run().catch(()=>null);
}

export async function withReliabilityRetry(operation,{attempts=3,delaysMs=[250,900,2200],onAttempt=null,shouldRetry=null}={}){
  let lastError;
  for(let attempt=1;attempt<=Math.max(1,attempts);attempt+=1){
    try{if(onAttempt)await onAttempt(attempt);return await operation(attempt);}catch(error){lastError=error;const classification=classifyReliabilityError(error);const retry=attempt<attempts&&(typeof shouldRetry==='function'?shouldRetry(error,classification):classification.retryable);if(!retry)throw error;const delay=delaysMs[Math.min(attempt-1,delaysMs.length-1)]||0;if(delay)await new Promise(resolve=>setTimeout(resolve,delay));}
  }
  throw lastError;
}

export function reliabilityResultStatus({partial=false,fallback=false}={}){return fallback?'completed_fallback':partial?'completed_partial':'completed';}
export function isReliabilityTerminal(status){return TERMINAL.has(String(status||''));}
