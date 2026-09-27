// Fechas en español y utilidades de calendario (semana de lunes a domingo).
// Las fechas de las tarjetas se guardan como texto "AAAA-MM-DD" en hora local.

const LOCALE = 'es-ES';

export const WEEKDAYS_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

const monthFmt = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' });
const shortDayFmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
const longDayFmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const formatMonth = (d) => capitalize(monthFmt.format(d));

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function isSameDay(a, b) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

/** Lunes de la semana de la fecha dada. */
export function startOfWeek(d) {
  const x = startOfDay(d);
  return addDays(x, -((x.getDay() + 6) % 7));
}

/** Date → "AAAA-MM-DD" (hora local). */
export function toKey(d) {
  const x = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

/** "AAAA-MM-DD" → Date a medianoche local. */
export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const todayKey = () => toKey(new Date());

/** ¿La tarjeta tiene fecha dentro de los próximos N días (o ya pasada)? */
export function dueWithin(content, days) {
  return Boolean(content.date) && content.date <= toKey(addDays(new Date(), days));
}

/** "Hoy", "Mañana", "Ayer" o "Lun, 5 oct". */
export function formatDayKey(key, { long = false } = {}) {
  if (!key) return 'Sin fecha';
  const d = parseKey(key);
  const today = new Date();
  if (isSameDay(d, today)) return 'Hoy';
  if (isSameDay(d, addDays(today, 1))) return 'Mañana';
  if (isSameDay(d, addDays(today, -1))) return 'Ayer';
  return capitalize((long ? longDayFmt : shortDayFmt).format(d).replace(/\./g, ''));
}

export function formatWhen(date, time) {
  if (!date) return 'Sin fecha';
  return time ? `${formatDayKey(date)}, ${time}` : formatDayKey(date);
}

// ---------- Duraciones de la escaleta ----------

const pad2 = (n) => String(n).padStart(2, '0');

/** 95 → "01:35"; 3725 → "1:02:05". */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${pad2(m)}:${pad2(s % 60)}`;
}

/**
 * Interpreta lo que escribe el usuario: "1:30" (min:seg), "1:02:30"
 * (h:min:seg), "90s", "5m", "1h" o un número suelto (minutos).
 * Devuelve segundos o null si no se entiende.
 */
export function parseDuration(input) {
  const s = String(input).trim().toLowerCase().replace(',', '.');
  if (!s) return 0;
  if (/^\d+(:\d{1,2}){1,2}$/.test(s)) {
    const parts = s.split(':').map(Number);
    if (parts.slice(1).some((n) => n >= 60)) return null;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(h|m|min|s|seg)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] || 'm';
  const factor = unit === 'h' ? 3600 : unit.startsWith('s') ? 1 : 60;
  return Math.round(n * factor);
}
