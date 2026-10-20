// Ruleta (ruleta.playctp.com): host público explícito y aislado, acceso solo
// con sesión de staff, lectura de usuarios CTP por el puente y sorteo en el servidor.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deploymentConfig, requestBoundary, isRuletaHost } from '../server/config.js';
import { collectRegisteredPlayers, ruletaPerson } from '../server/ruleta-contract.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-ruleta-'));
const children = [];
let port;

const fakeReq = (headers = {}, method = 'POST', route = '/api/ruleta/draw') => ({ method, path: route, get: (name) => headers[name] });

test('RULETA_ORIGIN es opcional, exacto y solo junto al origen público de Manager', () => {
  const base = { PUBLIC_ORIGIN: 'https://manager.playctp.com' };
  assert.equal(deploymentConfig(base).ruletaHost, null);
  const config = deploymentConfig({ ...base, RULETA_ORIGIN: 'https://ruleta.playctp.com' });
  assert.deepEqual(config.hosts, ['manager.playctp.com', 'ruleta.playctp.com']);
  assert.equal(config.secureCookies, true);
  for (const value of ['https://evil.playctp.com', 'http://ruleta.playctp.com', 'https://ruleta.playctp.com/x']) {
    assert.throws(() => deploymentConfig({ ...base, RULETA_ORIGIN: value }));
  }
  assert.throws(() => deploymentConfig({ RULETA_ORIGIN: 'https://ruleta.playctp.com' }));
});

test('cada host público solo acepta peticiones de su propia página', () => {
  const config = deploymentConfig({ PUBLIC_ORIGIN: 'https://manager.playctp.com', RULETA_ORIGIN: 'https://ruleta.playctp.com' });
  assert.equal(requestBoundary(fakeReq({ host: 'ruleta.playctp.com', origin: 'https://ruleta.playctp.com' }), config), null);
  assert.equal(requestBoundary(fakeReq({ host: 'manager.playctp.com', origin: 'https://manager.playctp.com' }), config), null);
  assert.ok(requestBoundary(fakeReq({ host: 'ruleta.playctp.com', origin: 'https://manager.playctp.com' }), config));
  assert.ok(requestBoundary(fakeReq({ host: 'manager.playctp.com', origin: 'https://ruleta.playctp.com' }), config));
  assert.ok(requestBoundary(fakeReq({ host: 'otra.playctp.com' }), config));
  assert.equal(isRuletaHost(fakeReq({ host: 'ruleta.playctp.com' }), config), true);
  assert.equal(isRuletaHost(fakeReq({ host: 'manager.playctp.com' }), config), false);
});

test('la lista de CTP recorre todas las páginas y solo conserva id, nombre y rol', async () => {
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const all = Array.from({ length: 230 }, (_, i) => ({ id: id(i + 1), username: `Jugador ${i + 1}`, role: i === 0 ? 'admin' : 'player', email: 'x@y.z', points: 5 }));
  const seen = [];
  const request = async (body) => {
    seen.push(body);
    const { page, limit } = body.filters;
    const items = all.slice(page * limit, page * limit + limit);
    return { resource: 'users', items, total: all.length, has_more: (page + 1) * limit < all.length, page, limit };
  };
  const result = await collectRegisteredPlayers(request, 'ctp:actor');
  assert.equal(result.people.length, 230);
  assert.equal(result.total, 230);
  assert.equal(result.truncated, false);
  assert.equal(seen.length, 3);
  assert.ok(seen.every((b) => b.action === 'admin_query' && b.resource === 'users' && b.actor_id === 'ctp:actor' && b.filters.limit === 100));
  assert.deepEqual(Object.keys(result.people[0]).sort(), ['ctp_id', 'name', 'role']);
  assert.equal(result.people[0].role, 'admin');

  const capped = await collectRegisteredPlayers(request, 'ctp:actor', { maxPages: 2 });
  assert.equal(capped.people.length, 200);
  assert.equal(capped.truncated, true);

  await assert.rejects(collectRegisteredPlayers(async () => ({ resource: 'teams', items: [] }), 'ctp:actor'), { status: 502 });
  assert.equal(ruletaPerson({ id: 'no-uuid', username: 'x' }), null);
  assert.equal(ruletaPerson({ id: id(1), username: '   ' }), null);
  assert.equal(ruletaPerson({ id: id(1), username: 'Ana\u0007', role: 'superuser' }).role, 'player');
});

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}

async function start(env) {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATA_DIR: path.join(temp, String(children.length)), DB_PATH: '', CTP_AUTH_MODE: 'local',
      CTP_OPERATIONS_URL: '', CTP_OPERATIONS_TOKEN: '', CTP_ENABLE_WRITES: 'false', CTP_SYNC_SECONDS: '0', OPEN_BROWSER: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let output = '';
  child.stdout.on('data', (c) => (output += c));
  child.stderr.on('data', (c) => (output += c));
  const end = Date.now() + 10000;
  while (!output.includes('funcionando')) {
    if (child.exitCode !== null || Date.now() > end) throw new Error(`No arranca: ${output}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  return child;
}

async function stop(child) {
  if (child.exitCode === null && !child.signalCode) await new Promise((resolve) => { child.once('exit', resolve); child.kill(); });
}

function call(method, route, { host, body, cookie = '', origin } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port, path: route, method,
      headers: { Host: host, cookie, ...(origin ? { Origin: origin } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) } }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* HTML */ }
        resolve({ status: res.statusCode, headers: res.headers, json, raw });
      });
    });
    req.on('error', reject);
    req.end(data ?? undefined);
  });
}

before(async () => {
  port = await unusedPort();
});

after(async () => {
  for (const child of children) await stop(child);
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('en local: solo staff con sesión ve la lista y sortea; el ganador sale del servidor', async () => {
  const child = await start({ PUBLIC_ORIGIN: '' });
  const host = `localhost:${port}`;
  const origin = `http://localhost:${port}`;
  try {
    assert.equal((await call('GET', '/api/ruleta/participants', { host })).status, 401);
    assert.equal((await call('POST', '/api/ruleta/draw', { host, origin, body: {} })).status, 401);
    const setup = await call('POST', '/api/auth/setup', { host, origin, body: { username: 'admin', name: 'Admin', password: 'contraseña-segura' } });
    assert.equal(setup.status, 200);
    const cookie = setup.headers['set-cookie'][0].split(';')[0];
    for (const [username, name] of [['ana', 'Ana'], ['luis', 'Luis']]) {
      assert.equal((await call('POST', '/api/users', { host, origin, cookie, body: { username, name, password: 'contraseña-segura' } })).status, 201);
    }
    const list = await call('GET', '/api/ruleta/participants', { host, cookie });
    assert.equal(list.status, 200);
    assert.equal(list.json.source, 'manager');
    assert.deepEqual(list.json.people.map((p) => p.name), ['Admin', 'Ana', 'Luis']);

    const seen = new Set();
    for (let i = 0; i < 30; i++) {
      const res = await call('POST', '/api/ruleta/draw', { host, origin, cookie, body: { excluded: [] } });
      assert.equal(res.status, 201);
      assert.ok(res.json.participants.some((p) => p.key === res.json.winner.key));
      seen.add(res.json.winner.name);
    }
    assert.equal(seen.size, 3);
    const ana = list.json.people.find((p) => p.name === 'Ana').key;
    const only = await call('POST', '/api/ruleta/draw', { host, origin, cookie, body: { excluded: list.json.people.filter((p) => p.key !== ana).map((p) => p.key) } });
    assert.equal(only.json.winner.name, 'Ana');
    assert.equal(only.json.participant_count, 1);
    assert.equal((await call('POST', '/api/ruleta/draw', { host, origin, cookie, body: { excluded: list.json.people.map((p) => p.key) } })).status, 400);
    assert.equal((await call('POST', '/api/ruleta/draw', { host, origin, cookie, body: { excluded: 'todos' } })).status, 400);
    const history = await call('GET', '/api/ruleta/draws', { host, cookie });
    assert.equal(history.json[0].winner.name, 'Ana');
    assert.equal(history.json[0].drawn_by, 'Admin');
  } finally {
    await stop(child);
  }
});

test('ruleta.playctp.com solo expone la ruleta y su login, con cookie __Host- propia', async () => {
  const child = await start({ PUBLIC_ORIGIN: 'https://manager.playctp.com', RULETA_ORIGIN: 'https://ruleta.playctp.com' });
  try {
    const host = 'ruleta.playctp.com';
    const status = await call('GET', '/api/auth/status', { host });
    assert.equal(status.status, 200);
    assert.equal(status.json.authenticated, false);
    assert.equal((await call('GET', '/api/ruleta/participants', { host })).status, 401);
    for (const route of ['/api/users', '/api/contents', '/api/operations/integration', '/api/me']) {
      assert.equal((await call('GET', route, { host })).status, 404, route);
    }
    assert.equal((await call('POST', '/api/auth/login', { host, origin: 'https://manager.playctp.com', body: {} })).status, 403);
    assert.equal((await call('GET', '/api/auth/status', { host: 'evil.playctp.com' })).status, 403);
    if (fs.existsSync(path.join(root, 'dist', 'ruleta.html'))) {
      const page = await call('GET', '/', { host });
      assert.match(page.raw, /<title>Ruleta · PlayCTP<\/title>/);
      const manager = await call('GET', '/', { host: 'manager.playctp.com' });
      assert.doesNotMatch(manager.raw, /Ruleta · PlayCTP/);
    }
  } finally {
    await stop(child);
  }
});
