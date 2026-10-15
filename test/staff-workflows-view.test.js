import test from 'node:test';
import assert from 'node:assert/strict';
import { assignmentCandidates, elapsedLabel, incidentNextAction, incidentRows, madridDay, matchCoverage, personalTasks, weekDays } from '../client/src/operations/staffModel.js';

const start = '2026-10-02T18:00:00Z', end = '2026-10-02T20:00:00Z';
const available = (id, sections = ['arbitraje']) => ({ id, name: `Staff ${id}`, sections, availability: [{ date: '2026-10-02', status: 'disponible' }] });

test('staff candidates require role, availability and a free interval, excluding the edited assignment', () => {
  const staff = [available(1), available(2), available(3, ['casters']), { ...available(4), availability: [] }];
  const assignment = { id: 'turn', user_id: 1, status: 'confirmed', starts_at: start, ends_at: end };
  let rows = assignmentCandidates(staff, [assignment], { role: 'referee', starts_at: start, ends_at: end });
  assert.deepEqual(rows.filter((s) => s.eligible).map((s) => s.id), [2]);
  assert.equal(rows.some((s) => s.id === 3), false);
  assert.match(rows.find((s) => s.id === 1).unavailableReason, /otro turno/);
  rows = assignmentCandidates(staff, [assignment], { role: 'referee', starts_at: start, ends_at: end, excludeId: 'turn' });
  assert.deepEqual(rows.filter((s) => s.eligible).map((s) => s.id), [1, 2]);
});
test('cancelled assignments and adjacent shifts do not block a candidate', () => {
  const shifts = [{ id: 'cancel', user_id: 1, status: 'cancelled', starts_at: start, ends_at: end }, { id: 'before', user_id: 1, status: 'pending', starts_at: '2026-10-02T16:00:00Z', ends_at: start }];
  assert.equal(assignmentCandidates([available(1)], shifts, { role: 'referee', starts_at: start, ends_at: end })[0].eligible, true);
});
test('Madrid midnight and DST follow the server daily availability rule', () => {
  assert.equal(madridDay('2026-10-02T22:05:00Z'), '2026-10-03');
  assert.equal(madridDay('2026-10-26T22:30:00Z'), '2026-10-26');
  const sameDayEnd = assignmentCandidates([available(1)], [], { role: 'referee', starts_at: '2026-10-02T20:00:00Z', ends_at: '2026-10-02T22:00:00Z' });
  assert.equal(sameDayEnd[0].eligible, true, 'exclusive midnight end does not require next day');
  const crossing = assignmentCandidates([available(1)], [], { role: 'referee', starts_at: '2026-10-02T21:00:00Z', ends_at: '2026-10-02T23:00:00Z' });
  assert.match(crossing[0].unavailableReason, /2026-10-03/);
});
test('invalid and excessive candidate windows cannot produce availability', () => {
  for (const ends_at of ['', 'bad', '2026-10-01T00:00:00Z', '2026-10-04T18:00:00Z']) assert.equal(assignmentCandidates([available(1)], [], { role: 'referee', starts_at: start, ends_at })[0].eligible, false);
});
test('week starts on Monday and crosses year and DST boundaries correctly', () => {
  assert.deepEqual(weekDays('2027-01-03'), ['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03']);
  assert.equal(weekDays('2026-10-25')[0], '2026-10-19');
});
const incidents = [
  { id: 'old', title: 'Ronda en disputa', status: 'investigating', assignee_id: 1, priority: 'normal', created_at: 1000, match_id: 'm' },
  { id: 'new', title: 'Desconexión', status: 'open', assignee_id: null, priority: 'urgent', created_at: 2000, match_id: 'm' },
  { id: 'closed', title: 'Archivado', status: 'closed_internal', assignee_id: 1, priority: 'urgent', created_at: 500 },
];
test('inbox scopes, status and urgency order retain only matching cases', () => {
  assert.deepEqual(incidentRows(incidents).map((i) => i.id), ['new','old']);
  assert.deepEqual(incidentRows(incidents, { bucket: 'mine', meId: 1 }).map((i) => i.id), ['old']);
  assert.deepEqual(incidentRows(incidents, { bucket: 'unassigned' }).map((i) => i.id), ['new']);
  assert.deepEqual(incidentRows(incidents, { state: 'resolved' }).map((i) => i.id), ['closed']);
  assert.deepEqual(incidentRows(incidents, { order: 'oldest' }).map((i) => i.id), ['old','new']);
});
test('inbox search finds match teams or assigned staff without including unrelated cases', () => {
  const matches = [{ id: 'm', team_a: { name: 'Ámbar' }, team_b: { name: 'Marfil' } }];
  assert.equal(incidentRows(incidents, { query: 'MARFIL', matches }).length, 2);
  assert.deepEqual(incidentRows(incidents, { query: 'Lucía', staff: [{ id: 1, name: 'Lucía' }] }).map((i) => i.id), ['old']);
  assert.equal(incidentRows(incidents, { query: 'not present' }).length, 0);
});
test('pending official resolution is actionable but no longer requests assignment', () => {
  assert.equal(incidentNextAction({ status: 'resolution_pending', assignee_id: null }), 'Comprobar entrega a CTP');
  assert.equal(incidentNextAction({ status: 'closed', assignee_id: null }), 'Consultar resolución');
  assert.equal(elapsedLabel(null), 'Sin fecha disponible');
  assert.equal(elapsedLabel(0, 3600000), '1 h');
  assert.equal(elapsedLabel(3600000, 0), '0 min');
});
test('coverage distinguishes confirmed and pending while rejecting cancelled slots', () => {
  const coverage = matchCoverage('m', [{ match_id: 'm', role: 'referee', status: 'cancelled' }, { match_id: 'm', role: 'caster', status: 'pending' }, { match_id: 'm', role: 'producer', status: 'confirmed' }, { match_id: 'other', role: 'referee', status: 'confirmed' }]);
  assert.deepEqual(coverage.referee, { assigned: 0, confirmed: 0 });
  assert.deepEqual(coverage.caster, { assigned: 1, confirmed: 0 });
  assert.deepEqual(coverage.producer, { assigned: 1, confirmed: 1 });
});
test('my work respects role and assignment ownership and excludes expired shifts', () => {
  const data = { incidents, assignments: [{ id:'a', user_id:1, match_id:'m', status:'pending', ends_at:end, starts_at:start }, { id:'b', user_id:2, match_id:'m', status:'pending', ends_at:end }, { id:'c', user_id:1, match_id:'m', status:'pending', ends_at:1 }], stats:[{status:'pending'}], clubs:[{verified:false}], matches:[{id:'m',title:'Cup'}] };
  const rows = personalTasks(data, {id:1}, (section) => section === 'arbitraje', Date.parse(start) - 1);
  assert.deepEqual(rows.map((r) => r.id), ['incident:new','incident:old','assignment:a','stats']);
  assert.equal(rows.some((r) => r.id === 'clubs'), false);
  assert.equal(personalTasks({ ...data, assignments:[] }, {id:1}, () => false).length, 0);
});
test('production preparation tasks only refer to assigned upcoming encounters', () => {
  const data = { assignments:[{id:'p',user_id:1,role:'producer',match_id:'m',status:'confirmed',ends_at:end}], matches:[{id:'m',title:'Final',scheduled_at:start}], production:[] };
  assert.equal(personalTasks(data,{id:1},(s)=>s==='realizacion',Date.parse(start))[0].id,'production:m');
  assert.equal(personalTasks(data,{id:2},(s)=>s==='realizacion',Date.parse(start)).length,0);
});
