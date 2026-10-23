import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import express from 'express';
import { APP_HOST, APP_ORIGIN, DIST_DIR, PORT, DEPLOYMENT, requestBoundary, isRuletaHost } from './config.js';
import { ruletaRouter } from './routes/ruleta.js';
import { db } from './db.js';
import { HttpError } from './auth.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { apiRouter } from './routes/api.js';
import { boardRouter } from './routes/board.js';
import { operationsRouter } from './routes/operations.js';
import { integrationRouter } from './routes/integration.js';
import { startOperationsSync } from './integration.js';
import { startRuletaSync } from './ruleta.js';
import { obsRouter } from './routes/obs.js';
import { administrationRouter } from './routes/administration.js';

const app = express();
app.disable('x-powered-by');

// Se mantiene la escucha en loopback. En VPS el proxy conserva Host y termina TLS.
app.use((req, res, next) => {
  // Intranet privada: que ningún buscador la indexe.
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('X-Frame-Options', 'DENY');
  // No script-src/frame-src/connect-src restriction is added here: Cloudflare's
  // widget loads at challenges.cloudflare.com without changing frame-ancestors
  // or imposing new network restrictions on the existing Manager/OBS clients.
  res.set('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  if (DEPLOYMENT.publicDeployment) res.set('Strict-Transport-Security', 'max-age=31536000');
  const host = req.get('host') || '';
  const rejected = requestBoundary(req);
  if (rejected) return res.status(403).json({ error: rejected });
  // Las cookies de sesión van ligadas al nombre de host: usamos siempre "localhost".
  if (!DEPLOYMENT.publicDeployment && req.method === 'GET' && !req.path.startsWith('/api/') && host !== APP_HOST) {
    return res.redirect(`${APP_ORIGIN}${req.originalUrl}`);
  }
  // ruleta.playctp.com solo expone la página de la ruleta y lo que ella usa:
  // el resto de la API de Manager no existe en ese host.
  if (isRuletaHost(req) && req.path.startsWith('/api/') && !/^\/api\/(auth\/(status|config|login|logout)(\/|$)|ruleta(\/|$))/.test(req.path)) {
    return res.status(404).json({ error: 'Ruta no encontrada.' });
  }
  next();
});

app.use('/api/administration/images', express.json({limit:'3mb'}));
app.use('/api/administration/crm', express.json({limit:'2mb'}));
app.use(express.json({ limit: '1mb' }));
app.use('/api', authRouter, ruletaRouter, administrationRouter, obsRouter, integrationRouter, operationsRouter, adminRouter, boardRouter, apiRouter);
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

// Interfaz web ya compilada (npm run build).
app.use(express.static(DIST_DIR, { index: false }));
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  // La ruleta: toda la web en ruleta.playctp.com; en local, en /ruleta.
  const ruleta = isRuletaHost(req) || (!DEPLOYMENT.publicDeployment && /^\/ruleta\/?$/.test(req.path));
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
  if (err instanceof HttpError) {
    if (err.status === 429 && Number.isSafeInteger(err.retryAfterSeconds) && err.retryAfterSeconds > 0) res.set('Retry-After', String(err.retryAfterSeconds));
    return res.status(err.status).json({ error: err.message, ...(err.code === 'captcha_failed' ? { code: 'captcha_failed' } : {}) });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON no válido.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'La solicitud supera el tamaño permitido.' });
  // No imprimir errores de transporte: pueden contener URL, cuerpos o credenciales.
  console.error('[servidor] Error no controlado en', req.method, req.path);
  res.status(500).json({ error: 'Error interno del servidor.' });
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
startOperationsSync();
startRuletaSync();

console.log(`\n  CTP Manager funcionando en ${APP_ORIGIN}`);
console.log('  Para cerrar la app, cierra esta ventana.\n');
if (process.env.OPEN_BROWSER === '1') openBrowser(APP_ORIGIN);
