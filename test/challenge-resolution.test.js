import test from 'node:test';
import assert from 'node:assert/strict';
import { challengeResolutionRequest, challengeResolutionResponse } from '../server/challenge-resolution-contract.js';
import { isOpenChallengeTicket, isStaffResolvableChallenge } from '../shared/challenges.js';

const challenge = '40000000-0000-4000-8000-000000000004';
const ticket = '10000000-0000-4000-8000-000000000001';
const winner = '20000000-0000-4000-8000-000000000002';
const command = '50000000-0000-4000-8000-000000000005';
const reason = 'Capturas revisadas por el staff';

test('a challenge decision targets its ticket or the challenge and carries only the decision', () => {
  const award = challengeResolutionRequest(challenge, { command_id: command, ticket_id: ticket, expected_version: 3, decision: 'award', winner_team_id: winner, resolution: `  ${reason}  ` });
  assert.deepEqual(award, { challenge_id: challenge, command_id: command, decision: 'award', target_id: ticket, expected_version: 3,
    payload: { resolution: reason, winner_team_id: winner } });
  const cancel = challengeResolutionRequest(challenge, { command_id: command, expected_version: 9, decision: 'cancel', resolution: reason });
  assert.deepEqual(cancel, { challenge_id: challenge, command_id: command, decision: 'cancel', target_id: challenge, expected_version: 9,
    payload: { resolution: reason, decision: 'cancel' } });
});

test('malformed decisions are refused before reaching CTP', () => {
  const base = { command_id: command, expected_version: 1, decision: 'award', winner_team_id: winner, resolution: reason };
  for (const [id, body] of [
    ['not-a-uuid', base],
    [challenge, { ...base, command_id: 'x' }],
    [challenge, { ...base, expected_version: 0 }],
    [challenge, { ...base, decision: 'close' }],
    [challenge, { ...base, winner_team_id: undefined }],
    [challenge, { ...base, resolution: 'corto' }],
    [challenge, { ...base, ticket_id: 'x' }],
    [challenge, { ...base, extra: true }],
  ]) assert.throws(() => challengeResolutionRequest(id, body), error => error.status === 400);
});

test('only a confirmed CTP application of this exact command is accepted', () => {
  const request = challengeResolutionRequest(challenge, { command_id: command, ticket_id: ticket, expected_version: 3, decision: 'award', winner_team_id: winner, resolution: reason });
  const result = { command_id: command, type: 'incident.resolve', target_id: ticket, applied: true, version: 4, challenge_id: challenge, challenge_status: 'finalizado' };
  assert.deepEqual(challengeResolutionResponse(result, request), { applied: true, challenge_id: challenge, status: 'finalizado', version: 4 });
  for (const wrong of [{ ...result, applied: false }, { ...result, command_id: ticket }, { ...result, challenge_status: 'cancelado' }, { ...result, target_id: challenge }, null])
    assert.throws(() => challengeResolutionResponse(wrong, request), error => error.status === 502);
});

test('staff can decide disputed, unconfirmed and played challenges only', () => {
  const now = Date.parse('2026-11-20T12:00:00Z');
  const row = { status: 'en_disputa', scheduled_slot: '2026-11-20T10:00:00Z', accepter_team: { id: winner } };
  assert.equal(isStaffResolvableChallenge(row, now), true);
  assert.equal(isStaffResolvableChallenge({ ...row, status: 'pendiente_resultado' }, now), true);
  assert.equal(isStaffResolvableChallenge({ ...row, status: 'aceptado', scheduled_slot: '2026-11-20T11:35:00Z' }, now), true);
  assert.equal(isStaffResolvableChallenge({ ...row, status: 'aceptado', scheduled_slot: '2026-11-20T11:36:00Z' }, now), false);
  for (const status of ['abierto', 'finalizado', 'cancelado']) assert.equal(isStaffResolvableChallenge({ ...row, status }, now), false);
  assert.equal(isStaffResolvableChallenge({ ...row, accepter_team: null }, now), false);
  assert.equal(isOpenChallengeTicket({ status: 'esperando_respuesta', type: 'tecnico' }), true);
  assert.equal(isOpenChallengeTicket({ status: 'resuelto' }), false);
});
