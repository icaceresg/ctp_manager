import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { statisticsFixture } from './fixtures/ranked-statistics.js';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-ranked-statistics-contract-'));
process.env.DATA_DIR = temp; process.env.DB_PATH = ''; process.env.PUBLIC_ORIGIN = ''; process.env.CTP_AUTH_MODE = 'local';
const { rankedStatisticsState, rankedStatisticsPeriod, RANKED_STATISTICS_PERIODS } = await import('../server/ranked-statistics-contract.js');
const { getRankedStatistics } = await import('../server/integration.js');
const { db } = await import('../server/db.js');
const model = await import('../client/src/pages/rankedStatisticsModel.js');
after(() => { db.close(); fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5 }); });

test('every fixed period projects exactly the aggregate report', () => {
  for (const period of RANKED_STATISTICS_PERIODS) assert.deepEqual(rankedStatisticsState(statisticsFixture(period), period), statisticsFixture(period), period);
});

test('the projection drops upstream extras and never forwards identities or secrets', () => {
  const raw = statisticsFixture('30d');
  Object.assign(raw, { credential: 'private', players: [{ username: 'private', email: 'secret@example.test' }] });
  Object.assign(raw.current, { top_player: 'private' });
  Object.assign(raw.audience, { emails: ['secret@example.test'] });
  raw.daily[0].usernames = ['private']; raw.maps[0].room_code = 'private'; raw.season.created_by = 'private';
  const clean = rankedStatisticsState(raw, '30d');
  assert.deepEqual(clean, statisticsFixture('30d'));
  assert.equal(/private|secret@example/.test(JSON.stringify(clean)), false);
});

test('periods are a fixed list and the response must match the requested one', () => {
  assert.equal(rankedStatisticsPeriod(undefined), '30d');
  for (const period of RANKED_STATISTICS_PERIODS) assert.equal(rankedStatisticsPeriod(period), period);
  for (const value of ['365d', '30D', '', 'all;', ['30d'], 30, null]) assert.throws(() => rankedStatisticsPeriod(value), { status: 400 });
  assert.throws(() => rankedStatisticsState(statisticsFixture('7d'), '30d'), { status: 502 });
});

test('inconsistent, unbounded or malformed reports fail closed instead of showing wrong figures', () => {
  const changes = [
    raw => raw.schema_version = 2, raw => raw.timezone = 'UTC', raw => raw.current.matches_played = -1, raw => raw.current.messages = 1.5,
    raw => raw.current.unique_players = raw.current.player_matches + 1, raw => raw.current.new_players = raw.current.unique_players + 1,
    raw => raw.current.disputed_matches = raw.current.matches_played + 1, raw => raw.current.match_seconds = raw.current.matches_played * 3600 + 1,
    raw => raw.current.matches_played = raw.totals.matches_played + 1, raw => raw.previous = null, raw => delete raw.current.skip_votes,
    raw => raw.period.starts_at = '2026-11-01T00:00:00Z', raw => raw.period.previous_ends_at = '2026-10-29T10:00:00Z',
    raw => raw.period.ends_at = '2026-10-29T11:00:01Z', raw => raw.observed_at = 'yesterday',
    raw => raw.daily[0].matches += 1, raw => raw.daily.splice(3, 1), raw => raw.daily[2].day = '2026-02-30',
    raw => raw.daily = Array(401).fill(raw.daily[0]), raw => raw.heatmap[0].hour = 24, raw => raw.heatmap[0].matches += 1,
    raw => raw.heatmap.push({ ...raw.heatmap[0], matches: 1 }), raw => raw.modes[0].matches += 1, raw => raw.modes[0].mode = '',
    raw => raw.maps = Array(13).fill(raw.maps[0]), raw => raw.maps.push({ ...raw.maps[0] }), raw => raw.audience.players += 1,
    raw => raw.audience.marketing_opt_in = raw.audience.players + 1, raw => raw.audience.age_bands[0].band = 'adults',
    raw => raw.audience.platforms[0].players += 1, raw => raw.truncated.daily = 'false', raw => raw.season.name = ' ',
    raw => raw.first_match_at = null, raw => raw.registered_accounts = 1,
  ];
  for (const [index, change] of changes.entries()) {
    const raw = statisticsFixture('30d'); change(raw);
    assert.throws(() => rankedStatisticsState(raw, '30d'), { status: 502 }, `change ${index}`);
  }
  const season = statisticsFixture('season'); season.season = null;
  assert.throws(() => rankedStatisticsState(season, 'season'), { status: 502 });
  const all = statisticsFixture('all'); all.current = { ...all.current, messages: all.current.messages - 1 };
  assert.throws(() => rankedStatisticsState(all, 'all'), { status: 502 });
  const previous = statisticsFixture('all'); previous.previous = statisticsFixture('30d').previous;
  assert.throws(() => rankedStatisticsState(previous, 'all'), { status: 502 });
});

test('a truncated history may omit old days but still cannot invent them', () => {
  const raw = statisticsFixture('all'); raw.truncated.daily = true; raw.daily = raw.daily.slice(10);
  assert.equal(rankedStatisticsState(raw, 'all').daily.length, 30);
  raw.daily[0].matches = raw.current.matches_played + 1;
  assert.throws(() => rankedStatisticsState(raw, 'all'), { status: 502 });
});

test('an empty platform is a valid, honest report', () => {
  const raw = statisticsFixture('all');
  for (const window of [raw.current]) for (const key of Object.keys(window)) window[key] = 0;
  raw.totals = raw.current; raw.daily = []; raw.heatmap = []; raw.modes = []; raw.maps = []; raw.first_match_at = null;
  raw.audience = { players: 0, marketing_opt_in: 0, discord: 0, twitter: 0, platforms: [], age_bands: [] };
  raw.period.starts_at = null; raw.season = null;
  const clean = rankedStatisticsState(raw, 'all');
  assert.equal(clean.current.matches_played, 0);
  assert.equal(model.summaryText(clean).includes('0 partidas jugadas'), true);
});

test('statistics reject anonymous, local-only and non-staff users before the transport', async () => {
  await assert.rejects(getRankedStatistics(null, '30d'), { status: 401 });
  await assert.rejects(getRankedStatistics({ id: 1, is_admin: false, sections: ['operaciones', 'arbitraje'] }, '30d'), { status: 403 });
  await assert.rejects(getRankedStatistics({ id: 1, is_admin: true, auth_mode: 'ctp', ctp_role: 'player' }, '30d'), { status: 403 });
});

test('derived figures, comparisons and partner summary come only from the report', () => {
  const data = statisticsFixture('30d'), facts = model.insights(data);
  assert.equal(facts.days, 30);
  assert.equal(facts.interactions, data.current.messages + data.current.map_votes + data.current.mode_votes + data.current.result_votes + data.current.skip_votes);
  assert.equal(facts.averageMatchSeconds, 1200);
  assert.equal(facts.peak.matches, Math.max(...data.heatmap.map(cell => cell.matches)));
  assert.deepEqual(model.change(120, 100), { direction: 'up', label: '+20 %' });
  assert.deepEqual(model.change(80, 100), { direction: 'down', label: '−20 %' });
  assert.deepEqual(model.change(5, 0), { direction: 'up', label: 'Nuevo' });
  assert.equal(model.change(5, undefined), null);
  assert.equal(model.formatNumber(1803), '1.803');
  const summary = model.summaryText(data);
  assert.match(summary, /Últimos 30 días/);
  assert.match(summary, new RegExp(`${model.formatNumber(data.current.matches_played)} partidas jugadas`));
  assert.match(summary, /horas de juego/);
  assert.match(summary, /Histórico:/);
  assert.equal(model.summaryText(statisticsFixture('all')).includes('Histórico:'), false);
  assert.equal(model.periodDays(statisticsFixture('all')), 40);
});

test('CSV export is spreadsheet-safe and carries indicators, days and audience', () => {
  const data = statisticsFixture('7d'); data.maps[0].map_name = '=HYPERLINK("x")';
  data.audience.platforms[0].platform = '=cmd|calc';
  const csv = model.statisticsCsv(data);
  assert.equal(csv.startsWith('﻿"Indicador";'), true);
  assert.match(csv, /"Partidas jugadas";"\d+";"\d+";"\d+"/);
  assert.match(csv, /"Horas de juego";"\d+,\d"/);
  assert.equal(csv.split('\r\n').filter(line => /^"2026-\d\d-\d\d";/.test(line)).length, 7);
  // Untrusted labels only appear after a fixed prefix, so no cell starts a formula.
  assert.match(csv, /"Plataforma: =cmd\|calc"/);
  assert.equal(/(^|;|\n|﻿)"[=+\-@]/.test(csv), false);
});

test('long ranges are grouped by week without adding distinct players across days', () => {
  const data = statisticsFixture('all');
  data.daily = Array.from({ length: 140 }, (_, index) => ({ day: new Date(Date.UTC(2026, 5, 1) + index * 86_400_000).toISOString().slice(0, 10), matches: 2, players: 10, new_players: 1, player_seconds: 7200, interactions: 5 }));
  const players = model.activitySeries(data.daily, 'players'), matches = model.activitySeries(data.daily, 'matches');
  assert.equal(players.weekly, true); assert.equal(players.bars.length, 20);
  assert.equal(players.bars[0].value, 10); assert.equal(matches.bars[0].value, 14);
  assert.equal(model.activitySeries(data.daily.slice(0, 30), 'hours').bars[0].value, 2);
  assert.equal(model.niceMaximum(37), 50); assert.equal(model.niceMaximum(0), 1);
  assert.equal(model.heatLevel(0, 10), 0); assert.equal(model.heatLevel(10, 10), 5); assert.equal(model.heatLevel(1, 10), 1);
});
