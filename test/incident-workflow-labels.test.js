import test from 'node:test';
import assert from 'node:assert/strict';
import { hasIncidentAssignee, incidentNextAction, incidentRows } from '../client/src/operations/staffModel.js';

const ticket = { id: 'test-ticket', source: 'ctp', kind: 'support', status: 'open', created_at: '2026-10-29T08:00:00Z' };

test('official assignment without a local account never becomes an unassigned ticket', () => {
  for (const assignment of [{ assigned_name: 'Árbitra de prueba' }, { assignee_ctp_id: 'official-staff-identity' }, { assignee_id: 3 }]) {
    const assigned = { ...ticket, ...assignment };
    assert.equal(hasIncidentAssignee(assigned), true);
    assert.deepEqual(incidentRows([assigned], { bucket: 'unassigned' }), []);
    assert.doesNotMatch(incidentNextAction(assigned), /Asignar/);
  }
  const unassigned = { ...ticket, assignee_id: null, assignee_ctp_id: '', assigned_name: '  ' };
  assert.equal(hasIncidentAssignee(unassigned), false);
  assert.equal(incidentNextAction(unassigned), 'Asignar responsable');
  assert.deepEqual(incidentRows([unassigned], { bucket: 'unassigned' }), [unassigned]);
});

test('the last player message means a reply is pending, without fabricating unread state or a waiting recipient', () => {
  const assigned = { ...ticket, assignee_id: 3, status: 'waiting' };
  assert.equal(incidentNextAction({ ...assigned, awaiting_staff: true }), 'Responder al jugador');
  assert.equal(incidentNextAction({ ...assigned, awaiting_staff: false }), 'Revisar seguimiento');
  assert.equal(incidentNextAction({ ...assigned, status: 'resolution_pending', awaiting_staff: true }), 'Comprobar entrega a CTP');
  assert.equal(incidentNextAction({ ...assigned, status: 'closed', awaiting_staff: true }), 'Consultar resolución');
  assert.equal(incidentNextAction({ ...assigned, kind: 'ranked', awaiting_staff: true }), 'Revisar conversación');
});
