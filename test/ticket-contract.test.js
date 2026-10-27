import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-ticket-contract-'));
process.env.DATA_DIR = temp; process.env.DB_PATH = path.join(temp, 'ticket.db');
const { ticketActionPayload, ticketId, ticketThreadResponse, ticketProofUrl } = await import('../server/ticket-contract.js');
const { db } = await import('../server/db.js');
after(() => { db.close(); fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5 }); });

const id = '11111111-1111-4111-8111-111111111111', req = '22222222-2222-4222-8222-222222222222';
const thread = () => ({
  ticket: { id, code: 'TK-1', type: 'otro', status: 'abierto', priority: 'media', description: 'Hola', proof_url: 'javascript:x', created_at: 'x', updated_at: 'x',
    author: { id, username: 'player', gamertag: null, activision_id: 'p#1', email: 'p@x.com' }, assigned: null },
  messages: [{ id: 'm1', author_id: id, author_name: 'player', is_staff: false, body: 'hola', created_at: '2026-01-01T00:00:00Z' }],
  events: [{ id: 'e1', kind: 'status', value: 'en_revision', actor_name: 'ref', created_at: '2026-01-01T00:00:01Z' }],
  can_change_status: true, viewer_id: req, receipt: { secret: 1 },
});

test('ticket actions are validated before they reach CTP', () => {
  assert.deepEqual(ticketActionPayload(id, { action: 'message', value: '  hola ', request_id: req }), { action: 'message', ticket_id: id, request_id: req, value: 'hola' });
  assert.deepEqual(ticketActionPayload(id, { action: 'assign', request_id: req }), { action: 'assign', ticket_id: id, request_id: req });
  assert.equal(ticketActionPayload(id, { action: 'status', value: 'resuelto', request_id: req }).value, 'resuelto');
  for (const body of [{ action: 'message', value: ' ', request_id: req }, { action: 'status', value: 'open', request_id: req },
    { action: 'assign', value: 'x', request_id: req }, { action: 'delete', request_id: req }, { action: 'assign' }, { action: 'assign', request_id: req, extra: 1 }])
    assert.throws(() => ticketActionPayload(id, body), { status: 400 });
  assert.throws(() => ticketId('1 OR 1=1'), { status: 400 });
});

test('ticket threads are bounded and stripped of unknown fields', () => {
  const out = ticketThreadResponse(thread(), id);
  assert.equal(out.ticket.proof_url, null);
  assert.equal(out.ticket.author.activision_id, 'p#1');
  assert.equal(out.viewer_id, req);
  assert.equal(out.can_change_status, true);
  assert.equal(out.receipt, undefined);
  assert.equal(out.events[0].value, 'en_revision');
  assert.throws(() => ticketThreadResponse({ ...thread(), ticket: { ...thread().ticket, id: req } }, id), { status: 502 });
  assert.throws(() => ticketThreadResponse({ ...thread(), events: [{ id: 'e', kind: 'deleted', value: 'x', created_at: 'x' }] }, id), { status: 502 });
});

test('account navigation uses only the typed ticket author, never a name or message sender', () => {
  const input = thread(); input.messages[0].author_id = req;
  assert.equal(ticketThreadResponse(input, id).ticket.author.id, id);
  for (const bad of [undefined, null, 'player', `/${id}`, [id], { id }]) {
    const invalid = thread(); invalid.ticket.author.id = bad;
    assert.throws(() => ticketThreadResponse(invalid, id), { status: 502 });
  }
});

test('proof links allow explicit HTTP navigation without credentials, controls or executable schemes', () => {
  for (const value of ['https://video.example/clip?id=1#t=20', 'http://video.example/review']) {
    assert.equal(ticketProofUrl(value), value);
    const input = thread(); input.ticket.proof_url = value;
    assert.equal(ticketThreadResponse(input, id).ticket.proof_url, value);
  }
  for (const value of ['javascript:alert(1)', 'data:text/html,x', '//evil.example', 'https://user:pass@example.test/x',
    'https://example.test/\nx', 'https://example.test\\@evil.test', 'https://example.test/ has-space', 'https://example.test/' + 'a'.repeat(2050), null]) {
    assert.equal(ticketProofUrl(value), null);
  }
});

test('write responses require the exact action acknowledgement while reads remain compatible', () => {
  const payload = ticketActionPayload(id, { action: 'message', value: 'Hola', request_id: req });
  const input = thread(); input.receipt = { request_id: req, action: 'message', applied_at: '2026-10-26T10:00:00Z', token: 'never-forward' };
  assert.deepEqual(ticketThreadResponse(input, id, payload).receipt,
    { request_id: req, action: 'message', applied_at: '2026-10-26T10:00:00Z' });
  assert.equal(ticketThreadResponse(input, id).receipt, undefined);
  for (const receipt of [undefined, {}, { ...input.receipt, request_id: id },
    { ...input.receipt, action: 'assign' }, { ...input.receipt, applied_at: 'invalid' }]) {
    assert.throws(() => ticketThreadResponse({ ...input, receipt }, id, payload), { status: 502 });
  }
  assert.throws(() => ticketThreadResponse({ ...input, ticket: { ...input.ticket, assigned: { id: 'not-an-identity', username: 'staff' } } }, id), { status: 502 });
});
