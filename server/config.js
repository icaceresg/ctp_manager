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

export const SESSION_COOKIE = 'mrm_session';
export const SESSION_DAYS = 30;
