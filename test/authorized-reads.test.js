import test from 'node:test';
import assert from 'node:assert/strict';
import { bindReadAuthority, createAuthorizedReads } from '../server/authorized-reads.js';

const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { resolve, promise }; };
const actor = (session = 'qa-session', sections = ['arbitraje']) => bindReadAuthority({ id: 1, ctp_user_id: 'qa-user', ctp_role: 'referee', sections }, session, 'qa-encrypted-credentials');

test('concurrent authorized GETs share one flight, but completed answers are never cached', async () => {
  const reads = createAuthorizedReads(), user = actor(), held = deferred(); let calls = 0;
  const read = () => { calls++; return held.promise; };
  const pending = Array.from({ length: 20 }, () => reads.run(user, 't1', 'match:m1', read));
  await Promise.resolve(); assert.equal(calls, 1); assert.equal(reads.size(), 1);
  held.resolve({ revision: 'one' }); await Promise.all(pending); assert.equal(reads.size(), 0);
  await reads.run(user, 't1', 'match:m1', () => { calls++; return 'fresh'; }); assert.equal(calls, 2);
});

test('same account on separate sessions, changed permissions, other actors and resources cannot share', async () => {
  const reads = createAuthorizedReads(), held = deferred(); let calls = 0;
  const users = [actor('one'), actor('two'), actor('one', ['operaciones']),
    bindReadAuthority({ id: 2, ctp_role: 'referee', sections: ['arbitraje'] }, 'one', 'qa-encrypted-credentials')];
  const pending = users.map(user => reads.run(user, 't1', 'match:m1', () => { calls++; return held.promise; }));
  pending.push(reads.run(users[0], 't1', 'match:m2', () => { calls++; return held.promise; }));
  pending.push(reads.run(users[0], 't2', 'match:m1', () => { calls++; return held.promise; }));
  await Promise.resolve(); assert.equal(calls, 6); held.resolve('ok'); await Promise.all(pending);
});

test('tournament write fence rejects late pre-write snapshots for all sessions and permits a fresh read', async () => {
  const reads = createAuthorizedReads(), held = deferred(), user = actor();
  const previous = reads.run(user, 't1', 'get', () => held.promise);
  const rejection = assert.rejects(previous, error => error.status === 409);
  reads.invalidate('t1');
  assert.equal(await reads.run(user, 't1', 'get', () => 'after-write'), 'after-write');
  held.resolve('before-write'); await rejection; assert.equal(reads.size(), 0);
});

test('failed, unbound or capacity-exceeding reads do not leave cache entries; authority is not serializable', async () => {
  const reads = createAuthorizedReads({ maximum: 1 }), user = actor(), held = deferred();
  const first = reads.run(user, 't1', 'get', () => held.promise);
  assert.equal(await reads.run(actor('two'), 't1', 'get', () => 'uncached'), 'uncached');
  assert.equal(reads.size(), 1); held.resolve('ok'); await first;
  await assert.rejects(reads.run(user, 't1', 'get', () => { throw new Error('fixture'); }));
  assert.equal(reads.size(), 0); assert.equal(JSON.stringify(user).includes('qa-session'), false);
  assert.equal(JSON.stringify(user).includes('qa-encrypted-credentials'), false);
  let unbound = 0;
  await Promise.all([reads.run({ id: 1 }, 't1', 'get', () => ++unbound), reads.run({ id: 1 }, 't1', 'get', () => ++unbound)]);
  assert.equal(unbound, 2);
});
