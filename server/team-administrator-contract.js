import { HttpError } from './auth.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (status = 400, key = 'invalid') => { throw new HttpError(status, `manager.teamAdmins.${key}`); };
const only = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const id = value => { if (typeof value !== 'string' || !UUID.test(value)) fail(); return value.toLowerCase(); };
const text = (value, max = 100) => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
export const TEAM_ADMIN_ERROR_KEYS = new Set(['invalid', 'forbidden', 'conflict', 'unavailable', 'userUnavailable', 'notFound', 'requestConflict', 'reasonRequired', 'activeRoster', 'accountUnavailable', 'limit', 'captainRequired']);
export function teamAdministratorProblem(code) {
  if (typeof code !== 'string' || !code.startsWith('teams.administration.')) return null;
  const key = code.slice('teams.administration.'.length);
  return TEAM_ADMIN_ERROR_KEYS.has(key) ? `manager.teamAdmins.${key}` : null;
}
export function teamAdministratorPayload(action, target, body = {}) {
  if (action === 'candidates') {
    if (!only(body, ['query']) || typeof body.query !== 'string' || !text(body.query, 40) || body.query.trim().length < 3) fail();
    return { action, query: body.query.trim() };
  }
  if (action === 'overview') { if (!only(body, [])) fail(); return { action, user_id: id(target) }; }
  if (action === 'get') { if (!only(body, [])) fail(); return { action, team_id: id(target) }; }
  if (!['set','convert'].includes(action) || !only(body, action==='convert'?['user_id','captain_id','expected_version','request_id','reason']:['user_id','enabled','expected_version','request_id','reason'])
    || action==='set'&&typeof body.enabled !== 'boolean' || !Number.isSafeInteger(body.expected_version) || body.expected_version < 0
    || !text(body.reason, 500) || body.reason.trim().length < 12) fail();
  return { action, team_id: id(target), user_id: id(body.user_id), ...(action==='convert'?{captain_id:body.captain_id==null?null:id(body.captain_id)}:{enabled:body.enabled}),
    expected_version: body.expected_version, request_id: id(body.request_id), reason: body.reason.trim() };
}
function user(row) {
  if (!object(row) || typeof row.user_id !== 'string' || !UUID.test(row.user_id) || !text(row.username) || !row.username) fail(502, 'unavailable');
  return { user_id: row.user_id.toLowerCase(), username: row.username };
}
/** Project explicit DTO fields; neither identity tokens nor contact details reach the browser. */
export function teamAdministratorResponse(value, payload) {
  if (!object(value)) fail(502, 'unavailable');
  if (payload.action === 'candidates') {
    if (!Array.isArray(value.items) || value.items.length > 20) fail(502, 'unavailable');
    return { items: value.items.map(user) };
  }
  if (payload.action === 'overview') {
    if (value.user_id !== payload.user_id || !text(value.username) || !Array.isArray(value.teams) || value.teams.length > 100) fail(502, 'unavailable');
    return { user_id: payload.user_id, username: value.username, teams: value.teams.map(team => {
      if (!object(team) || !UUID.test(team.team_id || '') || !text(team.name, 200) || !text(team.tag, 40)
        || !Number.isSafeInteger(team.member_count) || team.member_count < 0 || team.member_count > 1000
        || !Array.isArray(team.entitlements) || team.entitlements.length > 100 || !Array.isArray(team.registrations) || team.registrations.length > 100) fail(502, 'unavailable');
      return { team_id: team.team_id, name: team.name, tag: team.tag, member_count: team.member_count,
        entitlements: team.entitlements.map(entry => {
          if (!object(entry) || !['team_pass', 'circuit_pass', 'season_pass', 'tournament_ticket'].includes(entry.kind)
            || entry.season != null && (!Number.isSafeInteger(entry.season) || entry.season < 1 || entry.season > 4)
            || entry.tournament_id != null && !UUID.test(entry.tournament_id)) fail(502, 'unavailable');
          return { kind: entry.kind, ...(entry.season != null ? { season: entry.season } : {}), ...(entry.tournament_id ? { tournament_id: entry.tournament_id } : {}) };
        }), registrations: team.registrations.map(entry => {
          if (!object(entry) || !UUID.test(entry.tournament_id || '') || !text(entry.name, 200)
            || !Number.isSafeInteger(entry.roster_count) || entry.roster_count < 0 || entry.roster_count > 64 || !text(entry.status, 60)) fail(502, 'unavailable');
          return { tournament_id: entry.tournament_id, name: entry.name, status: entry.status, roster_count: entry.roster_count };
        }) };
    }) };
  }
  if (value.team_id !== payload.team_id || !Number.isSafeInteger(value.version) || value.version < 0
    || !Array.isArray(value.items) || value.items.length > 100) fail(502, 'unavailable');
  const result = { team_id: value.team_id, version: value.version, items: value.items.map(entry => {
    if (!text(entry.created_at, 40) || !Number.isFinite(Date.parse(entry.created_at))) fail(502, 'unavailable');
    return { ...user(entry), created_at: entry.created_at };
  }) };
  if (value.competitive_members !== undefined) {
    if (!Array.isArray(value.competitive_members)||value.competitive_members.length>100) fail(502,'unavailable');
    result.competitive_members=value.competitive_members.map(entry=>{
      if (!['lider','jugador','suplente'].includes(entry?.role)) fail(502,'unavailable');
      return {...user(entry),role:entry.role};
    });
  }
  if (['set','convert'].includes(payload.action)) {
    if (value.request_id !== payload.request_id || typeof value.changed !== 'boolean') fail(502, 'unavailable');
    result.request_id = value.request_id; result.changed = value.changed;
  }
  return result;
}
