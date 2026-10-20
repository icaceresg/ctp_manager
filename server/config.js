import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Ajustes opcionales en .env (ver .env.example).
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  /* sin .env: se usan los valores por defecto */
}

export const PORT = Number(process.env.PORT) || 3210;
export const DATA_DIR = path.resolve(root, process.env.DATA_DIR || 'data');
export const DIST_DIR = path.join(root, 'dist');

// Las cookies de sesión van ligadas al nombre de host, así que la app se
// sirve siempre en "localhost" y redirige ahí si entras por 127.0.0.1.
export const APP_HOST = `localhost:${PORT}`;
export const APP_ORIGIN = `http://${APP_HOST}`;

// Publicación en internet (opcional, ver .env.example). Con MANAGER_HOST y
// RULETA_HOST la app responde también en esos dominios (detrás de un proxy con
// HTTPS) y la cookie de sesión se comparte entre ellos gracias a COOKIE_DOMAIN:
// quien inicia sesión en el manager entra directamente en la ruleta.
const hostname = (value) => String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
export const MANAGER_HOST = hostname(process.env.MANAGER_HOST);
export const RULETA_HOST = hostname(process.env.RULETA_HOST);
export const PUBLIC_HOSTS = [MANAGER_HOST, RULETA_HOST].filter(Boolean);
export const COOKIE_DOMAIN = hostname(process.env.COOKIE_DOMAIN).replace(/^\./, '') || null;
// En los dominios públicos la cookie solo viaja por HTTPS.
export const SECURE_COOKIES = process.env.SECURE_COOKIES ? process.env.SECURE_COOKIES === '1' : PUBLIC_HOSTS.length > 0;
export const TRUST_PROXY = process.env.TRUST_PROXY === '1';

export const SESSION_COOKIE = 'mrm_session';
export const SESSION_DAYS = 30;
