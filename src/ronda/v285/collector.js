import { buildTopics, clusterItems, titleTokens } from "./clustering.js";
import { parseFeed, plainText, stableHash } from "./parser.js";

const HIGH_FREQUENCY_SOURCES = new Set([
  "g1", "cnn-brasil", "folha", "estadao", "o-globo", "poder360",
  "agencia-brasil", "ge", "metropoles", "bbc", "guardian", "cnn",
]);

const MEDIUM_FREQUENCY_SOURCES = new Set([
  "veja", "nexo", "infomoney", "money-times", "canaltech", "tecmundo",
  "o-liberal", "campo-grande-news", "uol-splash", "leo-dias", "quem",
  "caras-brasil", "observatorio-dos-famosos", "area-vip", "natelinha",
  "new-york-times", "washington-post", "al-jazeera", "france-24", "deutsche-welle",
]);

function sourceRefreshMinutes(id) {
  if (HIGH_FREQUENCY_SOURCES.has(id)) return 5;
  if (MEDIUM_FREQUENCY_SOURCES.has(id)) return 15;
  return 30;
}

export async function runPool(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  const output = new Array(list.length);
  let cursor = 0;
  async function consume() {
    while (cursor < list.length) {
      const index = cursor++;
      output[index] = await worker(list[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, Number(concurrency) || 1), list.length) }, consume));
  return output;
}

function googleLocale(region = "Brasil") {
  return region === "Brasil"
    ? { hl: "pt-BR", gl: "BR", ceid: "BR:pt-419" }
    : { hl: "en-US", gl: "US", ceid: "US:en" };
}

function googleNewsQuerySource(query, region = "Brasil") {
  const locale = googleLocale(region);
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${locale.hl}&gl=${locale.gl}&ceid=${encodeURIComponent(locale.ceid)}`;
}

function googleNewsSource(source, region = "Brasil") {
  return googleNewsQuerySource(`when:2d source:${String(source || "").replace(/\s+/g, "_")}`, region);
}

function normalizedSite(value) {
  try {
    return new URL(/^https?:\/\//i.test(String(value || "")) ? String(value) : `https://${String(value || "")}`)
      .hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return String(value || "")
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0]
      .toLowerCase();
  }
}

function googleNewsSiteSource(value, region = "Brasil", extraQuery = "", windowDays = 2) {
  const hostname = normalizedSite(value);
  const days = Math.min(30, Math.max(1, Math.round(Number(windowDays) || 2)));
  const query = [`when:${days}d`, hostname ? `site:${hostname}` : "", plainText(extraQuery)].filter(Boolean).join(" ");
  return googleNewsQuerySource(query, region);
}

function googleNewsSitesSource(sites = [], region = "Brasil", extraQuery = "") {
  const clauses = [...new Set((Array.isArray(sites) ? sites : []).map(normalizedSite).filter(Boolean))]
    .map((site) => `site:${site}`);
  const siteQuery = clauses.length > 1 ? `(${clauses.join(" OR ")})` : clauses[0] || "";
  return googleNewsQuerySource(["when:2d", siteQuery, plainText(extraQuery)].filter(Boolean).join(" "), region);
}

function googleNewsTermSource(term) {
  return googleNewsQuerySource(`when:1d "${plainText(term).replace(/"/g, "")}"`, "Brasil");
}


function portalFeed(id, name, region, { primaryUrl = null, fallbackUrl = null, sourceAliases = [], sourceDomains = [], editorialHints = [], limit = null, scanLimit = 240, emptyIsHealthy = false, refreshMinutes = null } = {}) {
  return Object.freeze({
    id,
    name,
    region,
    canonicalSource: true,
    directUrl: primaryUrl || null,
    limit: limit || (region === "Mundo" ? 8 : 15),
    scanLimit,
    emptyIsHealthy: Boolean(emptyIsHealthy),
    refreshMinutes: Math.max(5, Number(refreshMinutes) || sourceRefreshMinutes(id)),
    sourceAliases: Object.freeze(sourceAliases),
    sourceDomains: Object.freeze(sourceDomains.map(normalizedSite).filter(Boolean)),
    editorialHints: Object.freeze(editorialHints),
    urls: Object.freeze([primaryUrl, fallbackUrl].filter(Boolean)),
  });
}

function sharedGooglePortalFeed(id, name, searchUrl, sourceAliases, sourceDomains, editorialHints = []) {
  return portalFeed(id, name, "Brasil", {
    fallbackUrl: searchUrl,
    sourceAliases,
    sourceDomains,
    editorialHints,
    scanLimit: 500,
  });
}

const CORE_BRASIL_DOMAINS = Object.freeze([
  "g1.globo.com", "cnnbrasil.com.br", "folha.uol.com.br", "estadao.com.br", "oglobo.globo.com",
  "veja.abril.com.br", "poder360.com.br", "agenciabrasil.ebc.com.br", "nexojornal.com.br",
  "infomoney.com.br", "moneytimes.com.br", "ge.globo.com", "canaltech.com.br", "tecmundo.com.br",
  "oliberal.com", "metropoles.com", "campograndenews.com.br",
]);
const CORE_BRASIL_FALLBACK = googleNewsSitesSource(CORE_BRASIL_DOMAINS, "Brasil");

const WORLD_DOMAINS = Object.freeze([
  "bbc.com", "theguardian.com", "cnn.com", "nytimes.com", "washingtonpost.com", "aljazeera.com",
  "france24.com", "dw.com", "elpais.com", "euronews.com", "cbc.ca", "abc.net.au", "infobae.com",
]);
const WORLD_FALLBACK = googleNewsSitesSource(WORLD_DOMAINS, "Mundo");

const ENTERTAINMENT_DOMAINS = Object.freeze([
  "portalleodias.com", "revistaquem.globo.com", "caras.com.br", "otvfoco.com.br",
  "purepeople.com.br", "areavip.com.br",
]);
const ENTERTAINMENT_PORTALS_SEARCH = googleNewsSitesSource(ENTERTAINMENT_DOMAINS, "Brasil");
const SPLASH_SEARCH = googleNewsSiteSource("uol.com.br", "Brasil", 'Splash entretenimento celebridades BBB');
const OBSERVATORIO_SEARCH = googleNewsSiteSource("jc.uol.com.br", "Brasil", '"Observatório dos Famosos"', 7);
const NATELINHA_SEARCH = googleNewsSiteSource("natelinha.uol.com.br", "Brasil");



export const FEEDS = Object.freeze([
  // Brasil — portais gerais. O segundo endereço é um fallback agregado e compartilhado.
  portalFeed("g1", "G1", "Brasil", { primaryUrl: "https://g1.globo.com/rss/g1/", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["G1"], sourceDomains: ["g1.globo.com"] }),
  portalFeed("cnn-brasil", "CNN Brasil", "Brasil", { primaryUrl: "https://www.cnnbrasil.com.br/feed/", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["CNN Brasil"], sourceDomains: ["cnnbrasil.com.br"] }),
  portalFeed("folha", "Folha de S.Paulo", "Brasil", { primaryUrl: "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Folha de S.Paulo", "Folha"], sourceDomains: ["folha.uol.com.br"] }),
  portalFeed("estadao", "Estadão", "Brasil", { fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Estadão", "O Estado de S. Paulo"], sourceDomains: ["estadao.com.br"] }),
  portalFeed("o-globo", "O Globo", "Brasil", { primaryUrl: "https://oglobo.globo.com/rss.xml", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["O Globo"], sourceDomains: ["oglobo.globo.com"] }),
  portalFeed("veja", "Veja", "Brasil", { primaryUrl: "https://veja.abril.com.br/feed/", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Veja"], sourceDomains: ["veja.abril.com.br"] }),
  portalFeed("poder360", "Poder360", "Brasil", { primaryUrl: "https://www.poder360.com.br/feed/", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Poder360"], sourceDomains: ["poder360.com.br"] }),
  portalFeed("agencia-brasil", "Agência Brasil", "Brasil", { primaryUrl: "https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Agência Brasil"], sourceDomains: ["agenciabrasil.ebc.com.br"] }),
  portalFeed("nexo", "Nexo Jornal", "Brasil", { fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Nexo Jornal", "Nexo"], sourceDomains: ["nexojornal.com.br"] }),
  portalFeed("infomoney", "InfoMoney", "Brasil", { primaryUrl: "https://www.infomoney.com.br/feed/", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["InfoMoney"], sourceDomains: ["infomoney.com.br"] }),
  portalFeed("money-times", "Money Times", "Brasil", { primaryUrl: "https://www.moneytimes.com.br/feed/", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Money Times"], sourceDomains: ["moneytimes.com.br"] }),
  portalFeed("ge", "ge", "Brasil", { primaryUrl: "https://ge.globo.com/rss/ge/", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["ge", "Globo Esporte"], sourceDomains: ["ge.globo.com"] }),
  portalFeed("canaltech", "Canaltech", "Brasil", { primaryUrl: "https://feeds2.feedburner.com/canaltechbr", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Canaltech"], sourceDomains: ["canaltech.com.br"] }),
  portalFeed("tecmundo", "TecMundo", "Brasil", { primaryUrl: "https://www.tecmundo.com.br/rss", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["TecMundo"], sourceDomains: ["tecmundo.com.br"] }),
  portalFeed("o-liberal", "O Liberal", "Brasil", { primaryUrl: "https://www.oliberal.com/rss", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["O Liberal"], sourceDomains: ["oliberal.com"] }),
  portalFeed("metropoles", "Metrópoles", "Brasil", { primaryUrl: "https://www.metropoles.com/feed", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Metrópoles", "Metropoles"], sourceDomains: ["metropoles.com"] }),
  portalFeed("campo-grande-news", "Campo Grande News", "Brasil", { primaryUrl: "https://www.campograndenews.com.br/rss", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Campo Grande News"], sourceDomains: ["campograndenews.com.br"] }),

  // Brasil — entretenimento, celebridades e realities.
  sharedGooglePortalFeed("uol-splash", "UOL Splash", SPLASH_SEARCH, ["UOL", "UOL Splash", "Splash"], ["uol.com.br"], ["Fofoca e Celebridades", "Reality Shows", "Entretenimento"]),
  sharedGooglePortalFeed("leo-dias", "LeoDias", ENTERTAINMENT_PORTALS_SEARCH, ["LeoDias", "Portal LeoDias", "Leo Dias"], ["portalleodias.com"], ["Fofoca e Celebridades"]),
  sharedGooglePortalFeed("quem", "Quem", ENTERTAINMENT_PORTALS_SEARCH, ["Quem", "Revista Quem"], ["revistaquem.globo.com"], ["Fofoca e Celebridades"]),
  sharedGooglePortalFeed("caras-brasil", "Caras Brasil", ENTERTAINMENT_PORTALS_SEARCH, ["Caras Brasil", "CARAS Brasil", "Caras"], ["caras.com.br"], ["Fofoca e Celebridades"]),
  sharedGooglePortalFeed("tv-foco", "TV Foco", ENTERTAINMENT_PORTALS_SEARCH, ["TV Foco", "O TV Foco", "TVFoco"], ["otvfoco.com.br"], ["Entretenimento", "Reality Shows"]),
  sharedGooglePortalFeed("purepeople-brasil", "Purepeople Brasil", ENTERTAINMENT_PORTALS_SEARCH, ["Purepeople Brasil", "Purepeople"], ["purepeople.com.br"], ["Fofoca e Celebridades"]),
  portalFeed("observatorio-dos-famosos", "Observatório dos Famosos", "Brasil", { fallbackUrl: OBSERVATORIO_SEARCH, sourceAliases: ["Observatório dos Famosos", "Observatorio dos Famosos"], sourceDomains: ["jc.uol.com.br"], editorialHints: ["Fofoca e Celebridades"], scanLimit: 240, emptyIsHealthy: true }),
  sharedGooglePortalFeed("area-vip", "Área VIP", ENTERTAINMENT_PORTALS_SEARCH, ["Área VIP", "Area VIP", "Área Vip"], ["areavip.com.br"], ["Reality Shows", "Fofoca e Celebridades"]),
  sharedGooglePortalFeed("natelinha", "NaTelinha", NATELINHA_SEARCH, ["NaTelinha", "Na Telinha", "UOL"], ["natelinha.uol.com.br"], ["Reality Shows", "Entretenimento"]),

  // Mundo — feeds oficiais com fallback agregado por domínio.
  portalFeed("bbc", "BBC News", "Mundo", { primaryUrl: "https://feeds.bbci.co.uk/news/world/rss.xml", fallbackUrl: WORLD_FALLBACK, sourceAliases: ["BBC", "BBC News"], sourceDomains: ["bbc.com"] }),
  portalFeed("guardian", "The Guardian", "Mundo", { primaryUrl: "https://www.theguardian.com/world/rss", fallbackUrl: WORLD_FALLBACK, sourceAliases: ["The Guardian", "Guardian"], sourceDomains: ["theguardian.com"] }),
  portalFeed("cnn", "CNN", "Mundo", { primaryUrl: "https://rss.cnn.com/rss/edition_world.rss", fallbackUrl: WORLD_FALLBACK, sourceAliases: ["CNN"], sourceDomains: ["cnn.com"] }),
  portalFeed("new-york-times", "The New York Times", "Mundo", { primaryUrl: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", fallbackUrl: WORLD_FALLBACK, sourceAliases: ["The New York Times", "New York Times"], sourceDomains: ["nytimes.com"] }),
  portalFeed("washington-post", "The Washington Post", "Mundo", { primaryUrl: "https://feeds.washingtonpost.com/rss/world", fallbackUrl: WORLD_FALLBACK, sourceAliases: ["The Washington Post", "Washington Post"], sourceDomains: ["washingtonpost.com"] }),
  portalFeed("al-jazeera", "Al Jazeera", "Mundo", { primaryUrl: "https://www.aljazeera.com/xml/rss/all.xml", fallbackUrl: WORLD_FALLBACK, sourceAliases: ["Al Jazeera"], sourceDomains: ["aljazeera.com"] }),
  portalFeed("france-24", "France 24", "Mundo", { primaryUrl: "https://www.france24.com/en/rss", fallbackUrl: WORLD_FALLBACK, sourceAliases: ["France 24"], sourceDomains: ["france24.com"] }),
  portalFeed("deutsche-welle", "Deutsche Welle", "Mundo", { primaryUrl: "https://rss.dw.com/rdf/rss-en-world", fallbackUrl: WORLD_FALLBACK, sourceAliases: ["Deutsche Welle", "DW"], sourceDomains: ["dw.com"] }),
  portalFeed("el-pais", "El País", "Mundo", { primaryUrl: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada", fallbackUrl: WORLD_FALLBACK, sourceAliases: ["El País", "EL PAÍS"], sourceDomains: ["elpais.com"] }),
  portalFeed("euronews", "Euronews", "Mundo", { primaryUrl: "https://www.euronews.com/rss?format=mrss&level=theme&name=news", fallbackUrl: WORLD_FALLBACK, sourceAliases: ["Euronews"], sourceDomains: ["euronews.com"] }),
  portalFeed("cbc", "CBC News", "Mundo", { primaryUrl: "https://www.cbc.ca/cmlink/rss-world", fallbackUrl: WORLD_FALLBACK, sourceAliases: ["CBC", "CBC News"], sourceDomains: ["cbc.ca"] }),
  portalFeed("abc-australia", "ABC News Australia", "Mundo", { primaryUrl: "https://www.abc.net.au/news/feed/51120/rss.xml", fallbackUrl: WORLD_FALLBACK, sourceAliases: ["ABC News", "ABC News Australia"], sourceDomains: ["abc.net.au"] }),
  portalFeed("infobae", "Infobae", "Mundo", { primaryUrl: "https://www.infobae.com/arc/outboundfeeds/rss/?outputType=xml", fallbackUrl: WORLD_FALLBACK, sourceAliases: ["Infobae"], sourceDomains: ["infobae.com"] }),
]);

export const FEED_COUNTS = Object.freeze({
  Brasil: FEEDS.filter((item) => item.region === "Brasil").length,
  Mundo: FEEDS.filter((item) => item.region === "Mundo").length,
  total: FEEDS.length,
});

const PORTAL_SUBREQUEST_LIMIT = 35;
const TERM_SUBREQUEST_LIMIT = 6;

function compactError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "Erro desconhecido");
  return message.replace(/\s+/g, " ").trim().slice(0, 150);
}

const RESPONSE_TIMINGS = new WeakMap();

class SourceFetchError extends Error {
  constructor(message, { code = "unknown", httpStatus = null, retryable = false } = {}) {
    super(message);
    this.name = "SourceFetchError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

function classifyHttpStatus(status) {
  if (status === 403) return { code: "blocked", retryable: false };
  if (status === 404) return { code: "not-found", retryable: false };
  if (status === 429) return { code: "rate-limited", retryable: true };
  if (status >= 500) return { code: "upstream-error", retryable: true };
  return { code: "http-error", retryable: false };
}

function errorDiagnostic(error) {
  if (error instanceof SourceFetchError) {
    return {
      code: error.code,
      httpStatus: error.httpStatus,
      retryable: error.retryable,
      detail: compactError(error),
    };
  }
  const message = compactError(error);
  if (/tempo limite|timeout|aborted|abort/i.test(message)) return { code: "timeout", httpStatus: null, retryable: true, detail: message };
  if (/xml|feed|parse|conteúdo/i.test(message)) return { code: "invalid-feed", httpStatus: null, retryable: false, detail: message };
  return { code: "unknown", httpStatus: null, retryable: false, detail: message };
}

function sharedResponseFetcher(fetcher) {
  const pending = new Map();
  return async (url, options = {}) => {
    const headers = new Headers(options?.headers || {});
    const key = `${String(options?.method || "GET").toUpperCase()} ${String(url)} ${headers.get("If-None-Match") || ""} ${headers.get("If-Modified-Since") || ""}`;
    if (!pending.has(key)) {
      pending.set(key, (async () => {
        const response = await fetcher(url, options);
        const body = new Uint8Array(await response.arrayBuffer());
        return {
          body,
          status: response.status,
          statusText: response.statusText,
          headers: [...response.headers.entries()],
          responseMs: Number(RESPONSE_TIMINGS.get(response)) || null,
        };
      })());
    }
    const snapshot = await pending.get(key);
    const cloned = new Response(snapshot.body.slice(), {
      status: snapshot.status,
      statusText: snapshot.statusText,
      headers: snapshot.headers,
    });
    if (snapshot.responseMs != null) RESPONSE_TIMINGS.set(cloned, snapshot.responseMs);
    return cloned;
  };
}

function reserveExternalRequest(requestBudget, url) {
  if (!requestBudget) return;
  requestBudget.seenUrls ||= new Set();
  const key = String(url);
  if (requestBudget.seenUrls.has(key)) return;
  if (requestBudget.remaining <= 0) throw new SourceFetchError("Limite seguro de consultas externas atingido", { code: "budget-exhausted" });
  requestBudget.seenUrls.add(key);
  requestBudget.remaining -= 1;
  requestBudget.used = (requestBudget.used || 0) + 1;
}

async function fetchWithTimeout(url, fetcher, { accept, timeoutMs = 8_000, validator = null } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("Tempo limite excedido"), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetcher(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: accept ?? "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.7",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5",
        "User-Agent": "RondaEditorial/2.5 (+coletor editorial automatizado)",
        ...(validator?.etag ? { "If-None-Match": validator.etag } : {}),
        ...(validator?.lastModified ? { "If-Modified-Since": validator.lastModified } : {}),
      },
    });
    RESPONSE_TIMINGS.set(response, Date.now() - startedAt);
    if (response.status === 304) return response;
    if (!response.ok) {
      const classification = classifyHttpStatus(response.status);
      throw new SourceFetchError(`HTTP ${response.status}`, { ...classification, httpStatus: response.status });
    }
    return response;
  } catch (error) {
    if (error instanceof SourceFetchError) throw error;
    const message = compactError(error);
    if (controller.signal.aborted || /abort|tempo limite/i.test(message)) {
      throw new SourceFetchError("Tempo limite excedido", { code: "timeout", retryable: true });
    }
    throw error;
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

export async function decodeFeedResponse(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get("Content-Type") || "";
  const headerCharset = /charset\s*=\s*([^;\s]+)/i.exec(contentType)?.[1];
  const declarationSample = new TextDecoder("windows-1252").decode(bytes.slice(0, 300));
  const declarationCharset = /<\?xml[^>]+encoding\s*=\s*["']([^"']+)["']/i.exec(declarationSample)?.[1];
  return new TextDecoder(normalizeCharset(headerCharset || declarationCharset)).decode(bytes);
}

function cachedItemsFromState(sourceState, feed, cutoff, maxAgeHours = 72) {
  const referenceTime = cutoff.getTime() + 24 * 60 * 60 * 1000;
  const minimum = Math.max(cutoff.getTime(), referenceTime - Math.max(24, Number(maxAgeHours) || 72) * 60 * 60 * 1000);
  return uniqueItems((Array.isArray(sourceState?.items) ? sourceState.items : [])
    .filter((item) => {
      const timestamp = Date.parse(item?.publishedAt);
      return Number.isFinite(timestamp) && timestamp >= minimum;
    })
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
    .slice(0, Number(feed.limit) || 15)
    .map((item) => ({ ...item, collectionRoute: "cache", collectorName: feed.name, sourceName: feed.name })), Number(feed.limit) || 15);
}

function validatorSnapshot(response) {
  return {
    etag: response.headers.get("ETag") || null,
    lastModified: response.headers.get("Last-Modified") || null,
  };
}

export async function collectFeed(feed, cutoff, fetcher = fetch, requestBudget = null, sourceState = null) {
  const errors = [];
  let successfulResponses = 0;
  const effectiveCutoff = cutoff;
  const windowHours = 24;
  const validators = { ...(sourceState?.validators || {}) };
  let totalResponseMs = 0;
  for (let index = 0; index < feed.urls.length; index += 1) {
    const url = feed.urls[index];
    try {
      reserveExternalRequest(requestBudget, url);
      const response = await fetchWithTimeout(url, fetcher, { validator: validators[url] });
      totalResponseMs += Number(RESPONSE_TIMINGS.get(response)) || 0;
      const direct = Boolean(feed.directUrl) && String(url) === String(feed.directUrl);
      if (response.status === 304) {
        if (sourceState?.lastUrl === url) {
          const cached = cachedItemsFromState(sourceState, feed, cutoff);
          return {
            items: cached,
            status: {
              id: feed.id,
              name: feed.name,
              region: feed.region || "Brasil",
              ok: true,
              count: cached.length,
              error: null,
              warning: null,
              fallback: !direct,
              cached: true,
              route: "not-modified",
              attempts: index + 1,
              windowHours,
              httpStatus: 304,
              errorCode: null,
              responseMs: totalResponseMs,
              lastUrl: url,
            },
            operational: { validators, lastUrl: url },
          };
        }
        continue;
      }
      successfulResponses += 1;
      validators[url] = validatorSnapshot(response);
      const xml = await decodeFeedResponse(response);
      const parseConfiguration = direct ? { ...feed, sourceAliases: [], sourceDomains: [] } : feed;
      const items = parseFeed(xml, parseConfiguration, effectiveCutoff, Number(feed.limit) || 15);
      if (!items.length) {
        errors.push({ code: "no-new", httpStatus: response.status, retryable: false, detail: `Sem conteúdo válido nas últimas ${windowHours} horas` });
        continue;
      }
      return {
        items: items.map((item) => ({ ...item, collectionRoute: direct ? "direct" : "fallback" })),
        status: {
          id: feed.id,
          name: feed.name,
          region: feed.region || "Brasil",
          ok: true,
          count: items.length,
          error: null,
          warning: errors.length ? [...new Set(errors.map((item) => item.detail))].slice(0, 2).join(" | ") : null,
          fallback: !direct,
          cached: false,
          route: direct ? "direct" : "fallback",
          attempts: index + 1,
          windowHours,
          httpStatus: response.status,
          errorCode: null,
          responseMs: totalResponseMs,
          lastUrl: url,
        },
        operational: { validators, lastUrl: url },
      };
    } catch (error) {
      errors.push(errorDiagnostic(error));
    }
  }
  if (successfulResponses > 0 && feed.emptyIsHealthy) {
    const cached = cachedItemsFromState(sourceState, feed, cutoff);
    return {
      items: cached,
      status: {
        id: feed.id,
        name: feed.name,
        region: feed.region || "Brasil",
        ok: true,
        count: cached.length,
        error: null,
        warning: [...new Set(errors.filter((item) => item.code !== "no-new").map((item) => item.detail))].slice(0, 2).join(" | ") || null,
        fallback: false,
        cached: cached.length > 0,
        route: cached.length ? "cache" : "no-new",
        attempts: feed.urls.length,
        windowHours,
        httpStatus: errors.at(-1)?.httpStatus ?? 200,
        errorCode: null,
        responseMs: totalResponseMs,
        lastUrl: sourceState?.lastUrl || null,
      },
      operational: { validators, lastUrl: sourceState?.lastUrl || null },
    };
  }
  const primaryError = errors.find((item) => ["blocked", "rate-limited", "timeout", "not-found"].includes(item.code)) || errors.at(-1) || { code: "unknown", detail: "Fonte indisponível", httpStatus: null };
  return {
    items: [],
    status: {
      id: feed.id,
      name: feed.name,
      region: feed.region || "Brasil",
      ok: false,
      count: 0,
      error: [...new Set(errors.map((item) => item.detail))].slice(0, 2).join(" | ") || "Fonte indisponível",
      warning: null,
      fallback: false,
      cached: false,
      route: "failed",
      attempts: feed.urls.length,
      windowHours,
      httpStatus: primaryError.httpStatus ?? null,
      errorCode: primaryError.code || "unknown",
      responseMs: totalResponseMs || null,
      lastUrl: sourceState?.lastUrl || null,
    },
    operational: { validators, lastUrl: sourceState?.lastUrl || null },
  };
}

export function uniqueItems(items, limit = Number.POSITIVE_INFINITY) {
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

export async function collectDedicatedMonitoring(terms = [], cutoff, fetcher = fetch) {
  const activeTerms = (Array.isArray(terms) ? terms : [])
    .filter((item) => item?.id && plainText(item?.term))
    .slice(0, TERM_SUBREQUEST_LIMIT);
  if (!activeTerms.length) {
    return {
      enabled: false,
      terms: [],
      items: [],
      statuses: [],
      totals: { terms: 0, items: 0, sources: 0 },
    };
  }
  const requestBudget = { remaining: TERM_SUBREQUEST_LIMIT };
  const results = await runPool(activeTerms, 3, async (term) => {
    const termFeed = {
      id: `term-${term.id}`,
      name: `Monitoramento: ${plainText(term.term)}`,
      region: "Brasil",
      canonicalSource: false,
      limit: 12,
      urls: [googleNewsTermSource(term.term)],
    };
    const result = await collectFeed(termFeed, cutoff, fetcher, requestBudget);
    return {
      term,
      status: {
        ...result.status,
        termId: term.id,
        term: plainText(term.term),
      },
      items: result.items.map((item) => ({
        ...item,
        kind: "monitoring",
        platform: "Monitoramento",
        monitoringTermId: term.id,
        monitoringTerm: plainText(term.term),
        matchedTerms: [{ id: term.id, term: plainText(term.term) }],
      })),
    };
  });

  const byUrl = new Map();
  for (const result of results) {
    for (const item of result.items) {
      const existing = byUrl.get(item.url);
      if (!existing) {
        byUrl.set(item.url, item);
        continue;
      }
      const matchedTerms = [...(existing.matchedTerms || [])];
      for (const matched of item.matchedTerms || []) {
        if (!matchedTerms.some((value) => value.id === matched.id)) matchedTerms.push(matched);
      }
      byUrl.set(item.url, { ...existing, matchedTerms });
    }
  }
  const items = [...byUrl.values()]
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
    .slice(0, 72);
  return {
    enabled: true,
    terms: activeTerms.map((item) => ({ id: item.id, term: plainText(item.term) })),
    items,
    statuses: results.map((result) => result.status),
    totals: {
      terms: activeTerms.length,
      items: items.length,
      sources: new Set(items.map((item) => item.sourceName).filter(Boolean)).size,
    },
  };
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

export async function collectBluesky(initialClusters, cutoff, fetcher = fetch) {
  const queries = [];
  for (const cluster of initialClusters.slice(0, 5)) {
    const first = cluster.items[0];
    const query = titleTokens(first?.title ?? "").slice(0, 3).join(" ");
    if (query && !queries.includes(query)) queries.push(query);
  }
  if (!queries.length) {
    return { items: [], status: { id: "bluesky", name: "Bluesky", region: "Rede", ok: true, count: 0, error: null, fallback: false } };
  }

  const results = await runPool(queries.slice(0, 3), 3, async (query) => {
    try {
      const endpoint = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&limit=8&sort=latest`;
      const response = await fetchWithTimeout(endpoint, fetcher, { accept: "application/json", timeoutMs: 6_500 });
      const payload = await response.json();
      return { status: "fulfilled", value: Array.isArray(payload?.posts) ? payload.posts : [] };
    } catch (reason) {
      return { status: "rejected", reason };
    }
  });

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

function cachedItemsForFeed(previousRound, feed, cutoff) {
  const items = Array.isArray(previousRound?.items) ? previousRound.items : [];
  const cutoffTime = cutoff.getTime();
  return uniqueItems(items
    .filter((item) => item?.kind === "portal")
    .filter((item) => item.collectorName === feed.name || item.sourceName === feed.name)
    .filter((item) => {
      const timestamp = Date.parse(item.publishedAt);
      return Number.isFinite(timestamp) && timestamp >= cutoffTime;
    })
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
    .slice(0, Number(feed.limit) || 15)
    .map((item) => ({ ...item, collectionRoute: "cache", collectorName: feed.name, sourceName: feed.name })), Number(feed.limit) || 15);
}

function sourceStateFor(sourceStates, sourceId) {
  if (sourceStates instanceof Map) return sourceStates.get(sourceId) || null;
  if (sourceStates && typeof sourceStates === "object") return sourceStates[sourceId] || null;
  return null;
}

function sourceIsDue(sourceState, collectedAt) {
  if (!sourceState?.nextCheckAt) return true;
  const next = Date.parse(sourceState.nextCheckAt);
  return !Number.isFinite(next) || next <= collectedAt.getTime();
}

function deferredSourceResult(feed, sourceState, cutoff) {
  const items = cachedItemsFromState(sourceState, feed, cutoff);
  return {
    items,
    status: {
      id: feed.id,
      name: feed.name,
      region: feed.region || "Brasil",
      ok: true,
      count: items.length,
      error: null,
      warning: null,
      fallback: sourceState?.route === "fallback",
      cached: items.length > 0,
      route: items.length > 0 ? "cache" : "no-new",
      attempts: 0,
      windowHours: 24,
      httpStatus: sourceState?.httpStatus ?? null,
      errorCode: null,
      responseMs: sourceState?.responseMs ?? null,
      lastUrl: sourceState?.lastUrl || null,
      lastAttemptAt: sourceState?.lastAttemptAt || null,
      lastSuccessAt: sourceState?.lastSuccessAt || null,
      nextCheckAt: sourceState?.nextCheckAt || null,
      refreshMinutes: feed.refreshMinutes,
      deferred: true,
    },
    operational: {
      validators: sourceState?.validators || {},
      lastUrl: sourceState?.lastUrl || null,
    },
  };
}

function retryBackoffMinutes(errorCode, failureCount) {
  if (errorCode === "not-found") return 360;
  if (errorCode === "blocked") return 60;
  if (errorCode === "rate-limited") return Math.max(30, [5, 15, 30, 60, 180][Math.min(4, Math.max(0, failureCount - 1))]);
  return [5, 15, 30, 60, 180][Math.min(4, Math.max(0, failureCount - 1))];
}

function snapshotItems(feed, currentItems, previousState, collectedAt) {
  const oldest = collectedAt.getTime() - 72 * 60 * 60 * 1000;
  return uniqueItems([
    ...(Array.isArray(currentItems) ? currentItems : []),
    ...(Array.isArray(previousState?.items) ? previousState.items : []),
  ]
    .filter((item) => {
      const timestamp = Date.parse(item?.publishedAt);
      return Number.isFinite(timestamp) && timestamp >= oldest;
    })
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt)), Math.max(20, (Number(feed.limit) || 15) * 3));
}

function buildSourceStateUpdate(feed, rawResult, resilientResult, previousState, collectedAt) {
  const attemptedAt = collectedAt.toISOString();
  const healthy = Boolean(rawResult?.status?.ok);
  const failureCount = healthy ? 0 : (Number(previousState?.failureCount) || 0) + 1;
  const nextMinutes = healthy
    ? Math.max(5, Number(feed.refreshMinutes) || 15)
    : retryBackoffMinutes(rawResult?.status?.errorCode, failureCount);
  const nextCheckAt = new Date(collectedAt.getTime() + nextMinutes * 60 * 1000).toISOString();
  const items = snapshotItems(feed, resilientResult?.items, previousState, collectedAt);
  const status = healthy
    ? rawResult.status.route
    : resilientResult?.status?.route === "cache" ? "degraded" : rawResult?.status?.errorCode || "failed";
  return {
    sourceId: feed.id,
    name: feed.name,
    region: feed.region || "Brasil",
    status,
    route: resilientResult?.status?.route || rawResult?.status?.route || "failed",
    httpStatus: rawResult?.status?.httpStatus ?? previousState?.httpStatus ?? null,
    errorCode: healthy ? null : rawResult?.status?.errorCode || "unknown",
    errorDetail: healthy ? null : rawResult?.status?.error || "Fonte indisponível",
    items,
    itemCount: items.length,
    lastUrl: rawResult?.operational?.lastUrl || previousState?.lastUrl || null,
    validators: rawResult?.operational?.validators || previousState?.validators || {},
    lastAttemptAt: attemptedAt,
    lastSuccessAt: healthy ? attemptedAt : previousState?.lastSuccessAt || null,
    nextCheckAt,
    failureCount,
    responseMs: rawResult?.status?.responseMs ?? previousState?.responseMs ?? null,
    updatedAt: attemptedAt,
  };
}

function enrichStatus(status, sourceState, feed) {
  return {
    ...status,
    lastAttemptAt: status.lastAttemptAt || sourceState?.lastAttemptAt || null,
    lastSuccessAt: status.lastSuccessAt || sourceState?.lastSuccessAt || null,
    nextCheckAt: status.nextCheckAt || sourceState?.nextCheckAt || null,
    failureCount: Number(sourceState?.failureCount) || 0,
    refreshMinutes: feed.refreshMinutes,
  };
}


export function summarizePortalStatuses(statuses = []) {
  const portals = (Array.isArray(statuses) ? statuses : []).filter((source) => source?.region !== "Rede");
  const issues = portals.filter((source) => !source?.ok || source?.degraded || source?.warning);
  const failures = portals.filter((source) => !source?.ok);
  const degraded = portals.filter((source) => source?.degraded || source?.warning);
  const cached = portals.filter((source) => source?.cached || source?.route === "cache");
  const withContent = portals.filter((source) => source?.ok && Number(source?.count) > 0);
  const noNew = portals.filter((source) => source?.ok && Number(source?.count) === 0 && !source?.cached);
  const byCode = {};
  for (const source of issues) {
    const code = source?.errorCode
      || (Number(source?.httpStatus) ? `http-${Number(source.httpStatus)}` : null)
      || (source?.degraded ? "degraded-cache" : "unknown");
    byCode[code] = (Number(byCode[code]) || 0) + 1;
  }
  return {
    total: portals.length,
    withContent: withContent.length,
    healthy: Math.max(0, portals.length - failures.length),
    failed: failures.length,
    degraded: degraded.length,
    cached: cached.length,
    noNew: noNew.length,
    complete: failures.length === 0 && degraded.length === 0,
    byCode,
    issues: issues.slice(0, 12).map((source) => ({
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
      detail: String(source?.warning || source?.error || "").slice(0, 220) || null,
      lastAttemptAt: source?.lastAttemptAt || null,
      lastSuccessAt: source?.lastSuccessAt || null,
    })),
  };
}

export async function collectRound({
  fetcher = fetch,
  now = new Date(),
  feeds = FEEDS,
  monitoringTerms = [],
  previousRound = null,
  sourceStates = new Map(),
} = {}) {
  const startedAt = Date.now();
  const collectedAt = new Date(now);
  const cutoff = new Date(collectedAt.getTime() - 24 * 60 * 60 * 1000);
  const requestBudget = { remaining: PORTAL_SUBREQUEST_LIMIT, used: 0, seenUrls: new Set() };
  const portalFetcher = sharedResponseFetcher(fetcher);
  const portalResults = new Array(feeds.length);
  const due = [];

  feeds.forEach((feed, index) => {
    const state = sourceStateFor(sourceStates, feed.id);
    if (sourceIsDue(state, collectedAt)) due.push({ feed, index, state });
    else portalResults[index] = deferredSourceResult(feed, state, cutoff);
  });

  const dueResults = await runPool(due, 5, async ({ feed, state }) => (
    collectFeed(feed, cutoff, portalFetcher, requestBudget, state)
  ));
  due.forEach((entry, index) => { portalResults[entry.index] = dueResults[index]; });

  const resilientPortalResults = portalResults.map((result, index) => {
    const feed = feeds[index];
    const state = sourceStateFor(sourceStates, feed.id);
    if (result.status.ok) return { ...result, status: enrichStatus(result.status, state, feed) };
    const stateItems = cachedItemsFromState(state, feed, cutoff);
    const previousItems = stateItems.length ? [] : cachedItemsForFeed(previousRound, feed, cutoff);
    const cachedItems = stateItems.length ? stateItems : previousItems;
    if (!cachedItems.length) return { ...result, status: enrichStatus(result.status, state, feed) };
    return {
      items: cachedItems,
      status: enrichStatus({
        ...result.status,
        ok: true,
        count: cachedItems.length,
        error: null,
        warning: result.status.error,
        fallback: true,
        cached: true,
        degraded: true,
        route: "cache",
      }, state, feed),
      operational: result.operational,
    };
  });

  const sourceStateUpdates = due.map((entry, index) => {
    const raw = dueResults[index];
    const resilient = resilientPortalResults[entry.index];
    return buildSourceStateUpdate(entry.feed, raw, resilient, entry.state, collectedAt);
  });

  const portalItems = uniqueItems(resilientPortalResults.flatMap((result) => result.items), 435);
  const portalStatuses = resilientPortalResults.map((result) => result.status);
  const portalDiagnostics = summarizePortalStatuses(portalStatuses);

  const dedicatedMonitoring = await collectDedicatedMonitoring(monitoringTerms, cutoff, fetcher);

  if (!portalItems.length) {
    return {
      ok: false,
      collectionStatus: "failed",
      degraded: true,
      collectedAt: collectedAt.toISOString(),
      windowHours: 24,
      durationMs: Date.now() - startedAt,
      error: "Nenhuma fonte respondeu com conteúdo válido nas últimas 24 horas.",
      sources: portalStatuses,
      diagnostics: { portals: portalDiagnostics },
      totals: { items: 0, topics: 0, sources: 0, socialItems: 0, dedicatedItems: dedicatedMonitoring.items.length },
      items: [],
      topics: [],
      dedicatedMonitoring,
      sourceStateUpdates,
      operational: {
        portalConcurrency: 5,
        portalsDue: due.length,
        portalsDeferred: feeds.length - due.length,
        externalPortalRequests: requestBudget.used,
        externalPortalLimit: PORTAL_SUBREQUEST_LIMIT,
      },
    };
  }

  const initialClusters = clusterItems(portalItems);
  const social = await collectBluesky(initialClusters, cutoff, fetcher);
  const allItems = uniqueItems([...portalItems, ...social.items]);
  const topics = buildTopics(allItems, collectedAt, 40);
  const sourceCount = new Set(allItems.map((item) => item.sourceName).filter(Boolean)).size;
  const socialItems = allItems.filter((item) => item.kind === "social").length;

  const collectionStatus = portalDiagnostics.complete ? "complete" : "partial";
  return {
    ok: true,
    collectionStatus,
    degraded: collectionStatus === "partial",
    collectedAt: collectedAt.toISOString(),
    windowHours: 24,
    durationMs: Date.now() - startedAt,
    sources: [...portalStatuses, social.status],
    diagnostics: { portals: portalDiagnostics },
    totals: {
      items: allItems.length,
      topics: topics.length,
      sources: sourceCount,
      socialItems,
      dedicatedItems: dedicatedMonitoring.items.length,
    },
    items: allItems,
    topics,
    dedicatedMonitoring,
    sourceStateUpdates,
    operational: {
      portalConcurrency: 5,
      monitoringConcurrency: 3,
      socialConcurrency: 3,
      portalsDue: due.length,
      portalsDeferred: feeds.length - due.length,
      externalPortalRequests: requestBudget.used,
      externalPortalLimit: PORTAL_SUBREQUEST_LIMIT,
    },
  };
}
