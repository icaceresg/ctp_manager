import { HttpError } from './auth.js';
export const CLUB_ACTIONS = Object.freeze(['club.create']);
export function manualClubPayload(type, payload) {
  if (type !== 'club.create' || !payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => !['name', 'tag', 'leader_id', 'reason'].includes(key))) throw new HttpError(400, 'Propuesta de club no válida.');
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  if (!uuid(payload.leader_id)
    || typeof payload.name !== 'string' || payload.name.trim().length < 3 || payload.name.trim().length > 24 || typeof payload.tag !== 'string' || !/^[A-Z0-9]{2,8}$/.test(payload.tag)
    || typeof payload.reason !== 'string' || payload.reason.trim().length < 12 || payload.reason.length > 500) throw new HttpError(400, 'Propuesta de club no válida.');
  return { name: payload.name.trim(), tag: payload.tag, leader_id: payload.leader_id, reason: payload.reason.trim() };
}
