import { HttpError } from './auth.js';
export const CLUB_ACTIONS = Object.freeze(['club.create']);
export function manualClubPayload(type, payload) {
  if (type !== 'club.create' || !payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => !['name', 'tag', 'leader_id', 'administrator_id', 'reason'].includes(key))) throw new HttpError(400, 'Propuesta de club no válida.');
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const leader = payload.leader_id != null, administrator = payload.administrator_id != null;
  if (leader === administrator || leader && !uuid(payload.leader_id) || administrator && !uuid(payload.administrator_id)
    || typeof payload.name !== 'string' || payload.name.trim().length < 3 || payload.name.trim().length > 24 || typeof payload.tag !== 'string' || !/^[A-Z0-9]{2,8}$/.test(payload.tag)
    || typeof payload.reason !== 'string' || payload.reason.trim().length < 12 || payload.reason.length > 500) throw new HttpError(400, 'manager.teamAdmins.invalidCreate');
  return { name: payload.name.trim(), tag: payload.tag, leader_id: leader ? payload.leader_id : null,
    ...(administrator ? { administrator_id: payload.administrator_id } : {}), reason: payload.reason.trim() };
}
