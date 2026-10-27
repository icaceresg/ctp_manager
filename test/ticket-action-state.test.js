import test from 'node:test';
import assert from 'node:assert/strict';
import { createTicketActionState } from '../client/src/operations/ticketActionState.js';

const ticket = '11111111-1111-4111-8111-111111111111', viewer = '22222222-2222-4222-8222-222222222222';
const response = input => ({ ticket: { id: ticket }, viewer_id: viewer,
  receipt: { request_id: input.request_id, action: input.action, applied_at: '2026-10-26T10:00:00Z' } });

test('a committed reply with a lost response is retried once under the same reference', async () => {
  const state = createTicketActionState('actor-a:ticket-a');
  const committed = new Map(); let effects = 0;
  const first = state.begin('message', 'Respuesta de prueba');
  const server = input => {
    if (!committed.has(input.request_id)) { ++effects; committed.set(input.request_id, response(input)); }
    return committed.get(input.request_id);
  };
  server(first); // The local transport loses this response after the effect.
  const retry = state.begin('message', 'Respuesta de prueba');
  assert.strictEqual(first, retry);
  state.confirm(retry, server(retry), ticket, viewer);
  assert.equal(effects, 1);
  assert.notEqual(state.begin('message', 'Respuesta de prueba').request_id, first.request_id,
    'after confirmation, an intentional new reply is a new operation');
});

test('references distinguish payload, action, actor and ticket scope', () => {
  const a = createTicketActionState('actor-a:ticket-a'), b = createTicketActionState('actor-b:ticket-a'), c = createTicketActionState('actor-a:ticket-b');
  const values = [a.begin('assign'), a.begin('message', 'one'), a.begin('message', 'two'),
    a.begin('status', 'en_revision'), a.begin('status', 'cerrado'), b.begin('assign'), c.begin('assign')];
  assert.equal(new Set(values.map(value => value.request_id)).size, values.length);
  assert.equal(a.begin('assign').request_id, values[0].request_id);
  assert.equal(a.begin('status', 'cerrado').request_id, values[4].request_id);
});

test('wrong or absent acknowledgement never retires an uncertain action', () => {
  const state = createTicketActionState('actor-a:ticket-a'), input = state.begin('message', 'Keep draft');
  const valid = response(input);
  for (const reply of [{}, { ...valid, ticket: { id: viewer } }, { ...valid, viewer_id: ticket },
    { ...valid, receipt: { ...valid.receipt, action: 'assign' } },
    { ...valid, receipt: { ...valid.receipt, request_id: 'other' } }]) {
    assert.throws(() => state.confirm(input, reply, ticket, viewer), /no ha confirmado/);
    assert.strictEqual(state.begin('message', 'Keep draft'), input);
  }
  state.confirm(input, valid, ticket, viewer);
  assert.notEqual(state.begin('message', 'Keep draft').request_id, input.request_id);
});
