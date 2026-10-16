import crypto from 'node:crypto';
import { db, tx } from './db.js';
import { DEPLOYMENT, SECURE_COOKIES, SESSION_COOKIE, SESSION_DAYS } from './config.js';
import { SECTION_IDS, STAFF_KINDS, isStaffUser } from '../shared/access.js';
import { ctpAuthConfig, createCtpAuthClient, CtpAuthError, encryptTokens, decryptTokens } from './ctp-auth.js';
import { createLoginLimiter, LoginLimitError } from './login-limiter.js';

export const AUTH_CONFIG = ctpAuthConfig();
export const CTP_AUTH_ENABLED = AUTH_CONFIG.mode === 'ctp';
const ctp = CTP_AUTH_ENABLED ? createCtpAuthClient(AUTH_CONFIG) : null;
const validatingSessions = new Map();

const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const MIN_PASSWORD = 8;
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/i;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// Se usa al fallar con un usuario inexistente para tardar lo mismo que con
// uno real y no revelar qué usuarios existen.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > 1024) {
    throw new HttpError(400, `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
  }
  return password;
}

export function validateUsername(username) {
  const value = String(username ?? '').trim();
  if (!USERNAME_RE.test(value)) {
    throw new HttpError(400, 'El usuario debe tener entre 3 y 32 caracteres: letras, números, punto, guion o guion bajo.');
  }
  return value;
}

export function hasUsers() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
}

/** Datos del usuario que ve el navegador: roles y secciones a las que accede. */
export function describeUser(user) {
  const roles = db
    .prepare('SELECT r.id, r.name, r.sections, r.staff_kind FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ? ORDER BY r.name')
    .all(user.id);
  const officialAdmin = CTP_AUTH_ENABLED ? Boolean(user.ctp_user_id && user.ctp_role === 'admin') : Boolean(user.is_admin);
  const sections = officialAdmin
    ? SECTION_IDS
    : SECTION_IDS.filter((s) => roles.some((r) => STAFF_KINDS.some((kind) => kind.id === r.staff_kind) && JSON.parse(r.sections).includes(s)));
  return {
    id: user.id,
    username: user.ctp_user_id ? user.name : user.username,
    name: user.name || user.username,
    is_admin: officialAdmin,
    auth_mode: CTP_AUTH_ENABLED ? 'ctp' : 'local',
    ...(CTP_AUTH_ENABLED ? { ctp_user_id: user.ctp_user_id, ctp_role: user.ctp_role, account_url: `${AUTH_CONFIG.origin}/es/app/settings?seccion=perfil` } : {}),
    roles: roles.map((r) => ({ id: r.id, name: r.name, staff_kind: r.staff_kind })),
    sections,
  };
}

/** Crea el primer usuario (administrador) en una instalación nueva. */
export function setupAdmin({ username, name, password }) {
  if (CTP_AUTH_ENABLED) throw new HttpError(403, 'Accede con tu cuenta de staff de CTP. No se crean cuentas independientes en Manager.');
  if (hasUsers()) throw new HttpError(409, 'La cuenta de administrador ya existe.');
  if (DEPLOYMENT.publicDeployment) throw new HttpError(403, 'Crea el administrador desde localhost antes de configurar PUBLIC_ORIGIN.');
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (username, name, password_hash, is_admin, created_at) VALUES (?, ?, ?, 1, ?)')
    .run(validateUsername(username), String(name || '').trim().slice(0, 80), hashPassword(validatePassword(password)), Date.now());
  return Number(lastInsertRowid);
}

const loginLimiter = createLoginLimiter();
function reserveLogin(account, peer) {
  try { return loginLimiter.begin(account, peer); }
  catch (error) {
    if (!(error instanceof LoginLimitError)) throw error;
    throw Object.assign(new HttpError(429, error.message), { retryAfterSeconds: error.retryAfterSeconds });
  }
}

export function login(username, password, peer) {
  if (CTP_AUTH_ENABLED) throw new HttpError(403, 'Accede con el correo y la contraseña de tu cuenta CTP.');
  if (typeof username !== 'string' || !USERNAME_RE.test(username.trim()) || typeof password !== 'string' || !password || password.length > 1024) {
    throw new HttpError(401, 'Usuario o contraseña incorrectos.');
  }
  const key = username.trim().toLowerCase(), attempt = reserveLogin(key, peer);
  let success = false;
  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(key);
    const ok = verifyPassword(password, user?.password_hash || DUMMY_HASH);
    if (!user || !ok || !user.active) throw new HttpError(401, user && ok && !user.active ? 'Este usuario está desactivado.' : 'Usuario o contraseña incorrectos.');
    if (!isStaffUser(describeUser(user))) throw new HttpError(403, 'Manager es exclusivo del staff. Un administrador debe asignarte un rol de staff.');
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), user.id);
    success = true;
    return user;
  } finally {
    attempt.finish({ success, credentialFailure: !success });
  }
}

export function changeOwnPassword(userId, current, next, keepToken) {
  if (CTP_AUTH_ENABLED) throw new HttpError(403, 'Gestiona tu contraseña desde tu cuenta de CTP.');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!verifyPassword(String(current || ''), user.password_hash)) {
    throw new HttpError(400, 'La contraseña actual no es correcta.');
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(validatePassword(next)), userId);
  // Cierra las demás sesiones abiertas con la contraseña antigua.
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(userId, keepToken || '');
}

export function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(token, userId, now, now + SESSION_MS);
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure: SECURE_COOKIES, sameSite: 'lax', maxAge: SESSION_MS, path: '/' });
  return token;
}

export function readSessionToken(req) {
  const header = req.headers.cookie || '';
  let token = null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) {
      // Duplicate cookies have ambiguous path/domain precedence. Never choose
      // the first value supplied by an attacker or accept an arbitrary DB key.
      if (token !== null) return null;
      try { token = decodeURIComponent(rest.join('=')); } catch { return null; }
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    }
  }
  return token;
}

/** Usuario de la sesión actual (activo y con sesión sin caducar) o null. */
export async function currentUser(req) {
  if (req.managerAuth) return req.managerAuth;
  req.managerAuth = readCurrentUser(req);
  return req.managerAuth;
}

async function readCurrentUser(req) {
  const token = readSessionToken(req);
  if (!token) return null;
  const user = db
    .prepare(
      `SELECT u.*, s.auth_mode AS session_auth_mode, s.ctp_tokens FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`,
    )
    .get(token, Date.now());
  if (!user) return null;
  if (CTP_AUTH_ENABLED) {
    if (user.session_auth_mode !== 'ctp' || !user.ctp_user_id || !user.ctp_tokens) return null;
    if (!validatingSessions.has(token)) {
      const task = validateCtpSession(token, user).finally(() => validatingSessions.delete(token));
      validatingSessions.set(token, task);
    }
    return validatingSessions.get(token);
  }
  if (user.session_auth_mode !== 'local') return null;
  const described = describeUser(user);
  if (!isStaffUser(described)) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return described;
}

export function destroySession(req, res) {
  const token = readSessionToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: SECURE_COOKIES, sameSite: 'lax' });
}

export async function requireAuth(req, res, next) {
  req.user = await currentUser(req);
  if (req.user) return next();
  res.status(401).json({ error: 'Necesitas iniciar sesión.' });
}

function ctpError(error) {
  if (!(error instanceof CtpAuthError)) return new HttpError(503, 'No se puede verificar tu cuenta CTP. Vuelve a intentarlo.');
  const messages = { 401: 'Correo o contraseña incorrectos, o sesión CTP caducada.', 403: 'Manager es exclusivo del staff autorizado de CTP.', 429: 'Demasiados intentos. Espera antes de volver a intentarlo.', 503: 'CTP no está disponible. No se ha concedido acceso.' };
  return new HttpError(error.status, messages[error.status] || messages[503]);
}

function mirrorCtpIdentity(identity) {
  return tx(() => {
    let user = db.prepare('SELECT * FROM users WHERE ctp_user_id=?').get(identity.ctp_user_id);
    const previousRole = user?.ctp_role;
    if (user && !user.active) throw new HttpError(403, 'Tu acceso a Manager está desactivado. Contacta con CTP.');
    if (!user) {
      const inserted = db.prepare('INSERT INTO users(username,name,password_hash,is_admin,active,created_at,ctp_user_id,ctp_role) VALUES(?,?,?,?,1,?,?,?)')
        .run(`ctp_${identity.ctp_user_id}`, identity.username, '!ctp-auth-only', identity.role === 'admin' ? 1 : 0, Date.now(), identity.ctp_user_id, identity.role);
      user = db.prepare('SELECT * FROM users WHERE id=?').get(Number(inserted.lastInsertRowid));
    }
    db.prepare('UPDATE users SET name=?,ctp_role=?,is_admin=?,last_login_at=? WHERE id=?')
      .run(identity.username, identity.role, identity.role === 'admin' ? 1 : 0, Date.now(), user.id);
    if (identity.role === 'referee' && (!previousRole || previousRole === 'admin') && !db.prepare('SELECT 1 FROM user_roles WHERE user_id=?').get(user.id)) {
      const role = db.prepare("SELECT id FROM roles WHERE staff_kind='referee' ORDER BY id LIMIT 1").get();
      if (role) db.prepare('INSERT OR IGNORE INTO user_roles(user_id,role_id) VALUES(?,?)').run(user.id, role.id);
    }
    db.prepare('INSERT INTO operation_operator_identities(user_id,external_id,created_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET external_id=excluded.external_id')
      .run(user.id, identity.actor_id, Date.now());
    return db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  });
}

export async function loginCtp(email, password, res, peer) {
  if (!CTP_AUTH_ENABLED) throw new HttpError(403, 'El acceso con cuenta CTP no está habilitado.');
  if (typeof email !== 'string' || email.length > 254 || typeof password !== 'string' || password.length > 1024) throw new HttpError(401, 'Correo o contraseña incorrectos.');
  const key = String(email || '').trim().toLowerCase();
  const attempt = reserveLogin(key, peer);
  let success = false, credentialFailure = false;
  try {
    const tokens = await ctp.login(email, password);
    const identity = await ctp.identity(tokens);
    const user = mirrorCtpIdentity(identity);
    const opaque = crypto.randomBytes(32).toString('base64url');
    const encrypted = encryptTokens(AUTH_CONFIG.key, tokens, `manager:${opaque}:${identity.ctp_user_id}`);
    const now = Date.now();
    db.prepare("INSERT INTO sessions(token,user_id,created_at,expires_at,auth_mode,ctp_tokens) VALUES(?,?,?,?,'ctp',?)")
      .run(opaque, user.id, now, now + SESSION_MS, encrypted);
    res.cookie(SESSION_COOKIE, opaque, { httpOnly: true, secure: SECURE_COOKIES, sameSite: 'lax', maxAge: SESSION_MS, path: '/' });
    success = true;
    return describeUser(user);
  } catch (error) {
    credentialFailure = (error instanceof CtpAuthError || error instanceof HttpError) && [401, 403].includes(error.status);
    if (error instanceof HttpError) throw error;
    throw ctpError(error);
  } finally {
    attempt.finish({ success, credentialFailure });
  }
}

async function validateCtpSession(token, user) {
  try {
    let tokens = decryptTokens(AUTH_CONFIG.key, user.ctp_tokens, `manager:${token}:${user.ctp_user_id}`);
    if (tokens.subject !== user.ctp_user_id) throw new CtpAuthError(401, 'invalid_session');
    if (tokens.expiresAt <= Date.now() + 30000) {
      tokens = await ctp.refresh(tokens);
      // Persist rotated refresh credentials before the role check: temporary
      // RPC failures must not strand a now-invalid previous refresh token.
      db.prepare("UPDATE sessions SET ctp_tokens=? WHERE token=? AND auth_mode='ctp'")
        .run(encryptTokens(AUTH_CONFIG.key, tokens, `manager:${token}:${user.ctp_user_id}`), token);
    }
    const identity = await ctp.identity(tokens);
    if (!db.prepare('SELECT 1 FROM sessions WHERE token=? AND expires_at>?').get(token, Date.now())) return null;
    return describeUser(mirrorCtpIdentity(identity));
  } catch (error) {
    if (error instanceof CtpAuthError && [401, 403].includes(error.status)) {
      db.prepare('DELETE FROM sessions WHERE token=?').run(token);
      if (error.status === 403) db.prepare("UPDATE users SET ctp_role='',is_admin=0 WHERE id=?").run(user.id);
      return null;
    }
    if (error instanceof HttpError) throw error;
    throw ctpError(error);
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.is_admin) return next();
  res.status(403).json({ error: 'Solo un administrador puede hacer esto.' });
}

/** Deja pasar si el usuario tiene acceso a alguna de las secciones indicadas. */
export function allow(...sections) {
  return (req, res, next) => {
    if (req.user?.is_admin || sections.some((s) => req.user?.sections.includes(s))) return next();
    res.status(403).json({ error: 'No tienes acceso a esta sección. Pídeselo a un administrador.' });
  };
}
