const MAX_HTML_BYTES = 2_500_000;
const FETCH_TIMEOUT_MS = 6_000;
const MAX_ALTERNATIVES = 8;

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function clean(value, limit = 500) {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function isPrivateHostname(hostname) {
  const value = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!value || value === 'localhost' || value.endsWith('.local') || value.endsWith('.internal')) return true;
  if (/^(127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(value)) return true;
  const match = /^(172)\.(\d{1,3})\./.exec(value);
  if (match && Number(match[2]) >= 16 && Number(match[2]) <= 31) return true;
  if (value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:')) return true;
  return false;
}

export function validatePublicArticleUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { throw new Error('URL da matéria inválida'); }
  if (!/^https?:$/.test(url.protocol) || isPrivateHostname(url.hostname)) throw new Error('URL da matéria não permitida');
  return url.toString();
}

function resolveUrl(value, baseUrl) {
  const raw = clean(value, 2_000);
  if (!raw || /^data:/i.test(raw) || /^javascript:/i.test(raw)) return '';
  try {
    const resolved = new URL(raw, baseUrl);
    if (!/^https?:$/.test(resolved.protocol) || isPrivateHostname(resolved.hostname)) return '';
    return resolved.toString();
  } catch {
    return '';
  }
}

function attr(tag, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\b${escaped}\\s*=\\s*(?:["']([^"']*)["']|([^\\s>]+))`, 'i').exec(String(tag || ''));
  return clean(match?.[1] || match?.[2] || '', 2_000);
}

function metaContent(html, key) {
  const escaped = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([\\s\\S]*?)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([\\s\\S]*?)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i'),
  ];
  for (const pattern of patterns) {
    const value = pattern.exec(html)?.[1];
    if (value) return clean(value, 2_000);
  }
  return '';
}

function safeJsonParse(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  return null;
}

function jsonLdNodes(value, output = []) {
  if (!value || typeof value !== 'object') return output;
  if (Array.isArray(value)) {
    for (const item of value) jsonLdNodes(item, output);
    return output;
  }
  output.push(value);
  if (value['@graph']) jsonLdNodes(value['@graph'], output);
  return output;
}

function personName(value) {
  const list = Array.isArray(value) ? value : [value];
  return clean(list.map((item) => typeof item === 'string' ? item : item?.name).filter(Boolean).join(', '), 240);
}

function imageObjectCandidate(image, baseUrl, sourceName, articleUrl) {
  if (!image) return null;
  if (typeof image === 'string') {
    const url = resolveUrl(image, baseUrl);
    return url ? {
      url,
      origin: 'publisher',
      method: 'json-ld',
      caption: '',
      alt: '',
      credit: '',
      creditConfidence: 'low',
      sourceName,
      articleUrl,
    } : null;
  }
  if (typeof image !== 'object') return null;
  const url = resolveUrl(image.contentUrl || image.url || image.thumbnailUrl, baseUrl);
  if (!url) return null;
  const explicitCredit = clean(
    image.creditText
    || image.copyrightNotice
    || personName(image.copyrightHolder)
    || personName(image.creator),
    300,
  );
  return {
    url,
    origin: 'publisher',
    method: 'json-ld',
    caption: clean(image.caption || image.description, 500),
    alt: clean(image.name || image.alternateName, 300),
    credit: explicitCredit,
    creditConfidence: explicitCredit ? 'high' : 'low',
    sourceName,
    articleUrl,
  };
}

function extractJsonLdImages(html, baseUrl, sourceName, articleUrl) {
  const scripts = String(html || '').match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  const output = [];
  for (const script of scripts.slice(0, 24)) {
    const body = script.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    const parsed = safeJsonParse(body);
    if (!parsed) continue;
    for (const node of jsonLdNodes(parsed)) {
      const imageValues = Array.isArray(node?.image) ? node.image : [node?.image];
      for (const image of imageValues) {
        const candidate = imageObjectCandidate(image, baseUrl, sourceName, articleUrl);
        if (candidate) output.push(candidate);
      }
      const nodeTypes = Array.isArray(node?.['@type']) ? node['@type'] : [node?.['@type']];
      if (nodeTypes.some((type) => String(type || '').toLowerCase() === 'imageobject')) {
        const candidate = imageObjectCandidate(node, baseUrl, sourceName, articleUrl);
        if (candidate) output.push(candidate);
      }
    }
  }
  return output;
}

function creditFromCaption(caption, figureTag = '') {
  const text = clean(caption, 500);
  if (!text) return { credit: '', confidence: 'low' };
  const explicit = /(?:foto|fotografia|imagem|cr[eé]dito|photo|image)\s*[:\-–—]\s*([^|]{2,220})/i.exec(text)?.[0]
    || /(?:©|copyright)\s*([^|]{2,220})/i.exec(text)?.[0]
    || /(?:AFP|Reuters|Associated Press|Ag[eê]ncia Brasil|Getty Images|Divulga[cç][aã]o)(?:\s*[/|·-]\s*[^|]{1,120})?/i.exec(text)?.[0];
  if (explicit) return { credit: clean(explicit, 300), confidence: 'high' };
  if (/(?:credit|cr[eé]dito|copyright|photographer|fot[oó]grafo|foto-autor|image-credit)/i.test(figureTag)) {
    return { credit: text, confidence: 'high' };
  }
  return { credit: '', confidence: 'low' };
}

function extractFigureImages(html, baseUrl, sourceName, articleUrl) {
  const output = [];
  const figures = String(html || '').match(/<figure\b[^>]*>[\s\S]*?<\/figure\s*>/gi) || [];
  for (const figure of figures.slice(0, 30)) {
    const imageTag = /<img\b[^>]*>/i.exec(figure)?.[0];
    if (!imageTag) continue;
    const rawUrl = attr(imageTag, 'src') || attr(imageTag, 'data-src') || attr(imageTag, 'data-original') || attr(imageTag, 'data-lazy-src');
    const url = resolveUrl(rawUrl, baseUrl);
    if (!url) continue;
    const captionHtml = /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption\s*>/i.exec(figure)?.[1] || '';
    const caption = clean(captionHtml, 500);
    const detected = creditFromCaption(caption, figure);
    output.push({
      url,
      origin: 'publisher',
      method: 'figure',
      caption,
      alt: clean(attr(imageTag, 'alt'), 300),
      credit: detected.credit,
      creditConfidence: detected.confidence,
      sourceName,
      articleUrl,
    });
  }
  return output;
}

function extractMetaImages(html, baseUrl, sourceName, articleUrl) {
  const output = [];
  const candidates = [
    ['og:image:secure_url', 'og-image'],
    ['og:image', 'og-image'],
    ['twitter:image', 'twitter-image'],
    ['twitter:image:src', 'twitter-image'],
  ];
  for (const [key, method] of candidates) {
    const url = resolveUrl(metaContent(html, key), baseUrl);
    if (!url) continue;
    output.push({
      url,
      origin: 'publisher',
      method,
      caption: '',
      alt: clean(metaContent(html, key.startsWith('og:') ? 'og:image:alt' : 'twitter:image:alt'), 300),
      credit: '',
      creditConfidence: 'low',
      sourceName,
      articleUrl,
    });
  }
  return output;
}

function candidateScore(candidate) {
  let score = candidate.method === 'json-ld' ? 120 : candidate.method === 'figure' ? 112 : candidate.method === 'og-image' ? 100 : 90;
  if (candidate.creditConfidence === 'high' && candidate.credit) score += 45;
  if (candidate.creditConfidence === 'medium' && candidate.credit) score += 25;
  if (candidate.caption) score += 8;
  if (candidate.alt) score += 5;
  if (/(?:logo|avatar|icon|sprite|favicon|author|profile|emoji|tracking|pixel)/i.test(candidate.url)) score -= 100;
  return score;
}

function normalizeCandidate(candidate) {
  const credit = clean(candidate.credit, 300);
  const confidence = credit ? (candidate.creditConfidence === 'high' ? 'high' : 'medium') : 'low';
  return {
    ...candidate,
    credit,
    creditConfidence: confidence,
    autoUseAllowed: Boolean(credit && ['high', 'medium'].includes(confidence)),
  };
}

export function extractArticleVisualsFromHtml(html, {
  articleUrl,
  resolvedUrl = articleUrl,
  sourceName = '',
} = {}) {
  const baseUrl = validatePublicArticleUrl(resolvedUrl || articleUrl);
  const canonicalArticleUrl = validatePublicArticleUrl(articleUrl || resolvedUrl);
  const inferredSource = clean(sourceName, 120) || (() => {
    try { return new URL(canonicalArticleUrl).hostname.replace(/^www\./, ''); } catch { return 'Fonte não informada'; }
  })();

  const candidates = [
    ...extractJsonLdImages(html, baseUrl, inferredSource, canonicalArticleUrl),
    ...extractFigureImages(html, baseUrl, inferredSource, canonicalArticleUrl),
    ...extractMetaImages(html, baseUrl, inferredSource, canonicalArticleUrl),
  ].map(normalizeCandidate);

  const bestByUrl = new Map();
  for (const candidate of candidates) {
    if (!candidate.url) continue;
    const previous = bestByUrl.get(candidate.url);
    if (!previous || candidateScore(candidate) > candidateScore(previous)) bestByUrl.set(candidate.url, candidate);
  }
  const unique = [...bestByUrl.values()].sort((a, b) => candidateScore(b) - candidateScore(a));

  const primary = unique[0] || null;
  const alternatives = unique.slice(1, 1 + MAX_ALTERNATIVES);
  return {
    primary,
    alternatives,
    totalCandidates: unique.length,
    canAutoUsePrimary: Boolean(primary?.autoUseAllowed),
    creditRequired: true,
    policy: {
      mode: 'publisher-image-with-credit-only',
      useWithoutCredit: false,
      aiFallbackRecommended: !primary?.autoUseAllowed,
    },
  };
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
        'User-Agent': 'Mozilla/5.0 (compatible; RondaOneVisualReader/0.8.0; +editorial)',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const finalUrl = validatePublicArticleUrl(response.url || url);
    const contentType = response.headers.get('Content-Type') || '';
    if (contentType && !/html|xhtml|text\//i.test(contentType)) throw new Error('A URL não retornou HTML');
    const length = Number(response.headers.get('Content-Length')) || 0;
    if (length > MAX_HTML_BYTES * 2) throw new Error('Página maior que o limite seguro');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const html = new TextDecoder('utf-8').decode(bytes.slice(0, MAX_HTML_BYTES));
    return { html, finalUrl };
  } finally {
    clearTimeout(timer);
  }
}

export async function handleArticleVisualsApi(request) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/article-visuals') return json({ ok: false, error: 'Endpoint visual não encontrado' }, 404);
  if (!['GET', 'POST'].includes(request.method)) return json({ ok: false, error: 'Método não permitido' }, 405);

  let input = {};
  if (request.method === 'POST') input = await request.json().catch(() => ({}));
  const requestedUrl = request.method === 'GET' ? url.searchParams.get('url') : input?.url;
  const sourceName = request.method === 'GET' ? url.searchParams.get('sourceName') : input?.sourceName;

  let articleUrl;
  try { articleUrl = validatePublicArticleUrl(requestedUrl); }
  catch (error) { return json({ ok: false, error: error.message }, 400); }

  try {
    const { html, finalUrl } = await fetchHtml(articleUrl);
    const articleVisuals = extractArticleVisualsFromHtml(html, {
      articleUrl,
      resolvedUrl: finalUrl,
      sourceName,
    });
    return json({
      ok: true,
      mode: 'patch-a-read-only',
      articleUrl,
      resolvedUrl: finalUrl,
      sourceName: clean(sourceName, 120) || new URL(finalUrl).hostname.replace(/^www\./, ''),
      articleVisuals,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({
      ok: false,
      code: /timeout|aborted/i.test(message) ? 'VISUAL_FETCH_TIMEOUT' : 'VISUAL_FETCH_FAILED',
      error: 'Não foi possível ler as imagens da matéria.',
      detail: clean(message, 240),
      articleUrl,
    }, /timeout|aborted/i.test(message) ? 504 : 502);
  }
}
