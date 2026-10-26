// Labels and time helpers for the Sanciones tab. Pure functions: tested in node.

export const SCOPE_LABELS = Object.freeze({ ranked: 'Ranked', challenges: 'Retos', tournament_registration: 'Inscripción en torneos' });
export const SCOPE_ACTIONS = Object.freeze({ ranked: 'Buscar partida en Ranked', challenges: 'Publicar y aceptar retos', tournament_registration: 'Inscribirse en torneos' });
export const KIND_LABELS = Object.freeze({ suspension: 'Suspensión', ranked_ban: 'Bloqueo de Ranked', warning: 'Amonestación' });
export const ROLE_LABELS = Object.freeze({ player: 'Jugador', referee: 'Árbitro', admin: 'Administrador' });
export const WARNING_DAYS = Object.freeze([7, 30, 90, 365]);
const HOUR = 3_600_000, DAY = 24 * HOUR;
export const DURATIONS = Object.freeze([
  { id: '1h', title: '1 hora', ms: HOUR },
  { id: '6h', title: '6 horas', ms: 6 * HOUR },
  { id: '1d', title: '1 día', ms: DAY },
  { id: '3d', title: '3 días', ms: 3 * DAY },
  { id: '7d', title: '1 semana', ms: 7 * DAY },
  { id: '14d', title: '2 semanas', ms: 14 * DAY },
  { id: '30d', title: '1 mes', ms: 30 * DAY },
  { id: '90d', title: '3 meses', ms: 90 * DAY },
  { id: '365d', title: '1 año', ms: 365 * DAY },
]);

export const isStaffRole = role => role === 'admin' || role === 'referee';

/** Same rule as CTP: revoked first, then by dates (the stored status can be stale). */
export function sanctionPeriod(item, now = Date.now()) {
  if (item.status === 'revoked') return 'revoked';
  if (Date.parse(item.ends_at) <= now) return 'expired';
  if (Date.parse(item.starts_at) > now) return 'scheduled';
  return 'active';
}
export const periodLabel = period => ({ active: 'Vigente', scheduled: 'Programada', expired: 'Cumplida', revoked: 'Revocada' })[period] || 'Sin estado';

/** "3 d 4 h", "5 h 12 min", "8 min". Never negative; long periods show months or years. */
export function remainingLabel(ms) {
  const minutes = Math.max(1, Math.ceil(Math.max(0, ms) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days >= 365) { const years = Math.floor(days / 365); return `${years} ${years === 1 ? 'año' : 'años'}${days % 365 >= 30 ? ` y ${Math.floor((days % 365) / 30)} m` : ''}`; }
  if (days >= 60) return `${Math.floor(days / 30)} meses y ${days % 30} d`;
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}
