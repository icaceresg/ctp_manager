import { HttpError } from './auth.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = () => { throw new HttpError(400, 'manager.challenges.resolution.invalid'); };
const invalidResponse = () => { throw new HttpError(502, 'manager.challenges.resolution.invalidResponse'); };

/**
 * Staff decision on a challenge, applied at once by CTP through the existing
 * incident.resolve command. The target is the ticket when the decision is taken
 * from one (its manager_version), or the challenge itself (its manager_version).
 * command_id is chosen by the browser so a retried submit is idempotent in CTP.
 */
export function challengeResolutionRequest(challengeId, body) {
  if (typeof challengeId !== 'string' || !UUID.test(challengeId)) invalid();
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !['command_id', 'ticket_id', 'expected_version', 'decision', 'winner_team_id', 'resolution'].includes(key))) invalid();
  const { command_id, ticket_id, expected_version, decision, winner_team_id } = body;
  if (typeof command_id !== 'string' || !UUID.test(command_id)) invalid();
  if (ticket_id !== undefined && ticket_id !== null && (typeof ticket_id !== 'string' || !UUID.test(ticket_id))) invalid();
  if (!Number.isSafeInteger(expected_version) || expected_version < 1) invalid();
  if (!['award', 'cancel'].includes(decision)) invalid();
  const resolution = typeof body.resolution === 'string' ? body.resolution.trim() : '';
  if (resolution.length < 10 || resolution.length > 2000) invalid();
  const payload = { resolution };
  if (decision === 'cancel') payload.decision = 'cancel';
  else {
    if (typeof winner_team_id !== 'string' || !UUID.test(winner_team_id)) invalid();
    payload.winner_team_id = winner_team_id.toLowerCase();
  }
  return {
    challenge_id: challengeId.toLowerCase(), command_id: command_id.toLowerCase(), decision,
    target_id: (ticket_id || challengeId).toLowerCase(), expected_version, payload,
  };
}

export function challengeResolutionResponse(result, request) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || result.applied !== true
    || result.command_id !== request.command_id || result.type !== 'incident.resolve' || result.target_id !== request.target_id
    || result.challenge_id !== request.challenge_id
    || result.challenge_status !== (request.decision === 'cancel' ? 'cancelado' : 'finalizado')) invalidResponse();
  return { applied: true, challenge_id: request.challenge_id, status: result.challenge_status,
    version: Number.isSafeInteger(result.version) ? result.version : null };
}
