// Reproducible LOCAL synthetic HTTP fixture. No CTP, database or credentials.
// Measures concurrent read intents, not player capacity or VPS CPU savings.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { createVisibleReadController } from '../client/src/visibleReadController.js';

const counts = { requests: 0, active: 0, peak: 0 };
const server = createServer((_request, response) => {
  counts.requests++; counts.active++; counts.peak = Math.max(counts.peak, counts.active);
  setTimeout(() => {
    counts.active--;
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end('{"fixture":"synthetic-local","version":1}');
  }, 35);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/synthetic-read`;
const read = async signal => { const response = await fetch(url, { signal }); return response.json(); };
async function measure(run) {
  counts.requests = counts.peak = 0;
  const start = performance.now();
  await run();
  assert.equal(counts.active, 0);
  return { requests: counts.requests, peakConcurrent: counts.peak, elapsedMs: Number((performance.now() - start).toFixed(2)) };
}
try {
  // Previously each read intent started its own request; response sequence
  // numbers prevented stale rendering but did not exclude concurrent work.
  const before = await measure(() => Promise.all(Array.from({ length: 30 }, () => read())));
  let visible = true, values = 0;
  const controller = createVisibleReadController({ read, onValue: () => values++, onError: error => { throw error; },
    visible: () => visible, retryMs: 10_000 });
  const after = await measure(() => Promise.all(Array.from({ length: 30 }, () => controller.run({ manual: true }))));
  assert.equal(before.requests, 30); assert.equal(after.requests, 1); assert.equal(after.peakConcurrent, 1);
  visible = false;
  const hidden = await measure(() => Promise.all(Array.from({ length: 30 }, () => controller.run())));
  assert.equal(hidden.requests, 0);
  visible = true;
  await controller.run();
  assert.equal(values, 2, 'a completed read is not cached across subsequent refreshes');
  controller.dispose();
  console.log(JSON.stringify({ kind: 'LOCAL_SYNTHETIC_HTTP_FIXTURE', intents: 30, before, after, hidden,
    completedResponsesCached: false, productionMeasured: false, databaseUsed: false }, null, 2));
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
