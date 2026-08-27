import {
  FEEDS,
  collectBluesky,
  collectDedicatedMonitoring,
  collectFeed,
  summarizePortalStatuses,
  uniqueItems,
} from './collector.js';
import { buildTopics, clusterItems } from './clustering.js';
import { plainText } from './parser.js';
import { isLikelyPortuguese, sourceLanguage, translationKey, translateWorldItems } from './translation.js';
import {
  acquireLock,
  ensureSchema,
  getCachedTranslations,
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

// RONDA ONE HF3.2 — pipeline ultraleve para Workers Free.
// A invocação original da Queue coleta apenas UMA fonte e persiste o estado.
// A montagem da ronda é feita em uma segunda mensagem, usando somente caches D1.
const FREE_SOURCE_BATCH_SIZE = 1;
const FREE_ITEMS_PER_SOURCE = 2;
const FREE_PAYLOAD_ITEM_LIMIT = 96;
const FREE_TOPIC_LIMIT = 24;
const FREE_TRANSLATIONS_PER_JOB = 2;
const FREE_NEWSROOM_TOPICS_PER_JOB = 3;
const ROUND_LOCK_TTL_MS = 90 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const THREE_DAYS_MS = 72 * 60 * 60 * 1000;
const MONITOR_CACHE_KEY = 'hf32_dedicated_monitoring';
const SOCIAL_CACHE_KEY = 'hf32_social_cache';

function log(event, data = {}) {
  console.log(JSON.stringify({ event, freeMode: 'hf3.2', ...data }));
}

function warn(event, data = {}) {
  console.warn(JSON.stringify({ event, freeMode: 'hf3.2', ...data }));
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
  return (Array.isArray(feeds) ? feeds : [])
    .map((feed, index) => sourceRank(feed, index, sourceStateFor(sourceStates, feed.id)))
    .filter((entry) => sourceDue(entry.state, nowMs))
    .sort((a, b) => a.next - b.next || a.last - b.last || a.index - b.index)
    .slice(0, Math.max(1, Number(limit) || FREE_SOURCE_BATCH_SIZE));
}

function freeFeedVariant(feed) {
  const urls = Array.isArray(feed?.urls) ? [...feed.urls] : [];
  const directOnly = feed?.directUrl ? [feed.directUrl] : urls.slice(0, 1);
  return {
    ...feed,
    urls: directOnly,
    limit: Math.min(Number(feed?.limit) || 15, 8),
    scanLimit: Math.min(Number(feed?.scanLimit) || 240, 100),
  };
}

function withinWindow(item, nowMs = Date.now(), windowMs = DAY_MS) {
  const timestamp = Date.parse(item?.publishedAt || '');
  return Number.isFinite(timestamp) && timestamp >= nowMs - windowMs && timestamp <= nowMs + 5 * 60 * 1000;
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
  for (let depth = 0; depth < FREE_ITEMS_PER_SOURCE && selected.length < limit; depth += 1) {
    for (const bucket of bySource.values()) {
      if (bucket[depth]) selected.push(bucket[depth]);
      if (selected.length >= limit) break;
    }
  }
  return selected.sort((a, b) => Date.parse(b?.publishedAt || 0) - Date.parse(a?.publishedAt || 0));
}


async function getSourceScheduleMetadata(db) {
  const result = await db.prepare(`
    SELECT source_id, next_check_at, last_attempt_at
    FROM source_state
  `).all();
  const map = new Map();
  for (const row of result?.results || []) {
    map.set(row.source_id, {
      sourceId: row.source_id,
      nextCheckAt: row.next_check_at || null,
      lastAttemptAt: row.last_attempt_at || null,
    });
  }
  return map;
}

function parseCompactItem(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function getCompactSourceStates(db) {
  const result = await db.prepare(`
    SELECT source_id, name, region, status, route, http_status, error_code, error_detail,
           item_count, last_url, last_attempt_at, last_success_at, next_check_at,
           failure_count, response_ms, updated_at,
           json_extract(items_json, '$[0]') AS item0,
           json_extract(items_json, '$[1]') AS item1
    FROM source_state
  `).all();
  const map = new Map();
  for (const row of result?.results || []) {
    const items = [parseCompactItem(row.item0), parseCompactItem(row.item1)].filter(Boolean);
    map.set(row.source_id, {
      sourceId: row.source_id,
      name: row.name,
      region: row.region,
      status: row.status,
      route: row.route,
      httpStatus: row.http_status == null ? null : Number(row.http_status),
      errorCode: row.error_code || null,
      errorDetail: row.error_detail || null,
      items,
      itemCount: items.length,
      lastUrl: row.last_url || null,
      validators: {},
      lastAttemptAt: row.last_attempt_at || null,
      lastSuccessAt: row.last_success_at || null,
      nextCheckAt: row.next_check_at || null,
      failureCount: Number(row.failure_count) || 0,
      responseMs: row.response_ms == null ? null : Number(row.response_ms),
      updatedAt: row.updated_at || null,
    });
  }
  return map;
}

function retryBackoffMinutes(errorCode, failureCount) {
  if (errorCode === 'not-found') return 360;
  if (errorCode === 'blocked') return 60;
  if (errorCode === 'rate-limited') return Math.max(30, [5, 15, 30, 60, 180][Math.min(4, Math.max(0, failureCount - 1))]);
  return [5, 15, 30, 60, 180][Math.min(4, Math.max(0, failureCount - 1))];
}

function snapshotSourceItems(feed, currentItems, previousState, collectedAt) {
  const oldest = collectedAt.getTime() - THREE_DAYS_MS;
  return uniqueItems([
    ...(Array.isArray(currentItems) ? currentItems : []),
    ...(Array.isArray(previousState?.items) ? previousState.items : []),
  ]
    .filter((item) => {
      const timestamp = Date.parse(item?.publishedAt || '');
      return Number.isFinite(timestamp) && timestamp >= oldest;
    })
    .sort((a, b) => Date.parse(b?.publishedAt || 0) - Date.parse(a?.publishedAt || 0)), Math.max(12, (Number(feed?.limit) || 8) * 2));
}

function buildSourceStateUpdate(feed, result, previousState, collectedAt) {
  const healthy = Boolean(result?.status?.ok);
  const failureCount = healthy ? 0 : (Number(previousState?.failureCount) || 0) + 1;
  const nextMinutes = healthy
    ? Math.max(5, Number(feed?.refreshMinutes) || 15)
    : retryBackoffMinutes(result?.status?.errorCode, failureCount);
  const attemptedAt = collectedAt.toISOString();
  const items = snapshotSourceItems(feed, result?.items, previousState, collectedAt);
  const hasCache = items.some((item) => withinWindow(item, collectedAt.getTime()));
  const route = healthy ? (result?.status?.route || 'direct') : hasCache ? 'cache' : (result?.status?.route || 'failed');
  return {
    sourceId: feed.id,
    name: feed.name,
    region: feed.region || 'Brasil',
    status: healthy ? route : hasCache ? 'degraded' : result?.status?.errorCode || 'failed',
    route,
    httpStatus: result?.status?.httpStatus ?? previousState?.httpStatus ?? null,
    errorCode: healthy ? null : result?.status?.errorCode || 'unknown',
    errorDetail: healthy ? null : result?.status?.error || 'Fonte indisponível',
    items,
    itemCount: items.length,
    lastUrl: result?.operational?.lastUrl || previousState?.lastUrl || null,
    validators: result?.operational?.validators || previousState?.validators || {},
    lastAttemptAt: attemptedAt,
    lastSuccessAt: healthy ? attemptedAt : previousState?.lastSuccessAt || null,
    nextCheckAt: new Date(collectedAt.getTime() + nextMinutes * 60 * 1000).toISOString(),
    failureCount,
    responseMs: result?.status?.responseMs ?? previousState?.responseMs ?? null,
    updatedAt: attemptedAt,
  };
}

function stateStatus(feed, state) {
  if (!state) {
    return {
      id: feed.id, name: feed.name, region: feed.region || 'Brasil', ok: true, count: 0,
      error: null, warning: null, cached: false, degraded: false, deferred: true,
      route: 'pending', lastAttemptAt: null, lastSuccessAt: null, nextCheckAt: null,
    };
  }
  const hasCache = Array.isArray(state.items) && state.items.some((item) => withinWindow(item));
  const known = Boolean(state.lastSuccessAt) || hasCache;
  return {
    id: feed.id,
    name: feed.name,
    region: feed.region || state.region || 'Brasil',
    ok: known,
    count: hasCache ? Math.min(Number(state.itemCount) || state.items.length, state.items.length) : 0,
    error: known ? null : state.errorDetail || null,
    warning: known && state.errorCode ? state.errorDetail || null : null,
    fallback: state.route === 'fallback',
    cached: hasCache,
    degraded: Boolean(known && state.errorCode),
    deferred: true,
    route: hasCache ? 'cache' : state.route || 'no-new',
    httpStatus: state.httpStatus ?? null,
    errorCode: known ? null : state.errorCode || null,
    responseMs: state.responseMs ?? null,
    lastAttemptAt: state.lastAttemptAt || null,
    lastSuccessAt: state.lastSuccessAt || null,
    nextCheckAt: state.nextCheckAt || null,
    failureCount: Number(state.failureCount) || 0,
    refreshMinutes: Number(feed.refreshMinutes) || 15,
  };
}

async function appStateJson(db, key, fallback = null) {
  const row = await db.prepare("SELECT value FROM app_state WHERE key = ? LIMIT 1").bind(key).first();
  if (!row?.value) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}

async function saveAppStateJson(db, key, value) {
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).bind(key, JSON.stringify(value), now).run();
}

function portalItemsFromStates(sourceStates, nowMs = Date.now()) {
  const items = [];
  for (const feed of FEEDS) {
    const state = sourceStateFor(sourceStates, feed.id);
    const recent = (Array.isArray(state?.items) ? state.items : [])
      .filter((item) => withinWindow(item, nowMs))
      .sort((a, b) => Date.parse(b?.publishedAt || 0) - Date.parse(a?.publishedAt || 0))
      .slice(0, FREE_ITEMS_PER_SOURCE)
      .map((item) => ({ ...item, kind: item?.kind || 'portal', sourceName: item?.sourceName || feed.name, collectorName: item?.collectorName || feed.name, region: item?.region || feed.region }));
    items.push(...recent);
  }
  return boundedDiverseItems(items, FREE_PAYLOAD_ITEM_LIMIT);
}

async function translateWorldFromCache(db, items = []) {
  const requests = [];
  for (const item of items) {
    if (item?.region !== 'Mundo') continue;
    const title = plainText(item?.title);
    if (!title || isLikelyPortuguese(title)) continue;
    requests.push({ key: translationKey(title, sourceLanguage(item)), item });
  }
  const cached = await getCachedTranslations(db, requests.map((entry) => entry.key));
  const output = [];
  for (const item of items) {
    if (item?.region !== 'Mundo') {
      output.push(item);
      continue;
    }
    const title = plainText(item?.title);
    if (!title) continue;
    if (isLikelyPortuguese(title)) {
      output.push(item);
      continue;
    }
    const translated = cached.get(translationKey(title, sourceLanguage(item)));
    if (!translated) continue;
    const description = plainText(item?.description);
    output.push({
      ...item,
      title: translated,
      description: isLikelyPortuguese(description) ? description : translated,
      content: isLikelyPortuguese(description) ? description : translated,
      sourceLanguage: sourceLanguage(item),
      targetLanguage: 'pt-BR',
      translationStatus: 'cached-title',
      contentSource: 'free-cache-progressive',
    });
  }
  return output;
}

async function enqueue(env, body) {
  if (!env?.ROUND_JOBS_QUEUE?.send) return false;
  await env.ROUND_JOBS_QUEUE.send(body);
  return true;
}

async function processFreeSource(message, env, body) {
  const db = requireDatabase(env);
  await ensureSchema(db);
  const runId = String(body?.runId || '').trim();
  if (!runId) { message?.ack?.(); return; }
  const triggerType = body?.triggerType === 'manual' ? 'manual' : 'scheduled';
  const queuedAt = String(body?.queuedAt || new Date().toISOString());
  const startedAt = new Date().toISOString();
  const lock = await acquireLock(db, 'editorial-round-source', ROUND_LOCK_TTL_MS);
  if (!lock) {
    if (Number(message?.attempts || 1) < 3 && message?.retry) message.retry({ delaySeconds: 15 });
    else message?.ack?.();
    return;
  }
  try {
    await markRunStarted(db, { id: runId, triggerType, queuedAt, startedAt });
    const scheduleStates = await getSourceScheduleMetadata(db);
    const selected = selectFreeSourceBatch(FEEDS, scheduleStates, new Date(startedAt));
    if (!selected.length) {
      await enqueue(env, { type: 'round-snapshot', runId, triggerType, startedAt, selectedSourceIds: [] });
      message?.ack?.();
      return;
    }
    const entry = selected[0];
    const selectedStates = await getSourceStates(db, [entry.feed.id]);
    const fullState = sourceStateFor(selectedStates, entry.feed.id);
    const feed = freeFeedVariant(entry.feed);
    const cutoff = new Date(Date.parse(startedAt) - DAY_MS);
    const requestBudget = { remaining: 4, used: 0, seenUrls: new Set() };
    const result = await collectFeed(feed, cutoff, fetch, requestBudget, fullState);
    const update = buildSourceStateUpdate(entry.feed, result, fullState, new Date(startedAt));
    await saveSourceStates(db, [update]);
    await enqueue(env, {
      type: 'round-snapshot',
      runId,
      triggerType,
      startedAt,
      selectedSourceIds: [entry.feed.id],
      selectedWorldIds: entry.feed.region === 'Mundo' ? [entry.feed.id] : [],
    });
    message?.ack?.();
    log('free_source_completed', { runId, sourceId: entry.feed.id, ok: result?.status?.ok, items: update.itemCount, route: update.route });
  } catch (error) {
    warn('free_source_error', { runId, detail: error instanceof Error ? error.message : String(error) });
    const attempts = Number(message?.attempts || 1);
    if (attempts < 3 && message?.retry) message.retry({ delaySeconds: 15 * attempts });
    else message?.ack?.();
  } finally {
    await releaseLock(db, lock).catch(() => null);
  }
}

async function processFreeSnapshot(message, env, body) {
  try {
    const db = requireDatabase(env);
    await ensureSchema(db);
    const runId = String(body?.runId || '').trim();
    if (!runId) return;
    const startedAt = String(body?.startedAt || new Date().toISOString());
    const triggerType = body?.triggerType === 'manual' ? 'manual' : 'scheduled';
    const sourceStates = await getCompactSourceStates(db);
    const rawPortalItems = portalItemsFromStates(sourceStates, Date.parse(startedAt));
    const portalItems = await translateWorldFromCache(db, rawPortalItems);
    const [socialCache, dedicatedMonitoring] = await Promise.all([
      appStateJson(db, SOCIAL_CACHE_KEY, null).catch(() => null),
      appStateJson(db, MONITOR_CACHE_KEY, null).catch(() => null),
    ]);
    const socialItems = Array.isArray(socialCache?.items) ? socialCache.items.filter((item) => withinWindow(item, Date.parse(startedAt))) : [];
    const items = boundedDiverseItems([...portalItems, ...socialItems], FREE_PAYLOAD_ITEM_LIMIT);
    if (!items.length) throw new Error('Ainda não há cache suficiente para montar a primeira ronda gratuita.');
    const topics = buildTopics(items, new Date(startedAt), FREE_TOPIC_LIMIT);
    const sources = FEEDS.map((feed) => stateStatus(feed, sourceStateFor(sourceStates, feed.id)));
    if (socialCache?.status) sources.push(socialCache.status);
    const diagnostics = { portals: summarizePortalStatuses(sources) };
    const sourceCount = new Set(items.map((item) => item?.sourceName).filter(Boolean)).size;
    const remainingDue = FEEDS.filter((feed) => sourceDue(sourceStateFor(sourceStates, feed.id), Date.parse(startedAt))).length;
    const payload = {
      ok: true,
      collectionStatus: diagnostics.portals.failed > 0 ? 'partial' : 'complete',
      degraded: diagnostics.portals.failed > 0 || diagnostics.portals.degraded > 0,
      collectedAt: new Date().toISOString(),
      windowHours: 24,
      durationMs: Math.max(0, Date.now() - Date.parse(startedAt)),
      sources,
      diagnostics,
      totals: {
        items: items.length,
        topics: topics.length,
        sources: sourceCount,
        socialItems: socialItems.length,
        dedicatedItems: Number(dedicatedMonitoring?.items?.length) || 0,
      },
      items,
      topics,
      dedicatedMonitoring: dedicatedMonitoring || { enabled: false, terms: [], items: [], statuses: [], totals: { terms: 0, items: 0, sources: 0 } },
      configuration: {
        browserRequired: false,
        execution: 'cloudflare-queue-free-pipeline',
        catalogFixed: true,
        freeScheduler: {
          enabled: true,
          version: 'hf3.2',
          batchSize: FREE_SOURCE_BATCH_SIZE,
          selectedSourceIds: Array.isArray(body?.selectedSourceIds) ? body.selectedSourceIds : [],
          remainingDue,
        },
      },
      translation: {
        targetLanguage: 'pt-BR',
        strategy: 'cached-progressive-free',
        maxNewTitlesPerEnrichmentJob: FREE_TRANSLATIONS_PER_JOB,
        concurrency: 1,
      },
      operational: {
        freeScheduler: true,
        freeSchedulerVersion: 'hf3.2',
        stage: 'snapshot',
        sourceBatchSize: FREE_SOURCE_BATCH_SIZE,
        selectedSourceIds: Array.isArray(body?.selectedSourceIds) ? body.selectedSourceIds : [],
        sourcesRemainingDue: remainingDue,
        payloadItemLimit: FREE_PAYLOAD_ITEM_LIMIT,
        topicLimit: FREE_TOPIC_LIMIT,
        itemsPerSource: FREE_ITEMS_PER_SOURCE,
      },
    };
    await saveRun(db, { id: runId, triggerType, startedAt, payload });
    message?.ack?.();
    log('free_round_completed', { runId, selected: payload.operational.selectedSourceIds, items: items.length, topics: topics.length, remainingDue });

    const worldIds = Array.isArray(body?.selectedWorldIds) ? body.selectedWorldIds : [];
    if (worldIds.length) await enqueue(env, { type: 'round-enrich', runId, worldFeedIds: worldIds }).catch(() => null);
    await enqueue(env, { type: 'round-newsroom', runId }).catch(() => null);
    await enqueue(env, { type: 'round-monitor', runId }).catch(() => null);
    const slot = Math.floor(Date.parse(startedAt) / (15 * 60 * 1000));
    if (slot % 1 === 0 && new Date(startedAt).getUTCMinutes() % 15 === 0) {
      await enqueue(env, { type: 'round-social', runId }).catch(() => null);
    }
  } catch (error) {
    warn('free_snapshot_error', { runId: body?.runId || null, detail: error instanceof Error ? error.message : String(error) });
    message?.ack?.();
  }
}

async function processFreeEnrichment(message, env, body) {
  try {
    const db = requireDatabase(env);
    const ids = [...new Set((Array.isArray(body?.worldFeedIds) ? body.worldFeedIds : []).map(String).filter(Boolean))];
    if (!ids.length || !env?.AI?.run) return;
    const states = await getSourceStates(db, ids);
    const items = boundedDiverseItems(ids.flatMap((id) => sourceStateFor(states, id)?.items || []), 16).filter((item) => item?.region === 'Mundo');
    const keys = items.map((item) => {
      const title = plainText(item?.title);
      return title && !isLikelyPortuguese(title) ? translationKey(title, sourceLanguage(item)) : null;
    }).filter(Boolean);
    const cached = await getCachedTranslations(db, keys);
    const translated = await translateWorldItems(items, { ai: env.AI, cached, concurrency: 1, maximumNewTitles: FREE_TRANSLATIONS_PER_JOB });
    if (translated.generatedEntries.length) await saveCachedTranslations(db, translated.generatedEntries);
    log('free_translation_completed', { runId: body?.runId || null, generated: translated.generatedEntries.length });
  } catch (error) {
    warn('free_translation_deferred', { detail: error instanceof Error ? error.message : String(error) });
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
    if (topics.length) await syncNewsroomStories(db, topics, { runId, at: stored?.payload?.collectedAt || new Date().toISOString() });
    log('free_newsroom_completed', { runId, topics: topics.length });
  } catch (error) {
    warn('free_newsroom_deferred', { detail: error instanceof Error ? error.message : String(error) });
  } finally {
    message?.ack?.();
  }
}

async function processFreeMonitor(message, env, body) {
  try {
    const db = requireDatabase(env);
    const terms = await listMonitoringTerms(db, { activeOnly: true });
    if (!terms.length) return;
    const slot = Math.floor(Date.now() / (5 * 60 * 1000));
    const term = terms[slot % terms.length];
    const result = await collectDedicatedMonitoring([term], new Date(Date.now() - DAY_MS), fetch);
    const before = await appStateJson(db, MONITOR_CACHE_KEY, { enabled: true, terms: [], items: [], statuses: [], totals: { terms: 0, items: 0, sources: 0 } });
    const termMap = new Map([...(before?.terms || []), ...(result?.terms || [])].filter((item) => item?.id).map((item) => [item.id, item]));
    const statusMap = new Map([...(before?.statuses || []), ...(result?.statuses || [])].map((item) => [item?.termId || item?.id || item?.term, item]).filter(([key]) => key));
    const items = boundedDiverseItems([...(result?.items || []), ...(before?.items || [])], 48);
    const merged = { enabled: true, terms: [...termMap.values()], items, statuses: [...statusMap.values()], totals: { terms: termMap.size, items: items.length, sources: new Set(items.map((item) => item?.sourceName).filter(Boolean)).size } };
    await saveAppStateJson(db, MONITOR_CACHE_KEY, merged);
    log('free_monitor_completed', { runId: body?.runId || null, term: term?.term || null, items: result?.items?.length || 0 });
  } catch (error) {
    warn('free_monitor_deferred', { detail: error instanceof Error ? error.message : String(error) });
  } finally {
    message?.ack?.();
  }
}

async function processFreeSocial(message, env, body) {
  try {
    const db = requireDatabase(env);
    const states = await getCompactSourceStates(db);
    const portals = portalItemsFromStates(states).slice(0, 40);
    if (!portals.length) return;
    const clusters = clusterItems(portals).slice(0, 5);
    const social = await collectBluesky(clusters, new Date(Date.now() - DAY_MS), fetch);
    await saveAppStateJson(db, SOCIAL_CACHE_KEY, { ...social, updatedAt: new Date().toISOString() });
    log('free_social_completed', { runId: body?.runId || null, items: social?.items?.length || 0 });
  } catch (error) {
    warn('free_social_deferred', { detail: error instanceof Error ? error.message : String(error) });
  } finally {
    message?.ack?.();
  }
}

async function processFreeMessage(message, env) {
  const body = message?.body && typeof message.body === 'object' ? message.body : {};
  if (body.type === 'round-snapshot') return processFreeSnapshot(message, env, body);
  if (body.type === 'round-enrich') return processFreeEnrichment(message, env, body);
  if (body.type === 'round-newsroom') return processFreeNewsroom(message, env, body);
  if (body.type === 'round-monitor') return processFreeMonitor(message, env, body);
  if (body.type === 'round-social') return processFreeSocial(message, env, body);
  return processFreeSource(message, env, body);
}

export async function runFreeRoundQueue(batch, env) {
  for (const message of batch?.messages || []) await processFreeMessage(message, env);
}
