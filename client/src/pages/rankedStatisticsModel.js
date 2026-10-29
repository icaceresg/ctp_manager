// Ranked statistics for partner and sponsor reports. Every figure here is
// derived from the aggregate CTP report; nothing is estimated in the browser.

export const STATISTICS_PERIODS = Object.freeze([
  { key: '7d', label: '7 días', title: 'Últimos 7 días' },
  { key: '30d', label: '30 días', title: 'Últimos 30 días' },
  { key: '90d', label: '90 días', title: 'Últimos 90 días' },
  { key: 'season', label: 'Temporada', title: 'Temporada actual' },
  { key: 'all', label: 'Histórico', title: 'Todo el histórico' },
]);
export const DEFAULT_STATISTICS_PERIOD = '30d';
export const statisticsPeriod = value => STATISTICS_PERIODS.some(period => period.key === value) ? value : DEFAULT_STATISTICS_PERIOD;
export const periodTitle = key => STATISTICS_PERIODS.find(period => period.key === key)?.title || '';

export const WEEKDAYS = Object.freeze(['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']);
export const MODE_LABELS = Object.freeze({ hardpoint: 'Punto caliente', search_destroy: 'Buscar y destruir', unknown: 'Modo sin registrar' });
export const AGE_BANDS = Object.freeze([
  ['under_18', 'Menores de 18'], ['18_24', '18 a 24 años'], ['25_34', '25 a 34 años'],
  ['35_44', '35 a 44 años'], ['45_plus', '45 años o más'], ['unknown', 'Sin fecha de nacimiento'],
]);
export const PLATFORM_LABELS = Object.freeze({ PC: 'PC', PlayStation: 'PlayStation', Xbox: 'Xbox', Switch: 'Nintendo Switch', Movil: 'Móvil', Otra: 'Otra plataforma' });
export const INTERACTION_KINDS = Object.freeze([
  ['messages', 'Mensajes en el chat de partida'], ['map_votes', 'Votos de mapa'], ['mode_votes', 'Votos de modo'],
  ['result_votes', 'Votos de resultado'], ['skip_votes', 'Votos para cambiar de mapa'],
]);
export const modeLabel = mode => MODE_LABELS[mode] || mode;
export const platformLabel = platform => PLATFORM_LABELS[platform] || platform;

const grouped = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0, useGrouping: 'always' });
const decimal = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: 'always' });
const compactFormat = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 });
const shortDate = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Madrid' });
const dayFormat = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const longDayFormat = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

export const formatNumber = value => Number.isFinite(value) ? grouped.format(value) : '—';
export const formatDecimal = value => Number.isFinite(value) ? decimal.format(value) : '—';
export const formatCompact = value => Number.isFinite(value) ? value < 10_000 ? grouped.format(value) : compactFormat.format(value) : '—';
export const formatShare = (part, whole) => whole > 0 ? `${grouped.format(Math.round(part / whole * 100))} %` : '—';
export const formatDate = value => value ? shortDate.format(new Date(value)) : '—';
export const formatDay = day => dayFormat.format(new Date(`${day}T12:00:00Z`));
export const formatLongDay = day => longDayFormat.format(new Date(`${day}T12:00:00Z`));
export const hourRange = hour => `${String(hour).padStart(2, '0')}:00–${String((hour + 1) % 24).padStart(2, '0')}:00`;
export function formatHours(seconds) {
  const hours = seconds / 3600;
  return hours >= 100 ? formatNumber(Math.round(hours)) : formatDecimal(hours);
}
export function formatMinutes(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const minutes = Math.round(seconds / 60);
  return `${formatNumber(minutes)} min`;
}

export const interactionTotal = window => window ? INTERACTION_KINDS.reduce((total, [key]) => total + window[key], 0) : 0;

/** Signed change against the previous window, or null where no comparison exists. */
export function change(current, previous) {
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return null;
  if (previous === 0) return current === 0 ? { direction: 'flat', label: 'Sin cambios' } : { direction: 'up', label: 'Nuevo' };
  const ratio = (current - previous) / previous, rounded = Math.round(ratio * 100);
  if (rounded === 0) return { direction: 'flat', label: '0 %' };
  return { direction: rounded > 0 ? 'up' : 'down', label: `${rounded > 0 ? '+' : '−'}${grouped.format(Math.abs(rounded))} %` };
}

/** Calendar days the period covers, used for daily averages. */
export function periodDays(data) {
  if (data.period.key === 'all') {
    if (!data.first_match_at) return 0;
    const first = new Date(data.first_match_at), observed = new Date(data.observed_at);
    return Math.max(1, Math.round((Date.UTC(observed.getUTCFullYear(), observed.getUTCMonth(), observed.getUTCDate())
      - Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate())) / 86_400_000) + 1);
  }
  return data.daily.length;
}

export function insights(data) {
  const current = data.current, days = periodDays(data), players = current.unique_players, matches = current.matches_played;
  const known = data.audience.age_bands.filter(row => row.band !== 'unknown'), knownPlayers = known.reduce((total, row) => total + row.players, 0);
  const core = known.filter(row => row.band === '18_24' || row.band === '25_34').reduce((total, row) => total + row.players, 0);
  const adults = known.filter(row => row.band !== 'under_18').reduce((total, row) => total + row.players, 0);
  const peak = data.heatmap.reduce((best, cell) => !best || cell.matches > best.matches ? cell : best, null);
  const finished = matches + current.matches_unfinished;
  return {
    days, interactions: interactionTotal(current),
    secondsPerPlayer: players ? current.player_seconds / players : null,
    matchesPerPlayer: players ? current.player_matches / players : null,
    averageMatchSeconds: matches ? current.match_seconds / matches : null,
    averageDailyPlayers: days ? current.player_days / days : null,
    interactionsPerMatch: matches ? interactionTotal(current) / matches : null,
    returningShare: formatShare(current.returning_players, players),
    groupShare: formatShare(current.group_player_matches, current.player_matches),
    cleanShare: formatShare(matches - current.disputed_matches, matches),
    completionShare: formatShare(matches, finished),
    coreAgeShare: formatShare(core, knownPlayers), adultShare: formatShare(adults, knownPlayers), knownAgePlayers: knownPlayers,
    activationShare: formatShare(data.totals.unique_players, data.registered_accounts),
    peak,
  };
}

/** Bars for the activity chart. Long ranges are grouped by week so bars stay legible. */
export const ACTIVITY_METRICS = Object.freeze([
  { key: 'matches', label: 'Partidas', unit: 'partidas', value: row => row.matches },
  { key: 'players', label: 'Jugadores', unit: 'jugadores', value: row => row.players },
  { key: 'hours', label: 'Horas de juego', unit: 'horas', value: row => row.player_seconds / 3600 },
  { key: 'interactions', label: 'Interacciones', unit: 'interacciones', value: row => row.interactions },
  { key: 'new_players', label: 'Jugadores nuevos', unit: 'jugadores nuevos', value: row => row.new_players },
]);
export function activitySeries(daily, metricKey) {
  const metric = ACTIVITY_METRICS.find(item => item.key === metricKey) || ACTIVITY_METRICS[0];
  if (daily.length <= 120) return { weekly: false, metric, bars: daily.map(row => ({ key: row.day, from: row.day, to: row.day, value: metric.value(row) })) };
  const bars = [];
  for (let index = 0; index < daily.length; index += 7) {
    const week = daily.slice(index, index + 7);
    // Distinct players cannot be added across days: a week shows its daily average.
    const values = week.map(metric.value), total = values.reduce((sum, value) => sum + value, 0);
    bars.push({ key: week[0].day, from: week[0].day, to: week.at(-1).day, value: metric.key === 'players' ? total / week.length : total });
  }
  return { weekly: true, metric, bars };
}
export function niceMaximum(value) {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value)), scaled = value / power;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10) * power;
}
/** Five ordered steps of one hue; zero stays empty. */
export function heatLevel(value, maximum) {
  if (!value || !maximum) return 0;
  return Math.min(5, Math.max(1, Math.ceil(value / maximum * 5)));
}

export function rangeText(data) {
  const { period } = data;
  if (period.key === 'all') return data.first_match_at ? `Desde ${formatDate(data.first_match_at)} hasta ${formatDate(data.observed_at)}` : 'Sin partidas confirmadas todavía';
  return `Del ${formatDate(period.starts_at)} al ${formatDate(period.ends_at)}`;
}

/** Plain-text summary for a partner email or proposal. */
export function summaryText(data) {
  const facts = insights(data), current = data.current, totals = data.totals;
  const delta = key => { const value = change(current[key], data.previous?.[key]); return value && value.direction !== 'flat' ? ` (${value.label} frente al periodo anterior)` : ''; };
  const lines = [
    `Ranked de Connect To Play · ${periodTitle(data.period.key)}${data.period.key === 'season' && data.season ? ` (${data.season.name})` : ''}`,
    `${rangeText(data)} · hora de Madrid`,
    '',
    `• ${formatNumber(current.matches_played)} partidas jugadas${delta('matches_played')}`,
    `• ${formatNumber(current.unique_players)} jugadores únicos, ${formatNumber(current.new_players)} de ellos nuevos${delta('unique_players')}`,
    `• ${formatHours(current.player_seconds)} horas de juego (${formatDecimal((facts.secondsPerPlayer || 0) / 3600)} h por jugador)`,
    `• ${formatNumber(facts.interactions)} interacciones, incluidos ${formatNumber(current.messages)} mensajes de chat`,
    `• Pico de ${formatNumber(current.peak_concurrent_players)} jugadores en partida a la vez y ${formatNumber(current.peak_day_players)} en un solo día`,
    `• ${facts.returningShare} de los jugadores volvió a jugar otro día`,
  ];
  if (facts.knownAgePlayers) lines.push(`• ${facts.coreAgeShare} tiene entre 18 y 34 años (sobre ${formatNumber(facts.knownAgePlayers)} jugadores con edad registrada)`);
  if (data.audience.players) lines.push(`• ${formatShare(data.audience.marketing_opt_in, data.audience.players)} acepta comunicaciones comerciales`);
  if (data.period.key !== 'all') lines.push('', `Histórico: ${formatNumber(totals.matches_played)} partidas, ${formatNumber(totals.unique_players)} jugadores y ${formatHours(totals.player_seconds)} horas de juego${data.first_match_at ? ` desde ${formatDate(data.first_match_at)}` : ''}.`);
  lines.push('', 'Partidas con resultado confirmado. Horas de juego: tiempo de cada jugador desde que se forma la partida hasta el primer voto de resultado, con un máximo de 60 minutos por partida.');
  return lines.join('\n');
}

const csvCell = value => {
  const text = String(value ?? '');
  // Neutralise spreadsheet formulas and quote every cell.
  return `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`;
};
const hoursCell = seconds => (seconds / 3600).toFixed(1).replace('.', ',');
export function statisticsCsv(data) {
  const rows = [['Indicador', 'Periodo', 'Periodo anterior', 'Histórico']];
  const labels = [
    ['matches_played', 'Partidas jugadas'], ['unique_players', 'Jugadores únicos'], ['new_players', 'Jugadores nuevos'],
    ['returning_players', 'Jugadores que repiten'], ['player_matches', 'Participaciones'], ['player_seconds', 'Horas de juego', hoursCell],
    ['match_seconds', 'Horas de partida', hoursCell], ['peak_concurrent_players', 'Pico de jugadores simultáneos'],
    ['peak_day_players', 'Máximo de jugadores en un día'], ['messages', 'Mensajes de chat'], ['map_votes', 'Votos de mapa'], ['mode_votes', 'Votos de modo'],
    ['result_votes', 'Votos de resultado'], ['skip_votes', 'Votos para cambiar de mapa'], ['group_player_matches', 'Participaciones en grupo'],
    ['disputed_matches', 'Partidas con disputa'], ['matches_unfinished', 'Partidas no completadas'], ['new_accounts', 'Cuentas nuevas en CTP'],
  ];
  for (const [key, label, format = value => value] of labels) rows.push([label, format(data.current[key]), data.previous ? format(data.previous[key]) : '', format(data.totals[key])]);
  rows.push(['Interacciones', interactionTotal(data.current), data.previous ? interactionTotal(data.previous) : '', interactionTotal(data.totals)]);
  rows.push([], ['Día', 'Partidas', 'Jugadores', 'Jugadores nuevos', 'Horas de juego', 'Interacciones']);
  for (const day of data.daily) rows.push([day.day, day.matches, day.players, day.new_players, hoursCell(day.player_seconds), day.interactions]);
  rows.push([], ['Audiencia del periodo', 'Jugadores']);
  for (const row of data.audience.platforms) rows.push([`Plataforma: ${platformLabel(row.platform)}`, row.players]);
  for (const [band, label] of AGE_BANDS) { const row = data.audience.age_bands.find(item => item.band === band); if (row) rows.push([`Edad: ${label}`, row.players]); }
  rows.push(['Aceptan comunicaciones comerciales', data.audience.marketing_opt_in], ['Con Discord', data.audience.discord], ['Con X (Twitter)', data.audience.twitter]);
  rows.push([], ['Fuente', `CTP · ${periodTitle(data.period.key)} · ${rangeText(data)} · generado ${formatDate(data.observed_at)}`]);
  return `﻿${rows.map(row => row.map(csvCell).join(';')).join('\r\n')}\r\n`;
}
