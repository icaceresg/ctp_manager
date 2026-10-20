import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import express from 'express';
import { APP_HOST, APP_ORIGIN, DIST_DIR, PORT, PUBLIC_HOSTS, RULETA_HOST, TRUST_PROXY } from './config.js';
import { ruletaRouter } from './routes/ruleta.js';
import { db } from './db.js';
import { HttpError } from './auth.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { apiRouter } from './routes/api.js';
import { boardRouter } from './routes/board.js';

const app = express();
app.disable('x-powered-by');
if (TRUST_PROXY) app.set('trust proxy', 'loopback');

// Solo responde a peticiones de este ordenador o de los dominios configurados
// (manager.playctp.com, ruleta.playctp.com): se rechazan otros nombres de host
// (protección contra DNS rebinding) y cambios enviados desde otras webs.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const isAllowedHost = (host) => LOCAL_HOST.test(host) || PUBLIC_HOSTS.includes(host.toLowerCase().replace(/:\d+$/, ''));
const hostOf = (req) => (req.get('host') || '').toLowerCase().replace(/:\d+$/, '');

app.use((req, res, next) => {
  // Intranet privada: que ningún buscador la indexe.
  res.set('X-Robots-Tag', 'noindex, nofollow');
  const host = req.get('host') || '';
  if (!isAllowedHost(host)) return res.status(403).send('Solo accesible desde este ordenador.');
  const origin = req.get('origin');
  if (req.method !== 'GET' && origin && !isAllowedHost(origin.replace(/^https?:\/\//, ''))) {
    return res.status(403).json({ error: 'Origen no permitido.' });
  }
  // Las cookies de sesión van ligadas al nombre de host: usamos siempre "localhost".
  if (req.method === 'GET' && !req.path.startsWith('/api/') && host !== APP_HOST && host.endsWith(`:${PORT}`)) {
    return res.redirect(`${APP_ORIGIN}${req.originalUrl}`);
  }
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use('/api', authRouter, adminRouter, ruletaRouter, boardRouter, apiRouter);
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

// Interfaz web ya compilada (npm run build).
app.use(express.static(DIST_DIR, { index: false }));
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  // La ruleta: en ruleta.playctp.com es la página entera; en local, /ruleta.
  const ruleta = (RULETA_HOST && hostOf(req) === RULETA_HOST) || /^\/ruleta\/?$/.test(req.path);
  const index = path.join(DIST_DIR, ruleta ? 'ruleta.html' : 'index.html');
  if (!fs.existsSync(index)) {
    return res
      .status(503)
      .send('La interfaz no está compilada. Ejecuta "npm start" (o "npm run build") en la carpeta del proyecto.');
  }
  res.sendFile(index);
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON no válido.' });
  console.error('[servidor]', err);
  res.status(500).json({ error: 'Error interno del servidor. Mira la consola para más detalles.' });
});

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

// Escuchamos en IPv4 e IPv6 locales para que "localhost" funcione en
// cualquier navegador, y nunca en la red: nadie más puede entrar.
function listen(host) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.once('error', (err) => resolve(err));
    server.listen(PORT, host, () => resolve(null));
  });
}

const [v4Error, v6Error] = [await listen('127.0.0.1'), await listen('::1')];
if (v4Error && v6Error) {
  const reason = v4Error.code === 'EADDRINUSE' ? `el puerto ${PORT} ya está en uso (¿ya tienes la app abierta?)` : v4Error.message;
  console.error(`No se pudo arrancar el servidor: ${reason}`);
  process.exit(1);
}

// Limpieza periódica de sesiones caducadas.
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 60 * 60 * 1000).unref();

console.log(`\n  CTP Manager funcionando en ${APP_ORIGIN}`);
console.log('  Para cerrar la app, cierra esta ventana.\n');
if (process.env.OPEN_BROWSER === '1') openBrowser(APP_ORIGIN);
