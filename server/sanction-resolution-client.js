import { HttpError } from './auth.js';
import {
  SANCTION_NAME_LENGTH, SANCTION_PAGE_SIZE, SANCTION_PDF_BYTES, SANCTION_SCOPES,
  SANCTION_TEXT_LENGTH, sanctionFileName,
} from '../shared/sanction-resolutions.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const operator = /^[A-Za-z0-9._:@-]{1,100}$/;
const base64 = /^[A-Za-z0-9+/]+={0,2}$/;
const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !value.startsWith('0000') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validId = value => typeof value === 'string' && uuid.test(value);
const natural = value => Number.isSafeInteger(value) && value >= 0;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const validText = (value, length) => typeof value === 'string' && value.length <= length && !control.test(value);
const nullable = (value, predicate) => value === null || predicate(value);
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

function failure(status, code) {
  return new HttpError(status, code);
}

function pdf(value) {
  if (!only(value, ['name', 'content_base64']) || !sanctionFileName(value.name)) return null;
  const encoded = value.content_base64;
  if (typeof encoded !== 'string' || encoded.length > Math.ceil(SANCTION_PDF_BYTES / 3) * 4 || !base64.test(encoded)) return null;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > SANCTION_PDF_BYTES || bytes.toString('base64') !== encoded || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') return null;
  return { name: value.name, content_base64: encoded };
}

function fields(value) {
  return SANCTION_SCOPES.includes(value.scope)
    && validText(value.player_name, SANCTION_NAME_LENGTH) && value.player_name.trim() && !/[\r\n\t]/.test(value.player_name)
    && validText(value.reason, SANCTION_TEXT_LENGTH) && value.reason.trim()
    && date(value.starts_on) && nullable(value.ends_on, date)
    && (value.ends_on === null || value.ends_on >= value.starts_on)
    && validText(value.comments, SANCTION_TEXT_LENGTH);
}

function sanctionPayload(value) {
  const invalid = () => { throw failure(422, 'sanction_resolution_invalid'); };
  if (!object(value)) invalid();
  if (value.action === 'list' && only(value, ['action', 'offset']) && natural(value.offset) && value.offset <= 100000) {
    return { action: value.action, offset: value.offset };
  }
  if (value.action === 'document' && only(value, ['action', 'id']) && validId(value.id)) {
    return { action: value.action, id: value.id.toLowerCase() };
  }
  if (value.action !== 'save' || !only(value, ['action', 'id', 'expected_version', 'scope', 'player_name',
    'reason', 'starts_on', 'ends_on', 'comments', 'published', 'document'])
    || !validId(value.id) || !natural(value.expected_version) || value.expected_version >= 2147483647
    || !fields(value) || typeof value.published !== 'boolean') invalid();
  const payload = {
    action: value.action, id: value.id.toLowerCase(), expected_version: value.expected_version,
    scope: value.scope, player_name: value.player_name.trim(), reason: value.reason.trim(),
    starts_on: value.starts_on, ends_on: value.ends_on, comments: value.comments.trim(), published: value.published,
  };
  if (Object.hasOwn(value, 'document')) {
    payload.document = value.document === null ? null : pdf(value.document);
    if (value.document !== null && !payload.document) invalid();
  }
  return payload;
}

function row(value) {
  if (!object(value) || !validId(value.id) || !fields(value) || !natural(value.version) || value.version === 0
    || !nullable(value.document_name, sanctionFileName) || !nullable(value.published_at, time) || !time(value.updated_at)) {
    throw failure(502, 'sanction_resolution_bad_response');
  }
  const { id, version, scope, player_name, reason, starts_on, ends_on, comments, document_name, published_at, updated_at } = value;
  return { id, version, scope, player_name, reason, starts_on, ends_on, comments, document_name, published_at, updated_at };
}

export function createSanctionResolutionClient({ request, actorFor, writesEnabled }) {
  return async (user, input) => {
    if (!user?.id) throw failure(401, 'sanction_resolution_unauthorized');
    if (!user.is_admin || (user.ctp_user_id && user.ctp_role !== 'admin')) throw failure(403, 'sanction_resolution_forbidden');
    const payload = sanctionPayload(input);
    if (payload.action === 'save' && !writesEnabled()) throw failure(403, 'sanction_resolution_forbidden');
    const actor_id = await actorFor(user);
    const boundActor = user.ctp_user_id ? validId(user.ctp_user_id) && actor_id === 'ctp:' + user.ctp_user_id
      : typeof actor_id === 'string' && operator.test(actor_id);
    if (!boundActor) throw failure(403, 'sanction_resolution_forbidden');
    const result = await request({ action: 'admin_service', actor_id, service: 'sanction_resolutions', payload });
    if (payload.action === 'list') {
      if (!Array.isArray(result?.items) || result.items.length > SANCTION_PAGE_SIZE + 1) throw failure(502, 'sanction_resolution_bad_response');
      return { items: result.items.map(row) };
    }
    if (payload.action === 'document') {
      if (result?.document === null) return { document: null };
      const document = pdf(result?.document);
      if (!document) throw failure(502, 'sanction_resolution_bad_response');
      return { document };
    }
    const saved = row(result);
    if (saved.id !== payload.id || saved.version !== payload.expected_version + 1 || Boolean(saved.published_at) !== payload.published) {
      throw failure(502, 'sanction_resolution_bad_response');
    }
    return saved;
  };
}
