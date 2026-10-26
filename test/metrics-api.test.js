import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-metrics-api-'));
const file = path.join(directory, 'snapshot.json');
const children = [];
let server, production, adminCookie, staffCookie, prodAdminCookie, prodStaffCookie;
const password = 'metrics-test-local-password';
const snapshot = { schemaVersion: 1, generatedAt: new Date().toISOString(), available: true,
  source: { collectionStartedAt: new Date().toISOString(), intervalSeconds: 60, retentionHours: 24 },
  host: { cpuPercent: 1.5 }, environments: {
    pre: { traffic: { available: true, requests24h: 25 }, activity: { available: true, accounts: 10 } },
    prod: { traffic: { available: true, requests24h: 125 }, activity: { available: true, accounts: 20 } },
  }, private: 'PRIVATE-CANARY-not-in-response' };

async function freePort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

async function start(extra = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: directory, DB_PATH: '',
      PUBLIC_ORIGIN: '', RULETA_ORIGIN: '', CTP_AUTH_MODE: 'local', CTP_AUTH_URL: '', CTP_WEB_ORIGIN: '',
      CTP_OPERATIONS_URL: '', CTP_OPERATIONS_TOKEN: '', CTP_SIGNING_SECRET: '', CTP_SYNC_SECONDS: '0', CTP_ENABLE_WRITES: 'false',
      CTP_METRICS_ENABLED: '1', CTP_METRICS_FILE: file, OPEN_BROWSER: '0', ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const deadline = Date.now() + 10_000;
  while (!output.includes('funcionando')) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error(`El servidor de prueba no arrancó: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  return { child, port, host: extra.PUBLIC_ORIGIN ? new URL(extra.PUBLIC_ORIGIN).host : `localhost:${port}` };
}

async function stop(child) {
  if (child.exitCode === null && !child.signalCode) await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
}

function request(target, method, route, { cookie, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: target.port, method, path: `/api${route}`,
      headers: { Host: target.host, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers } }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(text) }));
    });
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
}

async function login(target, username = 'metricsadmin') {
  const result = await request(target, 'POST', '/auth/login', { body: { username, password }, headers: target.host.startsWith('localhost:') ? {} : { Origin: `https://${target.host}` } });
  assert.equal(result.status, 200);
  return result.headers['set-cookie'][0].split(';')[0];
}

before(async () => {
  fs.writeFileSync(file, JSON.stringify(snapshot));
  const local = await start();
  assert.equal((await request(local, 'POST', '/auth/setup', { body: { username: 'metricsadmin', password } })).status, 200);
  const cookie = await login(local);
  const roles = await request(local, 'GET', '/roles', { cookie });
  const staffRole = roles.data.find(role => role.staff_kind === 'production'); assert(staffRole);
  assert.equal((await request(local, 'POST', '/users', { cookie, body: { username: 'metricsstaff', password, role_ids: [staffRole.id] } })).status, 201);
  await stop(local.child);
  server = await start({ PUBLIC_ORIGIN: 'https://pre.manager.playctp.com' });
  adminCookie = await login(server);
  staffCookie = await login(server, 'metricsstaff');
  production = await start({ PUBLIC_ORIGIN: 'https://manager.playctp.com' });
  prodAdminCookie = await login(production);
  prodStaffCookie = await login(production, 'metricsstaff');
});

after(async () => {
  for (const child of children) await stop(child);
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  assert(path.basename(directory).startsWith('ctp-metrics-api-'));
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('real PRE endpoint denies anonymous and production staff, while administrator sees segregated aggregates with no-store', async () => {
  assert.equal((await request(server, 'GET', '/administration/metrics')).status, 401);
  assert.equal((await request(server, 'GET', '/administration/metrics', { cookie: staffCookie })).status, 403);
  const result = await request(server, 'GET', '/administration/metrics', { cookie: adminCookie });
  assert.equal(result.status, 200); assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.data.schemaVersion, 1); assert.equal(result.data.host.cpuPercent, 1.5);
  assert.equal(result.data.environments.pre.traffic.requests24h, 25);
  assert.equal(result.data.environments.prod.traffic.requests24h, 125);
  assert(!JSON.stringify(result).includes('PRIVATE-CANARY'));
  assert.equal((await request(server, 'GET', '/roles', { cookie: adminCookie })).status, 200);
  assert.equal((await request(server, 'GET', '/operations/integration', { cookie: staffCookie })).status, 200);
});

test('PRE and PROD metrics preserve exact Host/Origin boundaries and ignore browser file/source selectors', async () => {
  for (const [target, cookie, otherHost] of [[server, adminCookie, production.host], [production, prodAdminCookie, server.host]]) {
    for (const headers of [{ Host: otherHost }, { Host: 'evil.invalid', 'X-Forwarded-Host': target.host }, { Origin: `https://${otherHost}` }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      assert.equal((await request(target, 'GET', '/administration/metrics', { cookie, headers })).status, 403);
    }
    const result = await request(target, 'GET', '/administration/metrics?file=%2Fetc%2Fpasswd&environment=prod&url=https%3A%2F%2Fevil.invalid', { cookie, headers: { 'X-Metrics-File': '/etc/passwd' } });
    assert.equal(result.status, 200); assert.equal(result.data.environments.pre.traffic.requests24h, 25);
    assert.equal(result.data.environments.prod.traffic.requests24h, 125);
    assert.equal(result.headers['cache-control'], 'no-store');
  }
});

test('production metrics admit only administrators and return only aggregate DTO fields', async () => {
  assert.equal((await request(production, 'GET', '/administration/metrics')).status, 401);
  assert.equal((await request(production, 'GET', '/administration/metrics', { cookie: prodStaffCookie })).status, 403);
  const result = await request(production, 'GET', '/administration/metrics', { cookie: prodAdminCookie });
  assert.equal(result.status, 200); assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.data.schemaVersion, 1); assert.equal(result.data.host.cpuPercent, 1.5);
  assert.equal(result.data.environments.pre.traffic.requests24h, 25);
  assert.equal(result.data.environments.prod.traffic.requests24h, 125);
  assert(!JSON.stringify(result).includes('PRIVATE-CANARY'));
});

test('missing snapshots on both Manager origins return generic503 without exposing server paths', async () => {
  for (const origin of ['https://pre.manager.playctp.com', 'https://manager.playctp.com']) {
    const unavailable = await start({ PUBLIC_ORIGIN: origin, CTP_METRICS_FILE: path.join(directory, 'PRIVATE-MISSING-FILE.json') });
    try {
      const cookie = await login(unavailable);
      const result = await request(unavailable, 'GET', '/administration/metrics', { cookie });
      assert.equal(result.status, 503); assert.equal(result.headers['cache-control'], 'no-store');
      assert(!JSON.stringify(result).includes('PRIVATE-MISSING-FILE')); assert(!JSON.stringify(result).includes(directory));
      assert.deepEqual(Object.keys(result.data), ['error']);
    } finally { await stop(unavailable.child); }
  }
});
