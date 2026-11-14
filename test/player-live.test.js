import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { playerLiveResponse, unavailablePlayerLive, PLAYER_LIVE_SECTIONS } from '../server/player-live-contract.js';

// Synthetic dependency-injected transport only; no shared DEV data or network calls.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-player-live-unit-'));
Object.assign(process.env, { DATA_DIR: directory, DB_PATH: path.join(directory, 'fixture.sqlite'), CTP_AUTH_MODE: 'local',
  PUBLIC_ORIGIN: '', CTP_OPERATIONS_URL: '', CTP_OPERATIONS_TOKEN: '', CTP_SYNC_SECONDS: '0' });
const { createPlayerLiveReader } = await import('../server/player-live-client.js');
const { createOperationsTransport } = await import('../server/integration.js');
const { db } = await import('../server/db.js');
after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5 }); });

const userId = 'b092f794-36dd-4b8b-b0df-63411ab69b54';
const stamp = Date.parse('2026-11-14T12:00:00Z');
const fixture = (at = stamp) => ({ schema_version: 1, status: 'ready', checked_at: new Date(at).toISOString(),
  fresh_for_seconds: 90, streams: [{ user_id: userId, channel: 'ctp_player' }] });
const admin = { id: 1, is_admin: true };

test('projection strips extra provider/identity fields and never accepts arbitrary channel URLs', () => {
  const input = fixture();
  input.access_token = 'private-fixture-token'; input.email = 'private@example.invalid';
  Object.assign(input.streams[0], { access_token: 'private-fixture-token', identity_data: { email: 'private@example.invalid' },
    title: 'not needed by rosters', viewer_count: 1000, url: 'https://untrusted.example.invalid/' });
  assert.deepEqual(playerLiveResponse(input, stamp), fixture());
  for (const channel of ['https://twitch.tv/player', 'user@twitch.tv', '../player', 'MixedCase', 'a'.repeat(26), 'bad\nname']) {
    const row = fixture(); row.streams[0].channel = channel;
    assert.throws(() => playerLiveResponse(row, stamp));
  }
});

test('stale, future and unavailable observations cannot advertise LIVE', () => {
  assert.deepEqual(playerLiveResponse(fixture(), stamp + 90_000), unavailablePlayerLive());
  assert.deepEqual(playerLiveResponse(fixture(stamp + 10_001), stamp), unavailablePlayerLive());
  assert.equal(playerLiveResponse(fixture(), stamp + 89_999).streams.length, 1);
  assert.deepEqual(playerLiveResponse({ ...unavailablePlayerLive(), checked_at: '2026-11-13T12:00:00Z' }, stamp), unavailablePlayerLive());
  for (const input of [{ ...fixture(), fresh_for_seconds: 91 }, { ...fixture(), streams: [fixture().streams[0], fixture().streams[0]] },
    { ...fixture(), checked_at: null }, { ...fixture(), status: 'unavailable' }, { ...fixture(), streams: Array(101).fill(fixture().streams[0]) }]) {
    assert.throws(() => playerLiveResponse(input, stamp));
  }
});

test('only staff roster sections can read and denial happens before bridge/actor access', async () => {
  let calls = 0;
  const read = createPlayerLiveReader({ now: () => stamp, actorFor: () => { calls++; return 'ctp:staff'; }, request: async () => fixture() });
  await assert.rejects(read(null), { status: 401 });
  await assert.rejects(read({ id: 9, sections: ['comunicaciones'] }), { status: 403 });
  assert.equal(calls, 0);
  for (const section of PLAYER_LIVE_SECTIONS) assert.equal((await read({ id: 9, sections: [section] })).status, 'ready');
  assert.equal((await read(admin)).status, 'ready');
});

test('concurrent roster reads coalesce, actor caches stay separate and requests are read-only', async () => {
  let now = stamp, calls = [], release;
  const gate = new Promise(resolve => { release = resolve; });
  const read = createPlayerLiveReader({ now: () => now, actorFor: user => `ctp:${user.id}`, request: async body => {
    calls.push(body); await gate; return fixture(now);
  } });
  const first = read(admin), second = read(admin);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1); release();
  assert.deepEqual(await first, await second);
  await read(admin); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { action: 'admin_service', actor_id: 'ctp:1', service: 'player_live', payload: { action: 'read' } });
  await read({ id: 2, sections: ['casters'] }); assert.equal(calls.length, 2);
  now += 60_000; await read(admin); assert.equal(calls.length, 3);
});

test('failure/invalid/unconfigured results fail closed with bounded retry; expiry is not renewed by cache', async () => {
  let now = stamp, calls = 0;
  const read = createPlayerLiveReader({ now: () => now, actorFor: () => 'ctp:actor', request: async () => {
    calls++; if (calls === 1) throw Error('private upstream failure'); return fixture(stamp + 60_000);
  } });
  assert.deepEqual(await read(admin), unavailablePlayerLive());
  now += 59_999; assert.deepEqual(await read(admin), unavailablePlayerLive()); assert.equal(calls, 1);
  now++; assert.equal((await read(admin)).status, 'ready'); assert.equal(calls, 2);
  now = stamp + 149_999; assert.equal((await read(admin)).status, 'ready');
  now++; assert.deepEqual(await read(admin), unavailablePlayerLive());
  const disabled = createPlayerLiveReader({ configured: () => false, actorFor: () => assert.fail('no actor lookup when disabled'), request: () => assert.fail('no network') });
  assert.deepEqual(await disabled(admin), unavailablePlayerLive());
  const invalid = createPlayerLiveReader({ now: () => stamp, actorFor: () => 'ctp:actor', request: async () => ({ private_secret: 'never forward' }) });
  assert.deepEqual(await invalid(admin), unavailablePlayerLive());
});

test('cache size is bounded and old entries can be reclaimed', async () => {
  let now = stamp, calls = 0;
  const read = createPlayerLiveReader({ maxEntries: 2, now: () => now, actorFor: user => `ctp:${user.id}`, request: async () => { calls++; return fixture(now); } });
  for (const id of [1, 2]) assert.equal((await read({ id, is_admin: true })).status, 'ready');
  assert.deepEqual(await read({ id: 3, is_admin: true }), unavailablePlayerLive()); assert.equal(calls, 2);
  now += 60_000; assert.equal((await read({ id: 3, is_admin: true })).status, 'ready'); assert.equal(calls, 3);
});

test('player feed transport is signed, omits redirects and enforces a 32 KiB body limit', async () => {
  const config = { configured: true, url: 'https://bridge.example.invalid/functions/v1/manager-operations',
    token: 'fixture-private-bearer', signingSecret: 'fixture-independent-private-signing' };
  const body = { action: 'admin_service', actor_id: 'ctp:1', service: 'player_live', payload: { action: 'read' } };
  let seen;
  const read = createOperationsTransport(config, async (_url, input) => { seen = input; return Response.json({ ok: true, data: fixture() }); });
  assert.deepEqual(await read(body), fixture()); assert.equal(seen.method, 'POST'); assert.equal(seen.redirect, 'error');
  assert.ok(Object.keys(seen.headers).some(name => /signature/i.test(name)));
  const tooLarge = createOperationsTransport(config, async () => Response.json({ ok: true, data: { junk: 'x'.repeat(32 * 1024) } }));
  await assert.rejects(tooLarge(body), { status: 502 });
  const declared = createOperationsTransport(config, async () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '32769' } }));
  await assert.rejects(declared(body), { status: 502 });
});
