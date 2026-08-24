import { buildTopics } from "./clustering.js";
import { getCachedTranslations, saveCachedTranslations } from "./database.js";
import { plainText, stableHash } from "./parser.js";

export const TRANSLATION_MODEL = "@cf/meta/m2m100-1.2b";
export const MAX_NEW_TITLE_TRANSLATIONS_PER_ROUND = 18;
export const TRANSLATION_CONCURRENCY = 3;
const SPANISH_SOURCES = new Set(["El País", "Infobae"]);
const PORTUGUESE_WORDS = /\b(que|para|com|uma|das|dos|não|mais|sobre|após|entre|governo|notícia|brasil|mundo|novo|nova|segundo|diz)\b/i;

function cleanTranslation(value, limit) {
  const text = plainText(value).replace(/^(["“”']+)|(["“”']+)$/g, "").trim();
  return text.slice(0, limit);
}

export function sourceLanguage(item) {
  return SPANISH_SOURCES.has(item?.collectorName || item?.sourceName) ? "es" : "en";
}

export function translationKey(text, language) {
  return `pt-v1-${stableHash(`${language}|${plainText(text)}`)}`;
}

export function isLikelyPortuguese(value) {
  const text = plainText(value);
  if (!text) return false;
  return /[ãõçáéíóúâêôà]/i.test(text) || PORTUGUESE_WORDS.test(text);
}

async function withTimeout(promise, milliseconds = 8_000) {
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

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function translateText(ai, text, language, { attempts = 2 } = {}) {
  const source = plainText(text);
  if (!source || !ai?.run) return null;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await withTimeout(ai.run(TRANSLATION_MODEL, {
        text: source,
        source_lang: language,
        target_lang: "pt",
      }));
      const translated = response?.translated_text || response?.result?.translated_text;
      const cleaned = cleanTranslation(translated, Math.max(240, source.length * 3));
      if (cleaned && cleaned.toLocaleLowerCase("pt-BR") !== source.toLocaleLowerCase("pt-BR")) return cleaned;
      if (cleaned && isLikelyPortuguese(source)) return cleaned;
      lastError = new Error(cleaned ? "A tradução repetiu o texto original" : "A tradução retornou texto vazio");
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await delay(220 * attempt);
  }
  if (lastError) throw lastError;
  return null;
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

function prioritizedTitleRequests(worldItems, cached, maximum) {
  const candidates = [];
  const seenKeys = new Set();
  const firstBySource = new Map();
  for (const item of worldItems) {
    const text = plainText(item.title);
    if (!text || isLikelyPortuguese(text)) continue;
    const language = sourceLanguage(item);
    const key = translationKey(text, language);
    if (cached.has(key) || seenKeys.has(key)) continue;
    const request = { key, text, language, source: item.collectorName || item.sourceName || "" };
    seenKeys.add(key);
    candidates.push(request);
    if (!firstBySource.has(request.source)) firstBySource.set(request.source, request);
  }
  const prioritized = [...firstBySource.values()];
  const prioritizedKeys = new Set(prioritized.map((entry) => entry.key));
  for (const request of candidates) {
    if (!prioritizedKeys.has(request.key)) prioritized.push(request);
  }
  return prioritized.slice(0, Math.max(1, Number(maximum) || MAX_NEW_TITLE_TRANSLATIONS_PER_ROUND));
}

export async function translateWorldItems(items, {
  ai,
  cached = new Map(),
  concurrency = TRANSLATION_CONCURRENCY,
  maximumNewTitles = MAX_NEW_TITLE_TRANSLATIONS_PER_ROUND,
} = {}) {
  const worldItems = items.filter((item) => item?.region === "Mundo");
  let cachedFieldCount = 0;
  for (const item of worldItems) {
    const text = plainText(item.title);
    if (!text || isLikelyPortuguese(text)) continue;
    if (cached.has(translationKey(text, sourceLanguage(item)))) cachedFieldCount += 1;
  }

  const requests = prioritizedTitleRequests(worldItems, cached, maximumNewTitles);
  const generatedEntries = (await runLimited(requests, concurrency, async (entry) => {
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
  let titleOnlyItems = 0;
  for (const item of worldItems) {
    const language = sourceLanguage(item);
    const originalTitle = plainText(item.title);
    const title = isLikelyPortuguese(originalTitle)
      ? originalTitle
      : cached.get(translationKey(originalTitle, language));
    if (!title) {
      omittedItems += 1;
      continue;
    }
    const translatedTitle = cleanTranslation(title, 240);
    const originalDescription = plainText(item.description);
    const translatedDescription = isLikelyPortuguese(originalDescription)
      ? cleanTranslation(originalDescription, 900)
      : translatedTitle;
    const titleOnly = Boolean(originalDescription) && !isLikelyPortuguese(originalDescription);
    if (titleOnly) titleOnlyItems += 1;
    translatedItems.push({
      ...item,
      title: translatedTitle,
      description: translatedDescription,
      content: translatedDescription || translatedTitle,
      contentSource: titleOnly ? "translated-title-safe-fallback" : "translated-feed-content",
      contentWordCount: plainText(translatedDescription || translatedTitle).split(/\s+/).filter(Boolean).length,
      sourceLanguage: language,
      targetLanguage: "pt-BR",
      translationStatus: titleOnly ? "title-only" : "translated",
    });
  }

  return {
    translatedItems,
    omittedItems,
    titleOnlyItems,
    generatedEntries,
    cachedFieldCount,
    requestedTitles: requests.length,
  };
}

function recalculateSources(sources, items) {
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
          ? omitted > 0 ? `${omitted} conteúdo(s) aguardando tradução em uma próxima ronda.` : null
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

export async function translateRoundPayload(payload, { ai, db } = {}) {
  if (!payload?.ok || !Array.isArray(payload.items)) return payload;
  const worldItems = payload.items.filter((item) => item?.region === "Mundo");
  const brazilItems = payload.items.filter((item) => item?.region !== "Mundo" && item?.region !== "Rede");
  const portugueseSocialItems = payload.items.filter((item) => item?.region === "Rede" && isLikelyPortuguese(item.title));
  const keys = [];
  for (const item of worldItems) {
    const title = plainText(item.title);
    if (title && !isLikelyPortuguese(title)) keys.push(translationKey(title, sourceLanguage(item)));
  }
  const cached = db ? await getCachedTranslations(db, keys) : new Map();
  const translated = await translateWorldItems(worldItems, { ai, cached });
  if (db && translated.generatedEntries.length) await saveCachedTranslations(db, translated.generatedEntries);

  const finalItems = [...brazilItems, ...translated.translatedItems, ...portugueseSocialItems];
  const collectedAt = new Date(payload.collectedAt || Date.now());
  const topics = buildTopics(finalItems, collectedAt, 40);
  const sourceCount = new Set(finalItems.map((item) => item.sourceName).filter(Boolean)).size;
  const socialItems = finalItems.filter((item) => item.kind === "social").length;
  const sources = recalculateSources(payload.sources, finalItems);

  return {
    ...payload,
    sources,
    totals: {
      items: finalItems.length,
      topics: topics.length,
      sources: sourceCount,
      socialItems,
      dedicatedItems: Number(payload.dedicatedMonitoring?.items?.length) || 0,
    },
    items: finalItems,
    topics,
    translation: {
      targetLanguage: "pt-BR",
      model: TRANSLATION_MODEL,
      portugueseOnly: true,
      strategy: "cached-title-first",
      concurrency: TRANSLATION_CONCURRENCY,
      maxNewTitlesPerRound: MAX_NEW_TITLE_TRANSLATIONS_PER_ROUND,
      translatedWorldItems: translated.translatedItems.length,
      omittedWorldItems: translated.omittedItems,
      titleOnlyItems: translated.titleOnlyItems,
      generatedFields: translated.generatedEntries.length,
      cachedFields: translated.cachedFieldCount,
      requestedTitles: translated.requestedTitles,
    },
  };
}

export function portugueseOnlyFallback(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.items)) return payload;
  const items = payload.items.filter((item) => item?.region !== "Mundo" && (item?.region !== "Rede" || isLikelyPortuguese(item.title)));
  const collectedAt = new Date(payload.collectedAt || Date.now());
  const topics = buildTopics(items, collectedAt, 40);
  const sourceCount = new Set(items.map((item) => item.sourceName).filter(Boolean)).size;
  const socialItems = items.filter((item) => item.kind === "social").length;
  const omittedWorldItems = payload.items.filter((item) => item?.region === "Mundo").length;
  return {
    ...payload,
    sources: recalculateSources(payload.sources, items),
    totals: {
      items: items.length,
      topics: topics.length,
      sources: sourceCount,
      socialItems,
      dedicatedItems: Number(payload.dedicatedMonitoring?.items?.length) || 0,
    },
    items,
    topics,
    translation: {
      targetLanguage: "pt-BR",
      model: TRANSLATION_MODEL,
      portugueseOnly: true,
      strategy: "cached-title-first",
      translatedWorldItems: 0,
      omittedWorldItems,
      generatedFields: 0,
      cachedFields: 0,
      error: "Tradução indisponível; conteúdos internacionais não traduzidos foram omitidos.",
    },
  };
}
