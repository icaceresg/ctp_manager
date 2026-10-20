// Ruleta (ruleta.playctp.com): acceso solo con sesión del manager, sesión
// compartida entre subdominios y sorteo hecho en el servidor.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3900 + Math.floor(Math.random() * 400);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrm-ruleta-'));
let server;
let output = '';

/** Petición con el Host que queramos (como llegaría a través del proxy). */
function request(method, url, { host = `localhost:${PORT}`, cookie = '', body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        method,
        path: url,
        headers: { host, cookie, ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch {
            /* HTML u otro texto */
          }
          resolve({ status: res.statusCode, headers: res.headers, json, raw });
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const cookieFrom = (res) => (res.headers['set-cookie'] || [])[0]?.split(';')[0] || '';

before(async () => {
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      MANAGER_HOST: 'manager.playctp.com',
      RULETA_HOST: 'ruleta.playctp.com',
      COOKIE_DOMAIN: 'playctp.com',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => (output += d));
  server.stderr.on('data', (d) => (output += d));
  const start = Date.now();
  while (!output.includes('funcionando')) {
    if (Date.now() - start > 8000) throw new Error(output);
    await new Promise((r) => setTimeout(r, 100));
  }
});

after(async () => {
  if (server && server.exitCode === null) {
    await new Promise((resolve) => {
      server.once('exit', resolve);
      server.kill();
    });
  }
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

let admin = '';
const ids = {};

test('sin sesión no se puede ver ni sortear nada', async () => {
  for (const [method, url] of [
    ['GET', '/api/ruleta/participants'],
    ['POST', '/api/ruleta/draw'],
    ['GET', '/api/ruleta/draws'],
  ]) {
    const res = await request(method, url, { host: 'ruleta.playctp.com' });
    assert.equal(res.status, 401, `${method} ${url}`);
  }
});

test('rechaza dominios que no son los de PlayCTP', async () => {
  const res = await request('GET', '/api/auth/status', { host: 'evil.example.com' });
  assert.equal(res.status, 403);
});

test('la sesión iniciada en el manager vale para la ruleta', async () => {
  const setup = await request('POST', '/api/auth/setup', {
    host: 'manager.playctp.com',
    body: { username: 'admin', name: 'Admin', password: 'contraseña-segura' },
  });
  assert.equal(setup.status, 200);
  const raw = setup.headers['set-cookie'][0];
  assert.match(raw, /Domain=playctp\.com/i);
  assert.match(raw, /Secure/i);
  assert.match(raw, /HttpOnly/i);
  admin = cookieFrom(setup);

  const status = await request('GET', '/api/auth/status', { host: 'ruleta.playctp.com', cookie: admin });
  assert.equal(status.json.authenticated, true);

  // Más personas: una con rol y otra desactivada (esta no entra en el sorteo).
  for (const [username, name, active] of [
    ['ana', 'Ana López', true],
    ['luis', '', true],
    ['baja', 'De Baja', false],
  ]) {
    const res = await request('POST', '/api/users', {
      host: 'manager.playctp.com',
      cookie: admin,
      body: { username, name, password: 'contraseña-segura', active },
    });
    assert.equal(res.status, 201);
    ids[username] = res.json.id;
  }
});

test('cualquier persona con cuenta del manager puede entrar, aunque no tenga roles', async () => {
  const login = await request('POST', '/api/auth/login', { host: 'ruleta.playctp.com', body: { username: 'ana', password: 'contraseña-segura' } });
  assert.equal(login.status, 200);
  const res = await request('GET', '/api/ruleta/participants', { host: 'ruleta.playctp.com', cookie: cookieFrom(login) });
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.json.map((p) => p.name),
    ['Admin', 'Ana López', 'luis'],
  );
});

test('el servidor elige al ganador entre los participantes', async () => {
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    const res = await request('POST', '/api/ruleta/draw', { host: 'ruleta.playctp.com', cookie: admin, body: {} });
    assert.equal(res.status, 201);
    assert.equal(res.json.participants.length, 3);
    assert.ok(res.json.participants.some((p) => p.id === res.json.winner.id));
    seen.add(res.json.winner.id);
  }
  assert.equal(seen.size, 3, 'con 30 sorteos salen las tres personas');
  assert.ok(!seen.has(ids.baja));
});

test('se puede limitar el sorteo a algunas personas', async () => {
  const res = await request('POST', '/api/ruleta/draw', {
    host: 'ruleta.playctp.com',
    cookie: admin,
    body: { participant_ids: [ids.ana, ids.baja] },
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.winner.name, 'Ana López');
  const none = await request('POST', '/api/ruleta/draw', { host: 'ruleta.playctp.com', cookie: admin, body: { participant_ids: [ids.baja] } });
  assert.equal(none.status, 400);
});

test('guarda el historial de sorteos', async () => {
  const res = await request('GET', '/api/ruleta/draws', { host: 'ruleta.playctp.com', cookie: admin });
  assert.equal(res.status, 200);
  assert.equal(res.json[0].winner.name, 'Ana López');
  assert.equal(res.json[0].participant_count, 1);
  assert.equal(res.json[0].drawn_by, 'Admin');
});

test('ruleta.playctp.com sirve la página de la ruleta y manager la intranet', { skip: !fs.existsSync(path.join(root, 'dist', 'ruleta.html')) }, async () => {
  const ruleta = await request('GET', '/', { host: 'ruleta.playctp.com' });
  assert.equal(ruleta.status, 200);
  assert.match(ruleta.raw, /<title>Ruleta · PlayCTP<\/title>/);
  const manager = await request('GET', '/', { host: 'manager.playctp.com' });
  assert.match(manager.raw, /<title>CTP Manager<\/title>/);
});
