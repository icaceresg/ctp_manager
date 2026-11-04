import { HttpError } from './auth.js';

// Same two fields a club leader edits in the CTP app. Members, leadership,
// points and branding keep their own flows.
export const CLUB_PROFILE_FIELDS = Object.freeze(['name','tag']);
// Fixed machine codes from manager_update_club_profile (CTP 358); never relay SQL text.
export const CLUB_PROFILE_ERRORS = Object.freeze({
  club_profile_invalid: 'Los datos del club no son válidos.',
  club_profile_not_found: 'El club ya no existe en CTP.',
  club_profile_conflict: 'El club ha cambiado mientras lo editabas. Vuelve a abrirlo y repite el cambio.',
  club_profile_name_invalid: 'El nombre del club debe tener entre 3 y 24 caracteres.',
  club_profile_name_taken: 'Ya hay otro club con ese nombre.',
  club_profile_tag_invalid: 'El tag debe tener de 2 a 8 letras o números, sin espacios.',
});
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new HttpError(400, message); };

export function clubProfileId(id) {
  if (typeof id !== 'string' || !UUID.test(id)) fail('Selecciona un club válido.');
  return id;
}

/** Only changed, known club fields cross the bridge. */
export function clubProfilePayload(id, body = {}) {
  if (!object(body) || Object.keys(body).some(key => !['expected_version','changes'].includes(key))
    || !Number.isSafeInteger(body.expected_version) || body.expected_version < 1) fail('Vuelve a abrir el club antes de guardar.');
  const changes = body.changes;
  if (!object(changes) || Object.keys(changes).some(key => !CLUB_PROFILE_FIELDS.includes(key))) fail('La solicitud contiene campos no admitidos.');
  const out = {};
  for (const [key, raw] of Object.entries(changes)) {
    if (typeof raw !== 'string') fail(CLUB_PROFILE_ERRORS[`club_profile_${key}_invalid`]);
    const value = key === 'tag' ? raw.trim().toUpperCase() : raw.trim();
    if (key === 'name' && ([...value].length < 3 || [...value].length > 24)) fail(CLUB_PROFILE_ERRORS.club_profile_name_invalid);
    if (key === 'tag' && !/^[A-Z0-9]{2,8}$/.test(value)) fail(CLUB_PROFILE_ERRORS.club_profile_tag_invalid);
    out[key] = value;
  }
  if (!Object.keys(out).length) fail('No hay cambios que guardar.');
  return { action: 'update', team_id: clubProfileId(id), expected_version: body.expected_version, changes: out };
}

export function clubProfileResponse(value, id) {
  if (!object(value) || value.id !== id || typeof value.name !== 'string' || value.name.length > 200 || typeof value.tag !== 'string' || value.tag.length > 40
    || !Number.isSafeInteger(value.manager_version) || value.manager_version < 1
    || value.changed !== undefined && !(Array.isArray(value.changed) && value.changed.every(field => CLUB_PROFILE_FIELDS.includes(field)))) {
    throw new HttpError(502, 'CTP ha devuelto un club no válido.');
  }
  return { id: value.id, name: value.name, tag: value.tag, manager_version: value.manager_version, changed: value.changed || [] };
}
