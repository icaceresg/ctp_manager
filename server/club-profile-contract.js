import { HttpError } from './auth.js';

// Club profile edited from "Gestionar equipo" (CTP 358 + 372): identity, description
// and the club page (tagline, colours, logo and cover). Members and leadership keep
// the roster flow; points and access keep their own flows.
export const CLUB_PROFILE_FIELDS = Object.freeze(['name','tag','description','tagline','primary_color','secondary_color','logo_path','cover_path']);
const NULLABLE = Object.freeze(['logo_path','cover_path']);
// Fixed machine codes from manager_update_club_profile → translation keys; never relay SQL text.
export const CLUB_PROFILE_ERRORS = Object.freeze({
  club_profile_invalid: 'manager.clubProfile.error.invalid',
  club_profile_not_found: 'manager.clubProfile.error.notFound',
  club_profile_conflict: 'manager.clubProfile.error.conflict',
  club_profile_name_invalid: 'manager.clubProfile.error.name',
  club_profile_name_taken: 'manager.clubProfile.error.nameTaken',
  club_profile_tag_invalid: 'manager.clubProfile.error.tag',
  club_profile_description_invalid: 'manager.clubProfile.error.description',
  club_profile_tagline_invalid: 'manager.clubProfile.error.tagline',
  club_profile_color_invalid: 'manager.clubProfile.error.color',
  club_profile_image_invalid: 'manager.clubProfile.error.image',
});
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const IMAGE = { logo_path: /^[a-f0-9-]{36}\/[a-f0-9-]{36}\.png$/, cover_path: /^[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|webp)$/ };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = key => { throw new HttpError(400, `manager.clubProfile.error.${key}`); };

export function clubProfileId(id) {
  if (typeof id !== 'string' || !UUID.test(id)) fail('invalid');
  return id;
}

/** Only changed, known club fields cross the bridge; CTP re-validates each one. */
export function clubProfilePayload(id, body = {}) {
  if (!object(body) || Object.keys(body).some(key => !['expected_version','changes'].includes(key))
    || !Number.isSafeInteger(body.expected_version) || body.expected_version < 1) fail('conflict');
  const changes = body.changes;
  if (!object(changes) || Object.keys(changes).some(key => !CLUB_PROFILE_FIELDS.includes(key))) fail('invalid');
  const teamId = clubProfileId(id).toLowerCase();
  const out = {};
  for (const [key, raw] of Object.entries(changes)) {
    if (raw === null && NULLABLE.includes(key)) { out[key] = null; continue; }
    if (typeof raw !== 'string') fail(key === 'name' ? 'name' : key === 'tag' ? 'tag' : 'invalid');
    const value = key === 'tag' || key.endsWith('_color') ? raw.trim().toUpperCase() : NULLABLE.includes(key) ? raw : raw.trim();
    if (key === 'name' && ([...value].length < 3 || [...value].length > 24)) fail('name');
    if (key === 'tag' && !/^[A-Z0-9]{2,8}$/.test(value)) fail('tag');
    if (key === 'description' && ([...value].length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))) fail('description');
    if (key === 'tagline' && ([...value].length > 80 || /[\u0000-\u001f\u007f]/.test(value))) fail('tagline');
    if (key.endsWith('_color') && !/^#[0-9A-F]{6}$/.test(value)) fail('color');
    if (NULLABLE.includes(key) && (!IMAGE[key].test(value) || !value.startsWith(`${teamId}/`))) fail('image');
    out[key] = value;
  }
  if (!Object.keys(out).length) fail('noChanges');
  return { action: 'update', team_id: clubProfileId(id), expected_version: body.expected_version, changes: out };
}

export function clubProfileResponse(value, id) {
  if (!object(value) || value.id !== id || typeof value.name !== 'string' || value.name.length > 200 || typeof value.tag !== 'string' || value.tag.length > 40
    || !Number.isSafeInteger(value.manager_version) || value.manager_version < 1
    || value.changed !== undefined && !(Array.isArray(value.changed) && value.changed.every(field => CLUB_PROFILE_FIELDS.includes(field)))) {
    throw new HttpError(502, 'manager.clubProfile.error.unavailable');
  }
  return { id: value.id, name: value.name, tag: value.tag, manager_version: value.manager_version, changed: value.changed || [] };
}
