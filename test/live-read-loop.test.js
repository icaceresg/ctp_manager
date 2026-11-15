import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveReadLoop, LIVE_READ_INTERVALS } from '../client/src/operations/liveReadLoop.js';

const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('selected arbitration budget is twelve match reads plus two list reads per visible minute', async () => {
  const timers = [], calls = { match: 0, arbitration: 0, full: 0 };
  const loops = ['match', 'arbitration'].map(kind => createLiveReadLoop({ intervalMs: LIVE_READ_INTERVALS[kind],
    read: async () => ++calls[kind], onValue() {}, onError(error) { throw error; }, visible: () => true,
    setTimer: (run, ms) => { const timer = { run, ms }; timers.push(timer); return timer; }, clearTimer() {},
  }));
  loops.forEach(loop => loop.start()); await settle(); calls.match = 0; calls.arbitration = 0;
  for (let now = 5000; now <= 60_000; now += 5000) {
    for (const timer of timers) if (now % timer.ms === 0) timer.run();
    await settle();
  }
  assert.deepEqual(calls, { match: 12, arbitration: 2, full: 0 }); loops.forEach(loop => loop.stop());
});

test('full context starts no timer or initial request and only loads deliberately while visible', async () => {
  let shown = false, calls = 0, timers = 0;
  const loop = createLiveReadLoop({ initial: false, read: async () => ++calls, onValue() {}, onError() {},
    visible: () => shown, setTimer: () => { timers++; }, clearTimer() {},
  });
  loop.start(); await loop.load(); assert.equal(calls, 0); shown = true; loop.visibilityChanged(); await settle();
  assert.equal(calls, 0); await loop.load(); assert.equal(calls, 1); assert.equal(timers, 0); loop.stop();
});

test('hide cancels a pending transport; rapid wake cannot overlap it or publish its stale result', async () => {
  let shown = true, release; const calls = [], values = [];
  const loop = createLiveReadLoop({ read: signal => { calls.push(signal); return new Promise(resolve => { release = resolve; }); },
    onValue: value => values.push(value), onError() {}, visible: () => shown, clearTimer() {},
  });
  loop.start(); await settle(); shown = false; loop.visibilityChanged(); assert.equal(calls[0].aborted, true);
  shown = true; loop.visibilityChanged(); await settle(); assert.equal(calls.length, 1);
  release('stale'); await settle(); assert.equal(calls.length, 2); assert.deepEqual(values, []);
  release('fresh'); await settle(); assert.deepEqual(values, ['fresh']); loop.stop();
});

test('a disposed authority cannot publish into a replacement session, and failures back off', async () => {
  let fail = true, now = 0, calls = 0; const errors = [], values = [];
  const loop = createLiveReadLoop({ intervalMs: 5000, clock: () => now, visible: () => true,
    read: async () => { calls++; if (fail) throw new Error('fixture'); return 'fresh'; },
    onValue: value => values.push(value), onError: error => errors.push(error), setTimer() {}, clearTimer() {},
  });
  loop.start(); await settle(); assert.equal(calls, 1); assert.equal(errors.length, 1);
  now = 4999; await loop.load({ quiet: true }); assert.equal(calls, 1);
  fail = false; now = 5000; await loop.load({ quiet: true }); assert.deepEqual(values, ['fresh']);
  loop.stop(); await loop.load(); assert.equal(calls, 2);
});
