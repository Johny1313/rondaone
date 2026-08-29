import { extractArticleFromHtml, validateArticleUrl } from "../ronda/v285/article-reader.js";
import { extractArticleVisualsFromHtml } from "../ronda/article-visuals.js";
import { plainText, stableHash } from "../ronda/v285/parser.js";

const MAX_HTML_BYTES = 4_500_000;
const DEFAULT_TIMEOUT_MS = 8_000;
const MIN_USEFUL_WORDS = 45;
const MAX_ARTICLE_CHARS = 24_000;

function wordCount(value) {
  return plainText(value).split(/\s+/).filter(Boolean).length;
}

function hostname(value) {
  try { return new URL(String(value || "")).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

function absoluteUrl(value, base) {
  try {
    const url = new URL(String(value || "").trim(), base);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    return url.toString();
  } catch { return null; }
}

export function normalizeArticleIdentity(value) {
  try {
    const url = new URL(validateArticleUrl(value));
    url.hash = "";
    const tracking = [...url.searchParams.keys()].filter((key) => /^(?:utm_|fbclid$|gclid$|dclid$|mc_cid$|mc_eid$|igshid$|ref_src$|ref_url$|srsltid$)/i.test(key));
    tracking.forEach((key) => url.searchParams.delete(key));
    url.searchParams.sort();
    return url.toString();
  } catch { return String(value || "").trim(); }
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

function htmlText(value) {
  return plainText(decodeEntities(String(value || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")));
}


function decodeHtmlBuffer(bytes, contentType = "") {
  const headerCharset = /charset\s*=\s*([^;\s]+)/i.exec(contentType)?.[1]?.replace(/["']/g, "");
  const sample = new TextDecoder("windows-1252").decode(bytes.slice(0, 700));
  const declared = /<meta[^>]+charset\s*=\s*["']?([^"'\s/>]+)/i.exec(sample)?.[1]
    || /<meta[^>]+content=["'][^"']*charset=([^"';\s]+)/i.exec(sample)?.[1];
  const raw = String(headerCharset || declared || "utf-8").toLowerCase();
  const charset = ["iso-8859-1","latin1","windows-1252","cp1252"].includes(raw) ? "windows-1252" : "utf-8";
  return new TextDecoder(charset).decode(bytes);
}

function metaContent(html, key) {
  const escaped = String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([\\s\\S]*?)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([\\s\\S]*?)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) return htmlText(match[1]).slice(0, 800);
  }
  return "";
}

function linkedUrl(html, baseUrl, rel) {
  const escaped = String(rel).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tag = new RegExp(`<link[^>]+rel=["'][^"']*${escaped}[^"']*["'][^>]*>`, "i").exec(html)?.[0] || "";
  const href = /\bhref=["']([^"']+)["']/i.exec(tag)?.[1];
  return href ? absoluteUrl(href, baseUrl) : null;
}

function canonicalUrl(html, baseUrl) {
  return linkedUrl(html, baseUrl, "canonical") || baseUrl;
}

function cleanParagraphs(fragment) {
  const paragraphs = [];
  const seen = new Set();
  const re = /<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi;
  let match;
  while ((match = re.exec(fragment)) && paragraphs.length < 180) {
    const text = htmlText(match[1]).replace(/\s+/g, " ").trim();
    if (text.length < 35 || text.length > 2_500) continue;
    if (/^(publicidade|leia também|veja também|assine|newsletter|siga|compartilhe)/i.test(text)) continue;
    const key = text.toLocaleLowerCase("pt-BR");
    if (seen.has(key)) continue;
    seen.add(key);
    paragraphs.push(text);
  }
  return paragraphs.join("\n\n").slice(0, MAX_ARTICLE_CHARS);
}

export const PORTAL_ADAPTERS = Object.freeze([
  { id:"g1", label:"G1/ge", hosts:["g1.globo.com","ge.globo.com"], signals:[/content-text__container/i,/mc-column\s+content-text/i,/article-body/i] },
  { id:"cnn-brasil", label:"CNN Brasil", hosts:["cnnbrasil.com.br"], signals:[/single-content/i,/post-content/i,/article__content/i] },
  { id:"folha", label:"Folha", hosts:["folha.uol.com.br"], signals:[/c-news__body/i,/news__content/i,/article-body/i] },
  { id:"estadao", label:"Estadão", hosts:["estadao.com.br"], signals:[/article-content/i,/content-body/i,/news-body/i] },
  { id:"oglobo", label:"O Globo", hosts:["oglobo.globo.com"], signals:[/content-text__container/i,/article-body/i,/content-body/i] },
  { id:"poder360", label:"Poder360", hosts:["poder360.com.br"], signals:[/the_content/i,/post-content/i,/article-content/i] },
  { id:"agencia-brasil", label:"Agência Brasil", hosts:["agenciabrasil.ebc.com.br"], signals:[/article-content/i,/field--name-body/i,/content-body/i] },
  { id:"metropoles", label:"Metrópoles", hosts:["metropoles.com"], signals:[/post-content/i,/article-content/i,/entry-content/i] },
  { id:"uol", label:"UOL", hosts:["uol.com.br"], signals:[/article-content/i,/text\-content/i,/content-body/i] },
  { id:"infomoney", label:"InfoMoney", hosts:["infomoney.com.br"], signals:[/article-content/i,/post-content/i,/entry-content/i] },
]);

export function portalAdapterForUrl(url) {
  const host = hostname(url);
  return PORTAL_ADAPTERS.find((adapter) => adapter.hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) || null;
}

function adapterExtract(html, url) {
  const adapter = portalAdapterForUrl(url);
  if (!adapter) return null;
  let best = "";
  for (const signal of adapter.signals) {
    const match = signal.exec(html);
    signal.lastIndex = 0;
    if (!match) continue;
    const start = Math.max(0, match.index - 3_000);
    const fragment = html.slice(start, Math.min(html.length, start + 900_000));
    const text = cleanParagraphs(fragment);
    if (wordCount(text) > wordCount(best)) best = text;
  }
  if (wordCount(best) < MIN_USEFUL_WORDS) return null;
  return {
    content: best,
    wordCount: wordCount(best),
    method: `adapter:${adapter.id}`,
    adapter: adapter.id,
    adapterLabel: adapter.label,
  };
}

async function fetchHtml(url, fetcher = fetch, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("scrape-timeout"), Math.max(800, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  try {
    const response = await fetcher(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36 RondaOne/0.9.7.1",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (contentType && !/html|xhtml|text\//i.test(contentType)) throw new Error("A URL não retornou HTML");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const html = decodeHtmlBuffer(bytes.slice(0, MAX_HTML_BYTES), contentType);
    return { html, finalUrl: validateArticleUrl(response.url || url), status: response.status };
  } finally { clearTimeout(timer); }
}

function collectedFallback(item) {
  const candidates = [item?.content, item?.description, item?.summary].map((v) => plainText(v)).filter(Boolean);
  const content = candidates.sort((a,b) => b.length-a.length)[0] || "";
  const words = wordCount(content);
  if (words < 25) return null;
  return {
    ok: true,
    url: String(item?.url || ""),
    canonicalUrl: String(item?.url || ""),
    sourceName: item?.sourceName || item?.collectorName || "Fonte",
    title: plainText(item?.title) || "Notícia sem título",
    subtitle: plainText(item?.description).slice(0, 700),
    author: null,
    publishedAt: item?.publishedAt || null,
    content,
    wordCount: words,
    extractionMethod: "collected-fallback",
    adapter: null,
    contentLevel: words >= 90 ? "summary" : "partial",
    readMode: "partial",
    images: null,
    degraded: true,
    error: null,
  };
}

function collectedArticleFastPath(item) {
  const content = plainText(item?.content || "");
  const words = wordCount(content);
  const route = String(item?.collectionRoute || item?.route || item?.readMode || item?.contentLevel || "").toLowerCase();
  const trustedRoute = /(direct|html|article|publisher|scrap|full)/.test(route);
  if (words < 160 || !trustedRoute) return null;
  const url = normalizeArticleIdentity(item?.url || "");
  return {
    ok:true,
    url,
    canonicalUrl:url,
    sourceName:item?.sourceName || item?.collectorName || hostname(url) || "Fonte",
    title:plainText(item?.title) || "Notícia sem título",
    subtitle:plainText(item?.description || item?.summary).slice(0,700),
    author:plainText(item?.author || item?.byline) || null,
    publishedAt:item?.publishedAt || null,
    content:content.slice(0,MAX_ARTICLE_CHARS),
    wordCount:words,
    extractionMethod:"ronda-collected-article-fastpath",
    adapter:portalAdapterForUrl(url)?.id || null,
    contentLevel:"article",
    readMode:"full-article-cache",
    images:item?.articleVisuals || item?.images || null,
    degraded:false,
    cacheHit:true,
    error:null,
  };
}

function readingQualityScore(record) {
  if (!record?.ok) return 0;
  let score = 20;
  const words = Number(record.wordCount) || 0;
  score += Math.min(45, Math.round(words / 18));
  if (record.title) score += 8;
  if (record.publishedAt) score += 7;
  if (record.author) score += 4;
  if (record.images?.primary || record.images?.alternatives?.length) score += 8;
  if (/^adapter:/.test(record.extractionMethod || "")) score += 5;
  if (record.readMode === "partial") score -= 18;
  return Math.max(0, Math.min(100, score));
}

export async function scrapeArticle(item, {
  fetcher = fetch,
  timeoutMs = 12_000,
  browserFetcher = null,
  allowCollectedFastPath = true,
} = {}) {
  const startedAt = Date.now();
  const inputUrl = normalizeArticleIdentity(item?.url);
  const attempts = [];
  let best = null;

  if (allowCollectedFastPath) {
    const warm = collectedArticleFastPath(item);
    if (warm) {
      warm.readingQuality = readingQualityScore(warm);
      return {...warm, attempts:[{method:warm.extractionMethod,ok:true,wordCount:warm.wordCount,fastPath:true}],durationMs:Date.now()-startedAt};
    }
  }

  const consider = (candidate) => {
    if (!candidate?.ok) return;
    candidate.readingQuality = readingQualityScore(candidate);
    if (!best || candidate.readingQuality > best.readingQuality || (candidate.readingQuality === best.readingQuality && candidate.wordCount > best.wordCount)) best = candidate;
  };

  try {
    const fetched = await fetchHtml(inputUrl, fetcher, Math.min(6_500, timeoutMs));
    const html = fetched.html;
    const finalUrl = fetched.finalUrl;
    const generic = extractArticleFromHtml(html, item);
    let visuals = null;
    try { visuals = extractArticleVisualsFromHtml(html, { articleUrl: finalUrl, resolvedUrl: finalUrl, sourceName:item?.sourceName || item?.collectorName || "" }); } catch {}
    const common = {
      ok:true,
      url: inputUrl,
      canonicalUrl: normalizeArticleIdentity(canonicalUrl(html, finalUrl)),
      resolvedUrl: finalUrl,
      sourceName: item?.sourceName || item?.collectorName || hostname(finalUrl) || "Fonte",
      title: generic.title || metaContent(html,"og:title") || plainText(item?.title) || "Notícia sem título",
      subtitle: generic.description || metaContent(html,"og:description") || metaContent(html,"description") || plainText(item?.description),
      author: generic.byline || metaContent(html,"author") || null,
      publishedAt: generic.publishedAt || item?.publishedAt || null,
      images: visuals,
      readMode:"full",
      contentLevel:"article",
      degraded:false,
      error:null,
    };
    const genericCandidate = { ...common, content:generic.content, wordCount:generic.wordCount, extractionMethod:`generic:${generic.method || "html"}`, adapter:null };
    attempts.push({method:genericCandidate.extractionMethod,ok:generic.wordCount>=MIN_USEFUL_WORDS,wordCount:generic.wordCount});
    if (generic.wordCount >= MIN_USEFUL_WORDS) consider(genericCandidate);

    const adapted = adapterExtract(html, finalUrl);
    if (adapted) {
      const adapterCandidate = { ...common, content:adapted.content, wordCount:adapted.wordCount, extractionMethod:adapted.method, adapter:adapted.adapter };
      attempts.push({method:adapted.method,ok:true,wordCount:adapted.wordCount});
      consider(adapterCandidate);
    }

    if ((!best || best.wordCount < 90) && Date.now() - startedAt < timeoutMs - 1_500) {
      const amp = linkedUrl(html, finalUrl, "amphtml");
      if (amp && amp !== finalUrl) {
        try {
          const ampFetched = await fetchHtml(amp, fetcher, Math.min(4_000, Math.max(1_000, timeoutMs - (Date.now()-startedAt))));
          const ampGeneric = extractArticleFromHtml(ampFetched.html, item);
          let ampVisuals = visuals;
          try { ampVisuals = extractArticleVisualsFromHtml(ampFetched.html,{articleUrl:ampFetched.finalUrl,resolvedUrl:ampFetched.finalUrl,sourceName:common.sourceName}) || visuals; } catch {}
          const ampCandidate = {...common,canonicalUrl:canonicalUrl(ampFetched.html,finalUrl),content:ampGeneric.content,wordCount:ampGeneric.wordCount,images:ampVisuals,extractionMethod:`amp:${ampGeneric.method || "html"}`};
          attempts.push({method:ampCandidate.extractionMethod,ok:ampCandidate.wordCount>=MIN_USEFUL_WORDS,wordCount:ampCandidate.wordCount});
          if (ampCandidate.wordCount>=MIN_USEFUL_WORDS) consider(ampCandidate);
        } catch (error) { attempts.push({method:"amp",ok:false,error:String(error?.message||error).slice(0,120)}); }
      }
    }
  } catch (error) {
    attempts.push({method:"direct-html",ok:false,error:String(error?.message||error).slice(0,160)});
  }

  if (!best) consider(collectedFallback(item));

  // Browser rendering é deliberadamente último recurso. Só é executado quando um
  // browserFetcher explícito estiver configurado; a v0.9.7 não tenta contornar paywall/CAPTCHA.
  if ((!best || best.readingQuality < 55) && typeof browserFetcher === "function") {
    try {
      const rendered = await browserFetcher(inputUrl);
      const html = String(rendered?.html || "");
      if (html) {
        const generic = extractArticleFromHtml(html,item);
        const candidate = {
          ok:generic.wordCount>=MIN_USEFUL_WORDS,url:inputUrl,canonicalUrl:rendered?.url||inputUrl,
          sourceName:item?.sourceName||item?.collectorName||hostname(inputUrl)||"Fonte",title:generic.title||item?.title||"Notícia sem título",
          subtitle:generic.description||item?.description||"",author:generic.byline||null,publishedAt:generic.publishedAt||item?.publishedAt||null,
          content:generic.content,wordCount:generic.wordCount,extractionMethod:`browser:${generic.method||"html"}`,adapter:null,contentLevel:"article",readMode:"full",images:null,degraded:false,error:null,
        };
        attempts.push({method:candidate.extractionMethod,ok:candidate.ok,wordCount:candidate.wordCount});
        if(candidate.ok)consider(candidate);
      }
    } catch(error){attempts.push({method:"browser",ok:false,error:String(error?.message||error).slice(0,120)});}
  }

  if (!best) {
    return {ok:false,url:inputUrl,canonicalUrl:inputUrl,sourceName:item?.sourceName||item?.collectorName||hostname(inputUrl)||"Fonte",title:item?.title||"Notícia sem título",content:"",wordCount:0,readingQuality:0,readMode:"failed",extractionMethod:null,adapter:null,attempts,error:attempts.at(-1)?.error||"Conteúdo principal indisponível"};
  }
  return {...best,attempts,durationMs:Date.now()-startedAt,readingQuality:readingQualityScore(best)};
}

function sentenceFacts(text, limit = 32) {
  const sentences = plainText(text).split(/(?<=[.!?])\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ0-9])/).map((s)=>s.trim()).filter((s)=>s.length>=35&&s.length<=500);
  const seen=new Set();const rows=[];
  for(const sentence of sentences){
    const key=sentence.toLocaleLowerCase("pt-BR").replace(/\W+/g," ").trim();
    if(!key||seen.has(key))continue;seen.add(key);
    const numeric=/\d/.test(sentence);const named=(sentence.match(/\b[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][\p{L}-]{2,}\b/gu)||[]).length;
    rows.push({text:sentence,score:(numeric?4:0)+Math.min(4,named)+Math.min(4,sentence.length/120)});
  }
  return rows.sort((a,b)=>b.score-a.score).slice(0,limit).map((row,index)=>({id:`E${String(index+1).padStart(2,"0")}`,evidence:row.text}));
}

function extractNumbers(text) {
  const matches=plainText(text).match(/\b(?:R\$\s*)?\d[\d.,]*(?:\s*(?:%|milh(?:ão|ões)|bilh(?:ão|ões)|mil|km|kg|anos?|meses?|dias?))?\b/giu)||[];
  return [...new Set(matches.map((x)=>x.trim()))].slice(0,40);
}

function extractDates(text) {
  const matches=plainText(text).match(/\b(?:\d{1,2}\s+de\s+[a-zç]+(?:\s+de\s+\d{4})?|\d{1,2}\/\d{1,2}\/\d{2,4}|20\d{2})\b/giu)||[];
  return [...new Set(matches.map((x)=>x.trim()))].slice(0,30);
}

function extractEntities(text) {
  const matches=plainText(text).match(/\b(?:[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][\p{L}'’-]{2,})(?:\s+(?:da|de|do|dos|das|e|[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][\p{L}'’-]{2,})){0,4}\b/gu)||[];
  return [...new Set(matches.map((x)=>x.trim()).filter((x)=>x.length>=4))].slice(0,40);
}

export function buildEvidencePack(record, { sourceType="url", sourceRef=null, topicId=null } = {}) {
  const now=new Date().toISOString();
  const content=plainText(record?.content).slice(0,MAX_ARTICLE_CHARS);
  const facts=sentenceFacts(content);
  return {
    id:`evidence-${stableHash(`${record?.canonicalUrl||record?.url||sourceRef}|${content.slice(0,1200)}`)}`,
    contract:"ronda-evidence-pack-v1",
    sourceType,
    sourceRef:sourceRef||record?.url||null,
    topicId:topicId||null,
    sourceName:record?.sourceName||"Fonte",
    url:record?.url||null,
    canonicalUrl:record?.canonicalUrl||record?.url||null,
    resolvedUrl:record?.resolvedUrl||record?.canonicalUrl||record?.url||null,
    title:record?.title||"Notícia sem título",
    subtitle:record?.subtitle||"",
    author:record?.author||null,
    publishedAt:record?.publishedAt||null,
    articleText:content,
    wordCount:Number(record?.wordCount)||wordCount(content),
    facts,
    entities:extractEntities(content),
    numbers:extractNumbers(content),
    dates:extractDates(content),
    images:record?.images||null,
    reading:{method:record?.extractionMethod||record?.readMode||"unknown",adapter:record?.adapter||null,quality:Number(record?.readingQuality)||0,mode:record?.readMode||"unknown",degraded:Boolean(record?.degraded),resolvedUrl:record?.resolvedUrl||record?.canonicalUrl||record?.url||null,attempts:record?.attempts||[],durationMs:Number(record?.durationMs)||0},
    createdAt:now,
  };
}

export async function scrapeTopicToEvidence(topic, options = {}) {
  const items=(Array.isArray(topic?.items)?topic.items:[]).filter((item)=>/^https?:\/\//i.test(String(item?.url||""))&&item?.kind!=="social");
  const ordered=[...items].sort((a,b)=>{
    const ad=hostname(a.url)&&!/(news\.google|google\.com)/i.test(hostname(a.url))?1:0;
    const bd=hostname(b.url)&&!/(news\.google|google\.com)/i.test(hostname(b.url))?1:0;
    const aWords=wordCount(a?.content||"");const bWords=wordCount(b?.content||"");
    return bd-ad || Math.min(1,bWords/160)-Math.min(1,aWords/160) || Number(Boolean(b.content))-Number(Boolean(a.content));
  });
  let best=null;const attempts=[];
  const consider=(item,record)=>{
    attempts.push({url:item.url,sourceName:item.sourceName||item.collectorName||"Fonte",ok:Boolean(record?.ok),quality:Number(record?.readingQuality)||0,method:record?.extractionMethod||null,error:record?.error||null,durationMs:Number(record?.durationMs)||0});
    if(record?.ok&&(!best||Number(record.readingQuality)>Number(best.readingQuality)||(Number(record.readingQuality)===Number(best.readingQuality)&&Number(record.wordCount)>Number(best.wordCount))))best=record;
  };

  // Fast path: a Ronda pode já ter extraído o corpo completo do mesmo publisher.
  if (options.allowCollectedFastPath !== false) {
    for (const item of ordered.slice(0,3)) {
      const warm=collectedArticleFastPath(item);
      if(!warm)continue;
      warm.readingQuality=readingQualityScore(warm);warm.durationMs=0;
      consider(item,warm);
      if(warm.readingQuality>=82){
        return {ok:true,record:warm,evidence:buildEvidencePack(warm,{sourceType:"topic",sourceRef:topic?.id||null,topicId:topic?.id||null}),attempts,fastPath:true};
      }
    }
  }

  // Em vez de esperar até quatro portais em sequência, testa as duas melhores fontes
  // em paralelo. A segunda onda só acontece quando nenhuma primeira leitura ficou boa.
  const scrapeOne=async(item)=>{
    try{return await scrapeArticle(item,{...options,allowCollectedFastPath:false});}
    catch(error){return {ok:false,url:item.url,error:String(error?.message||error),readingQuality:0};}
  };
  const firstWave=ordered.slice(0,2);
  const firstResults=await Promise.all(firstWave.map(scrapeOne));
  firstResults.forEach((record,index)=>consider(firstWave[index],record));

  if((!best||Number(best.readingQuality)<85)&&ordered.length>2){
    const secondWave=ordered.slice(2,4);
    const secondResults=await Promise.all(secondWave.map(scrapeOne));
    secondResults.forEach((record,index)=>consider(secondWave[index],record));
  }

  if(!best) return {ok:false,error:"Nenhuma das fontes do assunto forneceu leitura útil.",attempts};
  return {ok:true,record:best,evidence:buildEvidencePack(best,{sourceType:"topic",sourceRef:topic?.id||null,topicId:topic?.id||null}),attempts,fastPath:Boolean(best.cacheHit)};
}

