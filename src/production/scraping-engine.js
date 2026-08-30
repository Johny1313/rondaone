import { extractArticleFromHtml, validateArticleUrl } from "../ronda/v285/article-reader.js";
import { extractArticleVisualsFromHtml } from "../ronda/article-visuals.js";
import { plainText, stableHash } from "../ronda/v285/parser.js";

const MAX_HTML_BYTES = 2_500_000;
const FAST_HTML_CHECK_BYTES = 700_000;
const DEFAULT_TIMEOUT_MS = 5_000;
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

function jsonLdNodes(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value) jsonLdNodes(item, output);
    return output;
  }
  output.push(value);
  if (value["@graph"]) jsonLdNodes(value["@graph"], output);
  return output;
}

function jsonLdImage(value) {
  const values = Array.isArray(value) ? value : [value];
  for (const entry of values) {
    const candidate = typeof entry === "string" ? entry : entry?.url || entry?.contentUrl;
    if (/^https?:\/\//i.test(String(candidate || ""))) return String(candidate);
  }
  return null;
}

function extractJsonLdFastArticle(html) {
  const scripts = String(html || "").match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts.slice(0, 16)) {
    const raw = script.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
    if (!raw || raw.length > 1_600_000) continue;
    let parsed = null;
    try { parsed = JSON.parse(decodeEntities(raw)); } catch { try { parsed = JSON.parse(raw); } catch {} }
    if (!parsed) continue;
    for (const node of jsonLdNodes(parsed)) {
      const types = Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]];
      if (!types.some((type) => /^(NewsArticle|Article|Reportage|AnalysisNewsArticle|BlogPosting)$/i.test(String(type || "")))) continue;
      const content = plainText(node?.articleBody || "");
      const words = wordCount(content);
      if (words < MIN_USEFUL_WORDS) continue;
      const authors = (Array.isArray(node.author) ? node.author : [node.author]).map((author) => plainText(author?.name || author)).filter(Boolean);
      return {
        content: content.slice(0, MAX_ARTICLE_CHARS),
        wordCount: words,
        title: plainText(node.headline || node.name),
        subtitle: plainText(node.description).slice(0, 800),
        author: authors.join(", ") || null,
        publishedAt: plainText(node.datePublished || node.dateModified) || null,
        imageUrl: jsonLdImage(node.image),
        method: "json-ld-fast",
      };
    }
  }
  return null;
}

export function evidenceSufficiency(value, slideCount = 7) {
  const content = typeof value === "string" ? plainText(value) : plainText(value?.content || value?.articleText || "");
  const words = wordCount(content);
  const count = Math.max(3, Math.min(15, Number(slideCount) || 7));
  const requiredFacts = Math.max(3, Math.min(12, count - 1));
  const facts = sentenceFacts(content, 24);
  const minimumWords = Math.max(65, count * 15);
  const ready = words >= minimumWords && facts.length >= requiredFacts;
  return { ready, facts: facts.length, requiredFacts, words, minimumWords };
}

function attemptSummary(attempts = []) {
  const unique = [];
  const seen = new Set();
  for (const attempt of attempts) {
    const method = String(attempt?.method || "rota");
    const key = `${method}:${attempt?.ok ? "ok" : attempt?.error || "fail"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(attempt?.ok ? `${method} ok` : `${method}: ${String(attempt?.error || "sem conteúdo").slice(0, 70)}`);
  }
  return unique.slice(0, 5).join(" · ");
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
  { id:"band", label:"Band", hosts:["band.com.br"], signals:[/article-content/i,/post-content/i,/entry-content/i,/news-content/i,/article-body/i] },
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

async function fetchHtml(url, fetcher = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, { slideCount = 7 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("scrape-timeout"), Math.max(800, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  try {
    const response = await fetcher(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36 RondaOne/0.9.7.4.6",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (contentType && !/html|xhtml|text\//i.test(contentType)) throw new Error("A URL não retornou HTML");

    let bytes;
    let truncated = false;
    let earlyStop = false;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      let nextInspection = FAST_HTML_CHECK_BYTES;
      while (total < MAX_HTML_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        const remaining = MAX_HTML_BYTES - total;
        const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
        chunks.push(chunk);
        total += chunk.byteLength;
        if (value.byteLength > remaining) truncated = true;

        if (total >= nextInspection) {
          const joined = new Uint8Array(total);
          let offset = 0;
          for (const part of chunks) { joined.set(part, offset); offset += part.byteLength; }
          const partial = decodeHtmlBuffer(joined, contentType);
          const fast = extractJsonLdFastArticle(partial) || adapterExtract(partial, response.url || url);
          if (fast && evidenceSufficiency(fast.content, slideCount).ready) {
            bytes = joined;
            earlyStop = true;
            try { await reader.cancel("ronda-evidence-sufficient"); } catch {}
            break;
          }
          nextInspection += 550_000;
        }
      }
      if (!bytes) {
        const joined = new Uint8Array(total);
        let offset = 0;
        for (const part of chunks) { joined.set(part, offset); offset += part.byteLength; }
        bytes = joined;
      }
    } else {
      const all = new Uint8Array(await response.arrayBuffer());
      truncated = all.byteLength > MAX_HTML_BYTES;
      bytes = all.slice(0, MAX_HTML_BYTES);
    }

    const html = decodeHtmlBuffer(bytes, contentType);
    return {
      html,
      finalUrl: validateArticleUrl(response.url || url),
      status: response.status,
      bytesRead: bytes.byteLength,
      truncated,
      earlyStop,
    };
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
    transport: "snapshot",
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
    transport:"cache",
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
  if (record.evidenceSufficiency?.ready) score += 12;
  if (record.readMode === "partial") score -= 18;
  return Math.max(0, Math.min(100, score));
}

export async function scrapeArticle(item, {
  fetcher = fetch,
  timeoutMs = 7_000,
  browserFetcher = null,
  allowCollectedFastPath = true,
  slideCount = 7,
  includeVisuals = true,
  transportPreference = "direct-first",
} = {}) {
  const startedAt = Date.now();
  const inputUrl = normalizeArticleIdentity(item?.url);
  const attempts = [];
  let best = null;
  let browserAttempted = false;
  const adapter = portalAdapterForUrl(inputUrl);

  if (allowCollectedFastPath) {
    const warm = collectedArticleFastPath(item);
    if (warm) {
      const sufficiency = evidenceSufficiency(warm.content, slideCount);
      warm.evidenceSufficiency = sufficiency;
      warm.readingQuality = readingQualityScore(warm);
      return {...warm, evidenceSufficiency:sufficiency, attempts:[{method:warm.extractionMethod,ok:true,wordCount:warm.wordCount,fastPath:true}],durationMs:Date.now()-startedAt};
    }
  }

  const consider = (candidate) => {
    if (!candidate?.ok) return false;
    candidate.evidenceSufficiency = evidenceSufficiency(candidate.content, slideCount);
    candidate.readingQuality = readingQualityScore(candidate);
    if (!best || candidate.evidenceSufficiency.ready && !best.evidenceSufficiency?.ready
      || candidate.readingQuality > best.readingQuality
      || (candidate.readingQuality === best.readingQuality && candidate.wordCount > best.wordCount)) best = candidate;
    return Boolean(candidate.evidenceSufficiency.ready && candidate.readingQuality >= 55);
  };

  const tryBrowserTransport = async () => {
    if (browserAttempted || typeof browserFetcher !== "function") return false;
    browserAttempted = true;
    const browserStartedAt = Date.now();
    try {
      const rendered = await browserFetcher(inputUrl);
      const html = String(rendered?.html || "");
      if (!html) {
        attempts.push({method:"browser",transport:"browser",ok:false,error:"Browser Run não retornou HTML"});
        return false;
      }
      const resolved = normalizeArticleIdentity(rendered?.url || inputUrl);
      const jsonLd = extractJsonLdFastArticle(html);
      const adapted = jsonLd ? null : adapterExtract(html, resolved);
      const generic = (!jsonLd && !adapted) ? extractArticleFromHtml(html,item) : null;
      const source = jsonLd || adapted || generic;
      const words = Number(source?.wordCount) || wordCount(source?.content || "");
      if (!source || words < MIN_USEFUL_WORDS) {
        attempts.push({method:"browser",transport:"browser",ok:false,error:"HTML renderizado sem conteúdo editorial suficiente",durationMs:Date.now()-browserStartedAt,browserMsUsed:Number(rendered?.browserMsUsed)||0});
        return false;
      }
      const method = jsonLd?.method || adapted?.method || `generic:${generic?.method || "html"}`;
      const candidate = {
        ok:true,url:inputUrl,canonicalUrl:normalizeArticleIdentity(canonicalUrl(html,resolved)),resolvedUrl:resolved,
        sourceName:item?.sourceName||item?.collectorName||hostname(resolved)||"Fonte",
        title:jsonLd?.title||generic?.title||metaContent(html,"og:title")||plainText(item?.title)||"Notícia sem título",
        subtitle:jsonLd?.subtitle||generic?.description||metaContent(html,"og:description")||metaContent(html,"description")||plainText(item?.description),
        author:jsonLd?.author||generic?.byline||metaContent(html,"author")||null,
        publishedAt:jsonLd?.publishedAt||generic?.publishedAt||item?.publishedAt||null,
        content:plainText(source?.content).slice(0,MAX_ARTICLE_CHARS),wordCount:words,
        extractionMethod:`browser:${method}`,adapter:adapted?.adapter||portalAdapterForUrl(resolved)?.id||null,
        transport:"browser",contentLevel:"article",readMode:"full",images:null,degraded:false,error:null,
        browserMsUsed:Number(rendered?.browserMsUsed)||0,
      };
      attempts.push({method:candidate.extractionMethod,transport:"browser",ok:true,wordCount:candidate.wordCount,durationMs:Date.now()-browserStartedAt,browserMsUsed:candidate.browserMsUsed});
      const sufficient = consider(candidate);
      if (includeVisuals) {
        try { candidate.images = extractArticleVisualsFromHtml(html,{articleUrl:resolved,resolvedUrl:resolved,sourceName:candidate.sourceName}); } catch {}
      }
      return sufficient;
    } catch (error) {
      attempts.push({method:"browser",transport:"browser",ok:false,error:String(error?.message||error).slice(0,160),durationMs:Date.now()-browserStartedAt});
      return false;
    }
  };

  // Domínios que historicamente respondem melhor via navegador podem pular a espera
  // do fetch direto. Se o Browser Run falhar, o caminho direto continua disponível.
  if (transportPreference === "browser-first" && typeof browserFetcher === "function") {
    if (await tryBrowserTransport()) {
      return {...best,attempts,durationMs:Date.now()-startedAt,readingQuality:readingQualityScore(best),evidenceSufficiency:best.evidenceSufficiency||evidenceSufficiency(best.content,slideCount)};
    }
  }

  try {
    const directBudget = Math.min(browserFetcher ? (adapter ? 2_800 : 3_200) : (adapter ? 3_800 : 4_500), Math.max(1_500, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
    const fetched = await fetchHtml(inputUrl, fetcher, directBudget, { slideCount });
    const html = fetched.html;
    const finalUrl = fetched.finalUrl;

    const baseMeta = {
      ok:true,
      url: inputUrl,
      canonicalUrl: normalizeArticleIdentity(canonicalUrl(html, finalUrl)),
      resolvedUrl: finalUrl,
      sourceName: item?.sourceName || item?.collectorName || hostname(finalUrl) || "Fonte",
      title: metaContent(html,"og:title") || plainText(item?.title) || "Notícia sem título",
      subtitle: metaContent(html,"og:description") || metaContent(html,"description") || plainText(item?.description),
      author: metaContent(html,"author") || null,
      publishedAt: item?.publishedAt || null,
      images: null,
      readMode:"full",
      contentLevel:"article",
      degraded:false,
      error:null,
      transport:"direct",
      bytesRead:Number(fetched.bytesRead)||0,
      streamEarlyStop:Boolean(fetched.earlyStop),
    };

    // Escada adaptativa: JSON-LD e adapter conhecido vêm antes do parser genérico.
    const jsonLd = extractJsonLdFastArticle(html);
    if (jsonLd) {
      const candidate = {
        ...baseMeta,
        title:jsonLd.title || baseMeta.title,
        subtitle:jsonLd.subtitle || baseMeta.subtitle,
        author:jsonLd.author || baseMeta.author,
        publishedAt:jsonLd.publishedAt || baseMeta.publishedAt,
        content:jsonLd.content,
        wordCount:jsonLd.wordCount,
        extractionMethod:jsonLd.method,
        adapter:null,
      };
      attempts.push({method:jsonLd.method,transport:"direct",ok:true,wordCount:jsonLd.wordCount,bytesRead:fetched.bytesRead});
      if (consider(candidate)) {
        if (includeVisuals) {
          try { candidate.images = extractArticleVisualsFromHtml(html,{articleUrl:finalUrl,resolvedUrl:finalUrl,sourceName:candidate.sourceName}); } catch {}
        }
        return {...candidate,attempts,durationMs:Date.now()-startedAt,readingQuality:readingQualityScore(candidate)};
      }
    } else attempts.push({method:"json-ld-fast",ok:false,error:"articleBody não disponível"});

    const adapted = adapterExtract(html, finalUrl);
    if (adapted) {
      const candidate = {...baseMeta,content:adapted.content,wordCount:adapted.wordCount,extractionMethod:adapted.method,adapter:adapted.adapter};
      attempts.push({method:adapted.method,transport:"direct",ok:true,wordCount:adapted.wordCount,bytesRead:fetched.bytesRead});
      if (consider(candidate)) {
        if (includeVisuals) {
          try { candidate.images = extractArticleVisualsFromHtml(html,{articleUrl:finalUrl,resolvedUrl:finalUrl,sourceName:candidate.sourceName}); } catch {}
        }
        return {...candidate,attempts,durationMs:Date.now()-startedAt,readingQuality:readingQualityScore(candidate)};
      }
    } else if (adapter) attempts.push({method:`adapter:${adapter.id}`,ok:false,error:"conteúdo principal insuficiente"});

    const generic = extractArticleFromHtml(html, item);
    const genericCandidate = {
      ...baseMeta,
      title:generic.title || baseMeta.title,
      subtitle:generic.description || baseMeta.subtitle,
      author:generic.byline || baseMeta.author,
      publishedAt:generic.publishedAt || baseMeta.publishedAt,
      content:generic.content,
      wordCount:generic.wordCount,
      extractionMethod:`generic:${generic.method || "html"}`,
      adapter:null,
    };
    attempts.push({method:genericCandidate.extractionMethod,transport:"direct",ok:generic.wordCount>=MIN_USEFUL_WORDS,wordCount:generic.wordCount,bytesRead:fetched.bytesRead});
    if (generic.wordCount >= MIN_USEFUL_WORDS) consider(genericCandidate);

    // AMP só é aberto quando ainda não há evidência suficiente para os slides pedidos.
    const sufficient = best?.evidenceSufficiency?.ready && Number(best?.readingQuality) >= 55;
    if (!sufficient && Date.now() - startedAt < timeoutMs - 900) {
      const amp = linkedUrl(html, finalUrl, "amphtml");
      if (amp && amp !== finalUrl) {
        try {
          const remaining = Math.max(900, Math.min(2_500, timeoutMs - (Date.now()-startedAt)));
          const ampFetched = await fetchHtml(amp, fetcher, remaining, { slideCount });
          const ampJson = extractJsonLdFastArticle(ampFetched.html);
          const ampAdapted = adapterExtract(ampFetched.html, ampFetched.finalUrl);
          const ampGeneric = (!ampJson && !ampAdapted) ? extractArticleFromHtml(ampFetched.html, item) : null;
          const source = ampJson || ampAdapted || (ampGeneric ? {content:ampGeneric.content,wordCount:ampGeneric.wordCount,method:`generic:${ampGeneric.method||"html"}`} : null);
          if (source) {
            const candidate = {...baseMeta,canonicalUrl:normalizeArticleIdentity(canonicalUrl(ampFetched.html,finalUrl)),resolvedUrl:ampFetched.finalUrl,content:source.content,wordCount:source.wordCount,extractionMethod:`amp:${source.method||"html"}`,adapter:ampAdapted?.adapter||null};
            attempts.push({method:candidate.extractionMethod,transport:"direct",ok:candidate.wordCount>=MIN_USEFUL_WORDS,wordCount:candidate.wordCount,bytesRead:ampFetched.bytesRead});
            if(candidate.wordCount>=MIN_USEFUL_WORDS)consider(candidate);
          }
        } catch (error) { attempts.push({method:"amp",ok:false,error:String(error?.message||error).slice(0,120)}); }
      } else attempts.push({method:"amp",ok:false,error:"não disponível"});
    }

    if (best && includeVisuals) {
      try { best.images = extractArticleVisualsFromHtml(html,{articleUrl:finalUrl,resolvedUrl:finalUrl,sourceName:best.sourceName}); } catch {}
    }
  } catch (error) {
    attempts.push({method:"direct-html",transport:"direct",ok:false,error:String(error?.message||error).slice(0,160)});
  }

  // A versão híbrida recupera a tolerância antiga sem trocar de fonte cedo demais:
  // antes de aceitar snapshot parcial, tenta um segundo transporte para a MESMA URL.
  if ((!best || !best.evidenceSufficiency?.ready || best.readingQuality < 55) && !browserAttempted && typeof browserFetcher === "function") {
    if (await tryBrowserTransport()) {
      return {...best,attempts,durationMs:Date.now()-startedAt,readingQuality:readingQualityScore(best),evidenceSufficiency:best.evidenceSufficiency||evidenceSufficiency(best.content,slideCount)};
    }
  }

  if (!best) {
    const fallback = collectedFallback(item);
    if (fallback) {
      fallback.evidenceSufficiency = evidenceSufficiency(fallback.content, slideCount);
      attempts.push({method:"collected-fallback",ok:true,wordCount:fallback.wordCount});
      consider(fallback);
    } else attempts.push({method:"collected-fallback",ok:false,error:"snapshot/RSS sem conteúdo suficiente"});
  }


  if (!best) {
    const summary = attemptSummary(attempts);
    return {ok:false,url:inputUrl,canonicalUrl:inputUrl,sourceName:item?.sourceName||item?.collectorName||hostname(inputUrl)||"Fonte",title:item?.title||"Notícia sem título",content:"",wordCount:0,readingQuality:0,readMode:"failed",extractionMethod:null,adapter:null,attempts,error:`Conteúdo principal indisponível${summary?`. Rotas: ${summary}`:""}`.slice(0,500)};
  }
  return {...best,attempts,durationMs:Date.now()-startedAt,readingQuality:readingQualityScore(best),evidenceSufficiency:best.evidenceSufficiency||evidenceSufficiency(best.content,slideCount)};
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
    reading:{method:record?.extractionMethod||record?.readMode||"unknown",transport:record?.transport||"unknown",adapter:record?.adapter||null,quality:Number(record?.readingQuality)||0,mode:record?.readMode||"unknown",degraded:Boolean(record?.degraded),resolvedUrl:record?.resolvedUrl||record?.canonicalUrl||record?.url||null,attempts:record?.attempts||[],durationMs:Number(record?.durationMs)||0},
    createdAt:now,
  };
}

export function sourceSelectionScore(item = {}) {
  const url=String(item?.url||"");
  const host=hostname(url);
  const direct=host&&!/(news\.google|google\.com|googleusercontent\.com|bing\.com)/i.test(host);
  const adapter=portalAdapterForUrl(url);
  const words=wordCount(item?.content||"");
  const route=String(item?.collectionRoute||item?.route||"").toLowerCase();
  const sourceName=String(item?.sourceName||item?.collectorName||"").toLowerCase();
  let score=0;const reasons=[];
  if(direct){score+=34;reasons.push("publisher-direto");}
  if(adapter){score+=24;reasons.push(`adapter:${adapter.id}`);}
  if(words>=160){score+=24;reasons.push("texto-completo-em-cache");}
  else if(words>=70){score+=12;reasons.push("conteudo-parcial-em-cache");}
  if(/direct|html|article|publisher|scrap|full/.test(route)){score+=12;reasons.push("rota-de-leitura-confiavel");}
  if(/ag[eê]ncia brasil|poder360|g1|cnn|metropoles|uol|infomoney|estadao|estadão|folha|globo|ge/.test(sourceName)){score+=4;reasons.push("fonte-prioritaria");}
  if(/paywall|login|assinatura|subscriber/.test(`${route} ${String(item?.description||"")}`.toLowerCase())){score-=22;reasons.push("risco-paywall");}
  return {score,reasons,directPublisher:Boolean(direct),adapter:adapter?.id||null,wordCount:words};
}

export function rankTopicSources(topic = {}) {
  const items=(Array.isArray(topic?.items)?topic.items:[]).filter((item)=>/^https?:\/\//i.test(String(item?.url||""))&&item?.kind!=="social");
  return items.map((item,index)=>({item,index,...sourceSelectionScore(item)}))
    .sort((a,b)=>b.score-a.score || b.wordCount-a.wordCount || a.index-b.index);
}

export async function scrapeTopicToEvidence(topic, options = {}) {
  const ranked=rankTopicSources(topic);
  const primary=ranked[0]||null;
  const backup=ranked[1]||null;
  const attempts=[];
  if(!primary)return {ok:false,error:"A pauta não possui fonte de portal disponível para leitura.",attempts,selection:{policy:"single-primary-one-backup",primary:null,backup:null}};

  const selection={
    policy:"single-primary-one-backup",
    primary:{url:primary.item.url,sourceName:primary.item.sourceName||primary.item.collectorName||"Fonte",score:primary.score,reasons:primary.reasons},
    backup:backup?{url:backup.item.url,sourceName:backup.item.sourceName||backup.item.collectorName||"Fonte",score:backup.score,reasons:backup.reasons}:null,
    selectedRole:null,
  };

  const register=(role,item,record)=>{
    const attempt={role,url:item?.url||null,sourceName:item?.sourceName||item?.collectorName||"Fonte",ok:Boolean(record?.ok),quality:Number(record?.readingQuality)||0,wordCount:Number(record?.wordCount)||0,method:record?.extractionMethod||null,transport:record?.transport||null,error:record?.error||null,durationMs:Number(record?.durationMs)||0,routes:Array.isArray(record?.attempts)?record.attempts.slice(0,10):[]};
    attempts.push(attempt);
    if(record&&typeof record==="object")record.sourceSelection={...selection,selectedRole:role,attempts:[...attempts]};
    return attempt;
  };

  const readCandidate=async(candidate,role)=>{
    const item=candidate.item;
    if(options.allowCollectedFastPath!==false){
      const warm=collectedArticleFastPath(item);
      if(warm){warm.readingQuality=readingQualityScore(warm);warm.durationMs=0;register(role,item,warm);if(warm.readingQuality>=55)return warm;}
    }
    let record;
    try{
      const adapterKnown=Boolean(portalAdapterForUrl(item?.url));
      const candidateTimeout=Math.min(Number(options.timeoutMs)||4_500,adapterKnown?3_800:4_500);
      let transportPreference=options.transportPreference||"direct-first";
      if(typeof options.transportPreferenceFor==="function"){try{transportPreference=await options.transportPreferenceFor(item,role)||"direct-first";}catch{transportPreference="direct-first";}}
      record=await scrapeArticle(item,{...options,timeoutMs:candidateTimeout,slideCount:Number(options.slideCount)||7,allowCollectedFastPath:false,transportPreference});
    }
    catch(error){record={ok:false,url:item.url,error:String(error?.message||error),readingQuality:0,wordCount:0,durationMs:0};}
    if (typeof options.onTransportResult === "function") await options.onTransportResult(item,record,role).catch(()=>null);
    register(role,item,record);
    return record?.ok&&(Number(record.readingQuality)>=55||record?.evidenceSufficiency?.ready&&Number(record.readingQuality)>=40)?record:null;
  };

  // Política v0.9.7.2: uma única matéria é lida. Uma segunda fonte só é aberta
  // se a principal realmente não produzir leitura útil; nunca fazemos leitura paralela de várias fontes.
  let selected=await readCandidate(primary,"primary");
  if(!selected&&backup)selected=await readCandidate(backup,"backup");
  if(!selected){
    const detail=attempts.map((attempt)=>`${attempt.sourceName}: ${attempt.error||attempt.routes?.map((route)=>route.method).filter(Boolean).join(" → ")||"sem conteúdo útil"}`).join(" · ");
    return {ok:false,error:`A fonte principal e a única fonte de backup não forneceram leitura útil.${detail?` ${detail}`:""}`.slice(0,600),attempts,selection};
  }
  selected.sourceSelection={...selection,selectedRole:selected.sourceSelection?.selectedRole||attempts.at(-1)?.role||"primary",attempts:[...attempts]};
  const evidence=buildEvidencePack(selected,{sourceType:"topic",sourceRef:topic?.id||null,topicId:topic?.id||null});
  evidence.sourceSelection=selected.sourceSelection;
  evidence.reading={...evidence.reading,sourceSelection:selected.sourceSelection};
  return {ok:true,record:selected,evidence,attempts,selection:selected.sourceSelection,fastPath:Boolean(selected.cacheHit)};
}

