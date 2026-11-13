import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoFill, counts, groupStage, matchState, nextMatches, playoffRounds, reasonCheck, resultChangeLock, rowTimes, scheduleChanges, scheduleRows, scoreValid, toLocalInput, validScores } from '../client/src/operations/tournamentLiveModel.js';

const team = name => ({ kind: 'team', id: `id-${name}`, name });
const match = (id, round, position, extra = {}) => ({ id, phase: 'eliminatoria', group_label: null, round, position, is_third_place: false, best_of: 3,
  entrant_a: null, entrant_b: null, winner_id: null, score_a: null, score_b: null, result_status: 'none', pick_ban_status: 'none', scheduled_at: null, ...extra });
/** Full single-elimination bracket for `size` entrants (positions 1-based). */
function bracket(size) {
  const out = [];
  const rounds = Math.log2(size);
  for (let round = 1; round <= rounds; round++) for (let position = 1; position <= size / 2 ** round; position++) out.push(match(`r${round}p${position}`, round, position));
  return out;
}

test('playoff rounds are named from the final backwards for every bracket size', () => {
  for (const [size, names] of [[4, ['semi', 'final']], [16, ['ofN', 'quarter', 'semi', 'final']], [128, ['ofN', 'ofN', 'ofN', 'quarter', 'semi', 'final']]]) {
    const { rounds, regular } = playoffRounds(bracket(size));
    assert.deepEqual(rounds.map(round => round.name).slice(-names.length), names.slice(-rounds.length));
    assert.equal(rounds[0].matches.length, size / 2);
    assert.equal(regular, true);
  }
  assert.equal(playoffRounds(bracket(128)).rounds[0].size, 128);
  // A partial first round (byes removed) keeps names but drops connectors.
  const partial = bracket(16).filter(item => !(item.round === 1 && item.position > 6));
  assert.equal(playoffRounds(partial).regular, false);
  assert.equal(playoffRounds(partial).rounds[0].name, 'ofN');
});

test('scores, states and attention follow the series and CTP result states', () => {
  assert.deepEqual(validScores(3), [[2, 0], [2, 1], [1, 2], [0, 2]]);
  assert.deepEqual(validScores(1), [[1, 0], [0, 1]]);
  assert.equal(validScores(5).length, 6);
  assert.equal(scoreValid(5, 3, 2), true);
  assert.equal(scoreValid(5, 2, 2), false);
  const a = team('A'), b = team('B');
  assert.equal(matchState(match('m', 1, 1)), 'waiting');
  assert.equal(matchState(match('m', 1, 1, { entrant_a: a, entrant_b: b })), 'ready');
  assert.equal(matchState(match('m', 1, 1, { entrant_a: a, entrant_b: b, pick_ban_status: 'running' })), 'veto');
  assert.equal(matchState(match('m', 1, 1, { entrant_a: a, entrant_b: b, pick_ban_status: 'done' })), 'playing');
  assert.equal(matchState(match('m', 1, 1, { entrant_a: a, entrant_b: b, result_status: 'pending' })), 'reported');
  assert.equal(matchState(match('m', 1, 1, { entrant_a: a, entrant_b: b, result_status: 'disputed' })), 'disputed');
  assert.equal(matchState(match('m', 1, 1, { entrant_a: a, entrant_b: b, winner_id: a.id, result_status: 'confirmed' })), 'confirmed');
  const list = [match('x', 1, 1, { entrant_a: a, entrant_b: b, result_status: 'disputed' }), match('y', 1, 2, { entrant_a: a, entrant_b: b, pick_ban_status: 'done' })];
  assert.deepEqual(counts(list), { total: 2, attention: 1, live: 1, confirmed: 0 });
});

test('winners advance by position and a result cannot change a protected pairing', () => {
  const list = bracket(8);
  const semi = list.find(item => item.id === 'r2p1');
  Object.assign(semi, { winner_id: 'w', result_status: 'confirmed' });
  const final = list.find(item => item.id === 'r3p1');
  Object.assign(final, { winner_id: 'w', result_status: 'confirmed' });
  const third = match('third', 3, 1, { is_third_place: true });
  list.push(third);
  const first = list.find(item => item.id === 'r1p3');
  assert.equal(nextMatches(first, list).winner.id, 'r2p2');
  assert.equal(nextMatches(list.find(item => item.id === 'r1p2'), list).winner.id, 'r2p1');
  assert.equal(nextMatches(semi, list).loser.id, 'third');
  const source = list.find(item => item.id === 'r1p1');
  source.winner_id = 'winner';
  assert.equal(resultChangeLock(source, list, null), 'downstreamStarted');
  assert.equal(resultChangeLock(source, list, { id: 'winner' }), null);
  assert.equal(resultChangeLock(source, list, { id: 'other' }), 'downstreamStarted');
  assert.equal(resultChangeLock({ phase: 'grupos' }, list, { id: 'winner' }), 'playoffsStarted');
});

test('groups build matchdays and a won/lost table from firm results only', () => {
  const a = team('Alpha'), b = team('Beta'), c = team('Gamma');
  const g = (id, round, position, extra) => match(id, round, position, { phase: 'grupos', group_label: 'A', ...extra });
  const [group] = groupStage([
    g('g1', 1, 1, { entrant_a: a, entrant_b: b, winner_id: a.id, score_a: 2, score_b: 0, result_status: 'confirmed' }),
    g('g2', 2, 1, { entrant_a: b, entrant_b: c, winner_id: c.id, score_a: 1, score_b: 2, result_status: 'confirmed' }),
    g('g3', 3, 1, { entrant_a: a, entrant_b: c, result_status: 'pending' }),
  ]);
  assert.equal(group.rounds.length, 3);
  assert.deepEqual(group.standings.map(row => [row.entrant.name, row.wins, row.losses]), [['Alpha', 1, 0], ['Gamma', 1, 0], ['Beta', 0, 2]]);
});

test('timetable rows follow group matchdays and playoff rounds; changes skip played matches', () => {
  const groups = [1, 2, 3, 4, 5].flatMap(round => ['A', 'B'].map((label, index) => match(`g${label}${round}`, round, index + 1, { phase: 'grupos', group_label: label })));
  const list = [...groups, ...bracket(8)];
  list.find(item => item.id === 'r1p1').winner_id = 'w';
  const rows = scheduleRows(list);
  assert.deepEqual(rows.map(row => row.key), ['g:1', 'g:2', 'g:3', 'g:4', 'g:5', 'r:1', 'r:2', 'r:3']);
  const plan = autoFill(rows, '2026-11-14T11:00', 60);
  assert.equal(plan['g:2'].start, '2026-11-14T12:00');
  assert.equal(plan['r:3'].start, '2026-11-14T18:00');
  plan['r:1'] = { ...plan['r:1'], stagger: 15 };
  const changes = scheduleChanges(rows, plan);
  // 10 group + 3 open quarter-finals + 2 semis + 1 final.
  assert.equal(changes.length, 16);
  const quarters = changes.filter(change => change.row === 'r:1').map(change => toLocalInput(change.scheduled_at));
  assert.deepEqual(quarters, ['2026-11-14T16:00', '2026-11-14T16:15', '2026-11-14T16:30']);
  // Already at the planned time: nothing to send.
  for (const change of changes) list.find(item => item.id === change.match_id).scheduled_at = change.scheduled_at;
  assert.equal(scheduleChanges(scheduleRows(list), plan).length, 0);
  assert.equal(rowTimes(scheduleRows(list).find(row => row.key === 'r:1')).kind, 'range');
  // Played matchdays keep their time and the next pending one takes the first slot.
  for (const item of list.filter(item => item.round === 1 && item.phase === 'grupos')) item.winner_id = 'w';
  const pendingPlan = autoFill(scheduleRows(list), '2026-11-14T11:00', 60);
  assert.equal(pendingPlan['g:1'], undefined);
  assert.equal(pendingPlan['g:2'].start, '2026-11-14T11:00');
});

test('reason check explains how much is missing', () => {
  assert.deepEqual(reasonCheck('corto'), { length: 5, ready: false, missing: 7, tooLong: false });
  assert.equal(reasonCheck('  Error al introducir el marcador  ').ready, true);
  assert.equal(reasonCheck('x'.repeat(501)).tooLong, true);
});

test('referee veto board: slots, current turn, valid corrections and blocks', async () => {
  const { canEditVetoStep, vetoSlots, currentStep, stepChoices, stepSwapChoices, vetoBlocked, vetoActions, vetoTooEarly, systemNotice, chatCheck } = await import('../client/src/operations/tournamentLiveModel.js');
  const s = (id, step_index, map_slot, action, map_name, actor_side = 'a', mode = 'HP') => ({ id, step_index, map_slot, action, map_name, actor_side, mode });
  const steps = [s('1', 0, 1, 'ban', 'Rewind'), s('2', 1, 1, 'ban', 'Skyline', 'b'), s('3', 2, 1, 'pick', 'Hacienda'), s('4', 3, 1, 'side', 'SAS', 'b'), s('5', 4, 2, 'pick', null, 'b', 'SnD')];
  const pool = ['Rewind', 'Skyline', 'Hacienda', 'Vista'].map(name => ({ mode: 'HP', name })).concat([{ mode: 'SnD', name: 'Vista' }]);
  const slots = vetoSlots(steps);
  assert.deepEqual(slots.map(slot => [slot.slot, slot.mode, slot.map, slot.side, slot.sideBy]), [[1, 'HP', 'Hacienda', 'SAS', 'b'], [2, 'SnD', null, null, null]]);
  assert.equal(currentStep(steps).id, '5');
  assert.deepEqual(stepChoices(steps[0], steps, pool), ['Vista']);
  assert.deepEqual(stepChoices(steps[3], steps, pool), ['NKA']);
  const remaining = { ...s('6', 5, 6, 'pick', 'Vista'), automatic_map: true };
  assert.deepEqual(stepChoices(steps[0], [...steps, remaining], pool), ['Vista']);
  assert.deepEqual(stepChoices(remaining, [...steps, remaining], pool), []);
  assert.deepEqual(stepSwapChoices(steps[2], [...steps, remaining], pool).map(step => step.step_index), [0, 1]);
  assert.deepEqual(stepSwapChoices(remaining, [...steps, remaining], pool), []);
  assert.deepEqual(stepSwapChoices(steps[3], steps, pool), []);
  assert.deepEqual(stepSwapChoices(steps[4], steps, pool), []);
  assert.deepEqual(stepChoices(steps[4], [...steps, { ...remaining, mode: 'SnD' }], pool), []);
  const a = team('A'), b = team('B');
  const ready = match('m', 1, 1, { entrant_a: a, entrant_b: b, pick_ban_status: 'ready' });
  assert.equal(vetoBlocked(ready, 'en_curso'), '');
  assert.equal(vetoBlocked({ ...ready, started: true }, 'en_curso'), 'started');
  assert.equal(vetoBlocked({ ...ready, result_status: 'pending' }, 'en_curso'), 'played');
  assert.equal(vetoBlocked(ready, 'finalizado'), 'closed');
  assert.equal(vetoBlocked(match('m', 1, 1), 'en_curso'), 'incomplete');
  assert.deepEqual(vetoActions(ready), ['veto_start', 'startManual', 'veto_reset']);
  assert.deepEqual(vetoActions({ pick_ban_status: 'none' }), ['veto_prepare']);
  assert.deepEqual(vetoActions({ pick_ban_status: 'running' }), ['takeControl', 'veto_reset']);
  assert.deepEqual(vetoActions({ pick_ban_status: 'running', pick_ban_manual_referee: true }), ['resumeTeams', 'veto_reset']);
  const turn = currentStep([{ ...remaining, step_index: 0, map_name: null }, ...steps]);
  assert.equal(turn.id, '5');
  assert.equal(canEditVetoStep(turn, turn, 'running'), true);
  assert.equal(canEditVetoStep(turn, turn, 'ready'), false);
  assert.equal(canEditVetoStep(remaining, remaining, 'running'), false);
  assert.equal(canEditVetoStep(steps[0], null, 'done'), true);
  assert.equal(vetoTooEarly({ scheduled_at: '2026-11-06T18:00:00Z' }, Date.parse('2026-11-06T17:00:00Z')), true);
  assert.equal(systemNotice('tournaments.staff.vetoReset'), 'vetoReset');
  assert.equal(systemNotice('Veto cerrado. Orden de mapas: 1. Rewind'), null);
  assert.deepEqual(chatCheck('  hola\r\n '), { value: 'hola', ready: true, tooLong: false, left: 996 });
  assert.equal(chatCheck('x'.repeat(1001)).ready, false);
});
