import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMetricsReader, metricsConfiguration, metricsDto, METRICS_CACHE_MS, METRICS_STALE_MS, METRICS_MAX_BYTES, METRICS_DEFAULT_FILE } from '../server/metrics.js';
import { METRICS_ALERT_CODES, METRICS_ROUTE_FAMILIES } from '../shared/metrics-contract.js';

const now = Date.parse('2026-10-23T12:00:00.000Z');
const iso = offset => new Date(now + offset).toISOString();
const enabled = { PUBLIC_ORIGIN: 'https://pre.manager.playctp.com', CTP_METRICS_FILE: path.resolve('metrics-test-snapshot.json') };
const snapshot = (extra = {}) => ({ schemaVersion: 1, generatedAt: iso(0), available: true,
  source: { collectionStartedAt: iso(-3_600_000), intervalSeconds: 60, retentionHours: 24 },
  host: { cpuCores: 4, cpuPercent: 12.5, memoryTotalBytes: 4_294_967_296, memoryAvailableBytes: 1_024, swapUsedBytes: 0 },
  environments: {
    pre: { traffic: { available: true, coverageFrom: iso(-3_600_000), partial: true, requests5m: 12, requests24h: 156, errors5xx24h: 0, p95Ms: 4.2 },
      activity: { available: true, accounts: 30, activePlayers: 0 }, database: { available: true, connections: 4, longestTransactionSeconds: 1.2 },
      routes: [{ family: 'html', count: 12, errors5xx: 0, p95Ms: 2.3 }] },
    prod: { traffic: { available: false }, activity: { available: true, accounts: 50 }, database: { available: false } },
  },
  services: [{ name: 'ctp-prod-db', environment: 'prod', cpuPercent: 140.2, memoryBytes: 1_024, memoryLimitBytes: 2_048, oomKilled: false, restarts: 0, status: 'running' }],
  history: [{ at: iso(-60_000), cpuPercent: 11.5, preRequests: 12.5, prod5xx: 0.5, preWaitingPlayers: 1 }],
  alerts: [{ code: 'memory_low', severity: 'warning', scope: 'host', value: 1_024, threshold: 2_048 }], ...extra });

test('metrics are enabled only for exact PRE/PROD Manager origins or explicit local development', () => {
  assert.equal(metricsConfiguration({ PUBLIC_ORIGIN: 'https://pre.manager.playctp.com' }).enabled, true);
  assert.equal(metricsConfiguration({ PUBLIC_ORIGIN: 'https://manager.playctp.com' }).enabled, true);
  assert.equal(metricsConfiguration({ CTP_METRICS_ENABLED: '1' }).enabled, true);
  assert.equal(metricsConfiguration({}).enabled, false);
  for (const origin of ['https://ruleta.playctp.com', 'https://evil.pre.manager.playctp.com', 'https://evil.manager.playctp.com', 'https://pre.manager.playctp.com/', 'https://manager.playctp.com/', 'https://pre.manager.playctp.com?token=x', 'https://manager.playctp.com?token=x', 'http://pre.manager.playctp.com', 'http://manager.playctp.com']) {
    assert.equal(metricsConfiguration({ PUBLIC_ORIGIN: origin, CTP_METRICS_ENABLED: '1' }).enabled, false, origin);
  }
  assert.equal(metricsConfiguration({}).file, METRICS_DEFAULT_FILE);
  assert.equal(metricsConfiguration({ CTP_METRICS_FILE: '../secret' }).file, null);
});

test('DTO preserves independent sources, explicit zero and fractional per-minute rates', () => {
  const result = metricsDto(snapshot(), now);
  assert.equal(result.available, true); assert.equal(result.stale, false);
  assert.equal(result.environments.pre.traffic.errors5xx24h, 0);
  assert.equal(result.environments.pre.traffic.requests1h, null);
  assert.equal(result.environments.pre.activity.activePlayers, 0);
  assert.equal(result.environments.prod.traffic.available, false);
  assert.equal(result.environments.prod.activity.available, true);
  assert.equal(result.environments.prod.activity.accounts, 50);
  assert.equal(result.environments.prod.database.connections, null);
  assert.equal(result.host.diskFreeBytes, null);
  assert.equal(result.services[0].cpuPercent, 140.2);
  assert.equal(result.history[0].preRequests, 12.5);
  assert.equal(result.history[0].prod5xx, 0.5);
  assert.equal(result.history[0].prodRequests, null);
  assert.deepEqual(result.coverage, { uniqueVisitors: false, pageViews: 'server_documents_only' });
});

test('DTO rejects secrets and request metadata at every level, including unknown enum strings', () => {
  const privateValue = 'PRIVATE-CANARY-token-query-ip-cookie';
  const raw = snapshot();
  for (const target of [raw, raw.source, raw.host, raw.environments.pre, raw.environments.pre.traffic, raw.environments.pre.activity, raw.environments.pre.database, raw.environments.pre.routes[0], raw.services[0], raw.history[0], raw.alerts[0]]) {
    Object.assign(target, { uri: `https://example.invalid/?token=${privateValue}`, ip: privateValue, Authorization: privateValue, Cookie: privateValue, email: privateValue, username: privateValue, raw: privateValue });
  }
  raw.environments.pre.routes.push({ family: privateValue, count: 1 });
  raw.services.push({ name: `https://${privateValue}`, environment: 'pre' });
  raw.alerts.push({ code: privateValue, scope: 'pre', severity: 'warning' });
  raw.coverage = { uniqueVisitors: true, pageViews: privateValue };
  const result = metricsDto(raw, now), serialized = JSON.stringify(result);
  assert(!serialized.includes(privateValue)); assert(!serialized.includes('example.invalid'));
  assert.equal(result.environments.pre.routes.length, 1); assert.equal(result.services.length, 1); assert.equal(result.alerts.length, 1);
  assert.equal(JSON.stringify(result).includes('Authorization'), false);
});

test('invalid, string, negative, unsafe and impossible numeric fields become null, never fake zero', () => {
  const raw = snapshot({ host: { cpuPercent: 101, cpuCores: 1.5, diskFreeBytes: -1, load1: Infinity, load5: '5', swapTotalBytes: NaN } });
  raw.environments.pre.traffic.requests5m = Number.MAX_SAFE_INTEGER + 1;
  raw.environments.pre.activity.accounts = '30';
  raw.environments.pre.database.connections = -1;
  const result = metricsDto(raw, now);
  for (const key of ['cpuPercent', 'cpuCores', 'diskFreeBytes', 'load1', 'load5', 'swapTotalBytes']) assert.equal(result.host[key], null, key);
  assert.equal(result.environments.pre.traffic.requests5m, null);
  assert.equal(result.environments.pre.activity.accounts, null);
  assert.equal(result.environments.pre.database.connections, null);
});

test('schema and generatedAt fail closed; missing environments remain unavailable; stale is derived', () => {
  for (const invalid of [null, [], {}, snapshot({ schemaVersion: 2 }), snapshot({ generatedAt: 'https://private.invalid' }), snapshot({ generatedAt: iso(60_001) }), snapshot({ available: 'true' })]) {
    assert.throws(() => metricsDto(invalid, now), /METRICS_INVALID_SNAPSHOT/);
  }
  assert.equal(metricsDto(snapshot({ generatedAt: iso(-METRICS_STALE_MS) }), now).stale, false);
  assert.equal(metricsDto(snapshot({ generatedAt: iso(-METRICS_STALE_MS - 1) }), now).stale, true);
  const absent = metricsDto(snapshot({ environments: {} }), now);
  for (const environment of ['pre', 'prod']) for (const source of ['traffic', 'activity', 'database']) assert.equal(absent.environments[environment][source].available, false);
});

test('fixed cardinality catalogues and bounded arrays cannot return arbitrary route, alert or service names', () => {
  const raw = snapshot();
  raw.history = Array.from({ length: 2_000 }, (_, i) => ({ at: iso(-i * 1000), cpuPercent: 1 }));
  raw.environments.pre.routes = Array.from({ length: 100 }, () => ({ family: 'html', count: 1 }));
  raw.services = Array.from({ length: 100 }, () => ({ name: 'caddy', environment: 'host', status: 'running' }));
  raw.alerts = Array.from({ length: 100 }, () => ({ code: 'cpu_busy', severity: 'warning', scope: 'host' }));
  const result = metricsDto(raw, now);
  assert.equal(result.history.length, 1_441); assert.equal(result.environments.pre.routes.length, 64);
  assert.equal(result.services.length, 64); assert.equal(result.alerts.length, 64);
  assert(METRICS_ALERT_CODES.includes(result.alerts[0].code)); assert(METRICS_ROUTE_FAMILIES.includes(result.environments.pre.routes[0].family));
});

test('history omits invalid, future and expired points and sorts in ascending time', () => {
  const result = metricsDto(snapshot({ history: [{ at: iso(-60_000) }, { at: 'private' }, { at: iso(1) }, { at: iso(-86_400_001) }, { at: iso(-120_000) }] }), now);
  assert.deepEqual(result.history.map(row => row.at), [iso(-120_000), iso(-60_000)]);
});

test('disabled reader performs no disk read, including attempted opt-in on an unrelated public origin', async () => {
  let reads = 0;
  for (const env of [{}, { PUBLIC_ORIGIN: 'https://other.invalid', CTP_METRICS_ENABLED: '1', CTP_METRICS_FILE: enabled.CTP_METRICS_FILE }]) {
    const read = createMetricsReader({ env, read: async () => { reads++; return snapshot(); } });
    assert.equal((await read()).status, 404);
  }
  assert.equal(reads, 0);
});

test('reader coalesces requests, caches for 15 seconds and recomputes stale across a cache hit', async () => {
  let current = now, reads = 0, release;
  const read = createMetricsReader({ env: enabled, clock: () => current, read: async file => {
    assert.equal(file, enabled.CTP_METRICS_FILE); reads++;
    if (reads === 1) await new Promise(resolve => { release = resolve; });
    return snapshot({ generatedAt: iso(-METRICS_STALE_MS + 1) });
  } });
  const first = read(), second = read(); assert.equal(reads, 1); release();
  const both = await Promise.all([first, second]); assert.equal(both[0].body.stale, false);
  current += 2; assert.equal((await read()).body.stale, true); assert.equal(reads, 1);
  current = now + METRICS_CACHE_MS; assert.equal((await read()).status, 200); assert.equal(reads, 2);
});

test('reader caches generic errors briefly and never exposes a path or filesystem/parse exception', async () => {
  let current = now, reads = 0;
  const read = createMetricsReader({ env: enabled, clock: () => current, read: async () => { reads++; throw new Error('SECRET /private/path https://host/?token=SECRET'); } });
  const first = await read(); assert.equal(first.status, 503); assert(!JSON.stringify(first).includes('SECRET'));
  await read(); assert.equal(reads, 1);
  current += METRICS_CACHE_MS; await read(); assert.equal(reads, 2);
});

test('actual file reader accepts regular snapshots and refuses missing, directory, malformed, unsupported and over-4MiB files', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-metrics-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert(path.basename(directory).startsWith('ctp-metrics-test-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const file = path.join(directory, 'snapshot.json');
  const readFile = target => createMetricsReader({ env: { ...enabled, CTP_METRICS_FILE: target }, clock: () => now })();
  assert.equal((await readFile(file)).status, 503);
  assert.equal((await readFile(directory)).status, 503);
  fs.writeFileSync(file, JSON.stringify(snapshot())); assert.equal((await readFile(file)).status, 200);
  fs.writeFileSync(file, '{"token":"PRIVATE"'); assert.equal((await readFile(file)).status, 503);
  fs.writeFileSync(file, JSON.stringify(snapshot({ schemaVersion: 2 }))); assert.equal((await readFile(file)).status, 503);
  fs.writeFileSync(file, Buffer.alloc(METRICS_MAX_BYTES + 1, ' ')); assert.equal((await readFile(file)).status, 503);
});
