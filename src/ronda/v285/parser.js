const NAMED_ENTITIES = Object.freeze({
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "…",
  laquo: "«",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  nbsp: " ",
  quot: '"',
  raquo: "»",
  rdquo: "”",
  rsquo: "’",
});

export function decodeEntities(value = "") {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => safeCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

function safeCodePoint(value) {
  try {
    return Number.isFinite(value) ? String.fromCodePoint(value) : "";
  } catch {
    return "";
  }
}

export function plainText(value = "") {
  return decodeEntities(
    String(value)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tagValue(block, names) {
  for (const name of names) {
    const escaped = escapeRegExp(name);
    const expression = new RegExp(
      `<(?:[a-z0-9_-]+:)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-z0-9_-]+:)?${escaped}\\s*>`,
      "i",
    );
    const match = expression.exec(block);
    const text = match ? plainText(match[1]) : "";
    if (text) return text;
  }
  return "";
}

function attributeValue(attributes, name) {
  const match = new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i").exec(attributes);
  return match ? decodeEntities(match[2]).trim() : "";
}

function linkValue(block) {
  const candidates = [];
  const paired = /<(?:[a-z0-9_-]+:)?link\b([^>]*)>([\s\S]*?)<\/(?:[a-z0-9_-]+:)?link\s*>/gi;
  const selfClosing = /<(?:[a-z0-9_-]+:)?link\b([^>]*?)\/?\s*>/gi;
  let match;

  while ((match = paired.exec(block))) {
    candidates.push({
      href: attributeValue(match[1], "href") || plainText(match[2]),
      rel: attributeValue(match[1], "rel"),
    });
  }
  while ((match = selfClosing.exec(block))) {
    const href = attributeValue(match[1], "href");
    if (href) candidates.push({ href, rel: attributeValue(match[1], "rel") });
  }

  const preferred = candidates.find((candidate) => !candidate.rel || candidate.rel === "alternate") ?? candidates[0];
  if (preferred?.href) return preferred.href;
  const guid = tagValue(block, ["guid", "id"]);
  return /^https?:\/\//i.test(guid) ? guid : "";
}

function sourceMetadata(block) {
  const match = /<(?:[a-z0-9_-]+:)?source\b([^>]*)>([\s\S]*?)<\/(?:[a-z0-9_-]+:)?source\s*>/i.exec(block);
  if (!match) return { name: "", url: "" };
  return {
    name: plainText(match[2]),
    url: attributeValue(match[1], "url") || attributeValue(match[1], "href"),
  };
}

function normalizedHostname(value = "") {
  try {
    return new URL(String(value)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function stableHash(value = "") {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const character of String(value)) {
    const code = character.codePointAt(0) ?? 0;
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + ((second << 6) >>> 0) + (second >>> 2);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

function isoDate(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function normalizedSourceLabel(value = "") {
  return plainText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sourceMatchesFeed(declaredSource, declaredSourceUrl, feed) {
  const aliases = Array.isArray(feed?.sourceAliases) ? feed.sourceAliases : [];
  const domains = Array.isArray(feed?.sourceDomains) ? feed.sourceDomains : [];
  if (!aliases.length && !domains.length) return true;

  const source = normalizedSourceLabel(declaredSource);
  const aliasMatch = source && aliases.some((alias) => {
    const normalizedAlias = normalizedSourceLabel(alias);
    return normalizedAlias && (source === normalizedAlias || source.includes(normalizedAlias) || normalizedAlias.includes(source));
  });
  if (aliasMatch) return true;

  const hostname = normalizedHostname(declaredSourceUrl);
  if (!hostname) return false;
  return domains.some((domain) => {
    const normalizedDomain = normalizedHostname(`https://${String(domain || "").replace(/^https?:\/\//i, "")}`);
    return normalizedDomain && (hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`) || normalizedDomain.endsWith(`.${hostname}`));
  });
}

export function parseFeed(xmlText, feed, cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000), limit = 40) {
  const xml = String(xmlText ?? "").slice(0, 3_000_000);
  const cutoffTime = cutoff instanceof Date ? cutoff.getTime() : Date.parse(cutoff);
  const now = Date.now() + 5 * 60 * 1000;
  const blocks = [];
  const itemExpression = /<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi;
  const entryExpression = /<entry\b[^>]*>([\s\S]*?)<\/entry\s*>/gi;
  let match;

  const scanLimit = Math.min(500, Math.max(limit * 2, Number(feed?.scanLimit) || 0));
  while ((match = itemExpression.exec(xml)) && blocks.length < scanLimit) blocks.push(match[1]);
  if (!blocks.length) {
    while ((match = entryExpression.exec(xml)) && blocks.length < scanLimit) blocks.push(match[1]);
  }

  const result = [];
  const seen = new Set();
  for (const block of blocks) {
    if (result.length >= limit) break;
    const title = tagValue(block, ["title"]);
    const declaredSourceMetadata = sourceMetadata(block);
    const declaredSource = declaredSourceMetadata.name;
    if (!sourceMatchesFeed(declaredSource, declaredSourceMetadata.url, feed)) continue;
    const feedDescription = tagValue(block, ["description", "summary"]);
    const feedContent = tagValue(block, ["encoded", "content"]);
    const collectedContent = feedContent || feedDescription;
    const storedContent = collectedContent.slice(0, 2_400);
    const publishedAt = isoDate(tagValue(block, ["pubDate", "published", "updated", "date"]));
    const url = linkValue(block);
    const timestamp = Date.parse(publishedAt);
    if (!title || !url || !publishedAt || !/^https?:\/\//i.test(url)) continue;
    if (!Number.isFinite(timestamp) || timestamp < cutoffTime || timestamp > now || seen.has(url)) continue;
    seen.add(url);

    const articleHostname = normalizedHostname(url);
    const publisherHomepageUrl = /^https?:\/\//i.test(String(declaredSourceMetadata.url || "")) ? declaredSourceMetadata.url : null;
    const publisherDomain = normalizedHostname(publisherHomepageUrl);
    const aggregatorUrl = articleHostname === "news.google.com" || articleHostname.endsWith(".google.com") || articleHostname.endsWith(".googleusercontent.com");
    const directPublisherUrl = Boolean(articleHostname && !aggregatorUrl && (!publisherDomain || articleHostname === publisherDomain || articleHostname.endsWith(`.${publisherDomain}`) || publisherDomain.endsWith(`.${articleHostname}`)));

    result.push({
      id: `rss-${feed.id}-${stableHash(url)}`,
      title,
      description: (feedDescription || feedContent).slice(0, 900),
      content: storedContent,
      contentSource: feedContent ? "feed-content" : feedDescription ? "feed-description" : "title-only",
      contentWordCount: storedContent.split(/\s+/).filter(Boolean).length,
      sourceName: feed.canonicalSource ? feed.name : declaredSource || feed.name,
      collectorName: feed.name,
      publisherHomepageUrl,
      publisherDomain: publisherDomain || null,
      articleDomain: articleHostname || null,
      directPublisherUrl,
      aggregatorUrl,
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
    });
  }
  return result;
}
