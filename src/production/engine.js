import {
  ARTICLE_ANALYSIS_MODEL,
  ARTICLE_SECONDARY_MODEL,
  ARTICLE_TERTIARY_MODEL,
  buildIntelligentCarousel,
  buildCarouselFromEvidencePack,
  validateArticleUrl,
} from "../ronda/v285/article-reader.js";
import { stableHash, plainText } from "../ronda/v285/parser.js";
import { isLikelyPortuguese, translateText } from "../ronda/v285/translation.js";
import { buildEvidencePack, normalizeArticleIdentity, scrapeArticle, scrapeTopicToEvidence } from "./scraping-engine.js";
import { browserQuickActionArticle, browserQuickActionAvailable, CAROUSEL_PIPELINE_VERSION, EVIDENCE_VERSION, ENGINE_BASELINE_VERSION, READER_VERSION } from "./hybrid-browser-reader.js";

const PRODUCTION_SCHEMA_VERSION = "0.9.7.5.6";
const PRODUCTION_READ_STALE_MS = 15_000;
const PRODUCTION_GENERATE_STALE_MS = 10_000;
const PRODUCTION_HARD_DEADLINE_MS = 45_000;
const PRODUCTION_ABSOLUTE_DEADLINE_MS = 55_000;
const PRODUCTION_INTERACTIVE_DEADLINE_MS = 10_000;
const JOB_TTL_HOURS = 48;
const EVIDENCE_TTL_DAYS = 7;
const MAX_RESULT_JSON = 900_000;
const MAX_EVIDENCE_JSON = 1_100_000;
const PRODUCTION_SCHEMA_READY = new WeakMap();

function nowIso(){ return new Date().toISOString(); }
function clamp(value,min,max){ return Math.max(min,Math.min(max,Number(value)||0)); }
function safeJson(value,fallback=null){ try{return JSON.stringify(value);}catch{return JSON.stringify(fallback);} }
function parseJson(value,fallback=null){ try{return JSON.parse(String(value||""));}catch{return fallback;} }
function clipJson(value,limit,label){const text=safeJson(value,{});if(text.length>limit)throw new Error(`${label} excedeu o limite seguro de armazenamento.`);return text;}

export const PRODUCTION_VERSIONS=Object.freeze({
  engineBaseline:ENGINE_BASELINE_VERSION,
  readerVersion:READER_VERSION,
  evidenceVersion:EVIDENCE_VERSION,
  carouselPipelineVersion:CAROUSEL_PIPELINE_VERSION,
});

export function stampProductionInput(input={}){
  return {
    ...(input&&typeof input==="object"?input:{}),
    readerVersion:READER_VERSION,
    evidenceVersion:EVIDENCE_VERSION,
    carouselPipelineVersion:CAROUSEL_PIPELINE_VERSION,
  };
}

function productionInputIsCurrent(input={}){
  return input?.readerVersion===READER_VERSION
    && input?.evidenceVersion===EVIDENCE_VERSION
    && input?.carouselPipelineVersion===CAROUSEL_PIPELINE_VERSION;
}

function stampEvidencePackage(pack){
  if(!pack||typeof pack!=="object")return pack;
  return {
    ...pack,
    readerVersion:READER_VERSION,
    evidenceVersion:EVIDENCE_VERSION,
    carouselPipelineVersion:CAROUSEL_PIPELINE_VERSION,
    reading:{
      ...(pack.reading||{}),
      readerVersion:READER_VERSION,
    },
  };
}

function evidencePackageIsCurrent(pack){
  return Boolean(pack?.articleText)
    && pack?.readerVersion===READER_VERSION
    && pack?.evidenceVersion===EVIDENCE_VERSION
    && pack?.carouselPipelineVersion===CAROUSEL_PIPELINE_VERSION;
}
function queueForRead(env){return env?.ARTICLE_READ_QUEUE || env?.INTELLIGENT_JOBS_QUEUE || null;}
function queueForCarousel(env){return env?.CAROUSEL_AI_QUEUE || env?.CAROUSEL_JOBS_QUEUE || env?.INTELLIGENT_JOBS_QUEUE || null;}

function transportHost(value){try{return new URL(String(value||"")).hostname.toLowerCase().replace(/^www\./,"");}catch{return "";}}

async function recordTransportOutcome(db,url,record){
  const host=transportHost(url);if(!host||!record)return;
  await ensureProductionSchema(db);
  const attempts=Array.isArray(record?.attempts)?record.attempts:[];
  const directTried=attempts.some(x=>x?.transport==="direct"||(!x?.transport&&!String(x?.method||"").startsWith("browser")));
  const browserTried=attempts.some(x=>x?.transport==="browser"||String(x?.method||"").startsWith("browser"));
  const directOk=record?.transport==="direct"?1:0;
  const browserOk=record?.transport==="browser"?1:0;
  const directFail=directTried&&!directOk?1:0;
  const browserFail=browserTried&&!browserOk?1:0;
  if(!directTried&&!browserTried)return;
  await db.prepare(`INSERT INTO production_transport_stats(host,direct_success,direct_fail,browser_success,browser_fail,updated_at)
    VALUES(?,?,?,?,?,?)
    ON CONFLICT(host) DO UPDATE SET
      direct_success=direct_success+excluded.direct_success,
      direct_fail=direct_fail+excluded.direct_fail,
      browser_success=browser_success+excluded.browser_success,
      browser_fail=browser_fail+excluded.browser_fail,
      updated_at=excluded.updated_at`)
    .bind(host,directOk,directFail,browserOk,browserFail,nowIso()).run().catch(()=>null);
}

function detectProductionLanguage(value, sourceName=""){
  const text=plainText(value).slice(0,4200);
  if(!text)return "pt";
  const source=String(sourceName||"").toLocaleLowerCase("pt-BR");
  if(/el pa[ií]s|infobae|espa[nñ]a|argentina|m[eé]xico/.test(source))return "es";
  const lower=text.toLocaleLowerCase("pt-BR");
  const portuguese=(lower.match(/\b(não|uma|das|dos|pela|pelo|pelas|pelos|após|são|foi|foram|brasileiro|brasileira|disse|afirmou|segundo|também)\b/g)||[]).length + (lower.match(/[ãõç]/g)||[]).length*2;
  const spanish=(lower.match(/\b(el|la|los|las|del|una|unos|unas|gobierno|según|también|dijo|afirmó|desde|hacia|sin|pero|este|esta|estos|estas)\b/g)||[]).length;
  const english=(lower.match(/\b(the|and|that|with|from|this|government|said|will|after|before|according|between|about|have|has|was|were|are|is)\b/g)||[]).length;
  if(portuguese>=3&&portuguese>=spanish*1.1&&portuguese>=english*1.1)return "pt";
  if(spanish>=3&&spanish>english*1.15)return "es";
  if(english>=3)return "en";
  return isLikelyPortuguese(text)?"pt":"en";
}

async function runLimitedProduction(entries, concurrency, worker){
  const list=Array.isArray(entries)?entries:[];const output=new Array(list.length);let cursor=0;
  const runners=Array.from({length:Math.min(Math.max(1,Number(concurrency)||1),list.length)},async()=>{while(cursor<list.length){const index=cursor++;output[index]=await worker(list[index],index);}});
  await Promise.all(runners);return output;
}

async function translateEvidencePackToPtBrFast(env, pack, { slideCount = 7 } = {}){
  if(!pack?.articleText)return pack;
  const detected=detectProductionLanguage(`${pack.title||""}\n${pack.subtitle||""}\n${(pack.facts||[]).slice(0,4).map(x=>x?.evidence||"").join(" ")}\n${plainText(pack.articleText).slice(0,1200)}`,pack.sourceName);
  if(detected==="pt")return {...pack,translation:{sourceLanguage:"pt",targetLanguage:"pt-BR",status:"not-needed",mode:"evidence-first",durationMs:0}};
  if(!env?.AI?.run)throw new Error("A matéria está em outro idioma e o serviço de tradução PT-BR não está disponível.");
  const started=Date.now();const limit=Math.max(Number(slideCount)||7,Math.min(18,(Number(slideCount)||7)*2+2));
  const originalFacts=(Array.isArray(pack.facts)?pack.facts:[]).slice(0,limit);
  const requests=[
    ...(pack.title?[{type:"title",text:pack.title}]:[]),
    ...(pack.subtitle?[{type:"subtitle",text:pack.subtitle}]:[]),
    ...originalFacts.map((fact,index)=>({type:"fact",index,text:fact?.evidence||fact?.text||fact?.claim||""})).filter(x=>plainText(x.text)),
  ];
  const translated=await runLimitedProduction(requests,6,async(req)=>({req,text:await translateText(env.AI,req.text,detected,{attempts:2})}));
  const missing=translated.filter(x=>!plainText(x?.text));if(missing.length)throw new Error("A tradução das evidências para português do Brasil não pôde ser concluída.");
  let title=pack.title,subtitle=pack.subtitle;const facts=originalFacts.map(x=>({...x}));
  for(const item of translated){if(item.req.type==="title")title=item.text;else if(item.req.type==="subtitle")subtitle=item.text;else if(item.req.type==="fact"&&facts[item.req.index]){facts[item.req.index].originalEvidence=facts[item.req.index].evidence;facts[item.req.index].evidence=item.text;}}
  const compactPt=facts.map(x=>plainText(x.evidence)).filter(Boolean).join("\n\n");
  if(!compactPt||detectProductionLanguage(`${title}\n${subtitle}\n${compactPt.slice(0,3000)}`,"")!=="pt")throw new Error("A normalização PT-BR do Evidence Pack não passou na validação de idioma.");
  return {...pack,title,subtitle,facts,articleText:compactPt,originalArticleText:plainText(pack.articleText).slice(0,20000),wordCount:compactPt.split(/\s+/).filter(Boolean).length,translation:{sourceLanguage:detected,targetLanguage:"pt-BR",status:"translated",mode:"evidence-first",translatedFacts:facts.length,durationMs:Date.now()-started}};
}


function evidencePtBrReady(evidence){const translation=evidence?.translation||{};return translation.sourceLanguage==="pt"||["translated","not-needed"].includes(String(translation.status||""));}

export async function ensureProductionSchema(db){
  if(!db)throw new Error("Binding D1 'DB' não configurado.");
  if((typeof db==="object"||typeof db==="function")&&PRODUCTION_SCHEMA_READY.has(db))return PRODUCTION_SCHEMA_READY.get(db);
  const task=(async()=>{
    const statements=[
      `CREATE TABLE IF NOT EXISTS production_jobs (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        source_ref TEXT,
        status TEXT NOT NULL,
        stage TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        input_json TEXT NOT NULL,
        evidence_id TEXT,
        result_json TEXT,
        error TEXT,
        fallback_level INTEGER NOT NULL DEFAULT 0,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS idx_production_jobs_status ON production_jobs(status, updated_at DESC)",
      "CREATE INDEX IF NOT EXISTS idx_production_jobs_creator ON production_jobs(created_by, updated_at DESC)",
      `CREATE TABLE IF NOT EXISTS evidence_packages (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        source_ref TEXT,
        topic_id TEXT,
        canonical_url TEXT,
        source_name TEXT,
        title TEXT,
        reading_quality REAL NOT NULL DEFAULT 0,
        word_count INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS idx_evidence_packages_source ON evidence_packages(source_type, source_ref, updated_at DESC)",
      "CREATE INDEX IF NOT EXISTS idx_evidence_packages_canonical ON evidence_packages(canonical_url, updated_at DESC)",
      `CREATE TABLE IF NOT EXISTS production_stage_events (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        stage TEXT NOT NULL,
        status TEXT NOT NULL,
        detail TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS idx_production_stage_events_job ON production_stage_events(job_id, created_at DESC)",
      `CREATE TABLE IF NOT EXISTS production_stage_leases (
        job_id TEXT NOT NULL,
        stage TEXT NOT NULL,
        token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(job_id, stage)
      )`,
      "CREATE INDEX IF NOT EXISTS idx_production_stage_leases_expiry ON production_stage_leases(expires_at)",
      `CREATE TABLE IF NOT EXISTS production_transport_stats (
        host TEXT PRIMARY KEY,
        direct_success INTEGER NOT NULL DEFAULT 0,
        direct_fail INTEGER NOT NULL DEFAULT 0,
        browser_success INTEGER NOT NULL DEFAULT 0,
        browser_fail INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS production_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ];
    for(const statement of statements) await db.prepare(statement).run();
    await db.prepare(`INSERT INTO production_state(key,value,updated_at) VALUES('schema_version',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(PRODUCTION_SCHEMA_VERSION,nowIso()).run();
  })();
  if(typeof db==="object"||typeof db==="function")PRODUCTION_SCHEMA_READY.set(db,task);
  try{return await task;}catch(error){if(typeof db==="object"||typeof db==="function")PRODUCTION_SCHEMA_READY.delete(db);throw error;}
}

async function event(db,jobId,stage,status,detail=null,metadata=null){
  await ensureProductionSchema(db);
  await db.prepare(`INSERT INTO production_stage_events(id,job_id,stage,status,detail,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(),jobId,stage,status,detail?String(detail).slice(0,500):null,safeJson(metadata||{}),nowIso()).run();
}

async function acquireProductionLease(db,jobId,stage,ttlMs){
  await ensureProductionSchema(db);
  const now=Date.now(),token=crypto.randomUUID(),expiresAt=now+Math.max(4_000,Number(ttlMs)||12_000);
  await db.prepare(`INSERT INTO production_stage_leases(job_id,stage,token,expires_at,updated_at)
    VALUES(?,?,?,?,?)
    ON CONFLICT(job_id,stage) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at,updated_at=excluded.updated_at
    WHERE production_stage_leases.expires_at < ?`)
    .bind(jobId,stage,token,expiresAt,nowIso(),now).run();
  const row=await db.prepare("SELECT token,expires_at FROM production_stage_leases WHERE job_id=? AND stage=? LIMIT 1").bind(jobId,stage).first();
  return row?.token===token?{jobId,stage,token,expiresAt}:null;
}

async function renewProductionLease(db,lease,ttlMs){
  if(!lease)return false;
  const expiresAt=Date.now()+Math.max(4_000,Number(ttlMs)||12_000);
  const result=await db.prepare("UPDATE production_stage_leases SET expires_at=?,updated_at=? WHERE job_id=? AND stage=? AND token=?").bind(expiresAt,nowIso(),lease.jobId,lease.stage,lease.token).run().catch(()=>null);
  const changed=Number(result?.meta?.changes??result?.changes??0);
  if(changed>0){lease.expiresAt=expiresAt;return true;}
  const row=await db.prepare("SELECT token FROM production_stage_leases WHERE job_id=? AND stage=? LIMIT 1").bind(lease.jobId,lease.stage).first().catch(()=>null);
  if(row?.token===lease.token){lease.expiresAt=expiresAt;return true;}
  return false;
}

async function hasActiveProductionLease(db,jobId,stage){
  await ensureProductionSchema(db);
  const row=await db.prepare("SELECT expires_at FROM production_stage_leases WHERE job_id=? AND stage=? LIMIT 1").bind(jobId,stage).first().catch(()=>null);
  return Number(row?.expires_at)>Date.now();
}

async function ownsProductionLease(db,lease){
  if(!lease)return false;
  await ensureProductionSchema(db);
  const row=await db.prepare("SELECT token,expires_at FROM production_stage_leases WHERE job_id=? AND stage=? LIMIT 1").bind(lease.jobId,lease.stage).first().catch(()=>null);
  return row?.token===lease.token&&Number(row?.expires_at)>Date.now();
}

async function revokeProductionLease(db,jobId,stage){
  await ensureProductionSchema(db);
  const row=await db.prepare("SELECT token,expires_at FROM production_stage_leases WHERE job_id=? AND stage=? LIMIT 1").bind(jobId,stage).first().catch(()=>null);
  if(!row?.token)return {revoked:false,active:false};
  await db.prepare("DELETE FROM production_stage_leases WHERE job_id=? AND stage=?").bind(jobId,stage).run().catch(()=>null);
  return {revoked:true,active:Number(row.expires_at)>Date.now(),token:String(row.token)};
}

async function touchProductionJob(db,jobId){
  await db.prepare("UPDATE production_jobs SET updated_at=? WHERE id=? AND status IN ('queued','running')").bind(nowIso(),jobId).run().catch(()=>null);
}

function startProductionLeaseHeartbeat(db,jobId,lease,{ttlMs=30_000,intervalMs=4_000}={}){
  if(!lease||typeof globalThis.setInterval!=="function")return ()=>{};
  let busy=false,stopped=false;
  const timer=globalThis.setInterval(async()=>{
    if(busy||stopped)return;busy=true;
    try{
      const renewed=await renewProductionLease(db,lease,ttlMs);
      if(renewed)await touchProductionJob(db,jobId);
      else stopped=true;
    }finally{busy=false;}
  },Math.max(2_000,Number(intervalMs)||4_000));
  return ()=>{stopped=true;try{globalThis.clearInterval?.(timer);}catch{}};
}

async function releaseProductionLease(db,lease){
  if(!lease)return;
  await db.prepare("DELETE FROM production_stage_leases WHERE job_id=? AND stage=? AND token=?").bind(lease.jobId,lease.stage,lease.token).run().catch(()=>null);
}

function jobRow(row){
  if(!row)return null;
  return {id:row.id,sourceType:row.source_type,sourceRef:row.source_ref,status:row.status,stage:row.stage,progress:Number(row.progress)||0,input:parseJson(row.input_json,{}),evidenceId:row.evidence_id||null,result:parseJson(row.result_json,null),error:row.error||null,fallbackLevel:Number(row.fallback_level)||0,createdBy:row.created_by||null,createdAt:row.created_at,updatedAt:row.updated_at,expiresAt:row.expires_at};
}

export async function cleanupProductionStorage(db){
  await ensureProductionSchema(db);const now=nowIso();const oldEvents=new Date(Date.now()-10*86400000).toISOString();
  await db.batch([
    db.prepare("DELETE FROM evidence_packages WHERE expires_at < ?").bind(now),
    db.prepare("DELETE FROM production_jobs WHERE expires_at < ? AND status NOT IN ('queued','running')").bind(now),
    db.prepare("DELETE FROM production_stage_events WHERE created_at < ? AND job_id NOT IN (SELECT id FROM production_jobs)").bind(oldEvents),
    db.prepare("DELETE FROM production_stage_leases WHERE expires_at < ?").bind(Date.now()),
  ]).catch(()=>null);
}

export async function createProductionJob(db,{sourceType,sourceRef=null,input={},createdBy=null}={}){
  await ensureProductionSchema(db);
  input=stampProductionInput(input);
  await cleanupProductionStorage(db).catch(()=>null);
  const normalizedSourceType=["url","topic","event","text"].includes(String(sourceType))?String(sourceType):"url";
  const identity=normalizedSourceType==="url"?normalizeArticleIdentity(sourceRef||input?.url):String(sourceRef||input?.topicId||input?.eventId||stableHash(safeJson(input)));
  const id=`prod-${crypto.randomUUID()}`;
  const now=nowIso();const expires=new Date(Date.now()+JOB_TTL_HOURS*3600000).toISOString();
  await db.prepare(`INSERT INTO production_jobs(id,source_type,source_ref,status,stage,progress,input_json,created_by,created_at,updated_at,expires_at) VALUES(?,?,?,'queued','source',1,?,?,?,?,?)`)
    .bind(id,normalizedSourceType,identity,clipJson(input,450_000,"Entrada de produção"),createdBy,now,now,expires).run();
  await event(db,id,"source","queued","Produção criada",{sourceType:normalizedSourceType});
  return getProductionJob(db,id);
}

export async function getProductionJob(db,id){
  await ensureProductionSchema(db);
  return jobRow(await db.prepare("SELECT * FROM production_jobs WHERE id=? LIMIT 1").bind(id).first());
}

export async function listProductionJobs(db,{userId=null,limit=30}={}){
  await ensureProductionSchema(db);const safeLimit=Math.max(1,Math.min(100,Number(limit)||30));
  const result=userId
    ? await db.prepare("SELECT * FROM production_jobs WHERE created_by=? ORDER BY updated_at DESC LIMIT ?").bind(userId,safeLimit).all()
    : await db.prepare("SELECT * FROM production_jobs ORDER BY updated_at DESC LIMIT ?").bind(safeLimit).all();
  return (result?.results||[]).map(jobRow);
}

async function updateJob(db,id,{status,stage,progress,evidenceId,result,error,fallbackLevel}={}){
  const current=await getProductionJob(db,id);if(!current)throw new Error("Produção não encontrada.");
  // READY é terminal: uma tentativa concorrente mais lenta nunca pode rebaixar um carrossel concluído.
  if(current.status==="ready"&&current.result?.slides?.length&&status&&status!=="ready")return current;
  const next={status:status??current.status,stage:stage??current.stage,progress:progress==null?current.progress:clamp(progress,0,100),evidenceId:evidenceId===undefined?current.evidenceId:evidenceId,result:result===undefined?current.result:result,error:error===undefined?current.error:error,fallbackLevel:fallbackLevel==null?current.fallbackLevel:Number(fallbackLevel)||0};
  const resultJson=next.result==null?null:clipJson(next.result,MAX_RESULT_JSON,"Resultado da produção");
  await db.prepare(`UPDATE production_jobs SET status=?,stage=?,progress=?,evidence_id=?,result_json=?,error=?,fallback_level=?,updated_at=? WHERE id=?`)
    .bind(next.status,next.stage,next.progress,next.evidenceId,resultJson,next.error?String(next.error).slice(0,900):null,next.fallbackLevel,nowIso(),id).run();
  return getProductionJob(db,id);
}

export async function saveEvidencePackage(db,pack){
  await ensureProductionSchema(db);const now=nowIso();const expires=new Date(Date.now()+EVIDENCE_TTL_DAYS*86400000).toISOString();
  pack=stampEvidencePackage(pack);
  const payload=clipJson(pack,MAX_EVIDENCE_JSON,"Evidence Pack");
  await db.prepare(`INSERT INTO evidence_packages(id,source_type,source_ref,topic_id,canonical_url,source_name,title,reading_quality,word_count,payload_json,created_at,updated_at,expires_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,reading_quality=excluded.reading_quality,word_count=excluded.word_count,updated_at=excluded.updated_at,expires_at=excluded.expires_at`)
    .bind(pack.id,pack.sourceType||"url",pack.sourceRef||null,pack.topicId||null,pack.canonicalUrl||pack.url||null,pack.sourceName||null,pack.title||null,Number(pack?.reading?.quality)||0,Number(pack.wordCount)||0,payload,pack.createdAt||now,now,expires).run();
  return pack;
}

export async function getEvidencePackage(db,id){
  await ensureProductionSchema(db);const row=await db.prepare("SELECT payload_json FROM evidence_packages WHERE id=? AND expires_at>? LIMIT 1").bind(id,nowIso()).first();
  return row?parseJson(row.payload_json,null):null;
}

async function cachedEvidenceFor(db,job,{maxAgeMinutes=null}={}){
  await ensureProductionSchema(db);
  const age=Number(maxAgeMinutes)|| (job.sourceType==="url"?60:10);
  const cutoff=new Date(Date.now()-Math.max(1,age)*60000).toISOString();
  if(job.sourceType==="url"){
    const normalized=normalizeArticleIdentity(job.sourceRef);
    const row=await db.prepare("SELECT payload_json FROM evidence_packages WHERE source_type='url' AND expires_at>? AND updated_at>=? AND (source_ref=? OR canonical_url=?) ORDER BY reading_quality DESC, updated_at DESC LIMIT 1").bind(nowIso(),cutoff,job.sourceRef,normalized).first();
    const pack=row?parseJson(row.payload_json,null):null;
    return evidencePackageIsCurrent(pack)?pack:null;
  }
  if(job.sourceRef){const row=await db.prepare("SELECT payload_json FROM evidence_packages WHERE source_type=? AND source_ref=? AND expires_at>? AND updated_at>=? ORDER BY updated_at DESC LIMIT 1").bind(job.sourceType,job.sourceRef,nowIso(),cutoff).first();const pack=row?parseJson(row.payload_json,null):null;return evidencePackageIsCurrent(pack)?pack:null;}
  return null;
}

export function productionInputFingerprint(input={},sourceType="url",sourceRef=""){
  const topic=input?.topic&&typeof input.topic==="object"?input.topic:null;
  const topicItems=Array.isArray(topic?.items)?topic.items.slice(0,8).map((item)=>({
    id:item?.id||null,
    url:normalizeArticleIdentity(item?.url||""),
    title:plainText(item?.title).slice(0,220),
    publishedAt:item?.publishedAt||null,
    contentHash:stableHash(plainText(item?.content||item?.description||"").slice(0,1600)),
  })):[];
  return stableHash(JSON.stringify({
    sourceType,
    sourceRef:sourceType==="url"?normalizeArticleIdentity(sourceRef||input?.url||""):String(sourceRef||input?.topicId||input?.eventId||""),
    url:sourceType==="url"?normalizeArticleIdentity(input?.url||sourceRef||""):null,
    title:plainText(input?.title||topic?.title||"").slice(0,240),
    editoria:plainText(input?.editoria||topic?.editoria||"").slice(0,100),
    readerVersion:input?.readerVersion||null,
    evidenceVersion:input?.evidenceVersion||null,
    carouselPipelineVersion:input?.carouselPipelineVersion||null,
    topic:topic?{
      id:topic.id||null,
      lastChangedAt:topic.lastChangedAt||topic.updatedAt||topic.lastSeenAt||null,
      sourceCount:Number(topic.sourceCount)||0,
      itemCount:Number(topic.itemCount)||topicItems.length,
      items:topicItems,
    }:null,
  }));
}

export async function findReusableProductionJob(db,{sourceType,sourceRef,createdBy,input={},maxAgeMinutes=null}={}){
  await ensureProductionSchema(db);
  if(!sourceType||!sourceRef||!createdBy)return null;
  const age=Number(maxAgeMinutes)|| (sourceType==="url"?30:5);
  const cutoff=new Date(Date.now()-Math.max(1,age)*60000).toISOString();
  const normalizedRef=sourceType==="url"?normalizeArticleIdentity(sourceRef):String(sourceRef);
  const rows=(await db.prepare("SELECT * FROM production_jobs WHERE source_type=? AND source_ref=? AND created_by=? AND status='ready' AND result_json IS NOT NULL AND updated_at>=? ORDER BY updated_at DESC LIMIT 8").bind(sourceType,normalizedRef,createdBy,cutoff).all())?.results||[];
  const slideCount=Number(input?.slideCount)||7;const styleKey=String(input?.styleKey||"");
  const fingerprint=productionInputFingerprint(input,sourceType,normalizedRef);
  for(const row of rows){
    const candidate=jobRow(row);const candidateInput=candidate?.input||{};
    if(!productionInputIsCurrent(candidateInput)||!productionInputIsCurrent(input))continue;
    if((Number(candidateInput.slideCount)||7)!==slideCount)continue;
    if(styleKey&&String(candidateInput.styleKey||"")!==styleKey)continue;
    if(productionInputFingerprint(candidateInput,sourceType,normalizedRef)!==fingerprint)continue;
    if(candidate?.result?.slides?.length)return candidate;
  }
  return null;
}

export async function findActiveProductionJob(db,{sourceType,sourceRef,createdBy,input={},maxAgeMinutes=3}={}){
  await ensureProductionSchema(db);
  if(!sourceType||!sourceRef||!createdBy)return null;
  const cutoff=new Date(Date.now()-Math.max(1,Number(maxAgeMinutes)||3)*60000).toISOString();
  const normalizedRef=sourceType==="url"?normalizeArticleIdentity(sourceRef):String(sourceRef);
  const rows=(await db.prepare("SELECT * FROM production_jobs WHERE source_type=? AND source_ref=? AND created_by=? AND status IN ('queued','running') AND updated_at>=? ORDER BY updated_at DESC LIMIT 8").bind(sourceType,normalizedRef,createdBy,cutoff).all())?.results||[];
  const slideCount=Number(input?.slideCount)||7;const styleKey=String(input?.styleKey||"");
  const fingerprint=productionInputFingerprint(input,sourceType,normalizedRef);
  for(const row of rows){
    const candidate=jobRow(row);const candidateInput=candidate?.input||{};
    if(!productionInputIsCurrent(candidateInput)||!productionInputIsCurrent(input))continue;
    if((Number(candidateInput.slideCount)||7)!==slideCount)continue;
    if(styleKey&&String(candidateInput.styleKey||"")!==styleKey)continue;
    if(productionInputFingerprint(candidateInput,sourceType,normalizedRef)!==fingerprint)continue;
    return candidate;
  }
  return null;
}

export async function processProductionRead(env,jobId,{force=false,retryMode=null}={}){
  const db=env.DB;let job=await getProductionJob(db,jobId);if(!job)throw new Error("Produção não encontrada.");
  if(job.status==="ready"&&job.result)return job;
  const lease=await acquireProductionLease(db,jobId,"reading",30_000);
  if(!lease){
    await event(db,jobId,"reading","deduplicated","Leitura já está em execução; tentativa duplicada ignorada",{sameJob:true,leaseBusy:true}).catch(()=>null);
    const current=await getProductionJob(db,jobId);return current?{...current,leaseBusy:true,deduplicated:true}:current;
  }
  const stopLeaseHeartbeat=startProductionLeaseHeartbeat(db,jobId,lease,{ttlMs:30_000,intervalMs:4_000});
  await updateJob(db,jobId,{status:"running",stage:"reading",progress:10,error:null});await event(db,jobId,"reading","running","Leitura iniciada");
  try{
    if(!force){let cached=await cachedEvidenceFor(db,job,{maxAgeMinutes:Number(env.EVIDENCE_FAST_CACHE_MINUTES)||(job.sourceType==="url"?60:10)});if(cached?.articleText&&Number(cached?.reading?.quality)>=55){cached=await translateEvidencePackToPtBrFast(env,cached,{slideCount:job.input?.slideCount||7});if(!evidencePtBrReady(cached))throw new Error("A matéria está em outro idioma e a tradução para português do Brasil não pôde ser concluída.");await saveEvidencePackage(db,cached);job=await updateJob(db,jobId,{status:"running",stage:"evidence",progress:46,evidenceId:cached.id,fallbackLevel:1});await event(db,jobId,"evidence","completed_fallback","Evidence Pack recuperado do cache e normalizado para PT-BR",{quality:cached?.reading?.quality,translation:cached?.translation?.status||"not-needed"});return job;}}
    let evidenceResult;
    if(job.sourceType==="url"){
      const input=job.input||{};const item={url:job.sourceRef,title:input.title||"Matéria externa",description:input.description||"",content:input.content||"",sourceName:input.sourceName||new URL(job.sourceRef).hostname.replace(/^www\./,""),publishedAt:input.publishedAt||null,kind:"portal"};
      const browserFetcher=browserQuickActionAvailable(env)
        ? (url)=>browserQuickActionArticle(env,url,{timeoutMs:Number(env.BROWSER_READ_TIMEOUT_MS)||(retryMode==="deep"?11_000:7_500),mode:retryMode==="deep"?"deep":"standard"})
        : null;
      // Browser é fallback no caminho normal. Só um retry explícito pode priorizá-lo,
      // evitando que aprendizado histórico transforme Chromium no transporte padrão.
      const transportPreference=(retryMode==="alternate"||retryMode==="deep")&&browserFetcher?"browser-first":"direct-first";
      const retryTimeout=retryMode==='deep'?11_000:retryMode==='alternate'?8_500:(Number(env.ARTICLE_READ_TIMEOUT_MS)||6_500);
      let record=await scrapeArticle(item,{timeoutMs:retryTimeout,slideCount:Number(job.input?.slideCount)||7,allowCollectedFastPath:retryMode==='snapshot'?true:!force,browserFetcher,transportPreference});
      await recordTransportOutcome(db,item.url,record).catch(()=>null);
      const usefulRead=Boolean(record?.ok&&(Number(record.readingQuality)>=55||(record?.evidenceSufficiency?.ready&&Number(record.readingQuality)>=40)));
      if(!usefulRead){const error=new Error(record.error||"A matéria externa abriu, mas não forneceu texto editorial suficiente para gerar o carrossel com segurança.");error.readAttempts=record.attempts||[];throw error;}
      let pack=buildEvidencePack(record,{sourceType:"url",sourceRef:job.sourceRef});
      pack=await translateEvidencePackToPtBrFast(env,pack,{slideCount:job.input?.slideCount||7});
      evidenceResult={ok:true,evidence:pack};
      if(!evidencePtBrReady(pack))throw new Error("A tradução da matéria para português do Brasil não pôde ser concluída.");
    }else if(job.sourceType==="topic"||job.sourceType==="event"){
      const topic=job.input?.topic;if(!topic)throw new Error("A pauta não foi anexada à produção.");
      // Gestão de Produção não altera leitura. A pauta segue pelo mesmo scraping completo
      // usado antes do Kanban/Newsroom OS; status é apenas metadata operacional.
      const browserFetcher=browserQuickActionAvailable(env)
        ? (url)=>browserQuickActionArticle(env,url,{timeoutMs:Number(env.BROWSER_READ_TIMEOUT_MS)||(retryMode==="deep"?11_000:7_500),mode:retryMode==="deep"?"deep":"standard"})
        : null;
      evidenceResult=await scrapeTopicToEvidence(topic,{
        timeoutMs:retryMode==='deep'?11_000:retryMode==='alternate'?8_500:(Number(env.ARTICLE_READ_TIMEOUT_MS)||6_500),slideCount:Number(job.input?.slideCount)||7,allowCollectedFastPath:retryMode==='snapshot'?true:!force,browserFetcher,
        transportPreferenceFor:async()=>((retryMode==="alternate"||retryMode==="deep")&&browserFetcher?"browser-first":"direct-first"),
        onTransportResult:async(item,record)=>recordTransportOutcome(db,item?.url,record),
      });
      if(!evidenceResult.ok){const error=new Error(evidenceResult.error||"A fonte principal e o backup não forneceram leitura útil por nenhuma rota disponível.");error.readAttempts=evidenceResult.attempts||[];throw error;}
      let translatedPack=evidenceResult.evidence||buildEvidencePack(evidenceResult.record,{sourceType:job.sourceType,sourceRef:job.sourceRef,topicId:job.sourceRef});
      translatedPack.sourceType=job.sourceType;translatedPack.sourceRef=job.sourceRef;translatedPack.topicId=job.sourceRef;
      translatedPack.sourceSelection=evidenceResult.selection||translatedPack.sourceSelection||evidenceResult.record?.sourceSelection||null;
      translatedPack.reading={...translatedPack.reading,sourceSelection:translatedPack.sourceSelection};
      translatedPack=await translateEvidencePackToPtBrFast(env,translatedPack,{slideCount:job.input?.slideCount||7});
      evidenceResult={...evidenceResult,evidence:translatedPack};
      if(!evidencePtBrReady(translatedPack))throw new Error("A tradução da fonte selecionada para português do Brasil não pôde ser concluída.");
    }else{
      const text=plainText(job.input?.text);if(text.length<120)throw new Error("Texto próprio insuficiente para produção.");
      const record={ok:true,url:null,canonicalUrl:null,sourceName:"Texto próprio",title:plainText(job.input?.title)||"Conteúdo próprio",subtitle:"",author:null,publishedAt:null,content:text,wordCount:text.split(/\s+/).filter(Boolean).length,extractionMethod:"user-text",adapter:null,readMode:"full",images:null,readingQuality:100,degraded:false,attempts:[]};
      let textPack=buildEvidencePack(record,{sourceType:"text",sourceRef:job.sourceRef||job.id});
      textPack=await translateEvidencePackToPtBrFast(env,textPack,{slideCount:job.input?.slideCount||7});
      evidenceResult={ok:true,evidence:textPack};
    }
    // Um retry manual pode revogar a lease desta tentativa enquanto o fetch/browser
    // ainda está terminando. Nesse caso a tentativa antiga não pode sobrescrever o
    // estado nem o Evidence Pack produzido pela nova leitura.
    if(!await ownsProductionLease(db,lease)){
      await event(db,jobId,"reading","superseded","Leitura anterior terminou depois de uma nova tentativa assumir o job",{retryMode:retryMode||"default",leaseSuperseded:true}).catch(()=>null);
      return getProductionJob(db,jobId);
    }
    const evidence=await saveEvidencePackage(db,evidenceResult.evidence);job=await updateJob(db,jobId,{status:"running",stage:"evidence",progress:48,evidenceId:evidence.id,fallbackLevel:evidence?.reading?.degraded?1:0});
    const readAttempts=Array.isArray(evidence?.reading?.attempts)?evidence.reading.attempts:[];
    const browserAttempts=readAttempts.filter(x=>x?.transport==="browser");
    await event(db,jobId,"evidence","completed",`Evidence Pack criado · ${evidence.wordCount} palavras · PT-BR`,{
      quality:evidence?.reading?.quality,method:evidence?.reading?.method,sourceRole:evidence?.sourceSelection?.selectedRole||"direct",translation:evidence?.translation?.status||"not-needed",
      readerVersion:READER_VERSION,evidenceVersion:EVIDENCE_VERSION,pipelineVersion:CAROUSEL_PIPELINE_VERSION,
      browserUsed:browserAttempts.length>0,browserDuration:browserAttempts.reduce((sum,x)=>sum+(Number(x?.durationMs)||0),0),
      contentChars:plainText(evidence?.articleText).length,evidenceCount:Array.isArray(evidence?.facts)?evidence.facts.length:0,attempts:readAttempts.slice(0,8),
    });
    return job;
  }catch(error){
    if(!await ownsProductionLease(db,lease)){
      await event(db,jobId,"reading","superseded","Falha de uma leitura anterior ignorada porque uma nova tentativa já assumiu o job",{error:String(error?.message||error).slice(0,180),retryMode:retryMode||"default",leaseSuperseded:true}).catch(()=>null);
      return getProductionJob(db,jobId);
    }
    const latest=await getProductionJob(db,jobId).catch(()=>null);
    if(latest?.status==="ready"&&latest?.result?.slides?.length)return latest;
    const readAttempts=Array.isArray(error?.readAttempts)?error.readAttempts.slice(0,8):[];
    await updateJob(db,jobId,{status:"failed",stage:"reading",progress:100,error:error?.message||String(error)});await event(db,jobId,"reading","failed",error?.message||String(error),{attempts:readAttempts,attemptCount:readAttempts.length});throw error;
  }finally{stopLeaseHeartbeat();await releaseProductionLease(db,lease);}
}

export async function processProductionGenerate(env,jobId,{deterministicOnly=false}={}){
  const db=env.DB;let job=await getProductionJob(db,jobId);if(!job)throw new Error("Produção não encontrada.");
  if(job.status==="ready"&&job.result?.slides?.length)return job;
  const evidence=job.evidenceId?await getEvidencePackage(db,job.evidenceId):null;if(!evidence?.articleText)throw new Error("Evidence Pack não encontrado para a produção.");if(!evidencePackageIsCurrent(evidence))throw new Error("EVIDENCE_VERSION_MISMATCH: Evidence Pack legado não pode alimentar a baseline atual.");if(!evidencePtBrReady(evidence))throw new Error("A produção foi bloqueada porque o conteúdo ainda não está normalizado em português do Brasil.");
  const lease=await acquireProductionLease(db,jobId,"generating",24_000);
  if(!lease){
    await event(db,jobId,deterministicOnly?"fallback":"generating","deduplicated","Geração já está em execução; tentativa duplicada ignorada",{sameJob:true,deterministicOnly:Boolean(deterministicOnly),leaseBusy:true}).catch(()=>null);
    const current=await getProductionJob(db,jobId);return current?{...current,leaseBusy:true,deduplicated:true}:current;
  }
  const stopLeaseHeartbeat=startProductionLeaseHeartbeat(db,jobId,lease,{ttlMs:24_000,intervalMs:4_000});
  await updateJob(db,jobId,{status:"running",stage:deterministicOnly?"fallback":"generating",progress:deterministicOnly?74:58,error:null,fallbackLevel:deterministicOnly?Math.max(2,job.fallbackLevel||0):job.fallbackLevel});await event(db,jobId,deterministicOnly?"fallback":"generating","running",deterministicOnly?"Fallback determinístico iniciado":"Multi-AI iniciada",{quality:evidence?.reading?.quality,deterministicOnly:Boolean(deterministicOnly)});
  try{
    const sourceUrl=evidence.canonicalUrl||evidence.url||"https://example.com/ronda-evidence";
    const topic=job.input?.topic||{id:job.sourceRef||job.id,title:evidence.title,editoria:job.input?.editoria||"Notícias",items:[]};
    topic.items=[{id:`evidence-item-${stableHash(sourceUrl)}`,kind:"portal",url:sourceUrl,title:evidence.title,description:evidence.subtitle||"",content:evidence.articleText,sourceName:evidence.sourceName||"Fonte",collectorName:evidence.sourceName||"Fonte",publishedAt:evidence.publishedAt||nowIso()}];
    const models=[env.ARTICLE_ANALYSIS_MODEL||ARTICLE_ANALYSIS_MODEL,env.ARTICLE_SECONDARY_MODEL||ARTICLE_SECONDARY_MODEL,...(String(env.CAROUSEL_TERTIARY_AI||"")==="1"?[env.ARTICLE_TERTIARY_MODEL||ARTICLE_TERTIARY_MODEL]:[])];
    const slideCount=Math.max(3,Math.min(15,Number(job.input?.slideCount)||7));
    const result=await buildCarouselFromEvidencePack({...evidence,editoria:job.input?.editoria||topic?.editoria||"Notícias"},{ai:deterministicOnly?null:env.AI,model:models[0],models:deterministicOnly?[]:models,multiAiMode:deterministicOnly?"single":"fast-failover",slideCount,styleKey:job.input?.styleKey||"production-fast",writingStyle:job.input?.writingProfile||null,maxEvidence:Math.min(18,slideCount*2+2)});
    const productionTotalMs=Math.max(0,Date.now()-Date.parse(job.createdAt||nowIso()));
    const finalResult={...result,language:"pt-BR",editoria:job.input?.editoria||topic?.editoria||"Notícias",topicId:topic?.id||job.sourceRef||null,production:{engine:"forma-production-engine",version:ENGINE_BASELINE_VERSION,readerVersion:READER_VERSION,evidenceVersion:EVIDENCE_VERSION,pipelineVersion:CAROUSEL_PIPELINE_VERSION,jobId:job.id,evidenceId:evidence.id,sourceType:job.sourceType,contentFirst:true,templateApplied:false,templateMode:"apply-after-generation",languagePolicy:"pt-BR-required",sourcePolicy:job.sourceType==="topic"||job.sourceType==="event"?"single-primary-one-backup":"single-source",readingQuality:evidence?.reading?.quality||0,readUrl:evidence.resolvedUrl||evidence.canonicalUrl||evidence.url||null,canonicalUrl:evidence.canonicalUrl||evidence.url||null,originalUrl:evidence.url||null,sourceName:evidence.sourceName||null,selectedSourceRole:evidence?.sourceSelection?.selectedRole||"direct",performance:{readingMs:Number(evidence?.reading?.durationMs)||0,translationMs:Number(evidence?.translation?.durationMs)||0,aiMs:Number(result?.performance?.aiMs)||0,totalMs:productionTotalMs,sourceAttempts:Number(evidence?.sourceSelection?.attempts?.length)||1}},evidencePack:{id:evidence.id,contract:evidence.contract,sourceName:evidence.sourceName,url:evidence.url,canonicalUrl:evidence.canonicalUrl,resolvedUrl:evidence.resolvedUrl||evidence.canonicalUrl||evidence.url,title:evidence.title,subtitle:evidence.subtitle,author:evidence.author,publishedAt:evidence.publishedAt,wordCount:evidence.wordCount,reading:evidence.reading,translation:evidence.translation||{sourceLanguage:"pt",targetLanguage:"pt-BR",status:"not-needed"},sourceSelection:evidence.sourceSelection||null,facts:evidence.facts,entities:evidence.entities,numbers:evidence.numbers,dates:evidence.dates,images:evidence.images}};
    if(!await ownsProductionLease(db,lease)){
      await event(db,jobId,deterministicOnly?"fallback":"generating","superseded","Geração anterior terminou depois de uma nova tentativa assumir o job",{leaseSuperseded:true,deterministicOnly:Boolean(deterministicOnly)}).catch(()=>null);
      return getProductionJob(db,jobId);
    }
    const alreadyReady=await getProductionJob(db,jobId);if(alreadyReady?.status==="ready"&&alreadyReady?.result?.slides?.length)return alreadyReady;
    job=await updateJob(db,jobId,{status:"ready",stage:"ready",progress:100,result:finalResult,error:null});await event(db,jobId,"ready","completed",`Conteúdo pronto · ${result.slides?.length||0} slides`,{quality:result?.qualityGate?.score,confidence:result?.confidence?.score,deterministicOnly:Boolean(deterministicOnly)});return job;
  }catch(error){
    if(!await ownsProductionLease(db,lease)){
      await event(db,jobId,deterministicOnly?"fallback":"generating","superseded","Falha de uma geração anterior ignorada porque uma nova tentativa já assumiu o job",{error:String(error?.message||error).slice(0,180),leaseSuperseded:true,deterministicOnly:Boolean(deterministicOnly)}).catch(()=>null);
      return getProductionJob(db,jobId);
    }
    const latest=await getProductionJob(db,jobId).catch(()=>null);
    if(latest?.status==="ready"&&latest?.result?.slides?.length)return latest;
    if(!deterministicOnly){
      await event(db,jobId,"fallback","recovery","A geração com IA não concluiu; finalizando automaticamente pelo modo seguro baseado nas evidências",{error:String(error?.message||error).slice(0,220)}).catch(()=>null);
      stopLeaseHeartbeat();
      await releaseProductionLease(db,lease);
      return processProductionGenerate(env,jobId,{deterministicOnly:true});
    }
    await updateJob(db,jobId,{status:"failed",stage:"fallback",progress:100,error:error?.message||String(error)});await event(db,jobId,"fallback","failed",error?.message||String(error));throw error;
  }finally{stopLeaseHeartbeat();await releaseProductionLease(db,lease);}
}

export async function startProductionPipeline(env,jobId,{force=false,ctx=null}={}){
  const db=env.DB;let job=await getProductionJob(db,jobId);if(!job)throw new Error("Produção não encontrada.");
  if(!force){
    let cached=await cachedEvidenceFor(db,job,{maxAgeMinutes:Number(env.EVIDENCE_FAST_CACHE_MINUTES)||(job.sourceType==="url"?60:10)}).catch(()=>null);
    if(cached?.articleText&&Number(cached?.reading?.quality)>=55){
      cached=await translateEvidencePackToPtBrFast(env,cached,{slideCount:job.input?.slideCount||7});
      await saveEvidencePackage(db,cached).catch(()=>null);
      job=await updateJob(db,jobId,{status:"queued",stage:"generating",progress:52,evidenceId:cached.id,fallbackLevel:1,error:null});
      await event(db,jobId,"evidence","completed_fallback","Fast path: Evidence Pack recente reutilizado; leitura pulada; PT-BR garantido",{quality:cached?.reading?.quality,readUrl:cached?.resolvedUrl||cached?.canonicalUrl||cached?.url||null,translation:cached?.translation?.status||"not-needed"}).catch(()=>null);
      const carouselQueue=queueForCarousel(env);
      if(carouselQueue?.send){
        try{await carouselQueue.send({type:"production-generate",jobId});await event(db,jobId,"generating","queued","Fast path enviado direto para CAROUSEL_AI_QUEUE").catch(()=>null);return job;}
        catch(error){await event(db,jobId,"generating","completed_fallback","CAROUSEL_AI_QUEUE indisponível no fast path; geração direta",{error:String(error?.message||error).slice(0,180)}).catch(()=>null);}
      }
      const task=processProductionGenerate(env,jobId);
      if(ctx?.waitUntil){ctx.waitUntil(task.catch(()=>null));return job;}
      await task;return getProductionJob(db,jobId);
    }
  }
  const readQueue=queueForRead(env);
  if(readQueue?.send){
    try{await readQueue.send({type:"production-read",jobId,force:Boolean(force)});job=await updateJob(db,jobId,{status:"queued",stage:"reading",progress:5});await event(db,jobId,"reading","queued","Enviado para ARTICLE_READ_QUEUE",{dedicated:Boolean(env.ARTICLE_READ_QUEUE)});return job;}
    catch(error){await event(db,jobId,"reading","completed_fallback","ARTICLE_READ_QUEUE indisponível; execução de contingência",{error:String(error?.message||error).slice(0,180)}).catch(()=>null);job=await updateJob(db,jobId,{status:"running",stage:"reading",progress:7,fallbackLevel:1,error:null});}
  }
  const task=(async()=>{const read=await processProductionRead(env,jobId,{force});if(read.status!=="failed"){const carouselQueue=queueForCarousel(env);if(carouselQueue?.send){try{await carouselQueue.send({type:"production-generate",jobId});}catch{await processProductionGenerate(env,jobId);}}else await processProductionGenerate(env,jobId);}})();
  if(ctx?.waitUntil){ctx.waitUntil(task.catch(()=>null));return updateJob(db,jobId,{status:"running",stage:"reading",progress:7,fallbackLevel:1});}
  await task;return getProductionJob(db,jobId);
}


async function executeInteractiveProduction(env,jobId,{force=false,retryMode=null}={}){
  let current=await processProductionRead(env,jobId,{force,retryMode});
  if(current?.leaseBusy||current?.deduplicated)return current;
  if(current?.status==="failed")return current;
  if(!current?.evidenceId)return current;
  return processProductionGenerate(env,jobId);
}

export async function launchInteractiveProduction(env,jobId,{force=false,ctx=null,retryMode=null}={}){
  const db=env.DB;let job=await getProductionJob(db,jobId);if(!job)throw new Error("Produção não encontrada.");
  if(job.status==="ready"&&job.result?.slides?.length)return {job,completed:true,interactive:true,launched:false};
  await event(db,jobId,"interactive","queued","Interactive Fast Path assíncrono iniciado",{transport:"waitUntil-direct"}).catch(()=>null);
  const task=executeInteractiveProduction(env,jobId,{force,retryMode}).catch(async(error)=>{
    await event(db,jobId,"interactive","failed",String(error?.message||error).slice(0,500),{transport:"waitUntil-direct"}).catch(()=>null);
    return getProductionJob(db,jobId).catch(()=>null);
  });
  if(ctx?.waitUntil)ctx.waitUntil(task);else void task;
  job=await getProductionJob(db,jobId);
  return {job,completed:job?.status==="ready",interactive:true,launched:true,deferred:true};
}

export async function runInteractiveProduction(env,jobId,{force=false,ctx=null,deadlineMs=PRODUCTION_INTERACTIVE_DEADLINE_MS}={}){
  const db=env.DB;let job=await getProductionJob(db,jobId);if(!job)throw new Error("Produção não encontrada.");
  if(job.status==="ready"&&job.result?.slides?.length)return {job,completed:true,interactive:true};
  await event(db,jobId,"interactive","running","Interactive Fast Path iniciado",{deadlineMs:Number(deadlineMs)||PRODUCTION_INTERACTIVE_DEADLINE_MS}).catch(()=>null);
  const task=executeInteractiveProduction(env,jobId,{force});
  const wrapped=task.then(value=>({done:true,value}),error=>({done:true,error}));
  const timeout=new Promise(resolve=>setTimeout(()=>resolve({done:false}),Math.max(2500,Number(deadlineMs)||PRODUCTION_INTERACTIVE_DEADLINE_MS)));
  const state=await Promise.race([wrapped,timeout]);
  if(state.done){if(state.error)throw state.error;await event(db,jobId,"interactive","completed","Interactive Fast Path concluído",{status:state.value?.status}).catch(()=>null);return {job:state.value,completed:state.value?.status==="ready",interactive:true};}
  if(ctx?.waitUntil)ctx.waitUntil(task.catch(()=>null));
  await event(db,jobId,"interactive","deferred","Fast Path excedeu o deadline curto; processamento direto continua em background",{deadlineMs:Number(deadlineMs)||PRODUCTION_INTERACTIVE_DEADLINE_MS}).catch(()=>null);
  job=await getProductionJob(db,jobId);return {job,completed:job?.status==="ready",interactive:true,deferred:true};
}

export async function runProductionQueue(batch,env){
  for(const message of batch?.messages||[]){
    const body=message?.body&&typeof message.body==="object"?message.body:{};
    if(!String(body.type||"").startsWith("production-"))continue;
    try{
      if(body.type==="production-read"){
        const job=await processProductionRead(env,body.jobId,{force:Boolean(body.force)});
        if(job.status!=="failed"){
          const q=queueForCarousel(env);
          if(q?.send){try{await q.send({type:"production-generate",jobId:body.jobId});}catch(error){await event(env.DB,body.jobId,"generating","completed_fallback","CAROUSEL_AI_QUEUE indisponível; geração no consumidor de leitura",{error:String(error?.message||error).slice(0,180)}).catch(()=>null);await processProductionGenerate(env,body.jobId);}}
          else await processProductionGenerate(env,body.jobId);
        }
      }else if(body.type==="production-generate") await processProductionGenerate(env,body.jobId);
      message?.ack?.();
    }catch(error){
      const attempts=Number(message?.attempts||1);
      if(attempts<3&&message?.retry){
        const stage=body.type==="production-generate"?"generating":"reading";
        await updateJob(env.DB,body.jobId,{status:"queued",stage,progress:stage==="generating"?54:8,error:null}).catch(()=>null);
        await event(env.DB,body.jobId,stage,"queued",`Retry ${attempts}/3 após falha transitória`,{error:String(error?.message||error).slice(0,180)}).catch(()=>null);
        message.retry({delaySeconds:Math.min(60,10*attempts)});continue;
      }
      await updateJob(env.DB,body.jobId,{status:"failed",progress:100,error:error?.message||String(error)}).catch(()=>null);message?.ack?.();
    }
  }
}


async function productionRecoveryCount(db,jobId,stage){
  const row=await db.prepare("SELECT COUNT(*) AS total FROM production_stage_events WHERE job_id=? AND stage=? AND status='recovery'").bind(jobId,stage).first().catch(()=>null);
  return Number(row?.total)||0;
}

async function runDirectProductionRecovery(env,jobId,{stage,ctx=null,retryMode=null,force=false}={}){
  const task=(async()=>{
    if(stage==="generating"||stage==="fallback")return processProductionGenerate(env,jobId,{deterministicOnly:stage==="fallback"});
    const read=await processProductionRead(env,jobId,{force,retryMode});
    if(read?.leaseBusy||read?.deduplicated)return read;
    if(read?.status!=="failed")return processProductionGenerate(env,jobId);
    return read;
  })();
  if(ctx?.waitUntil){ctx.waitUntil(task.catch(()=>null));return getProductionJob(env.DB,jobId);}
  await task;return getProductionJob(env.DB,jobId);
}

export async function recoverStalledProductionJob(env,id,{ctx=null,forceFallback=false}={}){
  const db=env.DB;let job=await getProductionJob(db,id);if(!job)throw new Error("Produção não encontrada.");
  if(job.status==="ready")return job;
  if(job.status==="failed"&&job.evidenceId){
    const count=await productionRecoveryCount(db,id,"fallback");
    if(count<1){
      await updateJob(db,id,{status:"running",stage:"fallback",progress:76,error:null,fallbackLevel:Math.max(2,job.fallbackLevel||0)});
      await event(db,id,"fallback","recovery","Job falhou após criar Evidence Pack; conclusão determinística automática iniciada",{fromFailed:true}).catch(()=>null);
      return runDirectProductionRecovery(env,id,{stage:"fallback",ctx});
    }
    return job;
  }
  if(job.status==="failed")return job;
  const now=Date.now();const updatedMs=Date.parse(job.updatedAt||job.createdAt||"");const createdMs=Date.parse(job.createdAt||"");
  const idleMs=Number.isFinite(updatedMs)?Math.max(0,now-updatedMs):PRODUCTION_HARD_DEADLINE_MS;
  const ageMs=Number.isFinite(createdMs)?Math.max(0,now-createdMs):idleMs;
  const stage=String(job.stage||"source");

  if(job.evidenceId&&(stage==="reading"||stage==="evidence"||stage==="source")){
    await updateJob(db,id,{status:"queued",stage:"generating",progress:52,error:null,fallbackLevel:Math.max(1,job.fallbackLevel||0)});
    await event(db,id,"generating","recovery","Evidence Pack já existia; leitura interrompida e geração retomada automaticamente",{idleMs,ageMs});
    const q=queueForCarousel(env);if(q?.send){try{await q.send({type:"production-generate",jobId:id});return getProductionJob(db,id);}catch{}}
    return runDirectProductionRecovery(env,id,{stage:"generating",ctx});
  }

  if(forceFallback&&job.evidenceId){
    await event(db,id,"fallback","recovery","Deadline operacional atingido; finalização determinística acionada",{idleMs,ageMs});
    return runDirectProductionRecovery(env,id,{stage:"fallback",ctx});
  }

  if((stage==="source"||stage==="reading")&&idleMs>=PRODUCTION_READ_STALE_MS){
    if(await hasActiveProductionLease(db,id,"reading"))return job;
    const count=await productionRecoveryCount(db,id,"reading");
    if(count<1){
      await updateJob(db,id,{status:"running",stage:"reading",progress:Math.max(8,job.progress||0),error:null,fallbackLevel:Math.max(1,job.fallbackLevel||0)});
      await event(db,id,"reading","recovery","Queue de leitura sem progresso; recuperação direta iniciada",{idleMs,ageMs});
      return runDirectProductionRecovery(env,id,{stage:"reading",ctx,force:true,retryMode:"alternate"});
    }
  }

  if((stage==="generating"||stage==="quality")&&idleMs>=PRODUCTION_GENERATE_STALE_MS){
    if(await hasActiveProductionLease(db,id,"generating"))return job;
    const count=await productionRecoveryCount(db,id,"generating");
    if(count<1){
      await updateJob(db,id,{status:"running",stage:"generating",progress:Math.max(58,job.progress||0),error:null,fallbackLevel:Math.max(1,job.fallbackLevel||0)});
      await event(db,id,"generating","recovery","Queue de IA sem progresso; geração direta retomada",{idleMs,ageMs});
      return runDirectProductionRecovery(env,id,{stage:"generating",ctx});
    }
  }

  if(ageMs>=PRODUCTION_HARD_DEADLINE_MS&&job.evidenceId){
    const count=await productionRecoveryCount(db,id,"fallback");
    if(count<1){
      await updateJob(db,id,{status:"running",stage:"fallback",progress:Math.max(76,job.progress||0),error:null,fallbackLevel:Math.max(2,job.fallbackLevel||0)});
      await event(db,id,"fallback","recovery","Limite de 45 s atingido; fallback determinístico único iniciado",{idleMs,ageMs,singleCoordinator:true});
      return runDirectProductionRecovery(env,id,{stage:"fallback",ctx});
    }
  }
  if(ageMs>=PRODUCTION_ABSOLUTE_DEADLINE_MS&&!job.evidenceId){
    // Não declarar falha enquanto uma leitura antiga ainda detém a lease. Em vez
    // disso, fazemos um handoff único para snapshot/cache. A tentativa antiga é
    // invalidada e, graças ao token da lease, não pode sobrescrever o novo ciclo.
    if(await hasActiveProductionLease(db,id,"reading")){
      const deadlineHandoffs=(await db.prepare("SELECT COUNT(*) AS total FROM production_stage_events WHERE job_id=? AND stage='reading' AND status='recovery' AND detail='Deadline absoluto: handoff da leitura para snapshot/cache'").bind(id).first().catch(()=>null));
      if(Number(deadlineHandoffs?.total||0)<1){
        await revokeProductionLease(db,id,"reading").catch(()=>null);
        await updateJob(db,id,{status:"running",stage:"reading",progress:Math.max(12,job.progress||0),error:null,fallbackLevel:Math.max(1,job.fallbackLevel||0)});
        await event(db,id,"reading","recovery","Deadline absoluto: handoff da leitura para snapshot/cache",{idleMs,ageMs,singleCoordinator:true,leaseHandoff:true,retryMode:"snapshot"}).catch(()=>null);
        return runDirectProductionRecovery(env,id,{stage:"reading",ctx,retryMode:"snapshot",force:false});
      }
      return getProductionJob(db,id);
    }
    job=await updateJob(db,id,{status:"failed",stage:"reading",progress:100,error:"A fonte não respondeu após as rotas de recuperação disponíveis. Tente novamente para iniciar uma nova leitura com estratégia diferente."});
    await event(db,id,"reading","failed","Produção encerrada após o deadline sem Evidence Pack e sem leitura ativa",{idleMs,ageMs,singleCoordinator:true});
  } else if(ageMs>=PRODUCTION_ABSOLUTE_DEADLINE_MS&&job.evidenceId&&job.status!=="ready"){
    const fallbackCount=await productionRecoveryCount(db,id,"fallback");
    if(fallbackCount>=1){
      job=await updateJob(db,id,{status:"failed",stage:"fallback",progress:100,error:"A produção não concluiu após o fallback seguro. O Evidence Pack foi preservado para uma nova tentativa."});
      await event(db,id,"fallback","failed","Produção encerrada após fallback único sem conclusão",{idleMs,ageMs,singleCoordinator:true});
    }
  }
  return job;
}


export async function getProductionOperationalDiagnostics(db,{stuckOnly=true,limit=20}={}){
  await ensureProductionSchema(db);
  const safeLimit=Math.max(1,Math.min(50,Number(limit)||20));
  const cutoff=new Date(Date.now()-5*60*1000).toISOString();
  const where=stuckOnly?"WHERE p.status IN ('queued','running') AND p.updated_at < ?":"WHERE p.status IN ('queued','running')";
  const query=`SELECT p.* FROM production_jobs p ${where} ORDER BY p.updated_at ASC LIMIT ?`;
  const rows=(await (stuckOnly?db.prepare(query).bind(cutoff,safeLimit):db.prepare(query).bind(safeLimit)).all())?.results||[];
  const now=Date.now();const items=[];
  for(const row of rows){
    const job=jobRow(row);
    const events=(await db.prepare("SELECT stage,status,detail,metadata_json,created_at FROM production_stage_events WHERE job_id=? ORDER BY created_at ASC LIMIT 120").bind(job.id).all().catch(()=>({results:[]})))?.results||[];
    const leases=(await db.prepare("SELECT stage,expires_at,updated_at FROM production_stage_leases WHERE job_id=? ORDER BY updated_at DESC").bind(job.id).all().catch(()=>({results:[]})))?.results||[];
    const evidence=job.evidenceId?await getEvidencePackage(db,job.evidenceId).catch(()=>null):null;
    const activeLease=leases.find(x=>Number(x.expires_at)>now)||null;
    const recoveryEvents=events.filter(x=>x.status==="recovery");
    const runningEvent=events.find(x=>x.status==="running")||null;
    const completedEvent=[...events].reverse().find(x=>x.status==="completed"||x.stage==="ready")||null;
    const previousEvent=events.length>1?events[events.length-2]:null;
    const eventMetadata=events.map(x=>parseJson(x.metadata_json,{})).filter(Boolean);
    const evidenceAttempts=Array.isArray(evidence?.reading?.attempts)?evidence.reading.attempts:[];
    const eventAttempts=[...eventMetadata].reverse().find(x=>Array.isArray(x?.attempts))?.attempts||[];
    const attempts=(evidenceAttempts.length?evidenceAttempts:eventAttempts).slice(0,12);
    const browserAttempts=attempts.filter(x=>x?.transport==="browser"||String(x?.method||"").startsWith("browser"));
    const successfulAttempt=[...attempts].reverse().find(x=>x?.ok)||null;
    const updatedMs=Date.parse(job.updatedAt||job.createdAt||"");const createdMs=Date.parse(job.createdAt||"");
    const ageSeconds=Number.isFinite(createdMs)?Math.max(0,Math.floor((now-createdMs)/1000)):null;
    const heartbeatAgeSeconds=Number.isFinite(updatedMs)?Math.max(0,Math.floor((now-updatedMs)/1000)):null;
    let reason="active_processing";
    if(!productionInputIsCurrent(job.input||{}))reason="legacy_pipeline_preserved";
    else if(activeLease)reason="active_lease";
    else if(job.evidenceId&&["source","reading","evidence"].includes(String(job.stage||"")))reason="evidence_ready_state_not_advanced";
    else if((heartbeatAgeSeconds||0)>=300&&job.status==="queued")reason="queue_or_consumer_no_progress";
    else if((heartbeatAgeSeconds||0)>=300&&job.status==="running")reason="heartbeat_lost_or_worker_abandoned";
    else if((ageSeconds||0)>=Math.floor(PRODUCTION_ABSOLUTE_DEADLINE_MS/1000))reason="recovery_due";
    const input=job.input||{};
    items.push({
      jobId:job.id,
      productionId:job.id,
      articleId:input.articleId||null,
      eventId:input.eventId||input?.editorialEventContext?.eventId||null,
      topicId:input?.topic?.id||(job.sourceType==="topic"?job.sourceRef:null),
      url:job.sourceType==="url"?job.sourceRef:(input.url||null),
      domain:job.sourceType==="url"?transportHost(job.sourceRef):transportHost(input.url||evidence?.url||""),
      createdAt:job.createdAt,updatedAt:job.updatedAt,startedAt:runningEvent?.created_at||null,completedAt:completedEvent?.created_at||null,heartbeatAt:job.updatedAt,
      status:job.status,stage:job.stage,previousStage:previousEvent?.stage||null,
      attempt:Math.max(1,recoveryEvents.length+1),
      retryCount:recoveryEvents.filter(x=>String(x.detail||"").startsWith("Nova tentativa")).length,
      readerStrategy:evidence?.reading?.method||successfulAttempt?.method||null,
      browserUsed:browserAttempts.length>0,
      browserDuration:browserAttempts.reduce((sum,x)=>sum+(Number(x?.durationMs)||0),0),
      browserMsUsed:browserAttempts.reduce((sum,x)=>sum+(Number(x?.browserMsUsed)||0),0),
      contentChars:plainText(evidence?.articleText||"").length,
      evidenceCount:Array.isArray(evidence?.facts)?evidence.facts.length:0,
      attempts,
      queue:["source","reading","evidence"].includes(String(job.stage||""))?"ARTICLE_READ":(["generating","quality","fallback"].includes(String(job.stage||""))?"CAROUSEL_AI":null),
      queueMessageId:null,worker:null,
      leaseOwner:activeLease?"production-stage-lease":null,
      leaseStage:activeLease?.stage||null,
      lockId:activeLease?`lease:${activeLease.stage}`:null,
      lockOwner:activeLease?"production-stage-lease":null,
      lockCreatedAt:null,
      lockExpiresAt:activeLease?new Date(Number(activeLease.expires_at)).toISOString():null,
      lastError:job.error||null,
      failureReason:job.status==="failed"?(job.error||"failed"):null,
      failureStage:job.status==="failed"?job.stage:null,
      recoveryAttempts:recoveryEvents.length,
      lastRecoveryAt:recoveryEvents.length?recoveryEvents[recoveryEvents.length-1].created_at:null,
      sourceType:job.sourceType,
      carouselJobId:job.id,
      resultExists:Boolean(job.result?.slides?.length),
      evidenceExists:Boolean(job.evidenceId),
      evidenceCompatible:evidence?evidencePackageIsCurrent(evidence):false,
      readerVersion:evidence?.readerVersion||input.readerVersion||null,
      evidenceVersion:evidence?.evidenceVersion||input.evidenceVersion||null,
      pipelineVersion:evidence?.carouselPipelineVersion||input.carouselPipelineVersion||null,
      ageSeconds,heartbeatAgeSeconds,reason,
    });
  }
  return {
    generatedAt:nowIso(),
    pipeline:{engineBaseline:ENGINE_BASELINE_VERSION,readerVersion:READER_VERSION,evidenceVersion:EVIDENCE_VERSION,carouselPipelineVersion:CAROUSEL_PIPELINE_VERSION},
    stuckCutoffSeconds:300,count:items.length,items,
    schemaLimitations:{queueMessageId:"not-persisted",worker:"not-persisted",lockCreatedAt:"not-persisted; lease updated_at is renewal time",heartbeatAt:"production_jobs.updated_at is the heartbeat-equivalent timestamp"},
  };
}

export async function autoRecoverStaleProductionJobs(env,{limit=5,ctx=null}={}){
  const db=env.DB;await ensureProductionSchema(db);
  // This extends the existing scheduled recovery coordinator. It does not create
  // a competing worker: recoverStalledProductionJob still owns all lease,
  // idempotency, retry and fallback decisions.
  const cutoff=new Date(Date.now()-Math.min(PRODUCTION_READ_STALE_MS,PRODUCTION_GENERATE_STALE_MS)).toISOString();
  const rows=(await db.prepare("SELECT id FROM production_jobs WHERE status IN ('queued','running') AND updated_at < ? ORDER BY updated_at ASC LIMIT ?").bind(cutoff,Math.max(1,Math.min(10,Number(limit)||5))).all().catch(()=>({results:[]})))?.results||[];
  let recovered=0,terminal=0,unchanged=0;
  for(const row of rows){
    const before=await getProductionJob(db,row.id).catch(()=>null);if(!before)continue;
    if(!productionInputIsCurrent(before.input||{})){unchanged+=1;continue;}
    try{
      const after=await recoverStalledProductionJob(env,row.id,{ctx});
      if(after?.status==='ready'||after?.status==='failed')terminal+=1;
      if(after&&(after.status!==before.status||after.stage!==before.stage||after.updatedAt!==before.updatedAt))recovered+=1;else unchanged+=1;
    }catch{unchanged+=1;}
  }
  return {candidates:rows.length,recovered,terminal,unchanged};
}

export async function productionBundle(db,id){
  const job=await getProductionJob(db,id);if(!job)return null;const evidence=job.evidenceId?await getEvidencePackage(db,job.evidenceId):null;const events=(await db.prepare("SELECT stage,status,detail,metadata_json,created_at FROM production_stage_events WHERE job_id=? ORDER BY created_at ASC LIMIT 80").bind(id).all())?.results||[];
  return {job,evidence:job.status==="ready"?evidence:evidence?{id:evidence.id,contract:evidence.contract,sourceName:evidence.sourceName,title:evidence.title,url:evidence.url,canonicalUrl:evidence.canonicalUrl,resolvedUrl:evidence.resolvedUrl||evidence.canonicalUrl||evidence.url,wordCount:evidence.wordCount,reading:evidence.reading,images:evidence.images}:null,events:events.map((x)=>({stage:x.stage,status:x.status,detail:x.detail,metadata:parseJson(x.metadata_json,{}),createdAt:x.created_at}))};
}

export async function retryProductionJob(env,id,{ctx=null,stage=null}={}){
  const job=await getProductionJob(env.DB,id);if(!job)throw new Error("Produção não encontrada.");
  if(!productionInputIsCurrent(job.input||{}))throw new Error("LEGACY_PIPELINE_JOB: inicie uma nova produção; o histórico foi preservado, mas não pode ser reutilizado pela baseline atual.");
  if(stage==="generate"&&job.evidenceId){
    const revoked=await revokeProductionLease(env.DB,id,"generating").catch(()=>({revoked:false,active:false}));
    await updateJob(env.DB,id,{status:"queued",stage:"generating",progress:52,error:null});
    await event(env.DB,id,"generating","recovery","Nova tentativa solicitada pelo operador; retomando diretamente do Evidence Pack",{sameJob:true,transport:"waitUntil-direct",leaseRevoked:Boolean(revoked?.revoked),previousLeaseActive:Boolean(revoked?.active)}).catch(()=>null);
    return runDirectProductionRecovery(env,id,{stage:"generating",ctx});
  }
  const retryRows=(await env.DB.prepare("SELECT metadata_json FROM production_stage_events WHERE job_id=? AND stage='reading' AND status='recovery' AND detail LIKE 'Nova tentativa %' ORDER BY created_at ASC LIMIT 12").bind(id).all().catch(()=>({results:[]})))?.results||[];
  const retryNumber=retryRows.length+1;
  const retryMode=retryNumber===1?'alternate':retryNumber===2?'deep':'snapshot';
  const labels={alternate:'transporte alternativo',deep:'leitura profunda com rota alternativa',snapshot:'snapshot/cache + rotas disponíveis'};
  // Retry manual tem prioridade sobre uma leitura antiga que ficou viva além do
  // deadline. Revogar a lease garante que o clique realmente inicia uma nova rota.
  // A tentativa antiga verifica o token antes de gravar qualquer resultado.
  const revoked=await revokeProductionLease(env.DB,id,"reading").catch(()=>({revoked:false,active:false}));
  await updateJob(env.DB,id,{status:"queued",stage:"reading",progress:3,error:null});
  await event(env.DB,id,"reading","recovery",`Nova tentativa ${retryNumber}: ${labels[retryMode]}; mesmo job, estratégia diferente`,{sameJob:true,retryNumber,retryMode,avoidRepeat:true,manualRetry:true,leaseRevoked:Boolean(revoked?.revoked),previousLeaseActive:Boolean(revoked?.active)}).catch(()=>null);
  const launched=await launchInteractiveProduction(env,id,{force:retryMode!=='snapshot',ctx,retryMode});
  return launched.job||getProductionJob(env.DB,id);
}

export async function generateProductionImage(env,{prompt,width=1024,height=1024}={}){
  const text=plainText(prompt).slice(0,1600);if(text.length<8)throw new Error("Descreva a imagem que deseja gerar.");if(!env.AI?.run)throw new Error("Workers AI não está disponível.");
  const model=env.FORMA_IMAGE_MODEL||"@cf/black-forest-labs/flux-1-schnell";
  const result=await env.AI.run(model,{prompt:text,width:Math.max(512,Math.min(1536,Number(width)||1024)),height:Math.max(512,Math.min(1536,Number(height)||1024)),num_steps:4});
  if(result instanceof ReadableStream || result instanceof ArrayBuffer || ArrayBuffer.isView(result))return {model,body:result};
  if(result?.image){const raw=String(result.image);const bytes=Uint8Array.from(atob(raw.replace(/^data:image\/[a-z+]+;base64,/i,"")),c=>c.charCodeAt(0));return {model,body:bytes};}
  throw new Error("O modelo de imagem não retornou bytes utilizáveis.");
}
