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

// Explicit staff projection: queue identities are limited to the account reference
// and public game names needed to find a player. Never project mail or credentials.
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
  const map_plays = value.map_plays == null ? null : rows(value.map_plays, 64, row => ({
    game_id: gameId(row.game_id), mode: text(row.mode, 80), map_name: text(row.map_name, 120),
    played_matches: count(row.played_matches), played_matches_24h: count(row.played_matches_24h),
    last_played_at: row.last_played_at === null ? null : date(row.last_played_at),
    active_in_pool: typeof row.active_in_pool === 'boolean' ? row.active_in_pool : fail(),
  }));
  if (map_plays) {
    if (value.map_plays_window !== 'all_time' || value.map_plays_criterion !== 'confirmed_results') fail();
    const references = new Set();
    for (const row of map_plays) {
      const reference = JSON.stringify([row.game_id, row.mode, row.map_name]);
      if (references.has(reference) || row.played_matches_24h > row.played_matches
        || (row.played_matches === 0) !== (row.last_played_at === null)
        || row.last_played_at && Date.parse(row.last_played_at) > Date.parse(observed_at)) fail();
      references.add(reference);
    }
  }
  const queue_players = value.queue_players == null ? null : rows(value.queue_players, 200, row => ({
    user_id: id(row.user_id), username: text(row.username, 100),
    gamertag: row.gamertag === null ? null : text(row.gamertag, 100),
    activision_id: row.activision_id === null ? null : text(row.activision_id, 100),
    queue_id: id(row.queue_id), queue_title: text(row.queue_title),
    party_id: row.party_id === null ? null : id(row.party_id), party_size: count(row.party_size),
    joined_at: date(row.joined_at), presence_expires_at: date(row.presence_expires_at), wait_seconds: seconds(row.wait_seconds),
  }));
  if (queue_players) {
    const users = new Set(), parties = new Map(), observed = Date.parse(observed_at);
    for (const row of queue_players) {
      const userKey = row.user_id.toLowerCase();
      if (users.has(userKey) || !row.username.trim() || row.party_size < 1 || row.party_size > 4
        || (!row.party_id && row.party_size !== 1) || Date.parse(row.joined_at) > observed
        || Date.parse(row.presence_expires_at) <= observed
        || Math.abs(row.wait_seconds - (observed - Date.parse(row.joined_at)) / 1000) > 2) fail();
      users.add(userKey);
      if (row.party_id) {
        const partyKey = row.party_id.toLowerCase(), previous = parties.get(partyKey);
        if (previous && (previous.queue_id.toLowerCase() !== row.queue_id.toLowerCase() || previous.size !== row.party_size)) fail();
        parties.set(partyKey, {queue_id: row.queue_id, size: row.party_size, count: (previous?.count || 0) + 1});
      }
    }
    // A limited snapshot may omit whole parties, but may never show half a party.
    if ([...parties.values()].some(party => party.count !== party.size)) fail();
  }
  for (const [key, available] of [['map_plays', map_plays !== null], ['queue_players', queue_players !== null]]) {
    truncated[key] = available ? typeof value.truncated?.[key] === 'boolean' ? value.truncated[key] : fail() : null;
  }
  return {schema_version: 1, observed_at, window_started_at, summary, queues, lobby_statuses, active_lobbies, activity_24h, map_activity,
    map_plays, map_plays_window: map_plays ? 'all_time' : null, map_plays_criterion: map_plays ? 'confirmed_results' : null, queue_players, truncated};
}
