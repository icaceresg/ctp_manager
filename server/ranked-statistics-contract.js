import { HttpError } from './auth.js';

/** Fixed report periods. CTP computes every bound; Manager never sends dates. */
export const RANKED_STATISTICS_PERIODS = Object.freeze(['7d', '30d', '90d', 'season', 'all']);
export const RANKED_STATISTICS_DEFAULT_PERIOD = '30d';
export const RANKED_STATISTICS_AGE_BANDS = Object.freeze(['under_18', '18_24', '25_34', '35_44', '45_plus', 'unknown']);
export const RANKED_STATISTICS_WINDOW_KEYS = Object.freeze([
  'matches_played', 'matches_unfinished', 'disputed_matches', 'unique_players', 'player_matches', 'group_player_matches',
  'new_players', 'returning_players', 'player_days', 'active_days', 'peak_day_players', 'peak_concurrent_players',
  'match_seconds', 'player_seconds', 'messages', 'map_votes', 'mode_votes', 'result_votes', 'skip_votes', 'new_accounts',
]);
const ROLLING = ['7d', '30d', '90d'];
const MAX_MATCH_SECONDS = 3600;

const fail = () => { throw new HttpError(502, 'CTP ha devuelto unas estadísticas de Ranked incompletas.'); };
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : fail();
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max ? value : fail();
const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max ? value : fail();
const date = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : fail();
const nullableDate = value => value === null ? null : date(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : fail();
const rows = (value, max, clean) => Array.isArray(value) && value.length <= max ? value.map(row => clean(object(row))) : fail();
const time = value => value === null ? null : Date.parse(value);
const sum = (list, key) => list.reduce((total, row) => total + row[key], 0);
const unique = (list, key) => new Set(list.map(key)).size === list.length || fail();

export function rankedStatisticsPeriod(value) {
  if (value === undefined) return RANKED_STATISTICS_DEFAULT_PERIOD;
  if (typeof value !== 'string' || !RANKED_STATISTICS_PERIODS.includes(value)) throw new HttpError(400, 'El periodo de las estadísticas no es válido.');
  return value;
}

/** One window of headline figures, with the relations every real count obeys. */
function figures(value) {
  object(value);
  const row = Object.fromEntries(RANKED_STATISTICS_WINDOW_KEYS.map(key => [key, count(value[key])]));
  if (row.unique_players > row.player_days || row.player_days > row.player_matches
    || row.group_player_matches > row.player_matches || row.new_players > row.unique_players
    || row.returning_players > row.unique_players || row.peak_day_players > row.unique_players
    || row.active_days > row.player_days || row.disputed_matches > row.matches_played
    || row.peak_concurrent_players > row.player_matches || row.match_seconds > row.matches_played * MAX_MATCH_SECONDS
    || row.matches_played === 0 && (row.player_matches || row.match_seconds || row.unique_players)) fail();
  return row;
}

// Aggregate projection only: no player, message, contact or birth-date field
// is accepted from CTP or forwarded to the browser.
export function rankedStatisticsState(value, period) {
  if (!value || value.schema_version !== 1 || value.timezone !== 'Europe/Madrid') fail();
  const observed_at = date(value.observed_at), observed = Date.parse(observed_at);
  const raw = object(value.period);
  if (raw.key !== period) fail();
  const range = {
    key: period, starts_at: nullableDate(raw.starts_at), ends_at: date(raw.ends_at),
    previous_starts_at: nullableDate(raw.previous_starts_at), previous_ends_at: nullableDate(raw.previous_ends_at),
  };
  const [starts, previousStarts, previousEnds] = [time(range.starts_at), time(range.previous_starts_at), time(range.previous_ends_at)];
  if (Date.parse(range.ends_at) !== observed) fail();
  if (ROLLING.includes(period)) {
    if (starts === null || previousStarts === null || previousEnds === null || !(previousStarts < previousEnds && previousEnds <= starts && starts <= observed)) fail();
  } else if (range.previous_starts_at !== null || range.previous_ends_at !== null || (period === 'all') !== (starts === null) || starts > observed) fail();
  const season = value.season === null ? null : { name: text(object(value.season).name, 120), starts_at: date(value.season.starts_at) };
  if (period === 'season' && (!season || Date.parse(season.starts_at) !== starts)) fail();
  const first_match_at = nullableDate(value.first_match_at);
  if (first_match_at !== null && Date.parse(first_match_at) > observed) fail();
  const registered_accounts = count(value.registered_accounts);
  const totals = figures(value.totals), current = figures(value.current);
  const previous = ROLLING.includes(period) ? figures(value.previous) : value.previous === null ? null : fail();
  if ((first_match_at === null) !== (totals.matches_played === 0) || totals.unique_players > registered_accounts) fail();
  for (const key of ['matches_played', 'player_matches', 'unique_players', 'match_seconds', 'player_seconds', 'messages', 'map_votes', 'mode_votes', 'result_votes', 'skip_votes', 'new_accounts']) {
    if (current[key] > totals[key] || previous && previous[key] > totals[key]) fail();
  }
  if (period === 'all' && RANKED_STATISTICS_WINDOW_KEYS.some(key => current[key] !== totals[key])) fail();
  const truncated = { daily: typeof object(value.truncated).daily === 'boolean' ? value.truncated.daily : fail() };

  const daily = rows(value.daily, 400, row => ({
    day: typeof row.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.day) && Number.isFinite(Date.parse(`${row.day}T12:00:00Z`)) ? row.day : fail(),
    matches: count(row.matches), players: count(row.players), new_players: count(row.new_players),
    player_seconds: count(row.player_seconds), interactions: count(row.interactions),
  }));
  for (let index = 0; index < daily.length; index++) {
    const row = daily[index];
    if (row.players > current.unique_players || row.new_players > row.players || row.matches > current.matches_played) fail();
    if (index && Date.parse(`${row.day}T12:00:00Z`) - Date.parse(`${daily[index - 1].day}T12:00:00Z`) !== 86_400_000) fail();
  }
  if (!truncated.daily && sum(daily, 'matches') !== current.matches_played) fail();
  if (sum(daily, 'matches') > current.matches_played || sum(daily, 'new_players') > current.new_players) fail();

  const heatmap = rows(value.heatmap, 168, row => ({ weekday: integer(row.weekday, 1, 7), hour: integer(row.hour, 0, 23), matches: integer(row.matches, 1, Number.MAX_SAFE_INTEGER) }));
  unique(heatmap, row => `${row.weekday}:${row.hour}`);
  if (sum(heatmap, 'matches') !== current.matches_played) fail();
  const modes = rows(value.modes, 8, row => ({ mode: text(row.mode, 40), matches: integer(row.matches, 1, Number.MAX_SAFE_INTEGER) }));
  unique(modes, row => row.mode);
  if (sum(modes, 'matches') !== current.matches_played) fail();
  const maps = rows(value.maps, 12, row => ({ map_name: text(row.map_name, 120), mode: text(row.mode, 40), matches: integer(row.matches, 1, current.matches_played) }));
  unique(maps, row => JSON.stringify([row.map_name, row.mode]));

  const people = object(value.audience);
  const audience = {
    players: count(people.players), marketing_opt_in: count(people.marketing_opt_in), discord: count(people.discord), twitter: count(people.twitter),
    platforms: rows(people.platforms, 12, row => ({ platform: text(row.platform, 40), players: integer(row.players, 1, Number.MAX_SAFE_INTEGER) })),
    age_bands: rows(people.age_bands, RANKED_STATISTICS_AGE_BANDS.length, row => ({
      band: RANKED_STATISTICS_AGE_BANDS.includes(row.band) ? row.band : fail(), players: integer(row.players, 1, Number.MAX_SAFE_INTEGER),
    })),
  };
  unique(audience.platforms, row => row.platform); unique(audience.age_bands, row => row.band);
  if (audience.players !== current.unique_players || ['marketing_opt_in', 'discord', 'twitter'].some(key => audience[key] > audience.players)
    || sum(audience.platforms, 'players') !== audience.players || sum(audience.age_bands, 'players') !== audience.players) fail();

  return {
    schema_version: 1, observed_at, timezone: 'Europe/Madrid', period: range, season, first_match_at, registered_accounts,
    totals, current, previous, daily, heatmap, modes, maps, audience, truncated,
  };
}
