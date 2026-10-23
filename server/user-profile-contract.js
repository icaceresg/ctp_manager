import { HttpError } from './auth.js';

export const USER_PROFILE_FIELDS = Object.freeze(['username','email','gamertag','activision_id','platform','discord','twitter','bio','birthdate']);
export const USER_PLATFORMS = Object.freeze(['PC','PlayStation','Xbox','Switch','Movil','Otra']);
// Fixed machine codes from manager_update_user_profile; never relay SQL text.
export const USER_PROFILE_ERRORS = Object.freeze({
  user_profile_invalid: 'Los datos de la cuenta no son válidos.',
  user_profile_not_found: 'La cuenta ya no existe en CTP.',
  user_profile_conflict: 'La cuenta ha cambiado mientras la editabas. Vuelve a abrirla y repite el cambio.',
  user_profile_username_invalid: 'El nombre de usuario debe tener entre 3 y 20 caracteres: letras, números, espacios, puntos, guiones o guiones bajos.',
  user_profile_username_taken: 'Ese nombre de usuario ya lo usa otra cuenta.',
  user_profile_email_invalid: 'El correo no es válido.',
  user_profile_email_taken: 'Ese correo ya pertenece a otra cuenta.',
  user_profile_gamertag_invalid: 'El gamertag es obligatorio y admite hasta 50 caracteres.',
  user_profile_activision_invalid: 'El ActivisionID debe tener el formato Nombre#1234567.',
  user_profile_activision_taken: 'Ese ActivisionID ya está vinculado a otra cuenta.',
  user_profile_platform_invalid: 'Selecciona una plataforma válida.',
  user_profile_discord_invalid: 'El Discord admite hasta 100 caracteres.',
  user_profile_twitter_invalid: 'El usuario de X admite hasta 50 caracteres.',
  user_profile_bio_invalid: 'La biografía admite hasta 500 caracteres.',
  user_profile_birthdate_invalid: 'La fecha de nacimiento no es válida.',
  user_profile_duplicate: 'Otro dato de la cuenta ya está en uso. Revisa nombre, correo y ActivisionID.',
});
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new HttpError(400, message); };
const optional = (value, max) => value === null || typeof value === 'string' && value.length <= max;

export function userProfileId(id) {
  if (typeof id !== 'string' || !UUID.test(id)) fail('Selecciona una cuenta válida.');
  return id;
}

/** Only changed, known profile fields cross the bridge; role and stats keep their own flows. */
export function userProfilePayload(id, body = {}) {
  if (!object(body) || Object.keys(body).some(key => !['expected_version','changes'].includes(key))
    || !Number.isSafeInteger(body.expected_version) || body.expected_version < 1) fail('Vuelve a abrir la cuenta antes de guardar.');
  const changes = body.changes;
  if (!object(changes) || Object.keys(changes).some(key => !USER_PROFILE_FIELDS.includes(key))) fail('La solicitud contiene campos no admitidos.');
  const out = {};
  for (const [key, raw] of Object.entries(changes)) {
    const value = typeof raw === 'string' ? raw.trim() : raw;
    if (['username','email','gamertag','platform'].includes(key) && (typeof value !== 'string' || !value)) fail(USER_PROFILE_ERRORS[`user_profile_${key}_invalid`]);
    if (!optional(value, 500)) fail(USER_PROFILE_ERRORS.user_profile_invalid);
    if (key === 'username' && (value.length < 3 || value.length > 20 || !/^[\p{L}\p{N}_.\- ]+$/u.test(value))) fail(USER_PROFILE_ERRORS.user_profile_username_invalid);
    if (key === 'email' && (value.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value))) fail(USER_PROFILE_ERRORS.user_profile_email_invalid);
    if (key === 'gamertag' && value.length > 50) fail(USER_PROFILE_ERRORS.user_profile_gamertag_invalid);
    if (key === 'activision_id' && value && !/^[^#\s][^#]{1,23}#[0-9]{4,10}$/.test(value)) fail(USER_PROFILE_ERRORS.user_profile_activision_invalid);
    if (key === 'platform' && !USER_PLATFORMS.includes(value)) fail(USER_PROFILE_ERRORS.user_profile_platform_invalid);
    if (key === 'birthdate' && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(USER_PROFILE_ERRORS.user_profile_birthdate_invalid);
    out[key] = value === '' ? null : value;
  }
  if (!Object.keys(out).length) fail('No hay cambios que guardar.');
  return { action: 'update', user_id: userProfileId(id), expected_version: body.expected_version, changes: out };
}

export function userProfileResponse(value, id) {
  const text = (field, max) => value[field] === null || typeof value[field] === 'string' && value[field].length <= max;
  if (!object(value) || value.id !== id || typeof value.username !== 'string' || !text('email', 320) || typeof value.gamertag !== 'string'
    || !text('activision_id', 40) || !USER_PLATFORMS.includes(value.platform) || !text('discord', 200) || !text('twitter', 100) || !text('bio', 2000)
    || !text('birthdate', 10) || !['player','referee','admin'].includes(value.role) || !Number.isSafeInteger(value.manager_version)
    || value.changed !== undefined && !(Array.isArray(value.changed) && value.changed.every(field => USER_PROFILE_FIELDS.includes(field)))) {
    throw new HttpError(502, 'CTP ha devuelto una cuenta no válida.');
  }
  const out = {};
  for (const key of ['id','username','email','gamertag','activision_id','platform','discord','twitter','bio','birthdate','role','avatar','created_at','manager_version']) out[key] = value[key] ?? null;
  out.email_confirmed = value.email_confirmed === true;
  if (value.changed) out.changed = value.changed;
  return out;
}
