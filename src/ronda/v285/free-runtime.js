import { FEEDS, collectRound as collectCoreRound, summarizePortalStatuses, uniqueItems } from './collector.js';
import { buildTopics } from './clustering.js';
import { plainText } from './parser.js';
import { isLikelyPortuguese, sourceLanguage, translationKey, translateWorldItems } from './translation.js';
import {
  acquireLock,
  ensureSchema,
  getCachedTranslations,
  getLatestRound,
  getRunPayload,
  getSourceStates,
  listMonitoringTerms,
  markRunStarted,
  releaseLock,
  saveCachedTranslations,
  saveRun,
  saveSourceStates,
  syncNewsroomStories,
} from './database.js';

// RONDA ONE HF3.1 — scheduler de baixo CPU para Workers Free.
// A coleta continua cobrindo todo o catálogo, mas apenas um pequeno lote de
// fontes vencidas é processado por invocação. O restante vem do último estado
// persistente/última ronda válida.
const FREE_SOURCE_BATCH_SIZE = 3;
const FREE_PAYLOAD_ITEM_LIMIT = 240;
const FREE_TRANSLATIONS_PER_JOB = 4;
const FREE_NEWSROOM_TOPICS_PER_JOB = 6;
const ROUND_LOCK_TTL_MS = 4 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function log(event, data = {}) {
  console.log(JSON.stringify({ event, freeMode: 'hf3.1', ...data }));
}

function warn(event, data = {}) {
  console.warn(JSON.stringify({ event, freeMode: 'hf3.1', ...data }));
}

function requireDatabase(env) {
  if (!env?.DB) throw new Error("Binding D1 'DB' não configurado.");
  return env.DB;
}

function sourceStateFor(sourceStates, sourceId) {
  if (sourceStates instanceof Map) return sourceStates.get(sourceId) || null;
  return sourceStates?.[sourceId] || null;
}

function sourceDue(state, nowMs) {
  if (!state?.nextCheckAt) return true;
  const next = Date.parse(state.nextCheckAt);
  return !Number.isFinite(next) || next <= nowMs;
}

function sourceRank(feed, index, state) {
  const next = Date.parse(state?.nextCheckAt || '');
  const last = Date.parse(state?.lastAttemptAt || '');
  return {
    feed,
    index,
    state,
    next: Number.isFinite(next) ? next : 0,
    last: Number.isFinite(last) ? last : 0,
  };
}

export function selectFreeSourceBatch(feeds, sourceStates, now = new Date(), limit = FREE_SOURCE_BATCH_SIZE) {
  const nowMs = new Date(now).getTime();
  const due = (Array.isArray(feeds) ? feeds : [])
    .map((feed, index) => sourceRank(feed, index, sourceStateFor(sourceStates, feed.id)))
    .filter((entry) => sourceDue(entry.state, nowMs))
    .sort((a, b) => a.next - b.next || a.last - b.last || a.index - b.index);
  return due.slice(0, Math.max(1, Number(limit) || FREE_SOURCE_BATCH_SIZE));
}


function freeFeedVariant(feed) {
  const urls = Array.isArray(feed?.urls) ? [...feed.urls] : [];
  const directOnly = feed?.directUrl ? [feed.directUrl] : urls.slice(0, 1);
  return {
    ...feed,
    // No modo gratuito, se o feed oficial falhar usamos o cache persistente na
    // mesma ronda em vez de parsear também um fallback agregado gigante.
    urls: directOnly,
    limit: Math.min(Number(feed?.limit) || 15, 10),
    scanLimit: Math.min(Number(feed?.scanLimit) || 240, 160),
  };
}

function monitoringTermForCycle(terms, now = new Date()) {
  const list = Array.isArray(terms) ? terms.filter((item) => item?.id && plainText(item?.term)) : [];
  if (!list.length) return [];
  const slot = Math.floor(new Date(now).getTime() / (5 * 60 * 1000));
  return [list[slot % list.length]];
}

function withinWindow(item, nowMs = Date.now()) {
  const timestamp = Date.parse(item?.publishedAt || '');
  return Number.isFinite(timestamp) && timestamp >= nowMs - DAY_MS && timestamp <= nowMs + 5 * 60 * 1000;
}

function boundedDiverseItems(items, limit = FREE_PAYLOAD_ITEM_LIMIT) {
  const ordered = uniqueItems((Array.isArray(items) ? items : []).filter((item) => withinWindow(item)), Number.POSITIVE_INFINITY)
    .sort((a, b) => Date.parse(b?.publishedAt || 0) - Date.parse(a?.publishedAt || 0));
  if (ordered.length <= limit) return ordered;
  const bySource = new Map();
  for (const item of ordered) {
    const source = String(item?.sourceName || item?.collectorName || 'Fonte');
    if (!bySource.has(source)) bySource.set(source, []);
    bySource.get(source).push(item);
  }
  const selected = [];
  const used = new Set();
  for (let depth = 0; depth < 4 && selected.length < limit; depth += 1) {
    for (const bucket of bySource.values()) {
      const item = bucket[depth];
      if (!item) continue;
      selected.push(item);
      used.add(item);
      if (selected.length >= limit) break;
    }
  }
  for (const item of ordered) {
    if (selected.length >= limit) break;
    if (used.has(item)) continue;
    selected.push(item);
  }
  return selected.sort((a, b) => Date.parse(b?.publishedAt || 0) - Date.parse(a?.publishedAt || 0));
}

async function translateWorldFromCache(db, items = []) {
  const world = (Array.isArray(items) ? items : []).filter((item) => item?.region === 'Mundo');
  const requests = [];
  for (const item of world) {
    const title = plainText(item?.title);
    if (!title || isLikelyPortuguese(title)) continue;
    requests.push({ key: translationKey(title, sourceLanguage(item)), item });
  }
  const cached = await getCachedTranslations(db, requests.map((entry) => entry.key));
  return world.map((item) => {
    const title = plainText(item?.title);
    if (!title) return null;
    if (isLikelyPortuguese(title)) return item;
    const translated = cached.get(translationKey(title, sourceLanguage(item)));
    if (!translated) return null;
    const description = plainText(item?.description);
    return {
      ...item,
      title: translated,
      description: isLikelyPortuguese(description) ? description : translated,
      content: isLikelyPortuguese(description) ? description : translated,
      sourceLanguage: sourceLanguage(item),
      targetLanguage: 'pt-BR',
      translationStatus: 'cached-title',
      contentSource: 'free-cache-progressive',
    };
  }).filter(Boolean);
}

function stateStatus(feed, state) {
  if (!state) {
    return {
      id: feed.id,
      name: feed.name,
      region: feed.region || 'Brasil',
      ok: true,
      count: 0,
      error: null,
      warning: null,
      cached: false,
      degraded: false,
      deferred: true,
      route: 'pending',
      nextCheckAt: null,
      lastAttemptAt: null,
      lastSuccessAt: null,
    };
  }
  const hasCache = Array.isArray(state.items) && state.items.some((item) => withinWindow(item));
  const hasKnownSuccess = Boolean(state.lastSuccessAt);
  return {
    id: feed.id,
    name: feed.name,
    region: feed.region || state.region || 'Brasil',
    ok: hasKnownSuccess || hasCache,
    count: hasCache ? Number(state.itemCount) || state.items.length : 0,
    error: !hasKnownSuccess && !hasCache ? state.errorDetail || null : null,
    warning: state.errorCode && (hasKnownSuccess || hasCache) ? state.errorDetail || null : null,
    fallback: state.route === 'fallback',
    cached: hasCache,
    degraded: Boolean(state.errorCode && (hasKnownSuccess || hasCache)),
    deferred: true,
    route: hasCache ? 'cache' : state.route || 'no-new',
    httpStatus: state.httpStatus ?? null,
    errorCode: !hasKnownSuccess && !hasCache ? state.errorCode || null : null,
    responseMs: state.responseMs ?? null,
    lastAttemptAt: state.lastAttemptAt || null,
    lastSuccessAt: state.lastSuccessAt || null,
    nextCheckAt: state.nextCheckAt || null,
    failureCount: Number(state.failureCount) || 0,
    refreshMinutes: Number(feed.refreshMinutes) || 15,
  };
}

function mergeSources(previousSources, currentSources, sourceStates) {
  const byId = new Map();
  for (const feed of FEEDS) byId.set(feed.id, stateStatus(feed, sourceStateFor(sourceStates, feed.id)));
  for (const source of Array.isArray(previousSources) ? previousSources : []) {
    const key = source?.id || source?.sourceId || (source?.name === 'Bluesky' ? 'bluesky' : '');
    if (key) byId.set(key, source);
  }
  for (const source of Array.isArray(currentSources) ? currentSources : []) {
    const key = source?.id || source?.sourceId || (source?.name === 'Bluesky' ? 'bluesky' : '');
    if (key) byId.set(key, source);
  }
  const ordered = FEEDS.map((feed) => byId.get(feed.id)).filter(Boolean);
  const social = byId.get('bluesky');
  if (social) ordered.push(social);
  return ordered;
}

function mergeDedicated(previous, current) {
  const before = previous && typeof previous === 'object' ? previous : {};
  const after = current && typeof current === 'object' ? current : {};
  if (!after.enabled) return before?.enabled ? before : after;
  const terms = new Map();
  for (const item of [...(before.terms || []), ...(after.terms || [])]) if (item?.id) terms.set(item.id, item);
  const statuses = new Map();
  for (const item of [...(before.statuses || []), ...(after.statuses || [])]) {
    const key = item?.termId || item?.id || item?.term;
    if (key) statuses.set(key, item);
  }
  const items = boundedDiverseItems([...(after.items || []), ...(before.items || [])], 72);
  return {
    enabled: true,
    terms: [...terms.values()],
    items,
    statuses: [...statuses.values()],
    totals: {
      terms: terms.size,
      items: items.length,
      sources: new Set(items.map((item) => item?.sourceName).filter(Boolean)).size,
    },
  };
}

function stripStoredRuntimeFields(payload) {
  const value = payload && typeof payload === 'object' ? { ...payload } : {};
  delete value.runId;
  delete value.triggerType;
  delete value.storedAt;
  delete value.sourceStateUpdates;
  return value;
}

async function buildFreeRoundPayload(db, core, previousRound, sourceStates, selected, startedAt) {
  const currentPortal = (core.items || []).filter((item) => item?.kind === 'portal');
  const currentBrazil = currentPortal.filter((item) => item?.region !== 'Mundo');
  const currentWorldCached = await translateWorldFromCache(db, currentPortal);
  const currentSocial = (core.items || []).filter((item) => item?.region === 'Rede');
  const previousItems = Array.isArray(previousRound?.items) ? previousRound.items : [];
  const items = boundedDiverseItems([
    ...currentBrazil,
    ...currentWorldCached,
    ...currentSocial,
    ...previousItems,
  ]);
  const collectedAt = core.collectedAt || new Date().toISOString();
  const topics = buildTopics(items, new Date(collectedAt), 40);
  const sources = mergeSources(previousRound?.sources, core.sources, sourceStates);
  const diagnostics = { portals: summarizePortalStatuses(sources) };
  const dedicatedMonitoring = mergeDedicated(previousRound?.dedicatedMonitoring, core.dedicatedMonitoring);
  const base = { ...stripStoredRuntimeFields(previousRound), ...stripStoredRuntimeFields(core) };
  const sourceCount = new Set(items.map((item) => item?.sourceName).filter(Boolean)).size;
  const socialItems = items.filter((item) => item?.region === 'Rede').length;
  const remainingDue = FEEDS.filter((feed) => sourceDue(sourceStateFor(sourceStates, feed.id), Date.parse(collectedAt))).length;
  return {
    ...base,
    ok: items.length > 0,
    collectionStatus: diagnostics.portals.failed > 0 ? 'partial' : 'complete',
    degraded: diagnostics.portals.failed > 0 || diagnostics.portals.degraded > 0,
    collectedAt,
    windowHours: 24,
    durationMs: Math.max(0, Date.now() - Date.parse(startedAt)),
    sources,
    diagnostics,
    totals: {
      items: items.length,
      topics: topics.length,
      sources: sourceCount,
      socialItems,
      dedicatedItems: Number(dedicatedMonitoring?.items?.length) || 0,
    },
    items,
    topics,
    dedicatedMonitoring,
    configuration: {
      ...(previousRound?.configuration || {}),
      browserRequired: false,
      execution: 'cloudflare-queue-free-rotation',
      catalogFixed: true,
      freeScheduler: {
        enabled: true,
        version: 'hf3.1',
        batchSize: FREE_SOURCE_BATCH_SIZE,
        selectedSourceIds: selected.map((entry) => entry.feed.id),
        remainingDue,
      },
    },
    translation: {
      ...(previousRound?.translation || {}),
      targetLanguage: 'pt-BR',
      strategy: 'cached-progressive-free',
      maxNewTitlesPerEnrichmentJob: FREE_TRANSLATIONS_PER_JOB,
      concurrency: 1,
    },
    operational: {
      ...(core.operational || {}),
      freeScheduler: true,
      freeSchedulerVersion: 'hf3.1',
      sourceBatchSize: FREE_SOURCE_BATCH_SIZE,
      selectedSourceIds: selected.map((entry) => entry.feed.id),
      sourcesDueBeforeBatch: selected.length + remainingDue,
      sourcesRemainingDue: remainingDue,
      payloadItemLimit: FREE_PAYLOAD_ITEM_LIMIT,
    },
  };
}

async function enqueueFollowUps(env, runId, selected, monitoringTerm) {
  if (!env?.ROUND_JOBS_QUEUE?.send) return;
  const worldFeedIds = selected.filter((entry) => entry.feed.region === 'Mundo').map((entry) => entry.feed.id);
  if (worldFeedIds.length) {
    await env.ROUND_JOBS_QUEUE.send({ type: 'round-enrich', runId, worldFeedIds }).catch(() => null);
  }
  await env.ROUND_JOBS_QUEUE.send({ type: 'round-newsroom', runId }).catch(() => null);
  log('free_round_followups_enqueued', {
    runId,
    worldFeeds: worldFeedIds.length,
    monitoringTerm: monitoringTerm?.term || null,
  });
}

async function processFreeRound(message, env, body) {
  const db = requireDatabase(env);
  await ensureSchema(db);
  const runId = String(body?.runId || '').trim();
  if (!runId) {
    message?.ack?.();
    return;
  }
  const triggerType = body?.triggerType === 'manual' ? 'manual' : 'scheduled';
  const queuedAt = String(body?.queuedAt || new Date().toISOString());
  const startedAt = new Date().toISOString();
  const lock = await acquireLock(db, 'editorial-round', ROUND_LOCK_TTL_MS);
  if (!lock) {
    if (Number(message?.attempts || 1) < 3 && message?.retry) message.retry({ delaySeconds: 20 });
    else message?.ack?.();
    return;
  }

  try {
    await markRunStarted(db, { id: runId, triggerType, queuedAt, startedAt });
    const [previousRound, sourceStates, monitoringTerms] = await Promise.all([
      getLatestRound(db).catch(() => null),
      getSourceStates(db, FEEDS.map((feed) => feed.id)).catch(() => new Map()),
      listMonitoringTerms(db, { activeOnly: true }).catch(() => []),
    ]);
    const selected = selectFreeSourceBatch(FEEDS, sourceStates, new Date(startedAt));
    if (!selected.length) {
      // Não deve ser comum com fontes de 5 min, mas uma ronda válida anterior não
      // precisa ser recalculada se nada venceu.
      if (previousRound?.ok) {
        const payload = {
          ...stripStoredRuntimeFields(previousRound),
          collectedAt: new Date().toISOString(),
          operational: {
            ...(previousRound.operational || {}),
            freeScheduler: true,
            freeSchedulerVersion: 'hf3.1',
            selectedSourceIds: [],
            sourcesRemainingDue: 0,
          },
        };
        await saveRun(db, { id: runId, triggerType, startedAt, payload });
        message?.ack?.();
        return;
      }
      throw new Error('Nenhuma fonte disponível para a primeira rotação gratuita.');
    }

    const monitoringSelection = monitoringTermForCycle(monitoringTerms, startedAt);
    const core = await collectCoreRound({
      feeds: selected.map((entry) => freeFeedVariant(entry.feed)),
      monitoringTerms: monitoringSelection,
      previousRound,
      sourceStates,
      now: new Date(startedAt),
    });

    // Persistir o avanço das fontes imediatamente é deliberado: mesmo que uma
    // etapa posterior seja interrompida por CPU, o retry não reprocessa o mesmo
    // grupo pesado indefinidamente.
    if (Array.isArray(core.sourceStateUpdates) && core.sourceStateUpdates.length) {
      await saveSourceStates(db, core.sourceStateUpdates);
      for (const update of core.sourceStateUpdates) sourceStates.set(update.sourceId, update);
    }

    const payload = await buildFreeRoundPayload(db, core, previousRound, sourceStates, selected, startedAt);
    if (!payload.ok) throw new Error(core?.error || 'A rotação gratuita não encontrou conteúdo utilizável.');
    await saveRun(db, { id: runId, triggerType, startedAt, payload });
    message?.ack?.();
    log('free_round_completed', {
      runId,
      triggerType,
      selected: selected.map((entry) => entry.feed.id),
      items: payload.totals.items,
      topics: payload.totals.topics,
      remainingDue: payload.operational.sourcesRemainingDue,
    });
    await enqueueFollowUps(env, runId, selected, monitoringSelection[0] || null);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    warn('free_round_error', { runId, triggerType, detail, attempts: Number(message?.attempts || 1) });
    const attempts = Number(message?.attempts || 1);
    if (attempts < 3 && message?.retry) {
      message.retry({ delaySeconds: 15 * attempts });
      return;
    }
    await saveRun(db, {
      id: runId,
      triggerType,
      startedAt,
      payload: {
        ok: false,
        collectionStatus: 'failed',
        degraded: true,
        collectedAt: new Date().toISOString(),
        error: 'A rotação gratuita não foi concluída.',
        detail,
        sources: [],
        diagnostics: { portals: { total: 0, failed: 0, degraded: 0, cached: 0, withContent: 0, issues: [] } },
        totals: { items: 0, topics: 0, sources: 0, socialItems: 0, dedicatedItems: 0 },
        items: [],
        topics: [],
        operational: { freeScheduler: true, freeSchedulerVersion: 'hf3.1' },
      },
    }).catch(() => null);
    message?.ack?.();
  } finally {
    await releaseLock(db, lock).catch(() => null);
  }
}

async function processFreeEnrichment(message, env, body) {
  try {
    const db = requireDatabase(env);
    const ids = [...new Set((Array.isArray(body?.worldFeedIds) ? body.worldFeedIds : []).map(String).filter(Boolean))];
    if (!ids.length || !env?.AI?.run) {
      message?.ack?.();
      return;
    }
    const states = await getSourceStates(db, ids);
    const items = boundedDiverseItems(ids.flatMap((id) => sourceStateFor(states, id)?.items || []), 32)
      .filter((item) => item?.region === 'Mundo');
    const keys = items
      .map((item) => {
        const title = plainText(item?.title);
        return title && !isLikelyPortuguese(title) ? translationKey(title, sourceLanguage(item)) : null;
      })
      .filter(Boolean);
    const cached = await getCachedTranslations(db, keys);
    const translated = await translateWorldItems(items, {
      ai: env.AI,
      cached,
      concurrency: 1,
      maximumNewTitles: FREE_TRANSLATIONS_PER_JOB,
    });
    if (translated.generatedEntries.length) await saveCachedTranslations(db, translated.generatedEntries);
    log('free_round_translation_cache_updated', {
      runId: body?.runId || null,
      feeds: ids,
      generated: translated.generatedEntries.length,
      cached: translated.cachedFieldCount,
    });
  } catch (error) {
    // Enriquecimento é best-effort. A próxima rotação tenta novamente e a ronda
    // principal já ficou salva como válida.
    warn('free_round_translation_deferred', { detail: error instanceof Error ? error.message : String(error) });
  } finally {
    message?.ack?.();
  }
}

async function processFreeNewsroom(message, env, body) {
  try {
    const db = requireDatabase(env);
    const runId = String(body?.runId || '').trim();
    if (!runId) return;
    const stored = await getRunPayload(db, runId);
    const topics = Array.isArray(stored?.payload?.topics) ? stored.payload.topics.slice(0, FREE_NEWSROOM_TOPICS_PER_JOB) : [];
    if (topics.length) {
      await syncNewsroomStories(db, topics, { runId, at: stored?.payload?.collectedAt || new Date().toISOString() });
      log('free_round_newsroom_synced', { runId, topics: topics.length });
    }
  } catch (error) {
    // Mesa não pode derrubar a ronda principal.
    warn('free_round_newsroom_deferred', { detail: error instanceof Error ? error.message : String(error) });
  } finally {
    message?.ack?.();
  }
}

async function processFreeMessage(message, env) {
  const body = message?.body && typeof message.body === 'object' ? message.body : {};
  if (body.type === 'round-enrich') return processFreeEnrichment(message, env, body);
  if (body.type === 'round-newsroom') return processFreeNewsroom(message, env, body);
  return processFreeRound(message, env, body);
}

export async function runFreeRoundQueue(batch, env) {
  for (const message of batch?.messages || []) await processFreeMessage(message, env);
}
