import { api } from '../api.js';

export const crm = (action, data = {}) => api.post('/administration/crm', { action, data });
export const LOCALES = [['es', 'Español'], ['en', 'Inglés'], ['it', 'Italiano'], ['fr', 'Francés'], ['pt', 'Portugués'], ['de', 'Alemán']];
export const localeName = id => LOCALES.find(([value]) => value === id)?.[1] || id;
export const PASSES = { team_pass: 'Team Pass', season_pass: 'Season Pass', circuit_pass: 'Circuit Pass', tournament_ticket: 'Entrada de torneo' };
export const ROLES = { player: 'Jugador', referee: 'Árbitro', admin: 'Administrador' };
export const CAMPAIGN_STATES = { draft: 'Borrador', scheduled: 'Programada', testing: 'Prueba A/B en curso', sending: 'Enviando', sent: 'Enviada', cancelled: 'Cancelada' };
export const RECIPIENT_STATES = { queued: 'En cola', delivered: 'Entregado', suppressed: 'No enviado', failed: 'Fallido' };
export const AB_MODES = { none: 'Sin A/B', split: 'A/B 50/50 a toda la audiencia', winner: 'A/B con grupo de prueba y ganador' };
export const CAMPAIGN_TAGS = [{ tag: 'username', label: 'Nombre de usuario' }, { tag: 'gamertag', label: 'Gamertag' }];
export const EMPTY_FILTERS = { consent: 'any', email_confirmed: false, locales: [], roles: [], pass_kinds: [], pass_scope: 'current', team: 'any', tournament: 'any', query: '' };

const AUTH = { confirmation: 'Confirmación de cuenta', recovery: 'Restablecer contraseña', magic: 'Enlace de acceso', invite: 'Invitación a CTP', emailchange: 'Cambio de correo', reauth: 'Código de reautenticación' };
const NOTIFICATIONS = { invitacion_equipo: 'Invitación a un equipo', solicitud_resuelta: 'Solicitud de equipo resuelta', partida_aceptada: 'Partida aceptada', resultado_pendiente: 'Resultado pendiente de confirmar', disputa_abierta: 'Disputa abierta', ticket_actualizado: 'Ticket de soporte actualizado', torneo_proximo: 'Torneo próximo', cambio_ranking: 'Cambio en el ranking', bienvenida: 'Bienvenida', torneo_inscripcion: 'Inscripción en torneo', partido_resuelto: 'Partido resuelto', staff_solicitado: 'Staff solicitado', reto_aceptado: 'Reto aceptado', reto_resultado: 'Resultado de reto' };
export function templateName(key) {
  const [family, kind] = String(key).split('.');
  return (family === 'auth' ? AUTH[kind] : NOTIFICATIONS[kind]) || kind || key;
}
export const templateFamily = key => String(key).startsWith('auth.') ? 'Cuenta y acceso (Supabase Auth)' : 'Avisos de actividad';
export function templateTags(key) {
  if (key === 'auth.reauth') return [{ tag: 'codigo', label: 'Código de verificación' }];
  return String(key).startsWith('auth.') ? [] : CAMPAIGN_TAGS;
}
export const percent = (part, total) => total ? `${Math.round((Number(part) / Number(total)) * 1000) / 10} %` : '—';
export function totals(stats = {}) {
  return Object.values(stats).reduce((sum, row) => Object.fromEntries(['recipients', 'queued', 'delivered', 'suppressed', 'failed', 'opened', 'clicked'].map(key => [key, (sum[key] || 0) + Number(row[key] || 0)])), {});
}
export function filtersSummary(filters = {}) {
  const parts = [];
  if (filters.consent === 'opted_in') parts.push('Con consentimiento comercial'); else if (filters.consent === 'opted_out') parts.push('Sin consentimiento comercial');
  if (filters.email_confirmed) parts.push('Correo confirmado');
  if (filters.pass_kinds?.length) parts.push(`${filters.pass_scope === 'ever' ? 'Ha estado en club con' : 'En club con'} ${filters.pass_kinds.map(kind => PASSES[kind] || kind).join(' o ')}`);
  if (filters.team === 'with') parts.push('En un equipo'); else if (filters.team === 'without') parts.push('Sin equipo');
  if (filters.tournament === 'played') parts.push('Ha jugado torneos'); else if (filters.tournament === 'never') parts.push('Sin torneos');
  if (filters.locales?.length) parts.push(`Idioma: ${filters.locales.map(localeName).join(', ')}`);
  if (filters.roles?.length) parts.push(`Rol: ${filters.roles.map(role => ROLES[role] || role).join(', ')}`);
  if (filters.created_from || filters.created_to) parts.push(`Registro ${filters.created_from || '…'} – ${filters.created_to || '…'}`);
  if (filters.query) parts.push(`Búsqueda «${filters.query}»`);
  return parts.length ? parts.join(' · ') : 'Todas las personas';
}
/** Quita valores vacíos antes de enviar a CTP. */
export function compactFilters(filters = {}) {
  const out = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === '' || value == null || (Array.isArray(value) && !value.length) || (key === 'consent' && value === 'any') || (key === 'team' && value === 'any') || (key === 'tournament' && value === 'any') || (key === 'email_confirmed' && value === false)) continue;
    if (key === 'pass_scope' && !filters.pass_kinds?.length) continue;
    out[key] = value;
  }
  return out;
}
export function blankContent() { return { subject: '', title: '', preheader: '', html: '' }; }
