import { plainText, stableHash } from "./parser.js";

const STOPWORDS = new Set([
  "a", "ao", "aos", "as", "com", "como", "da", "das", "de", "do", "dos", "e", "em", "entre", "foi", "ha",
  "mais", "na", "nas", "no", "nos", "o", "os", "ou", "para", "por", "que", "se", "sem", "ser", "sob", "sobre",
  "um", "uma", "vai", "apos", "ante", "ate", "contra", "durante", "noticia", "noticias", "hoje", "veja", "diz",
  "afirma", "novo", "nova", "brasil", "brasileiro", "brasileira",
]);

// Free stability mode: topic detection is intentionally bounded. The payload can
// still carry more items; only the CPU-heavy clustering stage is capped.
const MAX_CLUSTER_INPUT_ITEMS = 160;
const TITLE_TOKEN_CACHE_LIMIT = 1200;
const TOPIC_CACHE_LIMIT = 4;
const titleTokenCache = new Map();
const keywordRegexCache = new Map();
const topicBuildCache = new Map();

function boundedRecentItems(items = [], limit = MAX_CLUSTER_INPUT_ITEMS) {
  const list = Array.isArray(items) ? items : [];
  if (list.length <= limit) return [...list].sort((a,b)=>Date.parse(b?.publishedAt||0)-Date.parse(a?.publishedAt||0));
  const ordered = [...list].sort((a,b)=>Date.parse(b?.publishedAt||0)-Date.parse(a?.publishedAt||0));
  const bySource = new Map();
  for (const item of ordered) {
    const source = String(item?.sourceName || item?.collectorName || "Fonte");
    if (!bySource.has(source)) bySource.set(source, []);
    bySource.get(source).push(item);
  }
  const selected = [];
  const selectedSet = new Set();
  // Three items per source first: broad coverage across the newsroom catalogue.
  for (let depth = 0; depth < 3 && selected.length < limit; depth += 1) {
    for (const bucket of bySource.values()) {
      const item = bucket[depth];
      if (!item) continue;
      selected.push(item);
      selectedSet.add(item);
      if (selected.length >= limit) break;
    }
  }
  // Fill the remaining capacity with the newest items globally.
  for (const item of ordered) {
    if (selected.length >= limit) break;
    if (selectedSet.has(item)) continue;
    selected.push(item);
    selectedSet.add(item);
  }
  return selected.sort((a,b)=>Date.parse(b?.publishedAt||0)-Date.parse(a?.publishedAt||0));
}

export function normalizeText(value = "") {
  return plainText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function canonicalEventText(value = "") {
  return normalizeText(value)
    .replace(/\bsupremo tribunal federal\b/g, "stf")
    .replace(/\bsupremo\b/g, "stf")
    .replace(/\bministerio publico federal\b/g, "mpf")
    .replace(/\bministerio publico\b/g, "mp")
    .replace(/\b(julgamento|julga|julgar|julgou|analise|analisa|analisar)\b/g, "julga")
    .replace(/\b(comeca|inicia|retoma|recomeca)\b/g, "inicia")
    .replace(/\b(registro|registros)\b/g, "registro")
    .replace(/\b(conexao|conexoes)\b/g, "conexao");
}

export function titleTokens(title) {
  const key = String(title || "");
  const cached = titleTokenCache.get(key);
  if (cached) return cached;
  const output = [];
  const seen = new Set();
  for (const token of canonicalEventText(title).split(/\s+/)) {
    if (token.length < 3 || STOPWORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    output.push(token);
    if (output.length >= 14) break;
  }
  if (titleTokenCache.size >= TITLE_TOKEN_CACHE_LIMIT) titleTokenCache.delete(titleTokenCache.keys().next().value);
  titleTokenCache.set(key, output);
  return output;
}

function properNounTokens(value = "") {
  const raw = plainText(value);
  const matches = raw.match(/\b[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç0-9.-]{2,}\b/g) || [];
  const output = [];
  for (const match of matches) {
    const token = canonicalEventText(match);
    if (!token || STOPWORDS.has(token) || output.includes(token)) continue;
    output.push(token);
    if (output.length >= 8) break;
  }
  return output;
}

function contextTokens(item = {}) {
  const description = plainText(item?.description || item?.summary || "");
  if (!description) return [];
  return titleTokens(description).slice(0, 10);
}

function setOverlapScore(left = [], rightSet = new Set()) {
  if (!left.length || !rightSet.size) return 0;
  let overlap = 0;
  for (const token of left) if (rightSet.has(token)) overlap += 1;
  return overlap / Math.max(1, Math.min(left.length, rightSet.size));
}

function clusterSemanticScore(signals, cluster) {
  const titleScore = tokenSimilarityToCluster(signals.tokens, cluster);
  const contextScore = tokenSimilarity(signals.context, cluster.contextTokens || []);
  const entityScore = setOverlapScore(signals.entities, cluster.entitySet || new Set());
  const latest = Number(cluster.latestPublishedAt) || 0;
  const current = Date.parse(signals.item?.publishedAt || 0);
  const gapHours = latest && Number.isFinite(current) ? Math.abs(current - latest) / 3_600_000 : 24;
  const timeScore = Math.max(0, 1 - Math.min(1, gapHours / 24));
  if (titleScore < 0.14 && entityScore === 0 && contextScore < 0.22) return 0;
  return Math.min(1, titleScore * 0.68 + contextScore * 0.18 + entityScore * 0.09 + timeScore * 0.05);
}

export function tokenSimilarity(left, right) {
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

function tokenSimilarityToCluster(tokens, cluster) {
  if (!tokens.length || !cluster?.tokenSet?.size) return 0;
  let overlap = 0;
  for (const token of tokens) if (cluster.tokenSet.has(token)) overlap += 1;
  if (!overlap) return 0;
  const union = tokens.length + cluster.tokenSet.size - overlap;
  const minimum = Math.min(tokens.length, cluster.tokenSet.size);
  const jaccard = overlap / union;
  const containment = overlap / minimum;
  const bonus = overlap >= 3 ? 0.2 : overlap >= 2 ? 0.08 : 0;
  return Math.min(1, jaccard * 0.55 + containment * 0.45 + bonus);
}

const EDITORIA_RULES = Object.freeze([
  ["Reality Shows", ["reality", "bbb", "big brother", "a fazenda", "paredao", "eliminado", "eliminada", "eliminacao", "prova do lider", "prova do anjo", "confinamento", "casa mais vigiada", "participante", "brother", "sister"]],
  ["Fofoca e Celebridades", ["famoso", "famosa", "famosos", "celebridade", "influenciador", "influenciadora", "influencer", "namoro", "casamento", "separacao", "termino", "affair", "traicao", "romance", "polêmica", "polemica", "bastidores", "vida pessoal", "ex marido", "ex mulher", "ex namorado", "ex namorada", "gravidez", "noivado"]],
  ["Curiosidades e Ciência Pop", ["curiosidade", "curioso", "curiosa", "descoberta", "cientista", "cientistas", "estudo", "pesquisa", "arqueologia", "arqueologico", "espaco", "universo", "planeta", "animal", "animais", "natureza", "fenomeno", "misterio", "historia", "prehistoria", "fossil", "dinossauro", "ciencia", "cientifico"]],
  ["Conteúdo Viral e Redes Sociais", ["viral", "redes sociais", "rede social", "tiktok", "instagram", "twitter", "x antigo twitter", "meme", "video", "internautas", "repercute", "repercutiu", "bombou", "trend", "desafio", "postagem", "publicacao", "compartilhado", "milhoes de visualizacoes"]],
  ["Segurança e Justiça", ["crime", "policia", "delegacia", "investigacao", "prisao", "preso", "presa", "assassinato", "assassinado", "assassinada", "homicidio", "feminicidio", "tiroteio", "baleado", "baleada", "sequestro", "violencia", "justica", "tribunal", "ministerio publico", "acidente fatal", "corpo encontrado"]],
  ["Esportes", ["futebol", "jogo", "partida", "campeonato", "brasileirao", "copa", "clube", "time", "jogador", "jogadora", "gol", "tecnico", "selecao", "formula 1", "f1", "basquete", "volei", "tenis", "olimpiada", "esporte"]],
  ["Política", ["presidente", "congresso", "senado", "camara", "deputado", "senador", "ministro", "governo", "eleicao", "eleitoral", "stf", "supremo", "partido", "prefeito", "governador", "planalto", "projeto de lei", "votacao", "politica"]],
  ["Economia", ["economia", "inflacao", "dolar", "bolsa", "juros", "banco", "mercado", "empresa", "emprego", "desemprego", "pib", "imposto", "investimento", "financeiro", "combustivel", "petroleo"]],
  ["Mundo", ["estados unidos", "eua", "trump", "guerra", "ucrania", "russia", "israel", "gaza", "china", "europa", "onu", "internacional", "exterior"]],
  ["Tecnologia", ["tecnologia", "inteligencia artificial", "ia", "internet", "aplicativo", "software", "celular", "smartphone", "google", "microsoft", "apple", "meta", "digital"]],
  ["Saúde", ["saude", "doenca", "vacina", "hospital", "medico", "medicina", "virus", "covid", "medicamento", "tratamento", "epidemia", "paciente"]],
  ["Entretenimento", ["filme", "serie", "novela", "musica", "cantor", "cantora", "atriz", "ator", "show", "festival", "televisao", "cinema", "streaming", "oscar", "programa de tv", "entretenimento"]],
]);

const DEATH_TERMS = Object.freeze([
  "morreu", "morre", "morto", "morta", "morte", "faleceu", "falecimento", "obito", "luto", "velorio", "funeral",
]);

const VIOLENT_DEATH_TERMS = Object.freeze([
  "assassinado", "assassinada", "assassinato", "homicidio", "feminicidio", "morto a tiros", "morta a tiros", "baleado", "baleada", "corpo encontrado", "encontrado morto", "encontrada morta", "acidente fatal",
]);

const FIGURATIVE_DEATH_PHRASES = Object.freeze([
  "morre de rir", "morreu de rir", "morre de amores", "morreu de amores", "morre de ciumes", "morreu de ciumes",
]);

const FICTION_CONTEXT_TERMS = Object.freeze([
  "personagem", "capitulo", "episodio", "novela", "serie", "filme", "ficcao", "trama", "roteiro",
]);

const REAL_PERSON_TERMS = Object.freeze([
  "ator", "atriz", "cantor", "cantora", "apresentador", "apresentadora", "jornalista", "influenciador", "influenciadora", "empresario", "empresaria", "jogador", "jogadora",
]);

function keywordMatch(text, keyword) {
  if (keyword.includes(" ")) return text.includes(keyword);
  let pattern = keywordRegexCache.get(keyword);
  if (!pattern) {
    pattern = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    keywordRegexCache.set(keyword, pattern);
  }
  return pattern.test(text);
}

function countKeywordMatches(text, keywords = []) {
  return keywords.reduce((total, keyword) => total + (keywordMatch(text, keyword) ? 1 : 0), 0);
}

function hasKeyword(text, keywords = []) {
  return keywords.some((keyword) => keywordMatch(text, keyword));
}

function editorialHintScore(items, editoria) {
  return items.reduce((score, item) => {
    const hints = Array.isArray(item?.editorialHints) ? item.editorialHints : [];
    const index = hints.indexOf(editoria);
    if (index < 0) return score;
    return score + (index === 0 ? 3 : 1);
  }, 0);
}

function isRealDeathStory(text) {
  if (!hasKeyword(text, DEATH_TERMS)) return false;
  if (FIGURATIVE_DEATH_PHRASES.some((phrase) => text.includes(phrase))) return false;
  const fictional = hasKeyword(text, FICTION_CONTEXT_TERMS);
  const realPerson = hasKeyword(text, REAL_PERSON_TERMS);
  return !fictional || realPerson;
}

export function classifyEditoria(items = []) {
  const safeItems = Array.isArray(items) ? items : [];
  const text = normalizeText(safeItems.map((item) => `${item?.title || ""} ${item?.description || ""}`).join(" "));

  if (hasKeyword(text, VIOLENT_DEATH_TERMS)) return "Segurança e Justiça";
  if (isRealDeathStory(text)) return "Luto e Obituário";

  let selected = "Notícias";
  let selectedScore = 0;
  for (const [editoria, keywords] of EDITORIA_RULES) {
    const score = countKeywordMatches(text, keywords) + editorialHintScore(safeItems, editoria);
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
  if (["Saúde", "Tecnologia", "Curiosidades e Ciência Pop"].includes(editoria)) return "Explicativo e cauteloso";
  if (["Luto e Obituário", "Segurança e Justiça"].includes(editoria)) return "Sóbrio, factual e respeitoso";
  if (["Esportes", "Entretenimento", "Fofoca e Celebridades", "Reality Shows", "Conteúdo Viral e Redes Sociais"].includes(editoria)) return "Dinâmico e acessível";
  return "Informativo e objetivo";
}

function carouselModel(topic, normalizedText) {
  if (topic.priority === "Pautar agora") return "Instagram · Plantão editorial";
  if (/\b(alerta|prazo|calendario|inscricao|como|servico|transito|previsao)\b/.test(normalizedText)) return "Instagram · Serviço editorial";
  if ((topic.sourceNames?.length || topic.sourceCount || 0) >= 3 || (topic.items?.length || topic.itemCount || 0) >= 3) return "Instagram · Explicativo";
  if (["Luto e Obituário", "Segurança e Justiça"].includes(topic.editoria)) return "Instagram · Contexto factual";
  if (["Esportes", "Entretenimento", "Fofoca e Celebridades", "Reality Shows", "Conteúdo Viral e Redes Sociais"].includes(topic.editoria)) return "Instagram · Destaques";
  if (topic.editoria === "Curiosidades e Ciência Pop") return "Instagram · Curiosidade explicada";
  return "Instagram · Carrossel editorial";
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

export function buildCarouselBrief(topic = {}) {
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
      { number: 4, role: "Detalhamento", title: "O que precisa ser confirmado", body: `${sourceLine}\nAbra os links originais para conferir nomes, números, datas e declarações.` },
      { number: 5, role: "Consequência", title: "Por que isso importa", body: significance },
      { number: 6, role: "Conclusão", title: "O que acompanhar agora", body: topic.priority === "Pautar agora" ? "O assunto exige atualização rápida e confirmação contínua nas fontes originais." : "Acompanhe novos fatos e procure uma segunda fonte independente antes de fechar a pauta." },
      { number: 7, role: "CTA", title: "Continue acompanhando", body: `${verificationLinks.length} ${verificationLinks.length === 1 ? "link de apuração disponível" : "links de apuração disponíveis"}.\n${callToAction}` },
    ],
  };
}

export function clusterItems(items, threshold = 0.31) {
  const clusters = [];
  const tokenIndex = new Map();
  const ordered = boundedRecentItems(items, MAX_CLUSTER_INPUT_ITEMS);

  const addToIndex = (clusterIndex, tokens) => {
    for (const token of tokens) {
      let indexes = tokenIndex.get(token);
      if (!indexes) {
        indexes = new Set();
        tokenIndex.set(token, indexes);
      }
      indexes.add(clusterIndex);
    }
  };

  for (const item of ordered) {
    const tokens = titleTokens(item.title);
    if (!tokens.length) continue;
    const context = contextTokens(item);
    const entities = properNounTokens(item.title);
    const indexTokens = [...new Set([...tokens, ...entities, ...context.slice(0, 4)])];
    const signals = { item, tokens, context, entities };

    const candidateIndexes = new Set();
    for (const token of indexTokens) {
      const indexes = tokenIndex.get(token);
      if (!indexes) continue;
      for (const index of indexes) candidateIndexes.add(index);
    }

    let bestIndex = -1;
    let bestScore = 0;
    for (const index of [...candidateIndexes].sort((a, b) => a - b)) {
      const score = clusterSemanticScore(signals, clusters[index]);
      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }

    if (bestIndex >= 0 && bestScore >= threshold) {
      const best = clusters[bestIndex];
      best.items.push(item);
      const previousTokens = new Set(best.tokens);
      best.tokens = [...new Set([...best.tokens, ...tokens])].slice(0, 20);
      best.tokenSet = new Set(best.tokens);
      best.contextTokens = [...new Set([...(best.contextTokens || []), ...context])].slice(0, 18);
      best.contextSet = new Set(best.contextTokens);
      best.entities = [...new Set([...(best.entities || []), ...entities])].slice(0, 12);
      best.entitySet = new Set(best.entities);
      const time = Date.parse(item?.publishedAt || 0);
      if (Number.isFinite(time)) best.latestPublishedAt = Math.max(Number(best.latestPublishedAt) || 0, time);
      addToIndex(bestIndex, [...best.tokens.filter((token) => !previousTokens.has(token)), ...entities, ...context.slice(0, 4)]);
    } else {
      const clusterIndex = clusters.length;
      const time = Date.parse(item?.publishedAt || 0);
      const cluster = {
        tokens,
        tokenSet: new Set(tokens),
        contextTokens: context,
        contextSet: new Set(context),
        entities,
        entitySet: new Set(entities),
        latestPublishedAt: Number.isFinite(time) ? time : 0,
        items: [item],
      };
      clusters.push(cluster);
      addToIndex(clusterIndex, indexTokens);
    }
  }
  return clusters.map(({ tokenSet: _tokenSet, contextSet: _contextSet, entitySet: _entitySet, latestPublishedAt: _latestPublishedAt, ...cluster }) => cluster);
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function clusterToTopic(cluster, now = new Date()) {
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

function topicCacheKey(items, now, limit) {
  const bounded = boundedRecentItems(items, MAX_CLUSTER_INPUT_ITEMS);
  const fingerprint = bounded.map((item) => `${item?.id || item?.url || ""}\u001f${item?.title || ""}\u001f${item?.description || ""}`).join("\u001e");
  return `${new Date(now).toISOString()}|${limit}|${stableHash(fingerprint)}`;
}

export function buildTopics(items, now = new Date(), limit = 40) {
  const key = topicCacheKey(items, now, limit);
  const cached = topicBuildCache.get(key);
  if (cached) return cached;
  const topics = clusterItems(items)
    .map((cluster) => clusterToTopic(cluster, now))
    .sort((left, right) => right.score - left.score || Date.parse(right.lastPublishedAt) - Date.parse(left.lastPublishedAt))
    .slice(0, limit);
  if (topicBuildCache.size >= TOPIC_CACHE_LIMIT) topicBuildCache.delete(topicBuildCache.keys().next().value);
  topicBuildCache.set(key, topics);
  return topics;
}
