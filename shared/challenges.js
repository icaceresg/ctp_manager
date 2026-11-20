export const CHALLENGE_MATCH_STATUSES = Object.freeze([
  'abierto', 'aceptado', 'pendiente_resultado', 'en_disputa', 'finalizado', 'cancelado',
]);

export const CHALLENGE_TICKET_STATUSES = Object.freeze([
  'abierto', 'en_revision', 'esperando_respuesta', 'resuelto', 'rechazado', 'cerrado',
]);

export const CHALLENGE_TICKET_TYPES = Object.freeze([
  'disputa_resultado', 'no_show', 'resultado_incorrecto', 'trampa', 'tecnico', 'toxicidad', 'consulta',
]);

export const CHALLENGE_TICKET_PRIORITIES = Object.freeze(['baja', 'media', 'alta']);

export const CHALLENGE_LIST_STATUSES = Object.freeze({
  matches: CHALLENGE_MATCH_STATUSES,
  tickets: CHALLENGE_TICKET_STATUSES,
});

export function isChallengeResultTicketType(type) {
  return type === 'disputa_resultado' || type === 'resultado_incorrecto';
}

export function isOpenChallengeResultTicket(ticket) {
  return ['abierto', 'en_revision', 'esperando_respuesta'].includes(ticket.status)
    && isChallengeResultTicketType(ticket.type);
}

export const OPEN_CHALLENGE_TICKET_STATUSES = Object.freeze(['abierto', 'en_revision', 'esperando_respuesta']);

export function isOpenChallengeTicket(ticket) {
  return OPEN_CHALLENGE_TICKET_STATUSES.includes(ticket?.status);
}

/** Results open 25 minutes after the slot starts, as in CTP. */
export const CHALLENGE_RESULT_DELAY_MS = 25 * 60_000;

/**
 * Staff may decide a challenge that is disputed, waiting for the rival's
 * confirmation, or accepted and already played (CTP migration 443).
 */
export function isStaffResolvableChallenge(match, now = Date.now()) {
  if (!match?.accepter_team?.id) return false;
  if (match.status === 'en_disputa' || match.status === 'pendiente_resultado') return true;
  return match.status === 'aceptado' && now >= Date.parse(match.scheduled_slot) + CHALLENGE_RESULT_DELAY_MS;
}
