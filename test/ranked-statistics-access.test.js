import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { statisticsFixture } from './fixtures/ranked-statistics.js';
import { canManageRanked, canReadRankedStatistics } from '../shared/access.js';

// Isolated synthetic CTP: all remote requests are intercepted, only the test
// HTTP server and a temporary SQLite database are used.
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-statistics-reader-'));
const ids = Object.fromEntries(['admin', 'coord', 'reader', 'caster', 'ref'].map((name, index) => [name, `24000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]));
const roles = new Map([[ids.admin, 'admin'], [ids.coord, 'operations'], [ids.reader, 'executive'], [ids.caster, 'caster'], [ids.ref, 'referee']]);
const grants = new Set(), sessions = new Map(), observed = [], overrides = new Map();
const signing = 'statistics-reader-signing-fixture-independent-0123456789';
const bridgeToken = 'statistics-reader-transport-fixture-independent-0123456789';
let confirmed = true, raceRevoke = false, malformedReceipt = false;
Object.assign(process.env, {
  DATA_DIR: temporary, DB_PATH: path.join(temporary, 'reader.db'), PUBLIC_ORIGIN: 'https://pre.manager.playctp.com',
  CTP_AUTH_MODE: 'ctp', CTP_AUTH_URL: 'https://pre.playctp.com', CTP_WEB_ORIGIN: 'https://pre.playctp.com',
  CTP_AUTH_TOKEN_KEY: crypto.randomBytes(32).toString('base64url'),
  CTP_AUTH_ANON_KEY: `e30.${Buffer.from('{"role":"anon","exp":4102444800}').toString('base64url')}.fixture`,
  CTP_OPERATIONS_URL: 'https://pre.playctp.com/functions/v1/manager-operations', CTP_OPERATIONS_TOKEN: bridgeToken,
  CTP_SIGNING_SECRET: signing, CTP_ENABLE_WRITES: 'true', CTP_SYNC_SECONDS: '0',
});
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  assert.equal(new URL(url).origin, 'https://pre.playctp.com');
  const body = JSON.parse(init.body);
  if (url.includes('grant_type=password')) {
    const id = ids[body.email.split('@')[0]], access = crypto.randomUUID(); sessions.set(access, id);
    return Response.json({ user: { id }, access_token: access, refresh_token: `fixture:${id}`, expires_in: 3600 });
  }
  if (url.includes('/rpc/manager_link_own_identity')) {
    const id = sessions.get(init.headers.Authorization.replace('Bearer ', '')), kind = roles.get(id);
    if (!kind) return Response.json({}, { status: 403 });
    const staff = !['admin', 'referee'].includes(kind);
    return Response.json({ ctp_user_id: id, username: 'Fixture staff', actor_id: `ctp:${id}`, role: staff ? 'staff' : kind,
      ...(staff ? { staff_kind: kind } : {}), scopes: overrides.get(id) || (staff
        ? ['staff.access', ...(grants.has(id) ? ['ranked.statistics.read'] : [])] : ['ranked.read']) });
  }
  assert.equal(url, process.env.CTP_OPERATIONS_URL);
  assert.equal(init.headers.Authorization, `Bearer ${bridgeToken}`);
  const signed = signManagerRequest(init.body, signing, { timestamp: Number(init.headers['X-CTP-Timestamp']), nonce: init.headers['X-CTP-Nonce'] });
  assert.equal(init.headers['X-CTP-Signature'], signed['X-CTP-Signature']);
  observed.push(body);
  const actor = body.actor_id.replace('ctp:', '');
  if (body.action === 'ranked_statistics') {
    if (raceRevoke || !['admin', 'referee'].includes(roles.get(actor)) && !grants.has(actor)) return Response.json({}, { status: 403 });
    return Response.json({ ok: true, data: statisticsFixture(body.period) });
  }
  assert.equal(body.action, 'ranked_statistics_access_set');
  assert.deepEqual(Object.keys(body).sort(), ['action', 'actor_id', 'enabled', 'user_id']);
  if (!['admin', 'operations'].includes(roles.get(actor))) return Response.json({}, { status: 403 });
  if (body.enabled && (!confirmed || !roles.get(body.user_id) || ['admin', 'referee'].includes(roles.get(body.user_id)))) return Response.json({}, { status: 403 });
  const previous = grants.has(body.user_id);
  if (body.enabled) grants.add(body.user_id); else grants.delete(body.user_id);
  return Response.json({ ok: true, data: { id: malformedReceipt ? ids.admin : body.user_id, enabled: body.enabled,
    changed: previous !== body.enabled, updated_at: !previous && !body.enabled ? null : '2026-10-29T12:00:00Z', extra_secret: 'private-fixture' } });
};
const auth = await import('../server/auth.js');
const { db } = await import('../server/db.js');
const { integrationRouter } = await import('../server/routes/integration.js');
const { adminRouter } = await import('../server/routes/admin.js');
const { signManagerRequest } = await import('../server/bridge-signature.js');
const { getRankedStatistics, setRankedStatisticsAccess } = await import('../server/integration.js');
const { rankedStatisticsAccessPayload, rankedStatisticsAccessResponse, staffDirectoryResponse, staffDirectoryQuery } = await import('../server/staff-access-contract.js');
const app = express(); app.use(express.json()); app.use('/api', integrationRouter, adminRouter);
app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.message }));
const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
after(async () => {
  await new Promise(resolve => server.close(resolve)); globalThis.fetch = originalFetch; db.close();
  assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temporary).startsWith('ctp-statistics-reader-'));
  fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5 });
});
async function signIn(name) {
  let cookie;
  const user = await auth.loginCtp(`${name}@example.invalid`, 'fixture-password', { cookie(key, value) { cookie = `${key}=${value}`; } });
  return { user, cookie, request: () => ({ headers: { cookie } }) };
}
async function api(session, method, route, body) {
  const response = await originalFetch(`http://127.0.0.1:${server.address().port}/api${route}`, { method,
    headers: { Cookie: session?.cookie || '', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json() };
}

test('individual scope grants statistics without any general Ranked authority', async () => {
  const ungranted = await signIn('reader');
  assert.equal(canReadRankedStatistics(ungranted.user), false);
  let before = observed.length;
  assert.equal((await api(ungranted, 'GET', '/operations/ranked/statistics')).status, 403);
  assert.equal(observed.length, before);
  grants.add(ids.reader);
  const granted = await auth.currentUser(ungranted.request());
  assert.deepEqual(granted.ctp_scopes, ['staff.access', 'ranked.statistics.read']);
  assert.equal(canReadRankedStatistics(granted), true);
  assert.equal(canManageRanked(granted), false); assert.equal(granted.is_admin, false); assert.equal(granted.ctp_role, 'staff');
  assert.equal((await api(ungranted, 'GET', '/operations/ranked/statistics?period=7d')).status, 200);
  assert.deepEqual(observed.at(-1), { action: 'ranked_statistics', actor_id: `ctp:${ids.reader}`, period: '7d' });
  before = observed.length;
  for (const query of ['?actor_id=forged', '?period=7d&from=2026-01-01', '?period=365d', '?period=7d&period=30d'])
    assert.equal((await api(ungranted, 'GET', `/operations/ranked/statistics${query}`)).status, 400, query);
  assert.equal(observed.length, before);
  for (const [method, route, body] of [['GET', '/operations/ranked/monitor'], ['GET', '/players'],
    ['GET', `/operations/ranked/lobbies/${ids.reader}`], ['POST', `/operations/ranked/lobbies/${ids.reader}/chat`, {}],
    ['POST', `/operations/ranked/lobbies/${ids.reader}/decision`, {}], ['POST', `/operations/ranked/lobbies/${ids.reader}/ban`, {}],
    ['POST', '/operations/ranked/commands', {}], ['GET', '/staff-access']]) {
    assert.equal((await api(ungranted, method, route, body)).status, 403, route);
  }
  assert.equal(observed.length, before);
  await assert.rejects(getRankedStatistics({ ...granted, auth_mode: 'local' }, '7d'), { status: 403 });
  assert.equal(canReadRankedStatistics({ ...granted, auth_mode: 'local' }), false);
  for (const ctp_scopes of [undefined, [], ['ranked.statistics.read'], ['staff.access', 'staff.access'], ['staff.access', 'ranked.statistics.read', 'ranked.read']])
    assert.equal(canReadRankedStatistics({ ...granted, ctp_scopes }), false);
});

test('central revocation replaces the mirror and defeats persisted forged grants on the next request', async () => {
  grants.add(ids.reader); const signed = await signIn('reader');
  assert.equal(db.prepare('SELECT ctp_ranked_statistics_read FROM users WHERE id=?').get(signed.user.id).ctp_ranked_statistics_read, 1);
  grants.delete(ids.reader);
  db.prepare('UPDATE users SET ctp_ranked_statistics_read=1,is_admin=1 WHERE id=?').run(signed.user.id);
  const current = await auth.currentUser(signed.request());
  assert.deepEqual(current.ctp_scopes, ['staff.access']); assert.equal(current.is_admin, false);
  assert.equal(db.prepare('SELECT ctp_ranked_statistics_read FROM users WHERE id=?').get(signed.user.id).ctp_ranked_statistics_read, 0);
  assert.equal((await api(signed, 'GET', '/operations/ranked/statistics')).status, 403);
  grants.add(ids.reader); raceRevoke = true;
  try { assert.equal((await api(signed, 'GET', '/operations/ranked/statistics')).status, 403); }
  finally { raceRevoke = false; grants.delete(ids.reader); }
  overrides.set(ids.reader, ['staff.access', 'ranked.statistics.read', 'ranked.read']);
  try {
    assert.equal(await auth.currentUser(signed.request()), null);
    assert.equal(db.prepare('SELECT ctp_ranked_statistics_read FROM users WHERE id=?').get(signed.user.id).ctp_ranked_statistics_read, 0);
    assert.equal(db.prepare('SELECT 1 FROM sessions WHERE token=?').get(signed.cookie.split('=')[1]), undefined);
  } finally { overrides.delete(ids.reader); }
});

test('grant management is separate from roles, strict and bound to current administrator or coordinator', async () => {
  const coordinator = await signIn('coord'), admin = await signIn('admin'), caster = await signIn('caster');
  const route = `/staff-access/${ids.reader}/ranked-statistics`, originalRole = roles.get(ids.reader);
  let before = observed.length;
  assert.equal((await api(null, 'PATCH', route, { enabled: true })).status, 401);
  assert.equal((await api(caster, 'PATCH', route, { enabled: true })).status, 403);
  await assert.rejects(setRankedStatisticsAccess(caster.user, ids.reader, { enabled: true }), { status: 403 });
  for (const body of [{}, { enabled: 'true' }, { enabled: true, staff_kind: 'referee' }, { enabled: true, actor_id: `ctp:${ids.admin}` }])
    assert.equal((await api(coordinator, 'PATCH', route, body)).status, 400);
  assert.equal((await api(coordinator, 'PATCH', `${route}?actor_id=forged`, { enabled: true })).status, 400);
  assert.equal(observed.length, before);
  const enabled = await api(coordinator, 'PATCH', route, { enabled: true });
  assert.equal(enabled.status, 200); assert.equal(enabled.data.enabled, true); assert.equal(enabled.data.changed, true);
  assert.equal(JSON.stringify(enabled).includes('private-fixture'), false);
  assert.deepEqual(observed.at(-1), { action: 'ranked_statistics_access_set', actor_id: `ctp:${ids.coord}`, user_id: ids.reader, enabled: true });
  assert.equal(roles.get(ids.reader), originalRole);
  assert.equal((await api(admin, 'PATCH', route, { enabled: false })).status, 200);
  const repeated = await api(admin, 'PATCH', route, { enabled: false });
  assert.equal(repeated.status, 200); assert.deepEqual(repeated.data, { id: ids.reader, enabled: false, changed: false, updated_at: null });
  confirmed = false;
  try { assert.equal((await api(coordinator, 'PATCH', route, { enabled: true })).status, 403); }
  finally { confirmed = true; }
  assert.equal((await api(coordinator, 'PATCH', `/staff-access/${ids.admin}/ranked-statistics`, { enabled: true })).status, 403);
  malformedReceipt = true;
  try { assert.equal((await api(coordinator, 'PATCH', route, { enabled: false })).status, 502); }
  finally { malformedReceipt = false; }
});

test('old directory defaults to no statistics access and malformed values or mismatched receipts fail closed', () => {
  const row = { id: ids.reader, username: 'Fixture reader', role: 'player', staff_kind: 'executive', staff_enabled: true,
    staff_updated_at: null, email_confirmed: true };
  const query = staffDirectoryQuery({});
  const project = value => staffDirectoryResponse({ items: [value], total: 1, offset: 0, limit: 25 }, query).items[0];
  assert.equal(project(row).ranked_statistics_enabled, false);
  assert.equal(project({ ...row, ranked_statistics_enabled: true }).ranked_statistics_enabled, true);
  for (const ranked_statistics_enabled of ['true', null, 1]) assert.throws(() => project({ ...row, ranked_statistics_enabled }), { status: 502 });
  assert.throws(() => rankedStatisticsAccessPayload('invalid', { enabled: true }), { status: 400 });
  const payload = rankedStatisticsAccessPayload(ids.reader, { enabled: false });
  for (const value of [{ id: ids.admin, enabled: false, changed: true, updated_at: null },
    { id: ids.reader, enabled: true, changed: true, updated_at: null },
    { id: ids.reader, enabled: false, changed: true, updated_at: 42 }]) assert.throws(() => rankedStatisticsAccessResponse(value, payload), { status: 502 });
});

test('existing admin and referee remain statistics readers without individual grants', async () => {
  for (const name of ['admin', 'ref']) {
    const signed = await signIn(name); assert.equal(canManageRanked(signed.user), true); assert.equal(canReadRankedStatistics(signed.user), true);
    assert.equal((await api(signed, 'GET', '/operations/ranked/statistics')).status, 200);
  }
});
