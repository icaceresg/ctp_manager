import test from 'node:test';
import assert from 'node:assert/strict';
import { caseAssigneeLabel, caseReference, caseTitle, caseTypeLabel, inboxCounts, inboxResultLabel, shortCaseReference } from '../client/src/operations/casePresentation.js';

test('coded official ticket titles show their meaning while retaining the exact searchable reference', () => {
  const incident = Object.freeze({ id: 'synthetic-uuid', title: 'CTP-ABCD0123456789 · disputa_resultado' });
  assert.equal(caseTitle(incident), 'Disputa de resultado');
  assert.equal(caseTypeLabel(incident), 'Disputa de resultado');
  assert.equal(caseReference(incident), 'CTP-ABCD0123456789');
  assert.equal(shortCaseReference(incident), 'CTP-…456789');
  assert.equal(incident.id, 'synthetic-uuid');
  assert.equal(incident.title, 'CTP-ABCD0123456789 · disputa_resultado');
  assert.equal(caseTitle({ ...incident, type: 'consulta' }), 'Consulta', 'a typed category wins over a stale coded label');
});

test('human subjects are preserved and unknown machine categories never invent an allegation', () => {
  assert.equal(caseTitle({ title: 'Necesito ayuda para cambiar mi ID', type: 'consulta' }), 'Necesito ayuda para cambiar mi ID');
  assert.equal(caseTitle({ title: 'CTP-ABCDEF012345 · nueva_categoria' }), 'Solicitud de soporte');
  assert.equal(caseTitle({ title: 'nueva_categoria' }), 'Solicitud de soporte');
  assert.equal(caseTypeLabel({ kind: 'ranked', reason: 'https://playctp.com/es/ranked?lobby=another-id' }), 'Ticket');
  assert.equal(caseTitle({}), 'Solicitud de soporte');
  assert.equal(caseTitle({ title: 'CTP-ABCDEF012345 · trampa' }), 'Posibles trampas', 'a report remains an allegation');
  assert.equal(caseTitle({ title: 'CTP-ABCDEF012345 · tecnico' }), 'Problema técnico');
});

test('canonical thread codes and backend IDs remain complete even when the visual reference is shortened', () => {
  assert.equal(caseReference({ code: 'CTP-CANONICAL123456', title: 'CTP-STALE123456 · consulta', id: 'id' }), 'CTP-CANONICAL123456');
  assert.equal(shortCaseReference({ id: '10000000-0000-4000-8000-000000000001' }), '10000000');
  assert.equal(caseReference({ id: '10000000-0000-4000-8000-000000000001' }), '10000000-0000-4000-8000-000000000001');
  assert.equal(caseReference({ id: 'id', reason: 'https://playctp.com/es/ranked?lobby=arbitrary' }), 'id');
});

test('an official assignee without a local staff login is never labelled unassigned', () => {
  assert.equal(caseAssigneeLabel({ assigned_name: 'Árbitro sintético', assignee_id: null }), 'Árbitro sintético');
  assert.equal(caseAssigneeLabel({ assignee_ctp_id: 'ctp-operator' }), 'Responsable asignado');
  assert.equal(caseAssigneeLabel({ assignee_id: 7 }, [{ id: 7, name: 'Operador local' }]), 'Operador local');
  assert.equal(caseAssigneeLabel({ assignee_id: 9 }), 'Responsable asignado');
  assert.equal(caseAssigneeLabel({ assigned_name: '  ' }), 'Sin asignar');
});

test('aggregate counts are authoritative and loaded-page fallbacks disclose their limited scope', () => {
  const incidents = [
    { id: 'a', status: 'open', assignee_id: 7 },
    { id: 'b', status: 'open', assigned_name: 'Árbitro CTP', assignee_id: null, priority: 'urgent' },
    { id: 'c', status: 'open', assignee_id: null },
    { id: 'd', status: 'closed', assignee_id: null },
  ];
  assert.deepEqual(inboxCounts({ incidents }, 7), { all_open: 3, mine: 1, unassigned: 1, urgent: 1, scope: 'page' });
  assert.deepEqual(inboxCounts({ incidents, incident_counts: { all_open: 400, mine: 0, unassigned: 200, urgent: 5 } }, 7),
    { all_open: 400, mine: 0, unassigned: 200, urgent: 5, scope: 'query' });
});

test('paginated results use the supplied total and never present a page count as the global collection', () => {
  const incidents = Array.from({ length: 30 }, (_, id) => ({ id }));
  assert.equal(inboxResultLabel({ incidents, pages: { incidents: { total: 1007, page: 2, limit: 30 } } }), '61–90 de 1007 tickets');
  assert.equal(inboxResultLabel({ incidents }), '30 tickets en esta página');
  assert.equal(inboxResultLabel({ incidents: [{}] }), '1 ticket en esta página');
  assert.equal(inboxResultLabel({ incidents: [], pages: { incidents: { total: 0, page: 0, limit: 30 } } }), '0 de 0 tickets');
  assert.equal(inboxResultLabel({ incidents, pages: { incidents: { total: 1, page: 2, limit: 30 } } }), '30 tickets en esta página');
});
