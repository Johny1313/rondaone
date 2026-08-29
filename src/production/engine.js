import {
  ARTICLE_ANALYSIS_MODEL,
  ARTICLE_SECONDARY_MODEL,
  ARTICLE_TERTIARY_MODEL,
  buildIntelligentCarousel,
  validateArticleUrl,
} from "../ronda/v285/article-reader.js";
import { stableHash, plainText } from "../ronda/v285/parser.js";
import { buildEvidencePack, scrapeArticle, scrapeTopicToEvidence } from "./scraping-engine.js";

const PRODUCTION_SCHEMA_VERSION = "0.9.7";
const JOB_TTL_HOURS = 48;
const EVIDENCE_TTL_DAYS = 7;
const MAX_RESULT_JSON = 900_000;
const MAX_EVIDENCE_JSON = 1_100_000;

function nowIso(){ return new Date().toISOString(); }
function clamp(value,min,max){ return Math.max(min,Math.min(max,Number(value)||0)); }
function safeJson(value,fallback=null){ try{return JSON.stringify(value);}catch{return JSON.stringify(fallback);} }
function parseJson(value,fallback=null){ try{return JSON.parse(String(value||""));}catch{return fallback;} }
function clipJson(value,limit,label){const text=safeJson(value,{});if(text.length>limit)throw new Error(`${label} excedeu o limite seguro de armazenamento.`);return text;}
function queueForRead(env){return env?.ARTICLE_READ_QUEUE || env?.INTELLIGENT_JOBS_QUEUE || null;}
function queueForCarousel(env){return env?.CAROUSEL_AI_QUEUE || env?.CAROUSEL_JOBS_QUEUE || env?.INTELLIGENT_JOBS_QUEUE || null;}

export async function ensureProductionSchema(db){
  if(!db)throw new Error("Binding D1 'DB' não configurado.");
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
    `CREATE TABLE IF NOT EXISTS production_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  ];
  for(const statement of statements) await db.prepare(statement).run();
  await db.prepare(`INSERT INTO production_state(key,value,updated_at) VALUES('schema_version',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(PRODUCTION_SCHEMA_VERSION,nowIso()).run();
}

async function event(db,jobId,stage,status,detail=null,metadata=null){
  await ensureProductionSchema(db);
  await db.prepare(`INSERT INTO production_stage_events(id,job_id,stage,status,detail,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(),jobId,stage,status,detail?String(detail).slice(0,500):null,safeJson(metadata||{}),nowIso()).run();
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
  ]).catch(()=>null);
}

export async function createProductionJob(db,{sourceType,sourceRef=null,input={},createdBy=null}={}){
  await ensureProductionSchema(db);
  await cleanupProductionStorage(db).catch(()=>null);
  const normalizedSourceType=["url","topic","event","text"].includes(String(sourceType))?String(sourceType):"url";
  const identity=normalizedSourceType==="url"?validateArticleUrl(sourceRef||input?.url):String(sourceRef||input?.topicId||input?.eventId||stableHash(safeJson(input)));
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
  const next={status:status??current.status,stage:stage??current.stage,progress:progress==null?current.progress:clamp(progress,0,100),evidenceId:evidenceId===undefined?current.evidenceId:evidenceId,result:result===undefined?current.result:result,error:error===undefined?current.error:error,fallbackLevel:fallbackLevel==null?current.fallbackLevel:Number(fallbackLevel)||0};
  const resultJson=next.result==null?null:clipJson(next.result,MAX_RESULT_JSON,"Resultado da produção");
  await db.prepare(`UPDATE production_jobs SET status=?,stage=?,progress=?,evidence_id=?,result_json=?,error=?,fallback_level=?,updated_at=? WHERE id=?`)
    .bind(next.status,next.stage,next.progress,next.evidenceId,resultJson,next.error?String(next.error).slice(0,900):null,next.fallbackLevel,nowIso(),id).run();
  return getProductionJob(db,id);
}

export async function saveEvidencePackage(db,pack){
  await ensureProductionSchema(db);const now=nowIso();const expires=new Date(Date.now()+EVIDENCE_TTL_DAYS*86400000).toISOString();
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

async function cachedEvidenceFor(db,job){
  await ensureProductionSchema(db);
  if(job.sourceType==="url"){
    const row=await db.prepare("SELECT payload_json FROM evidence_packages WHERE source_type='url' AND source_ref=? AND expires_at>? ORDER BY reading_quality DESC, updated_at DESC LIMIT 1").bind(job.sourceRef,nowIso()).first();
    return row?parseJson(row.payload_json,null):null;
  }
  if(job.sourceRef){const row=await db.prepare("SELECT payload_json FROM evidence_packages WHERE source_type=? AND source_ref=? AND expires_at>? ORDER BY updated_at DESC LIMIT 1").bind(job.sourceType,job.sourceRef,nowIso()).first();return row?parseJson(row.payload_json,null):null;}
  return null;
}

function bestTopicItem(topic){return (Array.isArray(topic?.items)?topic.items:[]).find((item)=>/^https?:\/\//i.test(String(item?.url||""))&&item?.kind!=="social")||null;}

export async function processProductionRead(env,jobId,{force=false}={}){
  const db=env.DB;let job=await getProductionJob(db,jobId);if(!job)throw new Error("Produção não encontrada.");
  if(job.status==="ready"&&job.result)return job;
  await updateJob(db,jobId,{status:"running",stage:"reading",progress:10,error:null});await event(db,jobId,"reading","running","Leitura iniciada");
  try{
    if(!force){const cached=await cachedEvidenceFor(db,job);if(cached?.articleText&&Number(cached?.reading?.quality)>=55){await saveEvidencePackage(db,cached);job=await updateJob(db,jobId,{status:"running",stage:"evidence",progress:46,evidenceId:cached.id,fallbackLevel:1});await event(db,jobId,"evidence","completed_fallback","Evidence Pack recuperado do cache",{quality:cached?.reading?.quality});return job;}}
    let evidenceResult;
    if(job.sourceType==="url"){
      const input=job.input||{};const item={url:job.sourceRef,title:input.title||"Matéria externa",description:input.description||"",content:input.content||"",sourceName:input.sourceName||new URL(job.sourceRef).hostname.replace(/^www\./,""),publishedAt:input.publishedAt||null,kind:"portal"};
      const record=await scrapeArticle(item,{timeoutMs:Number(env.ARTICLE_READ_TIMEOUT_MS)||16_000});
      if(!record.ok)throw new Error(record.error||"A matéria externa não forneceu leitura útil.");
      evidenceResult={ok:true,evidence:buildEvidencePack(record,{sourceType:"url",sourceRef:job.sourceRef})};
    }else if(job.sourceType==="topic"||job.sourceType==="event"){
      const topic=job.input?.topic;if(!topic)throw new Error("A pauta não foi anexada à produção.");
      evidenceResult=await scrapeTopicToEvidence(topic,{timeoutMs:Number(env.ARTICLE_READ_TIMEOUT_MS)||16_000});
      if(!evidenceResult.ok)throw new Error(evidenceResult.error||"Nenhuma fonte da pauta foi lida.");
      evidenceResult.evidence={...evidenceResult.evidence,sourceType:job.sourceType,sourceRef:job.sourceRef,topicId:job.sourceRef};
    }else{
      const text=plainText(job.input?.text);if(text.length<120)throw new Error("Texto próprio insuficiente para produção.");
      const record={ok:true,url:null,canonicalUrl:null,sourceName:"Texto próprio",title:plainText(job.input?.title)||"Conteúdo próprio",subtitle:"",author:null,publishedAt:null,content:text,wordCount:text.split(/\s+/).filter(Boolean).length,extractionMethod:"user-text",adapter:null,readMode:"full",images:null,readingQuality:100,degraded:false,attempts:[]};
      evidenceResult={ok:true,evidence:buildEvidencePack(record,{sourceType:"text",sourceRef:job.sourceRef||job.id})};
    }
    const evidence=await saveEvidencePackage(db,evidenceResult.evidence);job=await updateJob(db,jobId,{status:"running",stage:"evidence",progress:48,evidenceId:evidence.id,fallbackLevel:evidence?.reading?.degraded?1:0});
    await event(db,jobId,"evidence","completed",`Evidence Pack criado · ${evidence.wordCount} palavras`,{quality:evidence?.reading?.quality,method:evidence?.reading?.method});
    return job;
  }catch(error){await updateJob(db,jobId,{status:"failed",stage:"reading",progress:100,error:error?.message||String(error)});await event(db,jobId,"reading","failed",error?.message||String(error));throw error;}
}

function evidenceSyntheticHtml(evidence){
  const esc=(v)=>String(v||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const image=evidence?.images?.primary?.url||evidence?.images?.primary?.proxyUrl||"";
  const paragraphs=plainText(evidence.articleText).split(/\n{2,}|(?<=[.!?])\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ])/).filter(Boolean).map((p)=>`<p>${esc(p)}</p>`).join("\n");
  return `<!doctype html><html><head><title>${esc(evidence.title)}</title><meta name="description" content="${esc(evidence.subtitle)}"><meta name="author" content="${esc(evidence.author)}">${evidence.publishedAt?`<meta property="article:published_time" content="${esc(evidence.publishedAt)}">`:""}${image?`<meta property="og:image" content="${esc(image)}">`:""}<link rel="canonical" href="${esc(evidence.canonicalUrl||evidence.url||"https://example.com/ronda-evidence")}"></head><body><article><h1>${esc(evidence.title)}</h1>${paragraphs}</article></body></html>`;
}

export async function processProductionGenerate(env,jobId){
  const db=env.DB;let job=await getProductionJob(db,jobId);if(!job)throw new Error("Produção não encontrada.");
  const evidence=job.evidenceId?await getEvidencePackage(db,job.evidenceId):null;if(!evidence?.articleText)throw new Error("Evidence Pack não encontrado para a produção.");
  await updateJob(db,jobId,{status:"running",stage:"generating",progress:58,error:null});await event(db,jobId,"generating","running","Multi-AI iniciada",{quality:evidence?.reading?.quality});
  try{
    const sourceUrl=evidence.canonicalUrl||evidence.url||"https://example.com/ronda-evidence";
    const topic=job.input?.topic||{id:job.sourceRef||job.id,title:evidence.title,editoria:job.input?.editoria||"Notícias",items:[]};
    topic.items=[{id:`evidence-item-${stableHash(sourceUrl)}`,kind:"portal",url:sourceUrl,title:evidence.title,description:evidence.subtitle||"",content:evidence.articleText,sourceName:evidence.sourceName||"Fonte",collectorName:evidence.sourceName||"Fonte",publishedAt:evidence.publishedAt||nowIso()}];
    const html=evidenceSyntheticHtml(evidence);const syntheticFetcher=async()=>new Response(html,{status:200,headers:{"content-type":"text/html; charset=utf-8"}});
    const models=[env.ARTICLE_ANALYSIS_MODEL||ARTICLE_ANALYSIS_MODEL,env.ARTICLE_SECONDARY_MODEL||ARTICLE_SECONDARY_MODEL,...(String(env.CAROUSEL_TERTIARY_AI||"")==="1"?[env.ARTICLE_TERTIARY_MODEL||ARTICLE_TERTIARY_MODEL]:[])];
    const slideCount=Math.max(3,Math.min(15,Number(job.input?.slideCount)||7));
    const result=await buildIntelligentCarousel(topic,{ai:env.AI,model:models[0],models,multiAiMode:"failover",fetcher:syntheticFetcher,liveReading:true,slideCount,styleKey:job.input?.styleKey||"production",writingStyle:job.input?.writingProfile||null,articleTimeoutMs:6_000});
    const finalResult={...result,editoria:job.input?.editoria||topic?.editoria||"Notícias",topicId:topic?.id||job.sourceRef||null,production:{engine:"forma-production-engine",version:"0.9.7",jobId:job.id,evidenceId:evidence.id,sourceType:job.sourceType,readingQuality:evidence?.reading?.quality||0},evidencePack:{id:evidence.id,contract:evidence.contract,sourceName:evidence.sourceName,url:evidence.url,canonicalUrl:evidence.canonicalUrl,title:evidence.title,wordCount:evidence.wordCount,reading:evidence.reading,facts:evidence.facts,entities:evidence.entities,numbers:evidence.numbers,dates:evidence.dates,images:evidence.images}};
    job=await updateJob(db,jobId,{status:"ready",stage:"ready",progress:100,result:finalResult,error:null});await event(db,jobId,"ready","completed",`Conteúdo pronto · ${result.slides?.length||0} slides`,{quality:result?.qualityGate?.score,confidence:result?.confidence?.score});return job;
  }catch(error){await updateJob(db,jobId,{status:"failed",stage:"generating",progress:100,error:error?.message||String(error)});await event(db,jobId,"generating","failed",error?.message||String(error));throw error;}
}

export async function startProductionPipeline(env,jobId,{force=false,ctx=null}={}){
  const db=env.DB;let job=await getProductionJob(db,jobId);if(!job)throw new Error("Produção não encontrada.");
  const readQueue=queueForRead(env);
  if(readQueue?.send){
    try{await readQueue.send({type:"production-read",jobId,force:Boolean(force)});job=await updateJob(db,jobId,{status:"queued",stage:"reading",progress:5});await event(db,jobId,"reading","queued","Enviado para ARTICLE_READ_QUEUE",{dedicated:Boolean(env.ARTICLE_READ_QUEUE)});return job;}
    catch(error){await event(db,jobId,"reading","completed_fallback","ARTICLE_READ_QUEUE indisponível; execução de contingência",{error:String(error?.message||error).slice(0,180)}).catch(()=>null);job=await updateJob(db,jobId,{status:"running",stage:"reading",progress:7,fallbackLevel:1,error:null});}
  }
  const task=(async()=>{const read=await processProductionRead(env,jobId,{force});if(read.status!=="failed"){const carouselQueue=queueForCarousel(env);if(carouselQueue?.send){try{await carouselQueue.send({type:"production-generate",jobId});}catch{await processProductionGenerate(env,jobId);}}else await processProductionGenerate(env,jobId);}})();
  if(ctx?.waitUntil){ctx.waitUntil(task.catch(()=>null));return updateJob(db,jobId,{status:"running",stage:"reading",progress:7,fallbackLevel:1});}
  await task;return getProductionJob(db,jobId);
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

export async function productionBundle(db,id){
  const job=await getProductionJob(db,id);if(!job)return null;const evidence=job.evidenceId?await getEvidencePackage(db,job.evidenceId):null;const events=(await db.prepare("SELECT stage,status,detail,metadata_json,created_at FROM production_stage_events WHERE job_id=? ORDER BY created_at ASC LIMIT 80").bind(id).all())?.results||[];
  return {job,evidence:job.status==="ready"?evidence:evidence?{id:evidence.id,contract:evidence.contract,sourceName:evidence.sourceName,title:evidence.title,url:evidence.url,canonicalUrl:evidence.canonicalUrl,wordCount:evidence.wordCount,reading:evidence.reading,images:evidence.images}:null,events:events.map((x)=>({stage:x.stage,status:x.status,detail:x.detail,metadata:parseJson(x.metadata_json,{}),createdAt:x.created_at}))};
}

export async function retryProductionJob(env,id,{ctx=null,stage=null}={}){
  const job=await getProductionJob(env.DB,id);if(!job)throw new Error("Produção não encontrada.");
  if(stage==="generate"&&job.evidenceId){await updateJob(env.DB,id,{status:"queued",stage:"generating",progress:52,error:null});const q=queueForCarousel(env);if(q?.send)await q.send({type:"production-generate",jobId:id});else{const task=processProductionGenerate(env,id);if(ctx?.waitUntil)ctx.waitUntil(task.catch(()=>null));else await task;}return getProductionJob(env.DB,id);}
  await updateJob(env.DB,id,{status:"queued",stage:"reading",progress:3,error:null});return startProductionPipeline(env,id,{force:true,ctx});
}

export async function generateProductionImage(env,{prompt,width=1024,height=1024}={}){
  const text=plainText(prompt).slice(0,1600);if(text.length<8)throw new Error("Descreva a imagem que deseja gerar.");if(!env.AI?.run)throw new Error("Workers AI não está disponível.");
  const model=env.FORMA_IMAGE_MODEL||"@cf/black-forest-labs/flux-1-schnell";
  const result=await env.AI.run(model,{prompt:text,width:Math.max(512,Math.min(1536,Number(width)||1024)),height:Math.max(512,Math.min(1536,Number(height)||1024)),num_steps:4});
  if(result instanceof ReadableStream || result instanceof ArrayBuffer || ArrayBuffer.isView(result))return {model,body:result};
  if(result?.image){const raw=String(result.image);const bytes=Uint8Array.from(atob(raw.replace(/^data:image\/[a-z+]+;base64,/i,"")),c=>c.charCodeAt(0));return {model,body:bytes};}
  throw new Error("O modelo de imagem não retornou bytes utilizáveis.");
}
