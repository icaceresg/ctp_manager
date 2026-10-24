import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Real local Express/SQLite/cookie flow; native Auth responses are test fixtures.
// The child cannot make external requests: its complete fetch transport is replaced.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-captcha-api-'));
const siteKey = '1x00000000000000000000AA';
const anon = `e30.${Buffer.from('{"role":"anon","exp":4102444800}').toString('base64url')}.fixture`;
const key = crypto.randomBytes(32).toString('base64url');
let child, port;
const preload = `
const used = new Set();
const subject = '10000000-0000-4000-8000-000000000001';
globalThis.fetch = async (url, init) => {
 if (url === 'https://pre.playctp.com/auth/v1/token?grant_type=password') {
  const body = JSON.parse(init.body), proof = body.gotrue_meta_security?.captcha_token;
  if (proof !== 'fixture-valid-once' || used.has(proof)) return Response.json({code:'captcha_failed',message:'private fixture detail'}, {status:400});
  used.add(proof);
  return Response.json({user:{id:subject},access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600});
 }
 if (url === 'https://pre.playctp.com/rest/v1/rpc/manager_link_own_identity') {
  if (init.headers.Authorization !== 'Bearer fixture-access') return Response.json({}, {status:403});
  return Response.json({ctp_user_id:subject,username:'Synthetic PRE admin',role:'admin',actor_id:'ctp:'+subject,scopes:['admin.console']});
 }
 throw Error('external transport disabled by local test');
};`;

function request(method, route, body, { host = 'pre.manager.playctp.com', cookie } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: route, method,
      headers: { Host: host, ...(method === 'POST' ? { Origin: 'https://' + host } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) } }, response => {
      let raw = ''; response.on('data', chunk => { raw += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, data: JSON.parse(raw) }));
    });
    request.on('error', reject); request.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

before(async () => {
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'data:text/javascript;base64,' + Buffer.from(preload).toString('base64'), 'server/index.js'], {
    cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: temporary, DB_PATH: '', PUBLIC_ORIGIN: 'https://pre.manager.playctp.com', RULETA_ORIGIN: 'https://ruleta.playctp.com',
      OPEN_BROWSER: '0', CTP_AUTH_MODE: 'ctp', CTP_AUTH_URL: 'https://pre.playctp.com', CTP_WEB_ORIGIN: 'https://pre.playctp.com',
      CTP_OPERATIONS_URL: 'https://pre.playctp.com/functions/v1/manager-operations', CTP_AUTH_ANON_KEY: anon,
      CTP_AUTH_TOKEN_KEY: key, CTP_AUTH_CAPTCHA_REQUIRED: 'true', CTP_AUTH_CAPTCHA_SITE_KEY: siteKey,
      CTP_OPERATIONS_TOKEN: 'synthetic-bridge-token-not-real-00000000', CTP_SIGNING_SECRET: 'synthetic-signing-key-not-real-11111111',
      CTP_ENABLE_WRITES: 'false', CTP_SYNC_SECONDS: '0', OBS_ENABLE_CONTROL: 'false' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  const deadline = Date.now() + 10000;
  while (!output.includes('funcionando')) {
    if (child.exitCode !== null || Date.now() > deadline) throw Error('Local Manager fixture startup failed: ' + output.slice(-1800));
    await new Promise(resolve => setTimeout(resolve, 40));
  }
});
after(async () => {
  if (child && child.exitCode === null && !child.signalCode) await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
  assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
  fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('public widget config is exact, uncached and available to both allowed login hosts', async () => {
  for (const host of ['pre.manager.playctp.com', 'ruleta.playctp.com']) {
    const response = await request('GET', '/api/auth/config', undefined, { host });
    assert.equal(response.status, 200);
    assert.deepEqual(response.data, { provider: 'ctp', captcha: { required: true, siteKey } });
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['content-security-policy'], "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
    assert.equal(response.headers['x-frame-options'], 'DENY');
    assert.ok(!JSON.stringify(response.data).includes(anon) && !JSON.stringify(response.data).includes(key));
  }
  assert.equal((await request('GET', '/api/users', undefined, { host: 'ruleta.playctp.com' })).status, 404);
  assert.equal((await request('GET', '/api/auth/config', undefined, { host: 'untrusted.playctp.com' })).status, 403);
});

test('missing invalid and native-rejected CAPTCHA produce safe errors without issuing session cookies', async () => {
  for (const proof of [undefined, '', 'a'.repeat(2049), 'invalid-fixture', 'expired-fixture']) {
    const response = await request('POST', '/api/auth/login', { email: 'fixture@invalid.example', password: 'unused-fixture', ...(proof === undefined ? {} : { captchaToken: proof }) });
    assert.equal(response.status, 400);
    assert.deepEqual(response.data, { error: 'Completa de nuevo la verificación de seguridad.', code: 'captcha_failed' });
    assert.equal(response.headers['set-cookie'], undefined);
  }
});

test('one native-accepted fixture creates a secure session; replay rejects without altering it', async () => {
  const body = { email: 'fixture@invalid.example', password: 'unused-fixture', captchaToken: 'fixture-valid-once' };
  const signed = await request('POST', '/api/auth/login', body);
  assert.equal(signed.status, 200);
  assert.equal(signed.data.user.ctp_role, 'admin');
  assert.equal(signed.data.user.is_admin, true);
  const setCookie = signed.headers['set-cookie'][0];
  assert.match(setCookie, /^__Host-ctp_manager_session=/);
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(setCookie.includes(attribute));
  assert.ok(!JSON.stringify(signed.data).includes('fixture-access') && !JSON.stringify(signed.data).includes('fixture-valid-once'));
  const cookie = setCookie.split(';', 1)[0];
  const replay = await request('POST', '/api/auth/login', body, { cookie });
  assert.equal(replay.status, 400); assert.equal(replay.data.code, 'captcha_failed');
  assert.equal(replay.headers['set-cookie'], undefined);
  const status = await request('GET', '/api/auth/status', undefined, { cookie });
  assert.equal(status.status, 200); assert.equal(status.data.authenticated, true); assert.equal(status.data.user.ctp_role, 'admin');
});
