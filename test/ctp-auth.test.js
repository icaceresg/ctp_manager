import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ctpAuthConfig, createCtpAuthClient, encryptTokens, decryptTokens, validateIdentity } from '../server/ctp-auth.js';

const subject = '10000000-0000-4000-8000-000000000001';
const anonymous = `e30.${Buffer.from(JSON.stringify({ role: 'anon', exp: 4102444800 })).toString('base64url')}.fixture`;
const base = { CTP_AUTH_MODE: 'ctp', CTP_AUTH_URL: 'https://pre.playctp.com', CTP_WEB_ORIGIN: 'https://pre.playctp.com',
  CTP_OPERATIONS_URL: 'https://pre.playctp.com/functions/v1/manager-operations', CTP_AUTH_ANON_KEY: anonymous,
  CTP_AUTH_TOKEN_KEY: crypto.randomBytes(32).toString('base64url') };
const identity = { ctp_user_id: subject, username: 'CTP staff', role: 'admin', actor_id: `ctp:${subject}`, scopes: ['tournament.update'] };
const tokens = { subject, accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', expiresAt: Date.now() + 3600000 };

test('shared auth requires canonical CTP origins, public anon credentials and independent encryption key', () => {
  assert.equal(ctpAuthConfig({}).mode, 'local');
  assert.equal(ctpAuthConfig(base).mode, 'ctp');
  for (const override of [
    { CTP_AUTH_MODE: 'unknown' }, { CTP_AUTH_URL: 'https://pre.playctp.com/' },
    { CTP_AUTH_URL: 'https://user:pass@pre.playctp.com' }, { CTP_AUTH_URL: 'http://pre.playctp.com' },
    { CTP_WEB_ORIGIN: 'https://playctp.com' }, { CTP_OPERATIONS_URL: 'https://playctp.com/functions/v1/manager-operations' },
    { CTP_OPERATIONS_URL: 'https://pre.playctp.com/functions/v1/manager-operations?token=a' },
    { CTP_AUTH_TOKEN_KEY: 'weak' }, { CTP_AUTH_ANON_KEY: 'not-a-jwt' },
    { CTP_AUTH_ANON_KEY: `e30.${Buffer.from('{"role":"service_role","exp":4102444800}').toString('base64url')}.fixture` },
    { CTP_AUTH_ANON_KEY: `e30.${Buffer.from('{"role":"anon","exp":1}').toString('base64url')}.fixture` },
    { CTP_SIGNING_SECRET: base.CTP_AUTH_TOKEN_KEY },
  ]) assert.throws(() => ctpAuthConfig({ ...base, ...override }));
});

test('encrypted credentials are bound to the session and detect tampering', () => {
  const key = crypto.randomBytes(32), aad = 'session:user';
  const encrypted = encryptTokens(key, tokens, aad);
  assert.equal(encrypted.includes(tokens.accessToken), false);
  assert.deepEqual(decryptTokens(key, encrypted, aad), tokens);
  assert.throws(() => decryptTokens(key, encrypted, 'another-session:user'), error => error.status === 401);
  assert.throws(() => decryptTokens(crypto.randomBytes(32), encrypted, aad), error => error.status === 401);
  const parts = encrypted.split('.'); parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  assert.throws(() => decryptTokens(key, parts.join('.'), aad), error => error.status === 401);
});

test('staff identity is self-only and cannot substitute actors or grant player access', () => {
  assert.equal(validateIdentity(identity, subject).role, 'admin');
  for (const update of [{ role: 'player' }, { actor_id: 'arbitrary-operator' }, { ctp_user_id: '10000000-0000-4000-8000-000000000002' }, { scopes: [] }]) {
    assert.throws(() => validateIdentity({ ...identity, ...update }, subject), error => error.status === 403);
  }
});

test('provider uses password/refresh grants and self-binding RPC with server-only headers', async () => {
  const calls = [];
  const client = createCtpAuthClient(ctpAuthConfig(base), async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/token?')) return Response.json({ user: { id: subject }, access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
    return Response.json(identity);
  });
  const session = await client.login('STAFF@example.invalid', 'synthetic-password');
  assert.equal(session.subject, subject);
  assert.deepEqual(await client.identity(session), identity);
  await client.refresh(session);
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), ['/auth/v1/token', '/rest/v1/rpc/manager_link_own_identity', '/auth/v1/token']);
  assert.equal(JSON.parse(calls[0].init.body).email, 'staff@example.invalid');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer access');
  assert.equal(calls[1].init.headers.apikey, anonymous);
  assert.equal(calls.every(call => call.init.redirect === 'error'), true);
  assert.equal(calls.every(call => !Object.hasOwn(call.init.headers, 'Origin')), true);
});

test('bad credentials, unavailable provider, invalid JSON and non-staff all fail closed', async () => {
  for (const [status, expected] of [[401, 401], [403, 403], [429, 429], [500, 503]]) {
    const client = createCtpAuthClient(ctpAuthConfig(base), async () => Response.json({ secret: 'never surfaced' }, { status }));
    await assert.rejects(client.login('staff@example.invalid', 'synthetic-password'), error => error.status === expected && !error.message.includes('never surfaced'));
  }
  const invalid = createCtpAuthClient(ctpAuthConfig(base), async () => new Response('not JSON', { headers: { 'content-type': 'text/html' } }));
  await assert.rejects(invalid.login('staff@example.invalid', 'synthetic-password'), error => error.status === 503);
  const player = createCtpAuthClient(ctpAuthConfig(base), async () => Response.json({ ...identity, role: 'player' }));
  await assert.rejects(player.identity(tokens), error => error.status === 403);
});

test('refresh cannot change the linked CTP subject', async () => {
  const client = createCtpAuthClient(ctpAuthConfig(base), async () => Response.json({ user: { id: '10000000-0000-4000-8000-000000000002' }, access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }));
  await assert.rejects(client.refresh(tokens), error => error.status === 401);
});
