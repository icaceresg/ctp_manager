import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encryptTokens, decryptTokens } from '../server/ctp-auth.js';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-shared-session-'));
const key = crypto.randomBytes(32);
const admin = '10000000-0000-4000-8000-000000000001', referee = '10000000-0000-4000-8000-000000000002', player = '10000000-0000-4000-8000-000000000003';
const caster = '10000000-0000-4000-8000-000000000004';
const coordinator = '10000000-0000-4000-8000-000000000005';
Object.assign(process.env, { DATA_DIR: temporary, DB_PATH: path.join(temporary, 'session.db'), CTP_AUTH_MODE: 'ctp',
  CTP_AUTH_URL: 'https://pre.playctp.com', CTP_WEB_ORIGIN: 'https://pre.playctp.com', CTP_AUTH_TOKEN_KEY: key.toString('base64url'),
  CTP_AUTH_ANON_KEY: `e30.${Buffer.from('{"role":"anon","exp":4102444800}').toString('base64url')}.fixture`,
  CTP_OPERATIONS_URL: 'https://pre.playctp.com/functions/v1/manager-operations' });
const roles = new Map([[admin, 'admin'], [referee, 'referee'], [player, 'player'], [caster, 'caster'], [coordinator, 'operations']]);
const sessions = new Map();
let unavailable = false, refreshed = 0, heldLogin = null, heldLoginRequests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (unavailable) return Response.json({}, { status: 503 });
  const body = JSON.parse(init.body);
  if (url.includes('grant_type=password')) {
    if (heldLogin) { heldLoginRequests++; await heldLogin; return Response.json({}, { status: 401 }); }
    if (body.password !== 'central-test-password') return Response.json({}, { status: 401 });
    const id = body.email.startsWith('admin') ? admin : body.email.startsWith('ref') ? referee : body.email.startsWith('caster') ? caster : body.email.startsWith('coord') ? coordinator : player;
    const access = `access-${crypto.randomUUID()}`; sessions.set(access, id);
    return Response.json({ user: { id }, access_token: access, refresh_token: `refresh:${id}`, expires_in: 3600 });
  }
  if (url.includes('grant_type=refresh_token')) {
    refreshed++;
    await new Promise(resolve => setTimeout(resolve, 20));
    const id = body.refresh_token.slice('refresh:'.length);
    const access = `rotated-${crypto.randomUUID()}`; sessions.set(access, id);
    return Response.json({ user: { id }, access_token: access, refresh_token: `refresh:${id}`, expires_in: 3600 });
  }
  const id = sessions.get(init.headers.Authorization?.replace('Bearer ', ''));
  if (!id || roles.get(id) === 'player') return Response.json({}, { status: 403 });
  const staff = ['operations', 'production', 'caster', 'communications', 'clubs', 'executive'].includes(roles.get(id));
  return Response.json({ ctp_user_id: id, username: id === admin ? 'CTP Admin' : id === caster ? 'CTP Caster' : 'CTP Referee',
    role: staff ? 'staff' : roles.get(id), ...(staff ? { staff_kind: roles.get(id) } : {}), actor_id: `ctp:${id}`, scopes: staff ? ['staff.access'] : ['incident.reply'] });
};
const auth = await import('../server/auth.js');
const users = await import('../server/users.js');
const { db } = await import('../server/db.js');
const { SECTION_IDS, STAFF_SECTION_CAPS, canManageStaff } = await import('../shared/access.js');
after(() => {
  globalThis.fetch = originalFetch;
  db.close();
  const resolved = path.resolve(temporary);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('ctp-shared-session-'));
  fs.rmSync(resolved, { recursive: true, force: true });
});
async function signIn(email = 'admin@example.invalid') {
  let token;
  const user = await auth.loginCtp(email, 'central-test-password', { cookie(name, value) { assert.equal(name, 'mrm_session'); token = value; } });
  return { user, token, request: () => ({ headers: { cookie: `mrm_session=${token}` } }) };
}

test('same CTP identity is mirrored without storing a password or exposing provider credentials', async () => {
  const first = await signIn(), second = await signIn();
  assert.equal(first.user.id, second.user.id);
  assert.equal(first.user.ctp_user_id, admin);
  assert.equal(first.user.is_admin, true);
  assert.equal(db.prepare('SELECT count(*) AS n FROM users WHERE ctp_user_id=?').get(admin).n, 1);
  assert.equal(db.prepare('SELECT password_hash FROM users WHERE id=?').get(first.user.id).password_hash, '!ctp-auth-only');
  assert.equal(db.prepare('SELECT external_id FROM operation_operator_identities WHERE user_id=?').get(first.user.id).external_id, `ctp:${admin}`);
  const stored = db.prepare('SELECT ctp_tokens FROM sessions WHERE token=?').get(first.token).ctp_tokens;
  assert.equal(stored.includes('access-'), false);
  assert.equal(stored.includes('refresh:'), false);
  assert.equal(JSON.stringify(first.user).includes('accessToken'), false);
  assert.equal((await auth.currentUser(first.request())).is_admin, true);
});

test('player, local bootstrap, local passwords and local administrator promotion are rejected', async () => {
  const before = db.prepare('SELECT count(*) AS n FROM users').get().n;
  await assert.rejects(signIn('player@example.invalid'), error => error.status === 403);
  assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, before);
  assert.throws(() => auth.setupAdmin({ username: 'local', password: 'local-password' }), error => error.status === 403);
  assert.throws(() => auth.login('local', 'local-password'), error => error.status === 403);
  assert.throws(() => auth.changeOwnPassword(1, 'x', 'y'), error => error.status === 403);
  assert.throws(() => users.createUser({ username: 'extra', password: 'local-password' }), error => error.status === 403);
  const ref = await signIn('ref@example.invalid');
  assert.equal(ref.user.is_admin, false);
  assert.ok(ref.user.sections.includes('arbitraje'));
  assert.throws(() => users.updateUser(ref.user.id, { is_admin: true }, ref.user.id), error => error.status === 403);
});

test('explicit CTP caster signs in with one linked identity, editorial access and encrypted credentials', async () => {
  const first = await signIn('caster@example.invalid'), second = await signIn('caster@example.invalid');
  assert.equal(first.user.id, second.user.id);
  assert.equal(first.user.ctp_user_id, caster);
  assert.equal(first.user.ctp_role, 'staff');
  assert.equal(first.user.staff_kind, 'caster');
  assert.equal(first.user.is_admin, false);
  assert.deepEqual(first.user.sections, ['escaleta', 'disponibilidad', 'casters']);
  assert.deepEqual(first.user.roles.map(role => role.staff_kind), ['caster']);
  assert.equal(db.prepare('SELECT count(*) n FROM users WHERE ctp_user_id=?').get(caster).n, 1);
  assert.equal(db.prepare('SELECT password_hash FROM users WHERE id=?').get(first.user.id).password_hash, '!ctp-auth-only');
  assert.equal(db.prepare('SELECT external_id FROM operation_operator_identities WHERE user_id=?').get(first.user.id).external_id, `ctp:${caster}`);
  assert.ok(!JSON.stringify(first.user).includes('access-'));
  const stored = db.prepare('SELECT ctp_tokens FROM sessions WHERE token=?').get(first.token).ctp_tokens;
  assert.ok(!stored.includes('access-') && !stored.includes('refresh:'));
});

test('caster central ceiling blocks accidental local privilege grants and privileged middleware', async () => {
  const signed = await signIn('caster@example.invalid');
  const casterRole = db.prepare("SELECT * FROM roles WHERE staff_kind='caster' ORDER BY id LIMIT 1").get();
  const originalSections = casterRole.sections;
  try {
    // Simulate a mistaken local administrator assigning every role/template.
    db.prepare('INSERT OR IGNORE INTO user_roles(user_id,role_id) SELECT ?,id FROM roles').run(signed.user.id);
    db.prepare('UPDATE roles SET sections=? WHERE id=?').run(JSON.stringify(SECTION_IDS), casterRole.id);
    db.prepare('UPDATE users SET is_admin=1 WHERE id=?').run(signed.user.id);
    const user = await auth.currentUser(signed.request());
    assert.equal(user.is_admin, false);
    assert.deepEqual(user.sections, ['escaleta', 'disponibilidad', 'casters']);
    assert.ok(user.roles.every(role => role.staff_kind === 'caster'));
    const statusFor = middleware => {
      let status, nextCalled = false;
      middleware({ user }, { status(code) { status = code; return this; }, json() {} }, () => { nextCalled = true; });
      return { status, nextCalled };
    };
    assert.deepEqual(statusFor(auth.requireAdmin), { status: 403, nextCalled: false });
    for (const section of ['arbitraje', 'operaciones', 'realizacion', 'clubes', 'comunicaciones', 'calendario', 'recursos', 'tablero']) {
      assert.deepEqual(statusFor(auth.allow(section)), { status: 403, nextCalled: false }, section);
    }
    for (const section of ['escaleta', 'disponibilidad', 'casters']) {
      assert.deepEqual(statusFor(auth.allow(section)), { status: undefined, nextCalled: true }, section);
    }
  } finally {
    db.prepare('UPDATE roles SET sections=? WHERE id=?').run(originalSections, casterRole.id);
    db.prepare('DELETE FROM user_roles WHERE user_id=? AND role_id<>?').run(signed.user.id, casterRole.id);
  }
});

test('changing an existing referee to a caster removes arbitration on the next request', async () => {
  const signed = await signIn('ref@example.invalid');
  assert.ok(signed.user.sections.includes('arbitraje'));
  roles.set(referee, 'caster');
  try {
    const limited = await auth.currentUser(signed.request());
    assert.equal(limited.ctp_role, 'staff');
    assert.equal(limited.staff_kind, 'caster');
    assert.equal(limited.is_admin, false);
    assert.deepEqual(limited.sections, ['escaleta', 'disponibilidad', 'casters']);
  } finally { roles.set(referee, 'referee'); }
});

test('revoking explicit caster access expires the session and rejects another sign-in', async () => {
  const signed = await signIn('caster@example.invalid');
  roles.set(caster, 'player');
  try {
    assert.equal(await auth.currentUser(signed.request()), null);
    assert.equal(db.prepare('SELECT 1 FROM sessions WHERE token=?').get(signed.token), undefined);
    assert.equal(db.prepare('SELECT ctp_role FROM users WHERE id=?').get(signed.user.id).ctp_role, '');
    await assert.rejects(signIn('caster@example.invalid'), { status: 403 });
  } finally { roles.set(caster, 'caster'); }
});

test('a coordinator changed to referee cannot retain coordination or user-management privileges', async () => {
  const signed = await signIn('coord@example.invalid');
  assert.ok(signed.user.sections.includes('operaciones'));
  assert.equal(canManageStaff(signed.user), true);
  roles.set(coordinator, 'referee');
  try {
    const changed = await auth.currentUser(signed.request());
    assert.equal(changed.ctp_role, 'referee');
    assert.equal(changed.is_admin, false);
    assert.deepEqual(changed.sections, ['disponibilidad', 'arbitraje']);
    assert.deepEqual(changed.roles.map(role => role.staff_kind), ['referee']);
    assert.equal(canManageStaff(changed), false);
    // A later check of this unchanged legacy identity preserves a reviewed role.
    const casterRole = db.prepare("SELECT id FROM roles WHERE staff_kind='caster' ORDER BY id LIMIT 1").get();
    db.prepare('INSERT INTO user_roles(user_id,role_id) VALUES(?,?)').run(changed.id, casterRole.id);
    assert.ok((await auth.currentUser(signed.request())).roles.some(role => role.staff_kind === 'caster'));
  } finally { roles.set(coordinator, 'operations'); }
});

test('each explicit staff kind has a central section ceiling despite all local role grants', async () => {
  roles.set(coordinator, 'operations');
  const signed = await signIn('coord@example.invalid');
  const templates = db.prepare('SELECT id,sections FROM roles').all();
  try {
    for (const kind of ['operations', 'production', 'caster', 'communications', 'clubs', 'executive']) {
      roles.set(coordinator, kind);
      await auth.currentUser(signed.request());
      db.prepare('INSERT OR IGNORE INTO user_roles(user_id,role_id) SELECT ?,id FROM roles').run(signed.user.id);
      db.prepare('UPDATE roles SET sections=? WHERE staff_kind=?').run(JSON.stringify(SECTION_IDS), kind);
      const limited = await auth.currentUser(signed.request());
      assert.equal(limited.is_admin, false, kind);
      assert.equal(limited.ctp_role, 'staff');
      assert.equal(limited.staff_kind, kind);
      assert.deepEqual(limited.sections, SECTION_IDS.filter(section => STAFF_SECTION_CAPS[kind].includes(section)), kind);
      assert.ok(limited.roles.every(role => role.staff_kind === kind), kind);
      assert.equal(canManageStaff(limited), kind === 'operations');
    }
  } finally {
    roles.set(coordinator, 'operations');
    const restore = db.prepare('UPDATE roles SET sections=? WHERE id=?');
    for (const item of templates) restore.run(item.sections, item.id);
  }
});

test('concurrent expired sessions rotate credentials once and retain the same identity', async () => {
  const signed = await signIn();
  const row = db.prepare('SELECT ctp_tokens FROM sessions WHERE token=?').get(signed.token);
  const aad = `manager:${signed.token}:${admin}`;
  const tokens = decryptTokens(key, row.ctp_tokens, aad); tokens.expiresAt = Date.now() - 1;
  db.prepare('UPDATE sessions SET ctp_tokens=? WHERE token=?').run(encryptTokens(key, tokens, aad), signed.token);
  const before = refreshed;
  const results = await Promise.all([auth.currentUser(signed.request()), auth.currentUser(signed.request())]);
  assert.equal(refreshed, before + 1);
  assert.ok(results.every(user => user.ctp_user_id === admin));
  assert.ok(decryptTokens(key, db.prepare('SELECT ctp_tokens FROM sessions WHERE token=?').get(signed.token).ctp_tokens, aad).accessToken.startsWith('rotated-'));
});

test('upstream outage fails closed without turning a local account into a fallback', async () => {
  const signed = await signIn();
  unavailable = true;
  try {
    await assert.rejects(auth.currentUser(signed.request()), error => error.status === 503);
    await assert.rejects(signIn(), error => error.status === 503);
    assert.ok(db.prepare('SELECT 1 FROM sessions WHERE token=?').get(signed.token));
  } finally { unavailable = false; }
  assert.equal((await auth.currentUser(signed.request())).is_admin, true);
});

test('demotion and staff revocation are enforced on the next request', async () => {
  const signed = await signIn();
  roles.set(admin, 'referee');
  const demoted = await auth.currentUser(signed.request());
  assert.equal(demoted.is_admin, false);
  assert.ok(!demoted.sections.includes('clubes'));
  roles.set(admin, 'player');
  assert.equal(await auth.currentUser(signed.request()), null);
  assert.equal(db.prepare('SELECT 1 FROM sessions WHERE token=?').get(signed.token), undefined);
  assert.equal(db.prepare('SELECT is_admin FROM users WHERE id=?').get(signed.user.id).is_admin, 0);
  roles.set(admin, 'admin');
});

test('tampered encrypted sessions are revoked and cannot be replayed across cookies', async () => {
  const first = await signIn(), second = await signIn();
  const encrypted = db.prepare('SELECT ctp_tokens FROM sessions WHERE token=?').get(first.token).ctp_tokens;
  db.prepare('UPDATE sessions SET ctp_tokens=? WHERE token=?').run(encrypted, second.token);
  assert.equal(await auth.currentUser(second.request()), null);
  assert.equal((await auth.currentUser(first.request())).ctp_user_id, admin);
  const pieces = encrypted.split('.'); pieces[2] = (pieces[2][0] === 'A' ? 'B' : 'A') + pieces[2].slice(1);
  db.prepare('UPDATE sessions SET ctp_tokens=? WHERE token=?').run(pieces.join('.'), first.token);
  assert.equal(await auth.currentUser(first.request()), null);
});

test('parallel login attempts are reserved before the first CTP password response', async () => {
  let release;
  heldLogin = new Promise(resolve => { release = resolve; });
  heldLoginRequests = 0;
  let first;
  try {
    first = auth.loginCtp('parallel@example.invalid', 'bad-password', { cookie() { assert.fail('must not create session'); } });
    // Attach the rejection handler before releasing the deliberately held fetch.
    const firstRejected = assert.rejects(first, { status: 401 });
    const denied = await Promise.allSettled(Array.from({ length: 8 }, () => auth.loginCtp('PARALLEL@example.invalid', 'bad-password', {})));
    assert.ok(denied.every(result => result.status === 'rejected' && result.reason.status === 429));
    assert.equal(heldLoginRequests, 1, 'the burst must not reach the CTP password endpoint');
    release(); await firstRejected;
  } finally { release(); await first?.catch(() => {}); heldLogin = null; }
});

test('session parsing rejects duplicate, malformed and oversized token values before lookup', async () => {
  const signed = await signIn();
  const cookie = `mrm_session=${signed.token}`;
  assert.equal(auth.readSessionToken({ headers: { cookie } }), signed.token);
  for (const value of [`${cookie}; ${cookie}`, `${cookie}; mrm_session=bad`, 'mrm_session=%E0%A4%A', `mrm_session=${'a'.repeat(1000)}`, 'mrm_session=']) {
    assert.equal(auth.readSessionToken({ headers: { cookie: value } }), null);
    assert.equal(await auth.currentUser({ headers: { cookie: value } }), null);
  }
  assert.ok(db.prepare('SELECT 1 FROM sessions WHERE token=?').get(signed.token), 'invalid cookies must not delete a legitimate session');
});
