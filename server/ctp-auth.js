import crypto from 'node:crypto';

export class CtpAuthError extends Error {
  constructor(status, code) { super(code); this.status = status; }
}
const fail = (status, code) => { throw new CtpAuthError(status, code); };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function ctpAuthConfig(env = process.env) {
  const mode = env.CTP_AUTH_MODE || 'local';
  if (!['local', 'ctp'].includes(mode)) throw new Error('CTP_AUTH_MODE debe ser local o ctp.');
  if (mode === 'local') return { mode };
  const origin = env.CTP_AUTH_URL;
  if (!['https://pre.playctp.com', 'https://playctp.com'].includes(origin)) throw new Error('CTP_AUTH_URL requiere el origen HTTPS exacto de CTP.');
  let operations;
  try { operations = new URL(env.CTP_OPERATIONS_URL); } catch { /* validated below */ }
  if (env.CTP_WEB_ORIGIN !== origin || operations?.origin !== origin || operations.username || operations.password
    || operations.pathname !== '/functions/v1/manager-operations' || operations.search || operations.hash) throw new Error('Autenticación, web y puente de Manager deben usar el mismo entorno CTP.');
  const anon = env.CTP_AUTH_ANON_KEY || '';
  let payload;
  try { payload = JSON.parse(Buffer.from(anon.split('.')[1], 'base64url')); } catch { /* validated below */ }
  if (payload?.role !== 'anon' || !Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now()) throw new Error('CTP_AUTH_ANON_KEY requiere la clave pública anon vigente.');
  const raw = env.CTP_AUTH_TOKEN_KEY || '';
  const key = Buffer.from(raw, 'base64url');
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw) || key.length !== 32 || key.toString('base64url') !== raw) throw new Error('CTP_AUTH_TOKEN_KEY requiere 32 bytes aleatorios en base64url.');
  if (raw === env.CTP_OPERATIONS_TOKEN || raw === env.CTP_SIGNING_SECRET) throw new Error('La clave de sesión debe ser independiente de las credenciales del puente.');
  return { mode, origin, anon, key };
}

export function encryptTokens(key, tokens, associatedData) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(associatedData));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokens)), cipher.final()]);
  return ['v1', iv.toString('base64url'), ciphertext.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}

export function decryptTokens(key, encrypted, associatedData) {
  try {
    const [version, rawIv, rawCiphertext, rawTag, extra] = String(encrypted).split('.');
    if (version !== 'v1' || extra || !rawIv || !rawCiphertext || !rawTag) throw new Error();
    const iv = Buffer.from(rawIv, 'base64url'), tag = Buffer.from(rawTag, 'base64url');
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(associatedData));
    decipher.setAuthTag(tag);
    const tokens = JSON.parse(Buffer.concat([decipher.update(Buffer.from(rawCiphertext, 'base64url')), decipher.final()]));
    if (!uuid.test(tokens.subject) || typeof tokens.accessToken !== 'string' || !tokens.accessToken
      || typeof tokens.refreshToken !== 'string' || !tokens.refreshToken || !Number.isFinite(tokens.expiresAt)) throw new Error();
    return tokens;
  } catch { fail(401, 'invalid_session'); }
}

export function validateIdentity(value, expectedSubject) {
  if (!value || !uuid.test(value.ctp_user_id) || value.ctp_user_id !== expectedSubject
    || !['admin', 'referee'].includes(value.role) || value.actor_id !== `ctp:${expectedSubject}`
    || typeof value.username !== 'string' || !value.username.trim() || value.username.length > 100
    || !Array.isArray(value.scopes) || !value.scopes.length || value.scopes.some(scope => typeof scope !== 'string' || scope.length > 100)) fail(403, 'staff_only');
  return value;
}

export function createCtpAuthClient(config, fetchImpl = fetch) {
  async function request(endpoint, body, accessToken) {
    let response;
    try {
      response = await fetchImpl(config.origin + endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { apikey: config.anon, 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if ([400, 401].includes(response.status)) fail(401, 'invalid_credentials');
        if (response.status === 403) fail(403, 'staff_only');
        if (response.status === 429) fail(429, 'rate_limited');
        fail(503, 'ctp_unavailable');
      }
      if (!/^application\/json\b/i.test(response.headers.get('content-type') || '')) fail(503, 'ctp_unavailable');
      const reader = response.body?.getReader();
      if (!reader) fail(503, 'ctp_unavailable');
      const chunks = []; let total = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          total += value.length; if (total > 65536) fail(503, 'ctp_unavailable');
          chunks.push(Buffer.from(value));
        }
      } finally { await reader.cancel().catch(() => {}); }
      return JSON.parse(Buffer.concat(chunks));
    } catch (error) {
      if (error instanceof CtpAuthError) throw error;
      fail(503, 'ctp_unavailable');
    }
  }

  function tokens(value, previousSubject) {
    const expiresAt = Number.isFinite(value.expires_at) ? value.expires_at * 1000 : Date.now() + Number(value.expires_in) * 1000;
    if (!uuid.test(value.user?.id) || (previousSubject && value.user.id !== previousSubject)
      || typeof value.access_token !== 'string' || !value.access_token || value.access_token.length > 16384
      || typeof value.refresh_token !== 'string' || !value.refresh_token || value.refresh_token.length > 4096
      || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) fail(401, 'invalid_session');
    return { subject: value.user.id, accessToken: value.access_token, refreshToken: value.refresh_token, expiresAt };
  }

  return {
    async login(email, password) {
      if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254
        || typeof password !== 'string' || !password || password.length > 1024) fail(401, 'invalid_credentials');
      return tokens(await request('/auth/v1/token?grant_type=password', { email: email.trim().toLowerCase(), password }));
    },
    async refresh(previous) {
      return tokens(await request('/auth/v1/token?grant_type=refresh_token', { refresh_token: previous.refreshToken }), previous.subject);
    },
    async identity(session) {
      return validateIdentity(await request('/rest/v1/rpc/manager_link_own_identity', {}, session.accessToken), session.subject);
    },
  };
}
