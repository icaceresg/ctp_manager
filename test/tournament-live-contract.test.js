import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { TOURNAMENT_LIVE_ERRORS, TOURNAMENT_LIVE_MATCH_WRITES, TOURNAMENT_LIVE_WRITES, tournamentArbitrationRead, tournamentArbitrationResponse, tournamentLiveMatchPayload, tournamentLiveMatchRead, tournamentLiveMatchResponse, tournamentLivePayload, tournamentLiveProblem, tournamentLiveQuery, tournamentLiveRead, tournamentLiveResponse, tournamentRegistrationRosterRead } from '../server/tournament-live-contract.js';

const tournament = randomUUID(), match = randomUUID(), participant = randomUUID(), team = randomUUID(), revision = 'b'.repeat(32), reason = 'Resolución arbitral en directo';
const write = extra => ({ expected_revision: revision, reason, ...extra });
const live = extra => ({
  tournament: { id: tournament, name: 'Copa QA', status: 'en_curso', participant_type: 'equipo', max_participants: 8, start_at: '2026-11-06T18:00:00Z', groups_published_at: null, bracket_published_at: '2026-11-05T10:00:00Z', roster_max: 6 },
  participants: [{ id: participant, entrant_kind: 'team', entrant_id: team, name: 'Alpha', seed: 1, roster: ['captain'], email: 'leak@example.com' }],
  matches: [{ id: match, phase: 'eliminacion', group_label: null, round: 1, position: 1, is_third_place: false, best_of: 3,
    entrant_a: { kind: 'team', id: team, name: 'Alpha' }, entrant_b: null, winner_id: null, score_a: null, score_b: null,
    result_status: 'none', pick_ban_status: 'none', scheduled_at: null }],
  revision, ...extra,
});

test('every live correction has a bounded payload', () => {
  assert.deepEqual(Object.keys(TOURNAMENT_LIVE_WRITES), ['set_result', 'revert_result', 'replace_entrant', 'swap_entrants', 'swap_group_entrants', 'place_group_entrant', 'schedule_match', 'set_best_of',
    'substitute_participant', 'add_participant', 'add_team_registration', 'set_registration_roster', 'remove_participant', 'disqualify', 'set_status']);
  assert.deepEqual(tournamentLivePayload(tournament, write({ action: 'set_result', match_id: match, maps_a: 2, maps_b: 1 })),
    { action: 'set_result', tournament_id: tournament, expected_revision: revision, reason, match_id: match, maps_a: 2, maps_b: 1 });
  assert.equal(tournamentLivePayload(tournament, write({ action: 'replace_entrant', match_id: match, side: 'b', participant_id: null })).participant_id, null);
  assert.equal(tournamentLivePayload(tournament, write({ action: 'schedule_match', match_id: match, scheduled_at: '' })).scheduled_at, null);
  assert.equal(tournamentLivePayload(tournament, write({ action: 'schedule_match', match_id: match, scheduled_at: '2026-11-06T20:00:00+01:00' })).scheduled_at, '2026-11-06T19:00:00.000Z');
  assert.deepEqual(tournamentLivePayload(tournament, write({ action: 'set_registration_roster', team_id: team, member_ids: [participant] })),
    { action: 'set_registration_roster', tournament_id: tournament, expected_revision: revision, reason, team_id: team, member_ids: [participant] });
  assert.deepEqual(tournamentLivePayload(tournament, write({ action: 'add_team_registration', team_id: team, member_ids: [] })).member_ids, []);
  assert.deepEqual(tournamentRegistrationRosterRead(tournament, team), { action: 'registration_roster', tournament_id: tournament, team_id: team });
  assert.deepEqual(tournamentLiveRead(tournament), { action: 'get', tournament_id: tournament });
  assert.deepEqual(tournamentLiveQuery(tournament, '  alpha '), { action: 'candidates', tournament_id: tournament, query: 'alpha' });
});

test('malformed corrections never reach CTP', () => {
  for (const body of [
    write({ action: 'set_result', match_id: match, maps_a: '2', maps_b: 1 }), write({ action: 'set_result', match_id: match, maps_a: 2 }),
    write({ action: 'replace_entrant', match_id: match, side: 'c', participant_id: participant }),
    write({ action: 'remove_participant', participant_id: null }), write({ action: 'disqualify' }),
    write({ action: 'set_best_of', match_id: match, best_of: 2 }), write({ action: 'set_status', status: 'borrador' }),
    write({ action: 'add_participant', entrant_kind: 'club', entrant_id: team }), write({ action: 'schedule_match', match_id: match, scheduled_at: 'mañana' }),
    write({ action: 'set_registration_roster', team_id: team, member_ids: [participant, participant.toUpperCase()] }),
    write({ action: 'set_registration_roster', team_id: team, member_ids: [] }),
    write({ action: 'swap_group_entrants', participant_id: participant }),
    write({ action: 'place_group_entrant', participant_id: participant, group_label: ' B ' }),
    write({ action: 'set_result', match_id: match, maps_a: 2, maps_b: 0, points: 3 }), write({ action: 'drop' }),
    { action: 'revert_result', match_id: match, reason }, write({ action: 'revert_result', match_id: match, reason: 'corto' }),
  ]) assert.throws(() => tournamentLivePayload(tournament, body), /manager\.tournamentLive\.error\./);
  assert.throws(() => tournamentLiveRead('nope'));
  assert.throws(() => tournamentLiveQuery(tournament, 'ab'), /error\.query/);
});

test('the response DTO keeps public names and drops anything else', () => {
  const read = tournamentLiveResponse(live(), tournamentLiveRead(tournament));
  assert.equal(read.participants[0].email, undefined);
  assert.equal(read.tournament.roster_max, 6);
  assert.deepEqual(read.matches[0].entrant_a, { kind: 'team', id: team, name: 'Alpha' });
  assert.equal(read.matches[0].pick_ban_status, 'none');
  const payload = tournamentLivePayload(tournament, write({ action: 'set_best_of', match_id: match, best_of: 5 }));
  assert.equal(tournamentLiveResponse(live({ action: 'set_best_of', applied: true }), payload).applied, true);
  assert.throws(() => tournamentLiveResponse(live({ action: 'set_status', applied: true }), payload));
  assert.throws(() => tournamentLiveResponse(live({ revision: 'x' }), tournamentLiveRead(tournament)));
  assert.throws(() => tournamentLiveResponse(live({ tournament: { ...live().tournament, id: randomUUID() } }), tournamentLiveRead(tournament)));
  const candidates = tournamentLiveResponse({ items: [{ kind: 'team', id: team, name: 'Alpha', registered: true, email: 'x' }] }, tournamentLiveQuery(tournament, 'alp'));
  assert.deepEqual(candidates, { items: [{ kind: 'team', id: team, name: 'Alpha', registered: true }] });
  const lineup = tournamentLiveResponse({ members: [{ id: participant, name: 'Captain', selected: true, available: true, activision_id: 'redacted' }] }, tournamentRegistrationRosterRead(tournament, team));
  assert.deepEqual(lineup, { members: [{ id: participant, name: 'Captain', selected: true, available: true }] });
});

test('only fixed CTP codes become translated problems, in every catalogue', () => {
  assert.equal(tournamentLiveProblem('tournament_live_own_match'), 'manager.tournamentLive.error.ownMatch');
  assert.equal(tournamentLiveProblem('constructor'), null);
  assert.equal(tournamentLiveProblem('La ventana está cerrada'), null);
  const keys = [...Object.values(TOURNAMENT_LIVE_ERRORS).map(key => `manager.tournamentLive.error.${key}`), 'manager.tournamentLive.error.writesDisabled', 'manager.tournamentLive.error.unavailable', 'manager.tournamentLive.error.query'];
  for (const lang of ['es', 'en', 'it', 'fr', 'pt', 'de']) {
    const catalogue = JSON.parse(fs.readFileSync(new URL(`../client/src/i18n/locales/${lang}.json`, import.meta.url), 'utf8'));
    for (const key of keys) assert.equal(typeof catalogue[key], 'string', `${lang}:${key}`);
  }
});

test('referees reach the live routes; the integration relays only live_error codes', () => {
  const routes = fs.readFileSync(new URL('../server/routes/integration.js', import.meta.url), 'utf8');
  for (const path of ["'/operations/tournaments/:id/live'", "'/operations/tournaments/:id/live/candidates'", "'/operations/tournaments/:id/live/registration-roster/:teamId'"]) assert.match(routes, new RegExp(`${path.replace(/[/:]/g, m => '\\' + m)},requireAuth,allow\\('arbitraje'\\)`));
  const integration = fs.readFileSync(new URL('../server/integration.js', import.meta.url), 'utf8');
  assert.match(integration, /body\.service === 'tournament_live'[\s\S]*tournamentLiveProblem\(error\?\.live_error\)/);
  assert.match(integration, /tournamentLiveService[\s\S]*canReferee\(user\)[\s\S]*config\.writes/);
});

const step = randomUUID(), message = randomUUID();
const matchView = extra => ({
  tournament: { id: tournament, name: 'Copa QA', status: 'en_curso', pick_ban_turn_seconds: 45, game_id: 'g_mw4' },
  match: { id: match, phase: 'eliminacion', group_label: null, round: 1, position: 1, is_third_place: false, best_of: 3,
    entrant_a: { kind: 'team', id: team, name: 'Alpha' }, entrant_b: null, winner_id: null, score_a: null, score_b: null, result_status: 'none',
    scheduled_at: '2026-11-06T18:00:00Z', pick_ban_status: 'done', pick_ban_ready_a: true, pick_ban_ready_b: false, pick_ban_started_at: null,
    pick_ban_role_choice: 'A', started: false, manager_version: 9 },
  steps: [{ id: step, step_index: 0, map_slot: 1, mode: 'Hardpoint', action: 'ban', actor_side: 'a', map_name: 'Rewind', auto: false, deadline_at: null, decided_at: '2026-11-06T18:01:00Z', match_id: match }],
  pool: [{ mode: 'Hardpoint', name: 'Rewind', image_url: 'javascript:alert(1)', sort_order: 1 }],
  messages: [{ id: message, body: 'tournaments.staff.vetoReset', system: true, created_at: '2026-11-06T18:00:00Z', author_name: null, author_id: randomUUID() }],
  revision, ...extra,
});

test('the referee match page sends exact chat and veto payloads', () => {
  assert.deepEqual(Object.keys(TOURNAMENT_LIVE_MATCH_WRITES), ['chat_send', 'veto_prepare', 'veto_start', 'veto_reset', 'veto_set_step', 'veto_set_control']);
  assert.deepEqual(tournamentLiveMatchRead(tournament, match), { action: 'match_get', tournament_id: tournament, match_id: match });
  assert.deepEqual(tournamentLiveMatchPayload(tournament, match, { action: 'chat_send', body: '  Hola\r\ncapitanes ' }),
    { action: 'chat_send', tournament_id: tournament, match_id: match, body: 'Hola\ncapitanes' });
  assert.deepEqual(tournamentLiveMatchPayload(tournament, match, write({ action: 'veto_set_step', step_index: 2, map_name: ' Rewind ' })),
    { action: 'veto_set_step', tournament_id: tournament, match_id: match, expected_revision: revision, reason, step_index: 2, map_name: 'Rewind' });
  const swap = write({ action: 'veto_set_step', step_index: 2, map_name: 'Rewind', swap_step_index: 1 });
  assert.deepEqual(tournamentLiveMatchPayload(tournament, match, swap), { ...swap, tournament_id: tournament, match_id: match });
  for (const [action, manual_referee] of [['veto_start', true], ['veto_set_control', false]]) {
    const body = write({ action, manual_referee });
    assert.deepEqual(tournamentLiveMatchPayload(tournament, match, body), { ...body, tournament_id: tournament, match_id: match });
  }
  for (const body of [
    write({ action: 'veto_set_control' }), write({ action: 'veto_start', manual_referee: 'true' }), write({ action: 'veto_reset', manual_referee: true }),
    { ...swap, swap_step_index: '1' }, write({ action: 'veto_reset', swap_step_index: 1 }),
    { action: 'chat_send', body: '   ' }, { action: 'chat_send', body: 'x'.repeat(1001) }, { action: 'chat_send', body: 'a\u0007' }, { action: 'chat_send', body: 'hola', reason },
    write({ action: 'veto_reset', step_index: 1 }), { action: 'veto_reset', reason }, write({ action: 'veto_start', reason: 'corto' }),
    write({ action: 'veto_set_step', step_index: '2', map_name: 'Rewind' }), write({ action: 'veto_set_step', step_index: 2 }), write({ action: 'set_result' }),
  ]) assert.throws(() => tournamentLiveMatchPayload(tournament, match, body), /manager\.tournamentLive\.error\./);
  assert.throws(() => tournamentLiveMatchRead(tournament, 'nope'));
});

test('arbitration returns active ticket identifiers and limits roster and chat metadata to match detail', () => {
  const payload = tournamentArbitrationRead(tournament);
  assert.deepEqual(payload, { action: 'arbitration_get', tournament_id: tournament });
  const request = { id: randomUUID(), code: 'CTP-QA', status: 'en_revision', created_at: '2026-11-06T18:00:00Z', description: 'Synthetic private reason' };
  const view = matchView();
  const arbitration = tournamentArbitrationResponse({ tournament: view.tournament, matches: [{ ...view.match, referee_requests: [request] }] }, payload);
  assert.equal(arbitration.matches[0].referee_requests[0].id, request.id);
  assert.equal(arbitration.matches[0].referee_requests[0].description, undefined);
  assert.throws(() => tournamentArbitrationResponse({ tournament: view.tournament, matches: [{ ...view.match, referee_requests: [{ ...request, status: 'cerrado' }] }] }, payload));
  const detail = tournamentLiveMatchResponse({
    ...view,
    match: { ...view.match, pick_ban_manual_referee: true },
    roster: { a: [{ user_id: participant, name: 'QA Player', email: 'hidden@example.invalid' }], b: [] },
    referee_requests: [request],
    messages: [{ ...view.messages[0], author_side: 'b', author_is_staff: true, author_key: revision }],
  }, tournamentLiveMatchRead(tournament, match));
  assert.deepEqual(detail.referee_requests, arbitration.matches[0].referee_requests);
  assert.deepEqual(detail.roster.a, [{ user_id: participant, name: 'QA Player' }]);
  assert.equal(detail.messages[0].author_side, 'b');
  assert.equal(detail.messages[0].author_is_staff, true);
  assert.equal(detail.messages[0].author_key, revision);
  assert.equal(detail.match.pick_ban_manual_referee, true);
  const routes = fs.readFileSync(new URL('../server/routes/integration.js', import.meta.url), 'utf8');
  assert.match(routes, /'\/operations\/tournaments\/:id\/live\/arbitration',requireAuth,allow\('arbitraje'\)/);
});

test('the match DTO keeps the veto, pool and chat but drops ids and unsafe images', () => {
  const read = tournamentLiveMatchResponse(matchView(), tournamentLiveMatchRead(tournament, match));
  assert.equal(read.match.manager_version, undefined);
  assert.equal(read.tournament.game_id, undefined);
  assert.equal(read.steps[0].match_id, undefined);
  assert.equal(read.pool[0].image_url, null);
  assert.equal(read.messages[0].author_id, undefined);
  assert.equal(read.match.pick_ban_status, 'done');
  const reset = tournamentLiveMatchPayload(tournament, match, write({ action: 'veto_reset' }));
  assert.equal(tournamentLiveMatchResponse(matchView({ action: 'veto_reset', applied: true }), reset).applied, true);
  assert.throws(() => tournamentLiveMatchResponse(matchView({ action: 'veto_start', applied: true }), reset));
  assert.throws(() => tournamentLiveMatchResponse(matchView({ match: { ...matchView().match, id: randomUUID() } }), tournamentLiveMatchRead(tournament, match)));
  assert.throws(() => tournamentLiveMatchResponse(matchView({ steps: [{ ...matchView().steps[0], action: 'drop' }] }), tournamentLiveMatchRead(tournament, match)));
  const routes = fs.readFileSync(new URL('../server/routes/integration.js', import.meta.url), 'utf8');
  assert.match(routes, /'\/operations\/tournaments\/:id\/live\/matches\/:matchId',requireAuth,allow\('arbitraje'\)/);
});
