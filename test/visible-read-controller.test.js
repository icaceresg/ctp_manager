import test from 'node:test';
import assert from 'node:assert/strict';
import { createVisibleReadController } from '../client/src/visibleReadController.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(overrides = {}) {
  let shown = true, blocked = false, now = 0;
  const values = [], errors = [], calls = [];
  const controller = createVisibleReadController({ retryMs: 10_000,
    read: signal => { const pending = deferred(); calls.push({ signal, ...pending }); return pending.promise; },
    onValue: value => values.push(value), onError: error => errors.push(error),
    visible: () => shown, blocked: () => blocked, clock: () => now, ...overrides });
  return { controller, values, errors, calls, show: value => { shown = value; }, block: value => { blocked = value; }, time: value => { now = value; } };
}

test('concurrent periodic/manual reads share one pending request without caching a completed result', async () => {
  const f = fixture(), first = f.controller.run();
  const pending = Array.from({ length: 30 }, () => f.controller.run({ manual: true }));
  await Promise.resolve(); assert.equal(f.calls.length, 1);
  f.calls[0].resolve({ revision: 1 }); await Promise.all([first, ...pending]);
  assert.deepEqual(f.values, [{ revision: 1 }]);
  const later = f.controller.run(); await Promise.resolve(); assert.equal(f.calls.length, 2);
  f.calls[1].resolve({ revision: 2 }); await later; assert.equal(f.values[1].revision, 2);
});

test('a hidden view does no work and aborts an active request without publishing its late answer', async () => {
  const f = fixture(); f.show(false); await f.controller.run(); assert.equal(f.calls.length, 0);
  f.show(true); const pending = f.controller.run(); await Promise.resolve();
  f.show(false); f.controller.cancel(); assert.equal(f.calls[0].signal.aborted, true);
  f.calls[0].resolve('obsolete'); await pending;
  assert.deepEqual(f.values, []); assert.deepEqual(f.errors, []);
});

test('hide/show waits for an abort-insensitive old transport, then performs exactly one fresh read', async () => {
  const f = fixture(), pending = f.controller.run(); await Promise.resolve();
  f.controller.cancel();
  const fresh = f.controller.run({ manual: true }), duplicate = f.controller.run({ manual: true });
  await Promise.resolve(); assert.equal(f.calls.length, 1);
  f.calls[0].resolve('stale'); await pending; await Promise.resolve();
  assert.equal(f.calls.length, 2); f.calls[1].resolve('fresh'); await Promise.all([fresh, duplicate]);
  assert.deepEqual(f.values, ['fresh']);
});

test('a write fence rejects the previous read and prevents a poll from overwriting the acknowledged action', async () => {
  const f = fixture(), pending = f.controller.run(); await Promise.resolve();
  f.block(true); f.controller.cancel(); await f.controller.run(); assert.equal(f.calls.length, 1);
  f.calls[0].resolve({ messages: ['old'] }); await pending; assert.deepEqual(f.values, []);
  f.block(false); const fresh = f.controller.run({ manual: true }); await Promise.resolve();
  f.calls[1].resolve({ messages: ['confirmed'] }); await fresh;
  assert.deepEqual(f.values, [{ messages: ['confirmed'] }]);
});

test('disposal isolates a changed account/view and cancels even before the transport starts', async () => {
  const f = fixture(), old = f.controller.run(); f.controller.dispose(); await old;
  assert.equal(f.calls.length, 0); await f.controller.run({ manual: true }); assert.equal(f.calls.length, 0);
  const other = fixture(), pending = other.controller.run(); await Promise.resolve(); other.controller.dispose();
  other.calls[0].resolve('another actor'); await pending; assert.deepEqual(other.values, []);
});

test('repeated failures back off within a finite minute; explicit retry remains available and success resets it', async () => {
  const f = fixture(); let attempt = f.controller.run(); await Promise.resolve(); f.calls[0].reject(new Error('fixture')); await attempt;
  assert.equal(f.controller.state().retryAfter, 10_000);
  f.time(9999); await f.controller.run(); assert.equal(f.calls.length, 1);
  f.time(10_000); attempt = f.controller.run(); await Promise.resolve(); f.calls[1].reject(new Error('fixture')); await attempt;
  assert.equal(f.controller.state().retryAfter, 30_000);
  for (let i = 0; i < 7; i++) { attempt = f.controller.run({ manual: true }); await Promise.resolve(); f.calls.at(-1).reject(new Error('fixture')); await attempt; }
  assert.equal(f.controller.state().retryAfter, 70_000);
  attempt = f.controller.run({ manual: true }); await Promise.resolve(); f.calls.at(-1).resolve('ok'); await attempt;
  assert.equal(f.controller.state().failures, 0); assert.deepEqual(f.values, ['ok']);
});

test('authorization errors remain visible and are never served from a cached prior successful read', async () => {
  const f = fixture(), first = f.controller.run(); await Promise.resolve(); f.calls[0].resolve('authorized'); await first;
  const next = f.controller.run(); await Promise.resolve(); const error = Object.assign(new Error('forbidden'), { status: 403 });
  f.calls[1].reject(error); await next; assert.equal(f.errors[0], error); assert.deepEqual(f.values, ['authorized']);
});
