const PROJECT_TABLE = 'ronda_one_projects';

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' } });
}

function clean(value, max=2000){ return String(value ?? '').replace(/\s+/g,' ').trim().slice(0,max); }

async function ensureTable(db){
  if(!db) return false;
  await db.prepare(`CREATE TABLE IF NOT EXISTS ${PROJECT_TABLE} (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_${PROJECT_TABLE}_updated ON ${PROJECT_TABLE}(updated_at DESC)`).run();
  return true;
}

function shortVisualPrompt(topic, carousel){
  const title=clean(topic?.title || carousel?.topicTitle || 'notícia em destaque',180);
  const who=clean(carousel?.questions?.who || '',130);
  const where=clean(carousel?.questions?.where || '',100);
  const theme=(carousel?.entities?.themes || []).slice(0,3).map(x=>clean(x,60)).filter(Boolean).join(', ');
  let subject=[title, who && `involving ${who}`, where && `in ${where}`, theme && `context: ${theme}`].filter(Boolean).join('. ');
  subject=subject.slice(0,240);
  return clean(`Documentary news photograph illustrating ${subject}. Neutral real-world setting, natural light, realistic detail, negative space for layout, no text, no watermark.`,340);
}

function normalizeProject(input={}){
  const topic=input.topic || {};
  const carousel=input.carousel || {};
  const slides=(carousel.slides || input.slides || []).slice(0,15).map((s,i)=>({
    number:Number(s?.number)||i+1,
    role:clean(s?.role || `Slide ${i+1}`,80),
    title:clean(s?.title || '',180),
    subtitle:clean(s?.subtitle || s?.body || '',700),
  }));
  if(!slides.length) throw new Error('O carrossel não possui slides para enviar ao Ronda Design.');
  const verificationLinks=(carousel.verificationLinks || input.verificationLinks || []).slice(0,20).map(x=>({
    title:clean(x?.title || '',240), sourceName:clean(x?.sourceName || '',120), url:clean(x?.url || '',1200), publishedAt:clean(x?.publishedAt || '',80)
  })).filter(x=>x.url);
  return {
    contractVersion:'ronda-one-import-v1',
    source:'ronda-editorial',
    sourceVersion:clean(input.sourceVersion || 'ronda-module',80),
    title:clean(topic.title || input.title || carousel.topicTitle || 'Projeto da Ronda',240),
    editoria:clean(topic.editoria || input.editoria || 'Notícias',80),
    runId:clean(input.runId || '',120),
    topicId:clean(topic.id || input.topicId || '',120),
    generatedAt:new Date().toISOString(),
    slides,
    questions:carousel.questions || {},
    entities:carousel.entities || {},
    reading:carousel.reading || {},
    verificationLinks,
    disclaimer:clean(carousel.disclaimer || 'Revise e confirme as informações nas fontes originais antes de publicar.',1000),
    visualPrompt:shortVisualPrompt(topic,carousel),
    imagePolicy:{mode:'one-background-per-carousel',status:'not-generated',provider:'Workers AI Free'},
  };
}

async function createFromRonda(request, env){
  const input=await request.json().catch(()=>null);
  if(!input) return json({ok:false,error:'Payload inválido'},400);
  let project;
  try{ project=normalizeProject(input); }catch(err){ return json({ok:false,error:err.message},400); }
  if(!env.DB) return json({ok:false,code:'DB_BINDING_REQUIRED',error:'Binding D1 DB não configurado. O navegador pode usar o handoff local como contingência.'},503);
  await ensureTable(env.DB);
  const id=crypto.randomUUID(); const now=new Date().toISOString();
  await env.DB.prepare(`INSERT INTO ${PROJECT_TABLE}(id,source,title,payload,created_at,updated_at) VALUES(?,?,?,?,?,?)`)
    .bind(id,project.source,project.title,JSON.stringify(project),now,now).run();
  return json({ok:true,id,project});
}

async function getProject(id, env){
  if(!env.DB) return json({ok:false,code:'DB_BINDING_REQUIRED',error:'Binding D1 DB não configurado'},503);
  await ensureTable(env.DB);
  const row=await env.DB.prepare(`SELECT id,source,title,payload,created_at,updated_at FROM ${PROJECT_TABLE} WHERE id=?`).bind(id).first();
  if(!row) return json({ok:false,error:'Projeto não encontrado'},404);
  let project={}; try{project=JSON.parse(row.payload)}catch{}
  return json({ok:true,id:row.id,createdAt:row.created_at,updatedAt:row.updated_at,project});
}

async function listProjects(env){
  if(!env.DB) return json({ok:false,code:'DB_BINDING_REQUIRED',error:'Binding D1 DB não configurado',projects:[]},503);
  await ensureTable(env.DB);
  const result=await env.DB.prepare(`SELECT id,source,title,created_at,updated_at FROM ${PROJECT_TABLE} ORDER BY updated_at DESC LIMIT 50`).all();
  return json({ok:true,projects:(result.results||[]).map(r=>({id:r.id,source:r.source,title:r.title,createdAt:r.created_at,updatedAt:r.updated_at}))});
}

async function saveProject(id, request, env){
  if(!env.DB) return json({ok:false,code:'DB_BINDING_REQUIRED',error:'Binding D1 DB não configurado'},503);
  await ensureTable(env.DB);
  const input=await request.json().catch(()=>null); if(!input) return json({ok:false,error:'Payload inválido'},400);
  const now=new Date().toISOString(); const title=clean(input.title || input.docTitle || 'Projeto RONDA ONE',240);
  const result=await env.DB.prepare(`UPDATE ${PROJECT_TABLE} SET title=?, payload=?, updated_at=? WHERE id=?`).bind(title,JSON.stringify(input),now,id).run();
  if(!result.meta?.changes) return json({ok:false,error:'Projeto não encontrado'},404);
  return json({ok:true,id,updatedAt:now});
}

export async function handleProjectsApi(request, env){
  const url=new URL(request.url);
  if(url.pathname==='/api/projects/from-ronda' && request.method==='POST') return createFromRonda(request,env);
  if(url.pathname==='/api/projects' && request.method==='GET') return listProjects(env);
  const m=/^\/api\/projects\/([a-f0-9-]{20,80})$/i.exec(url.pathname);
  if(m && request.method==='GET') return getProject(m[1],env);
  if(m && (request.method==='PUT'||request.method==='POST')) return saveProject(m[1],request,env);
  return json({ok:false,error:'Endpoint de projetos não encontrado'},404);
}
