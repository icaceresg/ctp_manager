import crypto from 'node:crypto';
import { db } from './db.js';
import { SESSION_COOKIE, SESSION_DAYS } from './config.js';
import { SECTION_IDS } from '../shared/access.js';

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
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
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
    .prepare('SELECT r.id, r.name, r.sections FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ? ORDER BY r.name')
    .all(user.id);
  const sections = user.is_admin
    ? SECTION_IDS
    : SECTION_IDS.filter((s) => roles.some((r) => JSON.parse(r.sections).includes(s)));
  return {
    id: user.id,
    username: user.username,
    name: user.name || user.username,
    is_admin: Boolean(user.is_admin),
    roles: roles.map((r) => ({ id: r.id, name: r.name })),
    sections,
  };
}

/** Crea el primer usuario (administrador) en una instalación nueva. */
export function setupAdmin({ username, name, password }) {
  if (hasUsers()) throw new HttpError(409, 'La cuenta de administrador ya existe.');
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (username, name, password_hash, is_admin, created_at) VALUES (?, ?, ?, 1, ?)')
    .run(validateUsername(username), String(name || '').trim().slice(0, 80), hashPassword(validatePassword(password)), Date.now());
  return Number(lastInsertRowid);
}

// Frena la fuerza bruta: tras 5 fallos seguidos con un usuario, 1 minuto de espera.
const failures = new Map();

export function login(username, password) {
  const key = String(username || '').trim().toLowerCase();
  const state = failures.get(key);
  if (state?.lockedUntil > Date.now()) {
    const secs = Math.ceil((state.lockedUntil - Date.now()) / 1000);
    throw new HttpError(429, `Demasiados intentos. Espera ${secs} s.`);
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(key);
  const ok = verifyPassword(String(password || ''), user?.password_hash || DUMMY_HASH);
  if (!user || !ok || !user.active) {
    const count = (state?.count || 0) + 1;
    failures.set(key, count >= 5 ? { count: 0, lockedUntil: Date.now() + 60_000 } : { count });
    throw new HttpError(401, user && ok && !user.active ? 'Este usuario está desactivado.' : 'Usuario o contraseña incorrectos.');
  }
  failures.delete(key);
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), user.id);
  return user;
}

export function changeOwnPassword(userId, current, next, keepToken) {
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
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_MS, path: '/' });
  return token;
}

export function readSessionToken(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/** Usuario de la sesión actual (activo y con sesión sin caducar) o null. */
export function currentUser(req) {
  const token = readSessionToken(req);
  if (!token) return null;
  const user = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`,
    )
    .get(token, Date.now());
  return user ? describeUser(user) : null;
}

export function destroySession(req, res) {
  const token = readSessionToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function requireAuth(req, res, next) {
  req.user = currentUser(req);
  if (req.user) return next();
  res.status(401).json({ error: 'Necesitas iniciar sesión.' });
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
