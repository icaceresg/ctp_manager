import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// Real route + synthetic staff auth/bridge. No hosted environment or shared DEV is contacted.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-player-live-route-'));
const origin = 'https://pre.manager.playctp.com';
Object.assign(process.env, { DATA_DIR: directory, DB_PATH: path.join(directory, 'fixture.sqlite'), PUBLIC_ORIGIN: origin,
  CTP_AUTH_MODE: 'ctp', CTP_AUTH_URL: 'https://pre.playctp.com', CTP_WEB_ORIGIN: 'https://pre.playctp.com',
  CTP_AUTH_TOKEN_KEY: crypto.randomBytes(32).toString('base64url'),
  CTP_AUTH_ANON_KEY: `e30.${Buffer.from('{"role":"anon","exp":4102444800}').toString('base64url')}.fixture`,
  CTP_OPERATIONS_URL: 'https://pre.playctp.com/functions/v1/manager-operations', CTP_OPERATIONS_TOKEN: 'player-live-fixture-transport-0123456789',
  CTP_SIGNING_SECRET: 'player-live-independent-signature-0123456789', CTP_ENABLE_WRITES: 'false', CTP_SYNC_SECONDS: '0' });
const accounts = Object.fromEntries(['admin', 'referee', 'operations', 'caster', 'production', 'clubs', 'communications'].map((kind, index) => [kind, {
  ctp_user_id: `91110000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, username: `QA ${kind}`,
  role: ['admin', 'referee'].includes(kind) ? kind : 'staff',
  ...(!['admin', 'referee'].includes(kind) ? { staff_kind: kind, scopes: ['staff.access'] } : { scopes: ['ranked.read', 'ranked.chat'] }),
}]));
const originalFetch = globalThis.fetch, tokens = new Map(), observed = [];
const player = '85550000-0000-4000-8000-000000000001';
let failUpstream = false;
globalThis.fetch = async (value, input) => {
  const url = new URL(value), body = JSON.parse(input.body);
  if (url.pathname === '/auth/v1/token') {
    const account = accounts[body.email.split('@')[0]]; assert.ok(account);
    const token = crypto.randomUUID(); tokens.set(token, account);
    return Response.json({ user: { id: account.ctp_user_id }, access_token: token, refresh_token: `fixture:${account.ctp_user_id}`, expires_in: 3600 });
  }
  if (url.pathname === '/rest/v1/rpc/manager_link_own_identity') {
    const account = tokens.get(input.headers.Authorization?.replace('Bearer ', '')); assert.ok(account);
    return Response.json({ ...account, actor_id: `ctp:${account.ctp_user_id}` });
  }
  assert.equal(url.pathname, '/functions/v1/manager-operations');
  assert.deepEqual(body, { action: 'admin_service', actor_id: body.actor_id, service: 'player_live', payload: { action: 'read' } });
  assert.ok(Object.keys(input.headers).some(name => /signature/i.test(name)));
  observed.push(body);
  if (failUpstream) return Response.json({ error: 'private-provider-fixture-detail' }, { status: 503 });
  return Response.json({ ok: true, data: { schema_version: 1, status: 'ready', checked_at: new Date().toISOString(), fresh_for_seconds: 90,
    streams: [{ user_id: player, channel: 'ctp_fixture', access_token: 'private-provider-fixture-token' }], access_token: 'private-provider-fixture-token' } });
};
const auth = await import('../server/auth.js');
const { db } = await import('../server/db.js');
const { requestBoundary } = await import('../server/config.js');
const { integrationRouter } = await import('../server/routes/integration.js');
const app = express();
app.use((req, res, next) => { const failure = requestBoundary(req); return failure ? res.status(403).json({ error: failure }) : next(); });
app.use(express.json()); app.use('/api', integrationRouter);
app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.status ? error.message : 'Error interno.' }));
const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
after(async () => { await new Promise(resolve => server.close(resolve)); globalThis.fetch = originalFetch; db.close(); fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5 }); });
const cookies = {};
async function cookie(kind) {
  if (!cookies[kind]) await auth.loginCtp(`${kind}@example.invalid`, 'fixture-password', { cookie(name, value) { cookies[kind] = `${name}=${value}`; } });
  return cookies[kind];
}
function api(session = '', extra = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/api/operations/player-live', method: 'GET',
      headers: { Host: 'pre.manager.playctp.com', Origin: origin, 'Sec-Fetch-Site': 'same-origin', Cookie: session, ...extra } }, response => {
      let data = ''; response.on('data', chunk => { data += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, data: JSON.parse(data) }));
    }); req.on('error', reject); req.end();
  });
}

test('authenticated staff roster access, no cross-origin access and no provider secrets reach HTTP', async () => {
  assert.equal((await api()).status, 401); assert.equal(observed.length, 0);
  const denied = await api(await cookie('communications'));
  assert.equal(denied.status, 403); assert.equal(observed.length, 0);
  for (const kind of ['admin', 'referee', 'operations', 'caster', 'production', 'clubs']) {
    const session = await cookie(kind), first = await api(session), second = await api(session);
    assert.equal(first.status, 200); assert.equal(first.headers['cache-control'], 'no-store');
    assert.equal(first.data.status, 'ready'); assert.deepEqual(first.data.streams, [{ user_id: player, channel: 'ctp_fixture' }]);
    assert.deepEqual(second.data, first.data); assert.ok(!JSON.stringify(first.data).includes('private-provider'));
  }
  assert.equal(observed.length, 6, 'one read per actor, cache shared by all their open roster views');
  assert.equal((await api(await cookie('admin'), { Origin: 'https://other.example.invalid', 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal(observed.length, 6);
});

test('upstream outage hides LIVE while allowing the roster UI to continue', async () => {
  // A new synthetic actor avoids the already-successful actor caches above.
  accounts.clubs.ctp_user_id = '91110000-0000-4000-8000-000000000099'; delete cookies.clubs;
  failUpstream = true;
  const response = await api(await cookie('clubs'));
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, { schema_version: 1, status: 'unavailable', checked_at: null, fresh_for_seconds: 90, streams: [] });
  assert.ok(!JSON.stringify(response.data).includes('private-provider'));
});
