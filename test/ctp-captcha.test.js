import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ctpAuthConfig, createCtpAuthClient, publicCtpAuthConfig } from '../server/ctp-auth.js';

const subject = '10000000-0000-4000-8000-000000000001';
const anonymous = `e30.${Buffer.from('{"role":"anon","exp":4102444800}').toString('base64url')}.fixture`;
const env = { CTP_AUTH_MODE: 'ctp', CTP_AUTH_URL: 'https://pre.playctp.com', CTP_WEB_ORIGIN: 'https://pre.playctp.com',
  CTP_OPERATIONS_URL: 'https://pre.playctp.com/functions/v1/manager-operations', CTP_AUTH_ANON_KEY: anonymous,
  CTP_AUTH_TOKEN_KEY: crypto.randomBytes(32).toString('base64url'), CTP_AUTH_CAPTCHA_REQUIRED: 'true',
  CTP_AUTH_CAPTCHA_SITE_KEY: '1x00000000000000000000AA' };
const nativeTokens = () => ({ user: { id: subject }, access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600 });

test('required CAPTCHA config needs a public key and exposes no runtime credentials', () => {
  const config = ctpAuthConfig(env);
  assert.deepEqual(publicCtpAuthConfig(config), { provider: 'ctp', captcha: { required: true, siteKey: env.CTP_AUTH_CAPTCHA_SITE_KEY } });
  assert.deepEqual(publicCtpAuthConfig({ mode: 'local' }), { provider: 'local', captcha: { required: false, siteKey: null } });
  const publicJson = JSON.stringify(publicCtpAuthConfig(config));
  assert.ok(!publicJson.includes(anonymous) && !publicJson.includes(env.CTP_AUTH_TOKEN_KEY));
  for (const override of [{ CTP_AUTH_CAPTCHA_REQUIRED: '1' }, { CTP_AUTH_CAPTCHA_SITE_KEY: '' },
    { CTP_AUTH_CAPTCHA_SITE_KEY: 'https://untrusted.example/key' }, { CTP_AUTH_CAPTCHA_SITE_KEY: 'a'.repeat(101) }]) {
    assert.throws(() => ctpAuthConfig({ ...env, ...override }));
  }
});

test('missing or malformed required proof is rejected before any password request', async () => {
  let requests = 0;
  const client = createCtpAuthClient(ctpAuthConfig(env), async () => { requests++; throw Error('must not fetch'); });
  for (const proof of [undefined, null, '', ' ', 'leading space', 'token\n', {}, [], 42, 'a'.repeat(2049)]) {
    await assert.rejects(client.login('staff@invalid.example', 'fixture-password', proof), { status: 400, message: 'captcha_failed' });
  }
  assert.equal(requests, 0);
});

test('a human proof reaches native Auth exactly once with anon key and never siteverify', async () => {
  const calls = [];
  const proof = 'synthetic-widget-proof';
  const client = createCtpAuthClient(ctpAuthConfig(env), async (url, init) => {
    calls.push({ url, init }); return Response.json(nativeTokens());
  });
  const session = await client.login('STAFF@invalid.example', 'fixture-password', proof);
  assert.equal(session.subject, subject);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://pre.playctp.com/auth/v1/token?grant_type=password');
  assert.deepEqual(JSON.parse(calls[0].init.body), { email: 'staff@invalid.example', password: 'fixture-password', gotrue_meta_security: { captcha_token: proof } });
  assert.equal(calls[0].init.headers.apikey, anonymous);
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[0].init.headers['X-Supabase-Api-Version'], '2024-01-01');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(JSON.stringify(session).includes(proof), false);
});

test('native CAPTCHA errors retain a safe distinct code for invalid expired and replay fixtures', async () => {
  for (const body of [{ code: 'captcha_failed', message: 'private-provider-diagnostic' },
    { code: 400, error_code: 'captcha_failed', msg: 'private-provider-diagnostic' }]) {
    const client = createCtpAuthClient(ctpAuthConfig(env), async () => Response.json(body, { status: 400 }));
    await assert.rejects(client.login('staff@invalid.example', 'fixture-password', 'synthetic-proof'),
      error => error.status === 400 && error.message === 'captcha_failed' && !error.message.includes('private-provider'));
  }
  const seen = new Set();
  const client = createCtpAuthClient(ctpAuthConfig(env), async (_url, init) => {
    const proof = JSON.parse(init.body).gotrue_meta_security.captcha_token;
    if (seen.has(proof)) return Response.json({ code: 'captcha_failed' }, { status: 400 });
    seen.add(proof); return Response.json(nativeTokens());
  });
  await client.login('staff@invalid.example', 'fixture-password', 'single-use-fixture');
  await assert.rejects(client.login('staff@invalid.example', 'fixture-password', 'single-use-fixture'), { status: 400, message: 'captcha_failed' });
});

test('credentials and unexpected provider errors cannot be misclassified or exposed as CAPTCHA', async () => {
  for (const body of [{ code: 'invalid_credentials', message: 'private-detail' }, { error: 'captcha_failed' },
    { code: 'other', message: 'captcha_failed' }, { code: 'a'.repeat(70000) }]) {
    const client = createCtpAuthClient(ctpAuthConfig(env), async () => Response.json(body, { status: 400 }));
    await assert.rejects(client.login('staff@invalid.example', 'fixture-password', 'synthetic-proof'), { status: 401, message: 'invalid_credentials' });
  }
});

test('required proof applies only to new login, preserving refresh and self-identity admission', async () => {
  const calls = [];
  const client = createCtpAuthClient(ctpAuthConfig(env), async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/token?')) return Response.json(nativeTokens());
    return Response.json({ ctp_user_id: subject, username: 'Synthetic staff', role: 'admin', actor_id: `ctp:${subject}`, scopes: ['admin.console'] });
  });
  const previous = { subject, accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', expiresAt: Date.now() + 3600000 };
  const refreshed = await client.refresh(previous); await client.identity(refreshed);
  assert.deepEqual(JSON.parse(calls[0].init.body), { refresh_token: previous.refreshToken });
  assert.deepEqual(JSON.parse(calls[1].init.body), {});
  assert.equal(calls[1].init.headers.Authorization, 'Bearer synthetic-access');
  assert.ok(calls.every(call => !call.init.body.includes('captcha_token')));
});

test('optional compatibility mode preserves old clients and still forwards supplied valid proof', async () => {
  const bodies = [];
  const client = createCtpAuthClient(ctpAuthConfig({ ...env, CTP_AUTH_CAPTCHA_REQUIRED: 'false' }), async (_url, init) => {
    bodies.push(JSON.parse(init.body)); return Response.json(nativeTokens());
  });
  await client.login('staff@invalid.example', 'fixture-password');
  await client.login('staff@invalid.example', 'fixture-password', 'optional-proof');
  assert.deepEqual(bodies[0], { email: 'staff@invalid.example', password: 'fixture-password' });
  assert.deepEqual(bodies[1].gotrue_meta_security, { captcha_token: 'optional-proof' });
});
