import { plainText } from "../ronda/v285/parser.js";

export const ENGINE_BASELINE_VERSION = "0.9.7.5.6";
export const READER_VERSION = "hybrid-reader-v1.1-band-v2";
export const EVIDENCE_VERSION = "ronda-evidence-pack-v1-reader-v1.1";
export const CAROUSEL_PIPELINE_VERSION = "carousel-stability-baseline-v1.1";

const BLOCKED_PATTERNS = [
  { code:"BOT_PROTECTION", re:/verify you are human|captcha|cf-chl-|checking your browser|attention required|bot detection|access denied/i },
  { code:"PAYWALL", re:/assine para continuar|conteúdo exclusivo para assinantes|continue lendo com uma assinatura|subscribe to continue|subscriber-only|subscription required/i },
];

function htmlToText(html){
  return plainText(String(html||"")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi," ")
    .replace(/<!--[\s\S]*?-->/g," ")
    .replace(/<[^>]+>/g," "));
}

function articleLikeText(html){
  const source=String(html||"");
  const blocks=[];
  for(const re of [
    /<article\b[^>]*>([\s\S]*?)<\/article>/gi,
    /<main\b[^>]*>([\s\S]*?)<\/main>/gi,
    /<[^>]+role=["']main["'][^>]*>([\s\S]*?)<\/[^>]+>/gi,
  ]){
    let m;
    while((m=re.exec(source))&&blocks.length<6)blocks.push(htmlToText(m[1]));
  }
  return plainText(blocks.join("\n\n"));
}

export function classifyRenderedHtml(html){
  const source=String(html||"");
  const text=htmlToText(source);
  const articleText=articleLikeText(source);
  const target=articleText||text;
  const contentChars=target.length;
  const paragraphCount=(source.match(/<p\b/gi)||[]).length;
  const hasArticleSignal=/<article\b|<main\b|role=["']main["']/i.test(source);
  const matchedBlock=BLOCKED_PATTERNS.find(({re})=>re.test(`${source.slice(0,12000)}\n${text.slice(0,4000)}`));
  if(matchedBlock)return {classification:"blocked",blocked:true,reason:matchedBlock.code,contentChars,paragraphCount,hasArticleSignal};
  if(contentChars>=6500&&paragraphCount>=8)return {classification:"excellent",blocked:false,reason:null,contentChars,paragraphCount,hasArticleSignal};
  if(contentChars>=2200&&paragraphCount>=4)return {classification:"good",blocked:false,reason:null,contentChars,paragraphCount,hasArticleSignal};
  if(contentChars>=700)return {classification:"partial",blocked:false,reason:null,contentChars,paragraphCount,hasArticleSignal};
  return {classification:contentChars>=180?"insufficient":"not-rendered",blocked:false,reason:contentChars>=180?"ARTICLE_INSUFFICIENT":"CONTENT_NOT_RENDERED",contentChars,paragraphCount,hasArticleSignal};
}

export function browserQuickActionAvailable(env){
  return Boolean(env?.BROWSER&&typeof env.BROWSER.quickAction==="function");
}

async function decodeBrowserResponse(response,url,startedAt){
  let html="";
  let browserMsUsed=0;
  if(response&&typeof response.text==="function"){
    browserMsUsed=Number(response.headers?.get?.("x-browser-ms-used"))||0;
    const raw=await response.text();
    if(typeof response.ok==="boolean"&&!response.ok){
      const error=new Error(`BROWSER_HTTP_${response.status||"ERROR"}: ${plainText(raw).slice(0,180)}`);
      error.code=`BROWSER_HTTP_${response.status||"ERROR"}`;
      throw error;
    }
    const type=String(response.headers?.get?.("content-type")||"");
    if(/json/i.test(type)||/^\s*[{[]/.test(raw)){
      try{
        const parsed=JSON.parse(raw);
        if(parsed?.success===false){
          const error=new Error(`BROWSER_API_ERROR: ${plainText(parsed?.errors?.[0]?.message||parsed?.error||"success=false").slice(0,180)}`);
          error.code="BROWSER_API_ERROR";
          throw error;
        }
        html=typeof parsed?.result==="string"
          ? parsed.result
          : typeof parsed?.result?.content==="string"
            ? parsed.result.content
            : typeof parsed?.content==="string"
              ? parsed.content
              : "";
      }catch(error){
        if(error?.code==="BROWSER_API_ERROR")throw error;
        if(raw.trim().startsWith("<"))html=raw;
        else{
          const invalid=new Error(`BROWSER_INVALID_RESPONSE: ${plainText(raw).slice(0,160)}`);
          invalid.code="BROWSER_INVALID_RESPONSE";
          throw invalid;
        }
      }
    }else html=raw;
  }else if(typeof response==="string")html=response;
  else if(typeof response?.result==="string")html=response.result;
  else if(typeof response?.html==="string")html=response.html;

  if(!html||html.length<120){
    const error=new Error("CONTENT_NOT_RENDERED: Browser Run não retornou HTML útil");
    error.code="CONTENT_NOT_RENDERED";
    throw error;
  }
  return {html,url,durationMs:Date.now()-startedAt,browserMsUsed};
}

export async function browserQuickActionArticle(env,url,{timeoutMs=7_500,mode="standard"}={}){
  if(!browserQuickActionAvailable(env)){
    const error=new Error("BROWSER_UNAVAILABLE: Browser Run não configurado");
    error.code="BROWSER_UNAVAILABLE";
    throw error;
  }
  const startedAt=Date.now();
  const totalBudget=Math.max(4_500,Math.min(14_000,Number(timeoutMs)||7_500));
  const stabilizationMs=mode==="deep"
    ? Math.max(1_200,Math.min(2_500,Math.floor(totalBudget*0.18)))
    : Math.max(650,Math.min(1_200,Math.floor(totalBudget*0.12)));
  const navigationBudget=Math.max(3_000,totalBudget-stabilizationMs-350);

  const action=env.BROWSER.quickAction("content",{
    url,
    gotoOptions:{waitUntil:"domcontentloaded",timeout:navigationBudget},
    waitForTimeout:stabilizationMs,
    rejectResourceTypes:["image","media","font","stylesheet"],
    setJavaScriptEnabled:true,
  });
  const guard=new Promise((_,reject)=>setTimeout(()=>{
    const error=new Error("BROWSER_TIMEOUT: Browser Run excedeu o budget da leitura");
    error.code="BROWSER_TIMEOUT";
    reject(error);
  },totalBudget));

  const decoded=await decodeBrowserResponse(await Promise.race([action,guard]),url,startedAt);
  const sufficiency=classifyRenderedHtml(decoded.html);
  if(sufficiency.blocked){
    const error=new Error(`${sufficiency.reason}: página bloqueou a leitura editorial`);
    error.code=sufficiency.reason;
    error.contentSufficiency=sufficiency;
    throw error;
  }
  return {
    ...decoded,
    readerStrategy:"browser-dom-stabilized",
    waitUntil:"domcontentloaded",
    stabilizationMs,
    contentSufficiency:sufficiency,
  };
}
