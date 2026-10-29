import { HttpError } from './auth.js';
import { STAFF_KINDS } from '../shared/access.js';

const kinds = new Set(STAFF_KINDS.map(kind => kind.id));
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const fail = message => { throw new HttpError(400, message); };

export function staffDirectoryQuery(query = {}) {
  if (!keys(query, ['query', 'offset', 'limit'])) fail('Consulta de staff no válida.');
  const text = query.query ?? '';
  if (typeof text !== 'string' || text.length > 120) fail('La búsqueda admite hasta 120 caracteres.');
  const integer = (value, fallback, min, max) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) fail('Paginación de staff no válida.');
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < min || number > max) fail('Paginación de staff no válida.');
    return number;
  };
  return { action: 'list', query: text.trim(), offset: integer(query.offset, 0, 0, 1000000), limit: integer(query.limit, 25, 1, 100) };
}

export function staffAccessPayload(userId, body = {}) {
  if (!uuid(userId) || !keys(body, ['staff_kind', 'enabled']) || typeof body.enabled !== 'boolean'
    || body.staff_kind !== null && !kinds.has(body.staff_kind) || body.enabled && body.staff_kind === null) fail('Selecciona una función de staff válida.');
  return { action: 'set', user_id: userId, staff_kind: body.staff_kind, enabled: body.enabled };
}

export function staffDirectoryResponse(value, query) {
  const invalid = () => { throw new HttpError(502, 'CTP ha devuelto un directorio de staff no válido.'); };
  if (!object(value) || !Array.isArray(value.items) || value.items.length > query.limit
    || !Number.isSafeInteger(value.total) || value.total < 0 || value.offset !== query.offset || value.limit !== query.limit) invalid();
  const seen = new Set();
  const items = value.items.map(row => {
    if (!object(row) || !uuid(row.id) || seen.has(row.id) || typeof row.username !== 'string' || row.username.length > 100
      || !['player', 'referee', 'admin'].includes(row.role) || row.staff_kind !== null && !kinds.has(row.staff_kind)
      || typeof row.staff_enabled !== 'boolean' || typeof row.email_confirmed !== 'boolean' || row.email != null && (typeof row.email !== 'string' || row.email.length > 320) || row.staff_updated_at !== null && typeof row.staff_updated_at !== 'string'
      || row.ranked_statistics_enabled !== undefined && typeof row.ranked_statistics_enabled !== 'boolean') invalid();
    seen.add(row.id);
    return { id: row.id, username: row.username, role: row.role, staff_kind: row.staff_kind,
      staff_enabled: row.staff_enabled, staff_updated_at: row.staff_updated_at, email: row.email ?? null, email_confirmed: row.email_confirmed,
      ranked_statistics_enabled: row.ranked_statistics_enabled === true };
  });
  return { items, total: value.total, offset: query.offset, limit: query.limit };
}

export function rankedStatisticsAccessPayload(userId, body = {}) {
  if (!uuid(userId) || !keys(body, ['enabled']) || typeof body.enabled !== 'boolean') fail('Selecciona un permiso de estadísticas válido.');
  return { user_id: userId, enabled: body.enabled };
}

export function rankedStatisticsAccessResponse(value, payload) {
  if (!object(value) || value.id !== payload.user_id || value.enabled !== payload.enabled
    || typeof value.changed !== 'boolean' || value.updated_at !== null && typeof value.updated_at !== 'string') {
    throw new HttpError(502, 'CTP no ha confirmado el permiso de estadísticas.');
  }
  return { id: value.id, enabled: value.enabled, changed: value.changed, updated_at: value.updated_at };
}

export function staffAccessResponse(value, payload) {
  if (!object(value) || value.id !== payload.user_id || value.staff_kind !== null && !kinds.has(value.staff_kind)
    || value.enabled !== payload.enabled || payload.enabled && value.staff_kind !== payload.staff_kind
    || typeof value.changed !== 'boolean' || value.updated_at !== null && typeof value.updated_at !== 'string') throw new HttpError(502, 'CTP no ha confirmado el cambio de staff.');
  return { id: value.id, staff_kind: value.staff_kind, enabled: value.enabled, changed: value.changed, updated_at: value.updated_at };
}
