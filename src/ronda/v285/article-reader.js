import { decodeEntities, plainText, stableHash } from "./parser.js";

export const ARTICLE_ANALYSIS_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const ARTICLE_READER_LIMIT = 1;
const MAX_HTML_BYTES = 2_500_000;
const MAX_ARTICLE_CHARS = 12_000;
const MAX_PROMPT_CHARS = 30_000;
const MIN_ARTICLE_WORDS = 60;
const ARTICLE_FETCH_TIMEOUT_MS = 4_200;
const AMP_FETCH_TIMEOUT_MS = 2_000;
const ARTICLE_TOTAL_TIMEOUT_MS = 8_500;
const ARTICLE_PROGRESS_HEARTBEAT_MS = 1_600;
const READING_PROGRESS_START = 8;
const READING_PROGRESS_END = 60;
const AI_ANALYSIS_TIMEOUT_MS = 10_500;
const MAX_SLIDE_TITLE_CHARS = 68;
const MAX_SLIDE_SUBTITLE_CHARS = 190;
const CAROUSEL_PROMPT_VERSION = "source-evidence-v11-verified-origin-resilient";
const MIN_VERIFIED_PUBLISHER_FEED_WORDS = 90;
const MIN_VERIFIED_PUBLISHER_DESCRIPTION_WORDS = 120;
const MAX_PUBLISHER_ATTEMPTS = 6;
const PUBLISHER_READ_CONCURRENCY = 3;

const AGGREGATOR_HOSTS = new Set([
  "news.google.com",
  "google.com",
  "www.google.com",
  "bing.com",
  "www.bing.com",
]);

const NOISE_PATTERN = /(ad-|ads|advert|anuncio|banner|breadcrumb|cookie|coment|comments|footer|header|menu|nav|newsletter|paywall|popup|promo|publicidade|recommend|related|share|sidebar|social|subscribe|widget)/i;
const NOISE_SENTENCE = /(assine|aceite os cookies|continuar lendo|conteúdo patrocinado|leia também|mais lidas|publicidade|receba nossa newsletter|siga-nos|todos os direitos reservados)/i;
export const MIN_CAROUSEL_SLIDES = 3;
export const MAX_CAROUSEL_SLIDES = 15;
export const DEFAULT_CAROUSEL_SLIDES = 7;

export function carouselSlidePlan(value = DEFAULT_CAROUSEL_SLIDES) {
  const requested = Number(value);
  const count = Number.isInteger(requested)
    ? Math.max(MIN_CAROUSEL_SLIDES, Math.min(MAX_CAROUSEL_SLIDES, requested))
    : DEFAULT_CAROUSEL_SLIDES;
  let roles;
  if (count === 3) roles = ["Título principal", "Informação principal", "Conclusão"];
  else if (count === 4) roles = ["Título principal", "Contexto", "Informação principal", "Conclusão"];
  else if (count === 5) roles = ["Título principal", "Contexto", "Informação principal", "Conclusão", "CTA"];
  else if (count === 6) roles = ["Título principal", "Contexto", "Informação principal", "Detalhamento", "Conclusão", "CTA"];
  else {
    const details = Array.from({ length: count - 6 }, (_, index) => count === 7 ? "Detalhamento" : `Detalhamento ${index + 1}`);
    roles = ["Título principal", "Contexto", "Informação principal", ...details, "Consequência", "Conclusão", "CTA"];
  }
  return roles.map((role, index) => [index + 1, role]);
}

function compact(value, limit = 300) {
  const text = plainText(value);
  if (text.length <= limit) return text;
  const clipped = text.slice(0, limit + 1);
  const boundary = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, boundary > limit * 0.65 ? boundary : limit).trim()}…`;
}

function wordCount(value) {
  return plainText(value).split(/\s+/).filter(Boolean).length;
}

function normalizedTokens(value, minimumLength = 4) {
  return plainText(value)
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]+/g)
    ?.filter((token) => token.length >= minimumLength && !/^(para|como|mais|pela|pelo|pelos|pelas|sobre|entre|apenas|ainda|esta|este|essa|esse|isso|noticia|materia)$/.test(token)) || [];
}

function tokenSimilarity(left, right) {
  const a = new Set(normalizedTokens(left));
  const b = new Set(normalizedTokens(right));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / Math.max(a.size, b.size);
}

function tokenCoverage(query, text) {
  const expected = new Set(normalizedTokens(query));
  const available = new Set(normalizedTokens(text));
  if (!expected.size || !available.size) return 0;
  let intersection = 0;
  for (const token of expected) if (available.has(token)) intersection += 1;
  return intersection / expected.size;
}

function editorialClip(value, limit) {
  const text = plainText(value);
  if (text.length <= limit) return text;
  const clipped = text.slice(0, limit + 1);
  const punctuation = Math.max(clipped.lastIndexOf("."), clipped.lastIndexOf("!"), clipped.lastIndexOf("?"));
  if (punctuation >= limit * 0.58) return clipped.slice(0, punctuation + 1).trim();
  const boundary = clipped.lastIndexOf(" ");
  const safe = clipped.slice(0, boundary >= limit * 0.65 ? boundary : limit).replace(/[,:;–—-]+$/, "").trim();
  return safe ? `${safe}.` : "";
}

function canonicalHostname(value) {
  try { return new URL(String(value || "")).hostname.toLocaleLowerCase("pt-BR").replace(/^www\./, ""); } catch { return ""; }
}

function hostMatches(left, right) {
  const a = canonicalHostname(`https://${String(left || "").replace(/^https?:\/\//i, "")}`);
  const b = canonicalHostname(`https://${String(right || "").replace(/^https?:\/\//i, "")}`);
  return Boolean(a && b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)));
}

function isAggregatorHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
  if (!host) return false;
  if (AGGREGATOR_HOSTS.has(host)) return true;
  return host.endsWith(".google.com") || host.endsWith(".googleusercontent.com") || host.endsWith(".bing.com");
}

function publisherUrlSignals(item) {
  const urlHostname = canonicalHostname(item?.url);
  const declaredHostname = canonicalHostname(item?.publisherHomepageUrl || item?.declaredSourceUrl || item?.sourceUrl);
  const aggregator = isAggregatorHostname(urlHostname);
  const matchesDeclaredPublisher = declaredHostname ? hostMatches(urlHostname, declaredHostname) : !aggregator;
  const directPublisher = Boolean(urlHostname && !aggregator && matchesDeclaredPublisher);
  return { urlHostname, declaredHostname, aggregator, matchesDeclaredPublisher, directPublisher };
}

function safeJsonParse(value) {
  if (value && typeof value === "object") return value;
  const text = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function decodeHtmlBuffer(bytes, contentType = "") {
  const headerCharset = /charset\s*=\s*([^;\s]+)/i.exec(contentType)?.[1]?.replace(/["']/g, "");
  const sample = new TextDecoder("windows-1252").decode(bytes.slice(0, 500));
  const declared = /<meta[^>]+charset\s*=\s*["']?([^"'\s/>]+)/i.exec(sample)?.[1]
    || /<meta[^>]+content=["'][^"']*charset=([^"';\s]+)/i.exec(sample)?.[1];
  const raw = String(headerCharset || declared || "utf-8").toLowerCase();
  const charset = ["iso-8859-1", "latin1", "windows-1252", "cp1252"].includes(raw) ? "windows-1252" : "utf-8";
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
    if (match?.[1]) return compact(decodeEntities(match[1]), 500);
  }
  return "";
}

function jsonLdNodes(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    value.forEach((item) => jsonLdNodes(item, output));
    return output;
  }
  output.push(value);
  if (value["@graph"]) jsonLdNodes(value["@graph"], output);
  return output;
}

function extractJsonLdArticle(html) {
  const scripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    const content = script.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
    const parsed = safeJsonParse(decodeEntities(content));
    const nodes = jsonLdNodes(parsed);
    const article = nodes.find((node) => {
      const types = Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]];
      return types.some((type) => /^(NewsArticle|Article|Reportage|AnalysisNewsArticle|BlogPosting)$/i.test(String(type || ""))) && plainText(node.articleBody);
    });
    if (!article) continue;
    const authorValue = Array.isArray(article.author) ? article.author : [article.author];
    const byline = authorValue.map((author) => plainText(author?.name || author)).filter(Boolean).join(", ");
    return {
      title: compact(article.headline || article.name, 240),
      description: compact(article.description, 500),
      byline: compact(byline, 180),
      publishedAt: plainText(article.datePublished || article.dateModified),
      content: cleanArticleText(article.articleBody),
      method: "json-ld",
    };
  }
  return null;
}


function normalizeEmbeddedArticleText(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const decoded = decodeEntities(raw);
  const text = /<\/?[a-z][\s\S]*>/i.test(decoded) ? paragraphText(decoded) || cleanArticleText(decoded) : cleanArticleText(decoded);
  return text.slice(0, MAX_ARTICLE_CHARS).trim();
}

function embeddedJsonCandidates(value, path = [], output = [], depth = 0) {
  if (!value || depth > 12 || output.length >= 280) return output;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 180)) embeddedJsonCandidates(item, path, output, depth + 1);
    return output;
  }
  if (typeof value !== "object") return output;
  for (const [key, child] of Object.entries(value)) {
    if (output.length >= 280) break;
    const nextPath = [...path, key];
    const pathText = nextPath.join(".").toLocaleLowerCase("pt-BR");
    if (typeof child === "string") {
      const keySignal = /^(articlebody|article_body|body|content|text|html|paragraph|description)$/i.test(key);
      const pathSignal = /(article|story|materia|noticia|news|post|content|body|paragraph|blocks?)/i.test(pathText);
      if (!keySignal && !pathSignal) continue;
      const text = normalizeEmbeddedArticleText(child);
      const count = wordCount(text);
      if (count < 18) continue;
      output.push({ text, count, path: pathText, strong: /articlebody|article_body|story\.body|article\.body|post\.content|article\.content/.test(pathText) });
      continue;
    }
    if (child && typeof child === "object") embeddedJsonCandidates(child, nextPath, output, depth + 1);
  }
  return output;
}

function extractEmbeddedJsonArticle(html, fallback = {}) {
  const raw = String(html || "");
  const scripts = raw.match(/<script\b[^>]*(?:type=["']application\/(?:json|ld\+json)["']|id=["']__NEXT_DATA__["'])[^>]*>[\s\S]*?<\/script>/gi) || [];
  let best = null;
  for (const script of scripts.slice(0, 18)) {
    const body = script.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
    if (!body || body.length > 1_800_000) continue;
    let parsed = safeJsonParse(body);
    if (!parsed) parsed = safeJsonParse(decodeEntities(body));
    if (!parsed) continue;
    const candidates = embeddedJsonCandidates(parsed);
    if (!candidates.length) continue;
    candidates.sort((a, b) => Number(b.strong) - Number(a.strong) || b.count - a.count);
    let content = "";
    const seen = new Set();
    for (const candidate of candidates) {
      const key = candidate.text.toLocaleLowerCase("pt-BR");
      if (seen.has(key)) continue;
      seen.add(key);
      if (!content || candidate.strong || tokenCoverage(fallback?.title || "", candidate.text) >= 0.18) {
        content = cleanArticleText(`${content}\n\n${candidate.text}`);
      }
      if (wordCount(content) >= 900 || content.length >= MAX_ARTICLE_CHARS) break;
    }
    const count = wordCount(content);
    const relevance = tokenCoverage(fallback?.title || "", content);
    const score = count + Math.round(relevance * 120) + (candidates.some((item) => item.strong) ? 80 : 0);
    if (count >= MIN_ARTICLE_WORDS && (!best || score > best.score)) best = { content, count, score };
  }
  if (!best) return null;
  return { content: best.content, wordCount: best.count, method: "embedded-json" };
}

function removeNoiseBlocks(html) {
  let output = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|canvas|iframe|form|nav|footer|aside|dialog)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  const blockPattern = /<(div|section|ul)\b([^>]*(?:id|class)=["'][^"']*(?:ad-|ads|advert|anuncio|banner|breadcrumb|cookie|comment|footer|header|menu|nav|newsletter|paywall|popup|promo|publicidade|recommend|related|share|sidebar|social|subscribe|widget)[^"']*["'][^>]*)>[\s\S]*?<\/\1\s*>/gi;
  for (let index = 0; index < 3; index += 1) output = output.replace(blockPattern, " ");
  return output;
}

function paragraphText(html) {
  const values = [];
  const seen = new Set();
  const expression = /<(p|h2|h3|li)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  let match;
  while ((match = expression.exec(html)) && values.length < 140) {
    const text = repairArticleTypography(plainText(match[2])).replace(/\s+/g, " ").trim();
    const normalized = text.toLocaleLowerCase("pt-BR");
    if (text.length < 35 || text.length > 1_500 || NOISE_SENTENCE.test(text) || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(text);
  }
  return cleanArticleText(values.join("\n\n"));
}

function repairArticleTypography(value) {
  return String(value || "")
    .replace(/([0-9](?:[.,][0-9]+)?%)(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ])/g, "$1 ")
    .replace(/([A-Za-zÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç])(?=\d+(?:[.,]\d+)?%)/g, "$1 ")
    .replace(/([a-záàâãéêíóôõúç]{3,})([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]{2,})/g, "$1 $2")
    .replace(/([!?;:])(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ0-9])/g, "$1 ")
    .replace(/(^|[^0-9])\.(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ])/g, "$1. ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function cleanArticleText(value) {
  const lines = String(value || "")
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => repairArticleTypography(plainText(line)).trim())
    .filter((line) => line.length >= 25 && !NOISE_SENTENCE.test(line));
  const output = [];
  const seen = new Set();
  for (const line of lines) {
    const key = line.toLocaleLowerCase("pt-BR");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(line);
    if (output.join("\n\n").length >= MAX_ARTICLE_CHARS) break;
  }
  return output.join("\n\n").slice(0, MAX_ARTICLE_CHARS).trim();
}

function candidateBlocks(html) {
  const candidates = [];
  const patterns = [
    /<article\b[^>]*>[\s\S]*?<\/article\s*>/gi,
    /<main\b[^>]*>[\s\S]*?<\/main\s*>/gi,
    /<(?:div|section)\b[^>]*(?:id|class|data-testid|data-component)=["'][^"']*(?:article-body|article-content|content-article|materia|news-body|post-content|story-body|story-content|article__content|article-text|texto|content-body)[^"']*["'][^>]*>[\s\S]*?<\/(?:div|section)\s*>/gi,
  ];
  for (const pattern of patterns) {
    const matches = html.match(pattern) || [];
    candidates.push(...matches.slice(0, 12));
  }
  return candidates;
}

export function extractArticleFromHtml(html, fallback = {}) {
  const raw = String(html || "").slice(0, MAX_HTML_BYTES);
  const structured = extractJsonLdArticle(raw);
  const title = structured?.title || metaContent(raw, "og:title") || metaContent(raw, "twitter:title") || compact(fallback.title, 240);
  const description = structured?.description || metaContent(raw, "description") || metaContent(raw, "og:description") || compact(fallback.description, 500);
  const byline = structured?.byline || metaContent(raw, "author");
  const publishedAt = structured?.publishedAt || metaContent(raw, "article:published_time") || fallback.publishedAt || null;

  if (structured?.content && wordCount(structured.content) >= MIN_ARTICLE_WORDS) {
    return { title, description, byline, publishedAt, content: structured.content, wordCount: wordCount(structured.content), method: structured.method };
  }

  const embedded = extractEmbeddedJsonArticle(raw, { title, description, ...fallback });
  if (embedded?.content && embedded.wordCount >= MIN_ARTICLE_WORDS) {
    return { title, description, byline, publishedAt, content: embedded.content, wordCount: embedded.wordCount, method: embedded.method };
  }

  const cleanedHtml = removeNoiseBlocks(raw);
  let best = "";
  let bestScore = 0;
  for (const candidate of candidateBlocks(cleanedHtml)) {
    const text = paragraphText(candidate);
    const count = wordCount(text);
    const score = count + (text.match(/\n\n/g)?.length || 0) * 8;
    if (score > bestScore) {
      best = text;
      bestScore = score;
    }
  }
  if (wordCount(best) < MIN_ARTICLE_WORDS) best = paragraphText(cleanedHtml);
  if (wordCount(best) < MIN_ARTICLE_WORDS && description) best = cleanArticleText(`${description}\n\n${fallback.description || ""}`);
  return { title, description, byline, publishedAt, content: best, wordCount: wordCount(best), method: best ? "html" : "metadata" };
}

function isPrivateHostname(hostname) {
  const value = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!value || value === "localhost" || value.endsWith(".local") || value.endsWith(".internal")) return true;
  if (/^(127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(value)) return true;
  const match = /^(172)\.(\d{1,3})\./.exec(value);
  if (match && Number(match[2]) >= 16 && Number(match[2]) <= 31) return true;
  if (value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:")) return true;
  return false;
}

export function validateArticleUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new Error("URL da matéria inválida"); }
  if (!/^https?:$/.test(url.protocol) || isPrivateHostname(url.hostname)) throw new Error("URL da matéria não permitida");
  return url.toString();
}

function linkedPageUrl(html, baseUrl, relName) {
  const escaped = String(relName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<link[^>]+rel=["'][^"']*${escaped}[^"']*["'][^>]+href=["']([^"']+)["']`, "i"),
    new RegExp(`<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*${escaped}[^"']*["']`, "i"),
  ];
  for (const pattern of patterns) {
    const value = pattern.exec(String(html || ""))?.[1];
    if (!value) continue;
    try { return validateArticleUrl(new URL(decodeEntities(value), baseUrl).toString()); } catch {}
  }
  return null;
}

async function fetchArticleHtml(url, fetcher, timeoutMs = ARTICLE_FETCH_TIMEOUT_MS, parentSignal = null) {
  const controller = new AbortController();
  const abortFromParent = () => {
    if (!controller.signal.aborted) controller.abort(parentSignal?.reason || "Leitura da matéria cancelada");
  };
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener?.("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => {
    if (!controller.signal.aborted) controller.abort("Tempo limite da matéria excedido");
  }, Math.max(250, Number(timeoutMs) || ARTICLE_FETCH_TIMEOUT_MS));
  try {
    const response = await fetcher(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.6",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5",
        "User-Agent": "Mozilla/5.0 (compatible; RondaEditorial/2.8.5; +leitura-editorial)",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const finalUrl = validateArticleUrl(response.url || url);
    const contentType = response.headers.get("Content-Type") || "";
    if (contentType && !/html|xhtml|text\//i.test(contentType)) throw new Error("A URL não retornou uma página HTML");
    const length = Number(response.headers.get("Content-Length")) || 0;
    if (length > MAX_HTML_BYTES * 2) throw new Error("Página maior que o limite seguro");
    const buffer = new Uint8Array(await response.arrayBuffer());
    return { html: decodeHtmlBuffer(buffer.slice(0, MAX_HTML_BYTES), contentType), finalUrl };
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener?.("abort", abortFromParent);
  }
}

export async function readArticle(item, fetcher = fetch, { timeoutMs = ARTICLE_TOTAL_TIMEOUT_MS } = {}) {
  let url = String(item?.url || "");
  const controller = new AbortController();
  const totalTimeoutMs = Math.max(1_000, Number(timeoutMs) || ARTICLE_TOTAL_TIMEOUT_MS);
  const deadline = Date.now() + totalTimeoutMs;
  const timeout = setTimeout(() => {
    if (!controller.signal.aborted) controller.abort("Tempo total da leitura excedido");
  }, totalTimeoutMs);
  const remaining = (limit) => Math.max(250, Math.min(limit, deadline - Date.now()));
  try {
    url = validateArticleUrl(url);
    const first = await fetchArticleHtml(url, fetcher, remaining(ARTICLE_FETCH_TIMEOUT_MS), controller.signal);
    let extracted = extractArticleFromHtml(first.html, item);
    let extractionUrl = first.finalUrl;
    if (extracted.wordCount < MIN_ARTICLE_WORDS && deadline - Date.now() > 900) {
      const ampUrl = linkedPageUrl(first.html, first.finalUrl, "amphtml");
      if (ampUrl && ampUrl !== first.finalUrl) {
        try {
          const amp = await fetchArticleHtml(ampUrl, fetcher, remaining(AMP_FETCH_TIMEOUT_MS), controller.signal);
          const ampExtracted = extractArticleFromHtml(amp.html, item);
          if (ampExtracted.wordCount > extracted.wordCount) {
            extracted = { ...ampExtracted, method: `amp-${ampExtracted.method}` };
            extractionUrl = amp.finalUrl;
          }
        } catch {}
      }
    }
    if (extracted.wordCount < MIN_ARTICLE_WORDS) throw new Error("Conteúdo principal insuficiente ou bloqueado pelo portal");
    return {
      ok: true,
      url,
      extractionUrl,
      sourceName: item?.sourceName || item?.collectorName || "Fonte não informada",
      title: extracted.title || item?.title || "Notícia sem título",
      publishedAt: extracted.publishedAt || item?.publishedAt || null,
      byline: extracted.byline || null,
      wordCount: extracted.wordCount,
      contentLevel: "article",
      readMode: "full-article",
      extractionMethod: extracted.method,
      content: extracted.content,
      error: null,
    };
  } catch (error) {
    const timedOut = controller.signal.aborted || /tempo limite|tempo total/i.test(String(error?.message || error));
    return {
      ok: false,
      url,
      extractionUrl: null,
      sourceName: item?.sourceName || item?.collectorName || "Fonte não informada",
      title: item?.title || "Notícia sem título",
      publishedAt: item?.publishedAt || null,
      byline: null,
      wordCount: 0,
      contentLevel: null,
      readMode: timedOut ? "timeout" : "failed",
      extractionMethod: null,
      content: "",
      error: timedOut ? "Tempo limite da leitura direta; usado o conteúdo disponível no feed" : error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function sourceStatFor(sourceStats, hostname) {
  if (!hostname || !sourceStats) return null;
  if (sourceStats instanceof Map) return sourceStats.get(hostname) || null;
  return sourceStats[hostname] || null;
}

function rankedPortalItems(topic, sourceStats = null) {
  const items = Array.isArray(topic?.items) ? topic.items : [];
  const seen = new Set();
  const candidates = [];
  for (const item of items) {
    if (item?.kind === "social" || !plainText(item?.title)) continue;
    const identity = String(item?.url || item?.id || `${item?.sourceName}|${item?.title}`);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const collected = collectedContent(item);
    const levelScore = collected.level === "content" ? 70 : collected.level === "summary" ? 38 : 6;
    const hasUrl = /^https?:\/\//i.test(String(item?.url || ""));
    const publishedAt = Date.parse(item?.publishedAt || 0);
    const ageHours = Number.isFinite(publishedAt) ? Math.max(0, (Date.now() - publishedAt) / 3_600_000) : 48;
    const freshnessScore = Math.max(0, 20 - Math.min(20, ageHours * 1.25));
    const relevanceScore = Math.round(tokenCoverage(topic?.title || "", `${item?.title || ""} ${item?.description || ""}`) * 25);
    const hostname = canonicalHostname(item?.url);
    const urlSignals = publisherUrlSignals(item);
    const stats = sourceStatFor(sourceStats, hostname);
    const attempts = Number(stats?.attempts) || 0;
    const successes = Number(stats?.successes) || 0;
    const historicalRate = attempts ? successes / attempts : 0.5;
    const reliabilityScore = attempts >= 3 ? Math.round(historicalRate * 35) : 17;
    const contentScore = Math.min(42, collected.wordCount / 4);
    const directPublisherScore = urlSignals.directPublisher ? 40 : urlSignals.aggregator ? 0 : 12;
    const score = levelScore + contentScore + freshnessScore + relevanceScore + reliabilityScore + directPublisherScore + (hasUrl ? 25 : 0);
    candidates.push({
      item,
      hasUrl,
      directPublisher: urlSignals.directPublisher,
      score,
      hostname,
      reasons: {
        contentLevel: collected.level,
        contentWords: collected.wordCount,
        relevanceScore,
        freshnessScore: Math.round(freshnessScore),
        reliabilityScore,
        historicalAttempts: attempts,
        historicalSuccessRate: attempts ? Number(historicalRate.toFixed(2)) : null,
        directPublisherUrl: urlSignals.directPublisher,
        aggregatorUrl: urlSignals.aggregator,
        declaredPublisherDomain: urlSignals.declaredHostname || null,
      },
      publishedAt: Number.isFinite(publishedAt) ? publishedAt : 0,
    });
  }
  const readable = candidates.filter((candidate) => candidate.hasUrl);
  readable.sort((left, right) => {
    if (left.directPublisher !== right.directPublisher) return left.directPublisher ? -1 : 1;
    return right.score - left.score || right.publishedAt - left.publishedAt;
  });
  return readable.map((candidate) => ({
    item: candidate.item,
    score: Math.round(candidate.score),
    reasons: candidate.reasons,
    hostname: candidate.hostname,
    candidatesEvaluated: candidates.length,
  }));
}

function singlePortalItem(topic, sourceStats = null) {
  return rankedPortalItems(topic, sourceStats)[0] || null;
}

function publisherArticleVerified(record) {
  if (!record) return false;
  const mode = String(record.readMode || "");
  const directArticle = /^full-article(?:-cache)?$/.test(mode)
    && record.contentLevel === "article"
    && wordCount(record.content) >= MIN_ARTICLE_WORDS;
  const publisherFeed = mode === "publisher-feed-verified"
    && record.contentLevel === "article"
    && record.publisherFeedVerified === true
    && wordCount(record.content) >= MIN_VERIFIED_PUBLISHER_FEED_WORDS;
  if (!directArticle && !publisherFeed) return false;
  const resolvedUrl = record.extractionUrl || record.url || record.originalUrl;
  const hostname = canonicalHostname(resolvedUrl);
  return Boolean(hostname && !isAggregatorHostname(hostname));
}

function collectedContent(item) {
  const parts = [];
  const seen = new Set();
  const add = (value, method) => {
    const text = plainText(value).slice(0, MAX_ARTICLE_CHARS).trim();
    const key = text.toLocaleLowerCase("pt-BR");
    if (!text || seen.has(key)) return;
    seen.add(key);
    parts.push({ text, method });
  };
  add(item?.content, item?.contentSource || "feed-content");
  add(item?.contentEncoded, "feed-content");
  add(item?.description, "feed-description");
  add(item?.contentSnippet, "feed-summary");
  add(item?.summary, "feed-summary");
  if (!parts.length) add(item?.title, "title-only");
  const content = parts.map((part) => part.text).join("\n\n").slice(0, MAX_ARTICLE_CHARS).trim();
  const count = wordCount(content);
  const hasFullFeedContent = parts.some((part) => part.method === "feed-content") && count >= 60;
  const level = hasFullFeedContent ? "content" : count >= 18 ? "summary" : "title";
  return { content, wordCount: count, level, extractionMethod: parts[0]?.method || "title-only" };
}


function verifiedPublisherFeedRecord(item) {
  const collected = collectedContent(item);
  const signals = publisherUrlSignals(item);
  const text = collected.content;
  const count = collected.wordCount;
  const sourceMethod = String(item?.contentSource || collected.extractionMethod || "").toLowerCase();
  const collectionRoute = String(item?.collectionRoute || "").toLowerCase();
  const fromPublisherOwnedFeed = collectionRoute === "direct" || (!collectionRoute && signals.directPublisher && item?.aggregatorUrl !== true);
  const fullContentMethod = sourceMethod.includes("feed-content") || sourceMethod.includes("content:encoded") || sourceMethod.includes("rss-content");
  const descriptiveMethod = sourceMethod.includes("feed-description") || sourceMethod.includes("description");
  const minimumWords = fullContentMethod ? MIN_VERIFIED_PUBLISHER_FEED_WORDS : MIN_VERIFIED_PUBLISHER_DESCRIPTION_WORDS;
  const supportedMethod = fullContentMethod || descriptiveMethod;
  const looksTruncated = /(?:\.\.\.|…|continuar lendo|leia mais|saiba mais|clique aqui)\s*$/i.test(text) || /(?:continuar lendo|leia mais|saiba mais)\b/i.test(text.slice(-220));
  const relevance = tokenCoverage(item?.title || "", text);
  if (!fromPublisherOwnedFeed || !signals.directPublisher || !supportedMethod || count < minimumWords || looksTruncated || relevance < 0.10) return null;
  return {
    ok: true,
    url: item?.url || null,
    extractionUrl: item?.url || null,
    sourceName: item?.sourceName || item?.collectorName || "Fonte não informada",
    title: item?.title || "Notícia sem título",
    publishedAt: item?.publishedAt || null,
    byline: null,
    wordCount: count,
    contentLevel: "article",
    readMode: "publisher-feed-verified",
    extractionMethod: fullContentMethod ? "publisher-direct-feed-content" : "publisher-direct-feed-description",
    content: text,
    error: null,
    selectedArticleId: item?.id || null,
    originalUrl: item?.url || null,
    fallbackScope: "same-publisher-owned-feed",
    publisherFeedVerified: true,
    publisherFeedRoute: collectionRoute || "direct-compatible",
    publisherFeedMethod: sourceMethod || collected.extractionMethod || null,
    pageReadBlocked: true,
  };
}

export function expandTopicWithRoundCandidates(topic, payload, { maxExtra = 6 } = {}) {
  if (!topic || typeof topic !== "object") return topic;
  const original = Array.isArray(topic.items) ? topic.items : [];
  const seen = new Set(original.map((item) => String(item?.url || item?.id || "")).filter(Boolean));
  const references = [topic.title, ...original.map((item) => item?.title)].filter(Boolean);
  const pool = [];
  if (Array.isArray(payload?.items)) pool.push(...payload.items);
  for (const candidateTopic of Array.isArray(payload?.topics) ? payload.topics : []) {
    if (candidateTopic?.id === topic.id) continue;
    pool.push(...(Array.isArray(candidateTopic?.items) ? candidateTopic.items : []));
  }
  const ranked = [];
  for (const item of pool) {
    if (!item || item.kind === "social" || !/^https?:\/\//i.test(String(item.url || "")) || !plainText(item.title)) continue;
    const identity = String(item.url || item.id || "");
    if (!identity || seen.has(identity)) continue;
    let similarity = 0;
    for (const ref of references) similarity = Math.max(similarity, tokenSimilarity(ref, item.title || ""), tokenCoverage(ref, `${item.title || ""} ${item.description || ""}`));
    if (similarity < 0.42) continue;
    const published = item?.publishedAt ? Date.parse(item.publishedAt) : NaN;
    if (Number.isFinite(published) && Date.now() - published > 96 * 3_600_000) continue;
    ranked.push({ item, similarity });
  }
  ranked.sort((a, b) => b.similarity - a.similarity || Date.parse(b.item.publishedAt || 0) - Date.parse(a.item.publishedAt || 0));
  const extras = [];
  for (const entry of ranked) {
    const identity = String(entry.item.url || entry.item.id || "");
    if (seen.has(identity)) continue;
    seen.add(identity);
    extras.push({ ...entry.item, roundRelatedFallback: true, roundRelatedScore: Number(entry.similarity.toFixed(2)) });
    if (extras.length >= Math.max(0, Number(maxExtra) || 0)) break;
  }
  return extras.length ? { ...topic, items: [...original, ...extras], relatedRoundCandidatesAdded: extras.length } : topic;
}

function collectedRecord(item) {
  const collected = collectedContent(item);
  return {
    ok: Boolean(collected.content),
    url: /^https?:\/\//i.test(String(item?.url || "")) ? item.url : null,
    sourceName: item?.sourceName || item?.collectorName || "Fonte não informada",
    title: item?.title || "Notícia sem título",
    publishedAt: item?.publishedAt || null,
    byline: null,
    wordCount: collected.wordCount,
    contentLevel: collected.level,
    extractionMethod: collected.extractionMethod,
    content: collected.content,
    error: null,
    selectedArticleId: item?.id || null,
    originalUrl: /^https?:\/\//i.test(String(item?.url || "")) ? item.url : null,
    fallbackScope: "same-article",
  };
}


function articleReadCacheKey(item) {
  return stableHash([
    String(item?.url || ""),
    String(item?.title || ""),
    String(item?.publishedAt || ""),
    String(item?.content || item?.description || "").slice(0, 1_200),
  ].join("|"));
}

async function articleRecordWithFallback(item, fetcher, { timeoutMs = ARTICLE_TOTAL_TIMEOUT_MS, readCache = null } = {}) {
  const fallback = { ...collectedRecord(item), readMode: "feed-fallback", liveReadError: null, liveAttempted: false, cacheHit: false };
  if (!/^https?:\/\//i.test(String(item?.url || ""))) return fallback;
  const cacheKey = articleReadCacheKey(item);
  if (readCache?.get) {
    try {
      const cached = await readCache.get(cacheKey);
      if (cached?.content && wordCount(cached.content) >= MIN_ARTICLE_WORDS) {
        const cachedRecord = {
          ...cached,
          ok: true,
          readMode: "full-article-cache",
          contentLevel: "article",
          wordCount: wordCount(cached.content),
          cacheHit: true,
          liveAttempted: false,
          liveReadError: null,
          error: null,
          selectedArticleId: item?.id || cached.selectedArticleId || null,
          originalUrl: item?.url || cached.originalUrl || cached.url || null,
          fallbackScope: "same-article",
        };
        if (publisherArticleVerified(cachedRecord)) return cachedRecord;
      }
    } catch {}
  }
  const live = await readArticle(item, fetcher, { timeoutMs });
  if (live.ok && live.content) {
    const record = {
      ...live,
      selectedArticleId: item?.id || null,
      originalUrl: item?.url || live.url || null,
      fallbackScope: "same-article",
      fallbackWordCount: fallback.wordCount,
      liveReadError: null,
      liveAttempted: true,
      cacheHit: false,
    };
    if (readCache?.set) {
      try { await readCache.set(cacheKey, record); } catch {}
    }
    return record;
  }
  const publisherFeed = verifiedPublisherFeedRecord(item);
  if (publisherFeed) {
    return {
      ...publisherFeed,
      liveAttempted: true,
      liveReadError: live.error || "Página direta indisponível; conteúdo integral validado no feed oficial do portal",
      cacheHit: false,
    };
  }
  return {
    ...fallback,
    readMode: live.readMode === "timeout" ? "feed-timeout" : "feed-fallback",
    liveAttempted: true,
    liveReadError: live.error || "Matéria indisponível",
    error: live.error || null,
  };
}

async function reportProgress(callback, progress, stage, message) {
  if (typeof callback !== "function") return;
  try { await callback({ progress, stage, message }); } catch {}
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function withProgressHeartbeat(promise, callback, { intervalMs = ARTICLE_PROGRESS_HEARTBEAT_MS } = {}) {
  if (typeof callback !== "function") return promise;
  const wrapped = Promise.resolve(promise).then(
    (value) => ({ done: true, value }),
    (error) => ({ done: true, failed: true, error }),
  );
  const steps = [32, 46, 56];
  for (const progress of steps) {
    const state = await Promise.race([
      wrapped,
      new Promise((resolve) => setTimeout(() => resolve({ done: false }), Math.max(5, Number(intervalMs) || ARTICLE_PROGRESS_HEARTBEAT_MS))),
    ]);
    if (state.done) {
      if (state.failed) throw state.error;
      return state.value;
    }
    await reportProgress(callback, progress, "reading", "A matéria continua em leitura; mantendo a tarefa ativa.");
  }
  const state = await wrapped;
  if (state.failed) throw state.error;
  return state.value;
}

function readingQuality(records) {
  const totalWords = records.reduce((sum, item) => sum + item.wordCount, 0);
  const articleSources = records.filter((item) => item.contentLevel === "article").length;
  const contentSources = records.filter((item) => item.contentLevel === "content").length;
  const summarySources = records.filter((item) => item.contentLevel === "summary").length;
  const titleOnlySources = records.filter((item) => item.contentLevel === "title").length;
  const combined = records.map((item) => item.content || "").join("\n\n");
  const tokens = normalizedTokens(combined, 3);
  const uniqueTokenRatio = tokens.length ? new Set(tokens).size / tokens.length : 0;
  const paragraphCount = combined.split(/\n{2,}/).map((item) => plainText(item)).filter((item) => wordCount(item) >= 12).length;
  const titleMatch = records.length
    ? Math.max(...records.map((item) => tokenCoverage(item.title || "", item.content || "")))
    : 0;
  let code = "insufficient";
  let label = "Conteúdo insuficiente";
  if (
    ((articleSources >= 1 && totalWords >= 160) || (contentSources >= 1 && totalWords >= 260))
    && uniqueTokenRatio >= 0.32
    && titleMatch >= 0.12
  ) {
    code = "broad";
    label = articleSources ? "Leitura ampla e consistente" : "Conteúdo amplo do feed";
  } else if (
    totalWords >= 85
    && titleOnlySources === 0
    && uniqueTokenRatio >= 0.25
  ) {
    code = "partial";
    label = articleSources ? "Leitura parcial da matéria" : "Conteúdo parcial";
  } else if (totalWords >= 18 && titleOnlySources === 0) {
    code = "limited";
    label = "Conteúdo limitado";
  }
  const generationAllowed = code !== "insufficient";
  const copyAllowed = code === "broad";
  return {
    code,
    label,
    totalWords,
    articleSources,
    contentSources,
    summarySources,
    titleOnlySources,
    paragraphCount,
    uniqueTokenRatio: Number(uniqueTokenRatio.toFixed(2)),
    titleMatch: Number(titleMatch.toFixed(2)),
    generationAllowed,
    copyAllowed,
  };
}

function sentences(value) {
  const paragraphs = String(value || "")
    .replace(/\r/g, "\n")
    .split(/\n{2,}|\n/)
    .map((item) => repairArticleTypography(plainText(item)).trim())
    .filter(Boolean);
  const output = [];
  for (const paragraph of paragraphs) {
    const chunks = paragraph
      .split(/(?<=[.!?])\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ0-9“"])/)
      .map((item) => item.trim())
      .filter(Boolean);
    for (let chunk of chunks) {
      if (chunk.length < 25) continue;
      if (!/[.!?]$/.test(chunk) && wordCount(chunk) >= 7 && !/:\s*\d+(?:[.,]\d+)?%\s*$/.test(chunk)) chunk = `${chunk}.`;
      output.push(chunk);
    }
  }
  return output;
}

function firstMatchingSentence(list, pattern, fallback) {
  return compact(list.find((item) => pattern.test(item)) || fallback || "Não informado no conteúdo coletado pela ronda.", 360);
}

function heuristicEntities(text) {
  const people = [];
  const companies = [];
  const places = [];
  const dates = [];
  const themes = [];
  const keywords = [];
  const add = (list, value, limit = 8) => {
    const clean = compact(value, 80);
    if (clean && !list.some((item) => item.toLocaleLowerCase("pt-BR") === clean.toLocaleLowerCase("pt-BR")) && list.length < limit) list.push(clean);
  };
  for (const match of text.matchAll(/\b([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][\p{L}.-]+(?:\s+(?:de|da|do|dos|das|e)?\s*[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][\p{L}.-]+){1,3})\b/gu)) add(people, match[1]);
  for (const match of text.matchAll(/\b([A-Z][A-Za-z0-9&.-]+(?:\s+[A-Z][A-Za-z0-9&.-]+){0,3})\s+(?:S\.A\.|Ltda\.|Inc\.|Corp\.|Company|Banco|Ministério|Secretaria|Prefeitura|Governo)\b/g)) add(companies, match[0]);
  for (const match of text.matchAll(/\b(?:em|no|na|nos|nas)\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][\p{L}-]+(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][\p{L}-]+){0,2})\b/gu)) add(places, match[1]);
  for (const match of text.matchAll(/\b(?:\d{1,2}\s+de\s+[a-zç]+(?:\s+de\s+\d{4})?|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4})\b/gi)) add(dates, match[0]);
  const normalized = plainText(text).toLocaleLowerCase("pt-BR");
  const themeCatalog = ["política", "economia", "tecnologia", "saúde", "esportes", "segurança", "justiça", "meio ambiente", "educação", "cultura", "internacional"];
  themeCatalog.forEach((theme) => { if (normalized.includes(theme)) add(themes, theme); });
  const frequency = new Map();
  for (const token of normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]{5,}/g) || []) {
    if (/^(sobre|entre|ainda|tambem|foram|segundo|noticia|materia|quando|depois|antes|todos|todas|porque|porem|desde|apenas|conteudo|ronda)$/.test(token)) continue;
    frequency.set(token, (frequency.get(token) || 0) + 1);
  }
  [...frequency.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([token]) => add(keywords, token));
  return { people, companies, places, dates, themes, keywords };
}

function evidenceAngle(value) {
  const text = plainText(value).toLocaleLowerCase("pt-BR");
  if (/próxim|proxim|deverá|devera|previst|esperad|a partir|até o fim|etapa|cronograma|medida seguinte|desdobramento/.test(text)) return "next";
  if (/impact|consequ|efeito|risco|morte|mortes|afet|preju|benef|compromet|hospital|internad|vítim|vitim/.test(text)) return "impact";
  if (/oms|governo|minist|secretar|autoridad|afirm|disse|declar|anunci|informou|confirmou|orient|recomend|medida|resposta/.test(text)) return "response";
  if (/porque|devido|caus|provoc|origem|transmiss|decorr|associad|explica/.test(text)) return "cause";
  if (/\b\d+(?:[.,]\d+)?%?\b|milh|bilh|mil\b|casos|confirmad|percent|taxa|recorde/.test(text)) return "scale";
  if (/desde|antes|históric|historico|já havia|ja havia|primeir|anterior|em \d{4}|no ano/.test(text)) return "context";
  if (/\b(em|no|na|nos|nas)\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/u.test(String(value || ""))) return "place";
  return "event";
}

function evidenceRichness(value) {
  const text = plainText(value);
  let score = Math.min(4, wordCount(text) / 8);
  if (/\d/.test(text)) score += 2;
  if (/[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][\p{L}.-]+(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][\p{L}.-]+)+/u.test(text)) score += 1;
  if (/segundo|afirm|disse|informou|confirmou|de acordo|porque|devido|impact|risco|morte|casos|medida|previst/i.test(text)) score += 1.5;
  return score;
}

function completeEvidenceUnit(value) {
  let text = repairArticleTypography(plainText(value)).replace(/\s+/g, " ").trim();
  if (!text || wordCount(text) < 5) return "";
  if (/^[a-záàâãéêíóôõúç]/.test(text)) return "";
  if (/\b(?:de|da|do|das|dos|para|por|com|sem|em|no|na|nos|nas|e|ou|que|como|entre|sobre)$/i.test(text)) return "";
  if (!/[.!?]$/.test(text)) text = `${text.replace(/[,:;–—-]+$/, "").trim()}.`;
  return text;
}

function structuredStatisticUnits(value) {
  const text = repairArticleTypography(value);
  const matches = [...text.matchAll(/(?:^|[.;]\s+|\s{2,})([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][^:;.!?]{1,65}?):\s*(\d+(?:[.,]\d+)?%)/g)];
  if (matches.length < 2) return [];
  return matches.map((match) => completeEvidenceUnit(`${match[1].trim()}: ${match[2]}`)).filter(Boolean);
}

function evidenceUnits(sentence) {
  const text = completeEvidenceUnit(sentence);
  if (!text) return [];
  const statistics = structuredStatisticUnits(text);
  // Tabelas/placares colados costumam perder o cabeçalho semântico durante a extração.
  // É mais seguro ignorá-los do que transformar pares soltos em frases potencialmente enganosas.
  if (statistics.length >= 2) return [];
  const semicolonParts = text.split(/;\s+/).map(completeEvidenceUnit).filter(Boolean);
  if (semicolonParts.length >= 2) return semicolonParts;
  return [text];
}

function fallbackFactsFromArticle(article, limit = 24) {
  const contentSentences = sentences(article?.content || "");
  const candidates = [];
  for (const sentence of contentSentences) candidates.push(...evidenceUnits(sentence));
  if (plainText(article?.title)) candidates.push({ text: plainText(article.title), type: "headline" });
  if (article?.publishedAt && Number.isFinite(Date.parse(article.publishedAt))) {
    const publishedLabel = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(article.publishedAt));
    candidates.push({ text: `Data de publicação informada pelo portal: ${publishedLabel}.`, type: "publication" });
  }

  const output = [];
  for (const candidate of candidates) {
    const candidateText = typeof candidate === "object" ? candidate.text : candidate;
    const candidateType = typeof candidate === "object" ? candidate.type : "content";
    const evidence = editorialClip(candidateText, 240);
    const isHeadlineEvidence = candidateType === "headline";
    if (!evidence || wordCount(evidence) < (isHeadlineEvidence ? 3 : 5)) continue;
    if (/^[a-záàâãéêíóôõúç]/.test(evidence) || /%[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(evidence)) continue;
    if ((evidence.match(/%/g) || []).length >= 4 && (evidence.match(/:/g) || []).length >= 2) continue;
    // Evita duplicatas quase idênticas, mas preserva cláusulas diferentes da mesma frase quando trazem outro dado.
    if (output.some((fact) => tokenSimilarity(fact.evidence, evidence) >= 0.82)) continue;
    output.push({
      id: `fact-${output.length + 1}`,
      claim: editorialClip(candidateText, 220),
      evidence,
      angle: candidateType === "headline" ? "headline" : candidateType === "publication" ? "context" : evidenceAngle(evidence),
      headline: candidateType === "headline",
      metadata: candidateType === "publication",
      confidence: article?.contentLevel === "article" || article?.contentLevel === "content" ? "high" : "medium",
    });
    if (output.length >= limit) break;
  }
  return output;
}

function roleAnglePreferences(role) {
  if (role === "Título principal") return ["headline", "event", "scale", "impact", "response", "context"];
  if (role === "Contexto") return ["context", "place", "cause", "event", "response"];
  if (role === "Informação principal") return ["scale", "event", "response", "impact", "cause"];
  if (role.startsWith("Detalhamento")) return ["response", "cause", "scale", "place", "context", "event"];
  if (role === "Consequência") return ["impact", "risk", "scale", "response", "next"];
  if (role === "Conclusão") return ["next", "response", "impact", "context", "event"];
  return ["event", "scale", "response", "context", "impact", "next", "cause", "place"];
}

function selectDistinctFact(facts, usedIds, role, { avoidText = "" } = {}) {
  const preferences = roleAnglePreferences(role);
  if (role === "Título principal") {
    const headline = facts.find((fact) => fact.headline && !usedIds.has(fact.id));
    if (headline) return headline;
  }
  const ordinary = facts.filter((fact) => !usedIds.has(fact.id) && !fact.headline && !fact.metadata);
  const candidates = ordinary.length
    ? ordinary
    : facts.filter((fact) => !usedIds.has(fact.id) && !fact.headline);
  if (!candidates.length) return null;
  return candidates
    .map((fact, order) => {
      const angle = fact.angle || evidenceAngle(fact.evidence);
      const preferenceIndex = preferences.indexOf(angle);
      const preferenceScore = preferenceIndex < 0 ? 0 : (preferences.length - preferenceIndex) * 3;
      const duplicatePenalty = avoidText ? tokenSimilarity(avoidText, fact.evidence) * 12 : 0;
      const metadataPenalty = fact.metadata ? 12 : 0;
      return { fact, score: preferenceScore + evidenceRichness(fact.evidence) - duplicatePenalty - metadataPenalty - order * 0.01 };
    })
    .sort((left, right) => right.score - left.score)[0]?.fact || candidates[0];
}

function angleLabel(angle, role) {
  if (role === "Contexto") {
    if (angle === "cause") return "O que explica o cenário";
    if (angle === "place") return "Onde a notícia se concentra";
    return "O contexto da notícia";
  }
  if (role === "Informação principal") {
    if (angle === "scale") return "O principal dado";
    if (angle === "response") return "O que informam as autoridades";
    return "O ponto central";
  }
  if (role.startsWith("Detalhamento")) {
    if (angle === "response") return "Medidas e resposta";
    if (angle === "cause") return "Como o caso se explica";
    if (angle === "scale") return "Outro dado relevante";
    return "Um detalhe importante";
  }
  if (role === "Consequência") {
    if (angle === "impact") return "O impacto da situação";
    if (angle === "response") return "Efeitos e resposta";
    return "O que isso pode provocar";
  }
  if (role === "Conclusão") {
    if (angle === "next") return "Os próximos passos";
    if (angle === "response") return "Como a resposta continua";
    if (angle === "impact") return "O que fica em atenção";
    return "O que a matéria deixa claro";
  }
  if (angle === "scale") return "Os números da matéria";
  if (angle === "impact") return "Impacto registrado";
  if (angle === "response") return "Resposta das autoridades";
  if (angle === "cause") return "O que explica o caso";
  if (angle === "next") return "Próximos passos";
  if (angle === "context") return "O contexto anterior";
  if (angle === "place") return "Onde o caso acontece";
  return "Ponto central";
}

function roleTitle(role, primary, articleTitle = "") {
  if (role === "Título principal") return editorialClip(articleTitle || primary?.claim || primary?.evidence || "Notícia em destaque", MAX_SLIDE_TITLE_CHARS);
  if (primary?.metadata) return "Quando a matéria foi publicada";
  const evidence = plainText(primary?.claim || primary?.evidence || "");
  const firstClause = evidence.split(/[,;]|\s+—\s+/)[0].replace(/[.!?]+$/, "").trim();
  const clauseSimilarity = tokenSimilarity(firstClause, evidence);
  if (
    wordCount(firstClause) >= 3
    && firstClause.length >= 18
    && firstClause.length <= MAX_SLIDE_TITLE_CHARS
    && clauseSimilarity < 0.58
    && !/\b(?:de|da|do|das|dos|para|por|com|sem|em|no|na|nos|nas|e|ou|que|como|entre|sobre)$/i.test(firstClause)
  ) {
    return firstClause;
  }
  return angleLabel(primary?.angle || evidenceAngle(evidence), role);
}

function buildDistinctFallbackSlides(article, facts, slideCount) {
  const plan = carouselSlidePlan(slideCount);
  const factualSlides = plan.filter(([, role]) => role !== "CTA");
  if (facts.length < factualSlides.length) {
    const maximumSlides = Math.max(MIN_CAROUSEL_SLIDES, Math.min(MAX_CAROUSEL_SLIDES, facts.length + 1));
    const error = new Error(`A matéria possui ${facts.length} evidências distintas, insuficientes para ${factualSlides.length} slides informativos sem repetição. Para esta matéria, escolha no máximo ${maximumSlides} slides ou selecione outra fonte.`);
    error.code = "INSUFFICIENT_DISTINCT_EVIDENCE";
    throw error;
  }
  const usedIds = new Set();
  const usedTitles = new Set();
  const slides = [];
  let previousText = "";
  for (const [number, role] of plan) {
    if (role === "CTA") {
      slides.push({ number, role, title: "Continue acompanhando", subtitle: "Consulte a matéria original e acompanhe as próximas atualizações.", body: "Consulte a matéria original e acompanhe as próximas atualizações.", evidenceIds: [] });
      continue;
    }
    const primary = selectDistinctFact(facts, usedIds, role, {
      avoidText: `${previousText} ${role === "Título principal" ? article.title || "" : ""}`,
    });
    if (!primary) throw new Error("Não há evidências distintas suficientes para concluir o roteiro sem repetição.");
    usedIds.add(primary.id);
    let title = roleTitle(role, primary, article?.title || "");
    if (usedTitles.has(normalizedEvidenceText(title))) {
      title = angleLabel(primary?.angle || evidenceAngle(primary?.evidence), role);
      if (usedTitles.has(normalizedEvidenceText(title))) title = `${role}: ${title}`;
    }
    usedTitles.add(normalizedEvidenceText(title));
    let subtitle = editorialClip(completeEvidenceUnit(primary.evidence) || primary.evidence, MAX_SLIDE_SUBTITLE_CHARS);

    // Na capa, a manchete pode resumir o fato central; o deck deve acrescentar outro trecho da matéria.
    if (role === "Título principal" && tokenSimilarity(title, subtitle) >= 0.56) {
      const alternative = selectDistinctFact(facts, usedIds, role, { avoidText: `${title} ${previousText}` });
      if (alternative) {
        usedIds.add(alternative.id);
        subtitle = editorialClip(completeEvidenceUnit(alternative.evidence) || alternative.evidence, MAX_SLIDE_SUBTITLE_CHARS);
        slides.push({ number, role, title, subtitle, body: subtitle, evidenceIds: [primary.id, alternative.id] });
        previousText = `${title} ${subtitle}`;
        continue;
      }
    }

    slides.push({ number, role, title, subtitle, body: subtitle, evidenceIds: [primary.id] });
    previousText = `${title} ${subtitle}`;
  }
  return slides;
}

function maximumSupportedSlideCount(article, facts, requestedSlideCount = DEFAULT_CAROUSEL_SLIDES) {
  const requested = carouselSlidePlan(requestedSlideCount).length;
  for (let count = requested; count >= MIN_CAROUSEL_SLIDES; count -= 1) {
    try {
      buildDistinctFallbackSlides(article, facts, count);
      return count;
    } catch (error) {
      if (error?.code !== "INSUFFICIENT_DISTINCT_EVIDENCE" && !/evidências distintas|sem repetição|evidências suficientes/i.test(String(error?.message || error))) throw error;
    }
  }
  return 0;
}

function fallbackAnalysis(topic, articles, socialItems, slideCount = DEFAULT_CAROUSEL_SLIDES, preparedFacts = null) {
  const article = articles[0];
  const combined = articles.map((item) => `${item.title}. ${item.content}`).join("\n\n");
  const list = sentences(combined);
  const headline = compact(article?.title || topic?.title || "Assunto em acompanhamento", 110);
  const whatHappened = compact(list.slice(0, 2).join(" ") || article?.content || headline, 420);
  const context = compact(list.slice(2, 4).join(" ") || whatHappened, 420);
  const details = compact(list.slice(4, 7).join(" ") || context, 420);
  const impact = firstMatchingSentence(list, /impact|consequ|efeito|mudan|risco|benef|preju|custo|afeta|morte|casos/i, details);
  const repercussion = firstMatchingSentence(list, /repercuss|reação|critic|apoio|debate|manifest|resposta|afirm|disse|declar|anunci|medida/i, list.at(-1) || details);
  const entities = heuristicEntities(`${headline}\n${combined}`);
  const facts = Array.isArray(preparedFacts) && preparedFacts.length ? preparedFacts : fallbackFactsFromArticle(article, 36);
  const slides = buildDistinctFallbackSlides(article, facts, slideCount);
  return {
    questions: {
      whatHappened,
      who: entities.people.length || entities.companies.length ? [...entities.people, ...entities.companies].slice(0, 8).join(", ") : "Não informado com segurança na matéria lida.",
      where: entities.places.join(", ") || "Não informado com segurança na matéria lida.",
      when: entities.dates.join(", ") || articles.map((item) => item.publishedAt).filter(Boolean).slice(0, 2).join("; ") || "Não informado na matéria lida.",
      impact,
      repercussion,
    },
    entities,
    facts,
    slides,
  };
}

const FACT_ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "object",
      properties: {
        whatHappened: { type: "string" },
        who: { type: "string" },
        where: { type: "string" },
        when: { type: "string" },
        impact: { type: "string" },
        repercussion: { type: "string" },
      },
      required: ["whatHappened", "who", "where", "when", "impact", "repercussion"],
    },
    entities: {
      type: "object",
      properties: {
        people: { type: "array", items: { type: "string" } },
        companies: { type: "array", items: { type: "string" } },
        places: { type: "array", items: { type: "string" } },
        dates: { type: "array", items: { type: "string" } },
        themes: { type: "array", items: { type: "string" } },
        keywords: { type: "array", items: { type: "string" } },
      },
      required: ["people", "companies", "places", "dates", "themes", "keywords"],
    },
    facts: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          evidence: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["claim", "evidence", "confidence"],
      },
    },
  },
  required: ["questions", "entities", "facts"],
};

function carouselSchema(slideCount) {
  return {
    type: "object",
    properties: {
      slides: {
        type: "array",
        minItems: slideCount,
        maxItems: slideCount,
        items: {
          type: "object",
          properties: {
            number: { type: "integer" },
            role: { type: "string" },
            title: { type: "string" },
            subtitle: { type: "string" },
            evidenceIds: { type: "array", items: { type: "string" } },
          },
          required: ["number", "role", "title", "subtitle", "evidenceIds"],
        },
      },
    },
    required: ["slides"],
  };
}

function completeCarouselSchema(slideCount) {
  const slideSchema = carouselSchema(slideCount);
  return {
    type: "object",
    properties: {
      ...FACT_ANALYSIS_SCHEMA.properties,
      ...slideSchema.properties,
    },
    required: [...FACT_ANALYSIS_SCHEMA.required, "slides"],
  };
}

function normalizeList(value, limit = 10) {
  const output = [];
  for (const item of Array.isArray(value) ? value : []) {
    const text = compact(item, 90);
    if (text && !output.includes(text) && output.length < limit) output.push(text);
  }
  return output;
}

function normalizedEvidenceText(value) {
  return plainText(value)
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function articleGroundingText(article) {
  return `${article?.title || ""} ${article?.content || ""} ${article?.publishedAt || ""}`.trim();
}

function numericTokens(value) {
  return normalizedEvidenceText(value).match(/\b\d+(?:[.,]\d+)?%?\b/g) || [];
}

function unsupportedNumbers(value, articleText) {
  const allowed = new Set(numericTokens(articleText));
  return numericTokens(value).filter((token) => !allowed.has(token));
}

function factHasEvidence(fact, article) {
  const content = normalizedEvidenceText(articleGroundingText(article));
  const evidence = normalizedEvidenceText(fact?.evidence || "");
  if (!evidence || evidence.length < 16) return false;
  if (content.includes(evidence)) return true;
  return tokenSimilarity(evidence, content) >= 0.72 && unsupportedNumbers(evidence, content).length === 0;
}

function normalizeFacts(value, fallbackFacts, article) {
  const output = [];
  const sourceText = articleGroundingText(article);
  for (const raw of Array.isArray(value) ? value : []) {
    const fact = {
      claim: editorialClip(raw?.claim, 220),
      evidence: editorialClip(raw?.evidence, 240),
      confidence: ["high", "medium", "low"].includes(raw?.confidence) ? raw.confidence : "medium",
    };
    if (!fact.claim || !factHasEvidence(fact, article) || unsupportedNumbers(fact.claim, sourceText).length) continue;
    output.push({ ...fact, id: `fact-${output.length + 1}` });
    if (output.length >= 10) break;
  }
  return output.length ? output : fallbackFacts.map((fact, index) => ({ ...fact, id: `fact-${index + 1}` }));
}

function normalizeFactAnalysis(value, fallback, article) {
  const source = value && typeof value === "object" ? value : {};
  const questions = {};
  const sourceText = articleGroundingText(article);
  for (const key of ["whatHappened", "who", "where", "when", "impact", "repercussion"]) {
    const generated = editorialClip(source.questions?.[key], 360);
    questions[key] = generated && !unsupportedNumbers(generated, sourceText).length
      ? generated
      : editorialClip(fallback.questions[key], 360);
  }
  const entities = {};
  const articleEvidence = normalizedEvidenceText(articleGroundingText(article));
  for (const key of ["people", "companies", "places", "dates", "themes", "keywords"]) {
    const generated = normalizeList(source.entities?.[key]);
    const supported = generated.filter((item) => {
      const normalized = normalizedEvidenceText(item);
      if (!normalized) return false;
      if (articleEvidence.includes(normalized)) return true;
      return normalizedTokens(normalized).some((token) => articleEvidence.includes(token));
    });
    entities[key] = supported.length ? supported : normalizeList(fallback.entities[key]);
  }
  const facts = normalizeFacts(source.facts, fallback.facts, article);
  return { questions, entities, facts };
}

function normalizeSlides(value, fallback, facts, slideCount = DEFAULT_CAROUSEL_SLIDES) {
  const source = value && typeof value === "object" ? value : {};
  const rawSlides = Array.isArray(source.slides) ? source.slides : [];
  const plan = carouselSlidePlan(slideCount);
  return plan.map(([number, role], index) => {
    const fallbackSlide = fallback.slides[index] || fallback.slides.at(-1) || {};
    const subtitle = editorialClip(
      rawSlides[index]?.subtitle || rawSlides[index]?.body || fallbackSlide.subtitle || fallbackSlide.body || "",
      MAX_SLIDE_SUBTITLE_CHARS,
    );
    const requestedEvidence = normalizeList(rawSlides[index]?.evidenceIds, 4);
    const evidenceIds = requestedEvidence.filter((id) => facts.some((fact) => fact.id === id));
    const fallbackEvidence = fallbackSlide.evidenceIds?.filter((id) => facts.some((fact) => fact.id === id)) || [];
    return {
      number,
      role,
      title: editorialClip(rawSlides[index]?.title || fallbackSlide.title || role, MAX_SLIDE_TITLE_CHARS),
      subtitle,
      body: subtitle,
      // Nunca cai automaticamente em fact-1: cada fallback já possui um conjunto de evidências distinto.
      evidenceIds: evidenceIds.length ? evidenceIds : fallbackEvidence,
    };
  });
}


function slideHasSourceSupport(slide, facts, article) {
  if (slide?.role === "CTA") return true;
  const text = `${slide?.title || ""} ${slide?.subtitle || ""}`.trim();
  if (!text) return false;
  const referenced = (slide?.evidenceIds || [])
    .map((id) => facts.find((fact) => fact.id === id))
    .filter(Boolean);
  if (!referenced.length) return false;
  const evidenceText = referenced.map((fact) => `${fact.claim || ""} ${fact.evidence || ""}`).join(" ");
  const groundingText = `${articleGroundingText(article)} ${evidenceText}`;
  if (unsupportedNumbers(text, groundingText).length) return false;
  const subtitle = slide?.subtitle || "";
  const normalizedSubtitle = normalizedEvidenceText(subtitle);
  if (normalizedSubtitle && normalizedEvidenceText(evidenceText).includes(normalizedSubtitle)) return true;
  if (tokenCoverage(subtitle, evidenceText) >= 0.48) return true;
  return tokenCoverage(subtitle, articleGroundingText(article)) >= 0.84;
}

function slideLanguageProblems(slide) {
  if (slide?.role === "CTA") return [];
  const problems = [];
  const title = repairArticleTypography(slide?.title || "").trim();
  const subtitle = repairArticleTypography(slide?.subtitle || "").trim();
  if (title && /^[a-záàâãéêíóôõúç]/.test(title)) problems.push("title-starts-as-fragment");
  if (subtitle && /^[a-záàâãéêíóôõúç]/.test(subtitle)) problems.push("subtitle-starts-as-fragment");
  if (subtitle && !/[.!?]$/.test(subtitle)) problems.push("subtitle-not-closed");
  if (/\b(?:de|da|do|das|dos|para|por|com|sem|em|no|na|nos|nas|e|ou|que|como|entre|sobre)[.!?]?$/i.test(subtitle)) problems.push("subtitle-ends-as-fragment");
  if (/%[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(`${title} ${subtitle}`) || /[a-záàâãéêíóôõúç]{3,}[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]{2,}/.test(`${title} ${subtitle}`)) problems.push("concatenated-text");
  if ((subtitle.match(/%/g) || []).length >= 4 && (subtitle.match(/:/g) || []).length >= 2) problems.push("data-dump");
  if ((subtitle.match(/\(/g) || []).length !== (subtitle.match(/\)/g) || []).length) problems.push("unbalanced-parentheses");
  return problems;
}

function validateSlides(slides, fallbackSlides, facts, article) {
  const issues = [];
  const corrected = slides.map((slide) => ({ ...slide, evidenceIds: [...(slide.evidenceIds || [])] }));
  const sourceText = `${articleGroundingText(article)} ${facts.map((fact) => `${fact.claim || ""} ${fact.evidence || ""}`).join(" ")}`;
  const replaceWithFallback = (index, code, extra = {}) => {
    issues.push({ code, slide: index + 1, ...extra });
    corrected[index] = { ...fallbackSlides[index], evidenceIds: [...(fallbackSlides[index]?.evidenceIds || [])] };
  };

  for (let index = 0; index < corrected.length; index += 1) {
    const slide = corrected[index];
    if (!slide.title || !slide.subtitle) {
      replaceWithFallback(index, "empty-slide");
      continue;
    }
    const languageProblems = slideLanguageProblems(slide);
    if (languageProblems.length) {
      replaceWithFallback(index, "incoherent-language", { problems: languageProblems });
      continue;
    }
    const unsupported = unsupportedNumbers(`${slide.title} ${slide.subtitle}`, sourceText);
    if (unsupported.length) {
      replaceWithFallback(index, "unsupported-number", { values: unsupported });
      continue;
    }
    if (slide.role !== "CTA" && tokenSimilarity(slide.title, slide.subtitle) >= 0.68) {
      replaceWithFallback(index, "title-repeats-subtitle");
      continue;
    }
    if (!slideHasSourceSupport(slide, facts, article)) {
      replaceWithFallback(index, "unsupported-by-source");
    }
  }

  // Cada slide informativo precisa ter uma evidência principal diferente.
  const primaryOwner = new Map();
  for (let index = 0; index < corrected.length; index += 1) {
    const slide = corrected[index];
    if (slide.role === "CTA") continue;
    const primary = slide.evidenceIds?.[0];
    if (!primary) {
      replaceWithFallback(index, "missing-primary-evidence");
      continue;
    }
    if (primaryOwner.has(primary)) {
      replaceWithFallback(index, "reused-primary-evidence", { similarTo: primaryOwner.get(primary) + 1, evidenceId: primary });
    } else {
      primaryOwner.set(primary, index);
    }
  }

  // Detecta repetição semântica no texto final; o fallback é construído com ângulos distintos.
  for (let left = 0; left < corrected.length; left += 1) {
    if (corrected[left].role === "CTA") continue;
    for (let right = left + 1; right < corrected.length; right += 1) {
      if (corrected[right].role === "CTA") continue;
      const leftText = `${corrected[left].title} ${corrected[left].subtitle}`;
      const rightText = `${corrected[right].title} ${corrected[right].subtitle}`;
      if (tokenSimilarity(leftText, rightText) < 0.66 && tokenSimilarity(corrected[left].subtitle, corrected[right].subtitle) < 0.64) continue;
      replaceWithFallback(right, "repeated-slide", { similarTo: left + 1 });
    }
  }

  const finalPrimaryOwner = new Map();
  const finalProblems = corrected.flatMap((slide, index) => {
    const problems = [];
    if (!slide.title || !slide.subtitle) problems.push({ code: "empty-slide", slide: index + 1 });
    for (const problem of slideLanguageProblems(slide)) problems.push({ code: "incoherent-language", detail: problem, slide: index + 1 });
    if (unsupportedNumbers(`${slide.title} ${slide.subtitle}`, sourceText).length) problems.push({ code: "unsupported-number", slide: index + 1 });
    if ((slide.evidenceIds || []).some((id) => !facts.some((fact) => fact.id === id))) problems.push({ code: "invalid-evidence", slide: index + 1 });
    if (!slideHasSourceSupport(slide, facts, article)) problems.push({ code: "unsupported-by-source", slide: index + 1 });
    if (slide.role !== "CTA") {
      if (tokenSimilarity(slide.title, slide.subtitle) >= 0.68) problems.push({ code: "title-repeats-subtitle", slide: index + 1 });
      const primary = slide.evidenceIds?.[0];
      if (!primary) problems.push({ code: "missing-primary-evidence", slide: index + 1 });
      else if (finalPrimaryOwner.has(primary)) problems.push({ code: "reused-primary-evidence", slide: index + 1, similarTo: finalPrimaryOwner.get(primary) + 1 });
      else finalPrimaryOwner.set(primary, index);
    }
    return problems;
  });
  for (let left = 0; left < corrected.length; left += 1) {
    if (corrected[left].role === "CTA") continue;
    for (let right = left + 1; right < corrected.length; right += 1) {
      if (corrected[right].role === "CTA") continue;
      const leftText = `${corrected[left].title} ${corrected[left].subtitle}`;
      const rightText = `${corrected[right].title} ${corrected[right].subtitle}`;
      if (tokenSimilarity(leftText, rightText) >= 0.66 || tokenSimilarity(corrected[left].subtitle, corrected[right].subtitle) >= 0.64) {
        finalProblems.push({ code: "repeated-slide", slide: right + 1, similarTo: left + 1 });
      }
    }
  }
  const informativeSlides = corrected.filter((slide) => slide.role !== "CTA");
  const distinctPrimaryEvidence = new Set(informativeSlides.map((slide) => slide.evidenceIds?.[0]).filter(Boolean)).size;
  const evidenceCoverage = corrected.length
    ? corrected.filter((slide) => slide.role === "CTA" || slide.evidenceIds?.length).length / corrected.length
    : 0;
  return {
    slides: corrected.map((slide) => ({ ...slide, body: slide.subtitle })),
    report: {
      passed: finalProblems.length === 0,
      issues,
      finalProblems,
      correctedSlides: [...new Set(issues.map((issue) => issue.slide).filter(Boolean))],
      factCount: facts.length,
      evidenceCoverage: Number(evidenceCoverage.toFixed(2)),
      distinctPrimaryEvidence,
      informativeSlides: informativeSlides.length,
      noRepeatedAngles: distinctPrimaryEvidence === informativeSlides.length,
      limits: { titleChars: MAX_SLIDE_TITLE_CHARS, subtitleChars: MAX_SLIDE_SUBTITLE_CHARS },
    },
  };
}

function evidenceCarouselPrompt(topic, article, facts, slideCount, writingStyle = null) {
  const plan = carouselSlidePlan(slideCount);
  const styleText = writingStyle?.prompt || writingStyle?.instructions || "";
  const evidenceMap = facts.map((fact) => `${fact.id}: ${fact.evidence}`).join("\n");
  return [
    `ASSUNTO: ${compact(topic?.title || article.title, 180)}`,
    `EDITORIA: ${topic?.editoria || "Notícias"}`,
    `PORTAL LIDO: ${article.sourceName}`,
    `TÍTULO DA MATÉRIA LIDA: ${article.title}`,
    `DATA: ${article.publishedAt || "não informada"}`,
    `QUANTIDADE: ${slideCount} slides`,
    `ESTRUTURA OBRIGATÓRIA:\n${plan.map(([number, role]) => `${number}. ${role}`).join("\n")}`,
    styleText ? `PERFIL DE ESCRITA DO USUÁRIO:\n${String(styleText).slice(0, 3_000)}` : null,
    `EVIDÊNCIAS EXTRAÍDAS DO CONTEÚDO E DOS METADADOS DA MATÉRIA:\n${evidenceMap}`,
    "Sua função é somente REDIGIR os slides a partir das evidências acima. Não crie, complete, deduza ou acrescente fatos.",
    "COERÊNCIA OBRIGATÓRIA: cada subtítulo deve ser uma frase completa, gramaticalmente fechada, com sujeito ou ideia identificável e pontuação final. Nunca comece um slide no meio de uma oração.",
    "Não copie blocos de tabela, sequências de percentuais ou listas coladas. Quando a evidência trouxer números estruturados, transforme apenas os valores escolhidos em uma frase jornalística clara e fiel.",
    "O conjunto deve formar uma narrativa: capa apresenta o fato; contexto situa; informação principal entrega o dado central; detalhamentos acrescentam ângulos novos; consequência ou conclusão fecha o raciocínio; CTA não adiciona fato.",
    "Cada slide informativo deve referenciar em evidenceIds pelo menos uma evidência usada. Não cite IDs inexistentes.",
    "REGRA DE DIVERSIDADE: o primeiro evidenceId de cada slide informativo deve ser diferente do primeiro evidenceId de todos os outros slides. Cada slide precisa acrescentar uma informação factual nova.",
    "Não repita a manchete no subtítulo do slide 1. O subtítulo deve acrescentar outro dado, contexto, agente, número, impacto, resposta ou próximo passo presente nas evidências.",
    "Não use títulos genéricos como 'Entenda o cenário', 'O que aconteceu', 'Os principais detalhes' ou 'O que a matéria informa'. Prefira títulos específicos derivados do ângulo factual daquele slide.",
    "Não reformule a mesma informação para preencher papéis diferentes. Se uma evidência já foi o ângulo principal de um slide, use outra como ângulo principal no próximo.",
    "Você pode adaptar ritmo, clareza e tom do texto, mas não pode alterar nomes, datas, números, relações causais ou conclusões presentes nas evidências.",
    `Produza exatamente ${slideCount} slides. Título até ${MAX_SLIDE_TITLE_CHARS} caracteres; subtítulo até ${MAX_SLIDE_SUBTITLE_CHARS} caracteres, preferencialmente uma frase e no máximo duas. Toda frase deve terminar completa. Não aumente a quantidade de texto para compensar falta de informação.`,
    "No CTA, não acrescente informação factual nova; apenas convide o leitor a acompanhar ou consultar a matéria original.",
  ].filter(Boolean).join("\n\n").slice(0, MAX_PROMPT_CHARS);
}

async function runAiCarouselFromEvidence(ai, model, topic, article, facts, slideCount, writingStyle = null) {
  const response = await withTimeout(ai.run(model, {
    messages: [
      {
        role: "system",
        content: `Você é um redator jornalístico brasileiro. Os fatos já foram extraídos de UMA matéria publicada e são fornecidos como evidências. Você NÃO deve gerar fatos. Apenas redija exatamente ${slideCount} slides usando exclusivamente essas evidências. Cada slide informativo deve ter um ângulo factual diferente e um evidenceIds[0] diferente; não repita manchete, dado ou conclusão em slides distintos. Escreva frases completas e naturais; jamais devolva fragmentos de oração, tabelas coladas ou sequências de números sem contexto.`,
      },
      { role: "user", content: evidenceCarouselPrompt(topic, article, facts, slideCount, writingStyle) },
    ],
    response_format: { type: "json_schema", json_schema: carouselSchema(slideCount) },
    max_tokens: Math.min(3_000, 900 + slideCount * 150),
    temperature: 0.06,
    top_p: 0.72,
  }), AI_ANALYSIS_TIMEOUT_MS, "A redação inteligente excedeu o tempo limite");
  return safeJsonParse(response?.response ?? response?.result ?? response);
}

async function repairAiCarouselFromEvidence(ai, model, topic, article, facts, slideCount, writingStyle, slides, problems) {
  const evidenceMap = facts.map((fact) => `${fact.id}: ${fact.evidence}`).join("\n");
  const current = slides.map((slide) => `${slide.number}. ${slide.role}\nT: ${slide.title}\nS: ${slide.subtitle}\nE: ${(slide.evidenceIds || []).join(", ")}`).join("\n\n");
  const issueText = (problems || []).slice(0, 18).map((issue) => `slide ${issue.slide || "?"}: ${issue.code}${issue.detail ? ` (${issue.detail})` : ""}`).join("; ");
  const styleText = writingStyle?.prompt || writingStyle?.instructions || "";
  const response = await withTimeout(ai.run(model, {
    messages: [
      { role: "system", content: "Você revisa um carrossel jornalístico SEM acrescentar fatos. Corrija apenas clareza, gramática, frases incompletas, concatenações e progressão narrativa. Use exclusivamente as evidências fornecidas. Números, nomes e relações factuais não podem ser alterados nem criados." },
      { role: "user", content: [
        `ASSUNTO: ${compact(topic?.title || article.title, 180)}`,
        `PROBLEMAS DETECTADOS: ${issueText || "coerência e fluidez"}`,
        styleText ? `ESTILO: ${String(styleText).slice(0, 2600)}` : null,
        `EVIDÊNCIAS PERMITIDAS:\n${evidenceMap}`,
        `VERSÃO A CORRIGIR:\n${current}`,
        `Retorne exatamente ${slideCount} slides. Cada subtítulo deve ser uma frase completa e fechada. Preserve um primeiro evidenceId diferente em cada slide informativo. Não use tabelas coladas, fragmentos de oração ou fatos ausentes das evidências.`
      ].filter(Boolean).join("\n\n") }
    ],
    response_format: { type: "json_schema", json_schema: carouselSchema(slideCount) },
    max_tokens: Math.min(2_600, 800 + slideCount * 140),
    temperature: 0.03,
    top_p: 0.65,
  }), 8_000, "A revisão de coerência excedeu o tempo limite");
  return safeJsonParse(response?.response ?? response?.result ?? response);
}

function publicArticleRecord(article) {
  const { content: _content, ...record } = article;
  return record;
}

export function intelligentCarouselCacheKey(runId, topic, { slideCount = DEFAULT_CAROUSEL_SLIDES, styleKey = "default" } = {}) {
  const selected = singlePortalItem(topic);
  const item = selected?.item;
  const count = carouselSlidePlan(slideCount).length;
  const sourceFingerprint = [item?.url, item?.title, item?.publishedAt, item?.content, item?.description].filter(Boolean).join("|");
  return `smart-v11-${stableHash(`${runId || "latest"}|${topic?.id || "topic"}|${CAROUSEL_PROMPT_VERSION}|${count}|${styleKey || "default"}|${sourceFingerprint}`)}`;
}

export async function buildIntelligentCarousel(topic, {
  ai,
  model = ARTICLE_ANALYSIS_MODEL,
  fetcher = fetch,
  liveReading = true,
  onProgress = null,
  articleTimeoutMs = ARTICLE_TOTAL_TIMEOUT_MS,
  progressHeartbeatMs = ARTICLE_PROGRESS_HEARTBEAT_MS,
  sourceStats = null,
  readCache = null,
  slideCount = DEFAULT_CAROUSEL_SLIDES,
  writingStyle = null,
  styleKey = "default",
} = {}) {
  const totalStartedAt = Date.now();
  const requestedSlideCount = carouselSlidePlan(slideCount).length;
  const rankedSelections = rankedPortalItems(topic, sourceStats);
  if (!rankedSelections.length) throw new Error("Este assunto não possui link de portal disponível para apuração.");
  if (!liveReading) throw new Error("A leitura do site está desativada. O carrossel exige pelo menos uma matéria publicada e lida diretamente de um portal.");

  const readingStartedAt = Date.now();
  const maximumPublisherAttempts = Math.min(MAX_PUBLISHER_ATTEMPTS, rankedSelections.length);
  const attemptedSources = [];
  let selection = null;
  let selectedItem = null;
  let selectedRecord = null;
  let selectedFacts = null;
  let selectedSlideCount = requestedSlideCount;
  let bestReadableCandidate = null;

  await reportProgress(onProgress, READING_PROGRESS_START, "reading", `Procurando uma matéria publicada e legível entre até ${maximumPublisherAttempts} fonte${maximumPublisherAttempts === 1 ? "" : "s"}.`);

  const attemptCandidate = async (index) => {
    const candidateSelection = rankedSelections[index];
    const candidateItem = candidateSelection.item;
    const candidateSourceName = candidateItem.sourceName || candidateItem.collectorName || "Fonte não informada";
    const progress = 18 + Math.round((index / Math.max(1, maximumPublisherAttempts)) * 30);
    await reportProgress(onProgress, progress, "reading", `Abrindo matéria publicada por ${compact(candidateSourceName, 70)} (${index + 1}/${maximumPublisherAttempts}).`);
    let record;
    try {
      record = await withProgressHeartbeat(
        withTimeout(
          articleRecordWithFallback(candidateItem, fetcher, { timeoutMs: articleTimeoutMs, readCache }),
          Math.max(1_950, Number(articleTimeoutMs) || ARTICLE_TOTAL_TIMEOUT_MS) + 750,
          "Tempo limite da matéria selecionada excedido",
        ),
        onProgress,
        { intervalMs: progressHeartbeatMs },
      );
    } catch (error) {
      record = {
        ...collectedRecord(candidateItem),
        readMode: "failed",
        contentLevel: null,
        content: "",
        wordCount: 0,
        liveAttempted: true,
        cacheHit: false,
        liveReadError: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
        error: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
      };
    }
    record.selection = {
      score: candidateSelection.score,
      hostname: candidateSelection.hostname,
      candidatesEvaluated: candidateSelection.candidatesEvaluated,
      reasons: candidateSelection.reasons,
      directPublisherUrl: Boolean(candidateSelection.reasons?.directPublisherUrl),
      roundRelatedFallback: Boolean(candidateItem.roundRelatedFallback),
      roundRelatedScore: Number(candidateItem.roundRelatedScore) || null,
    };
    let facts = null;
    let supportedSlideCount = 0;
    if (publisherArticleVerified(record)) {
      facts = fallbackFactsFromArticle(record, 36);
      supportedSlideCount = maximumSupportedSlideCount(record, facts, requestedSlideCount);
      record.evidenceCount = facts.length;
      record.supportedSlideCount = supportedSlideCount;
    }
    return { index, selection: candidateSelection, item: candidateItem, record, facts, supportedSlideCount };
  };

  const considerResult = (candidateBundle) => {
    attemptedSources.push(publicArticleRecord(candidateBundle.record));
    if (!publisherArticleVerified(candidateBundle.record)) return false;
    if (!bestReadableCandidate || candidateBundle.supportedSlideCount > bestReadableCandidate.supportedSlideCount || (candidateBundle.supportedSlideCount === bestReadableCandidate.supportedSlideCount && (candidateBundle.facts?.length || 0) > (bestReadableCandidate.facts?.length || 0))) {
      bestReadableCandidate = candidateBundle;
    }
    if (candidateBundle.supportedSlideCount >= requestedSlideCount) {
      selection = candidateBundle.selection;
      selectedItem = candidateBundle.item;
      selectedRecord = candidateBundle.record;
      selectedFacts = candidateBundle.facts;
      selectedSlideCount = requestedSlideCount;
      return true;
    }
    return false;
  };

  const firstResult = await attemptCandidate(0);
  considerResult(firstResult);

  for (let startIndex = 1; !selectedRecord && startIndex < maximumPublisherAttempts; startIndex += PUBLISHER_READ_CONCURRENCY) {
    const indexes = Array.from({ length: Math.min(PUBLISHER_READ_CONCURRENCY, maximumPublisherAttempts - startIndex) }, (_, offset) => startIndex + offset);
    const results = await Promise.all(indexes.map((index) => attemptCandidate(index)));
    results.sort((a, b) => a.index - b.index);
    for (const result of results) {
      if (considerResult(result)) break;
    }
  }

  if (!selectedRecord && bestReadableCandidate?.supportedSlideCount >= MIN_CAROUSEL_SLIDES) {
    selection = bestReadableCandidate.selection;
    selectedItem = bestReadableCandidate.item;
    selectedRecord = bestReadableCandidate.record;
    selectedFacts = bestReadableCandidate.facts;
    selectedSlideCount = bestReadableCandidate.supportedSlideCount;
  }

  if ((!selectedRecord || !publisherArticleVerified(selectedRecord)) && bestReadableCandidate?.record && publisherArticleVerified(bestReadableCandidate.record)) {
    const evidenceCount = Number(bestReadableCandidate.facts?.length) || 0;
    const error = new Error(`A matéria foi lida, mas trouxe apenas ${evidenceCount} evidência${evidenceCount === 1 ? "" : "s"} editorial${evidenceCount === 1 ? "" : "is"} utilizável${evidenceCount === 1 ? "" : "is"}. São necessários pelo menos 3 blocos seguros para gerar um carrossel sem repetição.`);
    error.code = "INSUFFICIENT_DISTINCT_EVIDENCE";
    throw error;
  }

  if (!selectedRecord || !publisherArticleVerified(selectedRecord)) {
    const detail = attemptedSources
      .map((source) => `${source.sourceName}: ${source.liveReadError || source.error || "conteúdo principal não disponível"}`)
      .slice(0, 3)
      .join("; ");
    const error = new Error(`Não foi possível abrir e ler uma matéria publicada por um portal. O carrossel não foi gerado para evitar criar fatos.${detail ? ` Tentativas: ${detail}` : ""}`);
    error.code = "PUBLISHER_ARTICLE_UNAVAILABLE";
    throw error;
  }

  const selectedSourceName = selectedRecord.sourceName || selectedItem?.sourceName || selectedItem?.collectorName || "Fonte não informada";
  const collected = [selectedRecord];
  const readLabel = selectedRecord.readMode === "full-article-cache"
    ? "texto principal previamente extraído do site e recuperado do cache"
    : selectedRecord.readMode === "publisher-feed-verified"
      ? "conteúdo integral fornecido pelo feed oficial do próprio portal após bloqueio da página direta"
      : "texto principal extraído diretamente do site";
  await reportProgress(onProgress, READING_PROGRESS_END, "reading", `Matéria apurada: ${compact(selectedSourceName, 70)} — ${readLabel}.`);
  const readingDurationMs = Date.now() - readingStartedAt;

  const quality = readingQuality(collected);
  if (!quality.generationAllowed || quality.articleSources < 1) {
    throw new Error("A matéria lida não possui texto principal suficiente. O carrossel foi bloqueado para evitar inferências sem evidência.");
  }

  // Fatos, perguntas e entidades são extraídos deterministicamente do texto que veio do portal.
  // A IA, quando disponível, recebe apenas o mapa de evidências e atua somente na redação dos slides.
  const effectiveSlideCount = Math.max(MIN_CAROUSEL_SLIDES, Math.min(requestedSlideCount, Number(selectedSlideCount) || requestedSlideCount));
  selectedFacts = Array.isArray(selectedFacts) && selectedFacts.length ? selectedFacts : fallbackFactsFromArticle(selectedRecord, 36);
  const sourceAnalysis = fallbackAnalysis(topic, collected, [], effectiveSlideCount, selectedFacts);
  if (!sourceAnalysis.facts.length) {
    throw new Error("A matéria foi lida, mas não foi possível extrair evidências suficientes para montar o carrossel.");
  }
  await reportProgress(onProgress, 70, "analysis", `${sourceAnalysis.facts.length} evidências extraídas da matéria publicada.`);

  const factAnalysis = {
    questions: sourceAnalysis.questions,
    entities: sourceAnalysis.entities,
    facts: sourceAnalysis.facts,
  };
  let slideSource = { slides: sourceAnalysis.slides };
  let analysisMode = "source-extraction";
  let aiError = null;
  const aiStartedAt = Date.now();
  if (ai?.run) {
    try {
      await reportProgress(onProgress, 76, "analysis", `Redigindo ${effectiveSlideCount} slides somente com as evidências extraídas do site.`);
      const generated = await runAiCarouselFromEvidence(ai, model, topic, collected[0], factAnalysis.facts, effectiveSlideCount, writingStyle);
      if (!generated?.slides) throw new Error("A IA não retornou os slides em JSON válido");
      slideSource = generated;
      analysisMode = "ai-redaction-from-source-evidence";
      await reportProgress(onProgress, 88, "analysis", "Conferindo cada slide contra as evidências da matéria.");
    } catch (error) {
      aiError = error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180);
      slideSource = { slides: sourceAnalysis.slides };
      await reportProgress(onProgress, 88, "analysis", "IA indisponível ou lenta; usando redação determinística baseada nas frases da matéria.");
    }
  }
  const aiDurationMs = Date.now() - aiStartedAt;
  const normalizedFallbackSlides = normalizeSlides({ slides: sourceAnalysis.slides }, sourceAnalysis, factAnalysis.facts, effectiveSlideCount);
  let normalizedSlides = normalizeSlides(slideSource, sourceAnalysis, factAnalysis.facts, effectiveSlideCount);
  let validated = validateSlides(normalizedSlides, normalizedFallbackSlides, factAnalysis.facts, collected[0]);
  let coherenceRepairApplied = false;
  const coherenceIssues = (validated.report.issues || []).filter((issue) => ["incoherent-language", "repeated-slide", "title-repeats-subtitle"].includes(issue.code));
  if (ai?.run && coherenceIssues.length && analysisMode.startsWith("ai-")) {
    try {
      await reportProgress(onProgress, 90, "analysis", "Revisando coerência e completude das frases sem alterar os fatos.");
      const repaired = await repairAiCarouselFromEvidence(ai, model, topic, collected[0], factAnalysis.facts, effectiveSlideCount, writingStyle, normalizedSlides, coherenceIssues);
      if (repaired?.slides) {
        normalizedSlides = normalizeSlides(repaired, sourceAnalysis, factAnalysis.facts, effectiveSlideCount);
        const repairedValidation = validateSlides(normalizedSlides, normalizedFallbackSlides, factAnalysis.facts, collected[0]);
        if (repairedValidation.report.passed || repairedValidation.report.finalProblems.length < validated.report.finalProblems.length) {
          validated = repairedValidation;
          coherenceRepairApplied = true;
          analysisMode = "ai-redaction-source-evidence-coherence-repair";
        }
      }
    } catch (error) {
      aiError = aiError || (error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180));
    }
  }
  const editorialGate = {
    status: quality.copyAllowed && validated.report.passed ? "ready" : "review-required",
    copyAllowed: Boolean(quality.copyAllowed && validated.report.passed),
    reason: quality.copyAllowed
      ? validated.report.passed
        ? "Matéria de portal lida e roteiro validado contra as evidências extraídas."
        : "O roteiro precisa de revisão porque algum slide não ficou suficientemente sustentado pelas evidências."
      : `A qualidade foi classificada como ${quality.label.toLocaleLowerCase("pt-BR")}; revise a matéria antes de copiar.`,
  };

  await reportProgress(onProgress, 92, "finalizing", "Salvando o roteiro com o link da matéria usada na apuração.");
  const selectedResolvedUrl = /^https?:\/\//i.test(String(selectedRecord?.extractionUrl || ""))
    && !isAggregatorHostname(canonicalHostname(selectedRecord.extractionUrl))
    ? selectedRecord.extractionUrl
    : selectedRecord?.url;
  const verificationLinks = (topic?.items || []).filter((item) => /^https?:\/\//i.test(String(item?.url || ""))).map((item) => {
    const selected = item === selectedItem || (selectedItem?.id && item?.id === selectedItem.id) || item?.url === selectedItem?.url;
    const url = selected && /^https?:\/\//i.test(String(selectedResolvedUrl || "")) ? selectedResolvedUrl : item.url;
    return {
      title: compact(item.title || "Notícia sem título", 180),
      sourceName: item.sourceName || item.collectorName || "Fonte não informada",
      publishedAt: item.publishedAt || null,
      url,
      ...(url !== item.url ? { originalUrl: item.url } : {}),
    };
  }).filter((item, index, list) => list.findIndex((other) => other.url === item.url) === index);

  const alternativesAvailable = Math.max(0, (topic?.items || []).filter((item) => item?.kind !== "social" && /^https?:\/\//i.test(String(item?.url || "")) && item.url !== selectedItem?.url).length);
  const alternativesNotice = alternativesAvailable
    ? `${alternativesAvailable} ${alternativesAvailable === 1 ? "outra fonte estava disponível" : "outras fontes estavam disponíveis"}, mas o roteiro usa somente a matéria efetivamente lida.`
    : "Não havia outra fonte de portal disponível para leitura.";
  const slideAdjustmentNotice = effectiveSlideCount < requestedSlideCount
    ? ` A quantidade foi ajustada de ${requestedSlideCount} para ${effectiveSlideCount} slides porque esta foi a maior estrutura sustentada por evidências distintas sem repetição.`
    : "";
  const disclaimer = `Roteiro baseado exclusivamente no texto da matéria lida em ${selectedRecord.sourceName}. ${alternativesNotice} Nenhum fato é criado pela IA; a IA pode apenas redigir a partir das evidências extraídas.${slideAdjustmentNotice} Confirme o contexto no link original antes de publicar.`;

  return {
    language: "pt-BR",
    generatedAt: new Date().toISOString(),
    analysisMode,
    model: analysisMode.startsWith("ai-") ? model : null,
    aiError,
    voiceTone: writingStyle?.profile?.tone || writingStyle?.tone || "Jornalístico, factual e explicativo",
    postModel: `Instagram · ${effectiveSlideCount} slides · título + subtítulo${effectiveSlideCount < requestedSlideCount ? ` · ajustado de ${requestedSlideCount}` : ""}`,
    slideCount: effectiveSlideCount,
    requestedSlideCount,
    slideCountAdjusted: effectiveSlideCount < requestedSlideCount,
    slideCountAdjustmentReason: effectiveSlideCount < requestedSlideCount
      ? `A matéria sustenta ${effectiveSlideCount} slides distintos com segurança; ${requestedSlideCount} causariam repetição ou preenchimento sem evidência.`
      : null,
    writingProfile: writingStyle ? { active: true, updatedAt: writingStyle.updatedAt || null, sampleCount: Number(writingStyle.sampleCount) || 0, adaptiveMemoryCount: Number(writingStyle.adaptiveMemory?.count) || 0, mode: writingStyle.profile?.mode || writingStyle.mode || "custom" } : { active: false, adaptiveMemoryCount: 0 },
    promptVersion: CAROUSEL_PROMPT_VERSION,
    performance: {
      totalMs: Date.now() - totalStartedAt,
      readingMs: readingDurationMs,
      aiMs: aiDurationMs,
      fastPath: Boolean(selectedRecord.cacheHit),
      publisherAttempts: attemptedSources.length,
      coherenceRepairApplied,
      evidenceCount: factAnalysis.facts.length,
      requestedSlideCount,
      effectiveSlideCount,
    },
    cycle: {
      status: "completed",
      terminal: true,
      released: true,
      releasedAt: new Date().toISOString(),
      nextCycleAllowed: true,
    },
    reading: {
      basis: selectedRecord.readMode === "full-article-cache" ? "single-publisher-article-cache" : selectedRecord.readMode === "publisher-feed-verified" ? "single-publisher-full-feed" : "single-publisher-article",
      strategy: "publisher-required-with-alternatives",
      cycleMode: "one-read-article-one-script",
      cycleComplete: true,
      cycleStatus: "released",
      nextCycleAllowed: true,
      requested: attemptedSources.length,
      successful: 1,
      failed: Math.max(0, attemptedSources.length - 1),
      selectedSource: publicArticleRecord(selectedRecord),
      attemptedSources,
      alternativesAvailable,
      liveSuccessful: /^full-article(?:-cache)?$/.test(String(selectedRecord.readMode || "")) ? 1 : 0,
      publisherFeedSuccessful: selectedRecord.readMode === "publisher-feed-verified" ? 1 : 0,
      fallbackSources: 0,
      blockedSources: attemptedSources.filter((item) => item.liveReadError || item.error).length,
      publisherRequired: true,
      publisherVerified: true,
      factsGeneratedByAi: false,
      totalWords: quality.totalWords,
      quality: quality.code,
      qualityLabel: quality.label,
      articleSources: quality.articleSources,
      contentSources: quality.contentSources,
      summarySources: quality.summarySources,
      titleOnlySources: quality.titleOnlySources,
      paragraphCount: quality.paragraphCount,
      uniqueTokenRatio: quality.uniqueTokenRatio,
      titleMatch: quality.titleMatch,
      sources: collected.map(publicArticleRecord),
    },
    questions: factAnalysis.questions,
    entities: factAnalysis.entities,
    facts: factAnalysis.facts,
    slides: validated.slides,
    validation: validated.report,
    editorialGate,
    verificationLinks,
    disclaimer,
    cacheKey: intelligentCarouselCacheKey("generated", topic, { slideCount: requestedSlideCount, styleKey }),
  };
}

