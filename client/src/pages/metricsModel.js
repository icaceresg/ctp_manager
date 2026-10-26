export const METRICS_REFRESH_MS = 60_000;
export const metricsAllowedHost = hostname => ['pre.manager.playctp.com', 'manager.playctp.com', 'localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
export const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export const metricNumber = (value, digits = 1) => numeric(value) ? new Intl.NumberFormat('es-ES', { maximumFractionDigits: digits }).format(value) : 'Sin datos';
export const metricPercent = value => numeric(value) ? `${metricNumber(value)} %` : 'Sin datos';
export function metricBytes(value) {
  if (!numeric(value)) return 'Sin datos';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']; let unit = 0, size = value;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++; }
  return `${metricNumber(size)} ${units[unit]}`;
}
export function metricSeconds(value) {
  if (!numeric(value)) return 'Sin datos';
  return value < 60 ? `${metricNumber(value)} s` : value < 3600 ? `${metricNumber(value / 60)} min` : `${metricNumber(value / 3600)} h`;
}
export function metricTime(value, compact = false) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) return 'Sin datos';
  return new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', ...(compact ? {} : { day: '2-digit', month: '2-digit', year: 'numeric' }), hour: '2-digit', minute: '2-digit', ...(compact ? {} : { second: '2-digit' }) }).format(new Date(time));
}
export function metricsHistory(history, generatedAt, hours) {
  const end = Date.parse(generatedAt);
  if (!Number.isFinite(end) || ![1, 6, 24].includes(hours)) return [];
  return (Array.isArray(history) ? history : []).filter(row => row && Number.isFinite(Date.parse(row.at)) && Date.parse(row.at) >= end - hours * 3_600_000 && Date.parse(row.at) <= end).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
/** Keep missing samples and collection gaps separate; do not turn an outage into zero. */
export function chartSegments(history, key, maximum, intervalSeconds = 60) {
  const width = 640, height = 150, top = 10, bottom = 28;
  const start = Date.parse(history[0]?.at), end = Date.parse(history.at(-1)?.at);
  if (!(end > start) || !numeric(maximum) || maximum <= 0) return [];
  const segments = []; let current = [], previousTime = null;
  for (const row of history) {
    const time = Date.parse(row.at), value = row[key];
    if (!numeric(value) || !Number.isFinite(time)) { if (current.length) segments.push(current); current = []; previousTime = null; continue; }
    if (previousTime !== null && time - previousTime > Math.max(150_000, intervalSeconds * 2500)) { if (current.length) segments.push(current); current = []; }
    current.push({ x: 4 + (time - start) / (end - start) * (width - 8), y: top + (1 - Math.min(1, value / maximum)) * (height - top - bottom), value });
    previousTime = time;
  }
  if (current.length) segments.push(current);
  return segments;
}

export const ROUTE_LABELS = { html: 'Documentos HTML', static: 'Recursos estáticos', rest: 'Datos REST', rpc: 'Consultas RPC', poll: 'Actualizaciones periódicas', action: 'Acciones', auth: 'Autenticación', signup: 'Registro', login: 'Inicio de sesión', refresh: 'Renovación de sesión', email: 'Correo', discord: 'Discord', ingress: 'Entrada web', storage: 'Archivos', realtime: 'Tiempo real', function: 'Funciones', other: 'Otros', metadata: 'Metadatos', preflight: 'Preflight', internal: 'Interno' };
export const SERVICE_LABELS = { running: 'En ejecución', healthy: 'Correcto', unhealthy: 'Degradado', active: 'Activo', inactive: 'Inactivo', failed: 'Error', exited: 'Finalizado', restarting: 'Reiniciando', unknown: 'Sin estado', stopped: 'Detenido' };
export const ALERT_LABELS = { cpu_busy: 'Uso elevado de CPU', cpu_pressure: 'Presión de CPU', memory_low: 'Memoria disponible baja', swap_used: 'Uso elevado de swap', swap_activity: 'Actividad de intercambio de memoria', disk_full: 'Espacio en disco bajo', connection_pressure: 'Conexiones de base de datos elevadas', database_blocked: 'Consultas esperando bloqueos', database_idle_transaction: 'Transacciones abiertas sin actividad', oom_recent: 'Evento de memoria agotada', service_restarted: 'Reinicio de un servicio', service_unhealthy: 'Servicio degradado', collector_partial: 'Lectura parcial', traffic_5xx: 'Errores HTTP del servidor', source_unavailable: 'Fuente de datos no disponible' };
