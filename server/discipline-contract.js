import { HttpError } from './auth.js';

// Contract for Manager "Sanciones" (CTP migration 240, admin_service "discipline")
// and for closing a CTP account from "Usuarios CTP" (admin_service "users" delete).
// Every value is validated here and again in CTP; remote text never becomes copy.

export const DISCIPLINE_SCOPES = Object.freeze(['tournament_registration', 'challenges', 'ranked']);
export const DISCIPLINE_ERRORS = Object.freeze({
  discipline_invalid: 'La solicitud de sanción no es válida. Revisa los datos.',
  discipline_reason: 'Explica el motivo con al menos 12 caracteres.',
  discipline_period: 'Revisa las fechas: la sanción debe terminar en el futuro, después de empezar y en menos de 10 años.',
  discipline_not_found: 'La cuenta o la sanción ya no existe en CTP.',
  discipline_staff: 'Desde Manager no se puede sancionar a administradores, árbitros ni a tu propia cuenta.',
  discipline_not_active: 'Ese bloqueo de Ranked ya no está vigente.',
  discipline_conflict: 'La sanción ha cambiado mientras la revisabas. Actualiza y vuelve a intentarlo.',
  discipline_request_conflict: 'Esta solicitud ya se usó para otra acción. Vuelve a intentarlo.',
  discipline_rejected: 'CTP ha rechazado la decisión. Una persona implicada o quien recurrió no puede resolverla; pide a otro árbitro que lo haga.',
});
export const USER_DELETE_ERRORS = Object.freeze({
  user_delete_invalid: 'La solicitud de borrado no es válida.',
  user_delete_not_found: 'La cuenta ya no existe o ya estaba eliminada.',
  user_delete_self: 'No puedes eliminar tu propia cuenta.',
  user_delete_staff: 'Es una cuenta de staff. Quítale antes el rol de árbitro o administrador y su acceso a Manager.',
  user_delete_conflict: 'La cuenta ha cambiado mientras la revisabas. Vuelve a abrirla.',
  user_delete_confirm: 'Escribe exactamente el nombre de usuario para confirmar.',
  user_delete_club_leader: 'Lidera un club con más miembros. Transfiere antes el liderazgo o disuelve el club.',
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const PAGE = 25;
const MAX_DAYS = 3650;
const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new HttpError(400, message); };
const invalid = () => { throw new HttpError(502, 'CTP ha devuelto datos de sanciones no válidos.'); };
const uuid = (value, message = DISCIPLINE_ERRORS.discipline_invalid) => { if (typeof value !== 'string' || !UUID.test(value)) fail(message); return value; };
const only = (body, keys) => { if (!object(body) || Object.keys(body).some(key => !keys.includes(key))) fail(DISCIPLINE_ERRORS.discipline_invalid); return body; };
function reasonOf(value, max = 2000) {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (reason.length < 12 || reason.length > max || CONTROL.test(value)) fail(DISCIPLINE_ERRORS.discipline_reason);
  return reason;
}
const version = value => { if (!Number.isSafeInteger(value) || value < 1) fail(DISCIPLINE_ERRORS.discipline_conflict); return value; };

export const disciplineOverviewQuery = () => ({ action: 'overview' });
export function disciplineUsersQuery(query = {}) {
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  const page = query.page === undefined ? 0 : Number(query.page);
  if (q.length > 120 || !Number.isSafeInteger(page) || page < 0 || page > 4000) fail('Búsqueda de usuarios no válida.');
  return { action: 'users', query: q, offset: page * PAGE, limit: PAGE };
}
export const disciplineHistoryQuery = id => ({ action: 'history', user_id: uuid(id, 'Selecciona una cuenta válida.') });

/** A warning carries a message and stays on record; a suspension blocks the chosen areas. */
export function disciplineSanctionPayload(body, now = Date.now()) {
  only(body, ['request_id', 'user_id', 'restriction', 'scopes', 'starts_at', 'ends_at', 'reason']);
  const restriction = body.restriction;
  if (!['warning', 'competition_suspend'].includes(restriction)) fail(DISCIPLINE_ERRORS.discipline_invalid);
  const scopes = Array.isArray(body.scopes) ? body.scopes : null;
  if (!scopes || scopes.some(scope => !DISCIPLINE_SCOPES.includes(scope)) || new Set(scopes).size !== scopes.length) fail(DISCIPLINE_ERRORS.discipline_invalid);
  if (restriction === 'warning' ? scopes.length : !scopes.length) fail(restriction === 'warning' ? DISCIPLINE_ERRORS.discipline_invalid : 'Elige al menos un área de la suspensión.');
  const starts = typeof body.starts_at === 'string' ? Date.parse(body.starts_at) : NaN;
  const ends = typeof body.ends_at === 'string' ? Date.parse(body.ends_at) : NaN;
  if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts || ends <= now || starts < now - 3_600_000 || ends > now + MAX_DAYS * 86_400_000) fail(DISCIPLINE_ERRORS.discipline_period);
  return {
    action: 'sanction', request_id: uuid(body.request_id), user_id: uuid(body.user_id, 'Selecciona una cuenta válida.'), restriction,
    scopes: DISCIPLINE_SCOPES.filter(scope => scopes.includes(scope)), starts_at: new Date(starts).toISOString(), ends_at: new Date(ends).toISOString(),
    reason: reasonOf(body.reason),
  };
}
export function disciplineRevokePayload(id, body) {
  only(body, ['request_id', 'expected_version', 'reason']);
  return { action: 'revoke', request_id: uuid(body.request_id), sanction_id: uuid(id), expected_version: version(body.expected_version), reason: reasonOf(body.reason) };
}
export function disciplineReviewPayload(id, body) {
  only(body, ['request_id', 'expected_version', 'decision', 'reason']);
  if (!['uphold', 'revoke'].includes(body.decision)) fail(DISCIPLINE_ERRORS.discipline_invalid);
  return { action: 'review', request_id: uuid(body.request_id), sanction_id: uuid(id), expected_version: version(body.expected_version), decision: body.decision, reason: reasonOf(body.reason) };
}
export function disciplineLiftPayload(id, body) {
  only(body, ['request_id', 'reason']);
  return { action: 'lift', request_id: uuid(body.request_id), ban_id: uuid(id), reason: reasonOf(body.reason, 500) };
}

const text = (value, max) => typeof value === 'string' && value.length <= max;
const nullableText = (value, max) => value === null || value === undefined || text(value, max);
const date = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const nullableDate = value => value === null || value === undefined || date(value);
const nullableUuid = value => value === null || value === undefined || typeof value === 'string' && UUID.test(value);

/** One sanction or Ranked block, reduced to the fields Manager shows. */
export function disciplineItem(value) {
  if (!object(value) || !['sanction', 'ranked_ban'].includes(value.source) || typeof value.id !== 'string' || !UUID.test(value.id)
    || !['warning', 'suspension', 'ranked_ban'].includes(value.kind) || !['player', 'club'].includes(value.subject_type) || !nullableUuid(value.subject_id)
    || !Array.isArray(value.scopes) || value.scopes.some(scope => !DISCIPLINE_SCOPES.includes(scope))
    || !nullableText(value.subject_name, 200) || !text(value.reason, 2000) || !date(value.starts_at) || !date(value.ends_at) || !nullableDate(value.created_at)
    || !['active', 'scheduled', 'expired', 'revoked'].includes(value.status) || !['none', 'pending', 'upheld', 'revoked'].includes(value.appeal_status)
    || !Number.isSafeInteger(value.version) || value.version < 1
    || !nullableText(value.issued_by_name, 200) || !nullableText(value.revoke_reason, 2000) || !nullableText(value.appeal_reason, 2000) || !nullableText(value.review_reason, 2000)
    || !nullableDate(value.revoked_at) || !nullableDate(value.appealed_at) || !nullableDate(value.reviewed_at)
    || !nullableUuid(value.incident_id) || !nullableUuid(value.lobby_id)
    || value.minutes !== undefined && value.minutes !== null && !Number.isSafeInteger(value.minutes)) invalid();
  const out = {};
  for (const key of ['source', 'id', 'kind', 'subject_type', 'subject_id', 'subject_name', 'reason', 'starts_at', 'ends_at', 'created_at', 'status',
    'issued_by_name', 'incident_id', 'lobby_id', 'revoked_at', 'revoke_reason', 'revoked_by_name', 'appeal_status', 'appeal_reason', 'appealed_at',
    'review_reason', 'reviewed_at', 'reviewed_by_name', 'version', 'minutes']) out[key] = value[key] ?? null;
  for (const key of ['revoked_by_name', 'reviewed_by_name']) if (!nullableText(out[key], 200)) invalid();
  out.scopes = [...value.scopes];
  out.lifted = value.lifted === true;
  return out;
}
const items = list => { if (!Array.isArray(list) || list.length > 1000) invalid(); return list.map(disciplineItem); };

export function disciplineOverviewResponse(value) {
  if (!object(value)) invalid();
  return { generated_at: date(value.generated_at) ? value.generated_at : null, active: items(value.active), appeals: items(value.appeals), recent: items(value.recent) };
}
const account = value => {
  if (!object(value) || typeof value.id !== 'string' || !UUID.test(value.id) || !text(value.username, 100) || !nullableText(value.gamertag, 100)
    || !nullableText(value.avatar, 2000) || !text(value.role, 20) || !nullableText(value.platform, 40) || !nullableDate(value.created_at)) invalid();
  return { id: value.id, username: value.username, gamertag: value.gamertag ?? null, avatar: value.avatar ?? null, role: value.role, platform: value.platform ?? null, created_at: value.created_at ?? null };
};
export function disciplineUsersResponse(value, query) {
  if (!object(value) || !Number.isSafeInteger(value.total) || value.total < 0 || !Array.isArray(value.items) || value.items.length > query.limit) invalid();
  return {
    total: value.total, offset: query.offset, limit: query.limit, page: query.offset / query.limit,
    items: value.items.map(row => {
      const user = account(row);
      if (!nullableDate(row.restricted_until) || !Number.isSafeInteger(row.warnings) || !Number.isSafeInteger(row.history)) invalid();
      return { ...user, restricted_until: row.restricted_until ?? null, warnings: row.warnings, history: row.history };
    }),
  };
}
export function disciplineHistoryResponse(value, id) {
  if (!object(value) || !object(value.user) || value.user.id !== id || !Array.isArray(value.clubs) || value.clubs.length > 50) invalid();
  return {
    user: { ...account(value.user), closed: value.user.closed === true },
    clubs: value.clubs.map(club => {
      if (!object(club) || !nullableUuid(club.id) || !text(club.name, 200) || !nullableText(club.role, 40)) invalid();
      return { id: club.id, name: club.name, role: club.role ?? null };
    }),
    items: items(value.items),
  };
}
export function disciplineWriteResponse(value) {
  if (!object(value)) invalid();
  return { item: disciplineItem(value.item), replayed: value.replayed === true };
}

export function userDeletePayload(id, body) {
  if (!object(body) || Object.keys(body).some(key => !['expected_version', 'confirm_username'].includes(key))) fail(USER_DELETE_ERRORS.user_delete_invalid);
  if (!Number.isSafeInteger(body.expected_version) || body.expected_version < 1) fail(USER_DELETE_ERRORS.user_delete_conflict);
  if (typeof body.confirm_username !== 'string' || !body.confirm_username || body.confirm_username.length > 100) fail(USER_DELETE_ERRORS.user_delete_confirm);
  return { action: 'delete', user_id: uuid(id, 'Selecciona una cuenta válida.'), expected_version: body.expected_version, confirm_username: body.confirm_username };
}
export function userDeleteResponse(value, id) {
  if (!object(value) || value.user_id !== id || !['deleted', 'anonymized'].includes(value.mode) || !nullableText(value.alias, 40)
    || value.kept !== undefined && !(Array.isArray(value.kept) && value.kept.every(entry => text(entry, 120)))) {
    throw new HttpError(502, 'CTP no ha confirmado el borrado de la cuenta.');
  }
  return { user_id: id, mode: value.mode, alias: value.alias ?? null, kept: value.kept ?? [], storage_cleaned: value.storage_cleaned !== false };
}
