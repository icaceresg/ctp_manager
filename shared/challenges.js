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
