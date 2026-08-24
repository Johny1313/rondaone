// Ronda Editorial 2.0.1 — bundle autossuficiente para Cloudflare Workers
// Gerado em 2026-07-24T16:35:54.507Z
const __module_src_parser_js = (() => {

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

function decodeEntities(value = "") {
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

function plainText(value = "") {
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

function stableHash(value = "") {
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

function parseFeed(xmlText, feed, cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000), limit = 40) {
  const xml = String(xmlText ?? "").slice(0, 3_000_000);
  const cutoffTime = cutoff instanceof Date ? cutoff.getTime() : Date.parse(cutoff);
  const now = Date.now() + 5 * 60 * 1000;
  const blocks = [];
  const itemExpression = /<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi;
  const entryExpression = /<entry\b[^>]*>([\s\S]*?)<\/entry\s*>/gi;
  let match;

  while ((match = itemExpression.exec(xml)) && blocks.length < limit * 2) blocks.push(match[1]);
  if (!blocks.length) {
    while ((match = entryExpression.exec(xml)) && blocks.length < limit * 2) blocks.push(match[1]);
  }

  const result = [];
  const seen = new Set();
  for (const block of blocks) {
    if (result.length >= limit) break;
    const title = tagValue(block, ["title"]);
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

    const declaredSource = tagValue(block, ["source"]);
    result.push({
      id: `rss-${feed.id}-${stableHash(url)}`,
      title,
      description: (feedDescription || feedContent).slice(0, 900),
      content: storedContent,
      contentSource: feedContent ? "feed-content" : feedDescription ? "feed-description" : "title-only",
      contentWordCount: storedContent.split(/\s+/).filter(Boolean).length,
      sourceName: feed.canonicalSource ? feed.name : declaredSource || feed.name,
      collectorName: feed.name,
      region: feed.region || null,
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

return { "decodeEntities": decodeEntities, "plainText": plainText, "stableHash": stableHash, "parseFeed": parseFeed };
})();

const __module_src_clustering_js = (() => {
const { plainText, stableHash } = __module_src_parser_js;


const STOPWORDS = new Set([
  "a", "ao", "aos", "as", "com", "como", "da", "das", "de", "do", "dos", "e", "em", "entre", "foi", "ha",
  "mais", "na", "nas", "no", "nos", "o", "os", "ou", "para", "por", "que", "se", "sem", "ser", "sob", "sobre",
  "um", "uma", "vai", "apos", "ante", "ate", "contra", "durante", "noticia", "noticias", "hoje", "veja", "diz",
  "afirma", "novo", "nova", "brasil", "brasileiro", "brasileira",
]);

function normalizeText(value = "") {
  return plainText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleTokens(title) {
  const output = [];
  const seen = new Set();
  for (const token of normalizeText(title).split(/\s+/)) {
    if (token.length < 3 || STOPWORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    output.push(token);
    if (output.length >= 14) break;
  }
  return output;
}

function tokenSimilarity(left, right) {
  if (!left.length || !right.length) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let overlap = 0;
  for (const token of leftSet) if (rightSet.has(token)) overlap += 1;
  if (!overlap) return 0;
  const union = leftSet.size + rightSet.size - overlap;
  const minimum = Math.min(leftSet.size, rightSet.size);
  const jaccard = overlap / union;
  const containment = overlap / minimum;
  const bonus = overlap >= 3 ? 0.2 : overlap >= 2 ? 0.08 : 0;
  return Math.min(1, jaccard * 0.55 + containment * 0.45 + bonus);
}

const EDITORIA_RULES = Object.freeze([
  ["Esportes", ["futebol", "jogo", "partida", "campeonato", "brasileirao", "copa", "clube", "time", "jogador", "jogadora", "gol", "tecnico", "selecao", "formula 1", "f1", "basquete", "volei", "tenis", "olimpiada", "esporte"]],
  ["Política", ["presidente", "congresso", "senado", "camara", "deputado", "senador", "ministro", "governo", "eleicao", "eleitoral", "stf", "supremo", "partido", "prefeito", "governador", "planalto", "projeto de lei", "votacao", "politica"]],
  ["Entretenimento", ["filme", "serie", "novela", "musica", "cantor", "cantora", "atriz", "ator", "show", "festival", "televisao", "cinema", "streaming", "celebridade", "bbb", "reality", "oscar", "entretenimento"]],
  ["Economia", ["economia", "inflacao", "dolar", "bolsa", "juros", "banco", "mercado", "empresa", "emprego", "desemprego", "pib", "imposto", "investimento", "financeiro", "combustivel", "petroleo"]],
  ["Mundo", ["estados unidos", "eua", "trump", "guerra", "ucrania", "russia", "israel", "gaza", "china", "europa", "onu", "internacional", "exterior"]],
  ["Tecnologia", ["tecnologia", "inteligencia artificial", "ia", "internet", "aplicativo", "software", "celular", "smartphone", "google", "microsoft", "apple", "meta", "rede social", "digital"]],
  ["Saúde", ["saude", "doenca", "vacina", "hospital", "medico", "medicina", "virus", "covid", "medicamento", "tratamento", "epidemia", "paciente"]],
]);

function keywordMatch(text, keyword) {
  if (keyword.includes(" ")) return text.includes(keyword);
  return new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);
}

function classifyEditoria(items = []) {
  const text = normalizeText(items.map((item) => `${item?.title || ""} ${item?.description || ""}`).join(" "));
  let selected = "Notícias";
  let selectedScore = 0;
  for (const [editoria, keywords] of EDITORIA_RULES) {
    const score = keywords.reduce((total, keyword) => total + (keywordMatch(text, keyword) ? 1 : 0), 0);
    if (score > selectedScore) {
      selected = editoria;
      selectedScore = score;
    }
  }
  return selected;
}

function shorten(value, limit = 260) {
  const text = plainText(value);
  if (text.length <= limit) return text;
  const clipped = text.slice(0, limit + 1);
  const boundary = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, boundary > limit * 0.65 ? boundary : limit).trim()}…`;
}

function carouselTone(editoria, priority) {
  if (priority === "Pautar agora") return "Urgente, direto e factual";
  if (["Política", "Economia", "Mundo"].includes(editoria)) return "Informativo e analítico";
  if (["Saúde", "Tecnologia"].includes(editoria)) return "Explicativo e cauteloso";
  if (["Esportes", "Entretenimento"].includes(editoria)) return "Dinâmico e acessível";
  return "Informativo e objetivo";
}

function carouselModel(topic, normalizedText) {
  if (topic.priority === "Pautar agora") return "Instagram · Plantão em 7 slides";
  if (/\b(alerta|prazo|calendario|inscricao|como|servico|transito|previsao)\b/.test(normalizedText)) return "Instagram · Serviço em 7 slides";
  if ((topic.sourceNames?.length || topic.sourceCount || 0) >= 3 || (topic.items?.length || topic.itemCount || 0) >= 3) return "Instagram · Explicativo em 7 slides";
  if (["Esportes", "Entretenimento"].includes(topic.editoria)) return "Instagram · Destaques em 7 slides";
  return "Instagram · 7 slides";
}

function buildVerificationLinks(items = []) {
  const links = [];
  const seen = new Set();
  for (const item of items) {
    const url = String(item?.url || "").trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    links.push({
      title: shorten(item?.title || "Notícia sem título", 180),
      sourceName: item?.sourceName || item?.collectorName || "Fonte não informada",
      publishedAt: item?.publishedAt || null,
      url,
    });
  }
  return links;
}

function buildCarouselBrief(topic = {}) {
  const items = Array.isArray(topic.items) ? topic.items : [];
  const editoria = topic.editoria || classifyEditoria(items);
  const title = shorten(topic.title || items[0]?.title || "Assunto em acompanhamento", 120);
  const descriptions = [...new Set(items.map((item) => shorten(item?.description, 260)).filter((text) => text.length >= 25))];
  const relatedTitles = [...new Set(items.map((item) => shorten(item?.title, 120)).filter(Boolean))].slice(0, 3);
  const sources = [...new Set((topic.sourceNames || items.map((item) => item?.sourceName)).filter(Boolean))];
  const normalizedText = normalizeText(`${title} ${descriptions.join(" ")}`);
  const itemCount = Number(topic.itemCount) || items.length;
  const sourceCount = Number(topic.sourceCount) || sources.length;
  const displayedSourceCount = sourceCount || 1;
  const context = descriptions[0] || "A fonte não forneceu uma descrição completa. Use o título como ponto de partida e confirme os detalhes no link original.";
  const knownFacts = relatedTitles.length
    ? relatedTitles.map((item) => `• ${item}`).join("\n")
    : "• Consulte as fontes originais antes de fechar o texto.";
  const significance = sourceCount > 1
    ? `O assunto apareceu em ${sourceCount} fontes e reúne ${itemCount} conteúdos nesta ronda. A recorrência indica que merece acompanhamento editorial.`
    : `O assunto foi localizado em ${itemCount || 1} conteúdo nesta ronda. Busque uma segunda fonte independente antes de ampliar a pauta.`;
  const sourceLine = sources.length ? `Fontes monitoradas: ${sources.slice(0, 6).join(", ")}.` : "Fonte não informada pelo feed.";
  const verificationLinks = buildVerificationLinks(items);
  const callToAction = topic.priority === "Pautar agora"
    ? "Acompanhe as atualizações e confirme as informações nas fontes originais."
    : "Salve este carrossel e acompanhe os próximos desdobramentos.";

  return {
    language: "pt-BR",
    voiceTone: carouselTone(editoria, topic.priority),
    postModel: carouselModel({ ...topic, editoria }, normalizedText),
    disclaimer: "Prévia baseada nos títulos e descrições dos feeds. Use a Leitura Inteligente para abrir as matérias, extrair o conteúdo principal e gerar o roteiro final antes de publicar.",
    verificationLinks,
    slides: [
      { number: 1, role: "Título principal", title, body: `${editoria} · ${displayedSourceCount} ${displayedSourceCount === 1 ? "fonte monitorada" : "fontes monitoradas"}` },
      { number: 2, role: "Contexto", title: "Entenda o cenário", body: context },
      { number: 3, role: "Informação principal", title: "O que aconteceu", body: knownFacts },
      { number: 4, role: "Detalhamento", title: "O que precisa ser confirmado", body: `${sourceLine}
Abra os links originais para conferir nomes, números, datas e declarações.` },
      { number: 5, role: "Consequência", title: "Por que isso importa", body: significance },
      { number: 6, role: "Conclusão", title: "O que acompanhar agora", body: topic.priority === "Pautar agora" ? "O assunto exige atualização rápida e confirmação contínua nas fontes originais." : "Acompanhe novos fatos e procure uma segunda fonte independente antes de fechar a pauta." },
      { number: 7, role: "CTA", title: "Continue acompanhando", body: `${verificationLinks.length} ${verificationLinks.length === 1 ? "link de apuração disponível" : "links de apuração disponíveis"}.
${callToAction}` },
    ],
  };
}

function clusterItems(items, threshold = 0.36) {
  const clusters = [];
  const ordered = [...items].sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
  for (const item of ordered) {
    const tokens = titleTokens(item.title);
    if (!tokens.length) continue;
    let best = null;
    let bestScore = 0;
    for (const cluster of clusters) {
      const score = tokenSimilarity(tokens, cluster.tokens);
      if (score > bestScore) {
        best = cluster;
        bestScore = score;
      }
    }
    if (best && bestScore >= threshold) {
      best.items.push(item);
      best.tokens = [...new Set([...best.tokens, ...tokens])].slice(0, 18);
    } else {
      clusters.push({ tokens, items: [item] });
    }
  }
  return clusters;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function clusterToTopic(cluster, now = new Date()) {
  const items = [...cluster.items].sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
  const representative = items.find((item) => item.kind === "portal") ?? items[0];
  const sourceNames = [...new Set(items.map((item) => item.sourceName).filter(Boolean))];
  const portalCount = items.filter((item) => item.kind === "portal").length;
  const socialCount = items.length - portalCount;
  const comments = items.reduce((sum, item) => sum + positiveNumber(item.comments), 0);
  const interactions = items.reduce((sum, item) => sum + positiveNumber(item.interactions), 0);
  const views = items.reduce((sum, item) => sum + positiveNumber(item.views), 0);
  const lastPublishedAt = items[0]?.publishedAt ?? now.toISOString();
  const ageHours = Math.max(0, (now.getTime() - Date.parse(lastPublishedAt)) / 3_600_000);
  const channelFactor = Math.min(1, sourceNames.length / 5);
  const volumeFactor = Math.min(1, items.length / 8);
  const socialFactor = Math.min(1, Math.log10(interactions + 1) / 4);
  const freshnessFactor = Math.exp(-ageHours / 6);
  const score = Math.max(1, Math.min(100, Math.round(channelFactor * 35 + volumeFactor * 30 + socialFactor * 20 + freshnessFactor * 15)));

  const tone = score >= 70 ? "urgent" : score >= 45 ? "watch" : "neutral";
  const priority = score >= 70 ? "Pautar agora" : score >= 45 ? "Acompanhar" : "Em observação";
  const momentum = sourceNames.length >= 3
    ? `${sourceNames.length} fontes publicaram sobre o assunto`
    : items.length >= 2
      ? `${items.length} conteúdos relacionados`
      : "Assunto recém-detectado";
  const recommendation = sourceNames.length >= 3
    ? "Confirmar os fatos nas fontes originais e preparar uma abordagem própria."
    : socialCount > 0
      ? "Checar se a repercussão social cresce antes de priorizar a pauta."
      : "Acompanhar novas publicações e buscar uma segunda fonte independente.";

  const topic = {
    id: `topic-${stableHash(cluster.tokens.slice(0, 6).join("-"))}`,
    title: representative?.title ?? "Assunto sem título",
    editoria: classifyEditoria(items),
    priority,
    tone,
    score,
    lastPublishedAt,
    sourceNames,
    sourceCount: sourceNames.length,
    itemCount: items.length,
    portalCount,
    socialCount,
    views: views || null,
    comments: comments || null,
    interactions: interactions || null,
    momentum,
    recommendation,
    items,
  };
  return { ...topic, carousel: buildCarouselBrief(topic) };
}

function buildTopics(items, now = new Date(), limit = 40) {
  return clusterItems(items)
    .map((cluster) => clusterToTopic(cluster, now))
    .sort((left, right) => right.score - left.score || Date.parse(right.lastPublishedAt) - Date.parse(left.lastPublishedAt))
    .slice(0, limit);
}

return { "normalizeText": normalizeText, "titleTokens": titleTokens, "tokenSimilarity": tokenSimilarity, "classifyEditoria": classifyEditoria, "buildCarouselBrief": buildCarouselBrief, "clusterItems": clusterItems, "clusterToTopic": clusterToTopic, "buildTopics": buildTopics };
})();

const __module_src_article_reader_js = (() => {
const { decodeEntities, plainText, stableHash } = __module_src_parser_js;


const ARTICLE_ANALYSIS_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const ARTICLE_READER_LIMIT = 5;
const MAX_HTML_BYTES = 2_500_000;
const MAX_ARTICLE_CHARS = 8_000;
const MAX_PROMPT_CHARS = 30_000;
const MIN_ARTICLE_WORDS = 80;

const NOISE_PATTERN = /(ad-|ads|advert|anuncio|banner|breadcrumb|cookie|coment|comments|footer|header|menu|nav|newsletter|paywall|popup|promo|publicidade|recommend|related|share|sidebar|social|subscribe|widget)/i;
const NOISE_SENTENCE = /(assine|aceite os cookies|continuar lendo|conteúdo patrocinado|leia também|mais lidas|publicidade|receba nossa newsletter|siga-nos|todos os direitos reservados)/i;
const EXPECTED_SLIDES = [
  [1, "Título principal"],
  [2, "Contexto"],
  [3, "Informação principal"],
  [4, "Detalhamento"],
  [5, "Consequência"],
  [6, "Conclusão"],
  [7, "CTA"],
];

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
    const text = plainText(match[2]).replace(/\s+/g, " ").trim();
    const normalized = text.toLocaleLowerCase("pt-BR");
    if (text.length < 35 || text.length > 1_500 || NOISE_SENTENCE.test(text) || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(text);
  }
  return cleanArticleText(values.join("\n\n"));
}

function cleanArticleText(value) {
  const lines = String(value || "")
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => plainText(line).trim())
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
    /<(?:div|section)\b[^>]*(?:id|class)=["'][^"']*(?:article-body|article-content|content-article|materia|news-body|post-content|story-body|texto)[^"']*["'][^>]*>[\s\S]*?<\/(?:div|section)\s*>/gi,
  ];
  for (const pattern of patterns) {
    const matches = html.match(pattern) || [];
    candidates.push(...matches.slice(0, 12));
  }
  return candidates;
}

function extractArticleFromHtml(html, fallback = {}) {
  const raw = String(html || "").slice(0, MAX_HTML_BYTES);
  const structured = extractJsonLdArticle(raw);
  const title = structured?.title || metaContent(raw, "og:title") || metaContent(raw, "twitter:title") || compact(fallback.title, 240);
  const description = structured?.description || metaContent(raw, "description") || metaContent(raw, "og:description") || compact(fallback.description, 500);
  const byline = structured?.byline || metaContent(raw, "author");
  const publishedAt = structured?.publishedAt || metaContent(raw, "article:published_time") || fallback.publishedAt || null;

  if (structured?.content && wordCount(structured.content) >= MIN_ARTICLE_WORDS) {
    return { title, description, byline, publishedAt, content: structured.content, wordCount: wordCount(structured.content), method: structured.method };
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

function validateArticleUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new Error("URL da matéria inválida"); }
  if (!/^https?:$/.test(url.protocol) || isPrivateHostname(url.hostname)) throw new Error("URL da matéria não permitida");
  return url.toString();
}

async function fetchArticleHtml(url, fetcher) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("Tempo limite da matéria excedido"), 12_000);
  try {
    const response = await fetcher(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.6",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5",
        "User-Agent": "RondaEditorial/2.0 (+leitura editorial; contato pelo domínio do Worker)",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    validateArticleUrl(response.url || url);
    const contentType = response.headers.get("Content-Type") || "";
    if (contentType && !/html|xhtml|text\//i.test(contentType)) throw new Error("A URL não retornou uma página HTML");
    const length = Number(response.headers.get("Content-Length")) || 0;
    if (length > MAX_HTML_BYTES * 2) throw new Error("Página maior que o limite seguro");
    const buffer = new Uint8Array(await response.arrayBuffer());
    return decodeHtmlBuffer(buffer.slice(0, MAX_HTML_BYTES), contentType);
  } finally {
    clearTimeout(timeout);
  }
}

async function readArticle(item, fetcher = fetch) {
  const url = validateArticleUrl(item?.url);
  try {
    const html = await fetchArticleHtml(url, fetcher);
    const extracted = extractArticleFromHtml(html, item);
    if (extracted.wordCount < MIN_ARTICLE_WORDS) throw new Error("Conteúdo principal insuficiente ou bloqueado pelo portal");
    return {
      ok: true,
      url,
      sourceName: item?.sourceName || item?.collectorName || "Fonte não informada",
      title: extracted.title || item?.title || "Notícia sem título",
      publishedAt: extracted.publishedAt || item?.publishedAt || null,
      byline: extracted.byline || null,
      wordCount: extracted.wordCount,
      extractionMethod: extracted.method,
      content: extracted.content,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      url,
      sourceName: item?.sourceName || item?.collectorName || "Fonte não informada",
      title: item?.title || "Notícia sem título",
      publishedAt: item?.publishedAt || null,
      byline: null,
      wordCount: 0,
      extractionMethod: null,
      content: "",
      error: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
    };
  }
}

function distinctPortalItems(topic) {
  const items = Array.isArray(topic?.items) ? topic.items : [];
  const seen = new Set();
  const seenSources = new Set();
  const ordered = [...items]
    .filter((item) => item?.kind !== "social" && plainText(item?.title))
    .sort((left, right) => Date.parse(right.publishedAt || 0) - Date.parse(left.publishedAt || 0));
  const preferred = [];
  const remainder = [];
  for (const item of ordered) {
    const identity = String(item?.url || item?.id || `${item?.sourceName}|${item?.title}`);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const source = item.collectorName || item.sourceName || "Fonte não informada";
    if (!seenSources.has(source)) {
      seenSources.add(source);
      preferred.push(item);
    } else remainder.push(item);
  }
  return [...preferred, ...remainder].slice(0, ARTICLE_READER_LIMIT);
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
  };
}

function readingQuality(records) {
  const totalWords = records.reduce((sum, item) => sum + item.wordCount, 0);
  const contentSources = records.filter((item) => item.contentLevel === "content").length;
  const summarySources = records.filter((item) => item.contentLevel === "summary").length;
  const titleOnlySources = records.filter((item) => item.contentLevel === "title").length;
  let code = "insufficient";
  let label = "Conteúdo insuficiente";
  if (totalWords >= 280 && (contentSources >= 1 || records.length >= 3)) {
    code = "broad";
    label = "Conteúdo amplo";
  } else if (totalWords >= 90 || (records.length >= 2 && totalWords >= 55)) {
    code = "partial";
    label = "Conteúdo parcial";
  } else if (totalWords >= 8) {
    code = "limited";
    label = "Conteúdo limitado";
  }
  return { code, label, totalWords, contentSources, summarySources, titleOnlySources };
}

function sentences(value) {
  return plainText(value).split(/(?<=[.!?])\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ0-9])/).map((item) => item.trim()).filter((item) => item.length >= 25);
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

function fallbackAnalysis(topic, articles, socialItems) {
  const combined = articles.map((article) => `${article.title}. ${article.content}`).join("\n\n");
  const list = sentences(combined);
  const headline = compact(topic?.title || articles[0]?.title || "Assunto em acompanhamento", 110);
  const whatHappened = compact(list.slice(0, 2).join(" ") || topic?.items?.[0]?.description || headline, 420);
  const context = compact(list.slice(2, 4).join(" ") || articles[1]?.content || whatHappened, 420);
  const details = compact(list.slice(4, 7).join(" ") || articles.slice(1, 3).map((item) => item.content).join(" ") || context, 420);
  const impact = firstMatchingSentence(list, /impact|consequ|efeito|mudan|risco|benef|preju|custo|afeta|pode/i, details);
  const repercussion = socialItems.length
    ? `O assunto também apareceu em ${socialItems.length} publicação${socialItems.length === 1 ? "" : "ões"} do Bluesky monitoradas pela ronda.`
    : firstMatchingSentence(list, /repercuss|reação|critic|apoio|debate|manifest|resposta/i, "O conteúdo coletado ainda não detalha uma repercussão consolidada.");
  const entities = heuristicEntities(`${headline}\n${combined}`);
  const slides = [
    { number: 1, role: "Título principal", title: headline, subtitle: compact(whatHappened, 260) },
    { number: 2, role: "Contexto", title: "Entenda o cenário", subtitle: context },
    { number: 3, role: "Informação principal", title: "O que aconteceu", subtitle: whatHappened },
    { number: 4, role: "Detalhamento", title: "Os principais detalhes", subtitle: details },
    { number: 5, role: "Consequência", title: "Qual é o impacto", subtitle: impact },
    { number: 6, role: "Conclusão", title: "O que fica da notícia", subtitle: compact(repercussion, 360) },
    { number: 7, role: "CTA", title: "Acompanhe os desdobramentos", subtitle: "Consulte as fontes originais e acompanhe as próximas atualizações." },
  ].map((slide) => ({ ...slide, body: slide.subtitle }));
  return {
    questions: {
      whatHappened,
      who: entities.people.length || entities.companies.length ? [...entities.people, ...entities.companies].slice(0, 8).join(", ") : "Não informado com segurança no conteúdo coletado.",
      where: entities.places.join(", ") || "Não informado com segurança no conteúdo coletado.",
      when: entities.dates.join(", ") || articles.map((item) => item.publishedAt).filter(Boolean).slice(0, 2).join("; ") || "Não informado.",
      impact,
      repercussion,
    },
    entities,
    slides,
  };
}

const ANALYSIS_SCHEMA = {
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
    slides: {
      type: "array",
      minItems: 7,
      maxItems: 7,
      items: {
        type: "object",
        properties: {
          number: { type: "integer" },
          role: { type: "string" },
          title: { type: "string" },
          subtitle: { type: "string" },
        },
        required: ["number", "role", "title", "subtitle"],
      },
    },
  },
  required: ["questions", "entities", "slides"],
};

function normalizeList(value, limit = 10) {
  const output = [];
  for (const item of Array.isArray(value) ? value : []) {
    const text = compact(item, 90);
    if (text && !output.includes(text) && output.length < limit) output.push(text);
  }
  return output;
}

function normalizeAnalysis(value, fallback) {
  const source = value && typeof value === "object" ? value : {};
  const questions = {};
  for (const key of ["whatHappened", "who", "where", "when", "impact", "repercussion"]) {
    questions[key] = compact(source.questions?.[key] || fallback.questions[key], 440);
  }
  const entities = {};
  for (const key of ["people", "companies", "places", "dates", "themes", "keywords"]) {
    entities[key] = normalizeList(source.entities?.[key]?.length ? source.entities[key] : fallback.entities[key]);
  }
  const rawSlides = Array.isArray(source.slides) ? source.slides : [];
  const slides = EXPECTED_SLIDES.map(([number, role], index) => {
    const subtitle = compact(rawSlides[index]?.subtitle || rawSlides[index]?.body || fallback.slides[index]?.subtitle || fallback.slides[index]?.body || "", 460);
    return {
      number,
      role,
      title: compact(rawSlides[index]?.title || fallback.slides[index]?.title || role, 120),
      subtitle,
      body: subtitle,
    };
  });
  return { questions, entities, slides };
}

function promptFor(topic, articles, socialItems, quality) {
  const sourceBlocks = articles.map((article, index) => [
    `CONTEÚDO ${index + 1}`,
    `Portal: ${article.sourceName}`,
    `Título: ${article.title}`,
    `Data: ${article.publishedAt || "não informada"}`,
    `Tipo de conteúdo: ${article.contentLevel === "content" ? "texto fornecido pelo feed" : article.contentLevel === "summary" ? "resumo fornecido pelo feed" : "somente título"}`,
    `Conteúdo coletado na ronda:\n${article.content.slice(0, 5_500)}`,
  ].join("\n")).join("\n\n---\n\n");
  const social = socialItems.slice(0, 8).map((item) => `- ${item.sourceName}: ${compact(item.title, 260)} (${Number(item.interactions) || 0} interações observadas)`).join("\n") || "Nenhuma publicação social relacionada foi captada.";
  return `ASSUNTO DA RONDA: ${compact(topic?.title, 180)}\nEDITORIA: ${topic?.editoria || "Notícias"}\nQUALIDADE DO CONTEÚDO: ${quality.label}\n\n${sourceBlocks}\n\nSINAIS DE REPERCUSSÃO NO BLUESKY:\n${social}`.slice(0, MAX_PROMPT_CHARS);
}

async function runAiAnalysis(ai, model, topic, articles, socialItems, quality) {
  const response = await ai.run(model, {
    messages: [
      {
        role: "system",
        content: "Você é um editor jornalístico brasileiro. Analise somente o conteúdo que a ronda editorial já coletou dos feeds. Não afirme que leu a matéria completa. Não invente fatos, nomes, datas, locais, impacto ou repercussão. Quando a informação não estiver comprovada, escreva 'Não informado no conteúdo coletado'. Produza um carrossel em português do Brasil com exatamente 7 slides. Cada slide deve conter apenas título e subtítulo. Estrutura: título principal, contexto, informação principal, detalhamento, consequência, conclusão e CTA. Não use hashtags, emojis ou sensacionalismo.",
      },
      { role: "user", content: promptFor(topic, articles, socialItems, quality) },
    ],
    response_format: { type: "json_schema", json_schema: ANALYSIS_SCHEMA },
    max_tokens: 2_400,
    temperature: 0.15,
    top_p: 0.85,
  });
  return safeJsonParse(response?.response ?? response?.result ?? response);
}

function publicArticleRecord(article) {
  const { content: _content, ...record } = article;
  return record;
}

function intelligentCarouselCacheKey(runId, topic) {
  const items = (topic?.items || []).map((item) => [item?.url, item?.title, item?.content, item?.description].filter(Boolean).join("|")).filter(Boolean).sort();
  return `smart-v2-${stableHash(`${runId || "latest"}|${topic?.id || "topic"}|${items.join("||")}`)}`;
}

async function buildIntelligentCarousel(topic, { ai, model = ARTICLE_ANALYSIS_MODEL } = {}) {
  const requestedItems = distinctPortalItems(topic);
  if (!requestedItems.length) throw new Error("Este assunto não possui conteúdo de portal armazenado na ronda.");
  const collected = requestedItems.map(collectedRecord).filter((item) => item.content);
  if (!collected.length) throw new Error("A ronda não armazenou título ou resumo suficiente para este assunto.");
  const quality = readingQuality(collected);
  const socialItems = (topic?.items || []).filter((item) => item?.kind === "social");
  const fallback = fallbackAnalysis(topic, collected, socialItems);
  let analysis = fallback;
  let analysisMode = "fallback";
  let aiError = null;
  if (ai?.run) {
    try {
      const generated = await runAiAnalysis(ai, model, topic, collected, socialItems, quality);
      if (!generated) throw new Error("A IA não retornou JSON válido");
      analysis = normalizeAnalysis(generated, fallback);
      analysisMode = "ai";
    } catch (error) {
      aiError = error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180);
      analysis = normalizeAnalysis(fallback, fallback);
    }
  } else analysis = normalizeAnalysis(fallback, fallback);

  const verificationLinks = (topic?.items || []).filter((item) => /^https?:\/\//i.test(String(item?.url || ""))).map((item) => ({
    title: compact(item.title || "Notícia sem título", 180),
    sourceName: item.sourceName || item.collectorName || "Fonte não informada",
    publishedAt: item.publishedAt || null,
    url: item.url,
  })).filter((item, index, list) => list.findIndex((other) => other.url === item.url) === index);

  const disclaimer = quality.code === "broad"
    ? "Carrossel gerado com base no conteúdo coletado pela ronda editorial. Confirme nomes, números, datas e contexto nos links originais antes de publicar."
    : quality.code === "partial"
      ? "Carrossel baseado em títulos, textos e resumos fornecidos pelos feeds. Revise os links originais antes de publicar."
      : "Carrossel preliminar baseado em conteúdo limitado da ronda. Faça apuração manual antes de publicar.";

  return {
    language: "pt-BR",
    generatedAt: new Date().toISOString(),
    analysisMode,
    model: analysisMode === "ai" ? model : null,
    aiError,
    voiceTone: "Jornalístico, factual e explicativo",
    postModel: "Instagram · 7 slides · título + subtítulo",
    reading: {
      basis: "round-collected-content",
      requested: requestedItems.length,
      successful: collected.length,
      failed: 0,
      totalWords: quality.totalWords,
      quality: quality.code,
      qualityLabel: quality.label,
      contentSources: quality.contentSources,
      summarySources: quality.summarySources,
      titleOnlySources: quality.titleOnlySources,
      sources: collected.map(publicArticleRecord),
    },
    questions: analysis.questions,
    entities: analysis.entities,
    slides: analysis.slides,
    verificationLinks,
    disclaimer,
    cacheKey: intelligentCarouselCacheKey("generated", topic),
  };
}

return { "ARTICLE_ANALYSIS_MODEL": ARTICLE_ANALYSIS_MODEL, "ARTICLE_READER_LIMIT": ARTICLE_READER_LIMIT, "extractArticleFromHtml": extractArticleFromHtml, "validateArticleUrl": validateArticleUrl, "readArticle": readArticle, "intelligentCarouselCacheKey": intelligentCarouselCacheKey, "buildIntelligentCarousel": buildIntelligentCarousel };
})();

const __module_src_collector_js = (() => {
const { buildTopics, clusterItems, titleTokens } = __module_src_clustering_js;
const { parseFeed, plainText, stableHash } = __module_src_parser_js;



function googleNewsSource(source, region = "Brasil") {
  const locale = region === "Brasil"
    ? { hl: "pt-BR", gl: "BR", ceid: "BR:pt-419" }
    : { hl: "en-US", gl: "US", ceid: "US:en" };
  const query = encodeURIComponent(`when:1d source:${source.replace(/\s+/g, "_")}`);
  return `https://news.google.com/rss/search?q=${query}&hl=${locale.hl}&gl=${locale.gl}&ceid=${encodeURIComponent(locale.ceid)}`;
}

function feed(id, name, region, primaryUrl, googleSource = name) {
  return Object.freeze({
    id,
    name,
    region,
    canonicalSource: true,
    limit: region === "Mundo" ? 8 : 15,
    urls: Object.freeze([primaryUrl, googleNewsSource(googleSource, region)].filter(Boolean)),
  });
}

const FEEDS = Object.freeze([
  // Brasil — 17 portais
  feed("g1", "G1", "Brasil", "https://g1.globo.com/rss/g1/"),
  feed("cnn-brasil", "CNN Brasil", "Brasil", "https://www.cnnbrasil.com.br/feed/", "CNN Brasil"),
  feed("folha", "Folha de S.Paulo", "Brasil", "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml", "Folha de S.Paulo"),
  feed("estadao", "Estadão", "Brasil", null, "Estadão"),
  feed("o-globo", "O Globo", "Brasil", "https://oglobo.globo.com/rss.xml", "O Globo"),
  feed("veja", "Veja", "Brasil", "https://veja.abril.com.br/feed/"),
  feed("poder360", "Poder360", "Brasil", "https://www.poder360.com.br/feed/"),
  feed("agencia-brasil", "Agência Brasil", "Brasil", "https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml", "Agência Brasil"),
  feed("nexo", "Nexo Jornal", "Brasil", null, "Nexo Jornal"),
  feed("infomoney", "InfoMoney", "Brasil", "https://www.infomoney.com.br/feed/"),
  feed("money-times", "Money Times", "Brasil", "https://www.moneytimes.com.br/feed/", "Money Times"),
  feed("ge", "ge", "Brasil", "https://ge.globo.com/rss/ge/", "ge"),
  feed("canaltech", "Canaltech", "Brasil", "https://feeds2.feedburner.com/canaltechbr", "Canaltech"),
  feed("tecmundo", "TecMundo", "Brasil", "https://www.tecmundo.com.br/rss", "TecMundo"),
  feed("o-liberal", "O Liberal", "Brasil", "https://www.oliberal.com/rss", "O Liberal"),
  feed("metropoles", "Metrópoles", "Brasil", "https://www.metropoles.com/feed", "Metrópoles"),
  feed("campo-grande-news", "Campo Grande News", "Brasil", "https://www.campograndenews.com.br/rss", "Campo Grande News"),

  // Mundo — 13 portais
  feed("bbc", "BBC News", "Mundo", "https://feeds.bbci.co.uk/news/world/rss.xml", "BBC"),
  feed("guardian", "The Guardian", "Mundo", "https://www.theguardian.com/world/rss", "The Guardian"),
  feed("cnn", "CNN", "Mundo", "https://rss.cnn.com/rss/edition_world.rss", "CNN"),
  feed("new-york-times", "The New York Times", "Mundo", "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", "The New York Times"),
  feed("washington-post", "The Washington Post", "Mundo", "https://feeds.washingtonpost.com/rss/world", "The Washington Post"),
  feed("al-jazeera", "Al Jazeera", "Mundo", "https://www.aljazeera.com/xml/rss/all.xml", "Al Jazeera"),
  feed("france-24", "France 24", "Mundo", "https://www.france24.com/en/rss", "France 24"),
  feed("deutsche-welle", "Deutsche Welle", "Mundo", "https://rss.dw.com/rdf/rss-en-world", "Deutsche Welle"),
  feed("el-pais", "El País", "Mundo", "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada", "El País"),
  feed("euronews", "Euronews", "Mundo", "https://www.euronews.com/rss?format=mrss&level=theme&name=news", "Euronews"),
  feed("cbc", "CBC News", "Mundo", "https://www.cbc.ca/cmlink/rss-world", "CBC News"),
  feed("abc-australia", "ABC News Australia", "Mundo", "https://www.abc.net.au/news/feed/51120/rss.xml", "ABC News"),
  feed("infobae", "Infobae", "Mundo", "https://www.infobae.com/arc/outboundfeeds/rss/?outputType=xml", "Infobae"),
]);

const FEED_COUNTS = Object.freeze({
  Brasil: FEEDS.filter((item) => item.region === "Brasil").length,
  Mundo: FEEDS.filter((item) => item.region === "Mundo").length,
  total: FEEDS.length,
});

const PORTAL_SUBREQUEST_LIMIT = 44;

function compactError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "Erro desconhecido");
  return message.replace(/\s+/g, " ").trim().slice(0, 150);
}

async function fetchWithTimeout(url, fetcher, { accept, timeoutMs = 8_000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("Tempo limite excedido"), timeoutMs);
  try {
    const response = await fetcher(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: accept ?? "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.7",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeCharset(value) {
  const charset = String(value || "").trim().replace(/["']/g, "").toLowerCase();
  if (["iso-8859-1", "latin1", "latin-1", "windows-1252", "cp1252"].includes(charset)) return "windows-1252";
  if (["utf8", "utf-8"].includes(charset)) return "utf-8";
  if (["utf-16", "utf-16le", "utf-16be"].includes(charset)) return charset;
  return "utf-8";
}

async function decodeFeedResponse(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get("Content-Type") || "";
  const headerCharset = /charset\s*=\s*([^;\s]+)/i.exec(contentType)?.[1];
  const declarationSample = new TextDecoder("windows-1252").decode(bytes.slice(0, 300));
  const declarationCharset = /<\?xml[^>]+encoding\s*=\s*["']([^"']+)["']/i.exec(declarationSample)?.[1];
  return new TextDecoder(normalizeCharset(headerCharset || declarationCharset)).decode(bytes);
}

async function collectFeed(feed, cutoff, fetcher = fetch, requestBudget = null) {
  const errors = [];
  for (let index = 0; index < feed.urls.length; index += 1) {
    const url = feed.urls[index];
    try {
      if (requestBudget) {
        if (requestBudget.remaining <= 0) throw new Error("Limite seguro de consultas externas atingido");
        requestBudget.remaining -= 1;
      }
      const response = await fetchWithTimeout(url, fetcher);
      const xml = await decodeFeedResponse(response);
      const items = parseFeed(xml, feed, cutoff, Number(feed.limit) || 15);
      if (!items.length) throw new Error("Feed sem conteúdo válido nas últimas 24 horas");
      return {
        items,
        status: {
          id: feed.id,
          name: feed.name,
          region: feed.region || "Brasil",
          ok: true,
          count: items.length,
          error: null,
          fallback: index > 0,
        },
      };
    } catch (error) {
      errors.push(compactError(error));
    }
  }
  return {
    items: [],
    status: {
      id: feed.id,
      name: feed.name,
      region: feed.region || "Brasil",
      ok: false,
      count: 0,
      error: [...new Set(errors)].slice(0, 2).join(" | ") || "Fonte indisponível",
      fallback: false,
    },
  };
}

function uniqueItems(items, limit = Number.POSITIVE_INFINITY) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = item.url || item.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function blueskyItem(post, cutoff) {
  const text = plainText(post?.record?.text);
  const publishedAtValue = post?.record?.createdAt || post?.indexedAt;
  const timestamp = Date.parse(publishedAtValue);
  const handle = plainText(post?.author?.handle);
  const rkey = String(post?.uri ?? "").split("/").filter(Boolean).at(-1);
  if (!text || !handle || !rkey || !Number.isFinite(timestamp) || timestamp < cutoff.getTime()) return null;
  const comments = positiveNumber(post.replyCount);
  const likes = positiveNumber(post.likeCount);
  const reposts = positiveNumber(post.repostCount);
  const quotes = positiveNumber(post.quoteCount);
  return {
    id: `bsky-${stableHash(post.uri)}`,
    title: text.slice(0, 210),
    description: "",
    sourceName: plainText(post?.author?.displayName) || `@${handle}`,
    collectorName: "Bluesky",
    region: "Rede",
    platform: "Bluesky",
    kind: "social",
    publishedAt: new Date(timestamp).toISOString(),
    url: `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${encodeURIComponent(rkey)}`,
    views: null,
    comments,
    likes,
    interactions: comments + likes + reposts + quotes,
  };
}

async function collectBluesky(initialClusters, cutoff, fetcher = fetch) {
  const queries = [];
  for (const cluster of initialClusters.slice(0, 5)) {
    const first = cluster.items[0];
    const query = titleTokens(first?.title ?? "").slice(0, 3).join(" ");
    if (query && !queries.includes(query)) queries.push(query);
  }
  if (!queries.length) {
    return { items: [], status: { id: "bluesky", name: "Bluesky", region: "Rede", ok: true, count: 0, error: null, fallback: false } };
  }

  const results = await Promise.allSettled(
    queries.map(async (query) => {
      const endpoint = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&limit=8&sort=latest`;
      const response = await fetchWithTimeout(endpoint, fetcher, { accept: "application/json", timeoutMs: 6_500 });
      const payload = await response.json();
      return Array.isArray(payload?.posts) ? payload.posts : [];
    }),
  );

  const items = [];
  const errors = [];
  for (const result of results) {
    if (result.status === "rejected") {
      errors.push(compactError(result.reason));
      continue;
    }
    for (const post of result.value) {
      const item = blueskyItem(post, cutoff);
      if (item) items.push(item);
    }
  }
  const unique = uniqueItems(items, 35);
  const allFailed = results.length > 0 && results.every((result) => result.status === "rejected");
  return {
    items: unique,
    status: {
      id: "bluesky",
      name: "Bluesky",
      region: "Rede",
      ok: !allFailed,
      count: unique.length,
      error: allFailed ? [...new Set(errors)].slice(0, 2).join(" | ") : null,
      fallback: false,
    },
  };
}

async function collectRound({ fetcher = fetch, now = new Date(), feeds = FEEDS } = {}) {
  const startedAt = Date.now();
  const collectedAt = new Date(now);
  const cutoff = new Date(collectedAt.getTime() - 24 * 60 * 60 * 1000);
  const requestBudget = { remaining: PORTAL_SUBREQUEST_LIMIT };
  const portalResults = await Promise.all(feeds.map((feed) => collectFeed(feed, cutoff, fetcher, requestBudget)));
  const portalItems = uniqueItems(portalResults.flatMap((result) => result.items), 435);
  const portalStatuses = portalResults.map((result) => result.status);

  if (!portalItems.length) {
    return {
      ok: false,
      collectedAt: collectedAt.toISOString(),
      windowHours: 24,
      durationMs: Date.now() - startedAt,
      error: "Nenhuma fonte respondeu com conteúdo válido nas últimas 24 horas.",
      sources: portalStatuses,
      totals: { items: 0, topics: 0, sources: 0, socialItems: 0 },
      items: [],
      topics: [],
    };
  }

  const initialClusters = clusterItems(portalItems);
  const social = await collectBluesky(initialClusters, cutoff, fetcher);
  const allItems = uniqueItems([...portalItems, ...social.items]);
  const topics = buildTopics(allItems, collectedAt, 40);
  const sourceCount = new Set(allItems.map((item) => item.sourceName).filter(Boolean)).size;
  const socialItems = allItems.filter((item) => item.kind === "social").length;

  return {
    ok: true,
    collectedAt: collectedAt.toISOString(),
    windowHours: 24,
    durationMs: Date.now() - startedAt,
    sources: [...portalStatuses, social.status],
    totals: {
      items: allItems.length,
      topics: topics.length,
      sources: sourceCount,
      socialItems,
    },
    items: allItems,
    topics,
  };
}

return { "FEEDS": FEEDS, "FEED_COUNTS": FEED_COUNTS, "decodeFeedResponse": decodeFeedResponse, "collectFeed": collectFeed, "uniqueItems": uniqueItems, "collectBluesky": collectBluesky, "collectRound": collectRound };
})();

const __module_src_database_js = (() => {

const initializedBindings = new WeakSet();

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    trigger_type TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    items_count INTEGER NOT NULL DEFAULT 0,
    topics_count INTEGER NOT NULL DEFAULT 0,
    sources_count INTEGER NOT NULL DEFAULT 0,
    social_items_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    payload_json TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_runs_completed ON runs(completed_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_runs_status_completed ON runs(status, completed_at DESC)",
  `CREATE TABLE IF NOT EXISTS locks (
    name TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS translation_cache (
    cache_key TEXT PRIMARY KEY,
    source_lang TEXT NOT NULL,
    target_lang TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_translation_cache_updated ON translation_cache(updated_at DESC)",
  `CREATE TABLE IF NOT EXISTS intelligent_carousels (
    cache_key TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    topic_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_intelligent_carousels_run_topic ON intelligent_carousels(run_id, topic_id)",
  "CREATE INDEX IF NOT EXISTS idx_intelligent_carousels_expires ON intelligent_carousels(expires_at)",
];

async function ensureSchema(db) {
  if (!db) throw new Error("Binding D1 'DB' não configurado.");
  if (initializedBindings.has(db)) return;
  for (const statement of SCHEMA_STATEMENTS) await db.prepare(statement).run();
  initializedBindings.add(db);
}

async function acquireLock(db, name, ttlMs, nowMs = Date.now()) {
  await ensureSchema(db);
  const token = crypto.randomUUID();
  const expiresAt = nowMs + ttlMs;
  await db
    .prepare(`
      INSERT INTO locks (name, token, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at
      WHERE locks.expires_at < ?
    `)
    .bind(name, token, expiresAt, nowMs)
    .run();
  const row = await db.prepare("SELECT token, expires_at FROM locks WHERE name = ?").bind(name).first();
  return row?.token === token ? { name, token, expiresAt } : null;
}

async function releaseLock(db, lock) {
  if (!db || !lock) return;
  await db.prepare("DELETE FROM locks WHERE name = ? AND token = ?").bind(lock.name, lock.token).run();
}

async function startRun(db, { id, triggerType, startedAt }) {
  await ensureSchema(db);
  await db
    .prepare(`
      INSERT INTO runs (
        id, trigger_type, status, started_at, completed_at,
        items_count, topics_count, sources_count, social_items_count,
        error, payload_json
      ) VALUES (?, ?, 'running', ?, ?, 0, 0, 0, 0, NULL, NULL)
    `)
    .bind(id, triggerType, startedAt, startedAt)
    .run();
  return { id, status: "running", startedAt };
}

async function saveRun(db, { id, triggerType, startedAt, payload }) {
  await ensureSchema(db);
  const safePayload = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload
    : {
        ok: false,
        collectedAt: new Date().toISOString(),
        error: "A coleta terminou sem retornar dados válidos.",
        sources: [],
        totals: { items: 0, topics: 0, sources: 0, socialItems: 0 },
        items: [],
        topics: [],
      };
  const completedAt = safePayload.collectedAt || new Date().toISOString();
  const totals = safePayload.totals ?? {};
  const status = safePayload.ok ? "success" : "failed";
  const payloadJson = JSON.stringify(safePayload);
  const retentionCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const translationCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const latestSummary = JSON.stringify({
    id,
    triggerType,
    status,
    completedAt,
    items: Number(totals.items) || 0,
    topics: Number(totals.topics) || 0,
    sources: Number(totals.sources) || 0,
  });

  await db.batch([
    db
      .prepare(`
        INSERT INTO runs (
          id, trigger_type, status, started_at, completed_at,
          items_count, topics_count, sources_count, social_items_count,
          error, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          trigger_type = excluded.trigger_type,
          status = excluded.status,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at,
          items_count = excluded.items_count,
          topics_count = excluded.topics_count,
          sources_count = excluded.sources_count,
          social_items_count = excluded.social_items_count,
          error = excluded.error,
          payload_json = excluded.payload_json
      `)
      .bind(
        id,
        triggerType,
        status,
        startedAt,
        completedAt,
        Number(totals.items) || 0,
        Number(totals.topics) || 0,
        Number(totals.sources) || 0,
        Number(totals.socialItems) || 0,
        safePayload.error || null,
        payloadJson,
      ),
    db
      .prepare(`
        INSERT INTO app_state (key, value, updated_at) VALUES ('latest_run', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `)
      .bind(latestSummary, completedAt),
    db.prepare("DELETE FROM runs WHERE completed_at < ?").bind(retentionCutoff),
    db.prepare("DELETE FROM locks WHERE expires_at < ?").bind(Date.now() - 5 * 60 * 1000),
    db.prepare("DELETE FROM translation_cache WHERE updated_at < ?").bind(translationCutoff),
    db.prepare("DELETE FROM intelligent_carousels WHERE expires_at < ?").bind(new Date().toISOString()),
  ]);
  return { id, status, completedAt };
}

async function getCachedTranslations(db, keys = []) {
  await ensureSchema(db);
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  const output = new Map();
  for (let offset = 0; offset < uniqueKeys.length; offset += 80) {
    const chunk = uniqueKeys.slice(offset, offset + 80);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await db
      .prepare(`SELECT cache_key, translated_text FROM translation_cache WHERE cache_key IN (${placeholders})`)
      .bind(...chunk)
      .all();
    for (const row of result?.results || []) {
      if (row?.cache_key && row?.translated_text) output.set(row.cache_key, row.translated_text);
    }
  }
  return output;
}

async function saveCachedTranslations(db, entries = []) {
  await ensureSchema(db);
  const validEntries = entries.filter((entry) => entry?.key && entry?.translatedText);
  const updatedAt = new Date().toISOString();
  for (let offset = 0; offset < validEntries.length; offset += 80) {
    const chunk = validEntries.slice(offset, offset + 80);
    await db.batch(chunk.map((entry) => db
      .prepare(`
        INSERT INTO translation_cache (cache_key, source_lang, target_lang, translated_text, updated_at)
        VALUES (?, ?, 'pt', ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          translated_text = excluded.translated_text,
          updated_at = excluded.updated_at
      `)
      .bind(entry.key, entry.sourceLanguage, entry.translatedText, updatedAt)));
  }
}

async function getLatestRound(db) {
  await ensureSchema(db);
  const row = await db
    .prepare("SELECT id, trigger_type, completed_at, payload_json FROM runs WHERE status = 'success' ORDER BY completed_at DESC LIMIT 1")
    .first();
  if (!row?.payload_json) return null;
  try {
    const payload = JSON.parse(row.payload_json);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    return { ...payload, runId: row.id, triggerType: row.trigger_type, storedAt: row.completed_at };
  } catch {
    throw new Error("A última ronda armazenada está corrompida.");
  }
}

async function getRunHistory(db, limit = 30) {
  await ensureSchema(db);
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
  const result = await db
    .prepare(`
      SELECT id, trigger_type, status, started_at, completed_at,
             items_count, topics_count, sources_count, social_items_count, error
      FROM runs ORDER BY completed_at DESC LIMIT ?
    `)
    .bind(safeLimit)
    .all();
  return result?.results ?? [];
}

async function getRunStatus(db, id) {
  await ensureSchema(db);
  const row = await db
    .prepare(`
      SELECT id, trigger_type, status, started_at, completed_at,
             items_count, topics_count, sources_count, social_items_count, error
      FROM runs WHERE id = ? LIMIT 1
    `)
    .bind(id)
    .first();
  return row ?? null;
}

async function getRunPayload(db, id) {
  await ensureSchema(db);
  const row = await db
    .prepare(`
      SELECT id, trigger_type, status, started_at, completed_at, error, payload_json
      FROM runs WHERE id = ? LIMIT 1
    `)
    .bind(id)
    .first();
  if (!row) return null;
  let payload = null;
  if (row.payload_json) {
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      throw new Error("Os dados desta ronda estão corrompidos.");
    }
  }
  return {
    id: row.id,
    triggerType: row.trigger_type,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    error: row.error,
    payload,
  };
}


async function getIntelligentCarousel(db, cacheKey) {
  await ensureSchema(db);
  const row = await db
    .prepare("SELECT payload_json, expires_at FROM intelligent_carousels WHERE cache_key = ? LIMIT 1")
    .bind(cacheKey)
    .first();
  if (!row?.payload_json || Date.parse(row.expires_at) <= Date.now()) return null;
  try {
    const payload = JSON.parse(row.payload_json);
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

async function saveIntelligentCarousel(db, { cacheKey, runId, topicId, payload, ttlHours = 48 }) {
  await ensureSchema(db);
  const updatedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Math.max(1, Number(ttlHours) || 48) * 60 * 60 * 1000).toISOString();
  await db
    .prepare(`
      INSERT INTO intelligent_carousels (cache_key, run_id, topic_id, payload_json, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        run_id = excluded.run_id,
        topic_id = excluded.topic_id,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at
    `)
    .bind(cacheKey, runId, topicId, JSON.stringify(payload), updatedAt, expiresAt)
    .run();
  return { updatedAt, expiresAt };
}

async function databaseHealth(db) {
  await ensureSchema(db);
  const row = await db.prepare("SELECT 1 AS ok").first();
  return Number(row?.ok) === 1;
}

async function databaseSelfTest(db) {
  await ensureSchema(db);
  const id = `self-test-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  let lock = null;
  try {
    await db
      .prepare(`
        INSERT INTO runs (
          id, trigger_type, status, started_at, completed_at,
          items_count, topics_count, sources_count, social_items_count,
          error, payload_json
        ) VALUES (?, 'self-test', 'self-test', ?, ?, 0, 0, 0, 0, NULL, NULL)
      `)
      .bind(id, now, now)
      .run();
    const written = await db.prepare("SELECT id FROM runs WHERE id = ?").bind(id).first();
    lock = await acquireLock(db, `self-test-lock-${id}`, 10_000);
    return written?.id === id && Boolean(lock);
  } finally {
    await releaseLock(db, lock);
    await db.prepare("DELETE FROM runs WHERE id = ?").bind(id).run();
  }
}

return { "ensureSchema": ensureSchema, "acquireLock": acquireLock, "releaseLock": releaseLock, "startRun": startRun, "saveRun": saveRun, "getCachedTranslations": getCachedTranslations, "saveCachedTranslations": saveCachedTranslations, "getLatestRound": getLatestRound, "getRunHistory": getRunHistory, "getRunStatus": getRunStatus, "getRunPayload": getRunPayload, "getIntelligentCarousel": getIntelligentCarousel, "saveIntelligentCarousel": saveIntelligentCarousel, "databaseHealth": databaseHealth, "databaseSelfTest": databaseSelfTest };
})();

const __module_src_translation_js = (() => {
const { buildTopics } = __module_src_clustering_js;
const { getCachedTranslations, saveCachedTranslations } = __module_src_database_js;
const { plainText, stableHash } = __module_src_parser_js;




const TRANSLATION_MODEL = "@cf/meta/m2m100-1.2b";
const SPANISH_SOURCES = new Set(["El País", "Infobae"]);
const PORTUGUESE_WORDS = /\b(que|para|com|uma|das|dos|não|mais|sobre|após|entre|governo|notícia|brasil|mundo|novo|nova|segundo|diz)\b/i;

function cleanTranslation(value, limit) {
  const text = plainText(value).replace(/^(["“”']+)|(["“”']+)$/g, "").trim();
  return text.slice(0, limit);
}

function sourceLanguage(item) {
  return SPANISH_SOURCES.has(item?.collectorName || item?.sourceName) ? "es" : "en";
}

function translationKey(text, language) {
  return `pt-v1-${stableHash(`${language}|${plainText(text)}`)}`;
}

function isLikelyPortuguese(value) {
  const text = plainText(value);
  if (!text) return false;
  return /[ãõçáéíóúâêôà]/i.test(text) || PORTUGUESE_WORDS.test(text);
}

async function withTimeout(promise, milliseconds = 12_000) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Tempo limite da tradução excedido")), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function translateText(ai, text, language) {
  const source = plainText(text);
  if (!source || !ai?.run) return null;
  const response = await withTimeout(ai.run(TRANSLATION_MODEL, {
    text: source,
    source_lang: language,
    target_lang: "pt",
  }));
  const translated = response?.translated_text || response?.result?.translated_text;
  return cleanTranslation(translated, Math.max(240, source.length * 3));
}

async function runLimited(entries, limit, worker) {
  const output = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, entries.length) }, async () => {
    while (cursor < entries.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(entries[index]);
    }
  });
  await Promise.all(runners);
  return output;
}

async function translateWorldItems(items, { ai, cached = new Map(), concurrency = 8 } = {}) {
  const worldItems = items.filter((item) => item?.region === "Mundo");
  const requests = new Map();
  let cachedFieldCount = 0;
  for (const item of worldItems) {
    const language = sourceLanguage(item);
    for (const [field, value] of [["title", item.title], ["description", item.description]]) {
      const text = plainText(value);
      if (!text) continue;
      const key = translationKey(text, language);
      if (cached.has(key)) cachedFieldCount += 1;
      if (!cached.has(key) && !requests.has(key)) requests.set(key, { key, text, language, field });
    }
  }

  const generatedEntries = (await runLimited([...requests.values()], concurrency, async (entry) => {
    try {
      const translatedText = await translateText(ai, entry.text, entry.language);
      return translatedText ? { key: entry.key, sourceLanguage: entry.language, translatedText } : null;
    } catch {
      return null;
    }
  })).filter(Boolean);
  for (const entry of generatedEntries) cached.set(entry.key, entry.translatedText);

  const translatedItems = [];
  let omittedItems = 0;
  for (const item of worldItems) {
    const language = sourceLanguage(item);
    const title = cached.get(translationKey(item.title, language));
    if (!title) {
      omittedItems += 1;
      continue;
    }
    const description = item.description
      ? cached.get(translationKey(item.description, language)) || ""
      : "";
    const translatedTitle = cleanTranslation(title, 240);
    const translatedDescription = cleanTranslation(description, 900);
    translatedItems.push({
      ...item,
      title: translatedTitle,
      description: translatedDescription,
      content: translatedDescription || translatedTitle,
      contentSource: translatedDescription ? "translated-feed-description" : "translated-title",
      contentWordCount: plainText(translatedDescription || translatedTitle).split(/\s+/).filter(Boolean).length,
      sourceLanguage: language,
      targetLanguage: "pt-BR",
      translationStatus: description || !item.description ? "translated" : "partial",
    });
  }

  return {
    translatedItems,
    omittedItems,
    generatedEntries,
    cachedFieldCount,
  };
}

function recalculateSources(sources, items, omittedWorldItems) {
  return (sources || []).map((source) => {
    const count = items.filter((item) => item.collectorName === source.name).length;
    if (source.region === "Mundo") {
      const collected = Number(source.count) || 0;
      const omitted = Math.max(0, collected - count);
      return {
        ...source,
        count,
        ok: count > 0,
        error: count > 0
          ? omitted > 0 ? `${omitted} conteúdo(s) omitido(s) porque a tradução não foi concluída.` : null
          : source.error || "Tradução para português indisponível nesta ronda.",
        translation: count > 0 ? omitted > 0 ? "partial" : "translated" : "failed",
      };
    }
    if (source.region === "Rede") {
      return { ...source, count, ok: source.ok && (count > 0 || Number(source.count) === 0) };
    }
    return source;
  });
}

async function translateRoundPayload(payload, { ai, db } = {}) {
  if (!payload?.ok || !Array.isArray(payload.items)) return payload;
  const worldItems = payload.items.filter((item) => item?.region === "Mundo");
  const brazilItems = payload.items.filter((item) => item?.region !== "Mundo" && item?.region !== "Rede");
  const portugueseSocialItems = payload.items.filter((item) => item?.region === "Rede" && isLikelyPortuguese(item.title));
  const keys = [];
  for (const item of worldItems) {
    const language = sourceLanguage(item);
    if (item.title) keys.push(translationKey(item.title, language));
    if (item.description) keys.push(translationKey(item.description, language));
  }
  const cached = db ? await getCachedTranslations(db, keys) : new Map();
  const translated = await translateWorldItems(worldItems, { ai, cached });
  if (db && translated.generatedEntries.length) await saveCachedTranslations(db, translated.generatedEntries);

  const finalItems = [...brazilItems, ...translated.translatedItems, ...portugueseSocialItems];
  const collectedAt = new Date(payload.collectedAt || Date.now());
  const topics = buildTopics(finalItems, collectedAt, 40);
  const sourceCount = new Set(finalItems.map((item) => item.sourceName).filter(Boolean)).size;
  const socialItems = finalItems.filter((item) => item.kind === "social").length;
  const sources = recalculateSources(payload.sources, finalItems, translated.omittedItems);

  return {
    ...payload,
    sources,
    totals: { items: finalItems.length, topics: topics.length, sources: sourceCount, socialItems },
    items: finalItems,
    topics,
    translation: {
      targetLanguage: "pt-BR",
      model: TRANSLATION_MODEL,
      portugueseOnly: true,
      translatedWorldItems: translated.translatedItems.length,
      omittedWorldItems: translated.omittedItems,
      generatedFields: translated.generatedEntries.length,
      cachedFields: translated.cachedFieldCount,
    },
  };
}

function portugueseOnlyFallback(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.items)) return payload;
  const items = payload.items.filter((item) => item?.region !== "Mundo" && (item?.region !== "Rede" || isLikelyPortuguese(item.title)));
  const collectedAt = new Date(payload.collectedAt || Date.now());
  const topics = buildTopics(items, collectedAt, 40);
  const sourceCount = new Set(items.map((item) => item.sourceName).filter(Boolean)).size;
  const socialItems = items.filter((item) => item.kind === "social").length;
  const omittedWorldItems = payload.items.filter((item) => item?.region === "Mundo").length;
  return {
    ...payload,
    sources: recalculateSources(payload.sources, items, omittedWorldItems),
    totals: { items: items.length, topics: topics.length, sources: sourceCount, socialItems },
    items,
    topics,
    translation: {
      targetLanguage: "pt-BR",
      model: TRANSLATION_MODEL,
      portugueseOnly: true,
      translatedWorldItems: 0,
      omittedWorldItems,
      generatedFields: 0,
      cachedFields: 0,
      error: "Tradução indisponível; conteúdos internacionais não traduzidos foram omitidos.",
    },
  };
}

return { "TRANSLATION_MODEL": TRANSLATION_MODEL, "sourceLanguage": sourceLanguage, "translationKey": translationKey, "isLikelyPortuguese": isLikelyPortuguese, "translateText": translateText, "translateWorldItems": translateWorldItems, "translateRoundPayload": translateRoundPayload, "portugueseOnlyFallback": portugueseOnlyFallback };
})();

const __module_src_ui_generated_js = (() => {

// Arquivo gerado. Não edite manualmente.
const UI_ASSETS = Object.freeze({"/":{"contentType":"text/html; charset=utf-8","body":"<!doctype html>\n<html lang=\"pt-BR\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n  <meta name=\"theme-color\" content=\"#f3f6f4\">\n  <meta name=\"description\" content=\"Ronda editorial automática para acompanhamento de portais e fontes públicas.\">\n  <title>Ronda Editorial 24h</title>\n  <link rel=\"stylesheet\" href=\"/styles.css?v=2.0.1\">\n</head>\n<body>\n  <main class=\"app\">\n    <aside class=\"sidebar\">\n      <button class=\"brand\" id=\"goTop\" type=\"button\" aria-label=\"Voltar ao topo\">RE</button>\n      <nav aria-label=\"Navegação principal\">\n        <button class=\"nav active\" id=\"navRound\" type=\"button\"><span class=\"nav-icon\">R</span><span>Ronda</span></button>\n        <button class=\"nav\" id=\"navSources\" type=\"button\"><span class=\"nav-icon\">F</span><span>Fontes</span></button>\n        <button class=\"nav\" id=\"navHistory\" type=\"button\"><span class=\"nav-icon\">H</span><span>Histórico</span></button>\n      </nav>\n      <button class=\"nav settings\" id=\"openSettings\" type=\"button\"><span class=\"nav-icon\">·</span><span>Ajustes</span></button>\n    </aside>\n\n    <section class=\"workspace\" id=\"workspaceTop\">\n      <header class=\"topbar\">\n        <div><p class=\"eyebrow\">Monitoramento editorial</p><h1>Ronda Editorial <span>24h</span></h1></div>\n        <div class=\"top-actions\">\n          <button class=\"icon-button\" id=\"settingsButton\" type=\"button\" aria-label=\"Abrir ajustes\">⚙</button>\n          <button class=\"run-round\" id=\"runRound\" type=\"button\"><span>↻</span>Executar ronda</button>\n          <div class=\"status\"><span class=\"live\" id=\"liveDot\"></span><div><strong id=\"statusLabel\">Conectando</strong><small id=\"statusSub\">Verificando o serviço online</small></div></div>\n        </div>\n      </header>\n\n      <div class=\"notice\"><span>Webapp</span><strong id=\"automationText\">Automação online em verificação.</strong> Fontes internacionais e carrosséis são exibidos sempre em português; o roteiro usa títulos, textos e resumos já coletados pela ronda e fica armazenado por 48 horas.</div>\n      <div class=\"source-health\" id=\"sourceHealth\"><span class=\"health-label\">Fontes ainda não consultadas</span></div>\n\n      <section class=\"sources-view\" id=\"sourcesView\" hidden aria-labelledby=\"sourcesTitle\">\n        <div class=\"sources-heading\">\n          <div><p class=\"eyebrow\">Portais monitorados</p><h2 id=\"sourcesTitle\">Fontes da ronda</h2><p>Clique em um portal para ver somente as notícias recolhidas dele. Conteúdos do Mundo são traduzidos automaticamente para português.</p></div>\n          <button class=\"secondary\" id=\"showAllSources\" type=\"button\">Ver todas as notícias</button>\n        </div>\n        <div class=\"source-portal-grid\" id=\"sourcePortalGrid\"></div>\n      </section>\n\n      <div class=\"round-view\" id=\"roundView\">\n      <section class=\"summary\" aria-label=\"Resumo da ronda\">\n        <div><strong id=\"summaryContents\">0</strong><span>novos conteúdos</span><small>período selecionado</small></div>\n        <div><strong id=\"summaryTopics\">0</strong><span>assuntos ativos</span><small>janela atual</small></div>\n        <div><strong id=\"summaryChannels\">0</strong><span>fontes distintas</span><small>portais e redes</small></div>\n        <div class=\"attention\"><strong id=\"summaryUrgent\">0</strong><span>pautar agora</span><small>alta recorrência</small></div>\n      </section>\n\n      <section class=\"controls\" aria-label=\"Filtros da ronda\">\n        <label class=\"search\"><span>⌕</span><input id=\"searchInput\" placeholder=\"Buscar assunto, veículo ou canal\" aria-label=\"Buscar assunto, veículo ou canal\"></label>\n        <div class=\"segmented\" id=\"periodFilter\" aria-label=\"Período\">\n          <button data-value=\"5\" type=\"button\">5 min</button><button data-value=\"60\" type=\"button\">1h</button><button data-value=\"360\" type=\"button\">6h</button><button class=\"active\" data-value=\"1440\" type=\"button\">24h</button>\n        </div>\n        <div class=\"segmented\" id=\"sourceFilter\" aria-label=\"Tipo de fonte\">\n          <button class=\"active\" data-value=\"Todos\" type=\"button\">Todos</button><button data-value=\"Portal\" type=\"button\">Portais</button><button data-value=\"Rede\" type=\"button\">Redes</button>\n        </div>\n        <div class=\"segmented\" id=\"regionFilter\" aria-label=\"Região das fontes\">\n          <button class=\"active\" data-value=\"Todas\" type=\"button\">Todas regiões</button><button data-value=\"Brasil\" type=\"button\">Brasil</button><button data-value=\"Mundo\" type=\"button\">Mundo</button>\n        </div>\n      </section>\n\n      <section class=\"editoria-controls\" aria-label=\"Filtrar por editoria\">\n        <span>Editorias</span>\n        <div class=\"editoria-filter\" id=\"editoriaFilter\">\n          <button class=\"active\" data-editoria=\"Todas\" type=\"button\">Todas</button>\n          <button data-editoria=\"Notícias\" type=\"button\">Notícias</button>\n          <button data-editoria=\"Política\" type=\"button\">Política</button>\n          <button data-editoria=\"Esportes\" type=\"button\">Esportes</button>\n          <button data-editoria=\"Entretenimento\" type=\"button\">Entretenimento</button>\n          <button data-editoria=\"Economia\" type=\"button\">Economia</button>\n          <button data-editoria=\"Mundo\" type=\"button\">Mundo</button>\n          <button data-editoria=\"Tecnologia\" type=\"button\">Tecnologia</button>\n          <button data-editoria=\"Saúde\" type=\"button\">Saúde</button>\n        </div>\n      </section>\n\n      <div class=\"portal-filter\" id=\"portalFilter\" hidden><span>Exibindo somente:</span><strong id=\"portalFilterName\"></strong><button id=\"clearPortalFilter\" type=\"button\">Remover filtro ×</button></div>\n\n      <div class=\"heading\"><div><h2>Assuntos em destaque</h2><p>Ordenados por relevância editorial, recorrência e atualidade</p></div><span class=\"last-update\" id=\"lastUpdate\">Sem coleta</span></div>\n      <section class=\"grid\" id=\"topicsGrid\" aria-live=\"polite\"></section>\n      </div>\n    </section>\n  </main>\n\n  <div class=\"modal-backdrop\" id=\"settingsModal\" hidden>\n    <section class=\"modal\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"settingsTitle\">\n      <div class=\"modal-head\"><div><p class=\"eyebrow\">Segurança</p><h2 id=\"settingsTitle\">Ajustes da operação</h2></div><button class=\"close-modal\" data-close=\"settingsModal\" type=\"button\" aria-label=\"Fechar\">×</button></div>\n      <p class=\"modal-copy\">Se o Worker possuir a variável secreta <code>MANUAL_ROUND_TOKEN</code>, informe a mesma chave abaixo. Ela fica salva somente neste navegador.</p>\n      <label class=\"field\"><span>Chave para executar ronda manual</span><input id=\"operationToken\" type=\"password\" autocomplete=\"off\" placeholder=\"Opcional quando não há proteção\"></label>\n      <p class=\"field-message\" id=\"tokenMessage\"></p>\n      <div class=\"modal-actions\"><button class=\"secondary\" data-close=\"settingsModal\" type=\"button\">Cancelar</button><button class=\"primary\" id=\"saveSettings\" type=\"button\">Salvar chave</button></div>\n    </section>\n  </div>\n\n  <div class=\"modal-backdrop\" id=\"historyModal\" hidden>\n    <section class=\"modal modal-wide\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"historyTitle\">\n      <div class=\"modal-head\"><div><p class=\"eyebrow\">Últimas 48 horas</p><h2 id=\"historyTitle\">Histórico de rondas</h2></div><button class=\"close-modal\" data-close=\"historyModal\" type=\"button\" aria-label=\"Fechar\">×</button></div>\n      <button class=\"history-back\" id=\"historyBack\" type=\"button\" hidden>← Voltar para todas as rondas</button>\n      <div class=\"history-list\" id=\"historyList\"><div class=\"loading-row\">Carregando histórico…</div></div>\n      <div class=\"history-detail\" id=\"historyDetail\" hidden></div>\n    </section>\n  </div>\n\n  <div class=\"modal-backdrop\" id=\"carouselModal\" hidden>\n    <section class=\"modal modal-wide carousel-modal\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"carouselTitle\">\n      <div class=\"modal-head\"><div><p class=\"eyebrow\">Apoio editorial</p><h2 id=\"carouselTitle\">Roteiro para carrossel</h2></div><button class=\"close-modal\" data-close=\"carouselModal\" type=\"button\" aria-label=\"Fechar\">×</button></div>\n      <div class=\"carousel-loading\" id=\"carouselLoading\" hidden><span class=\"reader-spinner\">↻</span><div><strong>Analisando o conteúdo da ronda…</strong><small>Cruzando títulos, textos e resumos já coletados das fontes.</small></div></div>\n      <div class=\"carousel-meta\" id=\"carouselMeta\"></div>\n      <section class=\"carousel-reading\" id=\"carouselReading\" hidden aria-label=\"Resumo da leitura inteligente\"></section>\n      <section class=\"carousel-analysis\" id=\"carouselAnalysis\" hidden aria-label=\"Interpretação da notícia\"></section>\n      <section class=\"carousel-entities\" id=\"carouselEntities\" hidden aria-label=\"Dados estruturados extraídos\"></section>\n      <div class=\"carousel-slides\" id=\"carouselSlides\"></div>\n      <section class=\"carousel-sources\" id=\"carouselSources\" aria-label=\"Links para apuração\"></section>\n      <p class=\"carousel-disclaimer\" id=\"carouselDisclaimer\"></p>\n      <div class=\"modal-actions\"><button class=\"secondary\" data-close=\"carouselModal\" type=\"button\">Fechar</button><button class=\"primary\" id=\"copyCarousel\" type=\"button\" disabled>Copiar roteiro</button></div>\n      <p class=\"copy-message\" id=\"copyCarouselMessage\"></p>\n    </section>\n  </div>\n\n  <script src=\"/app.js?v=2.0.1\" defer></script>\n</body>\n</html>\n"},"/index.html":{"contentType":"text/html; charset=utf-8","body":"<!doctype html>\n<html lang=\"pt-BR\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n  <meta name=\"theme-color\" content=\"#f3f6f4\">\n  <meta name=\"description\" content=\"Ronda editorial automática para acompanhamento de portais e fontes públicas.\">\n  <title>Ronda Editorial 24h</title>\n  <link rel=\"stylesheet\" href=\"/styles.css?v=2.0.1\">\n</head>\n<body>\n  <main class=\"app\">\n    <aside class=\"sidebar\">\n      <button class=\"brand\" id=\"goTop\" type=\"button\" aria-label=\"Voltar ao topo\">RE</button>\n      <nav aria-label=\"Navegação principal\">\n        <button class=\"nav active\" id=\"navRound\" type=\"button\"><span class=\"nav-icon\">R</span><span>Ronda</span></button>\n        <button class=\"nav\" id=\"navSources\" type=\"button\"><span class=\"nav-icon\">F</span><span>Fontes</span></button>\n        <button class=\"nav\" id=\"navHistory\" type=\"button\"><span class=\"nav-icon\">H</span><span>Histórico</span></button>\n      </nav>\n      <button class=\"nav settings\" id=\"openSettings\" type=\"button\"><span class=\"nav-icon\">·</span><span>Ajustes</span></button>\n    </aside>\n\n    <section class=\"workspace\" id=\"workspaceTop\">\n      <header class=\"topbar\">\n        <div><p class=\"eyebrow\">Monitoramento editorial</p><h1>Ronda Editorial <span>24h</span></h1></div>\n        <div class=\"top-actions\">\n          <button class=\"icon-button\" id=\"settingsButton\" type=\"button\" aria-label=\"Abrir ajustes\">⚙</button>\n          <button class=\"run-round\" id=\"runRound\" type=\"button\"><span>↻</span>Executar ronda</button>\n          <div class=\"status\"><span class=\"live\" id=\"liveDot\"></span><div><strong id=\"statusLabel\">Conectando</strong><small id=\"statusSub\">Verificando o serviço online</small></div></div>\n        </div>\n      </header>\n\n      <div class=\"notice\"><span>Webapp</span><strong id=\"automationText\">Automação online em verificação.</strong> Fontes internacionais e carrosséis são exibidos sempre em português; o roteiro usa títulos, textos e resumos já coletados pela ronda e fica armazenado por 48 horas.</div>\n      <div class=\"source-health\" id=\"sourceHealth\"><span class=\"health-label\">Fontes ainda não consultadas</span></div>\n\n      <section class=\"sources-view\" id=\"sourcesView\" hidden aria-labelledby=\"sourcesTitle\">\n        <div class=\"sources-heading\">\n          <div><p class=\"eyebrow\">Portais monitorados</p><h2 id=\"sourcesTitle\">Fontes da ronda</h2><p>Clique em um portal para ver somente as notícias recolhidas dele. Conteúdos do Mundo são traduzidos automaticamente para português.</p></div>\n          <button class=\"secondary\" id=\"showAllSources\" type=\"button\">Ver todas as notícias</button>\n        </div>\n        <div class=\"source-portal-grid\" id=\"sourcePortalGrid\"></div>\n      </section>\n\n      <div class=\"round-view\" id=\"roundView\">\n      <section class=\"summary\" aria-label=\"Resumo da ronda\">\n        <div><strong id=\"summaryContents\">0</strong><span>novos conteúdos</span><small>período selecionado</small></div>\n        <div><strong id=\"summaryTopics\">0</strong><span>assuntos ativos</span><small>janela atual</small></div>\n        <div><strong id=\"summaryChannels\">0</strong><span>fontes distintas</span><small>portais e redes</small></div>\n        <div class=\"attention\"><strong id=\"summaryUrgent\">0</strong><span>pautar agora</span><small>alta recorrência</small></div>\n      </section>\n\n      <section class=\"controls\" aria-label=\"Filtros da ronda\">\n        <label class=\"search\"><span>⌕</span><input id=\"searchInput\" placeholder=\"Buscar assunto, veículo ou canal\" aria-label=\"Buscar assunto, veículo ou canal\"></label>\n        <div class=\"segmented\" id=\"periodFilter\" aria-label=\"Período\">\n          <button data-value=\"5\" type=\"button\">5 min</button><button data-value=\"60\" type=\"button\">1h</button><button data-value=\"360\" type=\"button\">6h</button><button class=\"active\" data-value=\"1440\" type=\"button\">24h</button>\n        </div>\n        <div class=\"segmented\" id=\"sourceFilter\" aria-label=\"Tipo de fonte\">\n          <button class=\"active\" data-value=\"Todos\" type=\"button\">Todos</button><button data-value=\"Portal\" type=\"button\">Portais</button><button data-value=\"Rede\" type=\"button\">Redes</button>\n        </div>\n        <div class=\"segmented\" id=\"regionFilter\" aria-label=\"Região das fontes\">\n          <button class=\"active\" data-value=\"Todas\" type=\"button\">Todas regiões</button><button data-value=\"Brasil\" type=\"button\">Brasil</button><button data-value=\"Mundo\" type=\"button\">Mundo</button>\n        </div>\n      </section>\n\n      <section class=\"editoria-controls\" aria-label=\"Filtrar por editoria\">\n        <span>Editorias</span>\n        <div class=\"editoria-filter\" id=\"editoriaFilter\">\n          <button class=\"active\" data-editoria=\"Todas\" type=\"button\">Todas</button>\n          <button data-editoria=\"Notícias\" type=\"button\">Notícias</button>\n          <button data-editoria=\"Política\" type=\"button\">Política</button>\n          <button data-editoria=\"Esportes\" type=\"button\">Esportes</button>\n          <button data-editoria=\"Entretenimento\" type=\"button\">Entretenimento</button>\n          <button data-editoria=\"Economia\" type=\"button\">Economia</button>\n          <button data-editoria=\"Mundo\" type=\"button\">Mundo</button>\n          <button data-editoria=\"Tecnologia\" type=\"button\">Tecnologia</button>\n          <button data-editoria=\"Saúde\" type=\"button\">Saúde</button>\n        </div>\n      </section>\n\n      <div class=\"portal-filter\" id=\"portalFilter\" hidden><span>Exibindo somente:</span><strong id=\"portalFilterName\"></strong><button id=\"clearPortalFilter\" type=\"button\">Remover filtro ×</button></div>\n\n      <div class=\"heading\"><div><h2>Assuntos em destaque</h2><p>Ordenados por relevância editorial, recorrência e atualidade</p></div><span class=\"last-update\" id=\"lastUpdate\">Sem coleta</span></div>\n      <section class=\"grid\" id=\"topicsGrid\" aria-live=\"polite\"></section>\n      </div>\n    </section>\n  </main>\n\n  <div class=\"modal-backdrop\" id=\"settingsModal\" hidden>\n    <section class=\"modal\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"settingsTitle\">\n      <div class=\"modal-head\"><div><p class=\"eyebrow\">Segurança</p><h2 id=\"settingsTitle\">Ajustes da operação</h2></div><button class=\"close-modal\" data-close=\"settingsModal\" type=\"button\" aria-label=\"Fechar\">×</button></div>\n      <p class=\"modal-copy\">Se o Worker possuir a variável secreta <code>MANUAL_ROUND_TOKEN</code>, informe a mesma chave abaixo. Ela fica salva somente neste navegador.</p>\n      <label class=\"field\"><span>Chave para executar ronda manual</span><input id=\"operationToken\" type=\"password\" autocomplete=\"off\" placeholder=\"Opcional quando não há proteção\"></label>\n      <p class=\"field-message\" id=\"tokenMessage\"></p>\n      <div class=\"modal-actions\"><button class=\"secondary\" data-close=\"settingsModal\" type=\"button\">Cancelar</button><button class=\"primary\" id=\"saveSettings\" type=\"button\">Salvar chave</button></div>\n    </section>\n  </div>\n\n  <div class=\"modal-backdrop\" id=\"historyModal\" hidden>\n    <section class=\"modal modal-wide\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"historyTitle\">\n      <div class=\"modal-head\"><div><p class=\"eyebrow\">Últimas 48 horas</p><h2 id=\"historyTitle\">Histórico de rondas</h2></div><button class=\"close-modal\" data-close=\"historyModal\" type=\"button\" aria-label=\"Fechar\">×</button></div>\n      <button class=\"history-back\" id=\"historyBack\" type=\"button\" hidden>← Voltar para todas as rondas</button>\n      <div class=\"history-list\" id=\"historyList\"><div class=\"loading-row\">Carregando histórico…</div></div>\n      <div class=\"history-detail\" id=\"historyDetail\" hidden></div>\n    </section>\n  </div>\n\n  <div class=\"modal-backdrop\" id=\"carouselModal\" hidden>\n    <section class=\"modal modal-wide carousel-modal\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"carouselTitle\">\n      <div class=\"modal-head\"><div><p class=\"eyebrow\">Apoio editorial</p><h2 id=\"carouselTitle\">Roteiro para carrossel</h2></div><button class=\"close-modal\" data-close=\"carouselModal\" type=\"button\" aria-label=\"Fechar\">×</button></div>\n      <div class=\"carousel-loading\" id=\"carouselLoading\" hidden><span class=\"reader-spinner\">↻</span><div><strong>Analisando o conteúdo da ronda…</strong><small>Cruzando títulos, textos e resumos já coletados das fontes.</small></div></div>\n      <div class=\"carousel-meta\" id=\"carouselMeta\"></div>\n      <section class=\"carousel-reading\" id=\"carouselReading\" hidden aria-label=\"Resumo da leitura inteligente\"></section>\n      <section class=\"carousel-analysis\" id=\"carouselAnalysis\" hidden aria-label=\"Interpretação da notícia\"></section>\n      <section class=\"carousel-entities\" id=\"carouselEntities\" hidden aria-label=\"Dados estruturados extraídos\"></section>\n      <div class=\"carousel-slides\" id=\"carouselSlides\"></div>\n      <section class=\"carousel-sources\" id=\"carouselSources\" aria-label=\"Links para apuração\"></section>\n      <p class=\"carousel-disclaimer\" id=\"carouselDisclaimer\"></p>\n      <div class=\"modal-actions\"><button class=\"secondary\" data-close=\"carouselModal\" type=\"button\">Fechar</button><button class=\"primary\" id=\"copyCarousel\" type=\"button\" disabled>Copiar roteiro</button></div>\n      <p class=\"copy-message\" id=\"copyCarouselMessage\"></p>\n    </section>\n  </div>\n\n  <script src=\"/app.js?v=2.0.1\" defer></script>\n</body>\n</html>\n"},"/styles.css":{"contentType":"text/css; charset=utf-8","body":":root{--ink:#17231e;--muted:#6e7b74;--line:#dfe7e2;--surface:#fff;--canvas:#f3f6f4;--green:#176b4b;--green-soft:#e9f4ee;--amber:#a85b15;--red:#b33b32}\n*{box-sizing:border-box}html{background:var(--canvas);scroll-behavior:smooth}body{margin:0;background:var(--canvas);color:var(--ink);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;font-size:15px}button,input{font:inherit}button,a{-webkit-tap-highlight-color:transparent}.app{min-height:100vh;display:grid;grid-template-columns:212px minmax(0,1fr)}\n.sidebar{position:sticky;top:0;height:100vh;padding:28px 18px 20px;background:#fbfdfc;border-right:1px solid var(--line);display:flex;flex-direction:column;gap:42px}.brand{width:42px;height:42px;border:0;border-radius:12px;display:grid;place-items:center;background:var(--ink);color:#fff;font-size:13px;font-weight:800;letter-spacing:.06em;cursor:pointer}.sidebar nav{display:grid;gap:6px}.nav{width:100%;min-height:44px;padding:0 12px;border:0;border-radius:11px;display:grid;grid-template-columns:26px 1fr;align-items:center;gap:8px;background:transparent;color:#617068;cursor:pointer;text-align:left;font-weight:650}.nav:hover{background:#f0f4f2;color:var(--ink)}.nav.active{background:var(--green-soft);color:var(--green)}.nav-icon{font-size:11px;font-weight:850;width:22px;height:22px;border:1px solid currentColor;border-radius:7px;display:grid;place-items:center}.settings{margin-top:auto}\n.workspace{width:100%;max-width:1540px;margin:0 auto;padding:29px clamp(24px,3.1vw,54px) 70px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:32px}.eyebrow{margin:0 0 5px;color:var(--green);font-size:11px;font-weight:800;letter-spacing:.13em;text-transform:uppercase}.topbar h1{margin:0;font-size:clamp(27px,2.5vw,38px);line-height:1.08;letter-spacing:-.04em}.topbar h1 span{color:var(--muted);font-weight:500}.top-actions{display:flex;align-items:center;gap:10px}.icon-button{width:44px;height:44px;border:1px solid var(--line);border-radius:12px;background:#fff;color:#617068;cursor:pointer}.icon-button:hover{color:var(--green);border-color:#bad0c5}.run-round{height:46px;padding:0 17px;border:0;border-radius:12px;background:var(--green);color:#fff;display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;font-weight:800;box-shadow:0 5px 14px rgba(23,107,75,.18)}.run-round:hover{background:#105b3e}.run-round:disabled{opacity:.65;cursor:wait}.run-round.loading span{animation:spin .8s linear infinite}.status{display:flex;align-items:center;gap:11px;padding:10px 14px;background:#fff;border:1px solid var(--line);border-radius:12px}.status div{display:flex;flex-direction:column;gap:2px}.status strong{font-size:12px}.status small{color:var(--muted);font-size:11px}.live{width:9px;height:9px;border-radius:50%;background:#9aa69f;box-shadow:0 0 0 4px #edf1ef}.live.ok{background:#1b9b61;box-shadow:0 0 0 4px #dff4e9}.live.error{background:var(--red);box-shadow:0 0 0 4px #fff0ee}.live.warn{background:#d47c25;box-shadow:0 0 0 4px #fff1df}\n.notice{margin-top:23px;padding:10px 13px;background:#edf7f1;border:1px solid #d4e9dc;border-radius:10px;color:#52675c;font-size:12px}.notice>span{margin-right:8px;padding:3px 7px;background:#d9eee1;border-radius:5px;color:#245f45;font-weight:800;text-transform:uppercase;letter-spacing:.05em;font-size:9px}.notice strong{font-weight:750}.source-health{margin-top:9px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-height:25px;scroll-margin-top:20px}.health-label{margin-right:3px;color:var(--muted);font-size:10px;font-weight:750}.health-chip{padding:5px 8px;border:1px solid var(--line);border-radius:999px;background:#fff;color:#66736c;font-size:9px;font-weight:750}.health-chip.ok{border-color:#cfe4d7;background:#f0f8f3;color:#256548}.health-chip.error{border-color:#f0d3cf;background:#fff5f3;color:#9a3c34}.health-message{padding:8px 10px;border-radius:8px;background:#fff5f3;color:#9a3c34;font-size:11px}.health-message.warn{background:#fff7ec;color:#925315}\n.summary{margin-top:18px;background:#fff;border:1px solid var(--line);border-radius:16px;display:grid;grid-template-columns:repeat(4,1fr);overflow:hidden}.summary>div{min-height:90px;padding:19px 22px;display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto;column-gap:12px;align-content:center;border-right:1px solid var(--line)}.summary>div:last-child{border-right:0}.summary strong{grid-row:1/3;align-self:center;font-size:30px;letter-spacing:-.05em}.summary span{align-self:end;font-weight:720;font-size:13px}.summary small{color:var(--muted);font-size:11px}.summary .attention{background:#fffbf8}.summary .attention strong{color:var(--red)}\n.controls{margin:18px 0 28px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}.search{height:42px;min-width:300px;flex:1 1 360px;display:flex;align-items:center;gap:9px;padding:0 13px;background:#fff;border:1px solid var(--line);border-radius:11px;color:var(--muted)}.search:focus-within{border-color:#93b7a6;box-shadow:0 0 0 3px #dfeee7}.search input{width:100%;border:0;outline:0;background:transparent;color:var(--ink);font-size:13px}.segmented{display:inline-flex;padding:3px;background:#e8eeeb;border-radius:10px}.segmented button{height:34px;padding:0 11px;border:0;border-radius:8px;background:transparent;color:#6c7771;cursor:pointer;font-size:11px;font-weight:750}.segmented button.active{background:#fff;color:var(--ink);box-shadow:0 1px 3px #53685a25}.heading{margin-bottom:14px;display:flex;align-items:end;justify-content:space-between;gap:20px}.heading h2{margin:0;font-size:18px;letter-spacing:-.02em}.heading p{margin:4px 0 0;color:var(--muted);font-size:12px}.last-update{color:var(--muted);font-size:11px;font-weight:650}\n.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px;align-items:start}.card{position:relative;overflow:hidden;background:#fff;border:1px solid var(--line);border-radius:16px;box-shadow:0 5px 18px rgba(23,35,30,.035)}.accent{position:absolute;inset:0 auto 0 0;width:4px;background:#b9c5bf}.card.urgent .accent{background:var(--red)}.card.watch .accent{background:var(--amber)}.card-body{padding:20px 21px 18px 23px}.topline{display:flex;align-items:center;justify-content:space-between;gap:12px}.priority{display:inline-flex;align-items:center;gap:7px;color:#6b7771;font-size:10px;font-weight:850;text-transform:uppercase;letter-spacing:.065em}.priority i{width:6px;height:6px;border-radius:50%;background:#8d9993}.urgent .priority{color:var(--red)}.urgent .priority i{background:var(--red);box-shadow:0 0 0 4px #fff0ee}.watch .priority{color:var(--amber)}.watch .priority i{background:var(--amber)}.score{padding:5px 8px;background:#f0f4f2;border-radius:7px;color:#627069;font-size:10px;font-weight:800}.card h2{min-height:52px;margin:12px 0 11px;font-size:19px;line-height:1.35;letter-spacing:-.025em}.card-sources{margin:11px 0 2px;display:flex;align-items:center;gap:5px;flex-wrap:wrap}.card-sources>span:first-child{margin-right:2px;color:var(--muted);font-size:9px;font-weight:750;text-transform:uppercase;letter-spacing:.05em}.source-badge{padding:4px 7px;border-radius:999px;background:#edf3f0;color:#40574c;font-size:9px;font-weight:750}.published{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:10px;flex-wrap:wrap}.published strong{color:#4b5952;font-size:11px}.relative{padding-left:7px;border-left:1px solid var(--line);color:var(--green);font-weight:750}.momentum{margin-top:12px;display:flex;align-items:center;gap:7px;color:var(--green);font-size:11px;font-weight:750}.trend{width:19px;height:19px;display:grid;place-items:center;background:var(--green-soft);border-radius:6px}.calculated{margin-left:auto;color:#919b96;font-size:9px;font-weight:600}.recommendation{margin-top:12px;padding:10px 11px;border-radius:9px;background:#f5f7f6;color:#55635c;font-size:10px;line-height:1.45}.recommendation strong{color:var(--ink)}\n.primary,.source{margin-top:13px;padding:12px;border:1px solid var(--line);border-radius:11px;background:#fbfcfb}.kicker{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:9px;flex-wrap:wrap}.kicker strong{color:#48564f}.kind{padding:3px 5px;border-radius:4px;background:#edf1ef;color:#5f6c65;font-size:8px;font-weight:850;text-transform:uppercase;letter-spacing:.05em}.kind.bluesky{background:#edf5ff;color:#26669c}.primary h3,.source h3{min-height:33px;margin:7px 0 9px;font-size:12px;line-height:1.38}.source-footer{display:flex;align-items:end;justify-content:flex-end;gap:12px}.source-metrics{display:flex;gap:13px;color:var(--muted);font-size:9px;flex-wrap:wrap}.source-metrics strong{color:#4a5851}.open{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;padding:8px 10px;border:1px solid #b9cec3;border-radius:8px;color:var(--green);text-decoration:none;font-size:9px;font-weight:800;white-space:nowrap}.open:hover{background:var(--green);border-color:var(--green);color:#fff}.toggle{width:100%;margin-top:14px;padding:12px 0 0;border:0;border-top:1px solid var(--line);display:flex;justify-content:space-between;background:#fff;color:var(--ink);cursor:pointer;font-size:11px;font-weight:780}.source-list{display:grid;gap:8px}.source{display:flex;align-items:center;gap:13px}.source>div{min-width:0;flex:1}.source h3{min-height:auto}.empty{grid-column:1/-1;min-height:220px;border:1px dashed #cbd6d0;border-radius:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:28px;text-align:center;color:var(--muted)}.empty strong{color:var(--ink)}\n.modal-backdrop{position:fixed;z-index:100;inset:0;padding:24px;background:rgba(16,29,23,.42);display:grid;place-items:center}.modal-backdrop[hidden]{display:none}.modal{width:min(520px,100%);max-height:min(760px,calc(100vh - 48px));overflow:auto;padding:24px;background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 24px 70px rgba(12,26,19,.22)}.modal-wide{width:min(820px,100%)}.modal-head{display:flex;align-items:start;justify-content:space-between;gap:20px}.modal h2{margin:0;font-size:21px}.close-modal{width:36px;height:36px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--muted);cursor:pointer;font-size:22px}.modal-copy{margin:17px 0;color:var(--muted);font-size:12px;line-height:1.55}.modal-copy code{padding:2px 5px;border-radius:5px;background:#eef2f0;color:var(--ink)}.field{display:grid;gap:7px}.field span{font-size:11px;font-weight:750}.field input{height:44px;padding:0 12px;border:1px solid var(--line);border-radius:10px;outline:0}.field input:focus{border-color:#83ad99;box-shadow:0 0 0 3px #e1efe8}.field-message{min-height:18px;margin:7px 0 0;color:var(--red);font-size:10px}.modal-actions{margin-top:17px;display:flex;justify-content:flex-end;gap:8px}.primary,.secondary{height:40px;padding:0 14px;border-radius:10px;cursor:pointer;font-size:11px;font-weight:800}.primary{border:0;background:var(--green);color:#fff}.secondary{border:1px solid var(--line);background:#fff;color:var(--ink)}.history-list{margin-top:18px;display:grid;border:1px solid var(--line);border-radius:12px;overflow:hidden}.history-row{min-height:55px;padding:10px 12px;display:grid;grid-template-columns:1.3fr .8fr repeat(3,.55fr);align-items:center;gap:10px;border-bottom:1px solid var(--line);font-size:11px}.history-row:last-child{border:0}.history-row strong{font-size:11px}.history-row span{color:var(--muted)}.history-status{justify-self:start;padding:4px 7px;border-radius:999px;font-size:9px;font-weight:800}.history-status.success{background:#e9f5ee;color:#226647}.history-status.failed{background:#fff0ee;color:#9b3e36}.loading-row{padding:30px;text-align:center;color:var(--muted);font-size:12px}\n@media(max-width:1180px){.app{grid-template-columns:76px minmax(0,1fr)}.sidebar{padding:24px 12px;align-items:center}.nav{grid-template-columns:1fr;width:44px;padding:0;place-items:center}.nav span:nth-child(2){display:none}}\n@media(max-width:900px){.grid{grid-template-columns:1fr}.summary{grid-template-columns:repeat(2,1fr)}.summary>div:nth-child(2){border-right:0}.summary>div:nth-child(-n+2){border-bottom:1px solid var(--line)}.topbar{align-items:stretch;flex-direction:column}.top-actions{align-items:stretch}.run-round{flex:1;justify-content:center}.history-row{grid-template-columns:1.2fr .8fr repeat(2,.5fr)}.history-row span:last-child{display:none}}\n@media(max-width:700px){.app{display:block}.sidebar{z-index:10;width:100%;height:64px;padding:8px 12px;position:fixed;inset:auto 0 0;border:1px solid var(--line);flex-direction:row;justify-content:center;gap:10px}.brand,.settings{display:none}.sidebar nav{width:100%;display:flex;justify-content:space-around}.nav{width:52px;min-height:46px}.workspace{padding:22px 15px 94px}.icon-button{display:none}.status{padding:9px 12px}.summary>div{min-height:76px;padding:14px}.summary strong{font-size:24px}.search{min-width:100%}.heading p{display:none}.card-body{padding:18px 16px 16px 19px}.card h2{min-height:auto;font-size:18px}.source,.source-footer{align-items:stretch;flex-direction:column}.open{width:100%;justify-content:center}.calculated{display:none}.modal-backdrop{padding:12px}.modal{max-height:calc(100vh - 24px);padding:19px}.history-row{grid-template-columns:1.2fr .8fr .55fr}.history-row span:nth-last-child(-n+2){display:none}}\n.health-chip{display:inline-flex;align-items:center;gap:5px;cursor:pointer}.health-chip:hover{transform:translateY(-1px);box-shadow:0 3px 8px rgba(23,35,30,.08)}.health-chip.selected{border-color:var(--green);background:var(--green);color:#fff;box-shadow:0 0 0 3px rgba(23,107,75,.14)}.health-chip.selected .health-icon{background:#fff;color:var(--green)}.health-icon{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;background:#fff;border:1px solid currentColor;font-size:7px}\n.sources-view{margin-top:24px}.sources-view[hidden],.round-view[hidden]{display:none}.sources-heading{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:15px}.sources-heading h2{margin:0;font-size:25px;letter-spacing:-.035em}.sources-heading p:not(.eyebrow){margin:6px 0 0;color:var(--muted);font-size:12px}.source-portal-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.portal-card{min-height:92px;padding:15px;border:1px solid var(--line);border-radius:14px;background:#fff;display:grid;grid-template-columns:46px 1fr auto;align-items:center;gap:13px;text-align:left;color:var(--ink);cursor:pointer;box-shadow:0 4px 14px rgba(23,35,30,.025)}.portal-card:hover,.portal-card.selected{border-color:#8db6a2;box-shadow:0 6px 18px rgba(23,107,75,.1);transform:translateY(-1px)}.portal-card.error{background:#fffafa}.portal-icon{width:46px;height:46px;border-radius:13px;display:grid;place-items:center;background:var(--green-soft);color:var(--green);font-size:11px;font-weight:850;letter-spacing:.04em}.portal-card.error .portal-icon{background:#fff0ee;color:var(--red)}.portal-card-copy{min-width:0;display:flex;flex-direction:column;gap:5px}.portal-card-copy strong{font-size:13px}.portal-card-copy small{color:var(--muted);font-size:10px}.portal-state{color:var(--green);font-size:10px;font-weight:800}.portal-card.error .portal-state{color:var(--red)}.sources-empty{min-height:180px}\n.portal-filter{margin:-13px 0 19px;padding:10px 12px;border:1px solid #cfe4d7;border-radius:10px;background:#edf7f1;display:flex;align-items:center;gap:7px;color:#52675c;font-size:11px}.portal-filter[hidden]{display:none}.portal-filter strong{color:var(--green)}.portal-filter button{margin-left:auto;padding:5px 8px;border:0;border-radius:7px;background:#fff;color:var(--green);cursor:pointer;font-size:9px;font-weight:800}\n.source-badge{border:0}.source-badge[data-portal]{cursor:pointer}.source-badge[data-portal]:hover{background:#dcebe3;color:var(--green)}.source-name-button{padding:0;border:0;background:transparent;color:#48564f;cursor:pointer;font-size:9px;font-weight:750}.source-name-button:hover{color:var(--green);text-decoration:underline}.history-status.running{background:#fff4e7;color:#9a591a}\n@media(max-width:900px){.source-portal-grid{grid-template-columns:1fr}}\n@media(max-width:700px){.sources-heading{align-items:stretch;flex-direction:column}.portal-card{grid-template-columns:42px 1fr}.portal-icon{width:42px;height:42px}.portal-state{display:none}}\n.modal-wide{width:min(1080px,100%)}.history-row{width:100%;border:0;border-bottom:1px solid var(--line);background:#fff;text-align:left;cursor:pointer}.history-row:hover{background:#f7faf8}.history-row:focus-visible{position:relative;z-index:1;outline:3px solid #b9d9c8;outline-offset:-3px}.history-row:disabled{cursor:wait;opacity:.72}.history-date{display:flex;flex-direction:column;gap:2px}.history-date small,.history-open small{color:var(--muted);font-size:10px}.history-open{display:flex;flex-direction:column;gap:3px}.history-open strong{color:var(--muted);font-weight:500}.history-open small{color:var(--green);font-weight:800}.history-back{margin:16px 0 0;padding:8px 10px;border:1px solid var(--line);border-radius:9px;background:#fff;color:var(--green);cursor:pointer;font-size:10px;font-weight:800}.history-back[hidden],.history-detail[hidden],.history-list[hidden]{display:none}.history-detail{margin-top:16px}.history-detail-head{padding:16px 17px;border:1px solid var(--line);border-radius:13px;background:#f7faf8}.history-detail-head h3{margin:0;font-size:19px}.history-detail-head p:last-child{margin:5px 0 0;color:var(--muted);font-size:11px}.history-source-chips{margin:12px 0;display:flex;gap:6px;flex-wrap:wrap}.history-source-chips span{padding:6px 8px;border:1px solid #cfe4d7;border-radius:999px;background:#f0f8f3;color:#256548;font-size:9px;font-weight:750}.history-news-list{display:grid;gap:9px}.history-news{padding:14px 15px;border:1px solid var(--line);border-radius:12px;background:#fff}.history-news-meta{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:9px;flex-wrap:wrap}.history-news-meta strong{color:#48564f}.history-news-meta time{margin-left:auto}.history-news h3{margin:8px 0 5px;font-size:13px;line-height:1.4}.history-news p{margin:0 0 9px;color:var(--muted);font-size:10px;line-height:1.45}.history-news a{color:var(--green);font-size:9px;font-weight:800;text-decoration:none}.history-news a:hover{text-decoration:underline}.history-empty{min-height:180px}\n@media(max-width:900px){.history-row{grid-template-columns:1.2fr .8fr .6fr .6fr .7fr}.history-row .history-open{display:flex!important}}\n@media(max-width:700px){.history-row{grid-template-columns:1.2fr .8fr .7fr}.history-row>span:nth-child(3),.history-row>span:nth-child(4){display:none}.history-row .history-open{display:flex!important}.history-open strong{display:none}.history-news-meta time{width:100%;margin-left:0}}\n.editoria-controls{margin:-13px 0 27px;display:flex;align-items:center;gap:9px}.editoria-controls>span{flex:0 0 auto;color:var(--muted);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em}.editoria-filter{display:flex;gap:5px;flex-wrap:wrap}.editoria-filter button{height:30px;padding:0 10px;border:1px solid var(--line);border-radius:999px;background:#fff;color:#617068;cursor:pointer;font-size:9px;font-weight:800}.editoria-filter button:hover{border-color:#9ebcac;color:var(--green)}.editoria-filter button.active{border-color:var(--green);background:var(--green);color:#fff}.topic-labels{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.editoria-badge{padding:4px 7px;border-radius:999px;background:#e8efff;color:#3158a6;font-size:8px;font-weight:850;text-transform:uppercase;letter-spacing:.045em}\n@media(max-width:700px){.editoria-controls{align-items:flex-start;flex-direction:column}.editoria-filter{width:100%;flex-wrap:nowrap;overflow-x:auto;padding:0 0 5px;scrollbar-width:thin}.editoria-filter button{flex:0 0 auto}}\n.carousel-teaser{margin-top:12px;padding:10px 11px;border:1px solid #d9e2f6;border-radius:10px;background:#f7f9ff;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 180px;align-items:center;gap:10px}.carousel-teaser>div{min-width:0;display:flex;flex-direction:column;gap:3px}.carousel-teaser span{color:#788398;font-size:8px;font-weight:750;text-transform:uppercase;letter-spacing:.04em}.carousel-teaser strong{color:#33496f;font-size:10px;line-height:1.25;overflow-wrap:anywhere}.carousel-teaser button{width:100%;min-width:0;height:44px;padding:0 16px;border:0;border-radius:10px;background:#4565b7;color:#fff;cursor:pointer;font-size:11px;font-weight:850;line-height:1.2;box-shadow:0 5px 14px rgba(69,101,183,.22)}.carousel-teaser button:hover{background:#36549e;transform:translateY(-1px);box-shadow:0 7px 18px rgba(54,84,158,.26)}.carousel-teaser button:focus-visible{outline:3px solid rgba(69,101,183,.25);outline-offset:2px}.carousel-modal{width:min(1180px,100%)}.carousel-meta{margin:16px 0 13px;display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.carousel-meta>span{padding:10px 11px;border:1px solid var(--line);border-radius:10px;background:#f8faf9;display:flex;flex-direction:column;gap:3px}.carousel-meta small{color:var(--muted);font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.05em}.carousel-meta strong{font-size:11px}.carousel-slides{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px}.carousel-slide{min-height:240px;padding:14px;border:1px solid #dbe3f5;border-radius:14px;background:linear-gradient(160deg,#fff 0%,#f2f5ff 100%);display:flex;flex-direction:column}.carousel-slide>div{display:flex;align-items:center;gap:7px}.carousel-slide>div>span{width:25px;height:25px;border-radius:8px;display:grid;place-items:center;background:#4565b7;color:#fff;font-size:10px;font-weight:850}.carousel-slide small{color:#6b7891;font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.05em}.carousel-slide h3{margin:17px 0 9px;font-size:14px;line-height:1.25}.carousel-slide p{margin:0;color:#526075;font-size:10px;line-height:1.48}.carousel-disclaimer{margin:13px 0 0;padding:9px 11px;border-radius:9px;background:#fff7e9;color:#805b25;font-size:9px;line-height:1.45}.copy-message{min-height:16px;margin:6px 0 0;text-align:right;color:var(--green);font-size:9px;font-weight:750}\n.carousel-sources{margin-top:14px;padding:14px;border:1px solid #cfe4d7;border-radius:13px;background:#f7fbf9}.carousel-sources-head{display:flex;align-items:end;justify-content:space-between;gap:14px}.carousel-sources-head h3{margin:0;font-size:15px}.carousel-sources-head>span{color:var(--muted);font-size:9px;font-weight:750}.carousel-source-list{margin-top:10px;display:grid;gap:7px}.carousel-source-link{padding:10px 11px;border:1px solid var(--line);border-radius:10px;background:#fff;display:flex;align-items:center;justify-content:space-between;gap:16px;color:var(--ink);text-decoration:none}.carousel-source-link:hover{border-color:#98bba9;box-shadow:0 3px 10px rgba(23,107,75,.08)}.carousel-source-link>span{min-width:0;display:flex;flex-direction:column;gap:4px}.carousel-source-link strong{font-size:10px;line-height:1.35}.carousel-source-link small{color:var(--muted);font-size:9px}.carousel-source-link em{flex:0 0 auto;color:var(--green);font-size:9px;font-style:normal;font-weight:800}\n@media(max-width:900px){.carousel-slides{grid-template-columns:repeat(2,minmax(0,1fr))}.carousel-slide:last-child{grid-column:1/-1}.carousel-teaser{grid-template-columns:1fr 1fr}.carousel-teaser button{grid-column:1/-1;width:100%;min-width:0}}\n@media(max-width:700px){.carousel-meta{grid-template-columns:1fr}.carousel-slides{grid-template-columns:1fr}.carousel-slide,.carousel-slide:last-child{min-height:200px;grid-column:auto}.carousel-teaser{grid-template-columns:1fr}.carousel-source-link{align-items:stretch;flex-direction:column;gap:8px}.carousel-source-link em{align-self:flex-start}}\n@keyframes spin{to{transform:rotate(360deg)}}\n.source-portal-grid{grid-template-columns:1fr;gap:22px}.source-region-group{display:grid;gap:10px}.source-region-heading{display:flex;align-items:end;justify-content:space-between;gap:12px}.source-region-heading h3{margin:0;font-size:16px}.source-region-heading span{color:var(--muted);font-size:10px}.source-region-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.portal-card:disabled{cursor:not-allowed;opacity:.72}.portal-card:disabled:hover{transform:none;box-shadow:0 4px 14px rgba(23,35,30,.025)}.health-region{margin-left:5px;padding:3px 6px;border-radius:999px;background:#e8eeeb;color:#52625a;font-size:8px;font-weight:850;text-transform:uppercase;letter-spacing:.05em}.health-chip:disabled{cursor:not-allowed;opacity:.7}.health-chip:disabled:hover{transform:none;box-shadow:none}\n@media(max-width:900px){.source-region-grid{grid-template-columns:1fr}}\n\n\n/* Leitura Inteligente de Notícias — v2.0.1 */\n.carousel-teaser{grid-template-columns:minmax(0,1fr) minmax(0,1fr) 245px}.carousel-teaser button{min-height:50px;height:auto;padding:10px 18px;font-size:11px}.carousel-meta{grid-template-columns:repeat(5,minmax(0,1fr))}.carousel-loading{margin:16px 0;padding:15px 16px;border:1px solid #cfdcf6;border-radius:13px;background:#f4f7ff;display:flex;align-items:center;gap:12px}.carousel-loading[hidden]{display:none}.carousel-loading.error{border-color:#f0c9c4;background:#fff5f3}.reader-spinner,.reader-error{width:34px;height:34px;flex:0 0 34px;border-radius:10px;display:grid;place-items:center;background:#4565b7;color:#fff;font-size:16px;font-weight:900}.reader-spinner{animation:spin .8s linear infinite}.reader-error{background:var(--red)}.carousel-loading div{display:flex;flex-direction:column;gap:3px}.carousel-loading strong{font-size:12px}.carousel-loading small{color:var(--muted);font-size:10px;line-height:1.4}.carousel-reading,.carousel-analysis,.carousel-entities{margin:14px 0;padding:14px;border:1px solid var(--line);border-radius:13px;background:#fbfcfb}.carousel-reading[hidden],.carousel-analysis[hidden],.carousel-entities[hidden]{display:none}.carousel-section-head{display:flex;align-items:end;justify-content:space-between;gap:14px}.carousel-section-head h3{margin:0;font-size:15px}.carousel-section-head>span{padding:5px 8px;border-radius:999px;background:#eaf4ee;color:var(--green);font-size:9px;font-weight:800}.reading-stats{margin-top:10px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.reading-stats>span{padding:10px;border:1px solid var(--line);border-radius:10px;background:#fff;display:flex;flex-direction:column;gap:4px}.reading-stats small,.entity-grid small{color:var(--muted);font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.05em}.reading-stats strong{font-size:11px}.question-grid{margin-top:10px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.question-grid article{padding:11px;border:1px solid #dbe3f5;border-radius:11px;background:#fff}.question-grid small{color:#4565b7;font-size:8px;font-weight:850;text-transform:uppercase;letter-spacing:.05em}.question-grid p{margin:7px 0 0;color:#526075;font-size:10px;line-height:1.48}.entity-grid{margin-top:10px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.entity-grid>div{min-width:0}.entity-chips{margin-top:6px;display:flex;gap:5px;flex-wrap:wrap}.entity-chips span{max-width:100%;padding:5px 7px;border-radius:999px;background:#edf3f0;color:#40574c;font-size:9px;font-weight:750;overflow-wrap:anywhere}.entity-chips em{color:var(--muted);font-size:9px;font-style:normal}.carousel-slides{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}.carousel-slide{min-height:225px}.carousel-source-link .read-status{font-weight:750}.carousel-source-link.read-ok .read-status{color:var(--green)}.carousel-source-link.read-error .read-status{color:var(--red)}.modal-actions .primary:disabled{opacity:.55;cursor:not-allowed}\n@media(max-width:1000px){.carousel-meta{grid-template-columns:repeat(3,minmax(0,1fr))}.question-grid,.entity-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}\n@media(max-width:900px){.carousel-teaser{grid-template-columns:1fr 1fr}.carousel-teaser button{grid-column:1/-1}.reading-stats{grid-template-columns:1fr 1fr}.reading-stats>span:last-child{grid-column:1/-1}}\n@media(max-width:700px){.carousel-meta,.question-grid,.entity-grid,.reading-stats{grid-template-columns:1fr}.reading-stats>span:last-child{grid-column:auto}.carousel-section-head{align-items:flex-start;flex-direction:column}.carousel-teaser{grid-template-columns:1fr}.carousel-teaser button{grid-column:auto}.carousel-slide{min-height:190px}}\n\n.carousel-disclaimer:empty{display:none}\n"},"/app.js":{"contentType":"text/javascript; charset=utf-8","body":"const STORAGE_TOKEN = \"ronda-editorial-operation-token-v1\";\nconst state = {\n  data: null,\n  health: null,\n  query: \"\",\n  period: 1440,\n  source: \"Todos\",\n  region: \"Todas\",\n  editoria: \"Todas\",\n  portal: null,\n  view: \"round\",\n  expanded: new Set(),\n  running: false,\n  lastRunId: null,\n  carouselText: \"\",\n  smartCarousels: new Map(),\n  activeTopicId: null,\n  carouselLoading: false,\n};\n\nconst numberFormat = new Intl.NumberFormat(\"pt-BR\", { notation: \"compact\", maximumFractionDigits: 1 });\nconst dateFormat = new Intl.DateTimeFormat(\"pt-BR\", { day: \"2-digit\", month: \"2-digit\", year: \"numeric\", hour: \"2-digit\", minute: \"2-digit\" });\nconst runButton = document.getElementById(\"runRound\");\nconst grid = document.getElementById(\"topicsGrid\");\nconst liveDot = document.getElementById(\"liveDot\");\nconst statusLabel = document.getElementById(\"statusLabel\");\nconst statusSub = document.getElementById(\"statusSub\");\nconst roundView = document.getElementById(\"roundView\");\nconst sourcesView = document.getElementById(\"sourcesView\");\n\nfunction escapeHtml(value) {\n  return String(value ?? \"\").replace(/[&<>'\"]/g, (character) => ({ \"&\": \"&amp;\", \"<\": \"&lt;\", \">\": \"&gt;\", \"'\": \"&#39;\", '\"': \"&quot;\" })[character]);\n}\n\nfunction safeUrl(value) {\n  try {\n    const url = new URL(String(value));\n    return /^https?:$/.test(url.protocol) ? url.toString() : \"#\";\n  } catch {\n    return \"#\";\n  }\n}\n\nfunction formatDate(value) {\n  const date = new Date(value);\n  return Number.isFinite(date.getTime()) ? dateFormat.format(date).replace(\",\", \"\") : \"Data não informada\";\n}\n\nfunction relativeTime(value) {\n  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));\n  if (minutes < 1) return \"agora\";\n  if (minutes < 60) return `há ${minutes} min`;\n  const hours = Math.floor(minutes / 60);\n  return hours < 24 ? `há ${hours}h` : `há ${Math.floor(hours / 24)}d`;\n}\n\nfunction setStatus(type, label, sub) {\n  liveDot.className = `live ${type || \"\"}`;\n  statusLabel.textContent = label;\n  statusSub.textContent = sub;\n}\n\nasync function api(path, options = {}) {\n  const response = await fetch(path, { cache: \"no-store\", ...options });\n  const payload = response.status === 204 ? null : await response.json().catch(() => null);\n  if (!response.ok) {\n    const error = new Error(payload?.error || payload?.detail || `Falha HTTP ${response.status}`);\n    error.status = response.status;\n    error.payload = payload;\n    throw error;\n  }\n  return payload;\n}\n\nfunction itemMatchesSource(item) {\n  const matchesType = state.source === \"Todos\" || (state.source === \"Portal\" ? item.kind === \"portal\" : item.kind === \"social\");\n  const matchesPortal = !state.portal || item.collectorName === state.portal || item.sourceName === state.portal;\n  const matchesRegion = state.region === \"Todas\" || item.region === state.region;\n  return matchesType && matchesPortal && matchesRegion;\n}\n\nfunction itemWithinPeriod(item) {\n  const age = (Date.now() - Date.parse(item.publishedAt)) / 60_000;\n  return Number.isFinite(age) && age >= -5 && age <= state.period;\n}\n\nfunction sourceMarkup(item, primary = false) {\n  const platform = item.platform || (item.kind === \"portal\" ? \"Portal\" : \"Rede\");\n  return `<div class=\"${primary ? \"primary\" : \"source\"}\"><div><div class=\"kicker\"><span class=\"kind ${escapeHtml(platform.toLowerCase())}\">${escapeHtml(platform)}</span><button class=\"source-name-button\" data-portal=\"${escapeHtml(item.collectorName || item.sourceName)}\" type=\"button\" title=\"Mostrar somente esta fonte\">${escapeHtml(item.sourceName)}</button><span>${escapeHtml(formatDate(item.publishedAt))}</span></div><h3>${escapeHtml(item.title)}</h3><div class=\"source-footer\"><a class=\"open\" href=\"${escapeHtml(safeUrl(item.url))}\" target=\"_blank\" rel=\"noreferrer\">Abrir para apuração ↗</a></div></div></div>`;\n}\n\nfunction sourceInitials(name) {\n  return String(name || \"?\").split(/\\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join(\"\").toUpperCase();\n}\n\nfunction sourceRegion(source) {\n  return source?.region || (source?.name === \"Bluesky\" ? \"Rede\" : \"Brasil\");\n}\n\nfunction portalCardMarkup(source) {\n  const available = source.ok && Number(source.count) > 0;\n  const portalAttribute = available ? `data-portal=\"${escapeHtml(source.name)}\"` : \"disabled\";\n  const detail = available\n    ? `${Number(source.count)} ${Number(source.count) === 1 ? \"conteúdo recolhido\" : \"conteúdos recolhidos\"}${source.fallback ? \" · rota alternativa\" : \"\"}`\n    : source.ok ? \"Nenhuma notícia recente\" : \"Fonte indisponível nesta ronda\";\n  return `<button class=\"portal-card ${source.ok ? \"ok\" : \"error\"}${state.portal === source.name ? \" selected\" : \"\"}\" ${portalAttribute} type=\"button\"><span class=\"portal-icon\">${escapeHtml(sourceInitials(source.name))}</span><span class=\"portal-card-copy\"><strong>${escapeHtml(source.name)}</strong><small>${escapeHtml(detail)}</small></span><span class=\"portal-state\">${available ? \"Ver notícias →\" : \"Sem coleta\"}</span></button>`;\n}\n\nfunction renderPortalCards() {\n  const holder = document.getElementById(\"sourcePortalGrid\");\n  const sources = state.data?.sources || [];\n  if (!sources.length) {\n    holder.innerHTML = '<div class=\"empty sources-empty\"><strong>Nenhuma fonte consultada ainda</strong><span>Execute uma ronda para carregar os portais.</span></div>';\n    return;\n  }\n  holder.innerHTML = [\"Brasil\", \"Mundo\", \"Rede\"].map((region) => {\n    const regionalSources = sources.filter((source) => sourceRegion(source) === region);\n    if (!regionalSources.length) return \"\";\n    const label = region === \"Rede\" ? \"Complemento social\" : region;\n    const available = regionalSources.filter((source) => source.ok && Number(source.count) > 0).length;\n    return `<section class=\"source-region-group\"><div class=\"source-region-heading\"><h3>${escapeHtml(label)}</h3><span>${available}/${regionalSources.length} ${regionalSources.length === 1 ? \"fonte disponível\" : \"fontes disponíveis\"}</span></div><div class=\"source-region-grid\">${regionalSources.map(portalCardMarkup).join(\"\")}</div></section>`;\n  }).join(\"\");\n}\n\nfunction renderSourceHealth(message = \"\", warning = false) {\n  const holder = document.getElementById(\"sourceHealth\");\n  if (message) {\n    holder.innerHTML = `<span class=\"health-message ${warning ? \"warn\" : \"\"}\">${escapeHtml(message)}</span>`;\n    return;\n  }\n  const sources = state.data?.sources || [];\n  if (!sources.length) {\n    holder.innerHTML = '<span class=\"health-label\">Fontes ainda não consultadas</span>';\n    return;\n  }\n  const portals = sources.filter((source) => sourceRegion(source) !== \"Rede\");\n  const okCount = portals.filter((source) => source.ok && Number(source.count) > 0).length;\n  holder.innerHTML = `<span class=\"health-label\">Portais ${okCount}/${portals.length}</span>${[\"Brasil\", \"Mundo\", \"Rede\"].map((region) => {\n    const regionalSources = sources.filter((source) => sourceRegion(source) === region);\n    if (!regionalSources.length) return \"\";\n    return `<span class=\"health-region\">${escapeHtml(region)}</span>${regionalSources.map((source) => {\n      const available = source.ok && Number(source.count) > 0;\n      const portalAttribute = available ? `data-portal=\"${escapeHtml(source.name)}\"` : \"disabled\";\n      const title = source.error || (available ? `Mostrar somente os ${source.count} conteúdos recolhidos de ${source.name}${source.fallback ? \" por rota alternativa\" : \"\"}` : `Nenhum conteúdo recente de ${source.name}`);\n      const status = available ? `${source.count}${source.fallback ? \" alt.\" : \"\"}` : source.ok ? \"0\" : \"falhou\";\n      return `<button class=\"health-chip ${source.ok ? \"ok\" : \"error\"}${state.portal === source.name ? \" selected\" : \"\"}\" ${portalAttribute} type=\"button\" aria-pressed=\"${state.portal === source.name}\" title=\"${escapeHtml(title)}\"><span class=\"health-icon\">${escapeHtml(sourceInitials(source.name))}</span>${escapeHtml(source.name)} · ${escapeHtml(status)}</button>`;\n    }).join(\"\")}`;\n  }).join(\"\")}`;\n}\n\nfunction setSourceSegment(value) {\n  state.source = value;\n  document.querySelectorAll(\"#sourceFilter button\").forEach((button) => button.classList.toggle(\"active\", button.dataset.value === value));\n}\n\nfunction setRegionSegment(value) {\n  state.region = value;\n  document.querySelectorAll(\"#regionFilter button\").forEach((button) => button.classList.toggle(\"active\", button.dataset.value === value));\n}\n\nfunction updatePortalFilter() {\n  const holder = document.getElementById(\"portalFilter\");\n  holder.hidden = !state.portal;\n  document.getElementById(\"portalFilterName\").textContent = state.portal || \"\";\n}\n\nfunction showView(view) {\n  state.view = view;\n  roundView.hidden = view !== \"round\";\n  sourcesView.hidden = view !== \"sources\";\n  document.getElementById(\"navRound\").classList.toggle(\"active\", view === \"round\");\n  document.getElementById(\"navSources\").classList.toggle(\"active\", view === \"sources\");\n  if (view === \"sources\") renderPortalCards();\n}\n\nfunction filterByPortal(name) {\n  state.portal = name || null;\n  const matchingItem = (state.data?.items || []).find((item) => item.collectorName === name || item.sourceName === name);\n  const matchingSource = (state.data?.sources || []).find((source) => source.name === name);\n  setSourceSegment(name ? (name === \"Bluesky\" || matchingItem?.kind === \"social\" ? \"Rede\" : \"Portal\") : \"Todos\");\n  setRegionSegment(name && sourceRegion(matchingSource) !== \"Rede\" ? sourceRegion(matchingSource) : \"Todas\");\n  state.expanded.clear();\n  showView(\"round\");\n  updatePortalFilter();\n  renderSourceHealth();\n  renderPortalCards();\n  render();\n  document.querySelector(\".controls\").scrollIntoView({ behavior: \"smooth\", block: \"start\" });\n}\n\nfunction render() {\n  const topics = state.data?.topics || [];\n  const query = state.query.trim().toLocaleLowerCase(\"pt-BR\");\n  const visible = topics\n    .map((topic) => ({ ...topic, items: (topic.items || []).filter((item) => itemWithinPeriod(item) && itemMatchesSource(item)) }))\n    .filter((topic) => topic.items.length && (state.editoria === \"Todas\" || (topic.editoria || \"Notícias\") === state.editoria) && (!query || `${topic.title} ${topic.items.map((item) => `${item.sourceName} ${item.title}`).join(\" \")}`.toLocaleLowerCase(\"pt-BR\").includes(query)));\n\n  document.getElementById(\"summaryTopics\").textContent = visible.length;\n  document.getElementById(\"summaryContents\").textContent = visible.reduce((sum, topic) => sum + topic.items.length, 0);\n  document.getElementById(\"summaryChannels\").textContent = new Set(visible.flatMap((topic) => topic.items.map((item) => item.sourceName))).size;\n  document.getElementById(\"summaryUrgent\").textContent = visible.filter((topic) => topic.tone === \"urgent\").length;\n  updatePortalFilter();\n\n  if (!state.data) {\n    grid.innerHTML = '<div class=\"empty\"><strong>Nenhuma ronda disponível</strong><span>A primeira coleta será executada pelo agendamento online ou pelo botão Executar ronda.</span></div>';\n    return;\n  }\n  if (!visible.length) {\n    grid.innerHTML = '<div class=\"empty\"><strong>Nenhum assunto neste filtro</strong><span>Retire um filtro ou aguarde uma nova ronda.</span></div>';\n    return;\n  }\n\n  grid.innerHTML = visible.map((topic) => {\n    const items = [...topic.items].sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));\n    const primary = items.find((item) => item.kind === \"portal\") || items[0];\n    const additional = items.filter((item) => item.id !== primary.id);\n    const sources = [...new Set(items.map((item) => item.sourceName))];\n    const latest = items[0].publishedAt;\n    const open = state.expanded.has(topic.id);\n    const editoria = topic.editoria || \"Notícias\";\n    const carousel = topic.carousel || {};\n    return `<article class=\"card ${escapeHtml(topic.tone)}\"><div class=\"accent\"></div><div class=\"card-body\"><div class=\"topline\"><div class=\"topic-labels\"><span class=\"priority\"><i></i>${escapeHtml(topic.priority)}</span><span class=\"editoria-badge\">${escapeHtml(editoria)}</span></div><span class=\"score\">Índice ${Number(topic.score) || 0}</span></div><h2>${escapeHtml(topic.title)}</h2><div class=\"card-sources\"><span>Fontes</span>${sources.slice(0, 6).map((source) => `<button class=\"source-badge\" data-portal=\"${escapeHtml(source)}\" type=\"button\" title=\"Filtrar por ${escapeHtml(source)}\">${escapeHtml(source)}</button>`).join(\"\")}${sources.length > 6 ? `<span class=\"source-badge\">+${sources.length - 6}</span>` : \"\"}</div><div class=\"published\"><span>Última postagem</span><strong>${escapeHtml(formatDate(latest))}</strong><span class=\"relative\">${escapeHtml(relativeTime(latest))}</span></div><div class=\"momentum\"><span class=\"trend\">↗</span><span>${escapeHtml(topic.momentum)}</span><span class=\"calculated\">calculado nesta ronda</span></div><div class=\"recommendation\"><strong>Recomendação editorial:</strong> ${escapeHtml(topic.recommendation || \"Confirmar as informações nas fontes originais antes de publicar.\")}</div><div class=\"carousel-teaser\"><div><span>Leitura inteligente</span><strong>Conteúdo já coletado de até 5 fontes</strong></div><div><span>Formato</span><strong>${escapeHtml(carousel.postModel || \"Instagram · 7 slides\")}</strong></div><button data-carousel-topic=\"${escapeHtml(topic.id)}\" type=\"button\">Gerar roteiro de carrossel →</button></div>${sourceMarkup(primary, true)}${additional.length ? `<button class=\"toggle\" data-toggle=\"${escapeHtml(topic.id)}\" aria-expanded=\"${open}\" type=\"button\"><span>${open ? \"Ocultar outros conteúdos\" : `Ver mais ${additional.length} ${additional.length === 1 ? \"conteúdo\" : \"conteúdos\"}`}</span><span>${open ? \"⌃\" : \"⌄\"}</span></button>` : \"\"}${open ? `<div class=\"source-list\">${additional.map((item) => sourceMarkup(item)).join(\"\")}</div>` : \"\"}</div></article>`;\n  }).join(\"\");\n\n  grid.querySelectorAll(\"[data-toggle]\").forEach((button) => button.addEventListener(\"click\", () => {\n    const id = button.dataset.toggle;\n    state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);\n    render();\n  }));\n}\n\nfunction applyRound(payload) {\n  if (!payload?.ok || !Array.isArray(payload.topics)) return;\n  state.data = payload;\n  state.lastRunId = payload.runId || state.lastRunId;\n  state.expanded.clear();\n  document.getElementById(\"lastUpdate\").textContent = `Última coleta: ${formatDate(payload.collectedAt)}`;\n  renderSourceHealth();\n  renderPortalCards();\n  render();\n}\n\nasync function loadLatest({ quiet = false } = {}) {\n  try {\n    const response = await api(`/api/latest?t=${Date.now()}`);\n    const payload = response?.data;\n    if (payload?.ok && (!state.lastRunId || payload.runId !== state.lastRunId)) applyRound(payload);\n    return payload;\n  } catch (error) {\n    if (!quiet) renderSourceHealth(error.message);\n    return null;\n  }\n}\n\nfunction openModal(id) {\n  const modal = document.getElementById(id);\n  modal.hidden = false;\n  const input = modal.querySelector(\"input\");\n  if (input) setTimeout(() => input.focus(), 0);\n}\n\nfunction closeModal(id) {\n  document.getElementById(id).hidden = true;\n}\n\nfunction operationToken() {\n  try { return localStorage.getItem(STORAGE_TOKEN) || \"\"; } catch { return \"\"; }\n}\n\nfunction wait(milliseconds) {\n  return new Promise((resolve) => setTimeout(resolve, milliseconds));\n}\n\nasync function waitForRun(runId) {\n  for (let attempt = 0; attempt < 40; attempt += 1) {\n    await wait(attempt === 0 ? 1_000 : 2_500);\n    try {\n      const payload = await api(`/api/runs/${encodeURIComponent(runId)}?t=${Date.now()}`);\n      const run = payload?.run;\n      if (run?.status === \"success\") return run;\n      if (run?.status === \"failed\") throw new Error(run.error || \"A coleta não encontrou conteúdo válido.\");\n      setStatus(\"\", \"Ronda em andamento\", `Coletando fontes… ${Math.min(99, 5 + attempt * 3)}%`);\n    } catch (error) {\n      if (error.status === 404) continue;\n      throw error;\n    }\n  }\n  throw new Error(\"A ronda continua no servidor. O painel será atualizado automaticamente quando ela terminar.\");\n}\n\nasync function executeRound(automatic = false) {\n  if (state.running) return;\n  const token = operationToken();\n  if (state.health?.manualAuthRequired && !token) {\n    document.getElementById(\"tokenMessage\").textContent = \"Informe a chave configurada no Worker para executar manualmente.\";\n    openModal(\"settingsModal\");\n    return;\n  }\n  state.running = true;\n  runButton.disabled = true;\n  runButton.classList.add(\"loading\");\n  runButton.innerHTML = \"<span>↻</span>Coletando fontes…\";\n  setStatus(\"\", \"Ronda em andamento\", \"Consultando portais e fontes sociais\");\n  try {\n    const payload = await api(\"/api/round\", {\n      method: \"POST\",\n      headers: { \"Content-Type\": \"application/json\", ...(token ? { \"X-Round-Token\": token } : {}) },\n      body: JSON.stringify({ source: automatic ? \"initial\" : \"button\" }),\n    });\n    if (!payload?.runId && payload?.data?.ok) {\n      applyRound(payload.data);\n      const legacyTime = payload.data.collectedAt || payload.data.storedAt || new Date().toISOString();\n      setStatus(\"ok\", \"Ronda concluída\", `Coleta finalizada às ${new Date(legacyTime).toLocaleTimeString(\"pt-BR\", { hour: \"2-digit\", minute: \"2-digit\" })}`);\n      return;\n    }\n    if (!payload?.runId) throw new Error(\"O servidor retornou uma resposta de ronda incompatível. Publique todos os arquivos da mesma versão.\");\n    setStatus(\"\", \"Ronda iniciada\", \"O servidor está consultando os portais\");\n    await waitForRun(payload.runId);\n    const completed = await loadLatest();\n    if (!completed?.ok) throw new Error(\"A ronda terminou, mas o resultado ainda não foi carregado.\");\n    const completedAt = completed.collectedAt || completed.storedAt || new Date().toISOString();\n    setStatus(\"ok\", \"Ronda concluída\", `Coleta finalizada às ${new Date(completedAt).toLocaleTimeString(\"pt-BR\", { hour: \"2-digit\", minute: \"2-digit\" })}`);\n  } catch (error) {\n    if (error.status === 401) {\n      document.getElementById(\"tokenMessage\").textContent = \"Chave incorreta. Confira a variável MANUAL_ROUND_TOKEN.\";\n      openModal(\"settingsModal\");\n    }\n    const locked = error.status === 409 || error.status === 429;\n    const pending = error.message.startsWith(\"A ronda continua no servidor\");\n    setStatus(locked || pending ? \"warn\" : \"error\", pending ? \"Ronda ainda em andamento\" : locked ? \"Ronda já em andamento\" : \"Falha ao executar a ronda\", error.message);\n    if (!pending) renderSourceHealth(error.message, locked);\n  } finally {\n    state.running = false;\n    runButton.disabled = false;\n    runButton.classList.remove(\"loading\");\n    runButton.innerHTML = \"<span>↻</span>Executar ronda\";\n  }\n}\n\nasync function checkHealth() {\n  try {\n    const health = await api(`/api/health?t=${Date.now()}`);\n    if (!health || typeof health !== \"object\" || !health.version) throw new Error(\"A versão publicada do Worker não é compatível com este painel.\");\n    state.health = health;\n    const translationReady = health.translation?.ready !== false;\n    document.getElementById(\"automationText\").textContent = !translationReady\n      ? \"Automação ativa; tradução internacional indisponível no Cloudflare.\"\n      : health.schedulerHealthy\n      ? \"Automação online ativa e atualizada.\"\n      : health.lastSuccessAt\n        ? \"Automação online configurada; a última ronda está atrasada.\"\n        : \"Serviço online pronto; aguardando a primeira ronda.\";\n    setStatus(health.schedulerHealthy && translationReady ? \"ok\" : \"warn\", !translationReady ? \"Tradução não configurada\" : health.schedulerHealthy ? \"Serviço online\" : \"Aguardando automação\", !translationReady ? \"O conteúdo internacional será ocultado\" : health.lastSuccessAt ? `Última ronda ${relativeTime(health.lastSuccessAt)}` : \"Execute a primeira ronda\");\n    return true;\n  } catch (error) {\n    state.health = null;\n    setStatus(\"error\", \"Webapp não configurado\", error.message);\n    renderSourceHealth(error.message);\n    document.getElementById(\"automationText\").textContent = \"Configuração incompleta no Cloudflare.\";\n    return false;\n  }\n}\n\nasync function showHistory() {\n  openModal(\"historyModal\");\n  const holder = document.getElementById(\"historyList\");\n  const detail = document.getElementById(\"historyDetail\");\n  const back = document.getElementById(\"historyBack\");\n  holder.hidden = false;\n  detail.hidden = true;\n  back.hidden = true;\n  holder.innerHTML = '<div class=\"loading-row\">Carregando histórico…</div>';\n  try {\n    const payload = await api(\"/api/history?limit=50\");\n    const runs = payload?.runs || [];\n    holder.innerHTML = runs.length ? runs.map((run) => `<button class=\"history-row\" data-history-run=\"${escapeHtml(run.id)}\" type=\"button\" ${run.status === \"running\" ? \"disabled\" : \"\"}><span class=\"history-date\"><strong>${escapeHtml(formatDate(run.completed_at))}</strong><small>${run.trigger_type === \"scheduled\" ? \"Automática\" : \"Manual\"}</small></span><span class=\"history-status ${run.status}\">${run.status === \"success\" ? \"Concluída\" : run.status === \"running\" ? \"Em andamento\" : \"Falhou\"}</span><span>${Number(run.items_count) || 0} conteúdos</span><span>${Number(run.topics_count) || 0} assuntos</span><span class=\"history-open\"><strong>${Number(run.sources_count) || 0} fontes</strong><small>${run.status === \"running\" ? \"Aguarde\" : \"Ver notícias →\"}</small></span></button>`).join(\"\") : '<div class=\"loading-row\">Nenhuma ronda armazenada.</div>';\n  } catch (error) {\n    holder.innerHTML = `<div class=\"loading-row\">${escapeHtml(error.message)}</div>`;\n  }\n}\n\nasync function showHistoryDetail(runId) {\n  const holder = document.getElementById(\"historyList\");\n  const detail = document.getElementById(\"historyDetail\");\n  const back = document.getElementById(\"historyBack\");\n  holder.hidden = true;\n  detail.hidden = false;\n  back.hidden = false;\n  detail.innerHTML = '<div class=\"loading-row\">Carregando as notícias desta ronda…</div>';\n  try {\n    const response = await api(`/api/runs/${encodeURIComponent(runId)}/data?t=${Date.now()}`);\n    const data = response?.data || {};\n    const run = response?.run || {};\n    const items = [...(data.items || [])].sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));\n    const sourceCounts = new Map();\n    for (const item of items) {\n      const source = item.collectorName || item.sourceName || \"Fonte não informada\";\n      sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);\n    }\n    const sourceChips = [...sourceCounts.entries()].sort((left, right) => right[1] - left[1]).map(([name, count]) => `<span>${escapeHtml(name)} · ${count}</span>`).join(\"\");\n    const news = items.length ? items.map((item) => `<article class=\"history-news\"><div class=\"history-news-meta\"><span class=\"kind ${escapeHtml((item.platform || item.kind || \"fonte\").toLowerCase())}\">${escapeHtml(item.platform || (item.kind === \"social\" ? \"Rede\" : \"Portal\"))}</span><strong>${escapeHtml(item.sourceName || item.collectorName || \"Fonte não informada\")}</strong><time>${escapeHtml(formatDate(item.publishedAt))}</time></div><h3>${escapeHtml(item.title)}</h3>${item.description ? `<p>${escapeHtml(item.description)}</p>` : \"\"}<a href=\"${escapeHtml(safeUrl(item.url))}\" target=\"_blank\" rel=\"noreferrer\">Abrir para apuração ↗</a></article>`).join(\"\") : '<div class=\"empty history-empty\"><strong>Nenhuma notícia armazenada nesta ronda</strong><span>Consulte o estado das fontes ou selecione outra ronda.</span></div>';\n    detail.innerHTML = `<section class=\"history-detail-head\"><p class=\"eyebrow\">Notícias apuradas neste período</p><h3>${escapeHtml(formatDate(run.completedAt || data.collectedAt))}</h3><p>${run.triggerType === \"scheduled\" ? \"Ronda automática\" : \"Ronda manual\"} · ${items.length} conteúdos · ${Number(data.totals?.topics) || 0} assuntos</p></section>${sourceChips ? `<div class=\"history-source-chips\">${sourceChips}</div>` : \"\"}<div class=\"history-news-list\">${news}</div>`;\n  } catch (error) {\n    detail.innerHTML = `<div class=\"loading-row\">${escapeHtml(error.message)}</div>`;\n  }\n}\n\nfunction topicVerificationLinks(topic) {\n  const storedLinks = Array.isArray(topic?.carousel?.verificationLinks) ? topic.carousel.verificationLinks : [];\n  const candidates = storedLinks.length ? storedLinks : (topic?.items || []);\n  const links = [];\n  const seen = new Set();\n  for (const item of candidates) {\n    const url = safeUrl(item?.url);\n    if (url === \"#\" || seen.has(url)) continue;\n    seen.add(url);\n    links.push({\n      title: item?.title || \"Notícia sem título\",\n      sourceName: item?.sourceName || item?.collectorName || \"Fonte não informada\",\n      publishedAt: item?.publishedAt || null,\n      url,\n    });\n  }\n  return links;\n}\n\nfunction entityLine(label, values) {\n  const list = Array.isArray(values) ? values.filter(Boolean) : [];\n  return `${label}: ${list.length ? list.join(\", \") : \"Não identificado\"}`;\n}\n\nfunction carouselAsText(topic, carousel) {\n  const slides = Array.isArray(carousel?.slides) ? carousel.slides : [];\n  const verificationLinks = Array.isArray(carousel?.verificationLinks) && carousel.verificationLinks.length\n    ? carousel.verificationLinks\n    : topicVerificationLinks(topic);\n  const questions = carousel?.questions || {};\n  const entities = carousel?.entities || {};\n  const reading = carousel?.reading || {};\n  return [\n    `ROTEIRO DE CARROSSEL — ${topic.editoria || \"Notícias\"}`,\n    \"LEITURA INTELIGENTE — CONTEÚDO DA RONDA\",\n    `Modo: ${carousel?.analysisMode === \"ai\" ? \"Workers AI\" : \"Análise automática de contingência\"}`,\n    `Qualidade: ${reading.qualityLabel || \"Conteúdo coletado\"}`,\n    `Fontes utilizadas: ${Number(reading.successful) || 0}/${Number(reading.requested) || 0}`,\n    `Palavras coletadas: ${Number(reading.totalWords) || 0}`,\n    `Tom de voz: ${carousel?.voiceTone || \"Jornalístico, factual e explicativo\"}`,\n    `Formato: ${carousel?.postModel || \"Instagram · 7 slides\"}`,\n    \"\",\n    \"INTERPRETAÇÃO DA NOTÍCIA\",\n    `O que aconteceu: ${questions.whatHappened || \"Não informado\"}`,\n    `Quem está envolvido: ${questions.who || \"Não informado\"}`,\n    `Onde aconteceu: ${questions.where || \"Não informado\"}`,\n    `Quando aconteceu: ${questions.when || \"Não informado\"}`,\n    `Qual o impacto: ${questions.impact || \"Não informado\"}`,\n    `Qual a repercussão: ${questions.repercussion || \"Não informado\"}`,\n    \"\",\n    \"DADOS ESTRUTURADOS\",\n    entityLine(\"Personagens\", entities.people),\n    entityLine(\"Empresas\", entities.companies),\n    entityLine(\"Locais\", entities.places),\n    entityLine(\"Datas\", entities.dates),\n    entityLine(\"Temas\", entities.themes),\n    entityLine(\"Palavras-chave\", entities.keywords),\n    \"\",\n    ...slides.flatMap((slide) => [\n      `SLIDE ${slide.number} — ${String(slide.role || \"\").toUpperCase()}`,\n      slide.title || \"\",\n      slide.subtitle || slide.body || \"\",\n      \"\",\n    ]),\n    \"LINKS PARA APURAÇÃO\",\n    ...verificationLinks.flatMap((link, index) => [\n      `${index + 1}. ${link.title}`,\n      `Portal: ${link.sourceName}`,\n      `URL: ${link.url}`,\n      \"\",\n    ]),\n    carousel?.disclaimer || \"Revise e confirme as informações antes de publicar.\",\n  ].join(\"\\n\").trim();\n}\n\nfunction carouselCacheKey(topicId) {\n  return `${state.data?.runId || state.lastRunId || \"latest\"}:${topicId}`;\n}\n\nfunction setCarouselLoading(loading, message = \"\") {\n  state.carouselLoading = loading;\n  const holder = document.getElementById(\"carouselLoading\");\n  holder.hidden = false;\n  holder.classList.toggle(\"error\", !loading && Boolean(message));\n  holder.innerHTML = loading\n    ? '<span class=\"reader-spinner\">↻</span><div><strong>Analisando o conteúdo da ronda…</strong><small>Cruzando títulos, textos e resumos que as fontes já entregaram durante a coleta.</small></div>'\n    : `<span class=\"reader-error\">!</span><div><strong>Roteiro não concluído</strong><small>${escapeHtml(message)}</small></div>`;\n  document.getElementById(\"copyCarousel\").disabled = loading || Boolean(message);\n}\n\nfunction questionCard(label, value) {\n  return `<article><small>${escapeHtml(label)}</small><p>${escapeHtml(value || \"Não informado no conteúdo coletado.\")}</p></article>`;\n}\n\nfunction entityGroup(label, values) {\n  const list = Array.isArray(values) ? values.filter(Boolean) : [];\n  return `<div><small>${escapeHtml(label)}</small><div class=\"entity-chips\">${list.length ? list.map((item) => `<span>${escapeHtml(item)}</span>`).join(\"\") : '<em>Não identificado</em>'}</div></div>`;\n}\n\nfunction renderIntelligentCarousel(topic, carousel) {\n  document.getElementById(\"carouselLoading\").hidden = true;\n  document.getElementById(\"carouselTitle\").textContent = topic.title;\n  const reading = carousel.reading || {};\n  document.getElementById(\"carouselMeta\").innerHTML = `<span><small>Editoria</small><strong>${escapeHtml(topic.editoria || \"Notícias\")}</strong></span><span><small>Idioma</small><strong>Português</strong></span><span><small>Tom de voz</small><strong>${escapeHtml(carousel.voiceTone || \"Jornalístico e factual\")}</strong></span><span><small>Formato</small><strong>${escapeHtml(carousel.postModel || \"Instagram · 7 slides\")}</strong></span><span><small>Análise</small><strong>${carousel.analysisMode === \"ai\" ? \"Workers AI\" : \"Contingência automática\"}</strong></span>`;\n  const readingHolder = document.getElementById(\"carouselReading\");\n  readingHolder.hidden = false;\n  readingHolder.innerHTML = `<div class=\"carousel-section-head\"><div><p class=\"eyebrow\">Conteúdo da ronda</p><h3>Análise baseada no material já coletado</h3></div><span>${Number(reading.successful) || 0}/${Number(reading.requested) || 0} fontes</span></div><div class=\"reading-stats\"><span><small>Qualidade do material</small><strong>${escapeHtml(reading.qualityLabel || \"Conteúdo coletado\")}</strong></span><span><small>Palavras coletadas</small><strong>${Number(reading.totalWords) || 0}</strong></span><span><small>Processamento</small><strong>${carousel.analysisMode === \"ai\" ? \"IA estruturada\" : \"Fallback local\"}</strong></span></div>`;\n\n  const questions = carousel.questions || {};\n  const analysisHolder = document.getElementById(\"carouselAnalysis\");\n  analysisHolder.hidden = false;\n  analysisHolder.innerHTML = `<div class=\"carousel-section-head\"><div><p class=\"eyebrow\">Interpretação da notícia</p><h3>Respostas editoriais</h3></div></div><div class=\"question-grid\">${questionCard(\"O que aconteceu?\", questions.whatHappened)}${questionCard(\"Quem está envolvido?\", questions.who)}${questionCard(\"Onde aconteceu?\", questions.where)}${questionCard(\"Quando aconteceu?\", questions.when)}${questionCard(\"Qual o impacto?\", questions.impact)}${questionCard(\"Qual a repercussão?\", questions.repercussion)}</div>`;\n\n  const entities = carousel.entities || {};\n  const entityHolder = document.getElementById(\"carouselEntities\");\n  entityHolder.hidden = false;\n  entityHolder.innerHTML = `<div class=\"carousel-section-head\"><div><p class=\"eyebrow\">Estrutura de dados</p><h3>Elementos extraídos</h3></div></div><div class=\"entity-grid\">${entityGroup(\"Personagens\", entities.people)}${entityGroup(\"Empresas\", entities.companies)}${entityGroup(\"Locais\", entities.places)}${entityGroup(\"Datas\", entities.dates)}${entityGroup(\"Temas\", entities.themes)}${entityGroup(\"Palavras-chave\", entities.keywords)}</div>`;\n\n  document.getElementById(\"carouselSlides\").innerHTML = (carousel.slides || []).map((slide) => `<article class=\"carousel-slide\"><div><span>${Number(slide.number) || \"\"}</span><small>${escapeHtml(slide.role)}</small></div><h3>${escapeHtml(slide.title)}</h3><p>${escapeHtml(slide.subtitle || slide.body).replace(/\\n/g, \"<br>\")}</p></article>`).join(\"\");\n  const verificationLinks = Array.isArray(carousel.verificationLinks) ? carousel.verificationLinks : topicVerificationLinks(topic);\n  const readingSources = new Map((reading.sources || []).map((item) => [safeUrl(item.url), item]));\n  document.getElementById(\"carouselSources\").innerHTML = `<div class=\"carousel-sources-head\"><div><p class=\"eyebrow\">Apuração obrigatória</p><h3>Fontes utilizadas e links originais</h3></div><span>${verificationLinks.length} ${verificationLinks.length === 1 ? \"notícia\" : \"notícias\"}</span></div><div class=\"carousel-source-list\">${verificationLinks.map((link) => {\n    const source = readingSources.get(safeUrl(link.url));\n    const level = source?.contentLevel === \"content\" ? \"Texto do feed\" : source?.contentLevel === \"summary\" ? \"Resumo do feed\" : source ? \"Somente título\" : \"Link adicional\";\n    const status = source ? `${level} · ${Number(source.wordCount) || 0} palavras` : \"Link adicional para apuração\";\n    return `<a class=\"carousel-source-link ${source ? \"read-ok\" : \"\"}\" href=\"${escapeHtml(safeUrl(link.url))}\" target=\"_blank\" rel=\"noreferrer\"><span><strong>${escapeHtml(link.title)}</strong><small>${escapeHtml(link.sourceName)}${link.publishedAt ? ` · ${escapeHtml(formatDate(link.publishedAt))}` : \"\"}</small><small class=\"read-status\">${escapeHtml(status)}</small></span><em>Abrir para apuração ↗</em></a>`;\n  }).join(\"\")}</div>`;\n  document.getElementById(\"carouselDisclaimer\").textContent = carousel.disclaimer || \"Revise e confirme as informações antes de publicar.\";\n  document.getElementById(\"copyCarouselMessage\").textContent = carousel.aiError ? `A IA falhou e foi usado o modo de contingência: ${carousel.aiError}` : \"\";\n  state.carouselText = carouselAsText(topic, carousel);\n  document.getElementById(\"copyCarousel\").disabled = false;\n}\n\nasync function showCarousel(topicId) {\n  const topic = (state.data?.topics || []).find((item) => item.id === topicId);\n  if (!topic) {\n    setStatus(\"warn\", \"Assunto indisponível\", \"Atualize a ronda e tente novamente.\");\n    return;\n  }\n  state.activeTopicId = topicId;\n  document.getElementById(\"carouselTitle\").textContent = topic.title;\n  document.getElementById(\"carouselMeta\").innerHTML = \"\";\n  document.getElementById(\"carouselReading\").hidden = true;\n  document.getElementById(\"carouselAnalysis\").hidden = true;\n  document.getElementById(\"carouselEntities\").hidden = true;\n  document.getElementById(\"carouselSlides\").innerHTML = \"\";\n  document.getElementById(\"carouselSources\").innerHTML = \"\";\n  document.getElementById(\"carouselDisclaimer\").textContent = \"\";\n  document.getElementById(\"copyCarouselMessage\").textContent = \"\";\n  state.carouselText = \"\";\n  openModal(\"carouselModal\");\n\n  const key = carouselCacheKey(topicId);\n  const cached = state.smartCarousels.get(key);\n  if (cached) {\n    renderIntelligentCarousel(topic, cached);\n    return;\n  }\n  setCarouselLoading(true);\n  const token = operationToken();\n  try {\n    const response = await api(`/api/topics/${encodeURIComponent(topicId)}/intelligent-carousel`, {\n      method: \"POST\",\n      headers: { \"Content-Type\": \"application/json\", ...(token ? { \"X-Round-Token\": token } : {}) },\n      body: JSON.stringify({ runId: state.data?.runId || state.lastRunId || null }),\n    });\n    if (!response?.data?.slides?.length) throw new Error(\"O servidor não retornou os sete slides esperados.\");\n    state.smartCarousels.set(key, response.data);\n    renderIntelligentCarousel(topic, response.data);\n  } catch (error) {\n    if (error.status === 401) {\n      document.getElementById(\"tokenMessage\").textContent = \"Informe a chave do Worker para usar a leitura inteligente.\";\n    }\n    setCarouselLoading(false, error.message);\n    document.getElementById(\"carouselSources\").innerHTML = `<div class=\"carousel-sources-head\"><div><p class=\"eyebrow\">Apuração manual</p><h3>Abra as notícias originais</h3></div></div><div class=\"carousel-source-list\">${topicVerificationLinks(topic).map((link) => `<a class=\"carousel-source-link\" href=\"${escapeHtml(link.url)}\" target=\"_blank\" rel=\"noreferrer\"><span><strong>${escapeHtml(link.title)}</strong><small>${escapeHtml(link.sourceName)}</small></span><em>Abrir para apuração ↗</em></a>`).join(\"\")}</div>`;\n  }\n}\n\nasync function copyCarouselText() {\n  const message = document.getElementById(\"copyCarouselMessage\");\n  try {\n    await navigator.clipboard.writeText(state.carouselText);\n    message.textContent = \"Roteiro copiado.\";\n  } catch {\n    const area = document.createElement(\"textarea\");\n    area.value = state.carouselText;\n    area.setAttribute(\"readonly\", \"\");\n    area.style.position = \"fixed\";\n    area.style.opacity = \"0\";\n    document.body.appendChild(area);\n    area.select();\n    const copied = document.execCommand(\"copy\");\n    area.remove();\n    message.textContent = copied ? \"Roteiro copiado.\" : \"Não foi possível copiar automaticamente.\";\n  }\n}\n\nasync function startApplication() {\n  render();\n  document.getElementById(\"operationToken\").value = operationToken();\n  const healthy = await checkHealth();\n  if (!healthy) return;\n  const latest = await loadLatest();\n  if (!latest && (!state.health.manualAuthRequired || operationToken())) executeRound(true);\n}\n\nrunButton.addEventListener(\"click\", () => executeRound(false));\ndocument.getElementById(\"searchInput\").addEventListener(\"input\", (event) => { state.query = event.target.value; render(); });\ndocument.getElementById(\"periodFilter\").addEventListener(\"click\", (event) => {\n  if (!event.target.matches(\"button\")) return;\n  state.period = Number(event.target.dataset.value);\n  event.currentTarget.querySelectorAll(\"button\").forEach((button) => button.classList.toggle(\"active\", button === event.target));\n  render();\n});\ndocument.getElementById(\"sourceFilter\").addEventListener(\"click\", (event) => {\n  if (!event.target.matches(\"button\")) return;\n  state.portal = null;\n  setSourceSegment(event.target.dataset.value);\n  state.expanded.clear();\n  renderSourceHealth();\n  render();\n});\ndocument.getElementById(\"regionFilter\").addEventListener(\"click\", (event) => {\n  if (!event.target.matches(\"button\")) return;\n  state.portal = null;\n  setRegionSegment(event.target.dataset.value);\n  state.expanded.clear();\n  renderSourceHealth();\n  render();\n});\ndocument.getElementById(\"editoriaFilter\").addEventListener(\"click\", (event) => {\n  const button = event.target.closest(\"[data-editoria]\");\n  if (!button) return;\n  state.editoria = button.dataset.editoria;\n  event.currentTarget.querySelectorAll(\"[data-editoria]\").forEach((item) => item.classList.toggle(\"active\", item === button));\n  state.expanded.clear();\n  render();\n});\ndocument.getElementById(\"topicsGrid\").addEventListener(\"click\", (event) => {\n  const button = event.target.closest(\"[data-carousel-topic]\");\n  if (button) showCarousel(button.dataset.carouselTopic);\n});\ndocument.getElementById(\"copyCarousel\").addEventListener(\"click\", copyCarouselText);\ndocument.getElementById(\"settingsButton\").addEventListener(\"click\", () => openModal(\"settingsModal\"));\ndocument.getElementById(\"openSettings\").addEventListener(\"click\", () => openModal(\"settingsModal\"));\ndocument.getElementById(\"navHistory\").addEventListener(\"click\", showHistory);\ndocument.getElementById(\"historyList\").addEventListener(\"click\", (event) => {\n  const row = event.target.closest(\"[data-history-run]\");\n  if (row && !row.disabled) showHistoryDetail(row.dataset.historyRun);\n});\ndocument.getElementById(\"historyBack\").addEventListener(\"click\", () => {\n  document.getElementById(\"historyDetail\").hidden = true;\n  document.getElementById(\"historyList\").hidden = false;\n  document.getElementById(\"historyBack\").hidden = true;\n});\ndocument.getElementById(\"navSources\").addEventListener(\"click\", () => { showView(\"sources\"); document.getElementById(\"workspaceTop\").scrollIntoView({ behavior: \"smooth\" }); });\ndocument.getElementById(\"navRound\").addEventListener(\"click\", () => { showView(\"round\"); document.getElementById(\"workspaceTop\").scrollIntoView({ behavior: \"smooth\" }); });\ndocument.getElementById(\"goTop\").addEventListener(\"click\", () => document.getElementById(\"workspaceTop\").scrollIntoView({ behavior: \"smooth\" }));\ndocument.getElementById(\"showAllSources\").addEventListener(\"click\", () => filterByPortal(null));\ndocument.getElementById(\"clearPortalFilter\").addEventListener(\"click\", () => filterByPortal(null));\ndocument.addEventListener(\"click\", (event) => {\n  const button = event.target.closest(\"[data-portal]\");\n  if (!button) return;\n  filterByPortal(button.dataset.portal);\n});\ndocument.getElementById(\"saveSettings\").addEventListener(\"click\", () => {\n  const token = document.getElementById(\"operationToken\").value.trim();\n  try { token ? localStorage.setItem(STORAGE_TOKEN, token) : localStorage.removeItem(STORAGE_TOKEN); } catch {}\n  document.getElementById(\"tokenMessage\").textContent = \"\";\n  closeModal(\"settingsModal\");\n});\ndocument.querySelectorAll(\"[data-close]\").forEach((button) => button.addEventListener(\"click\", () => closeModal(button.dataset.close)));\ndocument.querySelectorAll(\".modal-backdrop\").forEach((backdrop) => backdrop.addEventListener(\"click\", (event) => { if (event.target === backdrop) closeModal(backdrop.id); }));\ndocument.addEventListener(\"keydown\", (event) => { if (event.key === \"Escape\") document.querySelectorAll(\".modal-backdrop:not([hidden])\").forEach((modal) => closeModal(modal.id)); });\n\nsetInterval(async () => {\n  if (state.running || !state.health) return;\n  await checkHealth();\n  await loadLatest({ quiet: true });\n}, 30_000);\n\nstartApplication();\n"}});

return { "UI_ASSETS": UI_ASSETS };
})();

const __module_src_index_js = (() => {
const { buildCarouselBrief, buildTopics, classifyEditoria } = __module_src_clustering_js;
const { ARTICLE_ANALYSIS_MODEL, buildIntelligentCarousel, extractArticleFromHtml, intelligentCarouselCacheKey } = __module_src_article_reader_js;
const { collectRound } = __module_src_collector_js;
const { acquireLock,
  databaseHealth,
  databaseSelfTest,
  ensureSchema,
  getIntelligentCarousel,
  getLatestRound,
  getRunHistory,
  getRunPayload,
  getRunStatus,
  releaseLock,
  saveIntelligentCarousel,
  saveRun,
  startRun, } = __module_src_database_js;
const { parseFeed } = __module_src_parser_js;
const { portugueseOnlyFallback, TRANSLATION_MODEL, translateRoundPayload } = __module_src_translation_js;
const { UI_ASSETS } = __module_src_ui_generated_js;








const VERSION = "2.0.1";
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

class HttpError extends Error {
  constructor(status, message, detail = null) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...SECURITY_HEADERS, ...extraHeaders } });
}

function assetResponse(asset) {
  return new Response(asset.body, {
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": asset.contentType,
      "Cache-Control": "no-store, max-age=0",
      "X-Ronda-Version": VERSION,
    },
  });
}

function secureEqual(left, right) {
  const a = new TextEncoder().encode(String(left ?? ""));
  const b = new TextEncoder().encode(String(right ?? ""));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

function requireDatabase(env) {
  if (!env.DB) throw new HttpError(503, "Banco D1 não configurado.", "Crie um banco D1 e adicione ao Worker um binding chamado DB.");
  return env.DB;
}

function withEditorias(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.topics)) return payload;
  const safePayload = payload.translation?.targetLanguage === "pt-BR" && payload.translation?.portugueseOnly
    ? payload
    : portugueseOnlyFallback(payload);
  return {
    ...safePayload,
    topics: safePayload.topics.map((topic) => {
      const enriched = topic?.editoria
        ? topic
        : { ...topic, editoria: classifyEditoria(topic?.items || []) };
      const expectedUrls = new Set((enriched?.items || [])
        .map((item) => String(item?.url || "").trim())
        .filter((url) => /^https?:\/\//i.test(url)));
      const carouselUrls = new Set((enriched?.carousel?.verificationLinks || [])
        .map((item) => String(item?.url || "").trim())
        .filter((url) => /^https?:\/\//i.test(url)));
      const carouselHasEveryLink = expectedUrls.size > 0 && [...expectedUrls].every((url) => carouselUrls.has(url));
      return enriched?.carousel?.slides?.length && carouselHasEveryLink
        ? enriched
        : { ...enriched, carousel: buildCarouselBrief(enriched) };
    }),
  };
}

function translationAi(env) {
  if (env.AI?.run) return env.AI;
  if (env.ENVIRONMENT === "test" && env.TRANSLATION_TEST_MODE === "1") {
    return { run: async (_model, input) => ({ translated_text: String(input?.text || "") }) };
  }
  return null;
}

function articleAnalysisAi(env) {
  if (env.AI?.run) return env.AI;
  if (env.ENVIRONMENT === "test" && env.ARTICLE_ANALYSIS_TEST_MODE === "1") {
    return {
      run: async () => ({
        response: {
          questions: {
            whatHappened: "O Congresso aprovou um plano nacional de mobilidade urbana.",
            who: "Congresso Nacional e órgãos públicos responsáveis pela mobilidade.",
            where: "Brasil.",
            when: "Na data informada pelas matérias da ronda.",
            impact: "A medida pode orientar investimentos e mudanças na mobilidade urbana.",
            repercussion: "O tema também apareceu em publicações sociais monitoradas pela ronda.",
          },
          entities: {
            people: [],
            companies: ["Congresso Nacional"],
            places: ["Brasil"],
            dates: [],
            themes: ["mobilidade urbana", "política pública"],
            keywords: ["mobilidade", "Congresso", "investimentos"],
          },
          slides: [
            { number: 1, role: "Título principal", title: "Congresso aprova plano de mobilidade urbana", body: "A proposta avança e passa a orientar novas medidas no país." },
            { number: 2, role: "Contexto", title: "Por que o tema importa", body: "A mobilidade urbana afeta deslocamentos, transporte público e planejamento das cidades." },
            { number: 3, role: "Informação principal", title: "O que foi aprovado", body: "O Congresso aprovou um novo plano nacional para o setor." },
            { number: 4, role: "Detalhamento", title: "O que as matérias mostram", body: "Os textos relacionam a medida a investimentos e projetos de infraestrutura." },
            { number: 5, role: "Consequência", title: "Impacto esperado", body: "A decisão pode influenciar prioridades e recursos destinados às cidades." },
            { number: 6, role: "Conclusão", title: "Próximos passos", body: "A aplicação prática dependerá dos desdobramentos e das regras complementares." },
            { number: 7, role: "CTA", title: "Acompanhe a pauta", body: "Consulte as fontes originais e acompanhe as próximas atualizações." },
          ],
        },
      }),
    };
  }
  return null;
}

async function performRound(env, triggerType, options = {}) {
  const db = requireDatabase(env);
  await ensureSchema(db);
  const lock = options.lock || await acquireLock(db, "editorial-round", 3 * 60 * 1000);
  if (!lock) throw new HttpError(409, "Já existe uma ronda em andamento.");

  const runId = options.runId || crypto.randomUUID();
  const startedAt = options.startedAt || new Date().toISOString();
  try {
    if (!options.runStarted) await startRun(db, { id: runId, triggerType, startedAt });
    let payload;
    try {
      payload = await collectRound();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("O coletor não retornou um resultado válido.");
      }
      try {
        payload = await translateRoundPayload(payload, { ai: translationAi(env), db });
      } catch (error) {
        console.error("Tradução da ronda falhou", error);
        payload = portugueseOnlyFallback(payload);
      }
    } catch (error) {
      payload = {
        ok: false,
        collectedAt: new Date().toISOString(),
        windowHours: 24,
        durationMs: Date.now() - Date.parse(startedAt),
        error: "A coleta foi interrompida por um erro interno.",
        detail: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
        sources: [],
        totals: { items: 0, topics: 0, sources: 0, socialItems: 0 },
        items: [],
        topics: [],
      };
    }
    await saveRun(db, { id: runId, triggerType, startedAt, payload });
    const storedPayload = { ...payload, runId, triggerType };
    if (!payload.ok) throw new HttpError(503, payload.error, payload.detail || null);
    return storedPayload;
  } finally {
    await releaseLock(db, lock);
  }
}

async function selfTest() {
  const now = new Date();
  const published = now.toUTCString();
  const fixture = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item><title>Prefeitura anuncia plano de mobilidade urbana</title><link>https://example.test/a</link><pubDate>${published}</pubDate><description>Teste A</description></item>
    <item><title>Plano de mobilidade urbana é anunciado pela prefeitura</title><link>https://example.test/b</link><pubDate>${published}</pubDate><description>Teste B</description></item>
  </channel></rss>`;
  const items = parseFeed(fixture, { id: "test", name: "Teste" }, new Date(now.getTime() - 86_400_000));
  const topics = buildTopics(items, now);
  const article = extractArticleFromHtml(`<html><body><nav>Menu principal</nav><div class="publicidade">Compre agora</div><article><h1>Plano de mobilidade</h1><p>A prefeitura apresentou um plano de mobilidade urbana para melhorar o transporte público e reorganizar os deslocamentos na cidade.</p><p>O projeto prevê corredores de ônibus, integração tarifária, novas ciclovias e revisão das linhas que atendem os bairros mais afastados.</p><p>Segundo a administração municipal, a implantação será feita em etapas e dependerá de estudos técnicos, recursos orçamentários e audiências públicas.</p></article></body></html>`, { title: "Plano de mobilidade" });
  const articleOk = article.wordCount >= 45 && !article.content.includes("Compre agora") && !article.content.includes("Menu principal");
  return {
    ok: items.length === 2 && topics.length === 1 && topics[0].itemCount === 2 && articleOk,
    parserItems: items.length,
    groupedTopics: topics.length,
    cardItems: topics[0]?.itemCount ?? 0,
    articleWords: article.wordCount,
    articleNoiseRemoved: articleOk,
  };
}

async function handleApi(request, env, url, ctx) {
  if (url.pathname === "/api/self-test" && request.method === "GET") {
    const logic = await selfTest();
    const db = requireDatabase(env);
    const databaseOk = await databaseSelfTest(db);
    const result = {
      ...logic,
      ok: logic.ok && databaseOk,
      database: { configured: true, readWriteDelete: databaseOk },
    };
    return json(result, result.ok ? 200 : 500);
  }

  if (url.pathname === "/api/health" && request.method === "GET") {
    const db = requireDatabase(env);
    const dbOk = await databaseHealth(db);
    const latest = await getLatestRound(db);
    const lastSuccessAt = latest?.collectedAt ?? null;
    const ageMs = lastSuccessAt ? Date.now() - Date.parse(lastSuccessAt) : Number.POSITIVE_INFINITY;
    return json({
      ok: dbOk,
      ready: dbOk,
      service: "ronda-editorial-webapp",
      version: VERSION,
      database: dbOk ? "connected" : "error",
      scheduleMinutes: 5,
      schedulerHealthy: ageMs <= 12 * 60 * 1000,
      lastSuccessAt,
      lastRunId: latest?.runId ?? null,
      manualAuthRequired: Boolean(env.MANUAL_ROUND_TOKEN),
      translation: {
        ready: Boolean(translationAi(env)?.run),
        targetLanguage: "pt-BR",
        model: TRANSLATION_MODEL,
      },
      intelligentReading: {
        ready: true,
        aiReady: Boolean(articleAnalysisAi(env)?.run),
        mode: "round-collected-content",
        articleLimit: 5,
        model: env.ARTICLE_ANALYSIS_MODEL || ARTICLE_ANALYSIS_MODEL,
      },
    });
  }

  if (url.pathname === "/api/latest" && request.method === "GET") {
    const latest = await getLatestRound(requireDatabase(env));
    return json({ ok: true, data: withEditorias(latest) });
  }

  if (url.pathname === "/api/history" && request.method === "GET") {
    const runs = await getRunHistory(requireDatabase(env), url.searchParams.get("limit"));
    return json({ ok: true, runs });
  }

  const runRoute = /^\/api\/runs\/([a-z0-9-]{8,80})(\/data)?$/i.exec(url.pathname);
  if (runRoute && request.method === "GET") {
    const runId = runRoute[1];
    if (runRoute[2]) {
      const stored = await getRunPayload(requireDatabase(env), runId);
      if (!stored) throw new HttpError(404, "Ronda não encontrada.");
      if (!stored.payload) throw new HttpError(409, "Esta ronda ainda não possui notícias disponíveis.");
      return json({
        ok: true,
        run: {
          id: stored.id,
          triggerType: stored.triggerType,
          status: stored.status,
          startedAt: stored.startedAt,
          completedAt: stored.completedAt,
          error: stored.error,
        },
        data: withEditorias({ ...stored.payload, runId: stored.id, triggerType: stored.triggerType, storedAt: stored.completedAt }),
      });
    }
    const run = await getRunStatus(requireDatabase(env), runId);
    if (!run) throw new HttpError(404, "Ronda ainda não encontrada.");
    return json({ ok: true, run });
  }

  const intelligentCarouselRoute = /^\/api\/topics\/([a-z0-9-]{6,100})\/intelligent-carousel$/i.exec(url.pathname);
  if (intelligentCarouselRoute && request.method === "POST") {
    if (env.MANUAL_ROUND_TOKEN && !secureEqual(request.headers.get("X-Round-Token"), env.MANUAL_ROUND_TOKEN)) {
      throw new HttpError(401, "Chave de operação inválida para usar a leitura inteligente.");
    }
    const body = await request.json().catch(() => ({}));
    const db = requireDatabase(env);
    let runId = String(body?.runId || "").trim();
    let payload;
    if (runId) {
      const stored = await getRunPayload(db, runId);
      if (!stored?.payload) throw new HttpError(404, "Ronda não encontrada para a leitura inteligente.");
      payload = withEditorias({ ...stored.payload, runId: stored.id, triggerType: stored.triggerType, storedAt: stored.completedAt });
    } else {
      payload = withEditorias(await getLatestRound(db));
      runId = payload?.runId || "latest";
    }
    if (!payload?.ok || !Array.isArray(payload.topics)) throw new HttpError(409, "Não há uma ronda válida disponível para análise.");
    const topicId = intelligentCarouselRoute[1];
    const topic = payload.topics.find((item) => item?.id === topicId);
    if (!topic) throw new HttpError(404, "Assunto não encontrado nesta ronda.");
    const cacheKey = intelligentCarouselCacheKey(runId, topic);
    if (!body?.force) {
      const cached = await getIntelligentCarousel(db, cacheKey);
      if (cached) return json({ ok: true, cached: true, data: cached });
    }
    try {
      const data = await buildIntelligentCarousel(topic, {
        ai: articleAnalysisAi(env),
        model: env.ARTICLE_ANALYSIS_MODEL || ARTICLE_ANALYSIS_MODEL,
      });
      const storedData = { ...data, cacheKey, runId, topicId, topicTitle: topic.title };
      await saveIntelligentCarousel(db, { cacheKey, runId, topicId, payload: storedData, ttlHours: 48 });
      return json({ ok: true, cached: false, data: storedData });
    } catch (error) {
      throw new HttpError(422, "Não foi possível gerar o roteiro com o conteúdo armazenado na ronda.", error instanceof Error ? error.message : String(error));
    }
  }

  if (url.pathname === "/api/round" && request.method === "POST") {
    if (env.MANUAL_ROUND_TOKEN && !secureEqual(request.headers.get("X-Round-Token"), env.MANUAL_ROUND_TOKEN)) {
      throw new HttpError(401, "Chave de operação inválida.");
    }
    const db = requireDatabase(env);
    const throttle = await acquireLock(db, "manual-throttle", 60 * 1000);
    if (!throttle) throw new HttpError(429, "Aguarde um minuto antes de executar outra ronda manual.");
    const lock = await acquireLock(db, "editorial-round", 3 * 60 * 1000);
    if (!lock) throw new HttpError(409, "Já existe uma ronda em andamento.");
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    try {
      await startRun(db, { id: runId, triggerType: "manual", startedAt });
    } catch (error) {
      await releaseLock(db, lock);
      throw error;
    }
    const latestForOlderPanels = withEditorias(await getLatestRound(db).catch(() => null));
    const compatibilityData = latestForOlderPanels?.ok && Array.isArray(latestForOlderPanels.topics)
      ? latestForOlderPanels
      : {
          ok: true,
          collectedAt: startedAt,
          windowHours: 24,
          sources: [],
          totals: { items: 0, topics: 0, sources: 0, socialItems: 0 },
          items: [],
          topics: [],
        };
    const task = performRound(env, "manual", { lock, runId, startedAt, runStarted: true }).catch((error) => {
      console.error("Ronda manual falhou", error);
    });
    if (ctx?.waitUntil) ctx.waitUntil(task);
    else await task;
    return json({ ok: true, queued: true, runId, status: "running", data: compatibilityData }, 202);
  }

  throw new HttpError(404, "Rota não encontrada.");
}

async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: SECURITY_HEADERS });
  if (url.pathname.startsWith("/api/")) return handleApi(request, env, url, ctx);
  if (request.method !== "GET" && request.method !== "HEAD") throw new HttpError(405, "Método não permitido.");
  if (url.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /api/\n", { headers: { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
  const asset = UI_ASSETS[url.pathname];
  if (asset) return request.method === "HEAD" ? new Response(null, { headers: { ...SECURITY_HEADERS, "Content-Type": asset.contentType } }) : assetResponse(asset);
  return json({ ok: false, error: "Página não encontrada." }, 404);
}



const __default__ = {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : "Erro interno do serviço.";
      const detail = error instanceof HttpError ? error.detail : error instanceof Error ? error.message.slice(0, 300) : null;
      return json({ ok: false, error: message, ...(detail ? { detail } : {}) }, status);
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      performRound(env, "scheduled").catch((error) => {
        console.error("Ronda agendada falhou", error);
      }),
    );
  },
};

return { "handleRequest": handleRequest, "performRound": performRound, "selfTest": selfTest, default: __default__ };
})();

export const handleRequest = __module_src_index_js["handleRequest"];
export const performRound = __module_src_index_js["performRound"];
export const selfTest = __module_src_index_js["selfTest"];
export default __module_src_index_js.default;
