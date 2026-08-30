import { plainText, stableHash } from "./parser.js";

function absoluteUrl(value, baseUrl) {
  try {
    const url = new URL(String(value || "").trim(), baseUrl);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function hostname(value) {
  try { return new URL(String(value || "")).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return ""; }
}

function sourceDomainAllowed(url, feed) {
  const host = hostname(url);
  const domains = Array.isArray(feed?.sourceDomains) ? feed.sourceDomains : [];
  if (!host || !domains.length) return Boolean(host);
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`));
}

function normalizedDate(value) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

function imageUrl(value, baseUrl) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate === "string") return absoluteUrl(candidate, baseUrl);
  if (candidate && typeof candidate === "object") {
    return absoluteUrl(candidate.url || candidate.contentUrl || candidate["@id"], baseUrl);
  }
  return null;
}

function nodeType(node) {
  const type = node?.["@type"];
  return (Array.isArray(type) ? type : [type]).map((value) => String(value || "").toLowerCase());
}

function articleLike(node) {
  const types = nodeType(node);
  return types.some((type) => ["newsarticle", "article", "reportagenewsarticle", "blogposting"].includes(type));
}

function jsonLdUrl(node, baseUrl) {
  const raw = node?.url
    || node?.mainEntityOfPage?.["@id"]
    || node?.mainEntityOfPage?.url
    || node?.["@id"];
  return absoluteUrl(raw, baseUrl);
}

function jsonLdItem(node, feed, baseUrl, cutoffMs, futureMs) {
  if (!node || typeof node !== "object" || !articleLike(node)) return null;
  const title = plainText(node.headline || node.name || "");
  const url = jsonLdUrl(node, baseUrl);
  const publishedAt = normalizedDate(node.datePublished || node.dateCreated || node.dateModified);
  const timestamp = Date.parse(publishedAt || "");
  if (!title || title.length < 12 || !url || !sourceDomainAllowed(url, feed)) return null;
  if (!Number.isFinite(timestamp) || timestamp < cutoffMs || timestamp > futureMs) return null;
  const description = plainText(node.description || node.abstract || "").slice(0, 900);
  return {
    id: `scrape-${feed.id}-${stableHash(url)}`,
    title: title.slice(0, 320),
    description,
    content: description,
    contentSource: description ? "html-jsonld-description" : "title-only",
    contentWordCount: description.split(/\s+/).filter(Boolean).length,
    sourceName: feed.name,
    collectorName: feed.name,
    publisherHomepageUrl: baseUrl,
    publisherDomain: hostname(baseUrl) || null,
    articleDomain: hostname(url) || null,
    directPublisherUrl: true,
    aggregatorUrl: false,
    region: feed.region || null,
    editorialHints: Array.isArray(feed.editorialHints) ? [...feed.editorialHints] : [],
    platform: "Portal",
    kind: "portal",
    publishedAt,
    updatedAt: normalizedDate(node.dateModified) || null,
    imageUrl: imageUrl(node.image, baseUrl),
    url,
    views: null,
    comments: null,
    likes: null,
    interactions: null,
    discoveryMethod: "html-jsonld",
  };
}

function walkJson(value, visitor, depth = 0) {
  if (depth > 12 || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, visitor, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  visitor(value);
  for (const child of Object.values(value)) {
    if (child && (Array.isArray(child) || typeof child === "object")) walkJson(child, visitor, depth + 1);
  }
}

function parseJsonLd(html, feed, baseUrl, cutoffMs, futureMs, limit) {
  const items = [];
  const seen = new Set();
  const expression = /<script\b[^>]*type\s*=\s*["'][^"']*ld\+json[^"']*["'][^>]*>([\s\S]*?)<\/script\s*>/gi;
  let match;
  let scripts = 0;
  while ((match = expression.exec(html)) && scripts < 80 && items.length < limit) {
    scripts += 1;
    let data;
    try { data = JSON.parse(String(match[1] || "").trim()); }
    catch { continue; }
    walkJson(data, (node) => {
      if (items.length >= limit) return;
      const item = jsonLdItem(node, feed, baseUrl, cutoffMs, futureMs);
      if (!item || seen.has(item.url)) return;
      seen.add(item.url);
      items.push(item);
    });
  }
  return items;
}

function attributeValue(tag, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\s*=\\s*["']([^"']+)["']`, "i").exec(String(tag || ""))?.[1] || null;
}

function articleBlockItem(block, feed, baseUrl, cutoffMs, futureMs) {
  const timeTag = /<time\b[^>]*>/i.exec(block)?.[0] || "";
  const publishedAt = normalizedDate(attributeValue(timeTag, "datetime") || attributeValue(timeTag, "content"));
  const timestamp = Date.parse(publishedAt || "");
  if (!Number.isFinite(timestamp) || timestamp < cutoffMs || timestamp > futureMs) return null;

  const patterns = [
    /<h[1-4]\b[^>]*>[\s\S]*?<a\b([^>]*)>([\s\S]*?)<\/a>[\s\S]*?<\/h[1-4]>/i,
    /<a\b([^>]*)>[\s\S]*?<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>[\s\S]*?<\/a>/i,
  ];
  let href = null;
  let title = "";
  for (const pattern of patterns) {
    const match = pattern.exec(block);
    if (!match) continue;
    href = attributeValue(match[1], "href");
    title = plainText(match[2]);
    if (href && title) break;
  }
  if (!href || !title || title.length < 12) return null;
  const url = absoluteUrl(href, baseUrl);
  if (!url || !sourceDomainAllowed(url, feed)) return null;
  const paragraph = plainText(/<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(block)?.[1] || "").slice(0, 900);
  return {
    id: `scrape-${feed.id}-${stableHash(url)}`,
    title: title.slice(0, 320),
    description: paragraph,
    content: paragraph,
    contentSource: paragraph ? "html-card-description" : "title-only",
    contentWordCount: paragraph.split(/\s+/).filter(Boolean).length,
    sourceName: feed.name,
    collectorName: feed.name,
    publisherHomepageUrl: baseUrl,
    publisherDomain: hostname(baseUrl) || null,
    articleDomain: hostname(url) || null,
    directPublisherUrl: true,
    aggregatorUrl: false,
    region: feed.region || null,
    editorialHints: Array.isArray(feed.editorialHints) ? [...feed.editorialHints] : [],
    platform: "Portal",
    kind: "portal",
    publishedAt,
    url,
    views: null,
    comments: null,
    likes: null,
    interactions: null,
    discoveryMethod: "html-article-card",
  };
}

function parseArticleBlocks(html, feed, baseUrl, cutoffMs, futureMs, limit, existing = new Set()) {
  const items = [];
  const expression = /<article\b[^>]*>[\s\S]*?<\/article\s*>/gi;
  let match;
  let scanned = 0;
  while ((match = expression.exec(html)) && scanned < 220 && items.length < limit) {
    scanned += 1;
    const item = articleBlockItem(match[0], feed, baseUrl, cutoffMs, futureMs);
    if (!item || existing.has(item.url)) continue;
    existing.add(item.url);
    items.push(item);
  }
  return items;
}

export function parseNewsHtml(htmlText, feed, baseUrl, cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000), limit = 24) {
  const html = String(htmlText || "").slice(0, 4_500_000);
  const cutoffMs = cutoff instanceof Date ? cutoff.getTime() : Date.parse(cutoff);
  const futureMs = Date.now() + 5 * 60 * 1000;
  if (!html || !Number.isFinite(cutoffMs)) return [];

  const jsonItems = parseJsonLd(html, feed, baseUrl, cutoffMs, futureMs, limit);
  const seen = new Set(jsonItems.map((item) => item.url));
  const cardItems = jsonItems.length < limit
    ? parseArticleBlocks(html, feed, baseUrl, cutoffMs, futureMs, limit - jsonItems.length, seen)
    : [];
  return [...jsonItems, ...cardItems]
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
    .slice(0, limit);
}


function headingLinkCandidate(href, title, feed, baseUrl, discoveredAt) {
  const cleanTitle = plainText(title).replace(/\s+/g," ").trim();
  if (!href || cleanTitle.length < 20 || cleanTitle.length > 320) return null;
  const url = absoluteUrl(href, baseUrl);
  if (!url || !sourceDomainAllowed(url, feed)) return null;
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments.at(-1) || "";
    const articleish = segments.length >= 3 || /noticia|news|202\d|\.html?$|\.ghtml$/i.test(parsed.pathname) || last.length >= 24;
    if (!articleish) return null;
  } catch { return null; }
  const now = normalizedDate(discoveredAt) || new Date().toISOString();
  return {
    id: `discover-${feed.id}-${stableHash(url)}`,
    title: cleanTitle.slice(0,320),
    description: "",
    content: "",
    contentSource: "homepage-heading",
    contentWordCount: 0,
    sourceName: feed.name,
    collectorName: feed.name,
    publisherHomepageUrl: baseUrl,
    publisherDomain: hostname(baseUrl) || null,
    articleDomain: hostname(url) || null,
    directPublisherUrl: true,
    aggregatorUrl: false,
    region: feed.region || null,
    editorialHints: Array.isArray(feed.editorialHints) ? [...feed.editorialHints] : [],
    platform: "Portal",
    kind: "portal",
    publishedAt: now,
    publishedAtEstimated: true,
    firstSeenAt: now,
    discoveredAt: now,
    url,
    views: null,
    comments: null,
    likes: null,
    interactions: null,
    discoveryMethod: "html-heading-first-seen",
  };
}

export function parseDiscoveryHtml(htmlText, feed, baseUrl, { limit = 60, discoveredAt = new Date().toISOString(), existingUrls = [] } = {}) {
  const html = String(htmlText || "").slice(0,4_500_000);
  if (!html) return [];
  const items = [];
  const seen = new Set((Array.isArray(existingUrls) ? existingUrls : []).filter(Boolean));
  const patterns = [
    /<h[1-4]\b[^>]*>[\s\S]*?<a\b([^>]*)>([\s\S]*?)<\/a>[\s\S]*?<\/h[1-4]>/gi,
    /<a\b([^>]*)>[\s\S]*?<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>[\s\S]*?<\/a>/gi,
  ];
  for (const expression of patterns) {
    let match;
    let scanned = 0;
    while ((match = expression.exec(html)) && scanned < 500 && items.length < Math.max(1,Number(limit)||60)) {
      scanned += 1;
      const href = attributeValue(match[1],"href");
      const candidate = headingLinkCandidate(href,match[2],feed,baseUrl,discoveredAt);
      if (!candidate || seen.has(candidate.url)) continue;
      seen.add(candidate.url);
      items.push(candidate);
    }
    if (items.length >= limit) break;
  }
  return items.slice(0,limit);
}
