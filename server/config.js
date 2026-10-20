import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Ajustes opcionales en .env (ver .env.example).
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  /* sin .env: se usan los valores por defecto */
}

export function deploymentConfig(env = process.env) {
  const port = Number(env.PORT || 3210);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT debe ser un puerto válido.');
  let origin = `http://localhost:${port}`;
  const publicDeployment = Boolean(env.PUBLIC_ORIGIN);
  if (publicDeployment) {
    let parsed;
    try { parsed = new URL(env.PUBLIC_ORIGIN); } catch { throw new Error('PUBLIC_ORIGIN debe ser un origen HTTPS válido.'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.origin !== env.PUBLIC_ORIGIN.replace(/\/$/, '')) {
      throw new Error('PUBLIC_ORIGIN debe ser solo un origen HTTPS, sin ruta ni credenciales.');
    }
    if (!MANAGER_PUBLIC_ORIGINS.includes(parsed.origin)) throw new Error(`El origen público de Manager debe ser ${MANAGER_PUBLIC_ORIGINS.join(' o ')}.`);
    // pre.manager solo puede hablar con la CTP de pruebas, nunca con la real.
    if (parsed.origin === PRE_MANAGER_ORIGIN && [env.CTP_AUTH_URL, env.CTP_WEB_ORIGIN].some((value) => value && value.replace(/\/$/, '') !== PRE_CTP_ORIGIN)) {
      throw new Error(`${PRE_MANAGER_ORIGIN} solo se conecta a ${PRE_CTP_ORIGIN}.`);
    }
    origin = parsed.origin;
  }
  // Ruleta del directo: segundo host explícito, con su propia cookie __Host-.
  // No comparte sesión con Manager ni concede confianza a otros subdominios.
  let ruletaOrigin = null;
  if (env.RULETA_ORIGIN) {
    if (!publicDeployment) throw new Error('RULETA_ORIGIN solo se usa junto a PUBLIC_ORIGIN.');
    if (env.RULETA_ORIGIN.replace(/\/$/, '') !== RULETA_PUBLIC_ORIGIN) throw new Error(`El único origen de la ruleta es ${RULETA_PUBLIC_ORIGIN}.`);
    ruletaOrigin = RULETA_PUBLIC_ORIGIN;
  }
  const origins = publicDeployment ? [origin, ...(ruletaOrigin ? [ruletaOrigin] : [])] : [
    ...[port, Number(env.DEV_WEB_PORT || 5173)].flatMap((p) => [`http://localhost:${p}`, `http://127.0.0.1:${p}`, `http://[::1]:${p}`]),
  ];
  const hosts = publicDeployment ? origins.map((o) => new URL(o).host) : [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`];
  return { port, origin, host: new URL(origin).host, publicDeployment, secureCookies: publicDeployment, origins, hosts,
    ruletaOrigin, ruletaHost: ruletaOrigin ? new URL(ruletaOrigin).host : null };
}

export const RULETA_PUBLIC_ORIGIN = 'https://ruleta.playctp.com';
// PROD en manager; PRE en pre.manager. La firma del puente sigue usando
// manager.playctp.com en los dos (es el origen que CTP espera).
export const PRE_MANAGER_ORIGIN = 'https://pre.manager.playctp.com';
export const PRE_CTP_ORIGIN = 'https://pre.playctp.com';
export const MANAGER_PUBLIC_ORIGINS = Object.freeze(['https://manager.playctp.com', PRE_MANAGER_ORIGIN]);

/** True when the request arrives on ruleta.playctp.com (only in public deployments). */
export function isRuletaHost(req, config = DEPLOYMENT) {
  return Boolean(config.ruletaHost && (req.get('host') || '').toLowerCase() === config.ruletaHost);
}

export const DEPLOYMENT = deploymentConfig();
export const PORT = DEPLOYMENT.port;
export const DATA_DIR = path.resolve(root, process.env.DATA_DIR || 'data');
export const DIST_DIR = path.join(root, 'dist');

// Las cookies de sesión van ligadas al nombre de host, así que la app se
// sirve siempre en "localhost" y redirige ahí si entras por 127.0.0.1.
export const APP_HOST = DEPLOYMENT.host;
export const APP_ORIGIN = DEPLOYMENT.origin;
export const SECURE_COOKIES = DEPLOYMENT.secureCookies;

/** Exact host/origin allowlists; forwarded headers never grant access. */
export function requestBoundary(req, config = DEPLOYMENT) {
  if (!config.hosts.includes((req.get('host') || '').toLowerCase())) return 'Host no permitido.';
  const origin = req.get('origin');
  if (origin && !config.origins.includes(origin)) return 'Origen no permitido.';
  // Con dos hosts públicos, cada uno solo acepta peticiones de su propia página.
  if (origin && config.publicDeployment && origin !== `https://${(req.get('host') || '').toLowerCase()}`) return 'Origen no permitido.';
  const site = req.get('sec-fetch-site');
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (site === 'cross-site' && (unsafe || req.path.startsWith('/api/'))) return 'Origen no permitido.';
  if (unsafe && site === 'same-site' && !origin) return 'Origen no permitido.';
  return null;
}

// The browser forbids Domain/path overrides for __Host- cookies. A sibling CTP
// host cannot replace the public Manager session with its own domain cookie.
export const SESSION_COOKIE = SECURE_COOKIES ? '__Host-ctp_manager_session' : 'mrm_session';
export const SESSION_DAYS = 30;
