import {
  createEditorialUser,
  createUserSession,
  ensureUserAccess,
  getEditorialUserByEmailKey,
} from './v285/database.js';
import {
  ADMIN_EMAIL,
  SESSION_TTL_DAYS,
  normalizeEmail,
  randomToken,
  sessionCookie,
  sha256Hex,
  validateEmail,
} from './v285/profile.js';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function secureEqual(left, right) {
  const encoder = new TextEncoder();
  const a = encoder.encode(String(left ?? ''));
  const b = encoder.encode(String(right ?? ''));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

function secureCookieForRequest(request) {
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return true;
  }
}

/**
 * Login ADM compatível com o runtime Cloudflare.
 *
 * O secret ADMIN_BOOTSTRAP_PASSWORD é a credencial canônica do ADM.
 * Evita o PBKDF2 legado de 120.000 iterações, que o runtime atual rejeita.
 */
export async function handleAdminLoginHotfix(request, env) {
  if (request.method !== 'POST') return null;

  const body = await request.clone().json().catch(() => ({}));
  if (!body?.adminMode) return null;

  let email;
  try {
    email = validateEmail(body.email);
  } catch (error) {
    return json({ ok: false, error: error?.message || 'Informe um e-mail válido.' }, 400);
  }

  const emailKey = normalizeEmail(email);
  if (emailKey !== ADMIN_EMAIL) {
    return json({ ok: false, error: 'Este e-mail não possui acesso administrativo.' }, 403);
  }

  if (!env.ADMIN_BOOTSTRAP_PASSWORD) {
    return json({
      ok: false,
      error: 'Administrador ainda não ativado.',
      detail: 'Configure o secret ADMIN_BOOTSTRAP_PASSWORD no Worker.',
    }, 503);
  }

  if (!secureEqual(body.password, env.ADMIN_BOOTSTRAP_PASSWORD)) {
    return json({ ok: false, error: 'Senha administrativa inválida.' }, 401);
  }

  if (!env.DB) {
    return json({ ok: false, error: 'Banco D1 não configurado.' }, 503);
  }

  let user = await getEditorialUserByEmailKey(env.DB, ADMIN_EMAIL);

  if (!user) {
    const salt = randomToken(18);
    const passwordHash = await sha256Hex(`${salt}:${randomToken(32)}:${ADMIN_EMAIL}`);
    user = await createEditorialUser(env.DB, {
      email: ADMIN_EMAIL,
      emailKey: ADMIN_EMAIL,
      displayName: 'Administrador',
      passwordHash,
      passwordSalt: salt,
      passwordIterations: 10_000,
    });
  }

  await ensureUserAccess(env.DB, user.id, user.email, 'admin');
  user = await getEditorialUserByEmailKey(env.DB, ADMIN_EMAIL);

  const token = randomToken(32);
  await createUserSession(env.DB, {
    tokenHash: await sha256Hex(token),
    userId: user.id,
    ttlDays: SESSION_TTL_DAYS,
  });

  return json({
    ok: true,
    authenticated: true,
    adminSecretAuth: true,
    user,
    access: {
      role: 'admin',
      admin: true,
    },
  }, 200, {
    'Set-Cookie': sessionCookie(token, { secure: secureCookieForRequest(request) }),
  });
}
