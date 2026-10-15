import test from 'node:test';
import assert from 'node:assert/strict';
import { createLatestLoader } from '../client/src/latestLoader.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('calendar navigation publishes only the latest range even when an older response arrives last', async () => {
  const events = [], previous = deferred(), next = deferred();
  const loader = createLatestLoader((...event) => events.push(event));
  const oldRequest = loader.run(() => previous.promise);
  const newRequest = loader.run(() => next.promise);
  next.resolve([{ date: '2026-11-01', title: 'November' }]);
  await newRequest;
  previous.resolve([{ date: '2026-10-01', title: 'October' }]);
  await oldRequest;
  assert.deepEqual(events, [['start'], ['start'], ['success', [{ date: '2026-11-01', title: 'November' }]], ['finish']]);
});

test('an obsolete failure cannot replace the result, stop the new spinner or produce a stale error', async () => {
  const events = [], old = deferred(), current = deferred();
  const loader = createLatestLoader((...event) => events.push(event));
  const first = loader.run(() => old.promise);
  const second = loader.run(() => current.promise);
  old.reject(new Error('Old request failed'));
  await first;
  assert.deepEqual(events, [['start'], ['start']]);
  current.resolve('Current data');
  await second;
  assert.deepEqual(events.slice(2), [['success', 'Current data'], ['finish']]);
});

test('leaving a page suppresses pending results and errors, including after StrictMode reactivation', async () => {
  const events = [], pending = deferred();
  const loader = createLatestLoader((...event) => events.push(event));
  const first = loader.run(() => pending.promise);
  loader.dispose();
  loader.activate();
  await loader.run(() => 'Mounted again');
  pending.reject(new Error('Unmounted request'));
  await first;
  assert.deepEqual(events, [['start'], ['start'], ['success', 'Mounted again'], ['finish']]);
});

test('a failed initial load finishes and can be retried successfully rather than remaining in a spinner', async () => {
  const events = [], failure = Object.assign(new Error('Service unavailable'), { status: 503 });
  const loader = createLatestLoader((...event) => events.push(event));
  await loader.run(() => { throw failure; });
  assert.deepEqual(events, [['start'], ['error', failure], ['finish']]);
  await loader.run(async () => ['Recovered']);
  assert.deepEqual(events.slice(3), [['start'], ['success', ['Recovered']], ['finish']]);
});
