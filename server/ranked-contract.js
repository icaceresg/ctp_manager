import { HttpError } from './auth.js';
import { date as calendarDate } from './validate.js';
export const RANKED_ACTIONS = Object.freeze(['ranked.season.schedule', 'ranked.season.update', 'ranked.season.cancel']);
const fail = message => { throw new HttpError(400, message); };
export function rankedPayload(type, payload) {
  if (!RANKED_ACTIONS.includes(type) || !payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => !(type === 'ranked.season.cancel' ? ['reason'] : ['name', 'starts_at', 'ends_at', 'reason']).includes(key))) fail('Propuesta Ranked no válida.');
  if (type === 'ranked.season.cancel') {
    if (typeof payload.reason !== 'string' || payload.reason.trim().length < 12 || payload.reason.length > 500) fail('Explica el motivo entre 12 y 500 caracteres.');
    return { reason: payload.reason.trim() };
  }
  if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 120) fail('Nombre de season no válido.');
  if (typeof payload.reason !== 'string' || payload.reason.trim().length < 12 || payload.reason.length > 500) fail('Explica el motivo entre 12 y 500 caracteres.');
  if (['starts_at', 'ends_at'].some(key => typeof payload[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d/.test(payload[key]) || !Number.isFinite(Date.parse(payload[key])))) fail('Fecha de season no válida.');
  for (const key of ['starts_at', 'ends_at']) calendarDate(payload[key].slice(0,10));
  if (Date.parse(payload.ends_at) <= Date.parse(payload.starts_at)) fail('La season debe finalizar después de su inicio.');
  return { name: payload.name.trim(), starts_at: new Date(payload.starts_at).toISOString(), ends_at: new Date(payload.ends_at).toISOString(), reason: payload.reason.trim() };
}
export function rankedState(value) {
  const valid = row => row && /^[0-9a-f-]{36}$/i.test(row.id) && typeof row.name === 'string' && row.name.length <= 120 && Number.isInteger(row.manager_version) && row.manager_version >= 1 && Number.isFinite(Date.parse(row.starts_at));
  if (!value || !valid(value.current) || value.scheduled != null && !valid(value.scheduled) || !Number.isSafeInteger(value.active_matches) || value.active_matches < 0 || !Number.isSafeInteger(value.waiting_players) || value.waiting_players < 0 || value.reset_divisions !== 2 || !Number.isFinite(Date.parse(value.observed_at))) throw new HttpError(502, 'CTP ha devuelto un estado Ranked incompleto.');
  const clean = row => row ? { id: row.id, name: row.name, sequence: row.sequence, starts_at: row.starts_at, ends_at: typeof row.ends_at === 'string' ? row.ends_at : null, manager_version: row.manager_version } : null;
  return { current: clean(value.current), scheduled: clean(value.scheduled), active_matches: value.active_matches, waiting_players: value.waiting_players, reset_divisions: 2, observed_at: value.observed_at };
}
