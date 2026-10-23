// Browser-safe catalogues shared by the PRE dashboard and its aggregate reader.
export const METRICS_SCHEMA_VERSION = 1;
export const METRICS_ROUTE_FAMILIES = Object.freeze([
  'html', 'static', 'rest', 'rpc', 'poll', 'action', 'auth', 'signup', 'login',
  'refresh', 'email', 'discord', 'ingress', 'storage', 'realtime', 'function',
  'other', 'metadata', 'preflight', 'internal',
]);
export const METRICS_ALERT_CODES = Object.freeze([
  'cpu_busy', 'cpu_pressure', 'memory_low', 'swap_used', 'swap_activity', 'disk_full',
  'connection_pressure', 'database_blocked', 'database_idle_transaction', 'oom_recent',
  'service_restarted', 'service_unhealthy', 'collector_partial', 'traffic_5xx', 'source_unavailable',
]);
export const METRICS_SERVICE_STATUSES = Object.freeze([
  'running', 'healthy', 'unhealthy', 'active', 'inactive', 'failed', 'exited', 'restarting', 'unknown', 'stopped',
]);
export const METRICS_SCOPES = Object.freeze(['host', 'pre', 'prod']);
export const METRICS_SEVERITIES = Object.freeze(['info', 'warning', 'critical']);
