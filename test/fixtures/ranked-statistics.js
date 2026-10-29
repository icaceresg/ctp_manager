// A CTP Ranked statistics report whose figures agree with each other the way
// the SQL reader's do (daily, heatmap, modes and audience add up to the window).
const OBSERVED = '2026-10-29T11:00:00Z';
const DAY = 86_400_000;
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);

function days(count, offset = 0) {
  return Array.from({ length: count }, (_, index) => {
    const position = index + offset, matches = position % 7 === 6 ? 0 : 3 + (position % 4);
    return {
      day: new Date(Date.parse('2026-10-29T12:00:00Z') - (count - 1 - index) * DAY).toISOString().slice(0, 10),
      matches, players: matches * 6, new_players: matches ? 1 : 0, player_seconds: matches * 8 * 1200, interactions: matches * 40,
    };
  });
}

function windowFrom(daily, scale = 1) {
  const matches = sum(daily, 'matches'), seats = matches * 8, playerDays = sum(daily, 'players');
  const fresh = sum(daily, 'new_players'), unique = Math.min(playerDays, Math.max(fresh, ...daily.map(row => row.players), 60));
  return {
    matches_played: matches, matches_unfinished: Math.round(matches / 20), disputed_matches: Math.min(matches, 2 * scale),
    unique_players: unique, player_matches: seats, group_player_matches: matches * 2, new_players: fresh,
    returning_players: Math.max(0, unique - fresh), player_days: playerDays, active_days: daily.filter(row => row.matches).length,
    peak_day_players: Math.max(0, ...daily.map(row => row.players)), peak_concurrent_players: Math.min(seats, 16),
    match_seconds: matches * 1200, player_seconds: seats * 1200,
    messages: matches * 20, map_votes: matches * 8, mode_votes: matches * 6, result_votes: matches * 5, skip_votes: matches,
    new_accounts: 12 * scale,
  };
}

function grow(window, factor) {
  return Object.fromEntries(Object.entries(window).map(([key, value]) => [key, value * factor]));
}

export function statisticsFixture(period = '30d') {
  const count = { '7d': 7, '30d': 30, '90d': 90, season: 12, all: 40 }[period];
  const daily = days(count);
  const current = windowFrom(daily);
  const totals = period === 'all' ? current : { ...grow(current, 3), peak_concurrent_players: current.peak_concurrent_players, peak_day_players: current.peak_day_players * 3 };
  const startDay = daily[0].day;
  const starts = period === 'all' ? null : period === 'season' ? `${startDay}T16:00:00Z` : `${startDay}T00:00:00+01:00`;
  const rolling = ['7d', '30d', '90d'].includes(period);
  const previous = rolling ? windowFrom(days(count, 3)) : null;
  const heatmap = [];
  for (const row of daily.filter(item => item.matches)) {
    const weekday = new Date(`${row.day}T12:00:00Z`).getUTCDay() || 7;
    for (const [hour, share] of [[21, Math.ceil(row.matches / 2)], [19, Math.floor(row.matches / 2)]]) {
      if (!share) continue;
      const cell = heatmap.find(item => item.weekday === weekday && item.hour === hour);
      if (cell) cell.matches += share; else heatmap.push({ weekday, hour, matches: share });
    }
  }
  heatmap.sort((a, b) => a.weekday - b.weekday || a.hour - b.hour);
  const hardpoint = Math.ceil(current.matches_played * 2 / 3);
  const players = current.unique_players;
  return {
    schema_version: 1, observed_at: OBSERVED, timezone: 'Europe/Madrid',
    period: {
      key: period, starts_at: starts, ends_at: OBSERVED,
      previous_starts_at: rolling ? new Date(Date.parse(starts) - count * DAY).toISOString() : null,
      previous_ends_at: rolling ? new Date(Date.parse(OBSERVED) - count * DAY).toISOString() : null,
    },
    season: { name: 'Temporada 1 · Otoño', starts_at: period === 'season' ? starts : '2026-09-18T17:00:00Z' },
    first_match_at: period === 'all' ? `${startDay}T19:30:00Z` : '2026-07-02T19:30:00Z',
    registered_accounts: totals.unique_players * 2,
    totals, current, previous, daily, heatmap,
    modes: [{ mode: 'hardpoint', matches: hardpoint }, { mode: 'search_destroy', matches: current.matches_played - hardpoint }].filter(row => row.matches),
    maps: [{ map_name: 'Coal', mode: 'hardpoint', matches: Math.ceil(current.matches_played / 3) }, { map_name: 'Cachette', mode: 'search_destroy', matches: Math.floor(current.matches_played / 4) }].filter(row => row.matches),
    audience: {
      players, marketing_opt_in: Math.floor(players * 0.4), discord: Math.floor(players * 0.6), twitter: Math.floor(players * 0.2),
      platforms: [{ platform: 'PC', players: players - Math.floor(players * 0.3) - Math.floor(players * 0.1) }, { platform: 'PlayStation', players: Math.floor(players * 0.3) }, { platform: 'Xbox', players: Math.floor(players * 0.1) }],
      age_bands: [{ band: '18_24', players: Math.floor(players * 0.45) }, { band: '25_34', players: Math.floor(players * 0.3) }, { band: 'under_18', players: Math.floor(players * 0.1) },
        { band: 'unknown', players: players - Math.floor(players * 0.45) - Math.floor(players * 0.3) - Math.floor(players * 0.1) }],
    },
    truncated: { daily: false },
  };
}
