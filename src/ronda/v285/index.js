import { buildCarouselBrief, buildTopics, classifyEditoria } from "./clustering.js";
import { ARTICLE_ANALYSIS_MODEL, buildIntelligentCarousel, expandTopicWithRoundCandidates, extractArticleFromHtml, intelligentCarouselCacheKey } from "./article-reader.js";
import { collectRound, FEEDS, summarizePortalStatuses } from "./collector.js";
import {
  acquireLock,
  createIntelligentJob,
  createMonitoringTerm,
  databaseHealth,
  databaseSelfTest,
  deleteMonitoringTerm,
  ensureSchema,
  expireStaleRuns,
  getArticleReadCache,
  getArticleSourceStats,
  getIntelligentCarousel,
  getLatestRunSummary,
  getSourceStates,
  listSourceDiagnostics,
  getIntelligentJob,
  getLatestRound,
  getRunHistory,
  getRunPayload,
  getRunStatus,
  listMonitoringTerms,
  MAX_MONITORING_TERMS,
  recordArticleSourceAttempt,
  releaseLock,
  renewLock,
  runDatabaseMaintenance,
  saveArticleReadCache,
  saveIntelligentCarousel,
  saveRun,
  saveSourceStates,
  queueRun,
  markRunStarted,
  touchRun,
  preflightCoreStorage,
  setMonitoringTermActive,
  updateIntelligentJob,
  cleanupYouTubeData,
  getLatestYouTubeCollection,
  getLatestYouTubeTermResults,
  getYouTubeStateValue,
  saveYouTubeCollection,
  saveYouTubeTermResult,
  setYouTubeStateValue,
  createEditorialUser,
  getEditorialUserByEmailKey,
  getEditorialUserById,
  createUserSession,
  getUserBySessionHash,
  deleteUserSession,
  updateUserDefaultSlideCount,
  listWritingSamples,
  getWritingSampleStats,
  createWritingSample,
  deleteWritingSample,
  getWritingProfile,
  invalidateWritingProfile,
  saveWritingProfile,
  listCarouselLearningExamples,
  getCarouselLearningStats,
  createCarouselLearningExample,
  syncNewsroomStories,
  listNewsroomStories,
  getNewsroomStory,
  updateNewsroomStory,
  addNewsroomStoryNote,
  toggleNewsroomStoryFollow,
  getNewsroomHandoff,
  listYouTubeCuratedChannels,
  saveYouTubeCuratedChannel,
  setYouTubeCuratedChannelActive,
  deleteYouTubeCuratedChannel,
} from "./database.js";
import { parseFeed, plainText } from "./parser.js";
import {
  DEFAULT_SLIDE_COUNT,
  MAX_SLIDE_COUNT,
  MAX_STYLE_SAMPLE_CHARS,
  MAX_STYLE_SAMPLES,
  MAX_STYLE_TOTAL_CHARS,
  MIN_SLIDE_COUNT,
  SESSION_COOKIE_NAME,
  SESSION_TTL_DAYS,
  analyzeWritingStyle,
  clearSessionCookie,
  hashPassword,
  normalizeDisplayName,
  normalizeEmail,
  normalizeStyleSample,
  normalizeCarouselLearningExample,
  summarizeCarouselLearning,
  parseCookies,
  randomToken,
  sessionCookie,
  sha256Hex,
  validateEmail,
  validatePassword,
  validateSlideCount,
  verifyPassword,
  writingStylePrompt,
} from "./profile.js";
import { portugueseOnlyFallback, TRANSLATION_MODEL, translateRoundPayload } from "./translation.js";
import {
  APPROVED_YOUTUBE_NEWS_CHANNELS,
  YOUTUBE_CHANNEL_SCOPE,
  applyYouTubeQuotaEvents,
  collectYouTubeTerm,
  collectYouTubeTrending,
  collectYouTubeCuratedChannels,
  resolveYouTubeChannel,
  defaultYouTubeQuotaState,
  publicYouTubeQuota,
  restrictYouTubeCollectionToNews,
  restrictYouTubeTermResultToNews,
} from "./youtube.js";

const VERSION = "2.8.5";
const INTELLIGENT_JOB_STALE_LABEL = "2 minutos";
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: https://i.ytimg.com https://*.ytimg.com; object-src 'none'; script-src 'self'; style-src 'self'",
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

function normalizedEtag(value) {
  const token = String(value || "empty").replace(/[^a-z0-9._-]+/gi, "-").slice(0, 120);
  return `W/"${token || "empty"}"`;
}

function conditionalJson(request, data, etagValue, status = 200) {
  const etag = normalizedEtag(etagValue);
  if (request.headers.get("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers: { ...SECURITY_HEADERS, ETag: etag, "Cache-Control": "no-cache" } });
  }
  return json(data, status, { ETag: etag, "Cache-Control": "no-cache" });
}

function structuredLog(event, fields = {}) {
  console.log(JSON.stringify({ event, version: VERSION, at: new Date().toISOString(), ...fields }));
}

function freshActiveRun(run, { queuedMaxAgeMs = 2 * 60 * 1000, runningMaxAgeMs = 10 * 60 * 1000 } = {}) {
  if (!run || !["queued", "running"].includes(run.status)) return null;
  const reference = run.status === "queued"
    ? run.queuedAt
    : run.heartbeatAt || run.startedAt || run.queuedAt;
  const referenceMs = Date.parse(reference || "");
  const maximum = run.status === "queued" ? queuedMaxAgeMs : runningMaxAgeMs;
  return Number.isFinite(referenceMs) && Date.now() - referenceMs <= maximum ? run : null;
}

function compactRoundDiagnosticSources(sources = []) {
  return (Array.isArray(sources) ? sources : [])
    .filter((source) => source?.region !== "Rede")
    .map((source) => ({
      id: source?.id || null,
      name: source?.name || "Fonte",
      region: source?.region || "Brasil",
      ok: Boolean(source?.ok),
      count: Number(source?.count) || 0,
      cached: Boolean(source?.cached),
      degraded: Boolean(source?.degraded),
      route: source?.route || null,
      httpStatus: source?.httpStatus == null ? null : Number(source.httpStatus),
      errorCode: source?.errorCode || null,
      error: String(source?.warning || source?.error || "").slice(0, 220) || null,
      lastAttemptAt: source?.lastAttemptAt || null,
      lastSuccessAt: source?.lastSuccessAt || null,
      nextCheckAt: source?.nextCheckAt || null,
    }));
}

function roundDiagnosticPayload(payload = {}) {
  const sources = compactRoundDiagnosticSources(payload?.sources);
  const portals = payload?.diagnostics?.portals || summarizePortalStatuses(sources);
  return {
    collectionStatus: payload?.collectionStatus || (payload?.ok ? (portals?.complete ? "complete" : "partial") : "failed"),
    portals,
    sources,
    attemptedAt: payload?.attemptedAt || payload?.collectedAt || null,
    detail: payload?.detail || null,
  };
}

function terminalRoundFailurePayload(error, { startedAt } = {}) {
  const sourcePayload = error?.roundPayload && typeof error.roundPayload === "object" && !Array.isArray(error.roundPayload)
    ? error.roundPayload
    : null;
  const now = new Date().toISOString();
  const base = sourcePayload || {};
  const diagnostics = roundDiagnosticPayload(base);
  return {
    ...base,
    ok: false,
    collectionStatus: "failed",
    degraded: true,
    schemaVersion: Number(base.schemaVersion) || 5,
    collectedAt: base.collectedAt || now,
    attemptedAt: now,
    windowHours: Number(base.windowHours) || 24,
    durationMs: Number(base.durationMs) || Math.max(0, Date.now() - Date.parse(startedAt || now)),
    error: "A ronda não pôde ser concluída após as tentativas automáticas.",
    detail: String(error instanceof Error ? error.message : error || base.detail || "Falha não identificada.").slice(0, 500),
    sources: Array.isArray(base.sources) ? base.sources : [],
    diagnostics,
    totals: base.totals || { items: 0, topics: 0, sources: 0, socialItems: 0, dedicatedItems: 0 },
    items: Array.isArray(base.items) && base.ok ? base.items : [],
    topics: Array.isArray(base.topics) && base.ok ? base.topics : [],
    dedicatedMonitoring: base.dedicatedMonitoring || {
      enabled: false,
      terms: [],
      items: [],
      statuses: [],
      totals: { terms: 0, items: 0, sources: 0 },
    },
    operational: base.operational || {},
  };
}


function secureEqual(left, right) {
  const a = new TextEncoder().encode(String(left ?? ""));
  const b = new TextEncoder().encode(String(right ?? ""));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

function requireOperationAuth(request, env) {
  if (env.MANUAL_ROUND_TOKEN && !secureEqual(request.headers.get("X-Round-Token"), env.MANUAL_ROUND_TOKEN)) {
    throw new HttpError(401, "Chave de operação inválida.");
  }
}


function validatedMonitoringTerm(body) {
  const term = plainText(body?.term).replace(/\s+/g, " ").trim().slice(0, 80);
  if (term.length < 2) throw new HttpError(400, "Informe um termo com pelo menos dois caracteres.");
  return term;
}

function requireDatabase(env) {
  if (!env.DB) throw new HttpError(503, "Banco D1 não configurado.", "Crie um banco D1 e adicione ao Worker um binding chamado DB.");
  return env.DB;
}

function requireYouTubeDatabase(env) {
  // O YouTube não pode voltar silenciosamente ao banco editorial principal:
  // se o binding separado faltar, somente a aba YouTube fica indisponível.
  if (!env.YOUTUBE_DB) {
    throw new HttpError(503, "Banco D1 do YouTube não configurado.", "Adicione o binding YOUTUBE_DB; a Ronda de portais continua independente.");
  }
  return env.YOUTUBE_DB;
}

function secureCookieForRequest(request) {
  try { return new URL(request.url).protocol === "https:"; } catch { return true; }
}

async function sessionContext(request, env) {
  const token = parseCookies(request.headers.get("Cookie"))[SESSION_COOKIE_NAME];
  if (!token) return { token: null, tokenHash: null, user: null };
  const tokenHash = await sha256Hex(token);
  const user = await getUserBySessionHash(requireDatabase(env), tokenHash).catch(() => null);
  return { token, tokenHash, user };
}

async function optionalEditorialUser(request, env) {
  return (await sessionContext(request, env)).user;
}

async function requireEditorialUser(request, env) {
  const context = await sessionContext(request, env);
  if (!context.user) throw new HttpError(401, "Entre no seu perfil editorial para continuar.");
  return context;
}

function publicWritingProfile(value) {
  if (!value?.profile) return null;
  return {
    ...value.profile,
    sampleCount: Number(value.sampleCount) || 0,
    updatedAt: value.updatedAt || null,
  };
}

async function profilePayload(db, user) {
  const [samples, stats, writingProfile, carouselLearning] = await Promise.all([
    listWritingSamples(db, user.id),
    getWritingSampleStats(db, user.id),
    getWritingProfile(db, user.id),
    getCarouselLearningStats(db, user.id),
  ]);
  return {
    authenticated: true,
    user,
    samples,
    writingProfile: publicWritingProfile(writingProfile),
    carouselLearning,
    limits: {
      maximumSamples: MAX_STYLE_SAMPLES,
      maximumCharactersPerSample: MAX_STYLE_SAMPLE_CHARS,
      maximumTotalCharacters: MAX_STYLE_TOTAL_CHARS,
      usedCharacters: stats.totalChars,
      slideCount: { minimum: MIN_SLIDE_COUNT, maximum: MAX_SLIDE_COUNT, default: DEFAULT_SLIDE_COUNT },
    },
  };
}

const CURRENT_PORTAL_IDS = new Set(FEEDS.map((feed) => feed.id));
const CURRENT_PORTAL_NAMES = new Set(FEEDS.map((feed) => feed.name));
const CATALOG_VERSION = "fixed-39-no-curiosity-v1";

function currentCatalogSource(source) {
  if (!source || typeof source !== "object") return false;
  if (source.region === "Rede" || source.id === "bluesky" || source.name === "Bluesky") return true;
  return CURRENT_PORTAL_IDS.has(source.id) || CURRENT_PORTAL_NAMES.has(source.name);
}

function currentCatalogItem(item) {
  if (!item || typeof item !== "object") return false;
  if (item.region === "Rede" || item.kind === "social") return true;
  return CURRENT_PORTAL_NAMES.has(item.collectorName) || CURRENT_PORTAL_NAMES.has(item.sourceName);
}

function withEditorias(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.items)) return payload;
  const translatedPayload = payload.translation?.targetLanguage === "pt-BR" && payload.translation?.portugueseOnly
    ? payload
    : portugueseOnlyFallback(payload);
  const items = translatedPayload.items.filter(currentCatalogItem);
  const sources = Array.isArray(translatedPayload.sources)
    ? translatedPayload.sources.filter(currentCatalogSource)
    : [];
  const catalogChanged = items.length !== translatedPayload.items.length
    || sources.length !== (translatedPayload.sources || []).length
    || translatedPayload.catalog?.version !== CATALOG_VERSION;
  if (!catalogChanged && Number(translatedPayload.schemaVersion) >= 5) return translatedPayload;

  const collectedAt = new Date(translatedPayload.collectedAt || translatedPayload.storedAt || Date.now());
  const topics = buildTopics(items, collectedAt, 40).map((topic) => {
    const recalculatedEditoria = classifyEditoria(topic?.items || []);
    return topic.editoria === recalculatedEditoria
      ? topic
      : { ...topic, editoria: recalculatedEditoria, carousel: buildCarouselBrief({ ...topic, editoria: recalculatedEditoria }) };
  });
  const sourceCount = new Set(items.map((item) => item.sourceName).filter(Boolean)).size;
  const socialItems = items.filter((item) => item.kind === "social").length;
  return {
    ...translatedPayload,
    schemaVersion: 5,
    catalog: { version: CATALOG_VERSION, portals: FEEDS.length },
    sources,
    items,
    topics,
    totals: {
      ...(translatedPayload.totals || {}),
      items: items.length,
      topics: topics.length,
      sources: sourceCount,
      socialItems,
      dedicatedItems: Number(translatedPayload.dedicatedMonitoring?.items?.length) || 0,
    },
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
            when: "Na data informada pela matéria selecionada.",
            impact: "A medida pode orientar investimentos e mudanças na mobilidade urbana.",
            repercussion: "Profissionais do setor e administrações locais pedem clareza sobre os próximos passos.",
          },
          entities: {
            people: [],
            companies: ["Congresso Nacional"],
            places: ["Brasil"],
            dates: [],
            themes: ["mobilidade urbana", "política pública"],
            keywords: ["mobilidade", "Congresso", "investimentos"],
          },
          facts: [
            {
              claim: "O Congresso aprovou um novo plano nacional de mobilidade urbana.",
              evidence: "O Congresso aprovou um novo plano nacional de mobilidade urbana",
              confidence: "high",
            },
            {
              claim: "A implantação deverá ocorrer em etapas.",
              evidence: "A implantação deverá ocorrer em etapas",
              confidence: "high",
            },
          ],
          slides: [
            { number: 1, role: "Título principal", title: "Congresso aprova plano de mobilidade", body: "A proposta define novas diretrizes para o setor.", evidenceIds: ["fact-1"] },
            { number: 2, role: "Contexto", title: "O que orienta o plano", body: "O texto trata de transporte público, ciclovias, acessibilidade e segurança viária.", evidenceIds: ["fact-1"] },
            { number: 3, role: "Informação principal", title: "A medida foi aprovada", body: "O Congresso aprovou o novo plano nacional de mobilidade urbana.", evidenceIds: ["fact-1"] },
            { number: 4, role: "Detalhamento", title: "Aplicação em etapas", body: "A implantação deverá ocorrer em etapas e ainda depende de detalhamento técnico.", evidenceIds: ["fact-2"] },
            { number: 5, role: "Consequência", title: "Recursos podem mudar", body: "A medida pode influenciar a distribuição de recursos e a escolha de obras.", evidenceIds: ["fact-1"] },
            { number: 6, role: "Conclusão", title: "Próximos passos", body: "Prazos, financiamento e regras complementares ainda precisam ser detalhados.", evidenceIds: ["fact-2"] },
            { number: 7, role: "CTA", title: "Acompanhe a pauta", body: "Consulte a matéria original e acompanhe as próximas atualizações.", evidenceIds: ["fact-2"] },
          ],
        },
      }),
    };
  }
  return null;
}


function retryableProcessingError(error) {
  if (error?.code === "PUBLISHER_ARTICLE_UNAVAILABLE") return false;
  const message = error instanceof Error ? error.message : String(error || "");
  return /timeout|tempo limite|temporar|429|500|502|503|504|ai indisponível|falha de rede|network/i.test(message);
}

function createProgressReporter(db, jobId, lock) {
  let lastProgress = -1;
  let lastMessage = "";
  let lastWriteAt = 0;
  return async ({ progress, message }) => {
    const now = Date.now();
    const safeProgress = Math.max(0, Math.min(100, Number(progress) || 0));
    const changedStage = message && message !== lastMessage;
    const advanced = safeProgress - lastProgress >= 8;
    if (!changedStage && !advanced && now - lastWriteAt < 4_000) return;
    await updateIntelligentJob(db, {
      jobId,
      status: "running",
      progress: safeProgress,
      message,
    });
    lastProgress = safeProgress;
    lastMessage = message || "";
    lastWriteAt = now;
  };
}

function publicIntelligentJob(job) {
  const terminal = ["succeeded", "failed"].includes(job.status);
  return {
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    expiresAt: job.expiresAt,
    stale: Boolean(job.stale),
    terminal,
    released: terminal,
    nextCycleAllowed: terminal,
  };
}

async function processIntelligentCarouselJob(env, job, topic, options = {}) {
  const jobStartedAt = Date.now();
  const db = requireDatabase(env);
  const jobLock = await acquireLock(db, `intelligent-job-${job.jobId}`, 12 * 60 * 1000);
  if (!jobLock) return null;
  try {
    const started = await updateIntelligentJob(db, {
      jobId: job.jobId,
      status: "running",
      progress: 4,
      message: "Selecionando uma única matéria para esta sugestão.",
    });
    if (!started) throw new Error("A tarefa de leitura não foi encontrada para iniciar o ciclo.");
    let sourceStats = {};
    try {
      sourceStats = await getArticleSourceStats(
        db,
        (topic?.items || []).map((item) => item?.url).filter(Boolean),
      );
    } catch (error) {
      console.error("Histórico de leitura indisponível; seleção seguirá sem esse sinal", error);
    }
    const slideCount = validateSlideCount(options.slideCount, DEFAULT_SLIDE_COUNT);
    const profileRecord = options.writingProfile?.profile ? options.writingProfile : null;
    const learningExamples = options.userId ? await listCarouselLearningExamples(db, options.userId).catch(() => []) : [];
    const adaptiveMemory = summarizeCarouselLearning(learningExamples);
    const profilePrompt = profileRecord ? writingStylePrompt(profileRecord.profile) : "";
    const combinedStylePrompt = [profilePrompt, adaptiveMemory.prompt].filter(Boolean).join("\n\n");
    const writingStyle = combinedStylePrompt ? {
      ...(profileRecord || {}),
      prompt: combinedStylePrompt,
      adaptiveMemory: { count: adaptiveMemory.count, metrics: adaptiveMemory.metrics },
    } : null;
    const data = await buildIntelligentCarousel(topic, {
      ai: articleAnalysisAi(env),
      model: env.ARTICLE_ANALYSIS_MODEL || ARTICLE_ANALYSIS_MODEL,
      fetcher: fetch,
      liveReading: env.ARTICLE_LIVE_READING !== "0",
      sourceStats,
      readCache: {
        get: (cacheKey) => getArticleReadCache(db, cacheKey),
        set: (cacheKey, payload) => saveArticleReadCache(db, cacheKey, payload, 12),
      },
      onProgress: createProgressReporter(db, job.jobId, jobLock),
      slideCount,
      writingStyle,
      styleKey: options.styleKey || "default",
    });
    const selectedSource = data?.reading?.selectedSource;
    if (selectedSource?.liveAttempted) {
      try {
        await recordArticleSourceAttempt(db, {
          url: selectedSource.url,
          success: selectedSource.readMode === "full-article",
          wordCount: selectedSource.wordCount,
        });
      } catch (error) {
        console.error("Não foi possível atualizar a estatística do portal", error);
      }
    }
    const releasedAt = new Date().toISOString();
    const storedData = {
      ...data,
      cacheKey: job.cacheKey,
      runId: job.runId,
      topicId: job.topicId,
      topicTitle: topic.title,
      requestedSlideCount: slideCount,
      profileApplied: Boolean(profileRecord),
      adaptiveMemoryCount: adaptiveMemory.count,
      cycle: {
        ...(data.cycle || {}),
        status: "completed",
        terminal: true,
        released: true,
        releasedAt,
        nextCycleAllowed: true,
        jobId: job.jobId,
      },
    };
    await saveIntelligentCarousel(db, {
      cacheKey: job.cacheKey,
      runId: job.runId,
      topicId: job.topicId,
      payload: storedData,
      ttlHours: 48,
    });
    const completed = await updateIntelligentJob(db, {
      jobId: job.jobId,
      status: "succeeded",
      progress: 100,
      message: "Roteiro concluído. Ciclo encerrado e sistema disponível para a próxima sugestão.",
      payload: storedData,
    });
    if (completed?.status !== "succeeded") throw new Error("Não foi possível registrar o encerramento do ciclo.");
    structuredLog("intelligent_job_completed", {
      jobId: job.jobId,
      durationMs: Date.now() - jobStartedAt,
      readingMs: Number(data?.performance?.readingMs) || null,
      aiMs: Number(data?.performance?.aiMs) || null,
      fastPath: Boolean(data?.performance?.fastPath),
      analysisMode: data?.analysisMode || "source-extraction",
      slideCount,
    });
    return storedData;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (retryableProcessingError(error)) throw error;
    const failed = await updateIntelligentJob(db, {
      jobId: job.jobId,
      status: "failed",
      progress: 100,
      message: "Ciclo encerrado após falha. Sistema liberado para uma nova leitura.",
      error: detail,
    });
    if (failed?.status !== "failed") throw error;
    structuredLog("intelligent_job_failed", { jobId: job.jobId, detail });
    return null;
  } finally {
    try { await releaseLock(db, jobLock); } catch (error) {
      console.error("Não foi possível remover o lock terminal da leitura", error);
    }
  }
}


async function resolveTopicForIntelligentJob(env, job) {
  const db = requireDatabase(env);
  let payload;
  if (job.runId && job.runId !== "latest") {
    const stored = await getRunPayload(db, job.runId);
    if (!stored?.payload) throw new Error("A ronda vinculada a esta tarefa não está mais disponível.");
    payload = withEditorias({
      ...stored.payload,
      runId: stored.id,
      triggerType: stored.triggerType,
      storedAt: stored.completedAt,
    });
  } else {
    payload = withEditorias(await getLatestRound(db));
  }
  if (!payload?.ok || !Array.isArray(payload.topics)) throw new Error("Não há uma ronda válida para processar esta tarefa.");
  const topic = payload.topics.find((item) => item?.id === job.topicId);
  if (!topic) throw new Error("O assunto da tarefa não foi encontrado na ronda armazenada.");
  return expandTopicWithRoundCandidates(topic, payload, { maxExtra: 6 });
}

async function processIntelligentQueueMessage(message, env, body = {}) {
  const jobId = String(body.jobId || "").trim();
  if (!jobId) {
    message?.ack?.();
    return;
  }
  try {
    const db = requireDatabase(env);
    const job = await getIntelligentJob(db, jobId);
    if (!job || ["succeeded", "failed"].includes(job.status)) {
      message?.ack?.();
      return;
    }
    const topic = await resolveTopicForIntelligentJob(env, job);
    await processIntelligentCarouselJob(env, job, topic, {
      slideCount: body.slideCount,
      writingProfile: body.writingProfile || null,
      styleKey: body.styleKey || "default",
      userId: body.userId || null,
    });
    message?.ack?.();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const attempts = Number(message?.attempts || 1);
    structuredLog("intelligent_queue_error", { jobId, attempts, detail });
    if (retryableProcessingError(error) && attempts < 3 && message?.retry) {
      await updateIntelligentJob(requireDatabase(env), {
        jobId,
        status: "queued",
        progress: Math.max(2, Math.min(90, 8 * attempts)),
        message: `Falha temporária. Nova tentativa ${attempts + 1}/3 agendada.`,
        error: null,
      }).catch(() => null);
      message.retry({ delaySeconds: 15 * attempts });
      return;
    }
    await updateIntelligentJob(requireDatabase(env), {
      jobId,
      status: "failed",
      progress: 100,
      message: "Ciclo encerrado no consumidor. Sistema liberado para uma nova leitura.",
      error: detail,
    }).catch(() => null);
    message?.ack?.();
  }
}

async function processIntelligentQueueBatch(batch, env) {
  for (const message of batch.messages || []) {
    const body = message?.body && typeof message.body === "object" ? message.body : {};
    await processIntelligentQueueMessage(message, env, body);
  }
}

async function processRoundQueueMessage(message, env, body = {}) {
  const runId = String(body.runId || "").trim();
  const triggerType = body.triggerType === "manual" ? "manual" : "scheduled";
  const queuedAt = String(body.queuedAt || body.startedAt || new Date().toISOString());
  const startedAt = new Date().toISOString();
  if (!runId) {
    message?.ack?.();
    return;
  }
  try {
    const db = requireDatabase(env);
    await markRunStarted(db, { id: runId, triggerType, queuedAt, startedAt });
    await performRound(env, triggerType, { runId, startedAt, runStarted: true, deferFailureSave: true });
    structuredLog("round_queue_completed", { runId, triggerType });
    message?.ack?.();
  } catch (error) {
    const attempts = Number(message?.attempts || 1);
    const retryable = error instanceof HttpError ? [409, 429, 503].includes(error.status) : retryableProcessingError(error);
    structuredLog("round_queue_error", {
      runId,
      triggerType,
      attempts,
      retryable,
      detail: error instanceof Error ? error.message : String(error),
    });
    if (retryable && attempts < 3 && message?.retry) {
      const retryQueuedAt = new Date().toISOString();
      await queueRun(requireDatabase(env), { id: runId, triggerType, queuedAt: retryQueuedAt }).catch(() => null);
      message.retry({ delaySeconds: 20 * attempts });
      return;
    }
    const failedPayload = terminalRoundFailurePayload(error, { startedAt });
    const failedDiagnostics = failedPayload.diagnostics?.portals || {};
    structuredLog("round_failed_final", {
      runId,
      triggerType,
      attempts,
      detail: failedPayload.detail,
      portalsTotal: Number(failedDiagnostics.total) || 0,
      portalsWithContent: Number(failedDiagnostics.withContent) || 0,
      portalsFailed: Number(failedDiagnostics.failed) || 0,
      portalsDegraded: Number(failedDiagnostics.degraded) || 0,
      portalErrors: failedDiagnostics.byCode || {},
    });
    await saveRun(requireDatabase(env), {
      id: runId,
      triggerType,
      startedAt,
      payload: failedPayload,
    }).catch((saveError) => {
      structuredLog("round_failure_save_failed", {
        runId,
        detail: saveError instanceof Error ? saveError.message : String(saveError),
      });
    });
    message?.ack?.();
  }
}


const YOUTUBE_RUNTIME_STATE_KEY = "youtube_runtime";
const YOUTUBE_QUOTA_STATE_KEY = "youtube_quota";
const YOUTUBE_TERM_CURSOR_KEY = "youtube_term_cursor";

function emptyYouTubeRuntime() {
  return {
    status: "idle",
    jobId: null,
    triggerType: null,
    queuedAt: null,
    startedAt: null,
    heartbeatAt: null,
    completedAt: null,
    lastSuccessAt: null,
    nextRunAt: null,
    failureCount: 0,
    blockedUntil: null,
    error: null,
  };
}

function activeYouTubeRuntime(runtime) {
  if (!runtime || !["queued", "running"].includes(runtime.status)) return null;
  const reference = runtime.status === "queued" ? runtime.queuedAt : runtime.heartbeatAt || runtime.startedAt;
  const referenceMs = Date.parse(reference || "");
  const maxAge = runtime.status === "queued" ? 2 * 60_000 : 10 * 60_000;
  return Number.isFinite(referenceMs) && Date.now() - referenceMs <= maxAge ? runtime : null;
}

async function getYouTubeRuntime(db, { expire = true } = {}) {
  const runtime = { ...emptyYouTubeRuntime(), ...(await getYouTubeStateValue(db, YOUTUBE_RUNTIME_STATE_KEY, {})) };
  if (!expire || !["queued", "running"].includes(runtime.status) || activeYouTubeRuntime(runtime)) return runtime;
  const now = new Date().toISOString();
  const expired = {
    ...runtime,
    status: "expired",
    completedAt: now,
    heartbeatAt: now,
    error: runtime.status === "queued"
      ? "Coleta do YouTube expirou antes de iniciar no consumidor."
      : "Coleta do YouTube expirou por ausência de progresso.",
  };
  await setYouTubeStateValue(db, YOUTUBE_RUNTIME_STATE_KEY, expired);
  return expired;
}

function youtubeRetryableError(error) {
  if (error?.quota || [400, 401, 403].includes(Number(error?.status))) return false;
  return Boolean(error?.retryable) || retryableProcessingError(error);
}

async function youtubePublicStatus(db, env) {
  const [runtime, latest, quota, termResults, curatedChannels] = await Promise.all([
    getYouTubeRuntime(db),
    getLatestYouTubeCollection(db),
    getYouTubeStateValue(db, YOUTUBE_QUOTA_STATE_KEY, defaultYouTubeQuotaState()),
    getLatestYouTubeTermResults(db, 12),
    listYouTubeCuratedChannels(db, { activeOnly: true }),
  ]);
  const active = activeYouTubeRuntime(runtime);
  return {
    configured: Boolean(env.YOUTUBE_API_KEY),
    queueReady: Boolean(env.YOUTUBE_JOBS_QUEUE?.send),
    newsOnly: true,
    channelScope: YOUTUBE_CHANNEL_SCOPE,
    approvedChannelCount: APPROVED_YOUTUBE_NEWS_CHANNELS.length,
    curatedChannelCount: curatedChannels.length,
    curationActive: curatedChannels.length > 0,
    status: active?.status || runtime.status || (latest ? "success" : "idle"),
    running: Boolean(active),
    jobId: active?.jobId || runtime.jobId || null,
    queuedAt: active?.queuedAt || null,
    startedAt: active?.startedAt || null,
    completedAt: runtime.completedAt || null,
    lastSuccessAt: runtime.lastSuccessAt || latest?.collectedAt || null,
    nextRunAt: runtime.nextRunAt || null,
    blockedUntil: runtime.blockedUntil || null,
    failureCount: Number(runtime.failureCount) || 0,
    error: runtime.error || null,
    cached: Boolean(latest && runtime.status !== "success"),
    latestCollectionId: latest?.id || null,
    termResultCount: termResults.length,
    quota: publicYouTubeQuota(quota),
  };
}

async function performYouTubeCollection(env, body = {}) {
  const db = requireYouTubeDatabase(env);
  const coreDb = requireDatabase(env);
  await ensureSchema(db);
  const lock = await acquireLock(db, "youtube-collection", 12 * 60 * 1000);
  if (!lock) throw new HttpError(409, "Já existe uma coleta do YouTube em andamento.");
  const now = new Date().toISOString();
  const jobId = String(body.jobId || crypto.randomUUID());
  const triggerType = body.triggerType === "manual" ? "manual" : "scheduled";
  try {
    const previousRuntime = await getYouTubeRuntime(db, { expire: false });
    const blockedMs = Date.parse(previousRuntime.blockedUntil || "");
    if (Number.isFinite(blockedMs) && blockedMs > Date.now()) {
      const error = new Error(`Coleta do YouTube pausada até ${previousRuntime.blockedUntil}.`);
      error.code = "YOUTUBE_CIRCUIT_OPEN";
      throw error;
    }
    await setYouTubeStateValue(db, YOUTUBE_RUNTIME_STATE_KEY, {
      ...previousRuntime,
      status: "running",
      jobId,
      triggerType,
      queuedAt: body.queuedAt || previousRuntime.queuedAt || now,
      startedAt: now,
      heartbeatAt: now,
      completedAt: null,
      error: null,
    });

    const previous = await getLatestYouTubeCollection(db);
    const region = String(env.YOUTUBE_REGION || "BR").toUpperCase();
    const limit = Math.max(10, Math.min(50, Number(env.YOUTUBE_VIDEO_LIMIT) || 25));
    const curatedChannels = await listYouTubeCuratedChannels(db, { activeOnly: true });
    const trending = curatedChannels.length
      ? await collectYouTubeCuratedChannels({ apiKey: env.YOUTUBE_API_KEY, region, limit, previous, channels: curatedChannels })
      : await collectYouTubeTrending({ apiKey: env.YOUTUBE_API_KEY, region, limit, previous });
    let quota = await getYouTubeStateValue(db, YOUTUBE_QUOTA_STATE_KEY, defaultYouTubeQuotaState());
    quota = applyYouTubeQuotaEvents(quota, trending.quotaEvents, trending.collection.collectedAt);

    let termResult = null;
    if (body.monitorTerm) {
      const activeTerms = await listMonitoringTerms(coreDb, { activeOnly: true });
      if (activeTerms.length && Number(quota.searchCalls || 0) < 80) {
        const cursorState = await getYouTubeStateValue(db, YOUTUBE_TERM_CURSOR_KEY, { index: 0 });
        const index = Math.max(0, Number(cursorState?.index) || 0) % activeTerms.length;
        const selected = activeTerms[index];
        const monitored = await collectYouTubeTerm({
          apiKey: env.YOUTUBE_API_KEY,
          term: selected.term,
          termId: selected.id,
          region,
          hours: 24,
          limit: 10,
        });
        termResult = await saveYouTubeTermResult(db, monitored.result);
        quota = applyYouTubeQuotaEvents(quota, monitored.quotaEvents, monitored.result.collectedAt);
        await setYouTubeStateValue(db, YOUTUBE_TERM_CURSOR_KEY, { index: (index + 1) % activeTerms.length, updatedAt: monitored.result.collectedAt });
      }
    }

    const collection = await saveYouTubeCollection(db, trending.collection);
    await setYouTubeStateValue(db, YOUTUBE_QUOTA_STATE_KEY, quota);
    const completedAt = new Date().toISOString();
    const runtime = {
      status: "success",
      jobId,
      triggerType,
      queuedAt: body.queuedAt || now,
      startedAt: now,
      heartbeatAt: completedAt,
      completedAt,
      lastSuccessAt: collection.collectedAt,
      nextRunAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      failureCount: 0,
      blockedUntil: null,
      error: null,
      collectionId: collection.id,
      termResultId: termResult?.id || null,
    };
    await setYouTubeStateValue(db, YOUTUBE_RUNTIME_STATE_KEY, runtime);
    await cleanupYouTubeData(db).catch(() => null);
    structuredLog("youtube_collection_completed", {
      jobId,
      triggerType,
      videos: collection.stats?.videoCount || 0,
      topics: collection.stats?.topicCount || 0,
      monitoredTerm: termResult?.term || null,
    });
    return collection;
  } finally {
    await releaseLock(db, lock).catch(() => null);
  }
}

async function processYouTubeQueueMessage(message, env, body = {}) {
  const jobId = String(body.jobId || "").trim();
  if (!jobId) {
    message?.ack?.();
    return;
  }
  try {
    await performYouTubeCollection(env, body);
    message?.ack?.();
  } catch (error) {
    const db = requireYouTubeDatabase(env);
    const attempts = Number(message?.attempts || 1);
    const retryable = youtubeRetryableError(error);
    const detail = error instanceof Error ? error.message : String(error);
    const current = await getYouTubeRuntime(db, { expire: false }).catch(() => emptyYouTubeRuntime());
    const failureCount = Number(current.failureCount || 0) + 1;
    const blockedUntil = error?.quota
      ? new Date(Date.now() + 6 * 60 * 60_000).toISOString()
      : failureCount >= 3
        ? new Date(Date.now() + 30 * 60_000).toISOString()
        : null;
    structuredLog("youtube_queue_error", { jobId, attempts, retryable, detail, code: error?.code || null });
    if (retryable && attempts < 3 && message?.retry) {
      await setYouTubeStateValue(db, YOUTUBE_RUNTIME_STATE_KEY, {
        ...current,
        status: "queued",
        jobId,
        queuedAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
        failureCount,
        error: `Falha temporária. Nova tentativa ${attempts + 1}/3 agendada.`,
      }).catch(() => null);
      message.retry({ delaySeconds: 30 * attempts });
      return;
    }
    const completedAt = new Date().toISOString();
    await setYouTubeStateValue(db, YOUTUBE_RUNTIME_STATE_KEY, {
      ...current,
      status: "failed",
      jobId,
      heartbeatAt: completedAt,
      completedAt,
      failureCount,
      blockedUntil,
      error: detail.slice(0, 500),
      nextRunAt: blockedUntil || new Date(Date.now() + 15 * 60_000).toISOString(),
    }).catch(() => null);
    message?.ack?.();
  }
}

async function processQueueBatch(batch, env) {
  for (const message of batch.messages || []) {
    const body = message?.body && typeof message.body === "object" ? message.body : {};
    if (body.type === "round") await processRoundQueueMessage(message, env, body);
    else if (body.type === "youtube") await processYouTubeQueueMessage(message, env, body);
    else await processIntelligentQueueMessage(message, env, body);
  }
}

async function performRound(env, triggerType, options = {}) {
  const db = requireDatabase(env);
  // Libera espaço antes de qualquer nova gravação. Quando YOUTUBE_DB existe,
  // os snapshots antigos do YouTube no banco principal deixam de ser necessários.
  await preflightCoreStorage(db, { purgeLegacyYouTube: true }).catch(() => null);
  await ensureSchema(db);
  const lock = options.lock || await acquireLock(db, "editorial-round", 12 * 60 * 1000);
  if (!lock) throw new HttpError(409, "Já existe uma ronda em andamento.");

  const runId = options.runId || crypto.randomUUID();
  const startedAt = options.startedAt || new Date().toISOString();
  structuredLog("round_started", { runId, triggerType });
  try {
    if (!options.runStarted) await markRunStarted(db, { id: runId, triggerType, queuedAt: startedAt, startedAt });
    else await touchRun(db, runId, startedAt).catch(() => null);
    let payload;
    let collectedPayload = null;
    try {
      const [monitoringTerms, previousRound, sourceStates] = await Promise.all([
        listMonitoringTerms(db, { activeOnly: true }),
        getLatestRound(db).catch(() => null),
        getSourceStates(db, FEEDS.map((feed) => feed.id)).catch(() => new Map()),
      ]);
      payload = await collectRound({
        feeds: FEEDS,
        monitoringTerms,
        previousRound,
        sourceStates,
      });
      collectedPayload = payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("O coletor não retornou um resultado válido.");
      }

      await touchRun(db, runId).catch(() => null);
      const sourceStateUpdates = Array.isArray(payload.sourceStateUpdates) ? payload.sourceStateUpdates : [];
      delete payload.sourceStateUpdates;
      if (sourceStateUpdates.length) {
        await saveSourceStates(db, sourceStateUpdates).catch((error) => {
          structuredLog("source_state_save_failed", { runId, detail: error instanceof Error ? error.message : String(error) });
        });
      }

      await renewLock(db, lock, 12 * 60 * 1000).catch(() => null);
      payload.configuration = {
        monitoringTerms: monitoringTerms.map((term) => ({ id: term.id, term: term.term })),
        browserRequired: false,
        execution: env.ROUND_JOBS_QUEUE?.send ? "cloudflare-queue" : "cloudflare-trigger",
        catalogFixed: true,
      };
      await touchRun(db, runId).catch(() => null);
      try {
        payload = await translateRoundPayload(payload, { ai: translationAi(env), db });
      } catch (error) {
        structuredLog("round_translation_failed", { runId, detail: error instanceof Error ? error.message : String(error) });
        payload = portugueseOnlyFallback(payload);
      }
      payload = withEditorias(payload);
      payload.schemaVersion = 5;
      payload.catalog = { version: CATALOG_VERSION, portals: FEEDS.length };
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
      if (collectedPayload?.ok && Array.isArray(collectedPayload.items) && collectedPayload.items.length) {
        payload = {
          ...collectedPayload,
          ok: true,
          collectionStatus: "partial",
          degraded: true,
          processingWarning: detail,
          diagnostics: {
            ...(collectedPayload.diagnostics || {}),
            processing: {
              ok: false,
              detail,
              recovered: true,
            },
          },
        };
        structuredLog("round_processing_recovered", {
          runId,
          detail,
          items: Number(payload?.totals?.items) || payload.items.length,
        });
      } else {
        const base = collectedPayload && typeof collectedPayload === "object" && !Array.isArray(collectedPayload)
          ? collectedPayload
          : {};
        payload = {
          ...base,
          ok: false,
          collectionStatus: "failed",
          degraded: true,
          schemaVersion: 5,
          collectedAt: base.collectedAt || new Date().toISOString(),
          windowHours: 24,
          durationMs: Number(base.durationMs) || Date.now() - Date.parse(startedAt),
          error: base.error || "A coleta foi interrompida por um erro interno.",
          detail,
          sources: Array.isArray(base.sources) ? base.sources : [],
          diagnostics: roundDiagnosticPayload(base),
          totals: base.totals || { items: 0, topics: 0, sources: 0, socialItems: 0, dedicatedItems: 0 },
          items: [],
          topics: [],
          dedicatedMonitoring: base.dedicatedMonitoring || {
            enabled: false,
            terms: [],
            items: [],
            statuses: [],
            totals: { terms: 0, items: 0, sources: 0 },
          },
          operational: base.operational || {},
        };
      }
    }
    await renewLock(db, lock, 12 * 60 * 1000).catch(() => null);
    if (!payload.ok && options.deferFailureSave) {
      const failure = new HttpError(503, payload.error, payload.detail || null);
      failure.roundPayload = payload;
      throw failure;
    }
    await syncNewsroomStories(db, payload.topics || [], { runId, at: payload.collectedAt || new Date().toISOString() }).catch((error) => {
      structuredLog("newsroom_sync_failed", { runId, detail: error instanceof Error ? error.message : String(error) });
    });
    await saveRun(db, { id: runId, triggerType, startedAt, payload });
    await runDatabaseMaintenance(db).catch((error) => {
      structuredLog("database_maintenance_failed", { detail: error instanceof Error ? error.message : String(error) });
    });
    const storedPayload = { ...payload, runId, triggerType };
    structuredLog("round_completed", {
      runId,
      triggerType,
      ok: Boolean(payload.ok),
      durationMs: payload.durationMs,
      items: Number(payload?.totals?.items) || 0,
      sources: Number(payload?.totals?.sources) || 0,
      portalRequests: Number(payload?.operational?.externalPortalRequests) || 0,
      collectionStatus: payload.collectionStatus || (payload.ok ? "complete" : "failed"),
      portalsFailed: Number(payload?.diagnostics?.portals?.failed) || 0,
      portalsDegraded: Number(payload?.diagnostics?.portals?.degraded) || 0,
    });
    if (!payload.ok) throw new HttpError(503, payload.error, payload.detail || null);
    return storedPayload;
  } finally {
    await releaseLock(db, lock).catch(() => null);
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
  if (url.pathname === "/api/auth/register" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    let email;
    let password;
    try {
      email = validateEmail(body.email);
      password = validatePassword(body.password);
    } catch (error) {
      throw new HttpError(400, error.message);
    }
    let defaultSlideCount;
    try { defaultSlideCount = validateSlideCount(body.defaultSlideCount, DEFAULT_SLIDE_COUNT); }
    catch (error) { throw new HttpError(400, error.message); }
    const emailKey = normalizeEmail(email);
    const db = requireDatabase(env);
    if (await getEditorialUserByEmailKey(db, emailKey)) throw new HttpError(409, "Já existe um perfil com este e-mail.");
    const credentials = await hashPassword(password);
    let user;
    try {
      user = await createEditorialUser(db, {
        email,
        emailKey,
        displayName: normalizeDisplayName(body.displayName, email),
        passwordHash: credentials.hash,
        passwordSalt: credentials.salt,
        passwordIterations: credentials.iterations,
        defaultSlideCount,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (/unique|constraint/i.test(detail)) throw new HttpError(409, "Já existe um perfil com este e-mail.");
      throw error;
    }
    const token = randomToken();
    await createUserSession(db, { tokenHash: await sha256Hex(token), userId: user.id, ttlDays: SESSION_TTL_DAYS });
    return json({ ok: true, ...(await profilePayload(db, user)) }, 201, {
      "Set-Cookie": sessionCookie(token, { secure: secureCookieForRequest(request) }),
    });
  }

  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const emailKey = normalizeEmail(body.email);
    const db = requireDatabase(env);
    const record = emailKey ? await getEditorialUserByEmailKey(db, emailKey) : null;
    const valid = record ? await verifyPassword(String(body.password || ""), record) : false;
    if (!record || !valid) throw new HttpError(401, "E-mail ou senha inválidos.");
    const token = randomToken();
    await createUserSession(db, { tokenHash: await sha256Hex(token), userId: record.id, ttlDays: SESSION_TTL_DAYS });
    const user = await getEditorialUserById(db, record.id);
    return json({ ok: true, ...(await profilePayload(db, user)) }, 200, {
      "Set-Cookie": sessionCookie(token, { secure: secureCookieForRequest(request) }),
    });
  }

  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    const context = await sessionContext(request, env);
    if (context.tokenHash) await deleteUserSession(requireDatabase(env), context.tokenHash).catch(() => null);
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie({ secure: secureCookieForRequest(request) }) });
  }

  if ((url.pathname === "/api/auth/me" || url.pathname === "/api/profile") && request.method === "GET") {
    const user = await optionalEditorialUser(request, env);
    if (!user) return json({
      ok: true,
      authenticated: false,
      limits: {
        maximumSamples: MAX_STYLE_SAMPLES,
        maximumCharactersPerSample: MAX_STYLE_SAMPLE_CHARS,
        maximumTotalCharacters: MAX_STYLE_TOTAL_CHARS,
        slideCount: { minimum: MIN_SLIDE_COUNT, maximum: MAX_SLIDE_COUNT, default: DEFAULT_SLIDE_COUNT },
      },
    });
    return json({ ok: true, ...(await profilePayload(requireDatabase(env), user)) });
  }

  if (url.pathname === "/api/profile/preferences" && request.method === "PATCH") {
    const { user } = await requireEditorialUser(request, env);
    const body = await request.json().catch(() => ({}));
    let slideCount;
    try { slideCount = validateSlideCount(body.defaultSlideCount); }
    catch (error) { throw new HttpError(400, error.message); }
    await updateUserDefaultSlideCount(requireDatabase(env), user.id, slideCount);
    const refreshed = await getEditorialUserById(requireDatabase(env), user.id);
    return json({ ok: true, user: refreshed });
  }

  if (url.pathname === "/api/profile/samples" && request.method === "POST") {
    const { user } = await requireEditorialUser(request, env);
    const body = await request.json().catch(() => ({}));
    let sample;
    try { sample = normalizeStyleSample(body); }
    catch (error) { throw new HttpError(400, error.message); }
    try {
      const created = await createWritingSample(requireDatabase(env), user.id, sample);
      await invalidateWritingProfile(requireDatabase(env), user.id);
      const payload = await profilePayload(requireDatabase(env), user);
      return json({ ok: true, sample: created, ...payload }, 201);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (/unique|constraint/i.test(detail)) throw new HttpError(409, "Este texto já foi adicionado ao perfil.");
      if (/no máximo|até .* caracteres/i.test(detail)) throw new HttpError(409, detail);
      throw error;
    }
  }

  const writingSampleRoute = /^\/api\/profile\/samples\/([a-z0-9-]{8,80})$/i.exec(url.pathname);
  if (writingSampleRoute && request.method === "DELETE") {
    const { user } = await requireEditorialUser(request, env);
    const removed = await deleteWritingSample(requireDatabase(env), user.id, writingSampleRoute[1]);
    if (!removed) throw new HttpError(404, "Texto não encontrado neste perfil.");
    await invalidateWritingProfile(requireDatabase(env), user.id);
    return json({ ok: true, ...(await profilePayload(requireDatabase(env), user)) });
  }

  if (url.pathname === "/api/profile/carousel-learning" && request.method === "POST") {
    const { user } = await requireEditorialUser(request, env);
    const body = await request.json().catch(() => ({}));
    let example;
    try { example = normalizeCarouselLearningExample(body); }
    catch (error) { throw new HttpError(400, error.message); }
    const db = requireDatabase(env);
    const saved = await createCarouselLearningExample(db, user.id, example);
    return json({
      ok: true,
      learned: true,
      exampleCount: saved.count,
      updatedAt: saved.updatedAt,
      message: "Texto aprovado incorporado à memória editorial de estilo.",
    }, 201);
  }

  if (url.pathname === "/api/profile/style/rebuild" && request.method === "POST") {
    const { user } = await requireEditorialUser(request, env);
    const db = requireDatabase(env);
    const samples = await listWritingSamples(db, user.id);
    if (!samples.length) throw new HttpError(409, "Adicione pelo menos um texto antes de atualizar o perfil de escrita.");
    const profile = await analyzeWritingStyle(samples, {
      ai: articleAnalysisAi(env),
      model: env.STYLE_ANALYSIS_MODEL || env.ARTICLE_ANALYSIS_MODEL || ARTICLE_ANALYSIS_MODEL,
    });
    const saved = await saveWritingProfile(db, user.id, profile, samples.length);
    return json({ ok: true, writingProfile: publicWritingProfile(saved), ...(await profilePayload(db, user)) });
  }

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

  if (url.pathname === "/api/status" && request.method === "GET") {
    const db = requireDatabase(env);
    await expireStaleRuns(db).catch(() => null);
    const [latest, latestSuccess] = await Promise.all([
      getLatestRunSummary(db),
      getLatestRunSummary(db, { successOnly: true }),
    ]);
    const activeRun = freshActiveRun(latest);
    const running = Boolean(activeRun);
    let lastAttempt = null;
    if (latest && ["failed", "expired"].includes(latest.status)) {
      const storedAttempt = await getRunPayload(db, latest.id).catch(() => null);
      lastAttempt = {
        id: latest.id,
        status: latest.status,
        completedAt: latest.completedAt || latest.heartbeatAt || latest.startedAt || latest.queuedAt || null,
        error: latest.error || storedAttempt?.error || null,
        detail: storedAttempt?.payload?.detail || null,
        diagnostics: storedAttempt?.payload ? roundDiagnosticPayload(storedAttempt.payload) : null,
      };
    }
    const payload = {
      ok: true,
      ready: true,
      version: VERSION,
      running,
      activeRunId: activeRun?.id || null,
      activeRunStatus: activeRun?.status || null,
      activeRunQueuedAt: activeRun?.queuedAt || null,
      activeRunStartedAt: activeRun?.startedAt || null,
      lastRunId: latestSuccess?.id || null,
      lastSuccessAt: latestSuccess?.completedAt || null,
      lastAttempt,
      items: latestSuccess?.items || 0,
      topics: latestSuccess?.topics || 0,
      sources: latestSuccess?.sources || 0,
      schedulerHealthy: latestSuccess?.completedAt
        ? Date.now() - Date.parse(latestSuccess.completedAt) <= 12 * 60 * 1000
        : false,
    };
    return conditionalJson(request, payload, `${latest?.id || "none"}-${latest?.status || "idle"}-${latestSuccess?.id || "none"}`);
  }

  if (url.pathname === "/api/health" && request.method === "GET") {
    const db = requireDatabase(env);
    await expireStaleRuns(db).catch(() => null);
    const dbOk = await databaseHealth(db);
    const [latest, monitoringTerms, youtubeStatus] = await Promise.all([
      getLatestRunSummary(db, { successOnly: true }),
      listMonitoringTerms(db, { activeOnly: true }),
      youtubePublicStatus(requireYouTubeDatabase(env), env).catch((error) => ({
        configured: Boolean(env.YOUTUBE_API_KEY),
        queueReady: Boolean(env.YOUTUBE_JOBS_QUEUE?.send),
        status: "error",
        running: false,
        error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
        isolated: true,
      })),
    ]);
    const lastSuccessAt = latest?.completedAt ?? null;
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
      lastRunId: latest?.id ?? null,
      manualAuthRequired: Boolean(env.MANUAL_ROUND_TOKEN),
      backgroundMonitoring: {
        active: true,
        browserRequired: false,
        execution: env.ROUND_JOBS_QUEUE?.send ? "cloudflare-queue" : "cloudflare-cron",
        scheduleMinutes: 5,
        monitoringTerms: monitoringTerms.length,
        dedicatedResults: null,
        catalogPortals: FEEDS.length,
        catalogBrazil: FEEDS.filter((feed) => feed.region === "Brasil").length,
        catalogWorld: FEEDS.filter((feed) => feed.region === "Mundo").length,
      },
      youtube: {
        ...youtubeStatus,
        scheduleMinutes: 15,
        termRotationMinutes: 30,
        independentQueue: true,
        graphEnabled: false,
      },
      portalCollection: {
        strategy: "scheduled-official-feed-shared-fallback-persistent-cache",
        sharedFallbackQueries: true,
        sourceDomainMatching: true,
        lastKnownGoodCache: true,
        cacheWindowHours: 72,
        maxConcurrency: 5,
        staggeredIntervalsMinutes: [5, 15, 30],
        statusModes: ["direct", "fallback", "not-modified", "cache", "no-new", "blocked", "rate-limited", "timeout", "failed"],
      },
      editorialClassification: {
        specializedCategories: [
          "Fofoca e Celebridades",
          "Reality Shows",
          "Curiosidades e Ciência Pop",
          "Conteúdo Viral e Redes Sociais",
          "Luto e Obituário",
          "Segurança e Justiça",
        ],
        deathOutsideEntertainment: true,
        violentDeathCategory: "Segurança e Justiça",
        obituaryCategory: "Luto e Obituário",
      },
      translation: {
        ready: Boolean(translationAi(env)?.run),
        targetLanguage: "pt-BR",
        model: TRANSLATION_MODEL,
        strategy: "cached-title-first",
        maxNewTitlesPerRound: 18,
        concurrency: 3,
      },
      intelligentReading: {
        ready: true,
        aiReady: Boolean(articleAnalysisAi(env)?.run),
        mode: "publisher-article-required",
        asynchronousJobs: true,
        queueReady: Boolean(env.INTELLIGENT_JOBS_QUEUE?.send),
        deadLetterQueueConfigured: true,
        executionMode: env.INTELLIGENT_JOBS_QUEUE?.send ? "cloudflare-queue" : "request-fallback",
        articleLimit: 1,
        readingStrategy: "try-up-to-3-publisher-sources-with-history",
        cycleMode: "one-read-publisher-article-one-script",
        cycleFinalization: "terminal-and-released",
        nextCycleAfterTerminal: true,
        factPipeline: "source-evidence-extraction-then-redaction",
        factsGeneratedByAi: false,
        publisherArticleRequired: true,
        publisherAttemptsMax: 3,
        editorialQualityGate: true,
        articleReadCacheHours: 12,
        perSourceTimeoutSeconds: 7,
        readingConcurrency: 1,
        model: env.ARTICLE_ANALYSIS_MODEL || ARTICLE_ANALYSIS_MODEL,
      },
    });
  }


  if (url.pathname === "/api/sources/diagnostics" && request.method === "GET") {
    const activeSourceIds = new Set(FEEDS.map((feed) => feed.id));
    const diagnostics = (await listSourceDiagnostics(requireDatabase(env)))
      .filter((item) => activeSourceIds.has(item.sourceId));
    const updatedAt = diagnostics.reduce((latest, item) => item.updatedAt > latest ? item.updatedAt : latest, "");
    return conditionalJson(request, { ok: true, diagnostics }, `sources-${updatedAt || "empty"}`);
  }


  if (url.pathname === "/api/newsroom" && request.method === "GET") {
    const db = requireDatabase(env);
    const [stories, handoff] = await Promise.all([
      listNewsroomStories(db, { limit: 100 }),
      getNewsroomHandoff(db, { hours: Number(url.searchParams.get("hours")) || 8 }),
    ]);
    return json({ ok: true, stories, handoff });
  }

  const newsroomStoryRoute = /^\/api\/newsroom\/stories\/([a-z0-9-]{6,120})$/i.exec(url.pathname);
  if (newsroomStoryRoute && request.method === "GET") {
    const story = await getNewsroomStory(requireDatabase(env), newsroomStoryRoute[1]);
    if (!story) throw new HttpError(404, "Pauta não encontrada.");
    return json({ ok: true, story });
  }
  if (newsroomStoryRoute && request.method === "PATCH") {
    const { user } = await requireEditorialUser(request, env);
    const body = await readJsonBody(request);
    const story = await updateNewsroomStory(requireDatabase(env), newsroomStoryRoute[1], body || {}, user.id);
    if (!story) throw new HttpError(404, "Pauta não encontrada.");
    return json({ ok: true, story });
  }
  const newsroomNoteRoute = /^\/api\/newsroom\/stories\/([a-z0-9-]{6,120})\/notes$/i.exec(url.pathname);
  if (newsroomNoteRoute && request.method === "POST") {
    const { user } = await requireEditorialUser(request, env);
    const body = await readJsonBody(request);
    return json({ ok: true, story: await addNewsroomStoryNote(requireDatabase(env), newsroomNoteRoute[1], user.id, body?.note) });
  }
  const newsroomFollowRoute = /^\/api\/newsroom\/stories\/([a-z0-9-]{6,120})\/follow$/i.exec(url.pathname);
  if (newsroomFollowRoute && request.method === "POST") {
    const { user } = await requireEditorialUser(request, env);
    return json({ ok: true, ...(await toggleNewsroomStoryFollow(requireDatabase(env), newsroomFollowRoute[1], user.id)) });
  }

  if (url.pathname === "/api/youtube/channels" && request.method === "GET") {
    return json({ ok: true, channels: await listYouTubeCuratedChannels(requireYouTubeDatabase(env)), limit: 30 });
  }
  if (url.pathname === "/api/youtube/channels" && request.method === "POST") {
    requireOperationAuth(request, env);
    const body = await readJsonBody(request);
    const resolved = await resolveYouTubeChannel({ apiKey: env.YOUTUBE_API_KEY, input: body?.input });
    const channel = await saveYouTubeCuratedChannel(requireYouTubeDatabase(env), resolved);
    return json({ ok: true, channel }, 201);
  }
  const youtubeChannelRoute = /^\/api\/youtube\/channels\/(UC[a-zA-Z0-9_-]{20,})$/i.exec(url.pathname);
  if (youtubeChannelRoute && request.method === "PATCH") {
    requireOperationAuth(request, env);
    const body = await readJsonBody(request);
    return json({ ok: true, channel: await setYouTubeCuratedChannelActive(requireYouTubeDatabase(env), youtubeChannelRoute[1], body?.active !== false) });
  }
  if (youtubeChannelRoute && request.method === "DELETE") {
    requireOperationAuth(request, env);
    return json({ ok: true, ...(await deleteYouTubeCuratedChannel(requireYouTubeDatabase(env), youtubeChannelRoute[1])) });
  }

  if (url.pathname === "/api/youtube/status" && request.method === "GET") {
    const db = requireYouTubeDatabase(env);
    const status = await youtubePublicStatus(db, env);
    return conditionalJson(request, { ok: true, status }, `youtube-status-${status.status}-${status.jobId || "none"}-${status.lastSuccessAt || "none"}`);
  }

  if (url.pathname === "/api/youtube/latest" && request.method === "GET") {
    const db = requireYouTubeDatabase(env);
    const [collection, termResults, status] = await Promise.all([
      getLatestYouTubeCollection(db),
      getLatestYouTubeTermResults(db, 12),
      youtubePublicStatus(db, env),
    ]);
    const newsCollection = status.curationActive ? collection : restrictYouTubeCollectionToNews(collection);
    const newsTermResults = termResults.map(restrictYouTubeTermResultToNews);
    return conditionalJson(request, {
      ok: true,
      collection: newsCollection,
      termResults: newsTermResults,
      status,
    }, `youtube-latest-${newsCollection?.id || "empty"}-${newsTermResults[0]?.id || "none"}-${status.status}-news-only`);
  }

  if (url.pathname === "/api/youtube/collect" && request.method === "POST") {
    requireOperationAuth(request, env);
    if (!env.YOUTUBE_API_KEY) throw new HttpError(503, "Chave da API do YouTube não configurada.", "Adicione o secret YOUTUBE_API_KEY ao Worker.");
    const db = requireYouTubeDatabase(env);
    const runtime = await getYouTubeRuntime(db);
    const active = activeYouTubeRuntime(runtime);
    if (active) return json({ ok: true, queued: true, reused: true, jobId: active.jobId, status: active.status }, 202);
    const throttle = await acquireLock(db, "youtube-manual-throttle", 60 * 1000);
    if (!throttle) throw new HttpError(429, "Aguarde um minuto antes de executar outra coleta do YouTube.");
    const jobId = crypto.randomUUID();
    const queuedAt = new Date().toISOString();
    const queued = {
      ...runtime,
      status: "queued",
      jobId,
      triggerType: "manual",
      queuedAt,
      startedAt: null,
      heartbeatAt: queuedAt,
      completedAt: null,
      error: null,
    };
    await setYouTubeStateValue(db, YOUTUBE_RUNTIME_STATE_KEY, queued);
    if (env.YOUTUBE_JOBS_QUEUE?.send) {
      try {
        await env.YOUTUBE_JOBS_QUEUE.send({ type: "youtube", jobId, triggerType: "manual", queuedAt, monitorTerm: false });
        structuredLog("youtube_enqueued", { jobId, triggerType: "manual" });
        return json({ ok: true, queued: true, jobId, status: "queued" }, 202);
      } catch (error) {
        await setYouTubeStateValue(db, YOUTUBE_RUNTIME_STATE_KEY, {
          ...queued,
          status: "failed",
          completedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        });
        throw new HttpError(503, "Fila do YouTube indisponível.", error instanceof Error ? error.message : String(error));
      }
    }
    const collection = await performYouTubeCollection(env, { type: "youtube", jobId, triggerType: "manual", queuedAt, monitorTerm: false });
    return json({ ok: true, queued: false, jobId, status: "success", collection });
  }

  if (url.pathname === "/api/monitoring-terms" && request.method === "GET") {
    const terms = await listMonitoringTerms(requireDatabase(env));
    return json({
      ok: true,
      terms,
      limits: {
        maximumActive: MAX_MONITORING_TERMS,
        active: terms.filter((term) => term.active).length,
      },
    });
  }

  if (url.pathname === "/api/monitoring-terms" && request.method === "POST") {
    requireOperationAuth(request, env);
    const body = await request.json().catch(() => ({}));
    const termValue = validatedMonitoringTerm(body);
    try {
      const term = await createMonitoringTerm(requireDatabase(env), termValue);
      return json({ ok: true, term }, 201);
    } catch (error) {
      throw new HttpError(409, error instanceof Error ? error.message : "Não foi possível cadastrar o termo.");
    }
  }

  const monitoringTermRoute = /^\/api\/monitoring-terms\/([a-z0-9-]{8,80})$/i.exec(url.pathname);
  if (monitoringTermRoute && request.method === "PATCH") {
    requireOperationAuth(request, env);
    const body = await request.json().catch(() => ({}));
    if (typeof body?.active !== "boolean") throw new HttpError(400, "Informe se o termo deve ficar ativo.");
    try {
      const term = await setMonitoringTermActive(requireDatabase(env), monitoringTermRoute[1], body.active);
      if (!term) throw new HttpError(404, "Termo de monitoramento não encontrado.");
      return json({ ok: true, term });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(409, error instanceof Error ? error.message : "Não foi possível atualizar o termo.");
    }
  }
  if (monitoringTermRoute && request.method === "DELETE") {
    requireOperationAuth(request, env);
    const term = await deleteMonitoringTerm(requireDatabase(env), monitoringTermRoute[1]);
    if (!term) throw new HttpError(404, "Termo de monitoramento não encontrado.");
    return json({ ok: true, deleted: term });
  }

  if (url.pathname === "/api/latest" && request.method === "GET") {
    const latest = await getLatestRound(requireDatabase(env));
    const data = withEditorias(latest);
    return conditionalJson(request, { ok: true, data }, `latest-${data?.runId || "empty"}`);
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

  const intelligentJobRoute = /^\/api\/intelligent-jobs\/([a-z0-9-]{16,80})$/i.exec(url.pathname);
  if (intelligentJobRoute && request.method === "GET") {
    const db = requireDatabase(env);
    let job = await getIntelligentJob(db, intelligentJobRoute[1]);
    if (!job) throw new HttpError(404, "Processamento não encontrado ou expirado.");
    if (job.stale && ["queued", "running"].includes(job.status)) {
      job = await updateIntelligentJob(db, {
        jobId: job.jobId,
        status: "failed",
        progress: 100,
        message: "O processamento foi interrompido e pode ser reiniciado.",
        error: `A tarefa ficou sem atualização por mais de ${INTELLIGENT_JOB_STALE_LABEL}.`,
      });
    }
    return json({
      ok: true,
      job: publicIntelligentJob(job),
      ...(job.status === "succeeded" && job.payload ? { data: job.payload } : {}),
    });
  }

  const intelligentCarouselRoute = /^\/api\/topics\/([a-z0-9-]{6,100})\/intelligent-carousel$/i.exec(url.pathname);
  if (intelligentCarouselRoute && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const db = requireDatabase(env);
    const user = await optionalEditorialUser(request, env);
    if (!user && env.MANUAL_ROUND_TOKEN && !secureEqual(request.headers.get("X-Round-Token"), env.MANUAL_ROUND_TOKEN)) {
      throw new HttpError(401, "Entre no perfil editorial ou informe a chave de operação para usar a leitura inteligente.");
    }
    let slideCount;
    try { slideCount = validateSlideCount(body?.slideCount ?? user?.defaultSlideCount ?? DEFAULT_SLIDE_COUNT); }
    catch (error) { throw new HttpError(400, error.message); }
    const writingProfile = user ? await getWritingProfile(db, user.id) : null;
    const learningStats = user ? await getCarouselLearningStats(db, user.id) : { count: 0, updatedAt: null };
    const styleKey = user
      ? `${user.id}:${writingProfile?.updatedAt || "default"}:${learningStats.updatedAt || "no-learning"}:${learningStats.count}`
      : "default";
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
    const cacheKey = intelligentCarouselCacheKey(runId, topic, { slideCount, styleKey });
    if (!body?.force) {
      const cached = await getIntelligentCarousel(db, cacheKey);
      if (cached) return json({ ok: true, cached: true, status: "succeeded", data: cached });
    }

    const queued = await createIntelligentJob(db, {
      cacheKey,
      runId,
      topicId,
      replaceCompleted: Boolean(body?.force),
    });
    if (queued.job.status === "succeeded" && queued.job.payload) {
      return json({ ok: true, cached: true, status: "succeeded", data: queued.job.payload });
    }
    if (queued.created) {
      if (env.INTELLIGENT_JOBS_QUEUE?.send) {
        try {
          await env.INTELLIGENT_JOBS_QUEUE.send({
            type: "intelligent",
            jobId: queued.job.jobId,
            runId: queued.job.runId,
            topicId: queued.job.topicId,
            slideCount,
            userId: user?.id || null,
            writingProfile,
            styleKey,
          });
          queued.job = await updateIntelligentJob(db, {
            jobId: queued.job.jobId,
            status: "queued",
            progress: 2,
            message: "Leitura enviada para processamento seguro.",
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          await updateIntelligentJob(db, {
            jobId: queued.job.jobId,
            status: "failed",
            progress: 100,
            message: "Não foi possível enviar a leitura para a fila.",
            error: detail,
          });
          throw new HttpError(503, "Fila de leitura indisponível.", detail);
        }
      } else {
        const data = await processIntelligentCarouselJob(env, queued.job, topic, { slideCount, writingProfile, styleKey, userId: user?.id || null });
        if (data) return json({ ok: true, cached: false, status: "succeeded", data });
        throw new HttpError(503, "A leitura inteligente não foi concluída.", "Configure o binding INTELLIGENT_JOBS_QUEUE para processamento assíncrono estável.");
      }
    }
    return json({
      ok: true,
      queued: true,
      status: queued.job.status,
      job: publicIntelligentJob(queued.job),
      pollAfterMs: 900,
      configuration: { slideCount, profileApplied: Boolean(writingProfile), profileUpdatedAt: writingProfile?.updatedAt || null, adaptiveMemoryCount: learningStats.count },
    }, 202);
  }

  if (url.pathname === "/api/round" && request.method === "POST") {
    if (env.MANUAL_ROUND_TOKEN && !secureEqual(request.headers.get("X-Round-Token"), env.MANUAL_ROUND_TOKEN)) {
      throw new HttpError(401, "Chave de operação inválida.");
    }
    const db = requireDatabase(env);
    await expireStaleRuns(db).catch(() => null);
    const activeRun = freshActiveRun(await getLatestRunSummary(db).catch(() => null));
    if (activeRun) {
      return json({ ok: true, queued: true, reused: true, runId: activeRun.id, status: activeRun.status }, 202);
    }
    const throttle = await acquireLock(db, "manual-throttle", 60 * 1000);
    if (!throttle) throw new HttpError(429, "Aguarde um minuto antes de executar outra ronda manual.");
    const runId = crypto.randomUUID();
    const queuedAt = new Date().toISOString();
    await queueRun(db, { id: runId, triggerType: "manual", queuedAt });

    if (env.ROUND_JOBS_QUEUE?.send) {
      try {
        await env.ROUND_JOBS_QUEUE.send({ type: "round", runId, triggerType: "manual", queuedAt });
        structuredLog("round_enqueued", { runId, triggerType: "manual" });
        return json({ ok: true, queued: true, runId, status: "queued" }, 202);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await saveRun(db, {
          id: runId,
          triggerType: "manual",
          startedAt: queuedAt,
          payload: {
            ok: false,
            collectedAt: new Date().toISOString(),
            error: "Não foi possível enviar a ronda para a fila.",
            detail,
            sources: [],
            totals: { items: 0, topics: 0, sources: 0, socialItems: 0, dedicatedItems: 0 },
            items: [],
            topics: [],
          },
        });
        throw new HttpError(503, "Fila de rondas indisponível.", detail);
      }
    }

    const startedAt = new Date().toISOString();
    await markRunStarted(db, { id: runId, triggerType: "manual", queuedAt, startedAt });
    const data = await performRound(env, "manual", { runId, startedAt, runStarted: true });
    return json({ ok: true, queued: false, runId, status: "success", data });
  }

  throw new HttpError(404, "Rota não encontrada.");
}

async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: SECURITY_HEADERS });
  if (url.pathname.startsWith("/api/")) return handleApi(request, env, url, ctx);
  if (request.method !== "GET" && request.method !== "HEAD") throw new HttpError(405, "Método não permitido.");
  if (url.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /api/\n", { headers: { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
  if (env.ASSETS?.fetch) return env.ASSETS.fetch(request);
  return json({ ok: false, error: "Página não encontrada." }, 404);
}

export { handleRequest, performRound, processIntelligentCarouselJob, processIntelligentQueueBatch, processQueueBatch, selfTest, withEditorias };

export default {
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

  async queue(batch, env) {
    await processQueueBatch(batch, env);
  },

  async scheduled(controller, env, ctx) {
    const scheduledTime = Number(controller?.scheduledTime) || Date.now();
    const scheduledDate = new Date(scheduledTime);
    const minute = scheduledDate.getUTCMinutes();

    const roundTask = async () => {
      const runId = crypto.randomUUID();
      const queuedAt = new Date().toISOString();
      const db = requireDatabase(env);
      await expireStaleRuns(db).catch(() => null);
      const activeRun = freshActiveRun(await getLatestRunSummary(db).catch(() => null));
      if (activeRun) {
        structuredLog("scheduled_round_skipped", { activeRunId: activeRun.id, activeRunStartedAt: activeRun.startedAt });
        return;
      }
      await queueRun(db, { id: runId, triggerType: "scheduled", queuedAt });
      if (env.ROUND_JOBS_QUEUE?.send) {
        await env.ROUND_JOBS_QUEUE.send({ type: "round", runId, triggerType: "scheduled", queuedAt });
        structuredLog("round_enqueued", { runId, triggerType: "scheduled" });
        return;
      }
      const startedAt = new Date().toISOString();
      await markRunStarted(db, { id: runId, triggerType: "scheduled", queuedAt, startedAt });
      await performRound(env, "scheduled", { runId, startedAt, runStarted: true });
    };

    const youtubeTask = async () => {
      if (minute % 15 !== 0) return;
      if (!env.YOUTUBE_API_KEY) {
        structuredLog("youtube_scheduled_skipped", { reason: "missing_api_key" });
        return;
      }
      const db = requireYouTubeDatabase(env);
      const runtime = await getYouTubeRuntime(db);
      if (activeYouTubeRuntime(runtime)) {
        structuredLog("youtube_scheduled_skipped", { reason: "active_job", jobId: runtime.jobId });
        return;
      }
      const blockedMs = Date.parse(runtime.blockedUntil || "");
      if (Number.isFinite(blockedMs) && blockedMs > Date.now()) {
        structuredLog("youtube_scheduled_skipped", { reason: "circuit_open", blockedUntil: runtime.blockedUntil });
        return;
      }
      const jobId = crypto.randomUUID();
      const queuedAt = new Date().toISOString();
      await setYouTubeStateValue(db, YOUTUBE_RUNTIME_STATE_KEY, {
        ...runtime,
        status: "queued",
        jobId,
        triggerType: "scheduled",
        queuedAt,
        startedAt: null,
        heartbeatAt: queuedAt,
        completedAt: null,
        error: null,
      });
      const monitorTerm = minute % 30 === 0;
      if (env.YOUTUBE_JOBS_QUEUE?.send) {
        await env.YOUTUBE_JOBS_QUEUE.send({ type: "youtube", jobId, triggerType: "scheduled", queuedAt, monitorTerm });
        structuredLog("youtube_enqueued", { jobId, triggerType: "scheduled", monitorTerm });
        return;
      }
      await performYouTubeCollection(env, { type: "youtube", jobId, triggerType: "scheduled", queuedAt, monitorTerm });
    };

    const task = Promise.allSettled([roundTask(), youtubeTask()]).then((results) => {
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          structuredLog(index === 0 ? "scheduled_round_failed" : "scheduled_youtube_failed", {
            detail: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
        }
      });
    });
    ctx.waitUntil(task);
  },
};
