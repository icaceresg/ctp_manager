import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutosaveQueue } from '../client/src/autosave.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function writer(save) {
  const statuses = [], timers = new Map(); let sequence = 0;
  const queue = createAutosaveQueue({ save, onStatus: (...value) => statuses.push(value),
    setTimer: callback => { const id = ++sequence; timers.set(id, callback); return id; }, clearTimer: id => timers.delete(id) });
  return { queue, statuses, timers };
}

test('autosave merges debounced fields and explicit flush cancels the timer', async () => {
  const calls = [], { queue, statuses, timers } = writer(async patch => calls.push(patch));
  queue.schedule({ title: 'Primero' }); queue.schedule({ title: 'Último', notes: 'Apunte' });
  assert.equal(timers.size, 1); assert.equal(calls.length, 0);
  assert.equal(await queue.flush(), true);
  assert.deepEqual(calls, [{ title: 'Último', notes: 'Apunte' }]); assert.equal(timers.size, 0);
  assert.deepEqual(statuses.map(([status]) => status), ['saving', 'saved']);
  assert.deepEqual(queue.getState(), { pending: false, saving: false, error: null });
});

test('autosave preserves a failed patch and an explicit retry submits the same fields', async () => {
  const calls = [], failure = new Error('Conexión interrumpida'); let rejectFirst = true;
  const { queue, statuses } = writer(async patch => { calls.push(patch); if (rejectFirst) { rejectFirst = false; throw failure; } });
  queue.schedule({ content: 'No perder este texto', notes: 'Mantener también' });
  assert.equal(await queue.flush(), false); assert.equal(queue.getState().pending, true);
  assert.equal(queue.getState().error, failure); assert.equal(calls.length, 1);
  assert.equal(await queue.retry(), true); assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(statuses.map(([status]) => status), ['saving', 'error', 'saving', 'saved']);
  assert.equal(queue.getState().pending, false);
});

test('autosave serializes requests and newer edits win over a failed in-flight patch', async () => {
  const first = deferred(), calls = []; let active = 0, maximum = 0;
  const { queue } = writer(async patch => { active++; maximum = Math.max(maximum, active); calls.push(patch); try { if (calls.length === 1) await first.promise; } finally { active--; } });
  queue.schedule({ title: 'Antiguo', notes: 'Sin perder' }); const original = queue.flush();
  await Promise.resolve();
  queue.schedule({ title: 'Nuevo', content: 'Más datos' }); const concurrent = queue.flush();
  assert.equal(original, concurrent); assert.equal(calls.length, 1);
  first.reject(new Error('Falló la primera petición')); assert.equal(await original, false);
  assert.equal(calls.length, 1); assert.equal(await queue.retry(), true);
  assert.deepEqual(calls[1], { title: 'Nuevo', notes: 'Sin perder', content: 'Más datos' }); assert.equal(maximum, 1);
});

test('autosave drains edits made during a successful save in order', async () => {
  const first = deferred(), calls = [], { queue, statuses } = writer(async patch => { calls.push(patch); if (calls.length === 1) await first.promise; });
  queue.schedule({ title: 'A' }); const flushed = queue.flush(); await Promise.resolve(); queue.schedule({ title: 'B' });
  first.resolve(); assert.equal(await flushed, true);
  assert.deepEqual(calls, [{ title: 'A' }, { title: 'B' }]);
  assert.deepEqual(statuses.map(([status]) => status), ['saving', 'saving', 'saved']);
  assert.equal(queue.getState().pending, false);
});

test('autosave can retry a synchronously thrown save instead of retaining a finished promise', async () => {
  let calls = 0;
  const { queue } = writer(() => { if (++calls === 1) throw new Error('Synchronous failure'); });
  queue.schedule({ title: 'Conservar' }); assert.equal(await queue.flush(), false);
  assert.equal(await queue.retry(), true); assert.equal(calls, 2);
  assert.equal(queue.getState().pending, false);
});
