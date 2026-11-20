import { canAccess } from '../shared/access.js';
import { CHALLENGE_LIST_STATUSES, CHALLENGE_TICKET_PRIORITIES, CHALLENGE_TICKET_TYPES } from '../shared/challenges.js';
import { HttpError } from './auth.js';

const UUID_PATTERN = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const UUID = new RegExp(`^${UUID_PATTERN}$`, 'i');
const CURSOR = new RegExp(`^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?(?:Z|[+-]\\d{2}:\\d{2})\\|${UUID_PATTERN}$`, 'i');
const isId = value => typeof value === 'string' && UUID.test(value);
const isDate = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const isCursor = value => {
  return typeof value === 'string' && value.length <= 80 && CURSOR.test(value) && isDate(value.split('|')[0]);
};
const invalidQuery = () => { throw new HttpError(400, 'challenge_workspace_invalid'); };
const invalidResponse = () => { throw new HttpError(502, 'challenge_workspace_invalid_response'); };
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : invalidResponse();
const text = (value, max) => typeof value === 'string' && value.length <= max ? value : invalidResponse();
const nullableText = (value, max) => value === null ? null : text(value, max);
const id = value => isId(value) ? value : invalidResponse();
const date = value => isDate(value) ? value : invalidResponse();
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : invalidResponse();
const enumValue = (value, options) => options.includes(value) ? value : invalidResponse();

function workspaceQuery(resource, query) {
  if (resource !== 'statistics' && !Object.hasOwn(CHALLENGE_LIST_STATUSES, resource)) invalidQuery();
  if (resource === 'statistics') {
    if (Object.keys(query).length) invalidQuery();
    return { resource };
  }
  const { status, challenge_id, cursor } = query;
  if (Object.keys(query).some(key => !['status', 'challenge_id', 'cursor'].includes(key))
    || status !== undefined && !CHALLENGE_LIST_STATUSES[resource].includes(status)
    || challenge_id !== undefined && !isId(challenge_id)
    || cursor !== undefined && !isCursor(cursor)) invalidQuery();
  return { resource, status, challenge_id: challenge_id?.toLowerCase(), cursor };
}

function team(value) {
  const row = object(value);
  return { id: id(row.id), name: nullableText(row.name, 160) };
}

function match(row) {
  return {
    id: id(row.id), status: enumValue(row.status, CHALLENGE_LIST_STATUSES.matches),
    scheduled_slot: date(row.scheduled_slot), season: count(row.season),
    poster_team: team(row.poster_team), accepter_team: row.accepter_team === null ? null : team(row.accepter_team),
    winner_team_id: row.winner_team_id === null ? null : id(row.winner_team_id), ticket_count: count(row.ticket_count),
    // Present from CTP migration 443; older backends omit it and direct resolution stays hidden.
    version: row.version === undefined || row.version === null ? null : Number.isSafeInteger(row.version) && row.version > 0 ? row.version : invalidResponse(),
  };
}

function ticket(row) {
  return {
    id: id(row.id), challenge_id: id(row.challenge_id), code: text(row.code, 100),
    type: enumValue(row.type, CHALLENGE_TICKET_TYPES), status: enumValue(row.status, CHALLENGE_LIST_STATUSES.tickets),
    priority: enumValue(row.priority, CHALLENGE_TICKET_PRIORITIES), created_at: date(row.created_at),
    author_name: nullableText(row.author_name, 160), assigned_name: nullableText(row.assigned_name, 160),
  };
}

function statusCounts(value, statuses) {
  object(value);
  if (Object.keys(value).some(key => !statuses.includes(key))) invalidResponse();
  return Object.fromEntries(statuses.map(status => [status, Object.hasOwn(value, status) ? count(value[status]) : 0]));
}

function statistics(value) {
  const observed_at = date(value.observed_at), window_started_at = date(value.window_started_at);
  const total_matches = count(value.total_matches), total_tickets = count(value.total_tickets), active_teams = count(value.active_teams);
  const matches_by_status = statusCounts(value.matches_by_status, CHALLENGE_LIST_STATUSES.matches);
  const tickets_by_status = statusCounts(value.tickets_by_status, CHALLENGE_LIST_STATUSES.tickets);
  const sum = counts => Object.values(counts).reduce((total, n) => total + n, 0);
  if (Date.parse(window_started_at) > Date.parse(observed_at) || sum(matches_by_status) !== total_matches
    || sum(tickets_by_status) !== total_tickets || active_teams > total_matches * 2) invalidResponse();
  return { observed_at, window_started_at, total_matches, total_tickets, active_teams, matches_by_status, tickets_by_status };
}

function workspaceResponse(value, query) {
  object(value);
  if (query.resource === 'statistics') return statistics(value);
  if (!Array.isArray(value.rows) || value.rows.length > 30
    || value.next_cursor !== null && (!isCursor(value.next_cursor) || value.next_cursor === query.cursor || value.rows.length !== 30)) invalidResponse();
  const matches = query.resource === 'matches';
  const rows = value.rows.map(row => (matches ? match : ticket)(object(row)));
  if (new Set(rows.map(row => row.id)).size !== rows.length
    || rows.some(row => query.status && row.status !== query.status
      || query.challenge_id && (matches ? row.id : row.challenge_id) !== query.challenge_id)) invalidResponse();
  return { rows, next_cursor: value.next_cursor };
}

export function createChallengeWorkspaceReader({ request, actorFor }) {
  return async function readChallengeWorkspace(user, resource, query) {
    if (!canAccess(user, 'arbitraje')) throw new HttpError(403, 'challenge_workspace_forbidden');
    const filters = workspaceQuery(resource, query);
    const actor_id = actorFor(user);
    return workspaceResponse(await request({ action: 'challenge_workspace', actor_id, ...filters }), filters);
  };
}
