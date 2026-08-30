import { buildTopics, clusterItems, titleTokens } from "./clustering.js";
import { parseFeed, plainText, stableHash } from "./parser.js";
import { parseNewsHtml } from "./scraper.js";

const HIGH_FREQUENCY_SOURCES = new Set([
  "g1", "cnn-brasil", "folha", "estadao", "o-globo", "poder360",
  "agencia-brasil", "ge", "metropoles", "infomoney", "uol-splash",
  "bbc", "guardian", "cnn",
]);

export const FAST_LANE_SOURCE_IDS = Object.freeze([
  "g1", "cnn-brasil", "folha", "estadao", "o-globo", "poder360",
  "agencia-brasil", "ge", "metropoles", "infomoney", "uol-splash",
]);

const MEDIUM_FREQUENCY_SOURCES = new Set([
  "veja", "nexo", "infomoney", "money-times", "canaltech", "tecmundo",
  "o-liberal", "campo-grande-news", "uol-splash", "leo-dias", "quem",
  "caras-brasil", "observatorio-dos-famosos", "area-vip", "natelinha",
  "new-york-times", "washington-post", "al-jazeera", "france-24", "deutsche-welle",
]);

function sourceRefreshMinutes(id) {
  if (HIGH_FREQUENCY_SOURCES.has(id)) return 1;
  if (MEDIUM_FREQUENCY_SOURCES.has(id)) return 5;
  return 5;
}

export async function runPool(items, concurrency, worker, onSettled = null) {
  const list = Array.isArray(items) ? items : [];
  const output = new Array(list.length);
  let cursor = 0;
  async function consume() {
    while (cursor < list.length) {
      const index = cursor++;
      const value = await worker(list[index], index);
      output[index] = value;
      if (typeof onSettled === "function") { try { await onSettled(value, index); } catch {} }
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


function portalFeed(id, name, region, { primaryUrl = null, fallbackUrl = null, scrapeUrls = [], sourceAliases = [], sourceDomains = [], editorialHints = [], limit = null, scanLimit = 320, emptyIsHealthy = false, refreshMinutes = null } = {}) {
  const normalizedDomains = sourceDomains.map(normalizedSite).filter(Boolean);
  const dedicatedFallback = normalizedDomains[0]
    ? googleNewsSiteSource(normalizedDomains[0], region, "", 1)
    : null;
  const normalizedScrapeUrls = [...new Set((Array.isArray(scrapeUrls) ? scrapeUrls : []).filter(Boolean))];
  const urls = [...new Set([primaryUrl, ...normalizedScrapeUrls, dedicatedFallback, fallbackUrl].filter(Boolean))];
  return Object.freeze({
    id,
    name,
    region,
    canonicalSource: true,
    directUrl: primaryUrl || null,
    scrapeUrls: Object.freeze(normalizedScrapeUrls),
    limit: limit || (region === "Mundo" ? 15 : 24),
    scanLimit,
    emptyIsHealthy: Boolean(emptyIsHealthy),
    refreshMinutes: Math.max(1, Number(refreshMinutes) || sourceRefreshMinutes(id)),
    sourceAliases: Object.freeze(sourceAliases),
    sourceDomains: Object.freeze(normalizedDomains),
    editorialHints: Object.freeze(editorialHints),
    urls: Object.freeze(urls),
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
  portalFeed("g1", "G1", "Brasil", { primaryUrl: "https://g1.globo.com/rss/g1/", scrapeUrls: ["https://g1.globo.com/"], fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["G1"], sourceDomains: ["g1.globo.com"] }),
  portalFeed("cnn-brasil", "CNN Brasil", "Brasil", { primaryUrl: "https://www.cnnbrasil.com.br/feed/", scrapeUrls: ["https://www.cnnbrasil.com.br/"], fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["CNN Brasil"], sourceDomains: ["cnnbrasil.com.br"] }),
  portalFeed("folha", "Folha de S.Paulo", "Brasil", { primaryUrl: "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml", scrapeUrls: ["https://www.folha.uol.com.br/"], fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Folha de S.Paulo", "Folha"], sourceDomains: ["folha.uol.com.br"] }),
  portalFeed("estadao", "Estadão", "Brasil", { scrapeUrls: ["https://www.estadao.com.br/"], fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Estadão", "O Estado de S. Paulo"], sourceDomains: ["estadao.com.br"] }),
  portalFeed("o-globo", "O Globo", "Brasil", { primaryUrl: "https://oglobo.globo.com/rss.xml", scrapeUrls: ["https://oglobo.globo.com/"], fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["O Globo"], sourceDomains: ["oglobo.globo.com"] }),
  portalFeed("veja", "Veja", "Brasil", { primaryUrl: "https://veja.abril.com.br/feed/", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Veja"], sourceDomains: ["veja.abril.com.br"] }),
  portalFeed("poder360", "Poder360", "Brasil", { primaryUrl: "https://www.poder360.com.br/feed/", scrapeUrls: ["https://www.poder360.com.br/"], fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Poder360"], sourceDomains: ["poder360.com.br"] }),
  portalFeed("agencia-brasil", "Agência Brasil", "Brasil", { primaryUrl: "https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml", scrapeUrls: ["https://agenciabrasil.ebc.com.br/"], fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Agência Brasil"], sourceDomains: ["agenciabrasil.ebc.com.br"] }),
  portalFeed("nexo", "Nexo Jornal", "Brasil", { fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Nexo Jornal", "Nexo"], sourceDomains: ["nexojornal.com.br"] }),
  portalFeed("infomoney", "InfoMoney", "Brasil", { primaryUrl: "https://www.infomoney.com.br/feed/", scrapeUrls: ["https://www.infomoney.com.br/"], fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["InfoMoney"], sourceDomains: ["infomoney.com.br"] }),
  portalFeed("money-times", "Money Times", "Brasil", { primaryUrl: "https://www.moneytimes.com.br/feed/", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Money Times"], sourceDomains: ["moneytimes.com.br"] }),
  portalFeed("ge", "ge", "Brasil", { primaryUrl: "https://ge.globo.com/rss/ge/", scrapeUrls: ["https://ge.globo.com/"], fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["ge", "Globo Esporte"], sourceDomains: ["ge.globo.com"] }),
  portalFeed("canaltech", "Canaltech", "Brasil", { primaryUrl: "https://feeds2.feedburner.com/canaltechbr", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Canaltech"], sourceDomains: ["canaltech.com.br"] }),
  portalFeed("tecmundo", "TecMundo", "Brasil", { primaryUrl: "https://www.tecmundo.com.br/rss", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["TecMundo"], sourceDomains: ["tecmundo.com.br"] }),
  portalFeed("o-liberal", "O Liberal", "Brasil", { primaryUrl: "https://www.oliberal.com/rss", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["O Liberal"], sourceDomains: ["oliberal.com"] }),
  portalFeed("metropoles", "Metrópoles", "Brasil", { primaryUrl: "https://www.metropoles.com/feed", scrapeUrls: ["https://www.metropoles.com/"], fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Metrópoles", "Metropoles"], sourceDomains: ["metropoles.com"] }),
  portalFeed("campo-grande-news", "Campo Grande News", "Brasil", { primaryUrl: "https://www.campograndenews.com.br/rss", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Campo Grande News"], sourceDomains: ["campograndenews.com.br"] }),

  // Brasil — entretenimento, celebridades e realities.
  portalFeed("uol-splash", "UOL Splash", "Brasil", { scrapeUrls: ["https://www.uol.com.br/splash/"], fallbackUrl: SPLASH_SEARCH, sourceAliases: ["UOL", "UOL Splash", "Splash"], sourceDomains: ["uol.com.br"], editorialHints: ["Fofoca e Celebridades", "Reality Shows", "Entretenimento"], scanLimit: 500 }),
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

const PORTAL_SUBREQUEST_LIMIT = 120;
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
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
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

function orderedFeedUrls(feed, sourceState) {
  const urls = Array.isArray(feed?.urls) ? [...feed.urls] : [];
  const lastGood = String(sourceState?.lastUrl || "");
  if (!lastGood || !urls.includes(lastGood)) return urls;

  const scrapeUrls = Array.isArray(feed?.scrapeUrls) ? feed.scrapeUrls : [];
  // Mantém a recuperação histórica para fontes sem scraper.
  if (!scrapeUrls.length) return [lastGood, ...urls.filter((url) => url !== lastGood)];

  // Com Fast News Engine, evita que um fallback agregado saudável impeça
  // a consulta do feed oficial + página HTML direta.
  const discovery = urls.filter((url) => url === feed?.directUrl || scrapeUrls.includes(url));
  const fallback = urls.filter((url) => !discovery.includes(url));
  if (discovery.includes(lastGood)) {
    return [lastGood, ...discovery.filter((url) => url !== lastGood), ...fallback];
  }
  return [...discovery, lastGood, ...fallback.filter((url) => url !== lastGood)];
}

function routeLabel(routeSet) {
  const active = ["direct", "scrape", "fallback"].filter((route) => routeSet.has(route));
  if (active.length) return active.join("+");
  return routeSet.has("cache") ? "cache" : "no-new";
}

export async function collectFeed(feed, cutoff, fetcher = fetch, requestBudget = null, sourceState = null, options = {}) {
  const errors = [];
  let successfulResponses = 0;
  const effectiveCutoff = cutoff;
  const windowHours = 24;
  const validators = { ...(sourceState?.validators || {}) };
  let totalResponseMs = 0;
  let lastUrl = sourceState?.lastUrl || null;
  let mergedItems = [];
  const routes = [];
  const desiredMinimum = feed.region === "Mundo" ? 5 : 8;
  const itemLimit = Number(feed.limit) || (feed.region === "Mundo" ? 15 : 24);
  const scrapeUrls = new Set(Array.isArray(feed?.scrapeUrls) ? feed.scrapeUrls : []);
  let scrapeAttempted = false;
  let directAttempted = false;

  const orderedUrls = orderedFeedUrls(feed, sourceState);

  for (let index = 0; index < orderedUrls.length; index += 1) {
    const url = orderedUrls[index];
    const scrape = scrapeUrls.has(url);
    if (scrape) scrapeAttempted = true;
    if (Boolean(feed.directUrl) && String(url) === String(feed.directUrl)) directAttempted = true;
    try {
      reserveExternalRequest(requestBudget, url);
      const response = await fetchWithTimeout(url, fetcher, {
        validator: validators[url],
        timeoutMs: Number(options.timeoutMs) || 8_000,
        accept: scrape
          ? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.7"
          : "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.7",
      });
      totalResponseMs += Number(RESPONSE_TIMINGS.get(response)) || 0;
      const direct = Boolean(feed.directUrl) && String(url) === String(feed.directUrl);
      successfulResponses += 1;

      if (response.status === 304) {
        const cached = cachedItemsFromState(sourceState, feed, cutoff);
        if (cached.length) {
          mergedItems = uniqueItems([...mergedItems, ...cached], itemLimit);
          routes.push("cache");
        }
        lastUrl = url;
        const directHealthy = Boolean(options.skipScrapeWhenDirectHealthy && direct && mergedItems.length >= desiredMinimum);
        const discoveryRoutesSatisfied = directHealthy || !scrapeUrls.size || ((!feed.directUrl || directAttempted) && scrapeAttempted);
        if (mergedItems.length >= desiredMinimum && discoveryRoutesSatisfied) break;
        continue;
      }

      validators[url] = validatorSnapshot(response);
      const body = await decodeFeedResponse(response);
      const parseConfiguration = direct ? { ...feed, sourceAliases: [], sourceDomains: [] } : feed;
      const items = scrape
        ? parseNewsHtml(body, feed, url, effectiveCutoff, itemLimit)
        : parseFeed(body, parseConfiguration, effectiveCutoff, itemLimit);

      if (!items.length) {
        errors.push({
          code: "no-new",
          httpStatus: response.status,
          retryable: false,
          detail: scrape
            ? "Página HTML acessível, mas sem cards datados válidos nas últimas 24 horas"
            : "Sem conteúdo válido nesta rota nas últimas 24 horas",
        });
        continue;
      }

      const route = scrape ? "scrape" : direct ? "direct" : "fallback";
      mergedItems = uniqueItems([
        ...mergedItems,
        ...items.map((item) => ({ ...item, collectionRoute: route }))
      ], itemLimit);
      routes.push(route);
      lastUrl = url;

      // Em fontes com scraper, uma resposta RSS cheia não encerra a descoberta:
      // ao menos uma página HTML é consultada para reduzir a latência de publicação.
      const directHealthy = Boolean(options.skipScrapeWhenDirectHealthy && direct && mergedItems.length >= desiredMinimum);
      const discoveryRoutesSatisfied = directHealthy || !scrapeUrls.size || ((!feed.directUrl || directAttempted) && scrapeAttempted);
      if (mergedItems.length >= desiredMinimum && discoveryRoutesSatisfied) break;
    } catch (error) {
      errors.push(errorDiagnostic(error));
    }
  }

  if (mergedItems.length) {
    const routeSet = new Set(routes);
    const route = routeLabel(routeSet);

    return {
      items: mergedItems,
      status: {
        id: feed.id,
        name: feed.name,
        region: feed.region || "Brasil",
        ok: true,
        count: mergedItems.length,
        error: null,
        warning: errors.length ? [...new Set(errors.map((item) => item.detail))].slice(0, 2).join(" | ") : null,
        fallback: routeSet.has("fallback"),
        cached: routeSet.has("cache"),
        route,
        attempts: Math.min(orderedUrls.length, successfulResponses + errors.length),
        windowHours,
        httpStatus: 200,
        errorCode: null,
        responseMs: totalResponseMs,
        lastUrl,
      },
      operational: { validators, lastUrl },
    };
  }

  if (successfulResponses > 0) {
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
        attempts: orderedUrls.length,
        windowHours,
        httpStatus: errors.at(-1)?.httpStatus ?? 200,
        errorCode: null,
        responseMs: totalResponseMs,
        lastUrl,
      },
      operational: { validators, lastUrl },
    };
  }

  const primaryError = errors.find((item) => ["blocked", "rate-limited", "timeout", "not-found", "budget-exhausted"].includes(item.code))
    || errors.at(-1)
    || { code: "unknown", detail: "Fonte indisponível", httpStatus: null };

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
      attempts: orderedUrls.length,
      windowHours,
      httpStatus: primaryError.httpStatus ?? null,
      errorCode: primaryError.code || "unknown",
      responseMs: totalResponseMs || null,
      lastUrl,
    },
    operational: { validators, lastUrl },
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

function effectiveNextCheckAt(sourceState, feed, referenceMs = Date.now()) {
  const storedNext = Date.parse(sourceState?.nextCheckAt || "");
  const lastAttempt = Date.parse(sourceState?.lastAttemptAt || "");
  const failed = Number(sourceState?.failureCount) > 0;
  const maxSilenceMinutes = failed ? 10 : Math.max(3, Number(feed?.refreshMinutes) || 5);
  if (!Number.isFinite(lastAttempt)) return Number.isFinite(storedNext) ? storedNext : referenceMs;
  const recoveryCap = lastAttempt + maxSilenceMinutes * 60 * 1000;
  return Number.isFinite(storedNext) ? Math.min(storedNext, recoveryCap) : recoveryCap;
}

function sourceIsDue(sourceState, collectedAt, feed) {
  if (!sourceState?.nextCheckAt) return true;
  return effectiveNextCheckAt(sourceState, feed, collectedAt.getTime()) <= collectedAt.getTime();
}

function deferredSourceResult(feed, sourceState, cutoff, previousRound = null) {
  const stateItems = cachedItemsFromState(sourceState, feed, cutoff);
  const previousItems = stateItems.length ? [] : cachedItemsForFeed(previousRound, feed, cutoff);
  const items = stateItems.length ? stateItems : previousItems;
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
      nextCheckAt: sourceState ? new Date(effectiveNextCheckAt(sourceState, feed)).toISOString() : null,
      refreshMinutes: feed.refreshMinutes,
      deferred: true,
      cacheOrigin: stateItems.length ? "source-state" : previousItems.length ? "previous-round" : null,
    },
    operational: {
      validators: sourceState?.validators || {},
      lastUrl: sourceState?.lastUrl || null,
    },
  };
}

function retryBackoffMinutes(errorCode, failureCount) {
  const step = Math.min(4, Math.max(0, Number(failureCount) - 1));
  if (errorCode === "rate-limited") return [5, 5, 10, 10, 15][step];
  if (errorCode === "not-found") return [5, 10, 10, 15, 15][step];
  if (errorCode === "blocked") return [5, 5, 10, 10, 15][step];
  return [3, 5, 5, 10, 15][step];
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

export function applyDiscoveryMetadata(items, previousState, collectedAt = new Date()) {
  const seenAt = new Date(collectedAt).toISOString();
  const previousByKey = new Map((Array.isArray(previousState?.items) ? previousState.items : [])
    .map((item) => [item?.url || item?.id, item])
    .filter(([key]) => Boolean(key)));
  return (Array.isArray(items) ? items : []).map((item) => {
    const key = item?.url || item?.id;
    const previous = key ? previousByKey.get(key) : null;
    const seededFirstSeen = previous?.firstSeenAt
      || previous?.discoveredAt
      || (previous ? previous?.publishedAt : null)
      || seenAt;
    return {
      ...item,
      firstSeenAt: seededFirstSeen,
      discoveredAt: seededFirstSeen,
      lastSeenAt: seenAt,
      updatedAt: item?.updatedAt || previous?.updatedAt || null,
    };
  });
}

function buildSourceStateUpdate(feed, rawResult, resilientResult, previousState, collectedAt) {
  const attemptedAt = collectedAt.toISOString();
  const healthy = Boolean(rawResult?.status?.ok);
  const failureCount = healthy ? 0 : (Number(previousState?.failureCount) || 0) + 1;
  const nextMinutes = healthy
    ? Math.max(1, Number(feed.refreshMinutes) || 5)
    : Math.min(15, retryBackoffMinutes(rawResult?.status?.errorCode, failureCount));
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

function optionsFullConcurrency(mode, feedCount){
  if(mode==="fast")return Math.min(8,Math.max(4,feedCount));
  return feedCount>=30?14:Math.min(12,Math.max(6,feedCount));
}

export async function collectRound({
  fetcher = fetch,
  now = new Date(),
  feeds = FEEDS,
  monitoringTerms = [],
  previousRound = null,
  sourceStates = new Map(),
  mode = "full",
  forceRefresh = false,
  externalRequestLimit = PORTAL_SUBREQUEST_LIMIT,
  earlySourceTarget = 25,
  earlyFreshMinimum = 8,
  onEarlySnapshot = null,
} = {}) {
  const startedAt = Date.now();
  const collectedAt = new Date(now);
  const fastMode = mode === "fast";
  const cutoff = new Date(collectedAt.getTime() - 24 * 60 * 60 * 1000);
  const safeExternalRequestLimit = Math.max(12, Math.min(PORTAL_SUBREQUEST_LIMIT, Number(externalRequestLimit) || PORTAL_SUBREQUEST_LIMIT));
  const requestBudget = { remaining: safeExternalRequestLimit, used: 0, seenUrls: new Set() };
  const portalFetcher = sharedResponseFetcher(fetcher);
  const portalResults = new Array(feeds.length);
  const due = [];

  feeds.forEach((feed, index) => {
    const state = sourceStateFor(sourceStates, feed.id);
    const stateItems = cachedItemsFromState(state, feed, cutoff);
    const previousItems = stateItems.length ? [] : cachedItemsForFeed(previousRound, feed, cutoff);
    const hasSafeSnapshot = stateItems.length > 0 || previousItems.length > 0;
    // Nunca adia uma fonte sem snapshot utilizável. Esse caso causava a ronda
    // a encolher para apenas as poucas fontes que estavam "due" após um deploy.
    if (forceRefresh || sourceIsDue(state, collectedAt, feed) || !hasSafeSnapshot) due.push({ feed, index, state });
    else portalResults[index] = deferredSourceResult(feed, state, cutoff, previousRound);
  });

  let earlyPublished = false;
  const fullConcurrency = Math.max(8, Math.min(16, Number(optionsFullConcurrency(mode, feeds.length)) || 14));
  const dueConcurrency = fastMode ? 8 : fullConcurrency;
  const feedOptions = fastMode
    ? { timeoutMs: 3_500, skipScrapeWhenDirectHealthy: false }
    : { timeoutMs: 4_500, skipScrapeWhenDirectHealthy: true };
  const maybePublishEarly = async () => {
    if (fastMode || earlyPublished || typeof onEarlySnapshot !== "function") return;
    const interim = portalResults.map((result, index) => {
      if (result) return result;
      const feed = feeds[index]; const state = sourceStateFor(sourceStates, feed.id);
      return deferredSourceResult(feed, state, cutoff, previousRound);
    });
    const available = interim.filter((result) => result?.status?.ok && Number(result?.status?.count) > 0).length;
    const fresh = interim.filter((result, index) => portalResults[index] && result?.status?.ok && Number(result?.status?.count) > 0 && !result?.status?.cached && result?.status?.route !== "cache").length;
    if (available < Math.max(1, Number(earlySourceTarget) || 25) || fresh < Math.max(1, Number(earlyFreshMinimum) || 8)) return;
    earlyPublished = true;
    const resilient = interim.map((result,index)=>{const feed=feeds[index];const state=sourceStateFor(sourceStates,feed.id);if(result.status.ok)return {...result,status:enrichStatus(result.status,state,feed)};const cached=cachedItemsFromState(state,feed,cutoff);if(!cached.length)return {...result,status:enrichStatus(result.status,state,feed)};return {items:cached,status:enrichStatus({...result.status,ok:true,count:cached.length,error:null,warning:result.status.error,fallback:true,cached:true,degraded:true,route:"cache"},state,feed),operational:result.operational};});
    const items = uniqueItems(resilient.flatMap((result)=>applyDiscoveryMetadata(result.items, sourceStateFor(sourceStates, result?.status?.id), collectedAt)), 900);
    const statuses = resilient.map((result)=>result.status);
    const diagnostics = summarizePortalStatuses(statuses);
    const topics = buildTopics(items, collectedAt, 80);
    const sourceCount = new Set(items.map((item)=>item.sourceName).filter(Boolean)).size;
    await onEarlySnapshot({
      ok:true,collectionStatus:"partial",degraded:true,mode:"full",earlyPreview:true,collectedAt:collectedAt.toISOString(),windowHours:24,durationMs:Date.now()-startedAt,
      sources:statuses,diagnostics:{portals:diagnostics},totals:{items:items.length,topics:topics.length,sources:sourceCount,socialItems:0,dedicatedItems:Number(previousRound?.dedicatedMonitoring?.items?.length)||0},
      items,topics,dedicatedMonitoring:previousRound?.dedicatedMonitoring||{enabled:false,terms:[],items:[],statuses:[],totals:{terms:0,items:0,sources:0}},
      operational:{mode:"full",earlyPreview:true,sourceTarget:Number(earlySourceTarget)||25,availableSources:available,freshSources:fresh,portalConcurrency:dueConcurrency,externalPortalRequests:requestBudget.used,externalPortalLimit:safeExternalRequestLimit}
    });
  };
  const dueResults = await runPool(due, dueConcurrency, async ({ feed, state }) => (
    collectFeed(feed, cutoff, portalFetcher, requestBudget, state, feedOptions)
  ), async (result,index) => { portalResults[due[index].index] = result; await maybePublishEarly(); });
  due.forEach((entry, index) => { portalResults[entry.index] = dueResults[index]; });

  let resilientPortalResults = portalResults.map((result, index) => {
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

  // O relógio do radar passa a registrar quando o Ronda viu cada URL pela primeira vez.
  // Itens já existentes são semeados pela data publicada para evitar um falso pico após deploy.
  resilientPortalResults = resilientPortalResults.map((result, index) => ({
    ...result,
    items: applyDiscoveryMetadata(result.items, sourceStateFor(sourceStates, feeds[index].id), collectedAt),
  }));

  const sourceStateUpdates = due.map((entry, index) => {
    const raw = dueResults[index];
    const resilient = resilientPortalResults[entry.index];
    return buildSourceStateUpdate(entry.feed, raw, resilient, entry.state, collectedAt);
  });

  const portalItems = uniqueItems(resilientPortalResults.flatMap((result) => result.items), 900);
  const portalStatuses = resilientPortalResults.map((result) => result.status);
  const previousFreshItems = (Array.isArray(previousRound?.items) ? previousRound.items : [])
    .filter((item) => {
      const timestamp = Date.parse(item?.publishedAt);
      return Number.isFinite(timestamp) && timestamp >= cutoff.getTime();
    });

  const fastNames = new Set(feeds.map((feed) => feed.name));
  const previousOutsideFastLane = fastMode
    ? previousFreshItems.filter((item) => !fastNames.has(item?.collectorName) && !fastNames.has(item?.sourceName))
    : [];

  const dedicatedMonitoring = fastMode
    ? (previousRound?.dedicatedMonitoring || { enabled:false, terms:[], items:[], statuses:[], totals:{ terms:0, items:0, sources:0 } })
    : await collectDedicatedMonitoring(monitoringTerms, cutoff, fetcher);

  const previousSources = fastMode && Array.isArray(previousRound?.sources) ? previousRound.sources : [];
  const currentIds = new Set(feeds.map((feed) => feed.id));
  const preservedSources = fastMode
    ? previousSources.filter((source) => source?.id && !currentIds.has(source.id))
    : [];
  const mergedPortalStatuses = fastMode
    ? [...portalStatuses, ...preservedSources.filter((source) => source?.region !== "Rede")]
    : portalStatuses;
  const portalDiagnostics = summarizePortalStatuses(mergedPortalStatuses);

  if (!portalItems.length && !(fastMode && previousFreshItems.length)) {
    return {
      ok: false,
      collectionStatus: "failed",
      degraded: true,
      mode,
      collectedAt: collectedAt.toISOString(),
      windowHours: 24,
      durationMs: Date.now() - startedAt,
      error: "Nenhuma fonte respondeu com conteúdo válido nas últimas 24 horas.",
      sources: mergedPortalStatuses,
      diagnostics: { portals: portalDiagnostics },
      totals: { items: 0, topics: 0, sources: 0, socialItems: 0, dedicatedItems: dedicatedMonitoring.items?.length || 0 },
      items: [],
      topics: [],
      dedicatedMonitoring,
      sourceStateUpdates,
      operational: {
        mode,
        portalConcurrency: fastMode ? 8 : dueConcurrency,
        sourceRecovery: "0.9.7.4.2-snapshot-continuity-rss-first",
        healthyMaxRefreshMinutes: fastMode ? 1 : 5,
        failedMaxSilenceMinutes: 10,
        portalsDue: due.length,
        portalsDeferred: feeds.length - due.length,
        externalPortalRequests: requestBudget.used,
        externalPortalLimit: safeExternalRequestLimit,
      },
    };
  }

  if (fastMode) {
    const allItems = uniqueItems([...portalItems, ...previousOutsideFastLane], 1000);
    const topics = buildTopics(allItems, collectedAt, 80);
    const sourceCount = new Set(allItems.map((item) => item.sourceName).filter(Boolean)).size;
    const socialItems = allItems.filter((item) => item.kind === "social").length;
    const newItems = portalItems.filter((item) => {
      const age = collectedAt.getTime() - Date.parse(item?.firstSeenAt || item?.discoveredAt || item?.publishedAt || "");
      return Number.isFinite(age) && age >= -5 * 60 * 1000 && age <= 70 * 1000;
    }).length;
    const collectionStatus = portalItems.length ? (portalDiagnostics.complete ? "complete" : "partial") : "partial";
    return {
      ok: true,
      collectionStatus,
      degraded: collectionStatus === "partial",
      mode: "fast",
      fastLane: {
        enabled: true,
        sourceIds: feeds.map((feed) => feed.id),
        newItems,
        checkedAt: collectedAt.toISOString(),
        discoveryClock: "firstSeenAt",
      },
      collectedAt: collectedAt.toISOString(),
      windowHours: 24,
      durationMs: Date.now() - startedAt,
      sources: [...portalStatuses, ...preservedSources],
      diagnostics: { portals: portalDiagnostics },
      totals: {
        items: allItems.length,
        topics: topics.length,
        sources: sourceCount,
        socialItems,
        dedicatedItems: dedicatedMonitoring.items?.length || 0,
      },
      items: allItems,
      topics,
      dedicatedMonitoring,
      sourceStateUpdates,
      operational: {
        mode: "fast",
        fastLane: true,
        portalConcurrency: 8,
        sourceRecovery: "0.9.7.4.2-snapshot-continuity-rss-first",
        healthyMaxRefreshMinutes: 1,
        failedMaxSilenceMinutes: 10,
        portalsDue: due.length,
        portalsDeferred: 0,
        externalPortalRequests: requestBudget.used,
        externalPortalLimit: safeExternalRequestLimit,
      },
    };
  }

  const initialClusters = clusterItems(portalItems);
  const social = await collectBluesky(initialClusters, cutoff, fetcher);
  const allItems = uniqueItems([...portalItems, ...social.items]);
  const topics = buildTopics(allItems, collectedAt, 80);
  const sourceCount = new Set(allItems.map((item) => item.sourceName).filter(Boolean)).size;
  const socialItems = allItems.filter((item) => item.kind === "social").length;

  const collectionStatus = portalDiagnostics.complete ? "complete" : "partial";
  return {
    ok: true,
    collectionStatus,
    degraded: collectionStatus === "partial",
    mode: "full",
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
      mode: "full",
      portalConcurrency: dueConcurrency,
      sourceRecovery: "0.9.7.4.2-snapshot-continuity-rss-first",
      healthyMaxRefreshMinutes: 5,
      failedMaxSilenceMinutes: 10,
      monitoringConcurrency: 3,
      socialConcurrency: 3,
      portalsDue: due.length,
      portalsDeferred: feeds.length - due.length,
      externalPortalRequests: requestBudget.used,
      externalPortalLimit: safeExternalRequestLimit,
    },
  };
}

export const FAST_LANE_FEEDS = Object.freeze(FEEDS.filter((feed) => FAST_LANE_SOURCE_IDS.includes(feed.id)));
