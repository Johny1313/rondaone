const YOUTUBE_BASE = "https://www.googleapis.com/youtube/v3";
const DEFAULT_REGION = "BR";
const DEFAULT_LIMIT = 25;
const REQUEST_TIMEOUT_MS = 8_000;

export const YOUTUBE_CHANNEL_SCOPE = "news_only";
export const YOUTUBE_NEWS_CATEGORY_ID = "25";
export const APPROVED_YOUTUBE_NEWS_CHANNELS = Object.freeze([
  "g1",
  "GloboNews",
  "CNN Brasil",
  "Band Jornalismo",
  "BandNews TV",
  "BandNews FM",
  "SBT News",
  "Record News",
  "Jovem Pan News",
  "UOL",
  "UOL Notícias",
  "Folha de S.Paulo",
  "Folha de São Paulo",
  "Estadão",
  "O Globo",
  "Poder360",
  "BBC News Brasil",
  "Metrópoles",
  "CBN",
  "Agência Brasil",
  "Veja",
  "InfoMoney",
  "Money Times",
  "ge",
  "Canaltech",
  "Canal Rural",
  "TV Brasil",
  "TV Cultura",
  "Jornal da Record",
  "R7",
  "Terra",
  "Gazeta do Povo"
]);

function normalizedChannelName(value) {
  return normalizeText(value)
    .replace(/&/g, " e ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const APPROVED_YOUTUBE_NEWS_CHANNEL_KEYS = new Set(
  APPROVED_YOUTUBE_NEWS_CHANNELS.map(normalizedChannelName)
);

const APPROVED_YOUTUBE_NEWS_ALIASES = Object.freeze([
  "globonews", "globo news",
  "cnn brasil",
  "band jornalismo", "bandnews", "band news",
  "sbt news",
  "record news", "jornal da record",
  "jovem pan news", "jp news",
  "uol noticias",
  "folha de s paulo", "folha de sao paulo",
  "estadao",
  "o globo",
  "poder360", "poder 360",
  "bbc news brasil",
  "metropoles",
  "agencia brasil",
  "infomoney", "info money",
  "money times",
  "canal rural",
  "canaltech",
  "tv brasil",
  "tv cultura",
  "gazeta do povo"
].map(normalizedChannelName));

const NEWS_CHANNEL_MARKERS = Object.freeze([
  "news", "noticias", "jornal", "jornalismo", "agencia", "bandnews", "globonews"
]);

const NEWS_CHANNEL_EXCLUSION_MARKERS = Object.freeze([
  "cortes", "corte", "react", "reacao", "fan", "fã", "parodia", "humor", "game", "games", "gaming"
].map(normalizedChannelName));

function matchesApprovedNewsAlias(key) {
  if (!key) return false;
  if (APPROVED_YOUTUBE_NEWS_CHANNEL_KEYS.has(key)) return true;
  if (["g1", "ge", "cbn", "uol", "veja", "r7", "terra"].includes(key)) return true;
  return APPROVED_YOUTUBE_NEWS_ALIASES.some((alias) =>
    key === alias || key.startsWith(`${alias} `) || key.endsWith(` ${alias}`)
  );
}

function looksLikeNewsroomChannel(key) {
  if (!key || NEWS_CHANNEL_EXCLUSION_MARKERS.some((marker) => key.includes(marker))) return false;
  return NEWS_CHANNEL_MARKERS.some((marker) => key.includes(marker));
}

export function isApprovedYouTubeNewsChannel(value) {
  const title = typeof value === "string" ? value : value?.channel || value?.snippet?.channelTitle || "";
  const key = normalizedChannelName(title);
  if (matchesApprovedNewsAlias(key)) return true;
  const categoryId = String(typeof value === "object" ? value?.categoryId || value?.snippet?.categoryId || "" : "");
  return categoryId === YOUTUBE_NEWS_CATEGORY_ID && looksLikeNewsroomChannel(key);
}

export function filterYouTubeNewsVideos(videos = []) {
  return (Array.isArray(videos) ? videos : []).filter(isApprovedYouTubeNewsChannel);
}

const STOPWORDS = new Set(`a agora ainda ai alem algo algum alguma alguns algumas ao aos aquela aquele aqueles aquelas aqui assim ate cada com como contra da das de dela dele deles delas depois dia dias do dos e ela ele eles elas em entre era essa esse esses essas esta este estes eu foi for fora hoje ja la mais mas meu minha muito muita muitos muitas na nao nas nem no nos nossa nosso novas novo novos num numa o os ou para pela pelo pelas pelos por porque qual quando que quem se sem ser seu sua suas seus sobre so tambem tem ter toda todo todos todas um uma umas uns vai ver voce voces video videos oficial parte melhor live shorts canal atualizado atual ultimas ultima primeiro primeira segunda segundo novo musica clipe episodio completa completo react trailer gameplay highlights minuto minutos horas hora mundo brasil brasileiro brasileira estreia entrevista noticia noticias tv youtube`.split(/\s+/));
const ACRONYMS = new Map([["bbb", "BBB"], ["gta", "GTA"], ["ufc", "UFC"], ["f1", "F1"], ["nba", "NBA"], ["nfl", "NFL"], ["ia", "IA"], ["stf", "STF"], ["sp", "SP"], ["rj", "RJ"]]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function safeId(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90);
}

function properLabel(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .map((word) => ACRONYMS.get(word) || `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function tokenList(value) {
  return normalizeText(value)
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function parseDurationSeconds(value) {
  const match = String(value || "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (Number(match[1]) || 0) * 3600 + (Number(match[2]) || 0) * 60 + (Number(match[3]) || 0);
}

function hoursSince(value, nowMs = Date.now()) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return 9999;
  return Math.max(0.05, (nowMs - time) / 3_600_000);
}

function youtubeError(status, payload) {
  const reason = payload?.error?.errors?.[0]?.reason || payload?.error?.status || `HTTP_${status}`;
  const message = payload?.error?.message || `YouTube respondeu HTTP ${status}.`;
  const normalized = `${reason} ${message}`.toLowerCase();
  const error = new Error(message);
  error.status = status;
  error.code = reason;
  error.quota = status === 429 || normalized.includes("quota") || normalized.includes("rate limit");
  error.retryable = status === 429 || status >= 500;
  return error;
}

async function fetchJson(url, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "RondaEditorialYouTube/2.7.8" },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw youtubeError(response.status, payload);
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeout = new Error("Tempo limite excedido ao consultar a API do YouTube.");
      timeout.code = "YOUTUBE_TIMEOUT";
      timeout.retryable = true;
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function youtubeRequest(apiKey, endpoint, params, { timeoutMs = REQUEST_TIMEOUT_MS, retry = true } = {}) {
  if (!String(apiKey || "").trim()) {
    const error = new Error("YOUTUBE_API_KEY não configurada no Worker.");
    error.code = "YOUTUBE_KEY_MISSING";
    throw error;
  }
  const url = new URL(`${YOUTUBE_BASE}/${endpoint}`);
  for (const [key, value] of Object.entries({ ...params, key: apiKey })) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  try {
    return await fetchJson(url, { timeoutMs });
  } catch (error) {
    if (!retry || !error?.retryable) throw error;
    await new Promise((resolve) => setTimeout(resolve, 450));
    return fetchJson(url, { timeoutMs });
  }
}

export function normalizeYouTubeVideo(item, rank = 0, nowMs = Date.now()) {
  const snippet = item?.snippet || {};
  const statistics = item?.statistics || {};
  const id = typeof item?.id === "string" ? item.id : item?.id?.videoId;
  const publishedAt = snippet.publishedAt || snippet.publishTime || null;
  const views = Number(statistics.viewCount || 0);
  const likes = Number(statistics.likeCount || 0);
  const comments = Number(statistics.commentCount || 0);
  const ageHours = hoursSince(publishedAt, nowMs);
  const viewsPerHour = Math.round(views / Math.max(ageHours, 0.25));
  const engagementRate = views ? ((likes + comments * 3) / views) * 100 : 0;
  const commentRate = views ? (comments / views) * 100 : 0;
  return {
    id,
    rank: rank + 1,
    title: snippet.title || "Sem título",
    description: snippet.description || "",
    channel: snippet.channelTitle || "Canal não informado",
    channelId: snippet.channelId || "",
    publishedAt,
    ageHours,
    views,
    likes,
    comments,
    viewsPerHour,
    engagementRate,
    commentRate,
    categoryId: snippet.categoryId || "",
    tags: Array.isArray(snippet.tags) ? snippet.tags : [],
    thumbnail: snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || "",
    durationSeconds: parseDurationSeconds(item?.contentDetails?.duration),
    url: id ? `https://www.youtube.com/watch?v=${id}` : "",
  };
}

function videoDecision(video) {
  if (video.speedScore >= 85 && video.ageHours <= 8) return { decision: "Possível viral", decisionLevel: "high", decisionReason: "alta velocidade em vídeo recente" };
  if (video.attentionIndex >= 82 && (video.speedScore >= 55 || video.recencyScore >= 70 || video.commentScore >= 70)) return { decision: "Pautar agora", decisionLevel: "high", decisionReason: "atenção alta com sinal editorial forte" };
  if (video.attentionIndex >= 62 || video.commentScore >= 65) return { decision: "Acompanhar", decisionLevel: "medium", decisionReason: "atenção relevante na amostra" };
  return { decision: "Baixa prioridade", decisionLevel: "low", decisionReason: "sem aceleração editorial forte nesta coleta" };
}

export function calculateYouTubeAttention(videos) {
  const maxViews = Math.max(1, ...videos.map((video) => video.views));
  const maxSpeed = Math.max(1, ...videos.map((video) => video.viewsPerHour));
  const maxEngagement = Math.max(0.001, ...videos.map((video) => video.engagementRate));
  const maxComments = Math.max(0.001, ...videos.map((video) => video.commentRate));
  return videos.map((video) => {
    const viewsScore = (video.views / maxViews) * 100;
    const speedScore = (video.viewsPerHour / maxSpeed) * 100;
    const engagementScore = (video.engagementRate / maxEngagement) * 100;
    const commentScore = (video.commentRate / maxComments) * 100;
    const recencyScore = clamp(100 - video.ageHours * 4, 0, 100);
    const attentionIndex = Math.round(speedScore * 0.35 + viewsScore * 0.25 + engagementScore * 0.15 + commentScore * 0.1 + recencyScore * 0.15);
    const reasons = [];
    if (speedScore >= 70) reasons.push("alta velocidade por hora");
    if (recencyScore >= 70) reasons.push("publicado recentemente");
    if (commentScore >= 60) reasons.push("comentários acima da média");
    if (viewsScore >= 80) reasons.push("alto volume de visualizações");
    if (!reasons.length) reasons.push("volume relevante na amostra");
    const enriched = {
      ...video,
      viewsScore: Math.round(viewsScore),
      speedScore: Math.round(speedScore),
      engagementScore: Math.round(engagementScore),
      commentScore: Math.round(commentScore),
      recencyScore: Math.round(recencyScore),
      attentionIndex,
      reasons,
    };
    return { ...enriched, ...videoDecision(enriched) };
  }).sort((left, right) => right.attentionIndex - left.attentionIndex).map((video, index) => ({ ...video, rank: index + 1 }));
}

function classifyYouTubeEditoria(label) {
  const text = normalizeText(label);
  const groups = [
    ["Esportes", ["futebol", "flamengo", "corinthians", "palmeiras", "vasco", "neymar", "copa", "ufc", "nba", "f1"]],
    ["Política", ["lula", "bolsonaro", "governo", "senado", "congresso", "stf", "ministro", "eleicao"]],
    ["Entretenimento", ["bbb", "novela", "ator", "atriz", "reality", "celebridade", "influencer"]],
    ["Tecnologia", ["gta", "game", "minecraft", "roblox", "playstation", "xbox", "iphone", "inteligencia artificial", "tecnologia"]],
    ["Notícias", ["policia", "justica", "acidente", "chuva", "cidade", "brasil"]],
  ];
  return groups.find(([, words]) => words.some((word) => text.includes(word)))?.[0] || "Viral e Redes Sociais";
}

function topicDecision(topic) {
  if (topic.attentionIndex >= 82 && topic.channelCount >= 3) return { decision: "Pautar agora", decisionLevel: "high", decisionReason: "assunto forte em múltiplos canais" };
  if (topic.attentionIndex >= 78 && topic.viewsPerHour >= 50_000) return { decision: "Possível viral", decisionLevel: "high", decisionReason: "assunto com velocidade elevada" };
  if (topic.attentionIndex >= 58 || topic.channelCount >= 2) return { decision: "Acompanhar", decisionLevel: "medium", decisionReason: "sinal relevante na amostra" };
  return { decision: "Baixa prioridade", decisionLevel: "low", decisionReason: "sinal ainda insuficiente" };
}

export function extractYouTubeTopics(videos, limit = 24) {
  const candidates = new Map();
  function add(label, video, weight) {
    const id = safeId(label);
    if (!id || id.length < 3) return;
    const current = candidates.get(id) || { id, label: properLabel(label), videos: new Map(), channels: new Set(), weight: 0 };
    current.weight += weight;
    current.videos.set(video.id, video);
    current.channels.add(video.channel);
    candidates.set(id, current);
  }
  for (const video of videos) {
    const tokens = tokenList(`${video.title} ${(video.tags || []).slice(0, 8).join(" ")}`).slice(0, 10);
    for (const token of tokens) add(token, video, 1 + video.attentionIndex / 100);
    for (let index = 0; index < tokens.length - 1; index += 1) add(`${tokens[index]} ${tokens[index + 1]}`, video, 2.2 + video.attentionIndex / 80);
  }
  const topics = [...candidates.values()].map((candidate) => {
    const related = [...candidate.videos.values()].sort((left, right) => right.attentionIndex - left.attentionIndex);
    const views = related.reduce((sum, video) => sum + video.views, 0);
    const viewsPerHour = related.reduce((sum, video) => sum + video.viewsPerHour, 0);
    const comments = related.reduce((sum, video) => sum + video.comments, 0);
    const channelCount = candidate.channels.size;
    const baseIndex = related.reduce((sum, video) => sum + video.attentionIndex, 0) / Math.max(1, related.length);
    const attentionIndex = Math.round(clamp(baseIndex * 0.75 + channelCount * 7 + Math.min(15, candidate.weight), 0, 100));
    const dates = related.map((video) => Date.parse(video.publishedAt || "")).filter(Number.isFinite);
    const topic = {
      id: candidate.id,
      label: candidate.label,
      editoria: classifyYouTubeEditoria(candidate.label),
      attentionIndex,
      videoCount: related.length,
      channelCount,
      channels: [...candidate.channels],
      views,
      viewsPerHour: Math.round(viewsPerHour),
      comments,
      firstPublishedAt: dates.length ? new Date(Math.min(...dates)).toISOString() : null,
      latestPublishedAt: dates.length ? new Date(Math.max(...dates)).toISOString() : null,
      videos: related.slice(0, 8).map((video) => ({ id: video.id, title: video.title, channel: video.channel, thumbnail: video.thumbnail, publishedAt: video.publishedAt, views: video.views, viewsPerHour: video.viewsPerHour, comments: video.comments, attentionIndex: video.attentionIndex, url: video.url })),
    };
    return { ...topic, ...topicDecision(topic) };
  }).filter((topic) => topic.videoCount >= 2 || topic.channelCount >= 2 || topic.attentionIndex >= 78);

  const selected = [];
  for (const topic of topics.sort((left, right) => right.attentionIndex - left.attentionIndex)) {
    const topicVideos = new Set(topic.videos.map((video) => video.id));
    const duplicate = selected.some((current) => {
      const overlap = current.videos.filter((video) => topicVideos.has(video.id)).length;
      return overlap >= Math.min(2, topic.videos.length, current.videos.length) && (current.label.includes(topic.label) || topic.label.includes(current.label));
    });
    if (!duplicate) selected.push(topic);
    if (selected.length >= limit) break;
  }
  return selected.map((topic, index) => ({ ...topic, rank: index + 1 }));
}

export function restrictYouTubeCollectionToNews(collection) {
  if (!collection || typeof collection !== "object") return collection || null;
  const videos = filterYouTubeNewsVideos(collection.videos || []);
  const topics = extractYouTubeTopics(videos);
  const output = {
    ...collection,
    newsOnly: true,
    channelScope: YOUTUBE_CHANNEL_SCOPE,
    videos,
    topics,
  };
  output.channels = buildChannels(videos);
  output.alerts = buildAlerts(output);
  output.stats = {
    videoCount: videos.length,
    topicCount: topics.length,
    channelCount: output.channels.length,
    urgentCount: topics.filter((topic) => topic.decisionLevel === "high").length,
    views: videos.reduce((sum, video) => sum + (Number(video.views) || 0), 0),
    viewsPerHour: videos.reduce((sum, video) => sum + (Number(video.viewsPerHour) || 0), 0),
    comments: videos.reduce((sum, video) => sum + (Number(video.comments) || 0), 0),
  };
  return output;
}

export function restrictYouTubeTermResultToNews(result) {
  if (!result || typeof result !== "object") return result || null;
  const videos = filterYouTubeNewsVideos(result.videos || []);
  return {
    ...result,
    newsOnly: true,
    channelScope: YOUTUBE_CHANNEL_SCOPE,
    videos,
    summary: {
      ...(result.summary || {}),
      videoCount: videos.length,
      views: videos.reduce((sum, video) => sum + (Number(video.views) || 0), 0),
      viewsPerHour: videos.reduce((sum, video) => sum + (Number(video.viewsPerHour) || 0), 0),
      comments: videos.reduce((sum, video) => sum + (Number(video.comments) || 0), 0),
      topVideo: videos[0] || null,
    },
  };
}

function compareCollection(collection, previous) {
  const previousVideos = new Map((previous?.videos || []).map((video) => [video.id, video]));
  const previousTopics = new Map((previous?.topics || []).map((topic) => [topic.id, topic]));
  collection.videos = collection.videos.map((video) => {
    const old = previousVideos.get(video.id);
    if (!old) return { ...video, movement: "entrou", movementLabel: "Entrou no ranking", deltaIndex: video.attentionIndex };
    const deltaIndex = video.attentionIndex - Number(old.attentionIndex || 0);
    return { ...video, movement: deltaIndex >= 5 ? "subiu" : deltaIndex <= -5 ? "caiu" : "manteve", movementLabel: deltaIndex >= 5 ? `Subiu ${deltaIndex} pts` : deltaIndex <= -5 ? `Caiu ${Math.abs(deltaIndex)} pts` : "Estável", deltaIndex };
  });
  collection.topics = collection.topics.map((topic) => {
    const old = previousTopics.get(topic.id);
    if (!old) return { ...topic, movement: "entrou", movementLabel: "Entrou no radar", deltaIndex: topic.attentionIndex };
    const deltaIndex = topic.attentionIndex - Number(old.attentionIndex || 0);
    return { ...topic, movement: deltaIndex >= 5 ? "subiu" : deltaIndex <= -5 ? "caiu" : "manteve", movementLabel: deltaIndex >= 5 ? `Subiu ${deltaIndex} pts` : deltaIndex <= -5 ? `Caiu ${Math.abs(deltaIndex)} pts` : "Estável", deltaIndex };
  });
  return collection;
}

function buildChannels(videos) {
  const channels = new Map();
  for (const video of videos) {
    const id = video.channelId || safeId(video.channel);
    const current = channels.get(id) || { id, channel: video.channel, videoCount: 0, views: 0, viewsPerHour: 0, comments: 0, attentionIndex: 0, topVideo: video };
    current.videoCount += 1;
    current.views += video.views;
    current.viewsPerHour += video.viewsPerHour;
    current.comments += video.comments;
    current.attentionIndex = Math.max(current.attentionIndex, video.attentionIndex);
    if (video.attentionIndex > current.topVideo.attentionIndex) current.topVideo = video;
    channels.set(id, current);
  }
  return [...channels.values()].sort((left, right) => right.viewsPerHour - left.viewsPerHour).slice(0, 12).map((channel, index) => ({ ...channel, rank: index + 1 }));
}

function buildAlerts(collection) {
  const alerts = [];
  for (const video of collection.videos.slice(0, 10)) {
    if (video.movement === "entrou" && video.rank <= 5) alerts.push({ type: "new_top_video", level: video.rank <= 3 ? "high" : "medium", title: "Novo vídeo entrou no Top 10", text: video.title, detail: `${video.channel} · ${video.viewsPerHour} visualizações/h`, url: video.url, itemId: video.id });
    if (video.viewsPerHour >= 100_000 && video.ageHours <= 6) alerts.push({ type: "fast_video", level: "high", title: "Vídeo recente com alta velocidade", text: video.title, detail: `${video.viewsPerHour} visualizações/h`, url: video.url, itemId: video.id });
    if (video.commentScore >= 75) alerts.push({ type: "comments", level: "medium", title: "Comentários acima da média", text: video.title, detail: `${video.comments} comentários`, url: video.url, itemId: video.id });
  }
  for (const topic of collection.topics.slice(0, 12)) {
    if (topic.channelCount >= 3) alerts.push({ type: "multi_channel", level: topic.decisionLevel, title: "Assunto apareceu em vários canais", text: topic.label, detail: `${topic.channelCount} canais · índice ${topic.attentionIndex}`, topicId: topic.id });
    if (topic.deltaIndex >= 20) alerts.push({ type: "topic_growth", level: "high", title: "Assunto acelerou", text: topic.label, detail: `+${topic.deltaIndex} pontos desde a coleta anterior`, topicId: topic.id });
  }
  return alerts.slice(0, 20);
}

export function buildYouTubeCollection(videos, { region = DEFAULT_REGION, previous = null, collectedAt = new Date().toISOString(), cached = false } = {}) {
  const attentionVideos = calculateYouTubeAttention(videos);
  const collection = compareCollection({
    id: crypto.randomUUID(),
    collectedAt,
    region,
    cached,
    newsOnly: true,
    channelScope: YOUTUBE_CHANNEL_SCOPE,
    videos: attentionVideos,
    topics: extractYouTubeTopics(attentionVideos),
  }, previous);
  collection.channels = buildChannels(collection.videos);
  collection.alerts = buildAlerts(collection);
  collection.stats = {
    videoCount: collection.videos.length,
    topicCount: collection.topics.length,
    channelCount: collection.channels.length,
    urgentCount: collection.topics.filter((topic) => topic.decisionLevel === "high").length,
    views: collection.videos.reduce((sum, video) => sum + video.views, 0),
    viewsPerHour: collection.videos.reduce((sum, video) => sum + video.viewsPerHour, 0),
    comments: collection.videos.reduce((sum, video) => sum + video.comments, 0),
  };
  return collection;
}

function youtubeChannelLookup(input) {
  const value = String(input || "").trim();
  if (!value) return null;
  if (/^UC[a-zA-Z0-9_-]{20,}$/.test(value)) return { key:"id", value };
  if (/^@/.test(value)) return { key:"forHandle", value };
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!/(^|\.)youtube\.com$/i.test(url.hostname)) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "channel" && parts[1]) return { key:"id", value:parts[1] };
    const handle = parts.find((part) => part.startsWith("@"));
    if (handle) return { key:"forHandle", value:handle };
    if (parts[0]) return { key:"forHandle", value:`@${parts[0]}` };
  } catch {}
  return { key:"forHandle", value:value.startsWith("@") ? value : `@${value}` };
}

export async function resolveYouTubeChannel({ apiKey, input } = {}) {
  const lookup = youtubeChannelLookup(input);
  if (!lookup) throw new Error("Informe um @handle, URL ou ID de canal válido.");
  let payload = await youtubeRequest(apiKey, "channels", { part:"snippet,contentDetails,statistics", [lookup.key]:lookup.value, maxResults:1 }, { retry:false });
  let item = payload?.items?.[0];
  if (!item && lookup.key === "forHandle") {
    const username = String(lookup.value).replace(/^@/, "");
    payload = await youtubeRequest(apiKey, "channels", { part:"snippet,contentDetails,statistics", forUsername:username, maxResults:1 }, { retry:false }).catch(() => ({items:[]}));
    item = payload?.items?.[0];
  }
  if (!item?.id) throw new Error("Canal não encontrado no YouTube.");
  const uploadsPlaylistId = item.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) throw new Error("O canal não possui playlist pública de uploads disponível.");
  return {
    channelId:item.id,
    title:item.snippet?.title || "Canal sem nome",
    handle:item.snippet?.customUrl || null,
    uploadsPlaylistId,
    thumbnail:item.snippet?.thumbnails?.default?.url || item.snippet?.thumbnails?.medium?.url || "",
    subscriberCount:Number(item.statistics?.subscriberCount)||0,
    quotaEvents:[{ endpoint:"channels.list", bucket:"general", units:1, calls:1 }],
  };
}

async function mapPool(items, concurrency, worker) {
  const output = new Array(items.length); let cursor = 0;
  async function runner(){ while(true){ const i=cursor++; if(i>=items.length) return; output[i]=await worker(items[i],i); } }
  await Promise.all(Array.from({length:Math.max(1,Math.min(concurrency,items.length||1))}, runner));
  return output;
}

export async function collectYouTubeCuratedChannels({ apiKey, channels = [], region = DEFAULT_REGION, limit = DEFAULT_LIMIT, previous = null, nowMs = Date.now() } = {}) {
  const active = (Array.isArray(channels) ? channels : []).filter((channel) => channel?.active !== false && channel?.uploadsPlaylistId);
  if (!active.length) return collectYouTubeTrending({ apiKey, region, limit, previous, nowMs });
  const quotaEvents = [];
  const playlistResults = await mapPool(active.slice(0,30), 4, async (channel) => {
    try {
      const payload = await youtubeRequest(apiKey, "playlistItems", { part:"snippet,contentDetails", playlistId:channel.uploadsPlaylistId, maxResults:8 });
      quotaEvents.push({ endpoint:"playlistItems.list", bucket:"general", units:1, calls:1 });
      return (payload.items || []).map((item) => ({ id:item.contentDetails?.videoId || item.snippet?.resourceId?.videoId, channelId:channel.channelId })).filter((item)=>item.id);
    } catch { return []; }
  });
  const videoIds = [...new Set(playlistResults.flat().map((entry)=>entry.id))].slice(0,50);
  if (!videoIds.length) {
    const cached = restrictYouTubeCollectionToNews(previous);
    if (cached?.videos?.length) return { collection:{...cached,id:crypto.randomUUID(),collectedAt:new Date(nowMs).toISOString(),cached:true,cacheReason:"Canais curados sem novos uploads acessíveis nesta coleta.",curated:true}, quotaEvents };
    return { collection:buildYouTubeCollection([], { region, previous:null, collectedAt:new Date(nowMs).toISOString() }), quotaEvents };
  }
  const payload = await youtubeRequest(apiKey, "videos", { part:"snippet,statistics,contentDetails", id:videoIds.join(","), maxResults:50, hl:"pt-BR" });
  quotaEvents.push({ endpoint:"videos.list", bucket:"general", units:1, calls:1 });
  const allowed = new Set(active.map((channel)=>channel.channelId));
  const cutoff = nowMs - 7*24*3600000;
  const sample = (payload.items || []).filter((item)=>allowed.has(item.snippet?.channelId) && Date.parse(item.snippet?.publishedAt || 0)>=cutoff).map((item,index)=>normalizeYouTubeVideo(item,index,nowMs));
  const videos = sample.sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).slice(0,clamp(limit,5,50));
  const collection = buildYouTubeCollection(videos,{region:String(region||DEFAULT_REGION).toUpperCase(),previous,collectedAt:new Date(nowMs).toISOString()});
  collection.curated = true;
  collection.curatedChannelCount = active.length;
  collection.filterStats = { sampleCount:sample.length, approvedCount:videos.length };
  return { collection, quotaEvents };
}

export async function collectYouTubeTrending({ apiKey, region = DEFAULT_REGION, limit = DEFAULT_LIMIT, previous = null, nowMs = Date.now() } = {}) {
  const outputLimit = clamp(limit, 5, 50);
  const payload = await youtubeRequest(apiKey, "videos", {
    part: "snippet,statistics,contentDetails",
    chart: "mostPopular",
    regionCode: String(region || DEFAULT_REGION).toUpperCase(),
    videoCategoryId: YOUTUBE_NEWS_CATEGORY_ID,
    maxResults: 50,
    hl: "pt-BR",
  });
  const sample = (payload.items || []).map((item, index) => normalizeYouTubeVideo(item, index, nowMs));
  const videos = filterYouTubeNewsVideos(sample).slice(0, outputLimit);
  if (!videos.length) {
    const previousNews = restrictYouTubeCollectionToNews(previous);
    if (previousNews?.videos?.length) {
      return {
        collection: {
          ...previousNews,
          id: crypto.randomUUID(),
          collectedAt: new Date(nowMs).toISOString(),
          cached: true,
          cacheReason: "Nenhum canal jornalístico aprovado apareceu na amostra atual de News & Politics.",
          filterStats: { sampleCount: sample.length, approvedCount: 0 },
        },
        quotaEvents: [{ endpoint: "videos.list", bucket: "general", units: 1, calls: 1 }],
      };
    }
  }
  const collection = buildYouTubeCollection(videos, { region: String(region || DEFAULT_REGION).toUpperCase(), previous, collectedAt: new Date(nowMs).toISOString() });
  collection.filterStats = { sampleCount: sample.length, approvedCount: videos.length };
  return {
    collection,
    quotaEvents: [{ endpoint: "videos.list", bucket: "general", units: 1, calls: 1 }],
  };
}

function mergeSearchWithStats(searchItems, statsItems, nowMs) {
  const stats = new Map((statsItems || []).map((item) => [item.id, item]));
  return searchItems.map((searchItem, index) => {
    const id = searchItem?.id?.videoId;
    const stat = stats.get(id) || {};
    return normalizeYouTubeVideo({
      id,
      snippet: {
        ...(stat.snippet || {}),
        ...(searchItem.snippet || {}),
        categoryId: stat.snippet?.categoryId || searchItem.snippet?.categoryId || "",
        channelId: searchItem.snippet?.channelId || stat.snippet?.channelId || "",
        channelTitle: searchItem.snippet?.channelTitle || stat.snippet?.channelTitle || "",
        publishedAt: searchItem.snippet?.publishedAt || stat.snippet?.publishedAt || stat.snippet?.publishTime,
      },
      statistics: stat.statistics || {},
      contentDetails: stat.contentDetails || {},
    }, index, nowMs);
  });
}

export async function collectYouTubeTerm({ apiKey, term, termId, region = DEFAULT_REGION, hours = 24, limit = 10, nowMs = Date.now() } = {}) {
  const publishedAfter = new Date(nowMs - clamp(hours, 1, 168) * 3_600_000).toISOString();
  const search = await youtubeRequest(apiKey, "search", {
    part: "snippet",
    q: term,
    type: "video",
    regionCode: String(region || DEFAULT_REGION).toUpperCase(),
    relevanceLanguage: "pt",
    safeSearch: "moderate",
    order: "date",
    videoCategoryId: YOUTUBE_NEWS_CATEGORY_ID,
    publishedAfter,
    maxResults: clamp(Math.max(Number(limit) * 4, 20), 1, 50),
  });
  const searchItems = search.items || [];
  const ids = searchItems.map((item) => item?.id?.videoId).filter(Boolean);
  let statsItems = [];
  const quotaEvents = [{ endpoint: "search.list", bucket: "search", units: 1, calls: 1 }];
  if (ids.length) {
    try {
      const stats = await youtubeRequest(apiKey, "videos:batchGetStats", { part: "snippet,statistics,contentDetails", id: ids.join(",") });
      statsItems = stats.items || [];
      quotaEvents.push({ endpoint: "videos.batchGetStats", bucket: "batchStats", units: 1, calls: 1 });
    } catch (error) {
      if (error?.quota || error?.code === "YOUTUBE_KEY_MISSING") throw error;
      const fallback = await youtubeRequest(apiKey, "videos", { part: "snippet,statistics,contentDetails", id: ids.join(",") });
      statsItems = fallback.items || [];
      quotaEvents.push({ endpoint: "videos.list", bucket: "general", units: 1, calls: 1, fallback: true });
    }
  }
  const videos = calculateYouTubeAttention(
    filterYouTubeNewsVideos(mergeSearchWithStats(searchItems, statsItems, nowMs))
  ).slice(0, clamp(limit, 1, 20));
  return {
    result: {
      id: crypto.randomUUID(),
      termId,
      term,
      collectedAt: new Date(nowMs).toISOString(),
      region: String(region || DEFAULT_REGION).toUpperCase(),
      windowHours: hours,
      videos,
      summary: {
        videoCount: videos.length,
        views: videos.reduce((sum, video) => sum + video.views, 0),
        viewsPerHour: videos.reduce((sum, video) => sum + video.viewsPerHour, 0),
        comments: videos.reduce((sum, video) => sum + video.comments, 0),
        topVideo: videos[0] || null,
      },
    },
    quotaEvents,
  };
}

export function defaultYouTubeQuotaState(date = new Date().toISOString().slice(0, 10)) {
  return { date, generalUnits: 0, searchCalls: 0, batchStatsUnits: 0, calls: [], searchLimit: 100, generalLimit: 10_000, batchStatsLimit: 10_000 };
}

export function applyYouTubeQuotaEvents(state, events = [], at = new Date().toISOString()) {
  const today = at.slice(0, 10);
  const output = state?.date === today ? { ...defaultYouTubeQuotaState(today), ...state, calls: [...(state.calls || [])] } : defaultYouTubeQuotaState(today);
  for (const event of events) {
    if (event.bucket === "search") output.searchCalls += Number(event.calls || 1);
    else if (event.bucket === "batchStats") output.batchStatsUnits += Number(event.units || 1);
    else output.generalUnits += Number(event.units || 1);
    output.calls.push({ at, ...event });
  }
  output.calls = output.calls.slice(-200);
  return output;
}

export function publicYouTubeQuota(state) {
  const quota = { ...defaultYouTubeQuotaState(), ...(state || {}) };
  return {
    date: quota.date,
    search: { used: quota.searchCalls, limit: quota.searchLimit, remaining: Math.max(0, quota.searchLimit - quota.searchCalls) },
    general: { used: quota.generalUnits, limit: quota.generalLimit, remaining: Math.max(0, quota.generalLimit - quota.generalUnits) },
    batchStats: { used: quota.batchStatsUnits, limit: quota.batchStatsLimit, remaining: Math.max(0, quota.batchStatsLimit - quota.batchStatsUnits) },
  };
}
