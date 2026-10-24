import { HttpError } from './auth.js';

export const RANKED_MONITOR_STATUSES = Object.freeze(['voting', 'drafting', 'ready', 'reported', 'disputed']);
const fail = () => { throw new HttpError(502, 'CTP ha devuelto una lectura de Ranked incompleta.'); };
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : fail();
const seconds = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fail();
const text = (value, max = 160) => typeof value === 'string' && value.length <= max ? value : fail();
const id = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : fail();
const gameId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : fail();
const date = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : fail();
const rows = (value, max, clean) => Array.isArray(value) && value.length <= max ? value.map(row => row && typeof row === 'object' && !Array.isArray(row) ? clean(row) : fail()) : fail();
const status = value => RANKED_MONITOR_STATUSES.includes(value) ? value : fail();
const counts = (value, keys) => {
  if (!value || typeof value !== 'object') fail();
  return Object.fromEntries(keys.map(key => [key, count(value[key])]));
};

// Explicit projection keeps identities and upstream fields out of this read-only view.
export function rankedMonitorState(value) {
  if (!value || value.schema_version !== 1) fail();
  const observed_at = date(value.observed_at), window_started_at = date(value.window_started_at);
  if (Date.parse(window_started_at) > Date.parse(observed_at)) fail();
  const summary = counts(value.summary, ['waiting_players', 'waiting_parties', 'solo_players', 'active_lobbies', 'players_in_lobbies', 'active_queues', 'open_queues']);
  const queues = rows(value.queues, 50, row => ({
    id: id(row.id), title: text(row.title), game_id: gameId(row.game_id), mode: text(row.mode, 80),
    is_open: typeof row.is_open === 'boolean' ? row.is_open : fail(),
    ...counts(row, ['waiting_players', 'waiting_parties', 'solo_players', 'active_lobbies', 'map_count', 'presence_expired_players']),
    wait_avg_seconds: row.wait_avg_seconds === null ? null : seconds(row.wait_avg_seconds),
    wait_max_seconds: row.wait_max_seconds === null ? null : seconds(row.wait_max_seconds),
  }));
  const lobby_statuses = rows(value.lobby_statuses, 5, row => ({status: status(row.status), count: count(row.count)}));
  if (new Set(lobby_statuses.map(row => row.status)).size !== lobby_statuses.length) fail();
  const active_lobbies = rows(value.active_lobbies, 50, row => ({
    id: id(row.id), queue_id: id(row.queue_id), queue_title: text(row.queue_title), status: status(row.status),
    // Selected mode per match (Hardpoint or Search & Destroy); older CTP builds omit it.
    mode: row.mode === undefined || row.mode === null ? null : text(row.mode, 80),
    mode_pending: row.mode_pending === undefined ? false : typeof row.mode_pending === 'boolean' ? row.mode_pending : fail(),
    map_name: row.map_name === null ? null : text(row.map_name, 120), created_at: date(row.created_at),
    deadline_at: row.deadline_at === null ? null : date(row.deadline_at), age_seconds: seconds(row.age_seconds),
    ...counts(row, ['players', 'side_a', 'side_b', 'result_votes', 'open_disputes']),
  }));
  const activity_24h = {...counts(value.activity_24h, ['created_matches', 'completed_matches', 'cancelled_matches', 'disputes_opened', 'map_draws', 'map_skips']),
    duration_avg_seconds: value.activity_24h.duration_avg_seconds === null ? null : seconds(value.activity_24h.duration_avg_seconds)};
  const map_activity = rows(value.map_activity, 64, row => ({game_id: gameId(row.game_id), mode: text(row.mode, 80), map_name: text(row.map_name, 120),
    ...counts(row, ['draws_24h', 'skips_24h']), active_in_pool: typeof row.active_in_pool === 'boolean' ? row.active_in_pool : fail()}));
  const truncated = Object.fromEntries(['queues', 'active_lobbies', 'map_activity'].map(key => [key, typeof value.truncated?.[key] === 'boolean' ? value.truncated[key] : fail()]));
  return {schema_version: 1, observed_at, window_started_at, summary, queues, lobby_statuses, active_lobbies, activity_24h, map_activity, truncated};
}
