const STORAGE_TOKEN = "ronda-editorial-operation-token-v1";
const state = {
  data: null,
  health: null,
  query: "",
  period: 1440,
  source: "Todos",
  region: "Todas",
  editoria: "Todas",
  portal: null,
  view: "round",
  expanded: new Set(),
  running: false,
  lastRunId: null,
  carouselText: "",
  activeCarousel: null,
  smartCarousels: new Map(),
  activeTopicId: null,
  carouselLoading: false,
  carouselRequestSerial: 0,
  monitoringTerms: [],
  monitoringTermsLimit: 6,
  monitoringTermFilter: "all",
  statusEtag: "",
  latestEtag: "",
  serverRunning: false,
  attemptDiagnostics: null,
  lastAttemptId: null,
  newsroomData: null,
  newsroomLoading: false,
  profile: null,
  profileLoading: false,
  activeSlideCount: 7,
  pendingCarouselTopicId: null,
  carouselEdited: false,
  crawlItems: [],
  crawlLoading: false,
  crawlEtag: "",
};

const numberFormat = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const runButton = document.getElementById("runRound");
const grid = document.getElementById("topicsGrid");
const liveDot = document.getElementById("liveDot");
const statusLabel = document.getElementById("statusLabel");
const statusSub = document.getElementById("statusSub");
const roundView = document.getElementById("roundView");
const sourcesView = document.getElementById("sourcesView");
const monitoringView = document.getElementById("monitoringView");
const newsroomView = document.getElementById("newsroomView");
const productionView = document.getElementById("productionView");
const crawlView = document.getElementById("crawlView");
const profileView = document.getElementById("profileView");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return /^https?:$/.test(url.protocol) ? url.toString() : "#";
  } catch {
    return "#";
  }
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dateFormat.format(date).replace(",", "") : "Data não informada";
}

function relativeTime(value) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `há ${hours}h` : `há ${Math.floor(hours / 24)}d`;
}

function setStatus(type, label, sub) {
  liveDot.className = `live ${type || ""}`;
  statusLabel.textContent = label;
  statusSub.textContent = sub;
}

function roundDiagnosticsSummary(diagnostics) {
  const portals = diagnostics?.portals || diagnostics || {};
  const total = Number(portals.total) || 0;
  const withContent = Number(portals.withContent) || 0;
  const failed = Number(portals.failed) || 0;
  const degraded = Number(portals.degraded) || 0;
  const cached = Number(portals.cached) || 0;
  if (!total) return "A tentativa não trouxe diagnóstico por fonte.";
  const parts = [`${withContent}/${total} fontes com conteúdo`];
  if (cached) parts.push(`${cached} em cache`);
  if (degraded) parts.push(`${degraded} degradadas`);
  if (failed) parts.push(`${failed} falharam`);
  return parts.join(" · ");
}

function lastValidRoundLabel() {
  const value = state.data?.collectedAt || state.data?.storedAt || state.health?.lastSuccessAt;
  return value ? `Última ronda válida ${relativeTime(value)}` : "Nenhuma ronda válida disponível";
}

async function parseApiResponse(response) {
  const payload = response.status === 204 || response.status === 304 ? null : await response.json().catch(() => null);
  if (!response.ok && response.status !== 304) {
    const parts = [payload?.error, payload?.detail].filter((value, index, list) => value && list.indexOf(value) === index);
    const error = new Error(parts.join(" — ") || `Falha HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return { payload, etag: response.headers.get("ETag") || "", notModified: response.status === 304 };
}

async function api(path, options = {}) {
  const response = await fetch(path, { cache: "no-cache", credentials: "same-origin", ...options });
  return (await parseApiResponse(response)).payload;
}

async function conditionalApi(path, etag = "") {
  const response = await fetch(path, {
    cache: "no-cache",
    credentials: "same-origin",
    headers: etag ? { "If-None-Match": etag } : {},
  });
  return parseApiResponse(response);
}

function renderCrawl() {
  const list = document.getElementById("crawlList");
  const meta = document.getElementById("crawlMeta");
  if (!list || !meta) return;
  const items = Array.isArray(state.crawlItems) ? state.crawlItems : [];
  meta.textContent = items.length ? `${items.length} notícias já captadas · nenhum scraping ou IA acionado por esta tela` : "Nenhuma notícia captada no período.";
  if (!items.length) {
    list.innerHTML = `<div class="empty"><strong>Nenhuma notícia recente</strong><span>O Crawl só exibe itens que já existem na memória de captura.</span></div>`;
    return;
  }
  list.innerHTML = items.map((item) => {
    const when = item.firstSeenAt || item.publishedAt || item.lastSeenAt;
    const href = safeUrl(item.url);
    return `<article class="crawl-item"><div class="crawl-item-main"><div class="crawl-source"><strong>${escapeHtml(item.sourceName || item.sourceId || "Fonte")}</strong><span>${escapeHtml(relativeTime(when))}</span></div><h3>${escapeHtml(item.title || "Sem título")}</h3><small>${escapeHtml(formatDate(when))}</small></div><a class="open crawl-open" href="${href}" target="_blank" rel="noopener noreferrer">Abrir matéria ↗</a></article>`;
  }).join("");
}

async function loadCrawl({ force = false } = {}) {
  if (state.crawlLoading) return;
  state.crawlLoading = true;
  const refresh = document.getElementById("refreshCrawl");
  if (refresh) refresh.disabled = true;
  try {
    const response = await conditionalApi("/api/crawl?limit=100&hours=6", force ? "" : state.crawlEtag);
    if (!response.notModified) {
      state.crawlItems = response.payload?.items || [];
      state.crawlEtag = response.etag || "";
    }
    renderCrawl();
  } catch (error) {
    const list = document.getElementById("crawlList");
    if (list) list.innerHTML = `<div class="empty"><strong>Não foi possível ler o Crawl</strong><span>${escapeHtml(error.message || "Erro de leitura")}</span></div>`;
  } finally {
    state.crawlLoading = false;
    if (refresh) refresh.disabled = false;
  }
}

function itemMatchesSource(item) {
  const matchesType = state.source === "Todos" || (state.source === "Portal" ? item.kind === "portal" : item.kind === "social");
  const matchesPortal = !state.portal || item.collectorName === state.portal || item.sourceName === state.portal;
  const matchesRegion = state.region === "Todas" || item.region === state.region;
  return matchesType && matchesPortal && matchesRegion;
}

function itemRadarTime(item) {
  // Eventos editoriais atualizados precisam permanecer visíveis na Principal.
  // radarAt representa descoberta/novidade real da redação e não substitui o publishedAt original.
  const radar = Date.parse(item?.radarAt || "");
  const published = Date.parse(item?.publishedAt || "");
  if (item?.editorialEventId && Number.isFinite(radar)) {
    if (!Number.isFinite(published) || radar > published) return item.radarAt;
  }
  if (state.period <= 60) return item.radarAt || item.firstSeenAt || item.discoveredAt || item.publishedAt;
  return item.publishedAt || item.radarAt || item.firstSeenAt || item.discoveredAt;
}

function itemWithinPeriod(item) {
  const age = (Date.now() - Date.parse(itemRadarTime(item))) / 60_000;
  return Number.isFinite(age) && age >= -5 && age <= state.period;
}

function sourceMarkup(item, primary = false) {
  const platform = item.platform || (item.kind === "portal" ? "Portal" : "Rede");
  const discoveryTime = item.firstSeenAt || item.discoveredAt || null;
  const detection = discoveryTime && Number.isFinite(Date.parse(discoveryTime))
    ? `<span title="Primeira detecção pelo Ronda">Detectado ${escapeHtml(relativeTime(discoveryTime))}</span>`
    : "";
  return `<div class="${primary ? "primary-source" : "source"}"><div><div class="kicker"><span class="kind ${escapeHtml(platform.toLowerCase())}">${escapeHtml(platform)}</span><span class="source-name-label">${escapeHtml(item.sourceName)}</span><span>Publicado ${escapeHtml(formatDate(item.publishedAt))}</span>${detection}</div><h3>${escapeHtml(item.title)}</h3><div class="source-footer"><a class="open" href="${escapeHtml(safeUrl(item.url))}" target="_blank" rel="noreferrer">Abrir para apuração ↗</a></div></div></div>`;
}

function sourceInitials(name) {
  return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function sourceRegion(source) {
  return source?.region || (source?.name === "Bluesky" ? "Rede" : "Brasil");
}

function sourceRouteLabel(source, compact = false) {
  const route = String(source?.route || "");
  if (route === "not-modified") return compact ? "304" : "sem alteração no feed";
  if (source?.cached || route === "cache") return compact ? "cache" : source?.deferred ? "cache programado" : "cache recente";
  if (route.includes("scrape")) return compact ? "web" : route.includes("direct") ? "feed + scraping direto" : "scraping direto";
  if (source?.fallback || route.includes("fallback")) return compact ? "alt" : "rota alternativa";
  if (route === "no-new") return compact ? "sem novas" : "sem novas publicações";
  if (source?.ok && Number(source?.count) > 0) return compact ? "dir" : "coleta direta";
  return "";
}

function sourceFailureLabel(source, compact = false) {
  const labels = {
    blocked: compact ? "403" : "acesso bloqueado",
    "rate-limited": compact ? "429" : "limite temporário",
    timeout: compact ? "timeout" : "tempo limite excedido",
    "not-found": compact ? "404" : "endereço não encontrado",
    "invalid-feed": compact ? "feed" : "feed inválido",
    "budget-exhausted": compact ? "limite" : "limite seguro atingido",
    "upstream-error": compact ? `HTTP ${source?.httpStatus || "5xx"}` : "erro temporário do portal",
  };
  return labels[source?.errorCode] || (source?.httpStatus ? `HTTP ${source.httpStatus}` : compact ? "erro" : "erro de coleta");
}

function sourceDiagnosticTitle(source) {
  const parts = [source.name];
  parts.push(source.ok ? `Status: ${sourceRouteLabel(source) || "fonte acessível"}` : `Status: ${sourceFailureLabel(source)}`);
  if (source.httpStatus) parts.push(`HTTP: ${source.httpStatus}`);
  if (Number(source.collectedCount ?? source.count) > 0) parts.push(`Coletados: ${Number(source.collectedCount ?? source.count)}`);
  if (Number(source.translationAvailableCount) > 0) parts.push(`Disponíveis em português: ${Number(source.translationAvailableCount)}`);
  if (Number(source.translationPendingCount) > 0) parts.push(`Aguardando tradução: ${Number(source.translationPendingCount)}`);
  if (source.lastSuccessAt) parts.push(`Último sucesso: ${formatDate(source.lastSuccessAt)}`);
  if (source.nextCheckAt) parts.push(`Próxima verificação: ${formatDate(source.nextCheckAt)}`);
  if (source.responseMs != null) parts.push(`Resposta: ${source.responseMs} ms`);
  if (source.warning || source.error) parts.push(`Detalhe: ${source.warning || source.error}`);
  return parts.join(" | ");
}

function portalCardMarkup(source) {
  const available = source.ok && Number(source.count) > 0;
  const portalAttribute = available ? `data-portal="${escapeHtml(source.name)}"` : "disabled";
  const route = sourceRouteLabel(source);
  const collectedCount = Number(source.collectedCount ?? source.count) || 0;
  const translationPending = Number(source.translationPendingCount) || 0;
  const coverage = source?.coverage || null;
  const h1 = Number(coverage?.counts?.h1) || 0;
  const coverageSuffix = coverage ? ` · ${h1}/h · cobertura ${coverage.label || "—"}` : "";
  const detail = available
    ? `${Number(source.count)} ${Number(source.count) === 1 ? "conteúdo disponível" : "conteúdos disponíveis"}${coverageSuffix}${route ? ` · ${route}` : ""}${translationPending ? ` · ${translationPending} aguardando tradução` : ""}`
    : source.ok && translationPending ? `${collectedCount} coletados · aguardando tradução`
    : source.ok ? `Nenhuma notícia recente${source.nextCheckAt ? ` · próxima ${relativeTime(source.nextCheckAt)}` : ""}` : sourceFailureLabel(source);
  const stateClass = source.ok ? `ok${source.cached ? " cache" : ""}${source.degraded ? " degraded" : ""}` : `error ${escapeHtml(source.errorCode || "failed")}`;
  return `<button class="portal-card ${stateClass}${state.portal === source.name ? " selected" : ""}" ${portalAttribute} type="button" title="${escapeHtml(sourceDiagnosticTitle(source))}"><span class="portal-icon">${escapeHtml(sourceInitials(source.name))}</span><span class="portal-card-copy"><strong>${escapeHtml(source.name)}</strong><small>${escapeHtml(detail)}</small></span><span class="portal-state">${available ? "Ver notícias →" : source.ok ? "Sem novas" : escapeHtml(sourceFailureLabel(source, true))}</span></button>`;
}

function renderPortalCards() {
  const holder = document.getElementById("sourcePortalGrid");
  const sources = state.data?.sources || [];
  if (!sources.length) {
    holder.innerHTML = '<div class="empty sources-empty"><strong>Nenhuma fonte consultada ainda</strong><span>Execute uma ronda para carregar os portais.</span></div>';
    return;
  }
  holder.innerHTML = ["Brasil", "Mundo", "Rede"].map((region) => {
    const regionalSources = sources.filter((source) => sourceRegion(source) === region);
    if (!regionalSources.length) return "";
    const label = region === "Rede" ? "Complemento social" : region;
    const available = regionalSources.filter((source) => source.ok && Number(source.count) > 0).length;
    return `<section class="source-region-group"><div class="source-region-heading"><h3>${escapeHtml(label)}</h3><span>${available}/${regionalSources.length} ${regionalSources.length === 1 ? "fonte disponível" : "fontes disponíveis"}</span></div><div class="source-region-grid">${regionalSources.map(portalCardMarkup).join("")}</div></section>`;
  }).join("");
}

function renderSourceHealth(message = "", warning = false) {
  const holder = document.getElementById("sourceHealth");
  if (message) {
    holder.innerHTML = `<span class="health-message ${warning ? "warn" : ""}">${escapeHtml(message)}</span><button class="source-health-link" id="openSourcesFromHealth" type="button">Ver diagnóstico</button>`;
    bindSourceHealthLink();
    return;
  }
  const attemptSources = Array.isArray(state.attemptDiagnostics?.sources) ? state.attemptDiagnostics.sources : [];
  const sources = attemptSources.length ? attemptSources : state.data?.sources || [];
  if (!sources.length) {
    holder.innerHTML = '<span class="health-label">Fontes ainda não consultadas</span><button class="source-health-link" id="openSourcesFromHealth" type="button">Ver fontes</button>';
    bindSourceHealthLink();
    return;
  }
  const portals = sources.filter((source) => sourceRegion(source) !== "Rede");
  const operational = portals.filter((source) => source.ok).length;
  const collected = portals.filter((source) => source.ok && Number(source.collectedCount ?? source.count) > 0).length;
  const available = portals.filter((source) => source.ok && Number(source.count) > 0).length;
  const translationPending = portals.filter((source) => Number(source.translationPendingCount) > 0).length;
  const cached = portals.filter((source) => source.ok && source.cached).length;
  const attention = portals.filter((source) => !source.ok || source.degraded).length;
  const lowCoverage = portals.filter((source) => source?.coverage?.label === "baixa").length;
  const prefix = attemptSources.length ? "Última tentativa · dados da ronda válida preservados" : "Fontes";
  const parts = [`${operational}/${portals.length} operacionais`, `${collected} com coleta`, `${available} disponíveis`];
  if (translationPending) parts.push(`${translationPending} aguardando tradução`);
  if (cached) parts.push(`${cached} em cache`);
  if (attention) parts.push(`${attention} com atenção`);
  if (lowCoverage) parts.push(`${lowCoverage} com cobertura baixa`);
  holder.innerHTML = `<span class="health-label"><strong>${escapeHtml(prefix)}</strong> · ${parts.map(escapeHtml).join(" · ")}</span><button class="source-health-link" id="openSourcesFromHealth" type="button">Ver fontes</button>`;
  bindSourceHealthLink();
}

function bindSourceHealthLink() {
  document.getElementById("openSourcesFromHealth")?.addEventListener("click", () => {
    state.portal = null;
    updatePortalFilter();
    showView("sources");
    renderPortalCards();
    document.getElementById("workspaceTop").scrollIntoView({ behavior: "smooth" });
  });
}

function setSourceSegment(value) {
  state.source = value;
  document.querySelectorAll("#sourceFilter button").forEach((button) => button.classList.toggle("active", button.dataset.value === value));
}

function setRegionSegment(value) {
  state.region = value;
  document.querySelectorAll("#regionFilter button").forEach((button) => button.classList.toggle("active", button.dataset.value === value));
}

function updatePortalFilter() {
  const holder = document.getElementById("portalFilter");
  holder.hidden = !state.portal;
  document.getElementById("portalFilterName").textContent = state.portal || "";
}

function showView(view) {
  if (view !== "profile" && state.profile && !state.profile.authenticated) view = "profile";
  state.view = view;
  roundView.hidden = view !== "round";
  sourcesView.hidden = view !== "sources";
  monitoringView.hidden = view !== "monitoring";
  newsroomView.hidden = view !== "newsroom";
  productionView.hidden = view !== "production";
  crawlView.hidden = view !== "crawl";
  profileView.hidden = view !== "profile";
  document.getElementById("sourceHealth").hidden = view !== "round";
  document.getElementById("navRound").classList.toggle("active", view === "round");
  document.getElementById("navSources").classList.toggle("active", view === "sources");
  document.getElementById("navMonitoring").classList.toggle("active", view === "monitoring");
  document.getElementById("navNewsroom").classList.toggle("active", view === "newsroom");
  document.getElementById("navProduction").classList.toggle("active", view === "production");
  document.getElementById("navCrawl").classList.toggle("active", view === "crawl");
  document.getElementById("navProfile").classList.toggle("active", view === "profile");
  if (view === "sources") renderPortalCards();
  if (view === "crawl") loadCrawl();
  if (view === "monitoring") {
    loadMonitoringTerms();
    renderDedicatedMonitoring();
  }
  if (view === "profile") loadProfile({ force: true });
}

function operationHeaders() {
  const token = operationToken();
  return { "Content-Type": "application/json", ...(token ? { "X-Round-Token": token } : {}) };
}

function handleConfigurationError(error, messageId) {
  document.getElementById(messageId).textContent = error.message;
  if (error.status === 401) {
    document.getElementById("tokenMessage").textContent = "Informe a chave do Worker para alterar os termos monitorados.";
    openModal("settingsModal");
  }
}


function renderMonitoringTerms() {
  const holder = document.getElementById("monitoringTermsList");
  const activeTerms = state.monitoringTerms.filter((term) => term.active);
  document.getElementById("monitoringTermsLimit").textContent = `${activeTerms.length}/${state.monitoringTermsLimit} ativos`;
  if (!state.monitoringTerms.length) {
    holder.innerHTML = '<div class="empty config-empty"><strong>Nenhum termo cadastrado</strong><span>Exemplo: Vini Jr, inteligência artificial ou nome de uma empresa.</span></div>';
  } else {
    holder.innerHTML = state.monitoringTerms.map((term) => `<article class="config-row term-row ${term.active ? "" : "inactive"}"><div class="config-status">${term.active ? "Ativo" : "Pausado"}</div><div class="config-main"><strong>${escapeHtml(term.term)}</strong><small>${term.active ? "busca dedicada em todas as rondas" : "resultados ocultos e busca pausada"}</small></div><div class="config-actions"><button class="secondary" data-term-toggle="${escapeHtml(term.id)}" data-next-active="${term.active ? "false" : "true"}" type="button">${term.active ? "Pausar" : "Ativar"}</button><button class="danger-button" data-term-delete="${escapeHtml(term.id)}" type="button">Remover</button></div></article>`).join("");
  }
  if (!activeTerms.some((term) => term.id === state.monitoringTermFilter)) state.monitoringTermFilter = "all";
  renderDedicatedMonitoring();
}

async function loadMonitoringTerms() {
  try {
    const response = await api(`/api/monitoring-terms?t=${Date.now()}`);
    state.monitoringTerms = Array.isArray(response?.terms) ? response.terms : [];
    state.monitoringTermsLimit = Number(response?.limits?.maximumActive) || 6;
    renderMonitoringTerms();
  } catch (error) {
    document.getElementById("monitoringTermsList").innerHTML = `<div class="empty config-empty"><strong>Não foi possível carregar os termos</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

async function submitMonitoringTerm(event) {
  event.preventDefault();
  const message = document.getElementById("monitoringTermMessage");
  message.textContent = "Salvando…";
  try {
    await api("/api/monitoring-terms", {
      method: "POST",
      headers: operationHeaders(),
      body: JSON.stringify({ term: document.getElementById("monitoringTermInput").value }),
    });
    event.currentTarget.reset();
    message.textContent = "Termo adicionado. Os resultados chegarão na próxima ronda automática.";
    await loadMonitoringTerms();
  } catch (error) {
    handleConfigurationError(error, "monitoringTermMessage");
  }
}

async function changeMonitoringTerm(id, options) {
  const message = document.getElementById("monitoringTermMessage");
  message.textContent = "Atualizando termo…";
  try {
    await api(`/api/monitoring-terms/${encodeURIComponent(id)}`, {
      method: options.delete ? "DELETE" : "PATCH",
      headers: operationHeaders(),
      ...(options.delete ? {} : { body: JSON.stringify({ active: options.active }) }),
    });
    message.textContent = options.delete ? "Termo removido e resultados ocultados." : options.active ? "Termo reativado." : "Termo pausado e resultados ocultados.";
    await loadMonitoringTerms();
  } catch (error) {
    handleConfigurationError(error, "monitoringTermMessage");
  }
}

function renderDedicatedMonitoring() {
  const filterHolder = document.getElementById("monitoringTermFilters");
  const newsHolder = document.getElementById("dedicatedNewsList");
  const activeTerms = state.monitoringTerms.filter((term) => term.active);
  const allowedIds = new Set(activeTerms.map((term) => term.id));
  const monitoring = state.data?.dedicatedMonitoring || {};
  const allItems = (monitoring.items || []).filter((item) => (item.matchedTerms || [{ id: item.monitoringTermId }]).some((term) => allowedIds.has(term.id)));
  const visible = state.monitoringTermFilter === "all"
    ? allItems
    : allItems.filter((item) => (item.matchedTerms || [{ id: item.monitoringTermId }]).some((term) => term.id === state.monitoringTermFilter));
  filterHolder.innerHTML = activeTerms.length
    ? `<button class="${state.monitoringTermFilter === "all" ? "active" : ""}" data-monitoring-filter="all" type="button">Todos · ${allItems.length}</button>${activeTerms.map((term) => {
      const count = allItems.filter((item) => (item.matchedTerms || [{ id: item.monitoringTermId }]).some((match) => match.id === term.id)).length;
      return `<button class="${state.monitoringTermFilter === term.id ? "active" : ""}" data-monitoring-filter="${escapeHtml(term.id)}" type="button">${escapeHtml(term.term)} · ${count}</button>`;
    }).join("")}`
    : "";
  document.getElementById("dedicatedMonitoringMeta").textContent = state.data?.collectedAt
    ? `${visible.length} resultado${visible.length === 1 ? "" : "s"} · ${relativeTime(state.data.collectedAt)}`
    : "Aguardando a primeira ronda";
  if (!activeTerms.length) {
    newsHolder.innerHTML = '<div class="empty"><strong>Nenhum termo ativo</strong><span>Adicione ou reative um termo para iniciar a busca dedicada.</span></div>';
    return;
  }
  if (!visible.length) {
    newsHolder.innerHTML = '<div class="empty"><strong>Nenhuma notícia encontrada na última ronda</strong><span>O termo continuará sendo procurado automaticamente a cada cinco minutos.</span></div>';
    return;
  }
  newsHolder.innerHTML = visible.map((item) => {
    const tags = (item.matchedTerms || [{ id: item.monitoringTermId, term: item.monitoringTerm }])
      .filter((term) => allowedIds.has(term.id))
      .map((term) => `<span>${escapeHtml(term.term)}</span>`)
      .join("");
    return `<article class="dedicated-news"><div class="dedicated-news-meta"><strong>${escapeHtml(item.sourceName || item.collectorName || "Fonte não informada")}</strong><time>${escapeHtml(formatDate(item.publishedAt))}</time></div><div class="dedicated-tags">${tags}</div><h3>${escapeHtml(item.title)}</h3>${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}<a href="${escapeHtml(safeUrl(item.url))}" target="_blank" rel="noreferrer">Abrir notícia ↗</a></article>`;
  }).join("");
}


function newsroomQueueLabel(queue){return ({now:"Pautar agora",rising:"Subindo",watch:"Acompanhar",quiet:"Sem novidade"})[queue]||"Acompanhar";}
function newsroomVerificationLabel(level){return level==="official"?"Fonte oficial":level==="cross"?"2+ fontes":"Fonte única";}
function newsroomStatusOptions(value){const labels={discovered:"Descoberto",selected:"Selecionado",investigating:"Em apuração",confirmed:"Confirmado",production:"Produção",published:"Publicado",discarded:"Descartado"};return Object.entries(labels).map(([key,label])=>`<option value="${key}"${key===value?" selected":""}>${label}</option>`).join("");}
function newsroomStoryMarkup(story){const change=story.changeSummary?.text||"Sem mudança editorial relevante";return `<article class="newsroom-story" data-story-id="${escapeHtml(story.id)}"><div class="story-top"><span class="story-editoria">${escapeHtml(story.editoria)}</span><span class="story-verification ${escapeHtml(story.verificationLevel)}">${escapeHtml(newsroomVerificationLabel(story.verificationLevel))}</span></div><h4>${escapeHtml(story.title)}</h4><p class="story-change">${escapeHtml(change)}</p><div class="story-meta"><span>Índice ${Number(story.score)||0}</span><span>${Number(story.sourceCount)||0} fontes</span><span>${story.assigneeUserId?"Com responsável":"Sem responsável"}</span><span>${escapeHtml(relativeTime(story.lastChangedAt))}</span></div><div class="story-actions"><select data-story-status>${newsroomStatusOptions(story.workflowStatus)}</select><button class="secondary" data-story-assume type="button">Assumir</button></div><div class="story-secondary-actions"><button data-story-follow type="button">Seguir</button><button data-story-note type="button">+ Nota</button></div></article>`;}
function renderNewsroom(){const payload=state.newsroomData||{};const stories=payload.stories||[];const handoff=payload.handoff||{};const counters=handoff.counters||{};document.getElementById("newsroomUrgent").textContent=counters.urgent||stories.filter(s=>s.queue==="now").length;document.getElementById("newsroomChanged").textContent=counters.changed||0;document.getElementById("newsroomInvestigating").textContent=counters.investigating||0;document.getElementById("newsroomUnassigned").textContent=counters.unassigned||0;document.getElementById("newsroomUpdated").textContent=stories[0]?.updatedAt?`Atualizada ${relativeTime(stories[0].updatedAt)}`:"Sem dados";const queues=["now","rising","watch","quiet"];document.getElementById("newsroomBoard").innerHTML=queues.map(queue=>{const rows=stories.filter(story=>story.queue===queue&&!["published","discarded"].includes(story.workflowStatus));return `<section class="newsroom-column"><div class="newsroom-column-head"><h3>${newsroomQueueLabel(queue)}</h3><span>${rows.length}</span></div>${rows.length?rows.slice(0,20).map(newsroomStoryMarkup).join(""):'<div class="empty"><strong>Sem pautas</strong><span>Nenhuma pauta nesta fila.</span></div>'}</section>`;}).join("");document.getElementById("newsroomHandoff").innerHTML=`<div class="handoff-counters"><div><strong>${counters.discovered||0}</strong><span>novas pautas</span></div><div><strong>${counters.changed||0}</strong><span>mudanças</span></div><div><strong>${counters.investigating||0}</strong><span>em apuração</span></div><div><strong>${counters.unassigned||0}</strong><span>sem responsável</span></div></div><div class="handoff-list">${(handoff.events||[]).slice(0,12).map(event=>`<article class="handoff-item"><strong>${escapeHtml(event.title||"Pauta")}</strong><p>${escapeHtml(event.summary)} · ${escapeHtml(relativeTime(event.createdAt))}</p></article>`).join("")||'<div class="empty"><strong>Sem mudanças recentes</strong><span>A próxima ronda atualizará a passagem.</span></div>'}</div>`;}
async function loadNewsroom({quiet=false}={}){if(state.newsroomLoading)return state.newsroomData;state.newsroomLoading=true;try{state.newsroomData=await api("/api/newsroom?hours=8");renderNewsroom();return state.newsroomData;}catch(error){if(!quiet)document.getElementById("newsroomBoard").innerHTML=`<div class="empty"><strong>Falha ao carregar a Mesa</strong><span>${escapeHtml(error.message)}</span></div>`;return null;}finally{state.newsroomLoading=false;}}
async function patchNewsroomStory(id,patch){try{await api(`/api/newsroom/stories/${encodeURIComponent(id)}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(patch)});await loadNewsroom();}catch(error){if(error.status===401){showView("profile");document.getElementById("workspaceTop").scrollIntoView({behavior:"smooth"});}else alert(error.message);}}
async function addNewsroomNote(id){const note=prompt("Nota editorial para esta pauta:");if(!note)return;try{await api(`/api/newsroom/stories/${encodeURIComponent(id)}/notes`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({note})});await loadNewsroom();}catch(error){if(error.status===401)showView("profile");else alert(error.message);}}
async function toggleNewsroomFollow(id){try{await api(`/api/newsroom/stories/${encodeURIComponent(id)}/follow`,{method:"POST"});await loadNewsroom();}catch(error){if(error.status===401)showView("profile");else alert(error.message);}}
function resetRoundFilters() {
  state.query = "";
  state.period = 1440;
  state.source = "Todos";
  state.region = "Todas";
  state.editoria = "Todas";
  state.portal = null;
  state.expanded.clear();
  document.getElementById("searchInput").value = "";
  document.querySelectorAll("#periodFilter button").forEach((button) => button.classList.toggle("active", button.dataset.value === "1440"));
  setSourceSegment("Todos");
  setRegionSegment("Todas");
  document.querySelectorAll("#editoriaFilter [data-editoria]").forEach((button) => button.classList.toggle("active", button.dataset.editoria === "Todas"));
  updatePortalFilter();
  renderSourceHealth();
  render();
}

function filterByPortal(name) {
  state.portal = name || null;
  const matchingItem = (state.data?.items || []).find((item) => item.collectorName === name || item.sourceName === name);
  const matchingSource = (state.data?.sources || []).find((source) => source.name === name);
  setSourceSegment(name ? (name === "Bluesky" || matchingItem?.kind === "social" ? "Rede" : "Portal") : "Todos");
  setRegionSegment(name && sourceRegion(matchingSource) !== "Rede" ? sourceRegion(matchingSource) : "Todas");
  state.expanded.clear();
  showView("round");
  updatePortalFilter();
  renderSourceHealth();
  renderPortalCards();
  render();
  document.querySelector(".controls").scrollIntoView({ behavior: "smooth", block: "start" });
}

function render() {
  const topics = state.data?.topics || [];
  const query = state.query.trim().toLocaleLowerCase("pt-BR");
  const visible = topics
    .map((topic) => ({ ...topic, items: (topic.items || []).filter((item) => itemWithinPeriod(item) && itemMatchesSource(item)) }))
    .filter((topic) => topic.items.length && (state.editoria === "Todas" || (topic.editoria || "Notícias") === state.editoria) && (!query || `${topic.title} ${topic.items.map((item) => `${item.sourceName} ${item.title}`).join(" ")}`.toLocaleLowerCase("pt-BR").includes(query)));

  document.getElementById("summaryTopics").textContent = visible.length;
  document.getElementById("summaryContents").textContent = visible.reduce((sum, topic) => sum + topic.items.length, 0);
  document.getElementById("summaryChannels").textContent = new Set(visible.flatMap((topic) => topic.items.map((item) => item.sourceName))).size;
  document.getElementById("summaryUrgent").textContent = visible.filter((topic) => topic.tone === "urgent").length;
  updatePortalFilter();

  if (!state.data) {
    grid.innerHTML = '<div class="empty"><strong>Nenhuma ronda disponível</strong><span>A primeira coleta será executada pelo agendamento online ou pelo botão Executar ronda.</span></div>';
    return;
  }
  if (!visible.length) {
    grid.innerHTML = '<div class="empty"><strong>Nenhum assunto neste filtro</strong><span>Retire um filtro ou aguarde uma nova ronda.</span></div>';
    return;
  }

  grid.innerHTML = visible.map((topic) => {
    const items = [...topic.items].sort((left, right) => Date.parse(itemRadarTime(right)) - Date.parse(itemRadarTime(left)));
    const primary = items.find((item) => item.kind === "portal") || items[0];
    const additional = items.filter((item) => item.id !== primary.id);
    const sources = [...new Set(items.map((item) => item.sourceName))];
    const latest = itemRadarTime(items[0]);
    const open = state.expanded.has(topic.id);
    const editoria = topic.editoria || "Notícias";
    const carousel = topic.carousel || {};
    return `<article class="card ${escapeHtml(topic.tone)}"><div class="accent"></div><div class="card-body"><div class="topline"><div class="topic-labels"><span class="priority"><i></i>${escapeHtml(topic.priority)}</span><span class="editoria-badge">${escapeHtml(editoria)}</span></div><span class="score">Índice ${Number(topic.score) || 0}</span></div><h2>${escapeHtml(topic.title)}</h2><div class="card-sources"><span>Fontes</span>${sources.slice(0, 6).map((source) => `<span class="source-badge">${escapeHtml(source)}</span>`).join("")}${sources.length > 6 ? `<span class="source-badge">+${sources.length - 6}</span>` : ""}</div><div class="published"><span>${state.period <= 60 ? "Última detecção" : "Última postagem"}</span><strong>${escapeHtml(formatDate(latest))}</strong><span class="relative">${escapeHtml(relativeTime(latest))}</span></div><div class="momentum"><span class="trend">↗</span><span>${escapeHtml(topic.momentum)}</span><span class="calculated">calculado nesta ronda</span></div><div class="recommendation"><strong>Recomendação editorial:</strong> ${escapeHtml(topic.recommendation || "Confirmar as informações nas fontes originais antes de publicar.")}</div><div class="carousel-teaser"><div><span>Produção FORMA</span><strong>Leitura → Evidence Pack → Multi-AI → Quality Gate → Design</strong></div><div><span>Formato</span><strong>${escapeHtml(carousel.postModel || "Instagram · 7 slides")}</strong></div><button data-forma-topic="${escapeHtml(topic.id)}" data-editorial-event="${escapeHtml(topic.editorialEvent?.eventId||'')}" type="button">Produzir no FORMA →</button></div>${sourceMarkup(primary, true)}${additional.length ? `<button class="toggle" data-toggle="${escapeHtml(topic.id)}" aria-expanded="${open}" type="button"><span>${open ? "Ocultar outros conteúdos" : `Ver mais ${additional.length} ${additional.length === 1 ? "conteúdo" : "conteúdos"}`}</span><span>${open ? "⌃" : "⌄"}</span></button>` : ""}${open ? `<div class="source-list">${additional.map((item) => sourceMarkup(item)).join("")}</div>` : ""}</div></article>`;
  }).join("");

  grid.querySelectorAll("[data-toggle]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.toggle;
    state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
    render();
  }));
}

function applyRound(payload, { preserveExpansion = false } = {}) {
  if (!payload?.ok || !Array.isArray(payload.topics)) return;
  state.data = payload;
  state.lastRunId = payload.runId || state.lastRunId;
  state.attemptDiagnostics = null;
  state.lastAttemptId = null;
  if (!preserveExpansion) state.expanded.clear();
  document.getElementById("lastUpdate").textContent = `Última coleta: ${formatDate(payload.collectedAt)}`;
  renderSourceHealth();
  renderPortalCards();
  renderDedicatedMonitoring();
  render();
}

async function loadLatest({ quiet = false, force = false } = {}) {
  try {
    const response = await conditionalApi("/api/latest", force ? "" : state.latestEtag);
    if (response.notModified) return state.data;
    const previousRunId = state.lastRunId;
    state.latestEtag = response.etag;
    const payload = response.payload?.data;
    // Um 200 com o mesmo runId ainda pode conter atualização da Fast Lane/Mesa.
    // O ETag do /api/latest inclui a revisão do overlay editorial, portanto
    // todo payload novo precisa alimentar a página principal.
    if (payload?.ok) applyRound(payload, { preserveExpansion: Boolean(state.data && previousRunId && payload.runId === previousRunId && !force) });
    return payload;
  } catch (error) {
    if (!quiet) renderSourceHealth(error.message);
    return null;
  }
}

function openModal(id) {
  const modal = document.getElementById(id);
  modal.hidden = false;
  const panel = modal.querySelector(".modal");
  if (panel) panel.scrollTop = 0;
  const input = modal.querySelector("input");
  if (input) setTimeout(() => input.focus(), 0);
}

function closeModal(id) {
  document.getElementById(id).hidden = true;
  if (id === "carouselModal") state.carouselRequestSerial += 1;
}

function operationToken() {
  try { return localStorage.getItem(STORAGE_TOKEN) || ""; } catch { return ""; }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForRun(runId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await wait(attempt === 0 ? 1_000 : 2_500);
    try {
      const payload = await api(`/api/runs/${encodeURIComponent(runId)}`);
      const run = payload?.run;
      if (run?.status === "success") return run;
      if (["failed", "expired"].includes(run?.status)) {
        const error = new Error(run.error || "A ronda foi encerrada antes da conclusão.");
        error.run = run;
        throw error;
      }
      const queued = run?.status === "queued";
      setStatus("", queued ? "Ronda na fila" : "Ronda em andamento", queued ? "Aguardando o consumidor da Cloudflare" : `Coletando fontes… ${Math.min(99, 5 + attempt * 3)}%`);
    } catch (error) {
      if (error.status === 404) continue;
      throw error;
    }
  }
  throw new Error("A ronda continua no servidor. O painel será atualizado automaticamente quando ela terminar.");
}

async function executeRound(automatic = false) {
  if (state.running) return;
  const token = operationToken();
  if (state.health?.manualAuthRequired && !token) {
    document.getElementById("tokenMessage").textContent = "Informe a chave configurada no Worker para executar manualmente.";
    openModal("settingsModal");
    return;
  }
  state.running = true;
  runButton.disabled = true;
  runButton.classList.add("loading");
  runButton.innerHTML = "<span>↻</span>Coletando fontes…";
  setStatus("", "Ronda em andamento", "Consultando portais e fontes sociais");
  try {
    const payload = await api("/api/round", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { "X-Round-Token": token } : {}) },
      body: JSON.stringify({ source: automatic ? "initial" : "button" }),
    });
    if (!payload?.runId && payload?.data?.ok) {
      applyRound(payload.data);
      const legacyTime = payload.data.collectedAt || payload.data.storedAt || new Date().toISOString();
      setStatus("ok", "Ronda concluída", `Coleta finalizada às ${new Date(legacyTime).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`);
      return;
    }
    if (!payload?.runId) throw new Error("O servidor retornou uma resposta de ronda incompatível. Publique todos os arquivos da mesma versão.");
    setStatus("", "Ronda iniciada", "O servidor está consultando os portais");
    await waitForRun(payload.runId);
    const completed = await loadLatest();
    if (!completed?.ok) throw new Error("A ronda terminou, mas o resultado ainda não foi carregado.");
    const completedAt = completed.collectedAt || completed.storedAt || new Date().toISOString();
    if (completed.collectionStatus === "partial" || completed.degraded) {
      setStatus("warn", "Ronda concluída parcialmente", `${roundDiagnosticsSummary(completed.diagnostics)} · dados disponíveis`);
    } else {
      setStatus("ok", "Ronda concluída", `Coleta finalizada às ${new Date(completedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`);
    }
  } catch (error) {
    if (error.status === 401) {
      document.getElementById("tokenMessage").textContent = "Chave incorreta. Confira a variável MANUAL_ROUND_TOKEN.";
      openModal("settingsModal");
    }
    const locked = error.status === 409 || error.status === 429;
    const pending = error.message.startsWith("A ronda continua no servidor");
    const failedRun = error.run && ["failed", "expired"].includes(error.run.status) ? error.run : null;
    if (failedRun?.diagnostics) {
      await loadLatest({ quiet: true, force: true });
      state.attemptDiagnostics = failedRun.diagnostics;
      state.lastAttemptId = failedRun.id || null;
      setStatus("warn", "Última tentativa falhou", `${roundDiagnosticsSummary(failedRun.diagnostics)} · ${lastValidRoundLabel()}`);
      renderSourceHealth();
    } else {
      setStatus(locked || pending ? "warn" : "error", pending ? "Ronda ainda em andamento" : locked ? "Ronda já em andamento" : "Falha ao executar a ronda", error.message);
      if (!pending) renderSourceHealth(error.message, locked);
    }
  } finally {
    state.running = false;
    runButton.disabled = false;
    runButton.classList.remove("loading");
    runButton.innerHTML = "<span>↻</span>Executar ronda";
    scheduleStatusPolling(500);
  }
}

async function checkHealth() {
  try {
    const health = await api("/api/health");
    if (!health || typeof health !== "object" || !health.version) throw new Error("A versão publicada do Worker não é compatível com este painel.");
    state.health = health;
    const translationReady = health.translation?.ready !== false;
    const automationMessage = !translationReady
      ? "Automação ativa; tradução internacional indisponível no Cloudflare."
      : health.schedulerHealthy
      ? "Automação online ativa e atualizada."
      : health.lastSuccessAt
        ? "Automação online configurada; a última ronda está atrasada."
        : "Serviço online pronto; aguardando a primeira ronda.";
    document.getElementById("automationText").textContent = `${automationMessage} A coleta continua com a janela fechada.`;
    setStatus(health.schedulerHealthy && translationReady ? "ok" : "warn", !translationReady ? "Tradução não configurada" : health.schedulerHealthy ? "Serviço online" : "Aguardando automação", !translationReady ? "O conteúdo internacional será ocultado" : health.lastSuccessAt ? `Última ronda ${relativeTime(health.lastSuccessAt)}` : "Execute a primeira ronda");
    return true;
  } catch (error) {
    state.health = null;
    setStatus("error", "Webapp não configurado", error.message);
    renderSourceHealth(error.message);
    document.getElementById("automationText").textContent = "Configuração incompleta no Cloudflare.";
    return false;
  }
}

async function showHistory() {
  openModal("historyModal");
  const holder = document.getElementById("historyList");
  const detail = document.getElementById("historyDetail");
  const back = document.getElementById("historyBack");
  holder.hidden = false;
  detail.hidden = true;
  back.hidden = true;
  holder.innerHTML = '<div class="loading-row">Carregando histórico…</div>';
  try {
    const payload = await api("/api/history?limit=50");
    const runs = payload?.runs || [];
    holder.innerHTML = runs.length ? runs.map((run) => {
      const active = ["queued", "running"].includes(run.status);
      const label = run.status === "success" ? "Concluída" : run.status === "queued" ? "Na fila" : run.status === "running" ? "Em andamento" : run.status === "expired" ? "Expirada" : "Falhou";
      const date = run.completed_at || run.started_at || run.queued_at;
      return `<button class="history-row" data-history-run="${escapeHtml(run.id)}" type="button" ${active ? "disabled" : ""}><span class="history-date"><strong>${escapeHtml(formatDate(date))}</strong><small>${run.trigger_type === "scheduled" ? "Automática" : "Manual"}</small></span><span class="history-status ${run.status}">${label}</span><span>${Number(run.items_count) || 0} conteúdos</span><span>${Number(run.topics_count) || 0} assuntos</span><span class="history-open"><strong>${Number(run.sources_count) || 0} fontes</strong><small>${active ? "Aguarde" : run.status === "success" ? "Ver notícias →" : "Ver diagnóstico"}</small></span></button>`;
    }).join("") : '<div class="loading-row">Nenhuma ronda armazenada.</div>';
  } catch (error) {
    holder.innerHTML = `<div class="loading-row">${escapeHtml(error.message)}</div>`;
  }
}

async function showHistoryDetail(runId) {
  const holder = document.getElementById("historyList");
  const detail = document.getElementById("historyDetail");
  const back = document.getElementById("historyBack");
  holder.hidden = true;
  detail.hidden = false;
  back.hidden = false;
  detail.innerHTML = '<div class="loading-row">Carregando as notícias desta ronda…</div>';
  try {
    const response = await api(`/api/runs/${encodeURIComponent(runId)}/data?t=${Date.now()}`);
    const data = response?.data || {};
    const run = response?.run || {};
    const items = [...(data.items || [])].sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
    const sourceCounts = new Map();
    for (const item of items) {
      const source = item.collectorName || item.sourceName || "Fonte não informada";
      sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
    }
    const sourceChips = [...sourceCounts.entries()].sort((left, right) => right[1] - left[1]).map(([name, count]) => `<span>${escapeHtml(name)} · ${count}</span>`).join("");
    const news = items.length ? items.map((item) => `<article class="history-news"><div class="history-news-meta"><span class="kind ${escapeHtml((item.platform || item.kind || "fonte").toLowerCase())}">${escapeHtml(item.platform || (item.kind === "social" ? "Rede" : "Portal"))}</span><strong>${escapeHtml(item.sourceName || item.collectorName || "Fonte não informada")}</strong><time>${escapeHtml(formatDate(item.publishedAt))}</time></div><h3>${escapeHtml(item.title)}</h3>${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}<a href="${escapeHtml(safeUrl(item.url))}" target="_blank" rel="noreferrer">Abrir para apuração ↗</a></article>`).join("") : '<div class="empty history-empty"><strong>Nenhuma notícia armazenada nesta ronda</strong><span>Consulte o estado das fontes ou selecione outra ronda.</span></div>';
    detail.innerHTML = `<section class="history-detail-head"><p class="eyebrow">Notícias apuradas neste período</p><h3>${escapeHtml(formatDate(run.completedAt || data.collectedAt))}</h3><p>${run.triggerType === "scheduled" ? "Ronda automática" : "Ronda manual"} · ${items.length} conteúdos · ${Number(data.totals?.topics) || 0} assuntos</p></section>${sourceChips ? `<div class="history-source-chips">${sourceChips}</div>` : ""}<div class="history-news-list">${news}</div>`;
  } catch (error) {
    detail.innerHTML = `<div class="loading-row">${escapeHtml(error.message)}</div>`;
  }
}

function topicVerificationLinks(topic) {
  const storedLinks = Array.isArray(topic?.carousel?.verificationLinks) ? topic.carousel.verificationLinks : [];
  const candidates = storedLinks.length ? storedLinks : (topic?.items || []);
  const links = [];
  const seen = new Set();
  for (const item of candidates) {
    const url = safeUrl(item?.url);
    if (url === "#" || seen.has(url)) continue;
    seen.add(url);
    links.push({
      title: item?.title || "Notícia sem título",
      sourceName: item?.sourceName || item?.collectorName || "Fonte não informada",
      publishedAt: item?.publishedAt || null,
      url,
    });
  }
  return links;
}

function entityLine(label, values) {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  return `${label}: ${list.length ? list.join(", ") : "Não identificado"}`;
}


function slideCountOptions(selected = 7) {
  const current = Number(selected) || 7;
  return Array.from({ length: 13 }, (_, index) => index + 3)
    .map((count) => `<option value="${count}" ${count === current ? "selected" : ""}>${count} slides</option>`)
    .join("");
}

function initializeSlideCountSelectors() {
  const defaultCount = Number(state.profile?.user?.defaultSlideCount) || 7;
  for (const id of ["profileDefaultSlideCount", "carouselSlideCount"]) {
    const select = document.getElementById(id);
    if (select) select.innerHTML = slideCountOptions(id === "carouselSlideCount" ? state.activeSlideCount || defaultCount : defaultCount);
  }
}

function profileStyleMarkup(profile) {
  if (!profile) return '<div class="empty"><strong>Perfil ainda não treinado</strong><span>Adicione exemplos e clique em Atualizar estilo.</span></div>';
  const chips = [...(profile.vocabulary || []).slice(0, 8), ...(profile.avoid || []).slice(0, 5).map((item) => `Evitar: ${item}`)];
  return `<div class="style-summary-grid">
    <article><small>Tom e ritmo</small><p><strong>${escapeHtml(profile.tone || "Não definido")}</strong><br>${escapeHtml(profile.rhythm || "")}</p></article>
    <article><small>Títulos</small><p>${escapeHtml(profile.titleStyle || "Não definido")}</p></article>
    <article><small>Subtítulos</small><p>${escapeHtml(profile.subtitleStyle || "Não definido")}</p></article>
    <article><small>Estrutura</small><p>${escapeHtml(profile.structure || "Não definida")}</p></article>
    <article><small>CTA</small><p>${escapeHtml(profile.ctaStyle || "Não definido")}</p></article>
    ${chips.length ? `<div class="style-chip-list">${chips.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
    <div class="profile-training-note ready">Estilo atualizado ${profile.updatedAt ? relativeTime(profile.updatedAt) : "agora"} · ${Number(profile.sampleCount) || 0} exemplo${Number(profile.sampleCount) === 1 ? "" : "s"} usado${Number(profile.sampleCount) === 1 ? "" : "s"}.</div>
  </div>`;
}

function referenceLabel(type){return ({text:'Texto',image:'Imagem',file:'Arquivo',video:'Vídeo'})[type]||'Referência';}
function profileReferenceMarkup(reference){const source=reference.sourceUrl?`<a class="reference-source-link" href="${escapeHtml(reference.sourceUrl)}" target="_blank" rel="noopener">Abrir origem ↗</a>`:'';const meta=[reference.fileName,reference.mimeType,reference.fileSize?`${Math.round(reference.fileSize/1024)} KB`:null].filter(Boolean).join(' · ');return `<article class="writing-sample-item"><div><span class="reference-type-badge">${referenceLabel(reference.type)}</span><strong>${escapeHtml(reference.title)}</strong><p>${meta?escapeHtml(meta)+' · ':''}${Number(reference.charCount)||0} caracteres · ${escapeHtml(relativeTime(reference.createdAt))}</p>${source}</div><button class="danger-button" data-profile-reference-delete="${escapeHtml(reference.id)}" type="button">Remover</button></article>`;}

function renderProfile() {
  const payload = state.profile || { authenticated: false };
  const loggedIn = Boolean(payload.authenticated && payload.user);
  if(!loggedIn){ location.replace(`/?next=${encodeURIComponent(location.pathname+location.search)}`); return; }
  const status=document.getElementById('profileSessionStatus');status.textContent='Perfil conectado';status.classList.add('active');
  initializeSlideCountSelectors();
  const user=payload.user; document.getElementById('profileUserName').textContent=user.displayName||'Perfil editorial';
  document.getElementById('profileUserEmail').textContent=`${user.email||''}${user.role?` · ${user.role==='admin'?'Administrador':user.role==='editor'?'Editor':'Usuário'}`:''}`;
  const adminLink=document.getElementById('adminDashboardLink');if(adminLink)adminLink.hidden=user.role!=='admin';
  document.getElementById('profileDefaultSlideCount').value=String(Number(user.defaultSlideCount)||7);
  const references=Array.isArray(payload.references)?payload.references:[];const limits=payload.limits||{};
  document.getElementById('profileReferenceUsage').textContent=`${references.length}/${Number(limits.maximumReferences)||32} referências · ${Number(limits.usedReferenceCharacters||0).toLocaleString('pt-BR')}/${Number(limits.maximumReferenceTotalCharacters||80000).toLocaleString('pt-BR')} caracteres`;
  document.getElementById('profileReferenceList').innerHTML=references.length?references.map(profileReferenceMarkup).join(''):'<div class="empty"><strong>Nenhuma referência adicionada</strong><span>Adicione textos, imagens, arquivos ou vídeos que representem a linguagem desejada.</span></div>';
  document.getElementById('writingProfileSummary').innerHTML=profileStyleMarkup(payload.writingProfile);
}

async function loadProfile({ force = false } = {}) {
  if (state.profileLoading) return state.profile;
  if (state.profile && !force) return state.profile;
  state.profileLoading = true;
  try {
    state.profile = await api(`/api/profile?t=${Date.now()}`);
    renderProfile();
    return state.profile;
  } catch (error) {
    document.getElementById("profileSessionStatus").textContent = "Perfil indisponível";
    if(error.status===401) location.replace(`/?next=${encodeURIComponent(location.pathname+location.search)}`);
    return null;
  } finally {
    state.profileLoading = false;
  }
}

async function logoutProfile() {
  await api("/api/auth/logout", { method: "POST" }).catch(() => null);
  state.profile = { authenticated: false };
  state.smartCarousels.clear();
  location.replace('/');
}

async function updateDefaultSlideCount(event) {
  const count = Number(event.target.value) || 7;
  try {
    const response = await api("/api/profile/preferences", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ defaultSlideCount: count }) });
    if (state.profile?.user && response?.user) state.profile.user = response.user;
    state.activeSlideCount = count;
    initializeSlideCountSelectors();
  } catch (error) {
    document.getElementById("writingProfileMessage").textContent = error.message;
  }
}

async function submitWritingSample(event) {
  event.preventDefault();
  const message = document.getElementById("writingSampleMessage");
  message.textContent = "Salvando exemplo…";
  try {
    state.profile = await api("/api/profile/samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: document.getElementById("writingSampleTitle").value,
        sourceType: document.getElementById("writingSampleType").value,
        content: document.getElementById("writingSampleContent").value,
      }),
    });
    event.currentTarget.reset();
    document.getElementById("writingSampleCounter").textContent = "0/5.000 caracteres";
    message.textContent = "Texto adicionado. Atualize o estilo para aplicar este exemplo aos próximos carrosséis.";
    renderProfile();
  } catch (error) {
    message.textContent = error.message;
  }
}

async function removeWritingSample(sampleId) {
  const message = document.getElementById("writingSampleMessage");
  message.textContent = "Removendo exemplo…";
  try {
    state.profile = await api(`/api/profile/samples/${encodeURIComponent(sampleId)}`, { method: "DELETE" });
    message.textContent = "Texto removido. Atualize o estilo para recalcular o perfil.";
    renderProfile();
  } catch (error) {
    message.textContent = error.message;
  }
}

async function rebuildWritingStyle() {
  const button = document.getElementById("rebuildWritingStyle");
  const message = document.getElementById("writingProfileMessage");
  button.disabled = true;
  message.textContent = "Analisando linguagem, ritmo, estrutura e repertório das referências…";
  try {
    state.profile = await api("/api/profile/style/rebuild", { method: "POST" });
    state.smartCarousels.clear();
    message.textContent = "Linguagem da IA atualizada e pronta para os próximos carrosséis.";
    renderProfile();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function loadWritingSampleFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const message = document.getElementById("writingSampleMessage");
  if (file.size > 100_000) {
    message.textContent = "O arquivo é grande demais. Use um arquivo de texto com até 100 KB.";
    event.target.value = "";
    return;
  }
  try {
    const text = await file.text();
    const maximum = Number(state.profile?.limits?.maximumCharactersPerSample) || 5_000;
    const content = text.slice(0, maximum);
    document.getElementById("writingSampleContent").value = content;
    if (!document.getElementById("writingSampleTitle").value) document.getElementById("writingSampleTitle").value = file.name.replace(/\.[^.]+$/, "").slice(0, 120);
    document.getElementById("writingSampleCounter").textContent = `${content.length.toLocaleString("pt-BR")}/${maximum.toLocaleString("pt-BR")} caracteres`;
    message.textContent = text.length > maximum ? `O arquivo foi limitado aos primeiros ${maximum.toLocaleString("pt-BR")} caracteres.` : "Arquivo carregado. Revise o conteúdo antes de salvar.";
  } catch {
    message.textContent = "Não foi possível ler este arquivo como texto.";
  }
}

let activeProfileReferenceType='text';
function setProfileReferenceTab(type){
  activeProfileReferenceType=type;document.querySelectorAll('[data-profile-ref-tab]').forEach(b=>b.classList.toggle('active',b.dataset.profileRefTab===type));
  const refPanel=document.getElementById('profileReferencePanel'),lang=document.getElementById('profileLanguagePanel');
  const special=type==='language';refPanel.hidden=special;lang.hidden=false;
  if(special)return;document.getElementById('profileReferenceType').value=type;
  const cfg={text:['Adicionar texto','Conteúdo do texto','Cole um texto que represente a linguagem que deseja aproximar.'],image:['Adicionar referência de imagem','Descrição da imagem','Use link + descrição do visual, tom, texto na arte ou linguagem que deve inspirar a IA.'],file:['Adicionar referência de arquivo','Conteúdo ou descrição','TXT/MD/CSV/JSON são lidos no navegador. Outros arquivos podem ser cadastrados por link + descrição.'],video:['Adicionar referência de vídeo','Transcrição ou descrição','Cadastre o link e uma transcrição/descrição dos trechos e linguagem que devem servir de referência.']};
  const c=cfg[type];document.getElementById('referenceFormTitle').textContent=c[0];document.getElementById('profileReferenceContentLabel').textContent=c[1];document.getElementById('referenceFormHelp').textContent=c[2];
  const file=document.getElementById('profileReferenceFile');file.accept=type==='image'?'image/*':type==='video'?'video/*':type==='file'?'.txt,.md,.csv,.json,.pdf,.doc,.docx,.rtf,application/pdf':'text/plain,text/markdown,text/csv,application/json,.txt,.md,.csv,.json';
}
async function submitProfileReference(event){event.preventDefault();const msg=document.getElementById('profileReferenceMessage');msg.textContent='Salvando referência…';const file=document.getElementById('profileReferenceFile').files?.[0]||null;try{state.profile=await api('/api/profile/references',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:document.getElementById('profileReferenceType').value,title:document.getElementById('profileReferenceTitle').value,sourceUrl:document.getElementById('profileReferenceUrl').value,content:document.getElementById('profileReferenceContent').value,notes:document.getElementById('profileReferenceNotes').value,fileName:file?.name||'',mimeType:file?.type||'',fileSize:file?.size||0})});event.currentTarget.reset();document.getElementById('profileReferenceCounter').textContent='0/8.000 caracteres';msg.textContent='Referência salva. Atualize a linguagem para incorporá-la aos próximos carrosséis.';renderProfile();setProfileReferenceTab(activeProfileReferenceType);}catch(error){msg.textContent=error.message;}}
async function deleteProfileReference(id){const msg=document.getElementById('profileReferenceMessage');try{state.profile=await api(`/api/profile/references/${encodeURIComponent(id)}`,{method:'DELETE'});msg.textContent='Referência removida. Atualize a linguagem para recalcular o perfil.';renderProfile();}catch(error){msg.textContent=error.message;}}
async function loadProfileReferenceFile(event){const file=event.target.files?.[0];if(!file)return;const msg=document.getElementById('profileReferenceMessage');if(!document.getElementById('profileReferenceTitle').value)document.getElementById('profileReferenceTitle').value=file.name.replace(/\.[^.]+$/,'').slice(0,120);const textLike=/^text\//.test(file.type)||/\.(txt|md|csv|json|html|rtf)$/i.test(file.name);if(textLike){if(file.size>250000){msg.textContent='Arquivo textual muito grande. Use até 250 KB ou cole somente o trecho de referência.';return;}try{const text=await file.text();const max=Number(state.profile?.limits?.maximumReferenceCharacters)||8000;document.getElementById('profileReferenceContent').value=text.slice(0,max);document.getElementById('profileReferenceCounter').textContent=`${Math.min(text.length,max).toLocaleString('pt-BR')}/${max.toLocaleString('pt-BR')} caracteres`;msg.textContent=text.length>max?'O conteúdo foi limitado ao trecho inicial para manter o perfil leve.':'Arquivo lido. Revise antes de salvar.';}catch{msg.textContent='Não foi possível ler o arquivo como texto.';}}else{msg.textContent='O arquivo foi identificado. Para manter o sistema leve, o binário não vai para o D1; adicione link e descrição/transcrição para treinar a linguagem.';}}
function updateCarouselProfileStatus() {
  const profile = state.profile?.writingProfile;
  const loggedIn = Boolean(state.profile?.authenticated);
  document.getElementById("carouselProfileStatus").textContent = profile ? profile.tone || "Perfil personalizado" : "Padrão jornalístico";
  const learned = Number(state.profile?.carouselLearning?.count) || 0;
  document.getElementById("carouselProfileDetail").textContent = profile
    ? `${Number(profile.sampleCount) || 0} exemplos de escrita · ${learned} carrosséis aprovados · atualizado ${profile.updatedAt ? relativeTime(profile.updatedAt) : "agora"}`
    : loggedIn ? `${learned} carrosséis aprovados na memória editorial. Adicione exemplos de escrita para refinar também o tom.` : "Entre no Perfil para adaptar o estilo.";
}

function carouselAsText(topic, carousel) {
  const slides = Array.isArray(carousel?.slides) ? carousel.slides : [];
  const verificationLinks = Array.isArray(carousel?.verificationLinks) && carousel.verificationLinks.length
    ? carousel.verificationLinks
    : topicVerificationLinks(topic);
  const questions = carousel?.questions || {};
  const entities = carousel?.entities || {};
  const reading = carousel?.reading || {};
  const facts = Array.isArray(carousel?.facts) ? carousel.facts : [];
  return [
    `ROTEIRO DE CARROSSEL — ${topic.editoria || "Notícias"}`,
    "LEITURA INTELIGENTE — UMA MATÉRIA POR SUGESTÃO",
    `Modo: ${String(carousel?.analysisMode || "").startsWith("ai-") ? "Workers AI apenas na redação" : "Extração direta da matéria"}`,
    `Qualidade: ${reading.qualityLabel || "Conteúdo disponível"}`,
    `Fonte selecionada: ${reading.selectedSource?.sourceName || reading.sources?.[0]?.sourceName || "Não informada"}`,
    `Matéria de portal verificada: ${reading.publisherVerified ? "sim" : "não"}`,
    `Tentativas de leitura: ${Number(reading.requested) || 0}`,
    `Fatos criados pela IA: ${reading.factsGeneratedByAi ? "sim" : "não"}`,
    `Ciclo encerrado: ${reading.cycleComplete ? "sim" : "não"}`,
    `Sistema liberado para novo ciclo: ${carousel?.cycle?.nextCycleAllowed || reading.nextCycleAllowed ? "sim" : "não"}`,
    `Palavras analisadas: ${Number(reading.totalWords) || 0}`,
    `Tom de voz: ${carousel?.voiceTone || "Jornalístico, factual e explicativo"}`,
    `Formato: ${carousel?.postModel || "Instagram · 7 slides"}`,
    "",
    "INTERPRETAÇÃO DA NOTÍCIA",
    `O que aconteceu: ${questions.whatHappened || "Não informado"}`,
    `Quem está envolvido: ${questions.who || "Não informado"}`,
    `Onde aconteceu: ${questions.where || "Não informado"}`,
    `Quando aconteceu: ${questions.when || "Não informado"}`,
    `Qual o impacto: ${questions.impact || "Não informado"}`,
    `Qual a repercussão: ${questions.repercussion || "Não informado"}`,
    "",
    "DADOS ESTRUTURADOS",
    entityLine("Personagens", entities.people),
    entityLine("Empresas", entities.companies),
    entityLine("Locais", entities.places),
    entityLine("Datas", entities.dates),
    entityLine("Temas", entities.themes),
    entityLine("Palavras-chave", entities.keywords),
    "",
    "MAPA DE FATOS E EVIDÊNCIAS",
    ...facts.flatMap((fact, index) => [
      `${index + 1}. ${fact.claim || ""}`,
      `Evidência: ${fact.evidence || "Não informada"}`,
      `Confiança: ${fact.confidence || "não informada"}`,
      "",
    ]),
    ...slides.flatMap((slide) => [
      `SLIDE ${slide.number} — ${String(slide.role || "").toUpperCase()}`,
      slide.title || "",
      slide.subtitle || slide.body || "",
      "",
    ]),
    "LINKS PARA APURAÇÃO",
    ...verificationLinks.flatMap((link, index) => [
      `${index + 1}. ${link.title}`,
      `Portal: ${link.sourceName}`,
      `URL: ${link.url}`,
      "",
    ]),
    carousel?.disclaimer || "Revise e confirme as informações antes de publicar.",
  ].join("\n").trim();
}

function carouselCacheKey(topicId, slideCount = state.activeSlideCount || 7) {
  const styleKey = state.profile?.writingProfile?.updatedAt || (state.profile?.authenticated ? "profile-default" : "default");
  return `${state.data?.runId || state.lastRunId || "latest"}:${topicId}:${Number(slideCount) || 7}:${styleKey}`;
}

function setCarouselLoading(loading, message = "", options = {}) {
  state.carouselLoading = loading;
  const holder = document.getElementById("carouselLoading");
  holder.hidden = false;
  holder.classList.toggle("error", !loading && Boolean(message));
  const progress = Math.max(0, Math.min(100, Number(options.progress) || 0));
  const title = options.title || (loading ? "Leitura inteligente em andamento" : "Roteiro não concluído");
  if (loading) {
    holder.innerHTML = `<span class="reader-spinner">↻</span><div class="reader-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(message || "Abrindo uma matéria e preparando o roteiro.")}</small><div class="reader-progress"><i style="width:${progress}%"></i></div><em>${progress}%</em></div>`;
  } else {
    const retry = options.retry ? '<button class="reader-retry" data-retry-carousel type="button">Tentar novamente</button>' : "";
    holder.innerHTML = `<span class="reader-error">!</span><div class="reader-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(message)}</small>${retry}</div>`;
  }
  document.getElementById("copyCarousel").disabled = loading || Boolean(message);
}

function setCarouselJobProgress(job = {}) {
  const statusTitle = job.status === "queued" ? "Leitura adicionada à fila" : "Leitura inteligente em andamento";
  setCarouselLoading(true, job.message || "Processando a matéria selecionada.", {
    progress: Number(job.progress) || 1,
    title: statusTitle,
  });
}

async function waitForIntelligentJob(jobId, requestSerial, pollAfterMs = 1500) {
  const startedAt = Date.now();
  const deadline = startedAt + 8 * 60_000;
  let rescueAttempts = 0;
  let nextRescueAt = startedAt + 12_000;
  let transientErrors = 0;

  const pollDelay = () => {
    const elapsed = Date.now() - startedAt;
    if (elapsed < 30_000) return Math.max(1300, Number(pollAfterMs) || 1500);
    if (elapsed < 70_000) return 2200;
    return 3500;
  };

  async function tryRescue(job) {
    const now = Date.now();
    if (rescueAttempts >= 3 || now < nextRescueAt) return null;

    const ageMs = Number(job?.ageMs) || (now - startedAt);
    const idleMs = Number(job?.idleMs) || 0;
    const queuedStalled = job?.status === "queued" && ageMs >= 12_000 && idleMs >= 8_000;
    const runningStalled = job?.status === "running" && ageMs >= 60_000 && idleMs >= 45_000;
    if (!queuedStalled && !runningStalled) return null;

    rescueAttempts += 1;
    nextRescueAt = now + 30_000;

    setCarouselLoading(true, "Verificando a execução ativa antes de assumir o carrossel…", {
      progress: Math.max(3, Number(job.progress) || 3),
      title: "Recuperação segura",
    });

    try {
      const rescued = await api(`/api/intelligent-jobs/${encodeURIComponent(jobId)}/rescue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (rescued?.status === "succeeded" && rescued?.data?.slides?.length) return rescued.data;
      if (rescued?.lockBusy) {
        setCarouselLoading(true, "Outro consumidor já está processando este carrossel. Apenas acompanhando o mesmo job…", {
          progress: Math.max(4, Number(rescued?.job?.progress ?? job.progress) || 4),
          title: "Processamento ativo",
        });
      }
      return null;
    } catch (error) {
      if (error.status === 409) throw error;
      console.warn("RONDA ONE carousel rescue unavailable", error);
      return null;
    }
  }

  while (Date.now() < deadline) {
    if (requestSerial !== state.carouselRequestSerial) return null;
    await wait(pollDelay());
    if (requestSerial !== state.carouselRequestSerial) return null;

    let response;
    try {
      response = await api(`/api/intelligent-jobs/${encodeURIComponent(jobId)}?t=${Date.now()}`);
      transientErrors = 0;
    } catch (error) {
      transientErrors += 1;
      setCarouselLoading(
        true,
        navigator.onLine === false
          ? "Sem conexão. O job continua no Cloudflare e será retomado quando a internet voltar."
          : "A conexão oscilou. O job continua ativo; reconectando…",
        { progress: 5, title: "Processamento preservado" }
      );
      await wait(Math.min(6000, 1000 + transientErrors * 500));
      continue;
    }

    const job = response?.job || {};

    if (job.status === "succeeded" && response?.data?.slides?.length) {
      return response.data;
    }

    if (job.status === "failed") {
      const detail = job.error || job.message || "O processamento foi interrompido.";
      throw new Error(
        /ciclo (?:foi )?encerrado/i.test(detail)
          ? detail
          : `${detail} O ciclo foi encerrado e o sistema está liberado para tentar uma nova leitura.`
      );
    }

    const rescuedData = await tryRescue(job);
    if (rescuedData?.slides?.length) return rescuedData;

    if (job.status === "queued" && (Number(job.ageMs) || 0) >= 12_000) {
      setCarouselLoading(true, job.message || "Aguardando a recuperação automática da fila.", {
        progress: Math.max(3, Number(job.progress) || 3),
        title: "Fila em recuperação",
      });
    } else {
      setCarouselJobProgress(job);
    }
  }

  const final = await api(`/api/intelligent-jobs/${encodeURIComponent(jobId)}?final=1&t=${Date.now()}`).catch(() => null);
  if (final?.job?.status === "succeeded" && final?.data?.slides?.length) return final.data;
  if (final?.job?.status === "failed") throw new Error(final.job.error || final.job.message || "O processamento foi encerrado.");

  throw new Error("O carrossel não concluiu dentro do limite operacional. O job permanece rastreável e pode ser retomado sem duplicar processamento.");
}
waitForIntelligentJob.__rondaNativeResilient = true;

function questionCard(label, value) {
  return `<article><small>${escapeHtml(label)}</small><p>${escapeHtml(value || "Não informado no conteúdo coletado.")}</p></article>`;
}

function entityGroup(label, values) {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  return `<div><small>${escapeHtml(label)}</small><div class="entity-chips">${list.length ? list.map((item) => `<span>${escapeHtml(item)}</span>`).join("") : '<em>Não identificado</em>'}</div></div>`;
}

function confidenceLabel(value) {
  if (value === "high") return "Alta";
  if (value === "medium") return "Média";
  return "Baixa";
}

function slideEditorMarkup(slide, index) {
  const title = String(slide.title || "");
  const subtitle = String(slide.subtitle || slide.body || "");
  return `<article class="carousel-slide" data-slide-index="${index}"><div><span>${Number(slide.number) || ""}</span><small>${escapeHtml(slide.role)}</small></div><h3 contenteditable="true" spellcheck="true" data-slide-title="${index}" aria-label="Editar título do slide ${index + 1}">${escapeHtml(title)}</h3><p contenteditable="true" spellcheck="true" data-slide-subtitle="${index}" aria-label="Editar subtítulo do slide ${index + 1}">${escapeHtml(subtitle).replace(/\n/g, "<br>")}</p><footer><span data-title-count>${title.length}/68</span><span data-subtitle-count>${subtitle.length}/190</span></footer></article>`;
}

function updateEditedSlide(target) {
  const holder = target.closest("[data-slide-index]");
  const index = Number(holder?.dataset.slideIndex);
  const topic = (state.data?.topics || []).find((item) => item.id === state.activeTopicId);
  const slide = state.activeCarousel?.slides?.[index];
  if (!holder || !slide || !topic) return;
  const title = holder.querySelector("[data-slide-title]")?.innerText.trim() || "";
  const subtitle = holder.querySelector("[data-slide-subtitle]")?.innerText.trim() || "";
  slide.title = title;
  slide.subtitle = subtitle;
  slide.body = subtitle;
  holder.querySelector("[data-title-count]").textContent = `${title.length}/68`;
  holder.querySelector("[data-subtitle-count]").textContent = `${subtitle.length}/190`;
  holder.classList.toggle("over-limit", title.length > 68 || subtitle.length > 190);
  state.carouselText = carouselAsText(topic, state.activeCarousel);
  state.carouselEdited = true;
}

function renderIntelligentCarousel(topic, carousel) {
  document.getElementById("carouselLoading").hidden = true;
  document.getElementById("carouselSetup").classList.add("generated");
  document.getElementById("generateCarousel").textContent = "Gerar novamente";
  document.getElementById("carouselSlideCount").value = String(Number(carousel.slideCount) || (carousel.slides || []).length || state.activeSlideCount || 7);
  document.getElementById("carouselTitle").textContent = topic.title;
  state.activeCarousel = {
    ...carousel,
    slides: (carousel.slides || []).map((slide) => ({ ...slide, evidenceIds: [...(slide.evidenceIds || [])] })),
  };
  state.carouselEdited = false;
  const reading = carousel.reading || {};
  const memoryCount = Number(carousel.writingProfile?.adaptiveMemoryCount ?? state.profile?.carouselLearning?.count) || 0;
  const profileLabel = carousel.writingProfile?.active
    ? `Perfil personalizado · ${Number(carousel.writingProfile.sampleCount) || 0} textos · ${memoryCount} aprovados`
    : memoryCount ? `Memória editorial · ${memoryCount} aprovados` : "Padrão jornalístico";
  const slideAdjustment = carousel.slideCountAdjusted
    ? `<span class="slide-adjustment"><small>Quantidade ajustada</small><strong>${Number(carousel.requestedSlideCount) || "—"} → ${(carousel.slides || []).length} slides</strong><em>${escapeHtml(carousel.slideCountAdjustmentReason || "Ajuste feito para evitar repetição sem evidência.")}</em></span>`
    : "";
  document.getElementById("carouselMeta").innerHTML = `<span><small>Editoria</small><strong>${escapeHtml(topic.editoria || "Notícias")}</strong></span><span><small>Idioma</small><strong>Português</strong></span><span><small>Tom de voz</small><strong>${escapeHtml(carousel.voiceTone || "Jornalístico e factual")}</strong></span><span><small>Formato</small><strong>${escapeHtml(carousel.postModel || `Instagram · ${(carousel.slides || []).length || 7} slides`)}</strong></span><span><small>Escrita</small><strong>${escapeHtml(profileLabel)}</strong></span><span><small>Análise</small><strong>${String(carousel.analysisMode || "").startsWith("ai-") ? "Workers AI · apenas redação" : "Extração direta da matéria"}</strong></span>${slideAdjustment}`;
  const readingHolder = document.getElementById("carouselReading");
  readingHolder.hidden = false;
  const selectedSource = reading.selectedSource || (reading.sources || [])[0] || {};
  const modeLabel = selectedSource.readMode === "full-article-cache"
    ? "Matéria já extraída · cache"
    : selectedSource.readMode === "publisher-feed-verified"
      ? "Conteúdo integral · feed oficial do portal"
      : "Matéria lida no portal";
  const selection = selectedSource.selection || {};
  const cycleReleased = Boolean(carousel.cycle?.released && carousel.cycle?.nextCycleAllowed && reading.cycleComplete);
  readingHolder.innerHTML = `<div class="carousel-section-head"><div><p class="eyebrow">Apuração obrigatória</p><h3>O roteiro só existe depois de ler uma matéria publicada</h3></div><span>${reading.publisherVerified ? "Fonte verificada" : "Sem fonte verificada"}</span></div><div class="reading-stats"><span><small>Fonte selecionada</small><strong>${escapeHtml(selectedSource.sourceName || "Não informada")}</strong></span><span><small>Modo de leitura</small><strong>${escapeHtml(modeLabel)}</strong></span><span><small>Palavras analisadas</small><strong>${Number(reading.totalWords) || 0}</strong></span><span><small>Seleção</small><strong>${selection.score ? `${Number(selection.score)} pontos · ${Number(selection.candidatesEvaluated) || 1} avaliadas` : "Melhor fonte disponível"}</strong></span><span class="cycle-release"><small>Ciclo</small><strong>${cycleReleased ? "Encerrado · próximo ciclo liberado" : "Finalização pendente"}</strong></span></div>`;

  const evidenceHolder = document.getElementById("carouselEvidence");
  const facts = Array.isArray(carousel.facts) ? carousel.facts : [];
  evidenceHolder.hidden = false;
  evidenceHolder.innerHTML = `<div class="carousel-section-head"><div><p class="eyebrow">Rastreabilidade da matéria</p><h3>Informações e evidências extraídas do site</h3></div><span>${facts.length} ${facts.length === 1 ? "evidência extraída" : "evidências extraídas"}</span></div><div class="evidence-list">${facts.length ? facts.map((fact) => `<article id="evidence-${escapeHtml(fact.id)}"><div><strong>${escapeHtml(fact.claim)}</strong><small>Confiança ${escapeHtml(confidenceLabel(fact.confidence))}</small></div><p>${escapeHtml(fact.evidence)}</p></article>`).join("") : "<p>Nenhuma evidência estruturada foi retornada.</p>"}</div>`;

  const questions = carousel.questions || {};
  const analysisHolder = document.getElementById("carouselAnalysis");
  analysisHolder.hidden = false;
  analysisHolder.innerHTML = `<div class="carousel-section-head"><div><p class="eyebrow">Interpretação da notícia</p><h3>Respostas editoriais</h3></div></div><div class="question-grid">${questionCard("O que aconteceu?", questions.whatHappened)}${questionCard("Quem está envolvido?", questions.who)}${questionCard("Onde aconteceu?", questions.where)}${questionCard("Quando aconteceu?", questions.when)}${questionCard("Qual o impacto?", questions.impact)}${questionCard("Qual a repercussão?", questions.repercussion)}</div>`;

  const entities = carousel.entities || {};
  const entityHolder = document.getElementById("carouselEntities");
  entityHolder.hidden = false;
  entityHolder.innerHTML = `<div class="carousel-section-head"><div><p class="eyebrow">Estrutura de dados</p><h3>Elementos extraídos</h3></div></div><div class="entity-grid">${entityGroup("Personagens", entities.people)}${entityGroup("Empresas", entities.companies)}${entityGroup("Locais", entities.places)}${entityGroup("Datas", entities.dates)}${entityGroup("Temas", entities.themes)}${entityGroup("Palavras-chave", entities.keywords)}</div>`;

  document.getElementById("carouselSlides").innerHTML = (state.activeCarousel.slides || []).map(slideEditorMarkup).join("");
  const verificationLinks = Array.isArray(carousel.verificationLinks) ? carousel.verificationLinks : topicVerificationLinks(topic);
  const readingSources = new Map();
  for (const item of reading.sources || []) {
    const urls = [item?.url, item?.originalUrl, item?.extractionUrl]
      .filter((url) => /^https?:\/\//i.test(String(url || "")))
      .map(safeUrl);
    urls.forEach((url) => readingSources.set(url, item));
  }
  document.getElementById("carouselSources").innerHTML = `<div class="carousel-sources-head"><div><p class="eyebrow">Apuração obrigatória</p><h3>Matéria utilizada e links adicionais</h3></div><span>${verificationLinks.length} ${verificationLinks.length === 1 ? "notícia" : "notícias"}</span></div><div class="carousel-source-list">${verificationLinks.map((link) => {
    const source = readingSources.get(safeUrl(link.url));
    const direct = /^full-article/.test(source?.readMode || "");
    const publisherFeed = source?.readMode === "publisher-feed-verified";
    const level = direct ? "Matéria lida" : publisherFeed ? "Feed oficial integral · fonte verificada" : source?.contentLevel === "content" ? "Fallback · texto do feed" : source?.contentLevel === "summary" ? "Fallback · resumo do feed" : source ? "Fallback · somente título" : "Link adicional";
    const status = source ? `${level} · ${Number(source.wordCount) || 0} palavras${source.liveReadError && !publisherFeed ? ` · ${source.liveReadError}` : ""}` : "Link adicional para apuração";
    const sourceClass = direct || publisherFeed ? "read-ok" : source ? "read-fallback" : "";
    return `<a class="carousel-source-link ${sourceClass}" href="${escapeHtml(safeUrl(link.url))}" target="_blank" rel="noreferrer"><span><strong>${escapeHtml(link.title)}</strong><small>${escapeHtml(link.sourceName)}${link.publishedAt ? ` · ${escapeHtml(formatDate(link.publishedAt))}` : ""}</small><small class="read-status">${escapeHtml(status)}</small></span><em>Abrir para apuração ↗</em></a>`;
  }).join("")}</div>`;
  document.getElementById("carouselDisclaimer").textContent = carousel.disclaimer || "Revise e confirme as informações antes de publicar.";
  const gate = carousel.editorialGate || {};
  const validation = carousel.validation || {};
  const messages = [];
  if (cycleReleased) messages.push("Ciclo encerrado e sistema liberado para uma nova leitura.");
  if (carousel.aiError) messages.push(`A IA falhou e foi usado o modo de contingência: ${carousel.aiError}`);
  if (!gate.copyAllowed) messages.push(gate.reason || "A cópia foi bloqueada até a revisão editorial.");
  if (validation.correctedSlides?.length) messages.push(`Validador corrigiu os slides: ${validation.correctedSlides.join(", ")}.`);
  document.getElementById("copyCarouselMessage").textContent = messages.join(" ");
  state.carouselText = carouselAsText(topic, state.activeCarousel);
  document.getElementById("copyCarousel").disabled = !gate.copyAllowed || !cycleReleased;
  const learnButton = document.getElementById("approveCarouselLearning");
  if (learnButton) {
    learnButton.disabled = !gate.copyAllowed || !cycleReleased || !state.profile?.authenticated;
    learnButton.textContent = state.profile?.authenticated ? "Aprovar e ensinar estilo" : "Entre no Perfil para ensinar";
  }
  const modalPanel = document.querySelector("#carouselModal .modal");
  if (modalPanel) modalPanel.scrollTo({ top: 0, behavior: "smooth" });
}

async function showCarousel(topicId, { force = false, generate = false } = {}) {
  const topic = (state.data?.topics || []).find((item) => item.id === topicId);
  if (!topic) {
    setStatus("warn", "Assunto indisponível", "Atualize a ronda e tente novamente.");
    return;
  }
  if (!state.profile) await loadProfile().catch(() => null);
  state.activeTopicId = topicId;
  state.pendingCarouselTopicId = topicId;
  state.activeSlideCount = Number(state.profile?.user?.defaultSlideCount) || state.activeSlideCount || 7;
  document.getElementById("carouselSlideCount").innerHTML = slideCountOptions(state.activeSlideCount);
  updateCarouselProfileStatus();
  document.getElementById("carouselTitle").textContent = topic.title;
  document.getElementById("carouselMeta").innerHTML = "";
  document.getElementById("carouselReading").hidden = true;
  document.getElementById("carouselEvidence").hidden = true;
  document.getElementById("carouselAnalysis").hidden = true;
  document.getElementById("carouselEntities").hidden = true;
  document.getElementById("carouselSlides").innerHTML = "";
  document.getElementById("carouselSources").innerHTML = "";
  document.getElementById("carouselDisclaimer").textContent = "";
  document.getElementById("copyCarouselMessage").textContent = "";
  document.getElementById("carouselLoading").hidden = true;
  document.getElementById("carouselSetup").classList.remove("generated");
  document.getElementById("generateCarousel").textContent = "Gerar roteiro";
  document.getElementById("copyCarousel").disabled = true;
  state.carouselText = "";
  state.activeCarousel = null;
  state.carouselEdited = false;
  const learnButton = document.getElementById("approveCarouselLearning");
  if (learnButton) learnButton.disabled = true;
  openModal("carouselModal");
  if (force || generate) await generateActiveCarousel({ force });
}

async function generateActiveCarousel({ force = false } = {}) {
  const topicId = state.pendingCarouselTopicId || state.activeTopicId;
  const topic = (state.data?.topics || []).find((item) => item.id === topicId);
  if (!topic) return;
  const slideCount = Number(document.getElementById("carouselSlideCount").value) || 7;
  state.activeSlideCount = slideCount;
  const requestSerial = state.carouselRequestSerial + 1;
  state.carouselRequestSerial = requestSerial;
  const key = carouselCacheKey(topicId, slideCount);
  const cached = !force ? state.smartCarousels.get(key) : null;
  if (cached) {
    renderIntelligentCarousel(topic, cached);
    return;
  }
  document.getElementById("carouselMeta").innerHTML = "";
  document.getElementById("carouselReading").hidden = true;
  document.getElementById("carouselEvidence").hidden = true;
  document.getElementById("carouselAnalysis").hidden = true;
  document.getElementById("carouselEntities").hidden = true;
  document.getElementById("carouselSlides").innerHTML = "";
  document.getElementById("carouselSources").innerHTML = "";
  document.getElementById("carouselDisclaimer").textContent = "";
  state.carouselText = "";
  state.activeCarousel = null;
  setCarouselLoading(true, `Selecionando uma matéria e preparando ${slideCount} slides.`, { progress: 1 });
  const token = operationToken();
  try {
    const response = await api(`/api/topics/${encodeURIComponent(topicId)}/intelligent-carousel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { "X-Round-Token": token } : {}) },
      body: JSON.stringify({ runId: state.data?.runId || state.lastRunId || null, force, slideCount }),
    });
    if (requestSerial !== state.carouselRequestSerial) return;
    let data = response?.data;
    if (!data?.slides?.length && response?.job?.jobId) {
      setCarouselJobProgress(response.job);
      data = await waitForIntelligentJob(response.job.jobId, requestSerial, response.pollAfterMs);
    } else if (!data?.slides?.length && response?.status !== "succeeded") {
      throw new Error("O servidor não retornou um job válido para o carrossel. Recarregue a versão publicada e tente novamente.");
    }
    if (requestSerial !== state.carouselRequestSerial || !data) return;
    const actualSlideCount = Array.isArray(data.slides) ? data.slides.length : 0;
    if (actualSlideCount < 3) throw new Error("A matéria não forneceu evidências suficientes para um carrossel seguro.");
    if (actualSlideCount !== slideCount) {
      data.requestedSlideCount = Number(data.requestedSlideCount) || slideCount;
      data.slideCount = actualSlideCount;
      data.slideCountAdjusted = true;
      data.slideCountAdjustmentReason = data.slideCountAdjustmentReason || `A matéria sustenta ${actualSlideCount} slides distintos sem repetição.`;
      state.activeSlideCount = actualSlideCount;
    }
    state.smartCarousels.set(key, data);
    renderIntelligentCarousel(topic, data);
  } catch (error) {
    if (requestSerial !== state.carouselRequestSerial) return;
    if (error.status === 401) {
      document.getElementById("tokenMessage").textContent = "Entre no Perfil ou informe a chave do Worker para usar a leitura inteligente.";
    }
    setCarouselLoading(false, error.message, { retry: true });
    document.getElementById("carouselSources").innerHTML = `<div class="carousel-sources-head"><div><p class="eyebrow">Apuração manual</p><h3>Abra as notícias originais</h3></div></div><div class="carousel-source-list">${topicVerificationLinks(topic).map((link) => `<a class="carousel-source-link" href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer"><span><strong>${escapeHtml(link.title)}</strong><small>${escapeHtml(link.sourceName)}</small></span><em>Abrir para apuração ↗</em></a>`).join("")}</div>`;
  }
}

async function approveCarouselLearning() {
  const message = document.getElementById("copyCarouselMessage");
  const topic = (state.data?.topics || []).find((item) => item.id === state.activeTopicId);
  const carousel = state.activeCarousel;
  if (!topic || !carousel?.slides?.length) return;
  if (!state.profile?.authenticated) {
    message.textContent = "Entre no Perfil para salvar este texto na memória editorial.";
    return;
  }
  const button = document.getElementById("approveCarouselLearning");
  if (button) button.disabled = true;
  message.textContent = "Salvando o padrão deste carrossel na memória editorial…";
  try {
    const response = await api("/api/profile/carousel-learning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topicId: topic.id,
        sourceName: carousel.reading?.selectedSource?.sourceName || "Fonte não informada",
        slideCount: carousel.slides.length,
        slides: carousel.slides.map((slide) => ({ role: slide.role, title: slide.title, subtitle: slide.subtitle || slide.body || "" })),
      }),
    });
    state.profile.carouselLearning = { count: Number(response.exampleCount) || 0, updatedAt: response.updatedAt || new Date().toISOString() };
    state.smartCarousels.clear();
    updateCarouselProfileStatus();
    message.textContent = `Estilo aprendido com este carrossel. Memória editorial: ${Number(response.exampleCount) || 0} aprovado(s).`;
    if (button) button.textContent = "Estilo aprendido ✓";
  } catch (error) {
    message.textContent = error.message;
    if (button) button.disabled = false;
  }
}

async function copyCarouselText() {
  const message = document.getElementById("copyCarouselMessage");
  try {
    await navigator.clipboard.writeText(state.carouselText);
    message.textContent = "Roteiro copiado.";
  } catch {
    const area = document.createElement("textarea");
    area.value = state.carouselText;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    message.textContent = copied ? "Roteiro copiado." : "Não foi possível copiar automaticamente.";
  }
}

let statusPollTimer = null;
let statusPolling = false;

function nextStatusPollDelay() {
  if (state.running || state.serverRunning) return 3_000;
  return document.hidden ? 5 * 60_000 : 60_000;
}

function scheduleStatusPolling(delay = null) {
  clearTimeout(statusPollTimer);
  statusPollTimer = setTimeout(() => pollStatus(), delay ?? nextStatusPollDelay());
}

async function pollStatus({ force = false } = {}) {
  if (statusPolling) return;
  statusPolling = true;
  try {
    const response = await conditionalApi("/api/status", force ? "" : state.statusEtag);
    if (!response.notModified) {
      state.statusEtag = response.etag;
      const status = response.payload;
      state.serverRunning = Boolean(status?.running);
      if (status?.running) {
        const queued = status.activeRunStatus === "queued";
        const reference = queued ? status.activeRunQueuedAt : status.activeRunStartedAt;
        const started = reference ? relativeTime(reference) : "agora";
        setStatus("", queued ? "Ronda na fila" : "Ronda em andamento", queued ? `Aguardando consumidor · enviada ${started}` : `Coletando fontes · iniciado ${started}`);
      } else if (status?.lastAttempt?.status && ["failed", "expired"].includes(status.lastAttempt.status)) {
        if (status.lastAttempt.id !== state.lastAttemptId) {
          state.lastAttemptId = status.lastAttempt.id || null;
          state.attemptDiagnostics = status.lastAttempt.diagnostics || null;
          renderSourceHealth();
        }
        setStatus("warn", status.lastAttempt.status === "expired" ? "Última tentativa expirou" : "Última tentativa falhou", `${roundDiagnosticsSummary(status.lastAttempt.diagnostics)} · ${lastValidRoundLabel()}`);
      } else if (status?.lastRunId && (!state.data || status.lastRunId !== state.lastRunId)) {
        await loadLatest({ quiet: true, force: !state.data });
        const completedAt = status.lastSuccessAt || state.data?.collectedAt;
        if (completedAt) setStatus("ok", "Serviço online", `Última ronda ${relativeTime(completedAt)}`);
      } else if (status?.schedulerHealthy && state.health?.translation?.ready !== false) {
        setStatus("ok", "Serviço online", status.lastSuccessAt ? `Última ronda ${relativeTime(status.lastSuccessAt)}` : "Aguardando primeira ronda");
      }
    }
    // A Mesa pode receber enriquecimentos entre duas rondas. /api/latest possui
    // ETag próprio do overlay editorial; esta leitura é barata quando nada mudou.
    if (!state.serverRunning) await loadLatest({ quiet: true });

  } catch (error) {
    if (!state.running) setStatus("warn", "Atualização temporariamente indisponível", error.message);
  } finally {
    statusPolling = false;
    scheduleStatusPolling();
  }
}

let operationalStarted=false;
async function syncLatestRound({ reason = "sync" } = {}) {
  if (!state.profile?.authenticated) return null;
  state.statusEtag = "";
  state.latestEtag = "";
  try {
    const latest = await loadLatest({ quiet: true, force: true });
    await pollStatus({ force: true });
    if (latest?.ok) {
      const completedAt = latest.collectedAt || latest.storedAt || state.health?.lastSuccessAt;
      if (completedAt) setStatus("ok", "Serviço online", `Última ronda ${relativeTime(completedAt)}`);
    }
    return latest;
  } catch (error) {
    console.warn("RONDA ONE sync failed", reason, error);
    return null;
  }
}

async function startOperationalApplication(){
  if(operationalStarted)return; operationalStarted=true;
  document.getElementById("operationToken").value = operationToken();
  renderSourceHealth("Carregando última ronda…");
  setStatus("", "Sincronizando", "Carregando a última ronda válida");
  const healthy = await checkHealth();
  if (!healthy) return;
  const latest = await syncLatestRound({ reason: "startup" });
  if (!latest && (!state.health.manualAuthRequired || operationToken())) executeRound(true);
}

async function startApplication() {
  render();
  initializeSlideCountSelectors();
  const profile=await loadProfile().catch(() => null);
  if(!profile?.authenticated){showView("profile");return;}
  await startOperationalApplication();
}

runButton.addEventListener("click", () => executeRound(false));

const searchInput = document.getElementById("searchInput");
let searchUserActivated = false;

function clearUnexpectedSearchAutofill() {
  if (searchUserActivated || !searchInput) return;
  searchInput.value = "";
  state.query = "";
}

function activateSearchInput() {
  if (!searchInput) return;
  if (!searchUserActivated) {
    searchUserActivated = true;
    searchInput.readOnly = false;
    searchInput.value = "";
    state.query = "";
  }
}

["pointerdown", "keydown", "focus"].forEach((eventName) => {
  searchInput?.addEventListener(eventName, activateSearchInput, { once: true });
});

[0, 50, 250, 1000].forEach((delay) => setTimeout(clearUnexpectedSearchAutofill, delay));

searchInput?.addEventListener("input", (event) => {
  if (!searchUserActivated) {
    event.target.value = "";
    state.query = "";
    render();
    return;
  }
  state.query = event.target.value;
  render();
});
document.getElementById("periodFilter").addEventListener("click", (event) => {
  if (!event.target.matches("button")) return;
  state.period = Number(event.target.dataset.value);
  event.currentTarget.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button === event.target));
  render();
});
document.getElementById("sourceFilter").addEventListener("click", (event) => {
  if (!event.target.matches("button")) return;
  state.portal = null;
  setSourceSegment(event.target.dataset.value);
  state.expanded.clear();
  renderSourceHealth();
  render();
});
document.getElementById("regionFilter").addEventListener("click", (event) => {
  if (!event.target.matches("button")) return;
  state.portal = null;
  setRegionSegment(event.target.dataset.value);
  state.expanded.clear();
  renderSourceHealth();
  render();
});
document.getElementById("editoriaFilter").addEventListener("click", (event) => {
  const button = event.target.closest("[data-editoria]");
  if (!button) return;
  state.editoria = button.dataset.editoria;
  event.currentTarget.querySelectorAll("[data-editoria]").forEach((item) => item.classList.toggle("active", item === button));
  state.expanded.clear();
  render();
});
document.getElementById("topicsGrid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-forma-topic]");
  if (!button) return;
  const topicId=button.dataset.formaTopic;
  const editorialEventId=button.dataset.editorialEvent||"";
  const runId=state.data?.runId||state.lastRunId||"";
  const go=()=>{const target=`/design/?productionTopic=${encodeURIComponent(topicId)}${runId?`&runId=${encodeURIComponent(runId)}`:""}${editorialEventId?`&editorialEvent=${encodeURIComponent(editorialEventId)}`:""}`;window.location.href=target;};
  if(editorialEventId){
    api(`/api/newsroom/event-production/${encodeURIComponent(editorialEventId)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"send_to_forma"})}).then(go).catch(error=>{if(error.status===401){showView("profile");alert("Entre no perfil editorial para registrar quem enviou a pauta ao FORMA.");return;}alert(error.message);});
  }else go();
});
document.getElementById("copyCarousel").addEventListener("click", copyCarouselText);
document.getElementById("approveCarouselLearning")?.addEventListener("click", approveCarouselLearning);
document.getElementById("carouselSlides").addEventListener("input", (event) => {
  if (event.target.matches("[data-slide-title], [data-slide-subtitle]")) updateEditedSlide(event.target);
});
document.getElementById("carouselLoading").addEventListener("click", (event) => {
  const button = event.target.closest("[data-retry-carousel]");
  if (button && state.activeTopicId) generateActiveCarousel({ force: true });
});
document.getElementById("generateCarousel").addEventListener("click", () => generateActiveCarousel({ force: Boolean(state.activeCarousel) }));
document.getElementById("carouselSlideCount").addEventListener("change", (event) => { state.activeSlideCount = Number(event.target.value) || 7; });
document.getElementById("monitoringTermForm").addEventListener("submit", submitMonitoringTerm);
document.getElementById("monitoringTermsList").addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-term-toggle]");
  const remove = event.target.closest("[data-term-delete]");
  if (toggle) changeMonitoringTerm(toggle.dataset.termToggle, { active: toggle.dataset.nextActive === "true" });
  if (remove) changeMonitoringTerm(remove.dataset.termDelete, { delete: true });
});
document.getElementById("monitoringTermFilters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-monitoring-filter]");
  if (!button) return;
  state.monitoringTermFilter = button.dataset.monitoringFilter;
  renderDedicatedMonitoring();
});
document.getElementById("logoutProfile").addEventListener("click", logoutProfile);
document.getElementById("profileDefaultSlideCount").addEventListener("change", updateDefaultSlideCount);
document.getElementById("rebuildWritingStyle").addEventListener("click", rebuildWritingStyle);
document.getElementById("settingsButton").addEventListener("click", () => openModal("settingsModal"));
document.getElementById("openSettings").addEventListener("click", () => openModal("settingsModal"));
document.getElementById("navHistory").addEventListener("click", showHistory);
document.getElementById("historyList").addEventListener("click", (event) => {
  const row = event.target.closest("[data-history-run]");
  if (row && !row.disabled) showHistoryDetail(row.dataset.historyRun);
});
document.getElementById("historyBack").addEventListener("click", () => {
  document.getElementById("historyDetail").hidden = true;
  document.getElementById("historyList").hidden = false;
  document.getElementById("historyBack").hidden = true;
});
document.getElementById("refreshNewsroom").addEventListener("click", () => loadNewsroom());
document.getElementById("newsroomBoard").addEventListener("change", (event) => { const card=event.target.closest("[data-story-id]"); if(card && event.target.matches("[data-story-status]")) patchNewsroomStory(card.dataset.storyId,{workflowStatus:event.target.value}); });
document.getElementById("newsroomBoard").addEventListener("click", (event) => { const card=event.target.closest("[data-story-id]"); if(!card)return; if(event.target.closest("[data-story-assume]")) patchNewsroomStory(card.dataset.storyId,{assignToSelf:true}); if(event.target.closest("[data-story-note]")) addNewsroomNote(card.dataset.storyId); if(event.target.closest("[data-story-follow]")) toggleNewsroomFollow(card.dataset.storyId); });
document.getElementById("navNewsroom").addEventListener("click", () => { showView("newsroom"); loadNewsroom(); document.getElementById("workspaceTop").scrollIntoView({ behavior: "smooth" }); });
document.getElementById("navProduction").addEventListener("click", () => { showView("production"); document.getElementById("workspaceTop").scrollIntoView({ behavior: "smooth" }); });
document.getElementById("navCrawl").addEventListener("click", () => { showView("crawl"); loadCrawl(); document.getElementById("workspaceTop").scrollIntoView({ behavior: "smooth" }); });
document.getElementById("refreshCrawl").addEventListener("click", () => loadCrawl({ force:true }));
document.getElementById("navSources").addEventListener("click", () => { showView("sources"); document.getElementById("workspaceTop").scrollIntoView({ behavior: "smooth" }); });
document.getElementById("navMonitoring").addEventListener("click", () => { showView("monitoring"); document.getElementById("workspaceTop").scrollIntoView({ behavior: "smooth" }); });
document.querySelectorAll('[data-profile-ref-tab]').forEach(button=>button.addEventListener('click',()=>setProfileReferenceTab(button.dataset.profileRefTab)));
document.getElementById('profileReferenceForm').addEventListener('submit',submitProfileReference);
document.getElementById('profileReferenceFile').addEventListener('change',loadProfileReferenceFile);
document.getElementById('profileReferenceContent').addEventListener('input',event=>{const max=Number(state.profile?.limits?.maximumReferenceCharacters)||8000;document.getElementById('profileReferenceCounter').textContent=`${event.target.value.length.toLocaleString('pt-BR')}/${max.toLocaleString('pt-BR')} caracteres`;});
document.getElementById('profileReferenceList').addEventListener('click',event=>{const b=event.target.closest('[data-profile-reference-delete]');if(b)deleteProfileReference(b.dataset.profileReferenceDelete);});
document.getElementById("navProfile").addEventListener("click", () => { showView("profile"); document.getElementById("workspaceTop").scrollIntoView({ behavior: "smooth" }); });
document.getElementById("navRound").addEventListener("click", () => { if (state.portal) { state.portal = null; setSourceSegment("Todos"); setRegionSegment("Todas"); updatePortalFilter(); renderSourceHealth(); render(); } showView("round"); document.getElementById("workspaceTop").scrollIntoView({ behavior: "smooth" }); });
document.getElementById("goTop").addEventListener("click", () => document.getElementById("workspaceTop").scrollIntoView({ behavior: "smooth" }));
document.getElementById("showAllSources").addEventListener("click", () => { resetRoundFilters(); showView("round"); document.querySelector(".controls").scrollIntoView({ behavior: "smooth", block: "start" }); });
document.getElementById("clearPortalFilter").addEventListener("click", () => { state.portal = null; setSourceSegment("Todos"); setRegionSegment("Todas"); updatePortalFilter(); renderSourceHealth(); render(); });
document.getElementById("clearAllFilters").addEventListener("click", resetRoundFilters);
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-portal]");
  if (!button) return;
  filterByPortal(button.dataset.portal);
});
document.getElementById("saveSettings").addEventListener("click", () => {
  const token = document.getElementById("operationToken").value.trim();
  try { token ? localStorage.setItem(STORAGE_TOKEN, token) : localStorage.removeItem(STORAGE_TOKEN); } catch {}
  document.getElementById("tokenMessage").textContent = "";
  closeModal("settingsModal");
});
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => closeModal(button.dataset.close)));
document.querySelectorAll(".modal-backdrop").forEach((backdrop) => backdrop.addEventListener("click", (event) => { if (event.target === backdrop) closeModal(backdrop.id); }));
document.addEventListener("keydown", (event) => { if (event.key === "Escape") document.querySelectorAll(".modal-backdrop:not([hidden])").forEach((modal) => closeModal(modal.id)); });

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) syncLatestRound({ reason: "visibility" });
  else scheduleStatusPolling(250);
});
window.addEventListener("online", () => syncLatestRound({ reason: "online" }));
window.addEventListener("pageshow", (event) => {
  clearUnexpectedSearchAutofill();
  if (event.persisted && state.profile?.authenticated) syncLatestRound({ reason: "pageshow" });
});
window.addEventListener("ronda:session-expired",(event)=>{
  state.profile={authenticated:false}; state.smartCarousels.clear(); location.replace(`/?next=${encodeURIComponent(location.pathname+location.search)}`);
  const message=document.getElementById("loginMessage"); if(message) message.textContent=event.detail?.message||"Sua sessão terminou. Entre novamente.";
});

startApplication().catch((error) => {
  console.error("RONDA ONE frontend boot failed", error);
  try {
    setStatus("error", "Interface não inicializada", error?.message || "Erro de inicialização.");
    renderSourceHealth(`Erro de interface: ${error?.message || "falha desconhecida"}`, true);
  } catch {}
});
