import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { migrationShadowEnabled } from '../server/migration-shadow.js';

test('migration quarantine is explicit service configuration and rejects ambiguous values', () => {
  for (const value of [undefined, '', '0']) assert.equal(migrationShadowEnabled({ CTP_MANAGER_MIGRATION_SHADOW: value }), false);
  assert.equal(migrationShadowEnabled({ CTP_MANAGER_MIGRATION_SHADOW: '1' }), true);
  for (const value of ['true', 'yes', 'false', ' 1', '2']) assert.throws(() => migrationShadowEnabled({ CTP_MANAGER_MIGRATION_SHADOW: value }));
});

async function unusedPort() {
  const server = net.createServer();await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;await new Promise(resolve => server.close(resolve));return port;
}
function request(port, method, route) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method, path: route, headers: { Host: `localhost:${port}` } }, res => {
      let raw = '';res.on('data', chunk => { raw += chunk; });res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw), cookie: res.headers['set-cookie'] }));
    });req.on('error', reject);req.end();
  });
}
test('real shadow HTTP blocks all API work, starts no bridge polling and emits no session cookie', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-shadow-'));
  let calls = 0;
  const bridge = http.createServer((req, res) => { calls++;res.writeHead(503).end(); });
  await new Promise(resolve => bridge.listen(0, '127.0.0.1', resolve));
  const port = await unusedPort();
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: process.cwd(), env: { ...process.env, PORT: String(port), DATA_DIR: temporary, DB_PATH: '', PUBLIC_ORIGIN: '',
      CTP_AUTH_MODE: 'local', CTP_MANAGER_MIGRATION_SHADOW: '1', CTP_SYNC_SECONDS: '30',
      CTP_OPERATIONS_URL: `http://127.0.0.1:${bridge.address().port}/bridge`,
      CTP_OPERATIONS_TOKEN: 'synthetic-token-'.repeat(4), CTP_SIGNING_SECRET: 'synthetic-signing-'.repeat(4),
      CTP_ENABLE_WRITES: 'true', CTP_ALLOW_LOCAL_WRITES: 'true', OPEN_BROWSER: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve);child.kill(); });
    await new Promise(resolve => bridge.close(resolve));
    assert.equal(path.dirname(temporary), os.tmpdir());assert.ok(path.basename(temporary).startsWith('manager-shadow-'));
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5 });
  });
  let output = '';child.stdout.on('data', chunk => { output += chunk; });child.stderr.on('data', chunk => { output += chunk; });
  const limit = Date.now() + 15000;
  while (!output.includes('funcionando')) {
    assert.equal(child.exitCode, null, 'shadow child exited before health: ' + (output.match(/(?:Error|TypeError|SyntaxError): ([^\r\n]{1,180})/)?.[1] ?? 'unclassified'));assert.ok(Date.now() < limit, 'shadow startup timed out');
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  const status = await request(port, 'GET', '/api/auth/status');
  assert.equal(status.status, 200);assert.equal(status.body.migration_shadow, true);assert.equal(status.body.authenticated, false);assert.equal(status.cookie, undefined);
  for (const [method, route] of [['POST','/api/auth/login'],['GET','/api/me'],['GET','/api/ruleta/players'],['POST','/api/operations/command'],['GET','/api/auth/config']]) {
    const response = await request(port, method, route);assert.equal(response.status, 503);assert.equal(response.body.code, 'migration_shadow');assert.equal(response.cookie, undefined);
  }
  await new Promise(resolve => setTimeout(resolve, 1150));
  assert.equal(calls, 0, 'neither operations nor ruleta may call the bridge while quarantined');
});
