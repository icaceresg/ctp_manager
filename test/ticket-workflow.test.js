import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTicketActionState } from '../client/src/operations/ticketActionState.js';

// Real Manager transport/contracts/SQLite with a synthetic, in-memory CTP peer.
// No real account, ticket, message or environment is contacted.
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-ticket-flow-'));
Object.assign(process.env, { DATA_DIR: temporary, DB_PATH: path.join(temporary, 'ticket.db'),
  PUBLIC_ORIGIN: '', CTP_AUTH_MODE: 'local', CTP_OPERATIONS_URL: 'http://127.0.0.1:41567/fixture',
  CTP_OPERATIONS_TOKEN: 'ticket-transport-test-independent-0123456789',
  CTP_SIGNING_SECRET: 'ticket-signature-test-independent-0123456789', CTP_ENABLE_WRITES: 'true',
  CTP_ALLOW_LOCAL_WRITES: 'true', CTP_SYNC_SECONDS: '0' });
const id = '11111111-1111-4111-8111-111111111111';
const aId = '22222222-2222-4222-8222-222222222222', bId = '33333333-3333-4333-8333-333333333333';
const sourceThread = () => ({ ticket: { id, code: 'TK-OWNED', type: 'otro', status: 'abierto', priority: 'media',
  description: 'Cambio de identidad', proof_url: 'https://video.example/clip', created_at: '2026-10-26T10:00:00Z', updated_at: '2026-10-26T10:00:00Z',
  author: { id, username: 'ÁguilaJugador', gamertag: 'GamerÚnico', activision_id: 'IDSinNumeros', email: null }, assigned: { id: bId, username: 'Referee B' } },
  messages: [], events: [], can_change_status: true, viewer_id: aId });
let current = sourceThread(), loseReply = false, invalidReceipt = false, effects = 0;
const receipts = new Map(), observed = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_url, options) => {
  const body = JSON.parse(options.body); observed.push(body);
  assert.equal(body.action, 'admin_service'); assert.equal(body.service, 'tickets');
  const p = body.payload;
  if (p.action === 'thread') return Response.json({ ok: true, data: current });
  let receipt = receipts.get(p.request_id);
  if (!receipt) {
    effects++;
    if (p.action === 'message') current.messages.push({ id: `message-${effects}`, author_id: aId,
      author_name: 'Referee A', is_staff: true, body: p.value, created_at: '2026-10-26T10:01:00Z' });
    else if (p.action === 'assign') current.ticket.assigned = { id: aId, username: 'Referee A' };
    else current.ticket.status = p.value;
    receipt = { request_id: p.request_id, action: p.action, applied_at: '2026-10-26T10:01:00Z' };
    receipts.set(p.request_id, receipt);
  }
  if (loseReply) { loseReply = false; throw new TypeError('Synthetic transport lost the response after commit'); }
  return Response.json({ ok: true, data: { ...current, receipt: invalidReceipt ? { ...receipt, action: 'unrelated' } : receipt } });
};
const { db } = await import('../server/db.js');
const operations = await import('../server/operations.js');
const { operationsWorkspace } = await import('../server/operations-workspace.js');
const { getTicketThread, ticketAction } = await import('../server/integration.js');
const insert = db.prepare('INSERT INTO users(username,name,password_hash,ctp_user_id,created_at)VALUES(?,?,?,?,?)');
const a = { id: Number(insert.run('ref-a', 'Referee A', '!not-a-login', aId, Date.now()).lastInsertRowid), sections: ['arbitraje'] };
const b = { id: Number(insert.run('ref-b', 'Referee B', '!not-a-login', bId, Date.now()).lastInsertRowid), sections: ['arbitraje'] };
operations.ingestSnapshot({ incidents: [{ id, kind: 'support', title: 'Solicitud de ayuda', reason: 'Identidad pendiente', status: 'abierto', version: 1 }] });
after(() => {
  globalThis.fetch = originalFetch; db.close();
  assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
  fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5 });
});

test('A replying to a ticket assigned to B keeps B in the official header and personal inbox', async () => {
  await getTicketThread(a, id);
  const input = createTicketActionState('a:ticket').begin('message', 'Respuesta de A sin asumir el caso');
  const reply = await ticketAction(a, id, input);
  assert.equal(reply.ticket.assigned.id, bId);
  assert.equal(operations.incidentDetail(a, id).incident.assignee_id, b.id);
  assert.equal(operations.incidentDetail(a, id).incident.assigned_name, 'Referee B');
  assert.equal(operationsWorkspace(a, { view: 'incidencias', bucket: 'mine' }).incidents.some(row => row.id === id), false);
  assert.equal(operationsWorkspace(b, { view: 'incidencias', bucket: 'mine' }).incidents.some(row => row.id === id), true);
});

test('a response lost after commit retries through the signed Manager transport without a duplicate reply', async () => {
  const state = createTicketActionState('a:ticket'), input = state.begin('message', 'Respuesta con confirmación perdida');
  const before = effects; loseReply = true;
  await assert.rejects(ticketAction(a, id, input), { status: 502 });
  const retry = state.begin('message', input.value);
  state.confirm(retry, await ticketAction(a, id, retry), id, aId);
  assert.equal(effects, before + 1);
  assert.equal(current.messages.filter(row => row.body === input.value).length, 1);
  const attempts = observed.filter(row => row.payload.request_id === input.request_id);
  assert.equal(attempts.length, 2); assert.deepEqual(attempts[0].payload, attempts[1].payload);
});

test('write acknowledgements are checked before the local mirror accepts their state', async () => {
  const before = operations.incidentDetail(a, id).incident.status;
  invalidReceipt = true;
  await assert.rejects(ticketAction(a, id, createTicketActionState('status').begin('status', 'esperando_respuesta')), { status: 502 });
  invalidReceipt = false;
  assert.equal(operations.incidentDetail(a, id).incident.status, before);
});

test('assuming a ticket maps only the official identity and not a display-name match', async () => {
  await ticketAction(a, id, createTicketActionState('assign').begin('assign'));
  assert.equal(operations.incidentDetail(a, id).incident.assignee_id, a.id);
  current.ticket.assigned = { id: '44444444-4444-4444-8444-444444444444', username: 'Referee A' };
  await getTicketThread(a, id);
  assert.equal(operations.incidentDetail(a, id).incident.assignee_id, null);
  assert.equal(operationsWorkspace(a, { view: 'incidencias', bucket: 'mine' }).incidents.some(row => row.id === id), false);
  assert.equal(operationsWorkspace(a, { view: 'incidencias', bucket: 'unassigned' }).incidents.some(row => row.id === id), false,
    'an official assignee without a local login is still assigned');
});

test('reporter nickname and known ActivisionID are searched before pagination and exposed in bounded list context', () => {
  operations.ingestSnapshot({ incidents: Array.from({ length: 45 }, (_, index) => ({ id: `noise-${index}`, title: 'Otra solicitud',
    reason: 'Otro contexto', kind: 'support', status: 'open', reporter_name: `Otro ${index}`, version: 1 })) });
  const nickname = operationsWorkspace(a, { view: 'incidencias', q: 'águilajugador', limit: '1' });
  assert.equal(nickname.pages.incidents.total, 1); assert.equal(nickname.incidents[0].id, id);
  assert.equal(nickname.incidents[0].reporter_name, 'ÁguilaJugador');
  assert.equal(nickname.incidents[0].assigned_name, 'Referee A');
  const activision = operationsWorkspace(a, { view: 'incidencias', q: 'idsinnumeros', limit: '1' });
  assert.equal(activision.pages.incidents.total, 1); assert.equal(activision.incidents[0].id, id);
  assert.equal(nickname.incidents[0].reason, undefined); assert.equal(nickname.incidents[0].reporter_email, undefined);
});
