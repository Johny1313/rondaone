const IMAGE_MODELS = {
  sdxl: {
    id: 'sdxl',
    model: '@cf/bytedance/stable-diffusion-xl-lightning',
    label: 'SDXL Lightning',
  },
  flux1: {
    id: 'flux1',
    model: '@cf/black-forest-labs/flux-1-schnell',
    label: 'FLUX.1 Schnell',
  },
  flux2: {
    id: 'flux2',
    model: '@cf/black-forest-labs/flux-2-klein-4b',
    label: 'FLUX.2 Klein 4B',
  },
};
const TEXT_MODEL = '@cf/zai-org/glm-4.7-flash';
const ENGINE_VERSION = '0.7.4-multi-image-engine';
const BUILD_ID = '074-MULTI-IMAGE-20260825';

function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || min));
}

function normalizeFormat(format = '1:1') {
  const presets = {
    '1:1': [1024, 1024],
    '16:9': [1344, 768],
    '9:16': [768, 1344],
    '4:5': [896, 1120],
  };
  return presets[format] || presets['1:1'];
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error('JSON inválido');
  }
}

function safePrompt(value, max = 2048) {
  return String(value || '').trim().slice(0, max);
}

function normalizeSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function dedupePrompt(value, max = 520) {
  let text = normalizeSpaces(value)
    .replace(/(?:no text[,.; ]*){2,}/gi, 'no text, ')
    .replace(/(?:no watermark[,.; ]*){2,}/gi, 'no watermark, ')
    .replace(/(?:photorealistic editorial(?: news)? (?:illustration|photography)[,.; ]*){2,}/gi, 'photorealistic editorial image, ')
    .replace(/\s+,/g, ',')
    .replace(/,{2,}/g, ',')
    .replace(/\.{2,}/g, '.');
  if (text.length <= max) return text;
  const clipped = text.slice(0, max);
  const boundary = Math.max(clipped.lastIndexOf('. '), clipped.lastIndexOf(', '), clipped.lastIndexOf(' '));
  return (boundary > max * 0.72 ? clipped.slice(0, boundary) : clipped).trim().replace(/[,. ]+$/, '') + '.';
}

function friendlyAiError(error) {
  const message = String(error?.message || error || 'Falha na IA');
  if (/3036|daily free allocation|10,?000 neurons/i.test(message)) {
    return { code: 'FREE_DAILY_LIMIT', status: 429, message: 'Limite gratuito diário da IA atingido. Nenhuma cobrança será feita. A geração volta após a renovação da cota gratuita da Cloudflare.' };
  }
  if (/3040|out of capacity/i.test(message)) {
    return { code: 'TEMPORARY_CAPACITY', status: 503, message: 'A IA gratuita está temporariamente sem capacidade. Aguarde um pouco e tente novamente.' };
  }
  if (/5035|requires.*paid|paid plan/i.test(message)) {
    return { code: 'PAID_MODEL_BLOCKED', status: 503, message: 'Este modelo exige plano pago e foi bloqueado pelo modo MVP gratuito. Nenhuma cobrança foi realizada.' };
  }
  return { code: 'AI_ERROR', status: 500, message };
}

function buildImagePromptParts(input = {}) {
  const positive = dedupePrompt(input.prompt, 520);
  const negative = dedupePrompt(input.negative ?? input.negativePrompt, 220);
  const format = String(input.format || '1:1');
  if (!positive) throw new Error('Prompt vazio');
  const aspectHint = format === '16:9' ? 'wide 16:9 composition' :
    format === '9:16' ? 'vertical 9:16 composition' :
    format === '4:5' ? 'vertical 4:5 editorial composition' :
    'square 1:1 composition';
  return {
    prompt: dedupePrompt(`${positive}. ${aspectHint}.`, 700),
    negative: negative || 'text, watermark, logo, distorted anatomy, duplicated objects, low quality',
  };
}

function normalizeMode(value) {
  const raw = String(value || 'balanced').toLowerCase().trim();
  if (['fast', 'rapido', 'rápido'].includes(raw)) return 'fast';
  if (['quality', 'qualidade', 'high'].includes(raw)) return 'quality';
  return 'balanced';
}

function normalizeEngine(value) {
  const raw = String(value || 'auto').toLowerCase().trim();
  if (['sdxl', 'sdxl-lightning', 'stable-diffusion-xl-lightning'].includes(raw)) return 'sdxl';
  if (['flux1', 'flux-1', 'flux1-schnell', 'flux-1-schnell', 'schnell'].includes(raw)) return 'flux1';
  if (['flux2', 'flux-2', 'flux2-klein', 'flux-2-klein-4b', 'klein'].includes(raw)) return 'flux2';
  return 'auto';
}

function engineChain(mode, requestedEngine, allowFallback = true) {
  const base = mode === 'quality'
    ? ['flux2', 'flux1', 'sdxl']
    : ['sdxl', 'flux1', 'flux2'];
  const requested = normalizeEngine(requestedEngine);
  if (requested === 'auto') return base;
  if (!allowFallback) return [requested];
  return [requested, ...base.filter((id) => id !== requested)];
}

function canContinueFallback(error) {
  const msg = String(error?.message || error || '');
  return !/3036|daily free allocation|10,?000 neurons/i.test(msg);
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function imageResultToDataUrl(result, fallbackType = 'image/png') {
  if (!result) throw new Error('Modelo não retornou imagem');
  if (typeof result?.image === 'string' && result.image) {
    return `data:image/jpeg;base64,${result.image}`;
  }
  if (typeof result === 'string') {
    if (/^data:image\//i.test(result)) return result;
    return `data:${fallbackType};base64,${result}`;
  }

  let arrayBuffer;
  let contentType = fallbackType;
  if (result instanceof Response) {
    contentType = result.headers.get('content-type') || contentType;
    arrayBuffer = await result.arrayBuffer();
  } else if (typeof ReadableStream !== 'undefined' && result instanceof ReadableStream) {
    arrayBuffer = await new Response(result).arrayBuffer();
  } else if (result instanceof ArrayBuffer) {
    arrayBuffer = result;
  } else if (ArrayBuffer.isView(result)) {
    arrayBuffer = result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
  } else {
    throw new Error('Formato de imagem retornado pelo modelo não reconhecido');
  }
  if (!arrayBuffer?.byteLength) throw new Error('Modelo retornou uma imagem vazia');
  return `data:${contentType};base64,${toBase64(arrayBuffer)}`;
}

async function runSdxl(env, prompt, negative, width, height, seed) {
  const payload = {
    prompt,
    negative_prompt: negative,
    width,
    height,
    num_steps: 4,
    guidance: 7.5,
  };
  if (Number.isFinite(seed)) payload.seed = Math.abs(Math.trunc(seed));
  const result = await env.AI.run(IMAGE_MODELS.sdxl.model, payload);
  return {
    image: await imageResultToDataUrl(result, 'image/png'),
    model: IMAGE_MODELS.sdxl.model,
    modelLabel: IMAGE_MODELS.sdxl.label,
    engine: 'sdxl',
  };
}

async function runFlux1(env, prompt, negative) {
  const combined = dedupePrompt(`${prompt}${negative ? ` Avoid ${negative}.` : ''}`, 1024);
  const result = await env.AI.run(IMAGE_MODELS.flux1.model, {
    prompt: combined,
    steps: 4,
  });
  if (!result?.image) throw new Error('FLUX.1 Schnell não retornou imagem');
  return {
    image: `data:image/jpeg;base64,${result.image}`,
    model: IMAGE_MODELS.flux1.model,
    modelLabel: IMAGE_MODELS.flux1.label,
    engine: 'flux1',
  };
}

async function runFlux2(env, prompt, negative, width, height, seed) {
  const combined = dedupePrompt(`${prompt}${negative ? ` Avoid ${negative}.` : ''}`, 1200);
  const form = new FormData();
  form.append('prompt', combined);
  form.append('width', String(width));
  form.append('height', String(height));
  if (Number.isFinite(seed)) form.append('seed', String(Math.abs(Math.trunc(seed))));

  const serialized = new Response(form);
  const result = await env.AI.run(IMAGE_MODELS.flux2.model, {
    multipart: {
      body: serialized.body,
      contentType: serialized.headers.get('content-type'),
    },
  });
  if (!result?.image) throw new Error('FLUX.2 Klein não retornou imagem');
  return {
    image: `data:image/jpeg;base64,${result.image}`,
    model: IMAGE_MODELS.flux2.model,
    modelLabel: IMAGE_MODELS.flux2.label,
    engine: 'flux2',
  };
}

async function runImageEngine(env, engineId, input, promptParts, width, height) {
  const rawSeed = input.seed;
  const seed = rawSeed === null || rawSeed === undefined || String(rawSeed).trim() === '' ? NaN : Number(rawSeed);
  if (engineId === 'sdxl') return runSdxl(env, promptParts.prompt, promptParts.negative, width, height, seed);
  if (engineId === 'flux1') return runFlux1(env, promptParts.prompt, promptParts.negative);
  if (engineId === 'flux2') return runFlux2(env, promptParts.prompt, promptParts.negative, width, height, seed);
  throw new Error(`Engine de imagem desconhecida: ${engineId}`);
}

async function generateOne(env, input) {
  const [width, height] = normalizeFormat(input.format);
  const promptParts = buildImagePromptParts(input);
  const mode = normalizeMode(input.mode ?? input.qualityMode ?? input.quality);
  const requestedEngine = normalizeEngine(input.engine ?? input.model);
  const allowFallback = input.allowFallback !== false;
  const chain = engineChain(mode, requestedEngine, allowFallback);
  const attempts = [];
  let lastError = null;

  for (const engineId of chain) {
    const meta = IMAGE_MODELS[engineId];
    try {
      const result = await runImageEngine(env, engineId, input, promptParts, width, height);
      attempts.push({ engine: engineId, model: meta.model, label: meta.label, ok: true });
      return {
        ...result,
        mode,
        requestedEngine,
        fallbackUsed: attempts.length > 1,
        attempts,
      };
    } catch (error) {
      lastError = error;
      attempts.push({
        engine: engineId,
        model: meta.model,
        label: meta.label,
        ok: false,
        error: safePrompt(error?.message || String(error), 300),
      });
      if (!canContinueFallback(error)) break;
    }
  }

  const details = attempts.map((a) => `${a.label}: ${a.ok ? 'ok' : a.error}`).join(' | ');
  const failure = new Error(details || lastError?.message || 'Todos os motores de imagem falharam');
  failure.attempts = attempts;
  throw failure;
}

function extractTextModelOutput(output) {
  if (!output) return '';
  if (typeof output === 'string') return output;
  if (typeof output.response === 'string') return output.response;
  if (typeof output.result === 'string') return output.result;
  const content = output?.choices?.[0]?.message?.content ?? output?.choices?.[0]?.text;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(x => x?.text || x?.content || '').join('\n');
  return '';
}

function parseLooseJson(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(raw); } catch {}
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(raw.slice(first, last + 1)); } catch {}
  }
  return null;
}

function fallbackArticleAnalysis(input) {
  const title = safePrompt(input.title, 220);
  const subtitle = safePrompt(input.subtitle, 360);
  const text = safePrompt(input.text, 2200);
  const subject = normalizeSpaces(title || subtitle || text.slice(0, 180) || 'tema jornalístico');
  const base = dedupePrompt(`Editorial documentary photograph illustrating ${subject}. Neutral journalistic framing, credible real-world environment, natural light, realistic detail, clearly illustrative, no text, no watermark`, 430);
  return {
    summary: subject,
    entities: [],
    mood: 'editorial, informativo e neutro',
    notes: 'Imagem ilustrativa; não apresentar como registro factual do acontecimento.',
    concepts: [
      { title: 'Cena contextual', prompt: base },
      { title: 'Detalhe simbólico', prompt: dedupePrompt(`Editorial close-up representing ${subject}. Credible symbolic details, neutral news aesthetic, natural light, no text, no watermark`, 360) },
      { title: 'Ambiente de apoio', prompt: dedupePrompt(`Documentary-style environment related to ${subject}. Clean editorial composition with negative space for layout, realistic light, no text, no watermark`, 360) },
    ],
    prompt: base,
    negative: 'text, watermark, logo, fake headline, distorted anatomy, sensationalism',
  };
}

async function analyzeArticle(env, input) {
  const title = safePrompt(input.title, 300);
  const subtitle = safePrompt(input.subtitle, 700);
  const text = safePrompt(input.text, 24000);
  const url = safePrompt(input.url, 1000);
  if (!title && !text) throw new Error('Título ou texto da matéria é obrigatório');

  const messages = [
    {
      role: 'system',
      content: `Você é o módulo editorial visual do RONDA DESIGN. Analise matérias jornalísticas em português e proponha imagens ILUSTRATIVAS para uma redação. Nunca apresente a imagem como registro factual de um evento. Evite inventar números, manchetes, logos, placas ou fatos. Retorne APENAS JSON válido com: {"summary":"...","entities":["..."],"mood":"...","notes":"...","concepts":[{"title":"...","prompt":"..."},{"title":"...","prompt":"..."},{"title":"...","prompt":"..."}],"prompt":"...","negative":"..."}. Regras: prompts em inglês; cada prompt entre 180 e 420 caracteres; uma única descrição direta da cena; sem repetir 'photorealistic', 'editorial', 'no text' ou 'no watermark'; prefira cenário, sujeito, ação, enquadramento e luz; não use listas dentro do prompt.`
    },
    {
      role: 'user',
      content: `TÍTULO: ${title}\nSUBTÍTULO: ${subtitle}\nURL: ${url}\nMATÉRIA:\n${text}`,
    },
  ];

  try {
    const output = await env.AI.run(TEXT_MODEL, {
      messages,
      temperature: 0.25,
      max_completion_tokens: 850,
    });
    const parsed = parseLooseJson(extractTextModelOutput(output));
    if (!parsed) throw new Error('Resposta editorial fora do formato esperado');
    const fallback = fallbackArticleAnalysis(input);
    return {
      summary: safePrompt(parsed.summary || fallback.summary, 1200),
      entities: Array.isArray(parsed.entities) ? parsed.entities.map(x => safePrompt(x, 120)).filter(Boolean).slice(0, 12) : [],
      mood: safePrompt(parsed.mood || fallback.mood, 500),
      notes: safePrompt(parsed.notes || fallback.notes, 1000),
      concepts: Array.isArray(parsed.concepts) ? parsed.concepts.slice(0, 3).map((c, i) => ({
        title: safePrompt(c?.title || `Conceito ${i + 1}`, 160),
        prompt: dedupePrompt(c?.prompt || fallback.concepts[i]?.prompt || '', 460),
      })) : fallback.concepts,
      prompt: dedupePrompt(parsed.prompt || fallback.prompt, 480),
      negative: dedupePrompt(parsed.negative || fallback.negative, 220),
    };
  } catch {
    return fallbackArticleAnalysis(input);
  }
}

async function giphyProxy(request, env, mode) {
  if (!env.GIPHY_API_KEY) return json({ ok: false, error: 'GIPHY_API_KEY ainda não configurada no Worker' }, 503);
  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 24));
  const rating = url.searchParams.get('rating') || 'g';
  const qs = new URLSearchParams({ api_key: env.GIPHY_API_KEY, limit: String(limit), rating });
  if (mode === 'search') {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 50);
    if (!q) return json({ ok: false, error: 'Busca vazia' }, 400);
    qs.set('q', q);
    qs.set('lang', (url.searchParams.get('lang') || 'pt').slice(0, 5));
  }
  const endpoint = mode === 'search' ? 'https://api.giphy.com/v1/gifs/search' : 'https://api.giphy.com/v1/gifs/trending';
  const response = await fetch(`${endpoint}?${qs.toString()}`, { cf: { cacheTtl: 30, cacheEverything: false } });
  const data = await response.json();
  if (!response.ok || (data?.meta?.status && data.meta.status !== 200)) {
    return json({ ok: false, error: data?.meta?.msg || `GIPHY HTTP ${response.status}` }, response.status || 502);
  }
  return json({ ok: true, data });
}

function publicEngines() {
  return [
    { id: 'auto', label: 'Automático', description: 'Escolhe o motor e aplica fallback automaticamente.' },
    { id: 'sdxl', label: IMAGE_MODELS.sdxl.label, model: IMAGE_MODELS.sdxl.model, role: 'default-fast' },
    { id: 'flux1', label: IMAGE_MODELS.flux1.label, model: IMAGE_MODELS.flux1.model, role: 'fallback-fast' },
    { id: 'flux2', label: IMAGE_MODELS.flux2.label, model: IMAGE_MODELS.flux2.model, role: 'quality' },
  ];
}

export async function handleRondaAiApi(request, env) {
  const url = new URL(request.url);

  if (url.pathname === '/api/health') {
    return json({ ok: true, service: 'ronda-one-design', version: '0.7.7', engineVersion: ENGINE_VERSION, build: BUILD_ID, runtime: 'cloudflare-workers' });
  }

  if ((url.pathname === '/api/ai/status' || url.pathname === '/api/ai/engines') && request.method === 'GET') {
    if (!env.AI) return json({ ok: false, error: 'Workers AI binding ausente' }, 503);
    return json({
      ok: true,
      engine: 'RONDA Multi Image Engine',
      provider: 'Cloudflare Workers AI',
      defaultMode: 'balanced',
      modes: {
        fast: ['sdxl', 'flux1', 'flux2'],
        balanced: ['sdxl', 'flux1', 'flux2'],
        quality: ['flux2', 'flux1', 'sdxl'],
      },
      engines: publicEngines(),
      models: {
        imagePrimary: IMAGE_MODELS.sdxl.model,
        imagePrimaryLabel: IMAGE_MODELS.sdxl.label,
        imageFallback1: IMAGE_MODELS.flux1.model,
        imageFallback1Label: IMAGE_MODELS.flux1.label,
        imageFallback2: IMAGE_MODELS.flux2.model,
        imageFallback2Label: IMAGE_MODELS.flux2.label,
        text: TEXT_MODEL,
        textLabel: 'GLM-4.7-Flash · Free MVP',
      },
      engineVersion: ENGINE_VERSION,
      build: BUILD_ID,
      billingMode: 'free-first',
      paidFallbacks: false,
      freeAllocation: '10,000 Neurons/day',
      capabilities: ['text-to-image', 'multi-engine', 'automatic-fallback', 'article-analysis', 'free-first', 'short-editorial-prompts'],
    });
  }

  if (url.pathname === '/api/ai/generate' && request.method === 'POST') {
    if (!env.AI) return json({ ok: false, error: 'Workers AI binding ausente' }, 503);
    try {
      const input = await readJson(request);
      const quantity = 1;
      const result = await generateOne(env, input);
      return json({
        ok: true,
        images: [result.image],
        model: result.model,
        modelLabel: result.modelLabel,
        modelsUsed: result.attempts.filter((x) => x.ok).map((x) => x.label),
        engine: result.engine,
        requestedEngine: result.requestedEngine,
        mode: result.mode,
        attempts: result.attempts,
        fallbackUsed: result.fallbackUsed,
        billingMode: 'free-first',
        quantity,
      });
    } catch (error) {
      const friendly = friendlyAiError(error);
      return json({
        ok: false,
        code: friendly.code,
        error: friendly.message,
        attempts: Array.isArray(error?.attempts) ? error.attempts : undefined,
        billingMode: 'free-first',
      }, friendly.status);
    }
  }

  if (url.pathname === '/api/ai/analyze' && request.method === 'POST') {
    if (!env.AI) return json({ ok: false, error: 'Workers AI binding ausente' }, 503);
    try {
      const input = await readJson(request);
      const analysis = await analyzeArticle(env, input);
      return json({ ok: true, analysis, model: TEXT_MODEL, modelLabel: 'GLM-4.7-Flash' });
    } catch (error) {
      const friendly = friendlyAiError(error);
      return json({ ok: false, code: friendly.code, error: friendly.message, billingMode: 'free-first' }, friendly.status);
    }
  }

  if (url.pathname === '/api/giphy/search' && request.method === 'GET') return giphyProxy(request, env, 'search');
  if (url.pathname === '/api/giphy/trending' && request.method === 'GET') return giphyProxy(request, env, 'trending');

  return json({ ok: false, error: 'Endpoint não encontrado' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleRondaAiApi(request, env);
    return env.ASSETS.fetch(request);
  },
};
