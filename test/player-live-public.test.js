import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicPlayerLiveRequest } from '../server/player-live-public.js';
import { ctpAuthConfig } from '../server/ctp-auth.js';
import { deploymentConfig } from '../server/config.js';

const stamp = Date.parse('2026-11-14T12:00:00Z');
const key = (role = 'anon', exp = 4102444800) => `e30.${Buffer.from(JSON.stringify({ role, exp })).toString('base64url')}.fixture`;
const config = { mode: 'ctp', origin: 'https://pre.playctp.com', anon: key(), key: Buffer.alloc(32, 1) };
const fixture = () => ({ schema_version: 1, status: 'ready', checked_at: new Date(stamp).toISOString(), fresh_for_seconds: 90,
  streams: [{ user_id: '85550000-0000-4000-8000-000000000001', channel: 'ctp_fixture' }] });
const request = (fetchImpl, extra = {}) => createPublicPlayerLiveRequest({ config, fetchImpl, now: () => stamp, ...extra });

test('the only outbound player-feed request is a GET using the public anon credential', async () => {
  const read = request(async (url, input) => {
    assert.equal(url, 'https://pre.playctp.com/functions/v1/ranked-live');
    assert.equal(input.method, 'GET'); assert.equal(input.body, undefined);
    assert.equal(input.redirect, 'error'); assert.equal(input.credentials, 'omit'); assert.equal(input.cache, 'no-store');
    assert.deepEqual(input.headers, { apikey: key(), Authorization: `Bearer ${key()}` });
    assert.ok(input.signal instanceof AbortSignal);
    const data = fixture(); data.secret = 'private'; Object.assign(data.streams[0], { access_token: 'private', title: 'not needed' });
    return Response.json(data);
  });
  assert.deepEqual(await read(), fixture());
  let prodUrl;
  await request(async url => { prodUrl = url; return Response.json(fixture()); }, { config: { ...config, origin: 'https://playctp.com' } })();
  assert.equal(prodUrl, 'https://playctp.com/functions/v1/ranked-live');
});

test('unsafe origin, service-role, expired keys and local mode fail before any network call', async () => {
  const bad = [
    { ...config, origin: 'http://pre.playctp.com' }, { ...config, origin: 'https://pre.playctp.com/' },
    { ...config, origin: 'https://user:pass@pre.playctp.com' }, { ...config, origin: 'https://evil.example.invalid' },
    { ...config, origin: 'https://pre.playctp.com?token=x' }, { ...config, origin: 'http://127.0.0.1:58021' },
    { ...config, mode: 'local' }, { ...config, anon: key('service_role') }, { ...config, anon: key('authenticated') },
    { ...config, anon: key('anon', stamp / 1000) }, { ...config, anon: 'not-a-jwt' }, { ...config, anon: key() + '\n' },
  ];
  for (const candidate of bad) await assert.rejects(request(() => assert.fail('network must stay unused'), { config: candidate })(), /player_live_unavailable/);
});

test('the validated application configuration rejects environment crossings and service keys', () => {
  const env = { CTP_AUTH_MODE: 'ctp', CTP_AUTH_URL: 'https://pre.playctp.com', CTP_WEB_ORIGIN: 'https://pre.playctp.com',
    CTP_OPERATIONS_URL: 'https://pre.playctp.com/functions/v1/manager-operations', CTP_AUTH_ANON_KEY: key(), CTP_AUTH_TOKEN_KEY: Buffer.alloc(32, 2).toString('base64url') };
  assert.equal(ctpAuthConfig(env).origin, 'https://pre.playctp.com');
  assert.throws(() => ctpAuthConfig({ ...env, CTP_OPERATIONS_URL: 'https://playctp.com/functions/v1/manager-operations' }));
  assert.throws(() => ctpAuthConfig({ ...env, CTP_WEB_ORIGIN: 'https://playctp.com' }));
  assert.throws(() => ctpAuthConfig({ ...env, CTP_AUTH_ANON_KEY: key('service_role') }));
  assert.throws(() => deploymentConfig({ ...env, PUBLIC_ORIGIN: 'https://pre.manager.playctp.com', CTP_AUTH_URL: 'https://playctp.com' }));
});

test('redirects, unexpected URLs, content types, malformed JSON and oversized responses are rejected', async () => {
  const invalid = [
    () => Response.redirect('https://evil.example.invalid', 302),
    () => { const response = Response.json(fixture()); Object.defineProperty(response, 'url', { value: 'https://playctp.com/functions/v1/ranked-live' }); return response; },
    () => new Response('not json', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
    () => Response.json({ junk: 'x'.repeat(128 * 1024) }),
    () => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': String(128 * 1024 + 1) } }),
  ];
  for (const response of invalid) await assert.rejects(request(async () => response())(), /player_live_unavailable/);
});

test('an unresponsive fetch/body has a finite timeout even if the synthetic fetch ignores abort', async () => {
  let signal;
  const started = Date.now();
  await assert.rejects(request(async (_url, input) => { signal = input.signal; return await new Promise(() => {}); }, { timeoutMs: 15 })(), /player_live_unavailable/);
  assert.equal(signal.aborted, true); assert.ok(Date.now() - started < 1000);
  const stream = new ReadableStream({ start() {}, cancel() {} });
  await assert.rejects(request(async () => new Response(stream, { headers: { 'Content-Type': 'application/json' } }), { timeoutMs: 15 })(), /player_live_unavailable/);
});
