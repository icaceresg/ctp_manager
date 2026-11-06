import { HttpError } from './auth.js';

const prefix = 'manager.tournamentScenario.error.';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const validCount = count => Number.isInteger(count) && count >= 2 && count <= 256;
const slot = key => /^(?:g:[A-Z]{1,3}:[1-7]:[1-9]\d{0,3}|e:(?:third|[1-8]:[1-9]\d{0,2}))$/.test(key);
const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(date)
  && Number.isFinite(Date.parse(date)) && new Date(date).toISOString() === date;
const version = value => Number.isInteger(value) && value >= 0 && value <= 999999999;
const validDates = dates => object(dates) && Object.keys(dates).length <= 1024 && Object.entries(dates).every(([key, date]) => slot(key) && validDate(date));
const problems = { invalid: 422, start: 422, overlap: 422, order: 422, conflict: 409, forbidden: 403, unavailable: 502 };

export function tournamentScenarioError(code, status) {
  return Object.hasOwn(problems, code) && (problems[code] === status || code === 'unavailable' && status === 404)
    ? new HttpError(status, `${prefix}${code}`) : null;
}

export function tournamentScenarioPayload(id, rawCount, body) {
  const count = typeof rawCount === 'string' && /^\d{1,3}$/.test(rawCount) ? Number(rawCount) : null;
  if (typeof id !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id) || !validCount(count)) throw new HttpError(400, `${prefix}invalid`);
  const common = { tournament_id: id.toLowerCase(), entrant_count: count };
  if (body === null) return { action: 'get', ...common };
  if (!object(body) || Object.keys(body).some(key => !['expected_version','tournament_version','dates'].includes(key))
    || !version(body.expected_version) || !version(body.tournament_version) || !validDates(body.dates)) throw new HttpError(400, `${prefix}invalid`);
  return { action: 'save', ...common, expected_version: body.expected_version, tournament_version: body.tournament_version, dates: body.dates };
}

export function tournamentScenarioResponse(value, payload) {
  const fail = () => { throw new HttpError(502, `${prefix}unavailable`); };
  if (!object(value) || value.entrant_count !== payload.entrant_count || !version(value.version) || !version(value.tournament_version)
    || [value.available_counts,value.saved_counts].some(counts => !Array.isArray(counts) || counts.length > 255 || !counts.every(validCount))
    || !validDates(value.dates) || typeof value.start_at !== 'string' || !Number.isFinite(Date.parse(value.start_at))) fail();
  let scenario = null;
  if (value.scenario != null) {
    const data = value.scenario;
    if (!object(data) || !validCount(data.bracket_size) || !Array.isArray(data.groups) || data.groups.length > 64
      || !Array.isArray(data.fixtures) || data.fixtures.length > 1024) fail();
    const seed = n => Number.isInteger(n) && n >= 1 && n <= 256;
    scenario = {
      bracket_size: data.bracket_size,
      groups: data.groups.map(group => {
        if (!object(group) || !/^[A-Z]{1,3}$/.test(group.label) || !Array.isArray(group.seeds) || group.seeds.length > 7 || !group.seeds.every(seed)) fail();
        return { label: group.label, seeds: group.seeds };
      }),
      fixtures: data.fixtures.map(fixture => {
        if (!object(fixture) || typeof fixture.key !== 'string' || !slot(fixture.key) || !['grupos','eliminacion'].includes(fixture.phase)
          || !Number.isInteger(fixture.round) || fixture.round < 1 || fixture.round > 8
          || !Number.isInteger(fixture.position) || fixture.position < 0 || fixture.position > 2000
          || ![1,3,5,7,9].includes(fixture.best_of) || (fixture.group_label != null && !/^[A-Z]{1,3}$/.test(fixture.group_label))) fail();
        return { key: fixture.key, phase: fixture.phase, group_label: fixture.group_label ?? null, round: fixture.round,
          position: fixture.position, best_of: fixture.best_of, is_third_place: fixture.is_third_place === true,
          seed_a: seed(fixture.seed_a) ? fixture.seed_a : null, seed_b: seed(fixture.seed_b) ? fixture.seed_b : null };
      }),
    };
  }
  return { entrant_count: value.entrant_count, available_counts: value.available_counts, saved_counts: value.saved_counts, scenario, dates: value.dates, version: value.version,
    tournament_version: value.tournament_version, start_at: value.start_at };
}
