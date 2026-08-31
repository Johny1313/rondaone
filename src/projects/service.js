import { parseCookies, SESSION_COOKIE_NAME, sha256Hex } from '../ronda/v285/profile.js';
import { getUserBySessionHash } from '../ronda/v285/database.js';
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



function normalizeVisualAsset(asset={}){
  const url=clean(asset?.url || '', 2000);
  if(!/^https?:\/\//i.test(url)) return null;
  return {
    url,
    origin: clean(asset?.origin || 'publisher', 60),
    method: clean(asset?.method || '', 60),
    caption: clean(asset?.caption || '', 500),
    alt: clean(asset?.alt || '', 300),
    credit: clean(asset?.credit || '', 300),
    creditConfidence: clean(asset?.creditConfidence || 'low', 20),
    sourceName: clean(asset?.sourceName || '', 120),
    articleUrl: clean(asset?.articleUrl || '', 2000),
    autoUseAllowed: Boolean(asset?.autoUseAllowed),
  };
}

function normalizeArticleVisuals(input={}){
  const visuals=input?.articleVisuals || input?.carousel?.articleVisuals || {};
  const primary=normalizeVisualAsset(visuals?.primary);
  const alternatives=[];
  const seen=new Set(primary ? [primary.url] : []);
  for(const item of Array.isArray(visuals?.alternatives) ? visuals.alternatives : []){
    const normalized=normalizeVisualAsset(item);
    if(!normalized || seen.has(normalized.url)) continue;
    seen.add(normalized.url);
    alternatives.push(normalized);
    if(alternatives.length>=12) break;
  }
  const total=Number(visuals?.totalCandidates) || (primary ? 1 : 0) + alternatives.length;
  return {
    primary,
    alternatives,
    totalCandidates: total,
    canAutoUsePrimary: Boolean(visuals?.canAutoUsePrimary ?? primary?.autoUseAllowed),
    creditRequired: Boolean(visuals?.creditRequired),
    policy: visuals?.policy && typeof visuals.policy==='object' ? visuals.policy : { mode:'multi-image-per-carousel', useWithoutCredit:false, aiFallbackRecommended:false, freeBankFallback:'wikimedia-commons' },
  };
}

function buildSlideVisualAssignments(slides, articleVisuals){
  const library=[articleVisuals?.primary, ...(Array.isArray(articleVisuals?.alternatives)?articleVisuals.alternatives:[])].filter(Boolean);
  if(!library.length) return slides;
  let cursor=0;
  return slides.map((slide)=>{
    if(/^CTA$/i.test(String(slide?.role || ''))) return { ...slide, visual:null };
    const asset=library[cursor % library.length];
    cursor += 1;
    return {
      ...slide,
      visual:{
        strategy:'article-image',
        asset,
        sourceLabel:'Fonte da foto',
        creditText: clean(asset?.credit || '', 300),
        showCredit: Boolean(asset?.credit),
        separateLayers:true,
        editable:true,
      }
    };
  });
}

function semanticRoleType(role,index,total){
  const key=String(role||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/titulo principal|capa|cover|abertura/.test(key)) return 'cover';
  if(/cta|encerramento|fechamento|conclusao/.test(key)) return 'closing';
  if(/citacao|quote/.test(key)) return 'quote';
  if(/estatistica|numero|dado|indicador/.test(key)) return 'statistic';
  return index===0&&total>1?'cover':'content';
}

function buildSemanticContentModel({title,editoria,slides,verificationLinks,articleVisuals}){
  const sourceNames=[...new Set((verificationLinks||[]).map(x=>clean(x?.sourceName||'',120)).filter(Boolean))];
  const source=sourceNames.length?`Fonte: ${sourceNames.slice(0,3).join(' · ')}`:'Origem verificada na Ronda Editorial';
  const images=[articleVisuals?.primary,...(articleVisuals?.alternatives||[])].filter(Boolean).map(asset=>({
    url:asset.url,credit:asset.credit||'',sourceName:asset.sourceName||'',articleUrl:asset.articleUrl||''
  }));
  return {
    version:1,
    contract:'ronda-content-model-v1',
    title:clean(title||'Carrossel da Ronda',240),
    editoria:clean(editoria||'',80),
    source,
    images,
    slides:(slides||[]).map((slide,index)=>({
      index,
      number:Number(slide?.number)||index+1,
      role:clean(slide?.role||`Slide ${index+1}`,80),
      roleType:semanticRoleType(slide?.role,index,slides.length),
      title:clean(slide?.title||'',180),
      subtitle:clean(slide?.subtitle||slide?.body||'',700),
      body:clean(slide?.body||slide?.subtitle||'',700),
      cta:/^CTA$/i.test(String(slide?.role||''))?clean(slide?.subtitle||slide?.body||'',700):clean(slide?.cta||'',300),
      source,
      editoria:clean(editoria||'',80),
      image:clean(slide?.visual?.asset?.url||'',2000),
      imageCredit:clean(slide?.visual?.creditText||slide?.visual?.asset?.credit||'',300),
      imageSource:clean(slide?.visual?.asset?.sourceName||'',120),
    })),
  };
}

function collectVisualCredits(articleVisuals){
  const library=[articleVisuals?.primary, ...(Array.isArray(articleVisuals?.alternatives)?articleVisuals.alternatives:[])].filter(Boolean);
  const output=[];
  const seen=new Set();
  for(const item of library){
    const key=`${item.url}|${item.credit}|${item.sourceName}`;
    if(seen.has(key)) continue;
    seen.add(key);
    output.push({
      url:item.url,
      sourceName: clean(item.sourceName || '', 120),
      sourceLabel:'Fonte da foto',
      credit: clean(item.credit || '', 300),
      creditConfidence: clean(item.creditConfidence || 'low', 20),
      showCredit:Boolean(item.credit),
    });
  }
  return output;
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
  let slides=(carousel.slides || input.slides || []).slice(0,15).map((s,i)=>({
    number:Number(s?.number)||i+1,
    role:clean(s?.role || `Slide ${i+1}`,80),
    title:clean(s?.title || '',180),
    subtitle:clean(s?.subtitle || s?.body || '',700),
    visual: s?.visual && typeof s.visual==='object' ? {
      strategy: clean(s.visual.strategy || 'article-image', 60),
      asset: normalizeVisualAsset(s.visual.asset),
      sourceLabel: clean(s.visual.sourceLabel || 'Fonte da foto', 80),
      creditText: clean(s.visual.creditText || '', 300),
      showCredit: Boolean(s.visual.showCredit),
      separateLayers: s.visual.separateLayers !== false,
      editable: s.visual.editable !== false,
    } : null,
  }));
  if(!slides.length) throw new Error('O carrossel não possui slides para enviar ao Ronda Design.');
  const articleVisuals=normalizeArticleVisuals(input);
  slides=buildSlideVisualAssignments(slides, articleVisuals);
  const verificationLinks=(carousel.verificationLinks || input.verificationLinks || []).slice(0,20).map(x=>({
    title:clean(x?.title || '',240), sourceName:clean(x?.sourceName || '',120), url:clean(x?.url || '',1200), publishedAt:clean(x?.publishedAt || '',80)
  })).filter(x=>x.url);

  const editorialGate=carousel.editorialGate && typeof carousel.editorialGate==='object'
    ? carousel.editorialGate
    : {};
  const editorialReviewRequired=Boolean(
    input.editorialReviewRequired
    || editorialGate.copyAllowed===false
    || carousel.validation?.reviewRequired
  );

  const projectTitle=clean(topic.title || input.title || carousel.topicTitle || 'Projeto da Ronda',240);
  const projectEditoria=clean(topic.editoria || input.editoria || 'Notícias',80);
  const contentModel=buildSemanticContentModel({title:projectTitle,editoria:projectEditoria,slides,verificationLinks,articleVisuals});

  return {
    contractVersion:'ronda-one-import-v4-semantic-content',
    source:'ronda-editorial',
    sourceVersion:clean(input.sourceVersion || 'ronda-module',80),
    handoffVersion:clean(input.handoffVersion || 'ronda-one-0.7.8-carousel-first',80),
    title:projectTitle,
    editoria:projectEditoria,
    runId:clean(input.runId || '',120),
    topicId:clean(topic.id || input.topicId || '',120),
    generatedAt:new Date().toISOString(),
    slides,
    contentModel,
    questions:carousel.questions || {},
    entities:carousel.entities || {},
    reading:carousel.reading || {},
    facts:Array.isArray(carousel.facts)?carousel.facts.slice(0,80):[],
    verificationLinks,
    disclaimer:clean(carousel.disclaimer || 'Revise e confirme as informações nas fontes originais antes de publicar.',1000),
    editorialGate,
    editorialReviewRequired,
    editorialStatus:clean(
      carousel.editorialStatus
      || input.editorialStatus
      || (editorialReviewRequired?'review-required':'ready-for-design'),
      80
    ),
    visualPrompt:null,
    articleVisuals,
    assetCredits: collectVisualCredits(articleVisuals),
    designImportHints:{
      splitElementsIntoLayers:true,
      separateImageLayer:true,
      separateTextLayers:true,
      separateCreditLayer:true,
      preferredImageSource:'article-visuals-or-free-bank',
      imagePlacement:'per-slide',
      creditHandling:'show-when-available',
      semanticContentModel:true,
      smartTemplateSlots:['TITLE','SUBTITLE','BODY','ROLE','SOURCE','IMAGE','IMAGE_CREDIT','CTA','SLIDE_NUMBER','EDITORIA'],
    },
    imagePolicy:{mode:'non-generative',status:articleVisuals.primary||articleVisuals.alternatives?.length?'article-visuals-attached':'free-bank-available',provider:'publisher-or-wikimedia-commons',sourceLabel:'Fonte da foto',creditHandling:'show-when-available',ai:false},
  };
}


async function requireProjectUser(request, env){
  if(!env.DB) throw new Error("Binding D1 DB não configurado");
  const token=parseCookies(request.headers.get('Cookie'))[SESSION_COOKIE_NAME];
  if(!token)return null;
  const hash=await sha256Hex(token);
  return getUserBySessionHash(env.DB,hash);
}

function normalizeFormaProject(input={}){
  if(!Array.isArray(input?.artboards)||!input.artboards.length) throw new Error('O projeto FORMA não possui pranchetas para salvar.');
  return {
    ...input,
    contractVersion:'forma-design-project-v1',
    source:'forma-design',
    title:clean(input.title||input.docTitle||'Projeto FORMA',240),
    savedAt:new Date().toISOString(),
  };
}

async function createFromDesign(request, env){
  const input=await request.json().catch(()=>null);if(!input)return json({ok:false,error:'Payload inválido'},400);
  let project;try{project=normalizeFormaProject(input);}catch(error){return json({ok:false,error:error.message},400);}
  await ensureTable(env.DB);const id=crypto.randomUUID(),now=new Date().toISOString();
  await env.DB.prepare(`INSERT INTO ${PROJECT_TABLE}(id,source,title,payload,created_at,updated_at) VALUES(?,?,?,?,?,?)`).bind(id,'forma-design',project.title,JSON.stringify(project),now,now).run();
  return json({ok:true,id,project,createdAt:now,updatedAt:now},201);
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
  let payload=input;if(Array.isArray(input?.artboards)&&input.artboards.length){try{payload=normalizeFormaProject(input);}catch(error){return json({ok:false,error:error.message},400);}}
  const now=new Date().toISOString(); const title=clean(payload.title || payload.docTitle || 'Projeto RONDA ONE',240);
  const result=await env.DB.prepare(`UPDATE ${PROJECT_TABLE} SET title=?, payload=?, updated_at=? WHERE id=?`).bind(title,JSON.stringify(payload),now,id).run();
  if(!result.meta?.changes) return json({ok:false,error:'Projeto não encontrado'},404);
  return json({ok:true,id,updatedAt:now});
}

export async function handleProjectsApi(request, env){
  const url=new URL(request.url);
  if(!env.DB) return json({ok:false,code:'DB_BINDING_REQUIRED',error:'Binding D1 DB não configurado'},503);
  const user=await requireProjectUser(request,env).catch(()=>null);if(!user)return json({ok:false,code:'AUTH_REQUIRED',error:'Sessão editorial necessária para acessar Projetos.'},401);
  if(url.pathname==='/api/projects/from-ronda' && request.method==='POST') return createFromRonda(request,env);
  if(url.pathname==='/api/projects' && request.method==='POST') return createFromDesign(request,env);
  if(url.pathname==='/api/projects' && request.method==='GET') return listProjects(env);
  const m=/^\/api\/projects\/([a-f0-9-]{20,80})$/i.exec(url.pathname);
  if(m && request.method==='GET') return getProject(m[1],env);
  if(m && (request.method==='PUT'||request.method==='POST')) return saveProject(m[1],request,env);
  return json({ok:false,error:'Endpoint de projetos não encontrado'},404);
}
