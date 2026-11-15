import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { backgroundJobsEnabled, createHttpDrain, startBackgroundJobs } from '../server/process-lifecycle.js';

test('standby flag is explicit, defaults enabled and cannot silently accept ambiguous values', () => {
  assert.equal(backgroundJobsEnabled({}), true);
  assert.equal(backgroundJobsEnabled({ MANAGER_BACKGROUND_JOBS_ENABLED: 'true' }), true);
  assert.equal(backgroundJobsEnabled({ MANAGER_BACKGROUND_JOBS_ENABLED: 'false' }), false);
  for (const value of ['', '0', '1', 'TRUE', ' false']) assert.throws(() => backgroundJobsEnabled({ MANAGER_BACKGROUND_JOBS_ENABLED: value }));
});

test('standby or quarantine starts no cleanup, immediate ruleta read or operations loop', () => {
  for (const [enabled, shadow] of [[false, false], [false, true], [true, true]]) {
    const fail = () => assert.fail('no background task may be started');
    assert.deepEqual(startBackgroundJobs({ enabled, shadow, cleanupSessions: fail, interval: fail, startOperations: fail, startRuleta: fail }), []);
  }
  let scheduled, unref = 0, operations = 0, ruleta = 0;
  const cleanup = { unref: () => unref++ }, worker = {};
  assert.deepEqual(startBackgroundJobs({ enabled: true, shadow: false, cleanupSessions() {},
    interval: (callback, ms) => { scheduled = ms; return cleanup; }, startOperations: () => { operations++; return worker; }, startRuleta: () => { ruleta++; return null; } }), [cleanup, worker]);
  assert.equal(scheduled, 3600000); assert.equal(unref, 1); assert.equal(operations, 1); assert.equal(ruleta, 1);
});

async function listening(handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}
const get = server => new Promise((resolve, reject) => {
  const req = http.get({ hostname: '127.0.0.1', port: server.address().port, path: '/', agent: false }, response => {
    let body = ''; response.on('data', value => { body += value; }); response.on('end', () => resolve(body));
  }); req.on('error', reject);
});

test('HTTP drain stops both listeners and lets an in-progress response finish before closing resources', async () => {
  let arrived, reply;
  const started = new Promise(resolve => { arrived = resolve; });
  const first = await listening((request, response) => { reply = () => response.end('complete'); arrived(); });
  const second = await listening((request, response) => response.end('idle'));
  let before = 0, after = 0;
  const drain = createHttpDrain([first, second], { deadlineMs: 1000, beforeClose: () => before++, afterClose: () => after++ });
  const response = get(first); await started;
  const closing = drain(); assert.equal(drain(), closing); assert.equal(first.listening, false); assert.equal(second.listening, false);
  assert.equal(after, 0); reply(); assert.equal(await response, 'complete');
  assert.deepEqual(await closing, { forced: false }); assert.equal(before, 1); assert.equal(after, 1);
});

test('an unresponsive HTTP request is closed at the finite drain deadline', async () => {
  let arrived; const started = new Promise(resolve => { arrived = resolve; });
  const server = await listening(() => arrived());
  let after = 0;
  const response = get(server).catch(error => error.code); await started;
  const drain = createHttpDrain([server], { deadlineMs: 30, afterClose: () => after++ });
  assert.deepEqual(await drain(), { forced: true }); assert.equal(await response, 'ECONNRESET'); assert.equal(after, 1);
});
