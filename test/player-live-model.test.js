import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayerLiveStore, freshPlayerLive, parsePlayerLive, playerLiveUrl } from '../client/src/operations/playerLiveModel.js';

const id = 'b68c6a3d-0b39-40de-91ea-a2d6bc62f38f';
const start = Date.parse('2026-11-14T13:00:00Z');
const feed = (checked = start, streams = [{ user_id: id, channel: 'player_test' }]) => ({
  schema_version: 1, status: 'ready', checked_at: new Date(checked).toISOString(), fresh_for_seconds: 90, streams,
});
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(read) {
  let now = start, nextId = 0, visible = true, changed = null;
  const tasks = new Map(), calls = [], notices = [];
  const store = createPlayerLiveStore({
    request(signal) { const pending = deferred(); calls.push({ signal, ...pending }); return read ? read({ now, signal, calls }) : pending.promise; },
    isVisible: () => visible,
    observeVisibility(listener) { changed = listener; return () => { changed = null; }; },
    now: () => now,
    setTimer(task, delay) { const key = ++nextId; tasks.set(key, { task, at: now + delay }); return key; },
    clearTimer(key) { tasks.delete(key); },
  });
  async function advance(ms) {
    const until = now + ms;
    for (;;) {
      const next = [...tasks].filter(([, row]) => row.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; tasks.delete(next[0]); next[1].task(); await settle();
    }
    now = until; await settle();
  }
  return { store, calls, notices, advance, subscribe: () => store.subscribe(() => notices.push(store.getSnapshot())),
    setVisible(value) { visible = value; changed?.(); }, tasks };
}

test('the projection keeps only public channel identity and rejects arbitrary destinations', () => {
  assert.deepEqual(parsePlayerLive({ ...feed(), ignored: 'not retained', streams: [{ ...feed().streams[0], access_token: 'not-retained', title: 'not-retained' }] }), feed());
  assert.equal(playerLiveUrl('a_b19'), 'https://www.twitch.tv/a_b19');
  for (const value of ['https://twitch.tv/a', '//evil.test/a', 'a?token=x', 'a/b', '', 'AName', 'a'.repeat(26), null]) assert.equal(playerLiveUrl(value), null);
  for (const value of [{ ...feed(), schema_version: 2 }, { ...feed(), streams: [feed().streams[0], feed().streams[0]] },
    { ...feed(), fresh_for_seconds: 91 }, { ...feed(), checked_at: null }, { ...feed(), status: 'unavailable' },
    feed(start, [{ user_id: 'not-a-uuid', channel: 'player_test' }])]) assert.throws(() => parsePlayerLive(value));
});

test('freshness has a hard upper bound and rejects future, unavailable or expired evidence', () => {
  const value = parsePlayerLive(feed());
  assert.equal(freshPlayerLive(value, start), value);
  assert.equal(freshPlayerLive(value, start + 89_999), value);
  assert.equal(freshPlayerLive(value, start + 90_000), null);
  assert.equal(freshPlayerLive(value, start - 10_001), null);
  assert.equal(freshPlayerLive({ ...value, status: 'unavailable' }, start), null);
  assert.equal(freshPlayerLive({ ...value, fresh_for_seconds: 30 }, start + 30_000), null);
});

test('all roster badges share one request per minute and stop polling with no subscribers', async () => {
  const f = fixture(({ now }) => Promise.resolve(feed(now)));
  const subscriptions = Array.from({ length: 32 }, () => f.subscribe());
  await f.advance(0); assert.equal(f.calls.length, 1);
  await f.advance(59_999); assert.equal(f.calls.length, 1);
  await f.advance(1); assert.equal(f.calls.length, 2);
  assert.equal(f.store.getSnapshot().streams[0].channel, 'player_test');
  subscriptions.forEach(unsubscribe => unsubscribe());
  await f.advance(300_000); assert.equal(f.calls.length, 2); assert.equal(f.store.getSnapshot(), null);
  assert.equal(f.tasks.size, 0);
});

test('hide aborts a pending observation, rejects its late answer and never overlaps it on focus', async () => {
  const f = fixture(), unsubscribe = f.subscribe(); await f.advance(0); assert.equal(f.calls.length, 1);
  f.setVisible(false); assert.equal(f.calls[0].signal.aborted, true);
  f.setVisible(true); await f.advance(61_000); assert.equal(f.calls.length, 1);
  f.calls[0].resolve(feed(start + 61_000)); await settle(); assert.equal(f.store.getSnapshot(), null);
  await f.advance(0); assert.equal(f.calls.length, 2);
  f.calls[1].resolve(feed(start + 61_000, [])); await settle(); assert.deepEqual(f.store.getSnapshot().streams, []);
  unsubscribe();
});

test('stale or unavailable response removes LIVE even if a later refresh hangs', async () => {
  const f = fixture(), unsubscribe = f.subscribe(); await f.advance(0);
  f.calls[0].resolve(feed()); await settle(); assert.ok(f.store.getSnapshot());
  await f.advance(60_000); assert.equal(f.calls.length, 2);
  await f.advance(30_000); assert.equal(f.store.getSnapshot(), null);
  assert.equal(f.calls[1].signal.aborted, true);
  f.calls[1].resolve(feed()); await settle(); assert.equal(f.store.getSnapshot(), null);
  unsubscribe();
});

test('errors clear prior LIVE, back off and recover without breaking the roster', async () => {
  const f = fixture(), unsubscribe = f.subscribe(); await f.advance(0);
  f.calls[0].resolve(feed()); await settle(); await f.advance(60_000);
  f.calls[1].reject(new Error('provider unavailable')); await settle(); assert.equal(f.store.getSnapshot(), null);
  await f.advance(119_999); assert.equal(f.calls.length, 2);
  await f.advance(1); assert.equal(f.calls.length, 3);
  f.calls[2].resolve(feed(start + 180_000)); await settle(); assert.ok(f.store.getSnapshot());
  await f.advance(60_000); assert.equal(f.calls.length, 4);
  f.calls[3].resolve({ schema_version: 1, status: 'unavailable', checked_at: null, fresh_for_seconds: 90, streams: [] });
  await settle(); assert.equal(f.store.getSnapshot(), null); unsubscribe();
});

test('hidden tabs perform no initial work and do not poll on rapid focus changes', async () => {
  const f = fixture(({ now }) => Promise.resolve(feed(now))); f.setVisible(false);
  const unsubscribe = f.subscribe(); await f.advance(300_000); assert.equal(f.calls.length, 0);
  f.setVisible(true); await f.advance(0); assert.equal(f.calls.length, 1);
  for (let i = 0; i < 12; i++) { f.setVisible(false); f.setVisible(true); }
  await f.advance(59_999); assert.equal(f.calls.length, 1);
  await f.advance(1); assert.equal(f.calls.length, 2); unsubscribe();
});
