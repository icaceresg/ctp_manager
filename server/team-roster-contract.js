import { HttpError } from './auth.js';

// CTP 368 manager_team_roster: administrators manage any club's roster.
// Errors travel as translation keys; the browser translates them.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const REVISION = /^[a-f0-9]{32}$/;
const ROLES = ['lider', 'jugador', 'suplente'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const text = (value, max = 100) => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const fail = (status = 400, key = 'invalid') => { throw new HttpError(status, `manager.teamRoster.error.${key}`); };
const id = value => { if (typeof value !== 'string' || !UUID.test(value)) fail(); return value.toLowerCase(); };
const date = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));

export const TEAM_ROSTER_WRITES = Object.freeze({
  add: ['user_id', 'role', 'move'],
  remove: ['user_id', 'new_leader_id'],
  set_role: ['user_id', 'role'],
  transfer: ['user_id'],
  resolve_request: ['request_id', 'accept'],
  invite: ['user_id'],
  dissolve: ['confirm_name'],
});
/** Fixed CTP machine codes → `manager.teamRoster.error.*` keys. */
export const TEAM_ROSTER_ERRORS = Object.freeze({
  team_roster_invalid: 'invalid', team_roster_not_found: 'notFound', team_roster_conflict: 'conflict',
  team_roster_reason_invalid: 'reason', team_roster_account_unavailable: 'accountUnavailable',
  team_roster_already_member: 'alreadyMember', team_roster_in_other_team: 'inOtherTeam',
  team_roster_other_team_leader: 'otherTeamLeader', team_roster_full: 'full', team_roster_not_member: 'notMember',
  team_roster_heir_required: 'heirRequired', team_roster_last_member: 'lastMember', team_roster_use_transfer: 'useTransfer',
  team_roster_already_leader: 'alreadyLeader', team_roster_request_missing: 'requestMissing',
  team_roster_request_pending: 'requestPending', team_roster_confirm_mismatch: 'confirmMismatch',
});
export function teamRosterProblem(code) {
  return typeof code === 'string' && Object.hasOwn(TEAM_ROSTER_ERRORS, code) ? `manager.teamRoster.error.${TEAM_ROSTER_ERRORS[code]}` : null;
}

export function teamRosterQuery(query) {
  if (typeof query !== 'string' || !text(query, 40) || query.trim().length < 3) fail();
  return { action: 'candidates', query: query.trim() };
}
export function teamRosterRead(teamId) { return { action: 'get', team_id: id(teamId) }; }

/** Only known fields for the chosen action cross the bridge; CTP re-validates every rule. */
export function teamRosterPayload(teamId, body = {}) {
  if (!object(body) || typeof body.action !== 'string' || !Object.hasOwn(TEAM_ROSTER_WRITES, body.action)) fail();
  const fields = TEAM_ROSTER_WRITES[body.action];
  if (!only(body, ['action', 'expected_revision', 'reason', ...fields])) fail();
  if (typeof body.expected_revision !== 'string' || !REVISION.test(body.expected_revision)) fail(409, 'conflict');
  if (!text(body.reason, 500) || body.reason.trim().length < 12) fail(400, 'reason');
  const payload = { action: body.action, team_id: id(teamId), expected_revision: body.expected_revision, reason: body.reason.trim() };
  if (fields.includes('user_id')) payload.user_id = id(body.user_id);
  if (fields.includes('request_id')) payload.request_id = id(body.request_id);
  if (body.action === 'set_role' || body.role !== undefined) {
    if (!['jugador', 'suplente'].includes(body.role)) fail();
    payload.role = body.role;
  }
  if (body.move !== undefined) { if (typeof body.move !== 'boolean') fail(); payload.move = body.move; }
  if (body.new_leader_id != null) payload.new_leader_id = id(body.new_leader_id);
  if (body.action === 'resolve_request') { if (typeof body.accept !== 'boolean') fail(); payload.accept = body.accept; }
  if (body.action === 'dissolve') {
    if (!text(body.confirm_name, 100) || !body.confirm_name.trim()) fail(400, 'confirmMismatch');
    payload.confirm_name = body.confirm_name.trim();
  }
  return payload;
}

function person(row, key = 'user_id') {
  if (!object(row) || typeof row[key] !== 'string' || !UUID.test(row[key]) || !text(row.username) || !row.username) fail(502, 'unavailable');
  return { [key]: row[key].toLowerCase(), username: row.username, avatar: text(row.avatar, 2048) ? row.avatar : null };
}
/** Explicit DTO: public usernames, roles and dates. No contact or payment data reaches the browser. */
export function teamRosterResponse(value, payload) {
  if (!object(value)) fail(502, 'unavailable');
  if (payload.action === 'candidates') {
    if (!Array.isArray(value.items) || value.items.length > 20) fail(502, 'unavailable');
    return { items: value.items.map(row => {
      const base = person(row, 'id');
      if (row.team_id != null && (!UUID.test(row.team_id) || !text(row.team_name, 200) || !ROLES.includes(row.team_role))) fail(502, 'unavailable');
      return { ...base, team_id: row.team_id ?? null, team_name: row.team_id ? row.team_name : null, team_role: row.team_id ? row.team_role : null };
    }) };
  }
  if (payload.action === 'dissolve') {
    if (value.dissolved !== true || value.team_id !== payload.team_id) fail(502, 'unavailable');
    return { dissolved: true, team_id: payload.team_id };
  }
  const team = value.team;
  if (!object(team) || team.id !== payload.team_id || !text(team.name, 200) || !text(team.tag, 40)
    || typeof value.revision !== 'string' || !REVISION.test(value.revision) || value.max_members !== 6
    || !Array.isArray(value.members) || value.members.length > 100 || !Array.isArray(value.requests) || value.requests.length > 200) fail(502, 'unavailable');
  const result = {
    team: { id: team.id, name: team.name, tag: team.tag, logo: text(team.logo, 2048) ? team.logo : null, created_at: date(team.created_at) ? team.created_at : null },
    members: value.members.map(row => {
      if (!ROLES.includes(row?.role) || !date(row.joined_at)) fail(502, 'unavailable');
      return { ...person(row), role: row.role, joined_at: row.joined_at };
    }),
    requests: value.requests.map(row => {
      if (!object(row) || typeof row.id !== 'string' || !UUID.test(row.id) || !['solicitud', 'invitacion'].includes(row.kind) || !date(row.created_at)) fail(502, 'unavailable');
      return { id: row.id.toLowerCase(), ...person(row), kind: row.kind, created_at: row.created_at };
    }),
    max_members: 6,
    revision: value.revision,
  };
  if (payload.action !== 'get') {
    if (value.action !== payload.action || typeof value.applied !== 'boolean') fail(502, 'unavailable');
    result.action = value.action; result.applied = value.applied;
  }
  return result;
}
