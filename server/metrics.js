import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { METRICS_SCHEMA_VERSION, METRICS_ROUTE_FAMILIES, METRICS_ALERT_CODES, METRICS_SERVICE_STATUSES, METRICS_SCOPES, METRICS_SEVERITIES } from '../shared/metrics-contract.js';

export { METRICS_ROUTE_FAMILIES, METRICS_ALERT_CODES } from '../shared/metrics-contract.js';

export const METRICS_PRE_ORIGIN = 'https://pre.manager.playctp.com';
export const METRICS_PROD_ORIGIN = 'https://manager.playctp.com';
export const METRICS_DEFAULT_FILE = '/var/lib/ctp-manager-pre-metrics/snapshot.json';
export const METRICS_MAX_BYTES = 4 * 1024 * 1024;
export const METRICS_CACHE_MS = 15_000;
export const METRICS_STALE_MS = 180_000;

// No string from a URL, request, log line or database record reaches the DTO.
// Service names come from the trusted root collector, never public request metadata.
const serviceName = /^(?:ctp-(?:pre|prod)-|supabase-|realtime-dev\.(?:ctp-prod|supabase)-|ctp-manager-(?:pre|prod)|ctp-edge-guard-(?:pre|prod)|caddy)[a-z0-9_.-]{0,90}$/;

const families = new Set(METRICS_ROUTE_FAMILIES);
const alertCodes = new Set(METRICS_ALERT_CODES);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
const numeric = (value, maximum = Number.MAX_SAFE_INTEGER) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum ? value : null;
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const percent = value => numeric(value, 100);
const timestamp = value => {
  if (typeof value !== 'string' || value.length > 35 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const date = Date.parse(value);
  return Number.isFinite(date) ? new Date(date).toISOString() : null;
};
const fields = (source, names, convert = numeric) => Object.fromEntries(names.map(key => [key, convert(source[key])]));
const limited = (value, maximum) => Array.isArray(value) ? value.slice(0, maximum) : [];

export function metricsConfiguration(env = process.env) {
  // Only the two exact Manager origins or explicitly enabled local development.
  // Authentication and administrator access are enforced by the route middleware.
  const enabled = [METRICS_PRE_ORIGIN, METRICS_PROD_ORIGIN].includes(env.PUBLIC_ORIGIN)
    || (!env.PUBLIC_ORIGIN && env.CTP_METRICS_ENABLED === '1');
  const file = env.CTP_METRICS_FILE || METRICS_DEFAULT_FILE;
  return { enabled, file: typeof file === 'string' && path.isAbsolute(file) ? file : null };
}

function trafficDto(value) {
  const source = object(value);
  const available = source.available === true;
  return {
    available,
    coverageFrom: timestamp(source.coverageFrom),
    partial: source.partial === true || !available,
    ...fields(source, ['requests5m', 'requests1h', 'requests24h', 'documents24h', 'bots24h', 'errors4xx24h', 'errors5xx24h', 'bytes24h'], integer),
    ...fields(source, ['p50Ms', 'p95Ms']),
  };
}

function activityDto(value) {
  const source = object(value);
  return { available: source.available === true, ...fields(source, [
    'accounts', 'confirmedAccounts', 'registrations24h', 'signIns24h', 'signIns5m',
    'waitingPlayers', 'activeMatches', 'activePlayers', 'closedMatches24h',
  ], integer) };
}

function databaseDto(value) {
  const source = object(value);
  return { available: source.available === true,
    ...fields(source, ['connections', 'maxConnections', 'active', 'waitingLocks', 'idleInTransaction', 'deadlocks', 'databaseBytes'], integer),
    longestTransactionSeconds: numeric(source.longestTransactionSeconds),
  };
}

function environmentDto(value) {
  const source = object(value);
  const routes = limited(source.routes, 64).filter(row => families.has(object(row).family)).map(row => ({
    family: row.family, count: integer(row.count), errors5xx: integer(row.errors5xx), p95Ms: numeric(row.p95Ms),
  }));
  return { traffic: trafficDto(source.traffic), activity: activityDto(source.activity), database: databaseDto(source.database), routes };
}

export function metricsDto(snapshot, now = Date.now()) {
  const source = object(snapshot);
  const generatedAt = timestamp(source.generatedAt);
  if (source.schemaVersion !== METRICS_SCHEMA_VERSION || !generatedAt || typeof source.available !== 'boolean' || Date.parse(generatedAt) > now + 60_000) throw new Error('METRICS_INVALID_SNAPSHOT');
  const host = object(source.host);
  const metadata = object(source.source);
  const environments = object(source.environments);
  const history = limited(source.history, 1_441).flatMap(value => {
    const row = object(value), at = timestamp(row.at);
    if (!at || Date.parse(at) > Date.parse(generatedAt) || Date.parse(at) < Date.parse(generatedAt) - 86_400_000) return [];
    return [{ at, ...fields(row, ['cpuPercent', 'memoryUsedPercent', 'swapUsedPercent', 'diskUsedPercent'], percent),
      ...fields(row, ['preRequests', 'prodRequests', 'pre5xx', 'prod5xx']),
      ...fields(row, ['preWaitingPlayers', 'prodWaitingPlayers', 'preActivePlayers', 'prodActivePlayers'], integer) }];
  }).sort((a, b) => a.at.localeCompare(b.at));
  const services = limited(source.services, 64).flatMap(value => {
    const row = object(value);
    if (typeof row.name !== 'string' || !serviceName.test(row.name) || !METRICS_SCOPES.includes(row.environment)) return [];
    return [{ name: row.name, environment: row.environment, cpuPercent: numeric(row.cpuPercent, 100_000),
      memoryBytes: integer(row.memoryBytes), memoryLimitBytes: integer(row.memoryLimitBytes),
      oomKilled: typeof row.oomKilled === 'boolean' ? row.oomKilled : null, restarts: integer(row.restarts),
      status: METRICS_SERVICE_STATUSES.includes(row.status) ? row.status : 'unknown' }];
  });
  const alerts = limited(source.alerts, 64).flatMap(value => {
    const row = object(value);
    if (!alertCodes.has(row.code) || !METRICS_SEVERITIES.includes(row.severity) || !METRICS_SCOPES.includes(row.scope)) return [];
    return [{ code: row.code, severity: row.severity, scope: row.scope, value: numeric(row.value), threshold: numeric(row.threshold) }];
  });
  return {
    schemaVersion: METRICS_SCHEMA_VERSION, generatedAt, available: source.available,
    stale: now - Date.parse(generatedAt) > METRICS_STALE_MS,
    source: { collectionStartedAt: timestamp(metadata.collectionStartedAt), intervalSeconds: numeric(metadata.intervalSeconds, 3_600), retentionHours: numeric(metadata.retentionHours, 24) },
    host: { ...fields(host, ['cpuCores', 'memoryTotalBytes', 'memoryAvailableBytes', 'swapTotalBytes', 'swapUsedBytes', 'diskTotalBytes', 'diskFreeBytes', 'oomEvents24h', 'failedUnitsCount'], integer),
      ...fields(host, ['cpuPercent', 'iowaitPercent', 'memoryUsedPercent', 'swapUsedPercent', 'diskUsedPercent', 'pressureCpu10', 'pressureMem10', 'pressureIo10'], percent),
      ...fields(host, ['load1', 'load5', 'load15', 'swapInBytesPerSec', 'swapOutBytesPerSec']) },
    environments: { pre: environmentDto(environments.pre), prod: environmentDto(environments.prod) },
    services, history, alerts,
    coverage: { uniqueVisitors: false, pageViews: 'server_documents_only' },
  };
}

async function readSnapshot(file) {
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > METRICS_MAX_BYTES) throw new Error('METRICS_INVALID_FILE');
    // A bounded read also protects against a file growing after fstat.
    const buffer = Buffer.allocUnsafe(METRICS_MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, length);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    if (length > METRICS_MAX_BYTES) throw new Error('METRICS_INVALID_FILE');
    return JSON.parse(buffer.toString('utf8', 0, length));
  } finally { await handle.close(); }
}

export function createMetricsReader({ env = process.env, clock = Date.now, read = readSnapshot } = {}) {
  const config = metricsConfiguration(env);
  let cached = null, cachedAt = -Infinity, pending = null;
  return async function readMetrics() {
    if (!config.enabled) return { status: 404, body: { error: 'Ruta no encontrada.' } };
    const now = clock();
    if (cached && now >= cachedAt && now - cachedAt < METRICS_CACHE_MS) {
      return cached.status === 200 ? { ...cached, body: { ...cached.body, stale: now - Date.parse(cached.body.generatedAt) > METRICS_STALE_MS } } : cached;
    }
    if (pending) return pending;
    pending = (async () => {
      try {
        if (!config.file) throw new Error('METRICS_INVALID_FILE');
        cached = { status: 200, body: metricsDto(await read(config.file), clock()) };
      } catch {
        // Never return file names, filesystem errors, raw JSON or log contents.
        cached = { status: 503, body: { error: 'Las métricas no están disponibles. Vuelve a intentarlo.' } };
      }
      cachedAt = clock();
      return cached;
    })();
    try { return await pending; } finally { pending = null; }
  };
}

const readMetrics = createMetricsReader();
export async function metricsHandler(req, res) {
  // Selection is intentionally server-side only; no query/header can select a file or environment.
  const result = await readMetrics();
  res.set('Cache-Control', 'no-store');
  res.status(result.status).json(result.body);
}
