import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deploymentConfig, requestBoundary } from '../server/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-deployment-'));
const processes = [];
let port;

function req(headers = {}, method = 'POST', route = '/api/auth/login') {
  return { method, path: route, get: (name) => headers[name] };
}

test('el origen público es HTTPS exacto y no concede confianza a subdominios', () => {
  const config = deploymentConfig({ PUBLIC_ORIGIN: 'https://manager.playctp.com', PORT: '3210' });
  assert.equal(config.secureCookies, true);
  assert.equal(requestBoundary(req({ host: 'manager.playctp.com', origin: 'https://manager.playctp.com' }), config), null);
  assert.ok(requestBoundary(req({ host: 'manager.playctp.com', origin: 'https://evil.manager.playctp.com' }), config));
  assert.ok(requestBoundary(req({ host: 'localhost:3210', 'x-forwarded-host': 'manager.playctp.com' }), config));
  for (const origin of ['http://manager.playctp.com', 'https://user:pass@manager.playctp.com', 'https://manager.playctp.com/path', 'https://manager.playctp.com?x=1']) {
    assert.throws(() => deploymentConfig({ PUBLIC_ORIGIN: origin }));
  }
});

test('localhost admite Vite declarado y bloquea CSRF y DNS rebinding', () => {
  const config = deploymentConfig({ PORT: '3210', DEV_WEB_PORT: '5173' });
  assert.equal(requestBoundary(req({ host: 'localhost:3210', origin: 'http://localhost:5173' }), config), null);
  assert.ok(requestBoundary(req({ host: 'evil.test:3210' }), config));
  assert.ok(requestBoundary(req({ host: 'localhost:3210', origin: 'http://localhost:9999' }), config));
  assert.ok(requestBoundary(req({ host: 'localhost:3210', 'sec-fetch-site': 'cross-site' }), config));
  assert.ok(requestBoundary(req({ host: 'localhost:3210', 'sec-fetch-site': 'same-site' }), config));
  assert.ok(requestBoundary(req({ host: 'localhost:3210', origin: 'null' }), config));
});

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}

async function start(env = {}) {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: temp, DB_PATH: '', PUBLIC_ORIGIN: '',
      CTP_OPERATIONS_URL: '', CTP_OPERATIONS_TOKEN: '', CTP_ENABLE_WRITES: 'false', CTP_SYNC_SECONDS: '0', OPEN_BROWSER: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  processes.push(child);
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const end = Date.now() + 10000;
  while (!output.includes('funcionando')) {
    if (child.exitCode !== null || Date.now() > end) throw new Error(`No arranca el servidor de prueba: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return child;
}

async function stop(child) {
  if (child.exitCode === null && !child.signalCode) await new Promise((resolve) => { child.once('exit', resolve); child.kill(); });
}

function request(method, route, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: route, method,
      headers: { Host: 'manager.playctp.com', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers } }, (response) => {
      let text = ''; response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, data: JSON.parse(text) }));
    });
    request.on('error', reject); request.end(body ? JSON.stringify(body) : undefined);
  });
}

before(async () => {
  port = await unusedPort();
  const initial = await start();
  const result = await request('POST', '/api/auth/setup', { username: 'admin', password: 'local-test-password' }, { Host: `localhost:${port}` });
  assert.equal(result.status, 200);
  await stop(initial);
  await start({ PUBLIC_ORIGIN: 'https://manager.playctp.com' });
});

after(async () => {
  for (const child of processes) await stop(child);
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('proxy HTTPS usa cookie segura y API privada sin caché', async () => {
  const response = await request('POST', '/api/auth/login', { username: 'admin', password: 'local-test-password' }, { Origin: 'https://manager.playctp.com' });
  assert.equal(response.status, 200);
  const cookie = response.headers['set-cookie'][0];
  assert.match(cookie, /; Secure/); assert.match(cookie, /; HttpOnly/); assert.match(cookie, /; SameSite=Lax/);
  assert.equal(response.headers['cache-control'], 'no-store');
  const denied = await request('GET', '/api/operations/integration');
  assert.equal(denied.status, 401);
  const status = await request('GET', '/api/operations/integration', undefined, { Cookie: cookie.split(';')[0] });
  assert.equal(status.status, 200);
  assert.equal(status.data.configured, false); assert.equal(status.data.write_enabled, false);
});

test('Host, Origin y Fetch Metadata se comprueban en la API real', async () => {
  assert.equal((await request('GET', '/api/auth/status', undefined, { Host: 'attacker.test', 'X-Forwarded-Host': 'manager.playctp.com' })).status, 403);
  assert.equal((await request('POST', '/api/auth/login', {}, { Origin: 'https://attacker.test' })).status, 403);
  assert.equal((await request('POST', '/api/auth/login', {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await request('GET', '/api/me', undefined, { Cookie: 'mrm_session=%E0%A4%A' })).status, 401);
});

test('el alta inicial queda bloqueada en una instalación pública vacía', async () => {
  const newPort = await unusedPort();
  const empty = await start({ PORT: String(newPort), DATA_DIR: path.join(temp, 'empty'), PUBLIC_ORIGIN: 'https://manager.playctp.com' });
  const previous = port; port = newPort;
  try {
    assert.equal((await request('POST', '/api/auth/setup', { username: 'intruder', password: 'test-password' }, { Origin: 'https://manager.playctp.com' })).status, 403);
    assert.equal((await request('GET', '/api/auth/status')).data.setup, false);
  } finally { port = previous; await stop(empty); }
});
