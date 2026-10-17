import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoginLimiter, LoginLimitError } from '../server/login-limiter.js';

test('an in-flight reservation blocks parallel credentials before contacting the provider', () => {
  const limiter = createLoginLimiter();
  const first = limiter.begin('staff@example.invalid', 'proxy');
  assert.throws(() => limiter.begin('staff@example.invalid', 'other-peer'), LoginLimitError);
  first.finish({ success: true });
  limiter.begin('staff@example.invalid', 'proxy').finish({ success: true });
});

test('five failed credentials lock the account across peers and expire without sleeping', () => {
  let time = 1000;
  const limiter = createLoginLimiter({ now: () => time });
  for (let n = 0; n < 5; n++) limiter.begin('staff', `peer${n}`).finish({ credentialFailure: true });
  assert.throws(() => limiter.begin('staff', 'fresh-peer'), error => error.retryAfterSeconds === 60);
  time += 59_999;
  assert.throws(() => limiter.begin('staff', 'fresh-peer'), error => error.retryAfterSeconds === 1);
  time++;
  limiter.begin('staff', 'fresh-peer').finish({ success: true });
});

test('account spraying consumes the shared proxy budget even when every name is different', () => {
  let time = 1000;
  const limiter = createLoginLimiter({ now: () => time, peerAttempts: 3 });
  for (let n = 0; n < 3; n++) limiter.begin(`unknown-${n}`, 'proxy').finish({ credentialFailure: true });
  assert.throws(() => limiter.begin('real-staff', 'proxy'), LoginLimitError);
  limiter.begin('real-staff', 'different-socket').finish({ success: true });
  time += 60_000;
  limiter.begin('real-staff', 'proxy').finish({ success: true });
});

test('global budget and concurrent cap also apply to changing peers', () => {
  const limiter = createLoginLimiter({ totalAttempts: 3, maxConcurrent: 2 });
  const one = limiter.begin('one', 'one'), two = limiter.begin('two', 'two');
  assert.throws(() => limiter.begin('three', 'three'), LoginLimitError);
  one.finish(); two.finish();
  assert.throws(() => limiter.begin('four', 'four'), LoginLimitError);
});

test('bounded caches fail closed and never evict an account still locked or in flight', () => {
  let time = 1000;
  const limiter = createLoginLimiter({ now: () => time, maxAccounts: 1, maxFailures: 1 });
  const held = limiter.begin('one', 'proxy');
  assert.throws(() => limiter.begin('two', 'proxy'), LoginLimitError);
  held.finish({ credentialFailure: true });
  assert.throws(() => limiter.begin('two', 'proxy'), LoginLimitError);
  assert.throws(() => limiter.begin('one', 'proxy'), LoginLimitError);
  time += 15 * 60_000;
  limiter.begin('two', 'proxy').finish();
  const peers = createLoginLimiter({ now: () => time, maxPeers: 1 });
  peers.begin('one', 'peer-one').finish({ success: true });
  assert.throws(() => peers.begin('two', 'peer-two'), LoginLimitError);
  time += 60_000;
  peers.begin('two', 'peer-two').finish({ success: true });
});

test('service outages release reservations without counting bad credentials; finish is idempotent', () => {
  const limiter = createLoginLimiter({ maxFailures: 1, maxConcurrent: 1 });
  const attempt = limiter.begin('staff', 'proxy');
  attempt.finish(); attempt.finish({ credentialFailure: true });
  limiter.begin('staff', 'proxy').finish({ success: true });
});
