import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-staff-access-'));
const admin = '20000000-0000-4000-8000-000000000001';
const coordinator = '20000000-0000-4000-8000-000000000002';
const caster = '20000000-0000-4000-8000-000000000003';
const target = '20000000-0000-4000-8000-000000000004';
const bridgeToken = 'fixture-staff-bridge-token-independent-0123456789';
const bridgeSigning = 'fixture-staff-signing-key-independent-0123456789';
Object.assign(process.env, {
  DATA_DIR: temporary, DB_PATH: path.join(temporary, 'staff.db'), PUBLIC_ORIGIN: 'https://manager.playctp.com',
  CTP_AUTH_MODE: 'ctp', CTP_AUTH_URL: 'https://pre.playctp.com', CTP_WEB_ORIGIN: 'https://pre.playctp.com',
  CTP_AUTH_TOKEN_KEY: crypto.randomBytes(32).toString('base64url'),
  CTP_AUTH_ANON_KEY: `e30.${Buffer.from('{"role":"anon","exp":4102444800}').toString('base64url')}.fixture`,
  CTP_OPERATIONS_URL: 'https://pre.playctp.com/functions/v1/manager-operations', CTP_OPERATIONS_TOKEN: bridgeToken,
  CTP_SIGNING_SECRET: bridgeSigning, CTP_ENABLE_WRITES: 'true', CTP_SYNC_SECONDS: '0',
});
const originalFetch = globalThis.fetch;
const roles = new Map([[admin, 'admin'], [coordinator, 'operations'], [caster, 'caster'], [target, null]]);
const grants = new Map();
const observed = [];
let targetConfirmed = false;
const row = id => ({
  id, username: id === admin ? 'Protected Admin' : id === coordinator ? 'Coordinator' : id === caster ? 'Caster' : 'Registered player',
  avatar: null, role: roles.get(id) === 'admin' ? 'admin' : roles.get(id) === 'referee' ? 'referee' : 'player',
  staff_kind: grants.get(id) ?? null, staff_enabled: grants.has(id), staff_updated_at: grants.has(id) ? '2026-10-20T12:00:00Z' : null,
  email_confirmed: id !== target || targetConfirmed,
  // The email is shown on purpose; an accidental extra field such as a token must never reach this browser API.
  email: id === target ? 'player@example.invalid' : 'staff@example.invalid', access_token: 'fixture-private-provider-token',
});
globalThis.fetch = async (url, init) => {
  assert.equal(new URL(url).origin, 'https://pre.playctp.com');
  const body = JSON.parse(init.body);
  if (url.includes('grant_type=password')) {
    const id = body.email.startsWith('admin') ? admin : body.email.startsWith('coord') ? coordinator : caster;
    return Response.json({ user: { id }, access_token: `access:${id}`, refresh_token: `refresh:${id}`, expires_in: 3600 });
  }
  if (url.includes('/rpc/manager_link_own_identity')) {
    const id = init.headers.Authorization.replace('Bearer access:', '');
    const kind = roles.get(id);
    if (!kind) return Response.json({}, { status: 403 });
    return Response.json({ ctp_user_id: id, username: row(id).username, actor_id: `ctp:${id}`,
      role: kind === 'admin' || kind === 'referee' ? kind : 'staff',
      ...(kind === 'admin' || kind === 'referee' ? {} : { staff_kind: kind }),
      scopes: kind === 'admin' ? ['admin.console'] : kind === 'referee' ? ['incident.reply'] : ['staff.access'] });
  }
  assert.equal(url, process.env.CTP_OPERATIONS_URL);
  assert.equal(init.headers.Authorization, `Bearer ${bridgeToken}`);
  assert.equal(body.action, 'admin_service');
  assert.equal(body.service, 'staff');
  observed.push(body);
  const actor = body.actor_id.replace('ctp:', '');
  if (!['admin', 'operations'].includes(roles.get(actor))) return Response.json({}, { status: 403 });
  if (body.payload.action === 'list') {
    const { offset, limit } = body.payload;
    return Response.json({ ok: true, data: { items: [row(admin), row(target)], total: 2, offset, limit } });
  }
  if (body.payload.user_id === admin) return Response.json({ secret: 'fixture-private' }, { status: 403 });
  const { user_id, staff_kind, enabled } = body.payload;
  roles.set(user_id, enabled ? staff_kind : null);
  if (enabled) grants.set(user_id, staff_kind); else grants.delete(user_id);
  return Response.json({ ok: true, data: { id: user_id, staff_kind: enabled ? staff_kind : null,
    enabled, changed: true, updated_at: '2026-10-20T12:00:00Z' } });
};
const auth = await import('../server/auth.js');
const { db } = await import('../server/db.js');
const { adminRouter } = await import('../server/routes/admin.js');
const { getAdministrationService } = await import('../server/integration.js');
const { STAFF_KINDS } = await import('../shared/access.js');
const { staffDirectoryQuery, staffAccessPayload, staffDirectoryResponse, staffAccessResponse } = await import('../server/staff-access-contract.js');
let server, port;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', adminRouter);
  app.use((error, request, response, next) => response.status(error.status || 500).json({ error: error.message }));
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  globalThis.fetch = originalFetch;
  db.close();
  assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temporary).startsWith('ctp-staff-access-'));
  fs.rmSync(temporary, { recursive: true, force: true });
});
async function signIn(prefix) {
  let cookie;
  const user = await auth.loginCtp(`${prefix}@example.invalid`, 'central-test-password', { cookie(name, value) { cookie = `${name}=${value}`; } });
  return { user, cookie };
}
async function api(session, method, route, body) {
  const response = await originalFetch(`http://127.0.0.1:${port}/api${route}`, { method,
    headers: { Cookie: session?.cookie || '', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json() };
}

test('staff management inputs reject unbounded queries, administrator assignments and actor injection', () => {
  assert.deepEqual(staffDirectoryQuery({ query: '  Mau ', offset: '25', limit: '25' }), { action: 'list', query: 'Mau', offset: 25, limit: 25 });
  for (const query of [{ limit: 101 }, { limit: 0 }, { offset: -1 }, { offset: '1.5' }, { query: ['x'] }, { query: 'x'.repeat(121) }, { actor_id: `ctp:${admin}` }]) assert.throws(() => staffDirectoryQuery(query), { status: 400 });
  for (const body of [{ staff_kind: 'admin', enabled: true }, { staff_kind: null, enabled: true }, { staff_kind: 'caster', enabled: 'true' }, { staff_kind: 'caster', enabled: true, actor_id: `ctp:${admin}` }, { role: 'admin', enabled: true }]) assert.throws(() => staffAccessPayload(target, body), { status: 400 });
  assert.throws(() => staffAccessPayload('../admin', { staff_kind: 'caster', enabled: true }), { status: 400 });
});

test('directory and acknowledgements expose only validated bounded fields', () => {
  const query = staffDirectoryQuery({});
  const result = staffDirectoryResponse({ items: [row(target)], total: 1, offset: 0, limit: 25 }, query);
  assert.equal(result.items[0].email_confirmed, false);
  // The account email is shown to staff managers (CTP migration 220); other private bridge fields are not.
  assert.equal(result.items[0].email, 'player@example.invalid');
  assert.equal(JSON.stringify(result).includes('access_token'), false);
  for (const value of [
    { items: [row(target), row(target)], total: 2, offset: 0, limit: 25 },
    { items: [{ ...row(target), staff_kind: 'admin' }], total: 1, offset: 0, limit: 25 },
    { items: [{ ...row(target), email_confirmed: undefined }], total: 1, offset: 0, limit: 25 },
    { items: [{ ...row(target), email: 42 }], total: 1, offset: 0, limit: 25 },
    { items: [{ ...row(target), email: `${'x'.repeat(320)}@example.invalid` }], total: 1, offset: 0, limit: 25 },
    { items: Array(26).fill(row(target)), total: 26, offset: 0, limit: 25 },
    { items: [], total: 0, offset: 25, limit: 25 },
  ]) assert.throws(() => staffDirectoryResponse(value, query), { status: 502 });
  const payload = staffAccessPayload(target, { staff_kind: 'caster', enabled: true });
  for (const value of [
    { id: admin, staff_kind: 'caster', enabled: true, changed: true, updated_at: 'now' },
    { id: target, staff_kind: 'operations', enabled: true, changed: true, updated_at: 'now' },
    { id: target, staff_kind: 'caster', enabled: false, changed: true, updated_at: 'now' },
  ]) assert.throws(() => staffAccessResponse(value, payload), { status: 502 });
  const revoke = staffAccessPayload(target, { staff_kind: null, enabled: false });
  assert.deepEqual(staffAccessResponse({ id: target, staff_kind: null, enabled: false, changed: false, updated_at: null }, revoke),
    { id: target, staff_kind: null, enabled: false, changed: false, updated_at: null });
});

test('coordinator lists registered accounts and assigns every non-admin role through a session-bound actor', async () => {
  const session = await signIn('coord');
  assert.equal(session.user.is_admin, false);
  const directory = await api(session, 'GET', '/staff-access?query=Mau&offset=0&limit=25');
  assert.equal(directory.status, 200);
  assert.deepEqual(directory.data.items.map(item => item.id), [admin, target]);
  assert.equal(directory.data.items[1].email_confirmed, false);
  assert.equal(directory.data.items[1].email, 'player@example.invalid');
  assert.equal(JSON.stringify(directory).includes('fixture-private-provider-token'), false);
  assert.equal(observed.at(-1).actor_id, `ctp:${coordinator}`);
  for (const kind of STAFF_KINDS.map(item => item.id)) {
    const changed = await api(session, 'PATCH', `/staff-access/${target}`, { staff_kind: kind, enabled: true });
    assert.equal(changed.status, 200, kind);
    assert.equal(changed.data.staff_kind, kind);
    assert.equal(observed.at(-1).actor_id, `ctp:${coordinator}`);
  }
  assert.equal((await api(session, 'PATCH', `/staff-access/${target}`, { staff_kind: null, enabled: false })).status, 200);
  assert.equal(roles.get(target), null);
});

test('delegation cannot edit administrators or reach local user roles and general administration', async () => {
  const session = await signIn('coord');
  assert.equal((await api(session, 'PATCH', `/staff-access/${admin}`, { staff_kind: 'caster', enabled: true })).status, 403);
  assert.equal(roles.get(admin), 'admin');
  for (const route of ['/users', '/roles']) assert.equal((await api(session, 'GET', route)).status, 403);
  await assert.rejects(getAdministrationService(session.user, 'crm', { action: 'contacts' }), { status: 403 });
  const before = observed.length;
  assert.equal((await api(session, 'PATCH', `/staff-access/${target}`, { staff_kind: 'admin', enabled: true })).status, 400);
  assert.equal((await api(session, 'PATCH', `/staff-access/${target}`, { staff_kind: 'caster', enabled: true, actor_id: `ctp:${admin}` })).status, 400);
  assert.equal(observed.length, before);
});

test('caster and revoked coordination are denied before any staff bridge request', async () => {
  const session = await signIn('caster');
  const before = observed.length;
  assert.equal((await api(session, 'GET', '/staff-access')).status, 403);
  assert.equal((await api(session, 'PATCH', `/staff-access/${target}`, { staff_kind: 'operations', enabled: true })).status, 403);
  assert.equal((await api(null, 'GET', '/staff-access')).status, 401);
  const coordinated = await signIn('coord');
  roles.set(coordinator, 'caster');
  try {
    assert.equal((await api(coordinated, 'GET', '/staff-access')).status, 403);
    roles.set(coordinator, null);
    assert.equal((await api(coordinated, 'GET', '/staff-access')).status, 401);
    assert.equal(db.prepare('SELECT count(*) n FROM sessions WHERE token=?').get(coordinated.cookie.split('=')[1]).n, 0);
    assert.equal(observed.length, before);
  } finally { roles.set(coordinator, 'operations'); }
});

test('central administrators use the same staff directory without an administrator assignment option', async () => {
  const session = await signIn('admin');
  assert.equal((await api(session, 'GET', '/staff-access')).status, 200);
  assert.equal(observed.at(-1).actor_id, `ctp:${admin}`);
  assert.equal((await api(session, 'PATCH', `/staff-access/${admin}`, { staff_kind: null, enabled: false })).status, 403);
  assert.equal(roles.get(admin), 'admin');
});

test('the roulette tags everyone with Manager access and follows staff changes at once', async () => {
  const { listParticipants } = await import('../server/ruleta.js');
  const coordination = await signIn('coord');
  const person = async (id) => (await listParticipants()).people.find(item => item.key === id);
  targetConfirmed = true;
  try {
    // Nobody presses anything: the first read loads the list with a stored admin identity.
    await listParticipants();
    assert.equal(observed.at(-1).actor_id, `ctp:${admin}`);
    assert.equal((await person(admin)).role, 'admin');
    assert.deepEqual(await person(target), { key: target, name: 'Registered player', role: 'player' });
    assert.equal((await api(coordination, 'PATCH', `/staff-access/${target}`, { staff_kind: 'caster', enabled: true })).status, 200);
    assert.deepEqual(await person(target), { key: target, name: 'Registered player', role: 'staff', staff_kind: 'caster' });
    assert.equal((await api(coordination, 'PATCH', `/staff-access/${target}`, { staff_kind: 'referee', enabled: true })).status, 200);
    assert.equal((await person(target)).role, 'referee');
    assert.equal((await api(coordination, 'PATCH', `/staff-access/${target}`, { staff_kind: null, enabled: false })).status, 200);
    assert.equal((await person(target)).role, 'player');
    // Deactivating someone in Manager removes their access, so the tag goes too.
    db.prepare('UPDATE users SET active=0 WHERE ctp_user_id=?').run(admin);
    assert.equal((await person(admin)).role, 'player');
    // Without an active administrator, coordination's identity keeps the list loading by itself.
    db.prepare("DELETE FROM settings WHERE key='ruleta_refreshed_at'").run();
    await listParticipants();
    assert.equal(observed.at(-1).actor_id, `ctp:${coordinator}`);
  } finally {
    db.prepare('UPDATE users SET active=1 WHERE ctp_user_id=?').run(admin);
    targetConfirmed = false;
  }
});
