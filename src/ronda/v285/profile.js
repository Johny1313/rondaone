import { plainText, stableHash } from "./parser.js";

export const SESSION_COOKIE_NAME = "ronda_session";
export const SESSION_TTL_DAYS = 30;
export const PASSWORD_ITERATIONS = 120_000;
export const MAX_STYLE_SAMPLES = 8;
export const MAX_STYLE_SAMPLE_CHARS = 5_000;
export const MAX_STYLE_TOTAL_CHARS = 30_000;
export const MIN_SLIDE_COUNT = 3;
export const MAX_SLIDE_COUNT = 15;
export const DEFAULT_SLIDE_COUNT = 7;
export const MAX_CAROUSEL_LEARNING_EXAMPLES = 24;
export const WRITING_STYLE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const encoder = new TextEncoder();

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const normalized = String(value || "").replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function normalizeEmail(value) {
  return String(value || "").trim().toLocaleLowerCase("pt-BR").slice(0, 254);
}

export function validateEmail(value) {
  const email = normalizeEmail(value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email)) throw new Error("Informe um e-mail válido.");
  return email;
}

export function validatePassword(value) {
  const password = String(value || "");
  if (password.length < 8) throw new Error("A senha precisa ter pelo menos 8 caracteres.");
  if (password.length > 72) throw new Error("A senha pode ter no máximo 72 caracteres.");
  return password;
}

export function normalizeDisplayName(value, email = "") {
  const cleaned = plainText(value).replace(/\s+/g, " ").trim().slice(0, 80);
  if (cleaned) return cleaned;
  return normalizeEmail(email).split("@")[0].slice(0, 80) || "Perfil editorial";
}

export function validateSlideCount(value, fallback = DEFAULT_SLIDE_COUNT) {
  const number = Number(value);
  const normalized = Number.isInteger(number) ? number : Number(fallback);
  if (!Number.isInteger(normalized) || normalized < MIN_SLIDE_COUNT || normalized > MAX_SLIDE_COUNT) {
    throw new Error(`Escolha entre ${MIN_SLIDE_COUNT} e ${MAX_SLIDE_COUNT} slides.`);
  }
  return normalized;
}

export function normalizeStyleSample(body = {}) {
  const content = plainText(body.content).replace(/\n{4,}/g, "\n\n\n").trim();
  if (content.length < 40) throw new Error("O texto precisa ter pelo menos 40 caracteres.");
  if (content.length > MAX_STYLE_SAMPLE_CHARS) throw new Error(`Cada texto pode ter no máximo ${MAX_STYLE_SAMPLE_CHARS.toLocaleString("pt-BR")} caracteres.`);
  const title = plainText(body.title).replace(/\s+/g, " ").trim().slice(0, 120) || "Texto sem título";
  const allowedTypes = new Set(["post", "texto", "legenda", "roteiro", "artigo"]);
  const sourceType = allowedTypes.has(String(body.sourceType || "").toLocaleLowerCase("pt-BR"))
    ? String(body.sourceType).toLocaleLowerCase("pt-BR")
    : "texto";
  return {
    title,
    sourceType,
    content,
    contentHash: stableHash(content.toLocaleLowerCase("pt-BR")),
    charCount: content.length,
  };
}

export function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function randomSalt() {
  return randomToken(18);
}

export async function sha256Hex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(String(value || ""))));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashPassword(password, salt = randomSalt(), iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(validatePassword(password)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: base64UrlToBytes(salt),
    iterations: Math.max(100_000, Number(iterations) || PASSWORD_ITERATIONS),
  }, key, 256);
  return { hash: bytesToBase64Url(new Uint8Array(bits)), salt, iterations: Math.max(100_000, Number(iterations) || PASSWORD_ITERATIONS) };
}

export async function verifyPassword(password, record = {}) {
  if (!record.passwordHash || !record.passwordSalt) return false;
  const candidate = await hashPassword(password, record.passwordSalt, record.passwordIterations);
  const left = encoder.encode(candidate.hash);
  const right = encoder.encode(String(record.passwordHash));
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

export function parseCookies(header) {
  const output = {};
  for (const part of String(header || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) output[key] = decodeURIComponent(value);
  }
  return output;
}

export function sessionCookie(token, { secure = true, maxAgeSeconds = SESSION_TTL_DAYS * 24 * 60 * 60 } = {}) {
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : null,
    `Max-Age=${Math.max(0, Number(maxAgeSeconds) || 0)}`,
  ].filter(Boolean).join("; ");
}

export function clearSessionCookie({ secure = true } = {}) {
  return sessionCookie("", { secure, maxAgeSeconds: 0 });
}

function averageSentenceLength(samples) {
  const sentences = samples.flatMap((sample) => String(sample.content || "").split(/[.!?]+/).map((item) => item.trim()).filter(Boolean));
  if (!sentences.length) return 0;
  return sentences.reduce((total, sentence) => total + sentence.split(/\s+/).filter(Boolean).length, 0) / sentences.length;
}

function fallbackStyleProfile(samples) {
  const all = samples.map((sample) => sample.content).join("\n");
  const sentenceAverage = averageSentenceLength(samples);
  const questions = (all.match(/\?/g) || []).length;
  const exclamations = (all.match(/!/g) || []).length;
  const upperHooks = samples.filter((sample) => /^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ0-9][^.!?]{5,90}[.!?]?$/m.test(sample.content)).length;
  const tone = exclamations > samples.length * 2 ? "Enérgico e direto" : questions > samples.length ? "Conversacional e provocativo" : "Informativo e claro";
  const sentenceLength = sentenceAverage <= 10 ? "Frases curtas" : sentenceAverage <= 18 ? "Frases médias" : "Frases mais desenvolvidas";
  return {
    tone,
    rhythm: sentenceAverage <= 12 ? "Ritmo rápido, com uma ideia por frase" : "Ritmo equilibrado, com transições claras",
    sentenceLength,
    titleStyle: upperHooks ? "Aberturas curtas com gancho forte" : "Títulos objetivos que antecipam o assunto",
    subtitleStyle: "Subtítulos informativos, sem repetir o título",
    structure: "Gancho inicial, contexto progressivo, informação principal, impacto e encerramento",
    ctaStyle: "Convite curto para acompanhar, comentar ou abrir a matéria original",
    vocabulary: [],
    avoid: ["sensacionalismo", "informações sem evidência", "repetição entre slides"],
    instructions: [
      `Manter ${sentenceLength.toLocaleLowerCase("pt-BR")}.`,
      `Usar tom ${tone.toLocaleLowerCase("pt-BR")}.`,
      "Preservar clareza jornalística e adaptar o ritmo aos exemplos enviados.",
    ],
    mode: "heuristic",
  };
}

const STYLE_SCHEMA = {
  type: "object",
  properties: {
    tone: { type: "string" },
    rhythm: { type: "string" },
    sentenceLength: { type: "string" },
    titleStyle: { type: "string" },
    subtitleStyle: { type: "string" },
    structure: { type: "string" },
    ctaStyle: { type: "string" },
    vocabulary: { type: "array", items: { type: "string" }, maxItems: 12 },
    avoid: { type: "array", items: { type: "string" }, maxItems: 12 },
    instructions: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 12 },
  },
  required: ["tone", "rhythm", "sentenceLength", "titleStyle", "subtitleStyle", "structure", "ctaStyle", "vocabulary", "avoid", "instructions"],
};

function safeProfile(value, fallback) {
  const source = value && typeof value === "object" ? value : {};
  const text = (key, limit = 220) => plainText(source[key] || fallback[key]).slice(0, limit);
  const list = (key, limit = 12) => (Array.isArray(source[key]) ? source[key] : fallback[key] || [])
    .map((item) => plainText(item).slice(0, 120)).filter(Boolean).slice(0, limit);
  return {
    tone: text("tone"),
    rhythm: text("rhythm"),
    sentenceLength: text("sentenceLength"),
    titleStyle: text("titleStyle"),
    subtitleStyle: text("subtitleStyle"),
    structure: text("structure", 300),
    ctaStyle: text("ctaStyle"),
    vocabulary: list("vocabulary"),
    avoid: list("avoid"),
    instructions: list("instructions"),
    mode: source.mode === "ai" ? "ai" : fallback.mode || "heuristic",
  };
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("A análise do estilo excedeu o tempo limite.")), timeoutMs)),
  ]);
}

export async function analyzeWritingStyle(samples, { ai = null, model = WRITING_STYLE_MODEL } = {}) {
  const normalized = (samples || []).filter((sample) => sample?.content).slice(0, MAX_STYLE_SAMPLES);
  if (!normalized.length) throw new Error("Adicione pelo menos um texto antes de atualizar o perfil de escrita.");
  const fallback = fallbackStyleProfile(normalized);
  if (!ai?.run) return fallback;
  const excerpts = normalized.map((sample, index) => [
    `EXEMPLO ${index + 1} — ${sample.title || "Sem título"} (${sample.sourceType || "texto"})`,
    String(sample.content).slice(0, 2_400),
  ].join("\n")).join("\n\n").slice(0, 24_000);
  try {
    const response = await withTimeout(ai.run(model, {
      messages: [
        {
          role: "system",
          content: "Você é um analista de estilo editorial. Identifique padrões de escrita sem copiar trechos, sem inventar preferências e sem avaliar fatos. Produza um guia compacto para orientar futuros carrosséis jornalísticos em português do Brasil. O guia deve preservar apuração e factualidade. Retorne somente o JSON solicitado.",
        },
        {
          role: "user",
          content: `Analise os exemplos abaixo e descreva tom, ritmo, tamanho de frases, estilo de títulos e subtítulos, estrutura, CTA, vocabulário recorrente, elementos a evitar e instruções práticas.\n\n${excerpts}`,
        },
      ],
      response_format: { type: "json_schema", json_schema: STYLE_SCHEMA },
      max_tokens: 1_100,
      temperature: 0.08,
      top_p: 0.8,
    }), 14_000);
    const raw = response?.response ?? response?.result ?? response;
    const parsed = typeof raw === "string" ? JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")) : raw;
    return safeProfile({ ...parsed, mode: "ai" }, fallback);
  } catch {
    return fallback;
  }
}

export function writingStylePrompt(profile) {
  if (!profile || typeof profile !== "object") return "";
  const instructions = (profile.instructions || []).slice(0, 10).join("; ");
  return [
    `TOM: ${profile.tone || "Jornalístico e factual"}`,
    `RITMO: ${profile.rhythm || "Equilibrado"}`,
    `TAMANHO DE FRASE: ${profile.sentenceLength || "Médio"}`,
    `TÍTULOS: ${profile.titleStyle || "Objetivos"}`,
    `SUBTÍTULOS: ${profile.subtitleStyle || "Informativos"}`,
    `ESTRUTURA: ${profile.structure || "Progressiva"}`,
    `CTA: ${profile.ctaStyle || "Curto e informativo"}`,
    profile.vocabulary?.length ? `VOCABULÁRIO PREFERIDO: ${profile.vocabulary.join(", ")}` : null,
    profile.avoid?.length ? `EVITAR: ${profile.avoid.join(", ")}` : null,
    instructions ? `INSTRUÇÕES: ${instructions}` : null,
  ].filter(Boolean).join("\n").slice(0, 3_500);
}


export function normalizeCarouselLearningExample(body = {}) {
  const rawSlides = Array.isArray(body.slides) ? body.slides : [];
  const slideCount = validateSlideCount(body.slideCount || rawSlides.length || DEFAULT_SLIDE_COUNT);
  if (rawSlides.length !== slideCount) throw new Error("O exemplo precisa conter a mesma quantidade de slides informada.");
  const slides = rawSlides.map((slide, index) => {
    const title = plainText(slide?.title).replace(/\s+/g, " ").trim().slice(0, 100);
    const subtitle = plainText(slide?.subtitle || slide?.body).replace(/\s+/g, " ").trim().slice(0, 260);
    const role = plainText(slide?.role).replace(/\s+/g, " ").trim().slice(0, 60) || `Slide ${index + 1}`;
    if (!title || !subtitle) throw new Error(`O slide ${index + 1} precisa de título e subtítulo para entrar na memória editorial.`);
    return { number: index + 1, role, title, subtitle };
  });
  const topicId = plainText(body.topicId).replace(/\s+/g, " ").trim().slice(0, 100) || "unknown";
  const sourceName = plainText(body.sourceName).replace(/\s+/g, " ").trim().slice(0, 100) || "Fonte não informada";
  const signature = slides.map((slide) => `${slide.role}|${slide.title}|${slide.subtitle}`).join("\n");
  return {
    topicId,
    sourceName,
    slideCount,
    slides,
    contentHash: stableHash(signature.toLocaleLowerCase("pt-BR")),
  };
}

function average(values = []) {
  return values.length ? values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length : 0;
}

export function summarizeCarouselLearning(examples = []) {
  const recent = (Array.isArray(examples) ? examples : []).slice(0, MAX_CAROUSEL_LEARNING_EXAMPLES);
  const slides = recent.flatMap((example) => Array.isArray(example?.slides) ? example.slides : []);
  if (!slides.length) return { count: 0, prompt: "", metrics: null };
  const informative = slides.filter((slide) => String(slide.role || "").toLocaleLowerCase("pt-BR") !== "cta");
  const titleLengths = informative.map((slide) => String(slide.title || "").length);
  const subtitleLengths = informative.map((slide) => String(slide.subtitle || "").length);
  const subtitleSentences = informative.map((slide) => Math.max(1, (String(slide.subtitle || "").match(/[.!?]+/g) || []).length));
  const questionTitles = informative.filter((slide) => /\?$/.test(String(slide.title || "").trim())).length;
  const colonTitles = informative.filter((slide) => /:/.test(String(slide.title || ""))).length;
  const titleAverage = Math.round(average(titleLengths));
  const subtitleAverage = Math.round(average(subtitleLengths));
  const sentenceAverage = Number(average(subtitleSentences).toFixed(1));
  const questionRate = informative.length ? Math.round((questionTitles / informative.length) * 100) : 0;
  const colonRate = informative.length ? Math.round((colonTitles / informative.length) * 100) : 0;
  const metrics = { titleAverage, subtitleAverage, sentenceAverage, questionRate, colonRate, examples: recent.length };
  const prompt = [
    `MEMÓRIA EDITORIAL APROVADA: ${recent.length} carrosséis aceitos ou editados pelo usuário.`,
    `Comprimento preferido observado: títulos ~${titleAverage} caracteres; subtítulos ~${subtitleAverage} caracteres; ${sentenceAverage} frase(s) por subtítulo.`,
    `Títulos em forma de pergunta aparecem em ${questionRate}% dos slides e títulos com dois-pontos em ${colonRate}%.`,
    "Use esses padrões apenas para forma, ritmo e extensão. Não reutilize nomes, números, fatos ou frases de carrosséis anteriores.",
    "Quando houver conflito entre memória de estilo e factualidade da matéria atual, a matéria atual sempre prevalece.",
  ].join("\n");
  return { count: recent.length, prompt, metrics };
}
