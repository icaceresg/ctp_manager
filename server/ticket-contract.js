import { HttpError } from './auth.js';
import { OFFICIAL_CASE_STATUSES } from './case-contract.js';

export const TICKET_ACTIONS = Object.freeze(['message','assign','status']);
// Fixed machine codes from manager_ticket_action; never relay SQL text.
export const TICKET_ERRORS = Object.freeze({
  ticket_invalid: 'La acción sobre la incidencia no es válida.',
  ticket_not_found: 'La incidencia ya no existe en CTP.',
  ticket_message_invalid: 'El mensaje debe tener entre 1 y 5000 caracteres.',
  ticket_closed: 'La incidencia está cerrada y no admite mensajes. Reábrela cambiando su estado.',
  ticket_status_invalid: 'Selecciona un estado válido.',
  ticket_result_pending: 'Resuelve primero el resultado del partido desde «Preparar resolución».',
  ticket_request_reused: 'La solicitud ya se usó para otra acción. Vuelve a intentarlo.',
  ticket_forbidden: 'Tu cuenta no puede atender esta incidencia en CTP.',
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new HttpError(400, message); };
const text = (value, max) => typeof value === 'string' && value.length <= max;
const nullable = (value, max) => value === null || value === undefined || text(value, max);

export function ticketId(id) {
  if (typeof id !== 'string' || !UUID.test(id)) fail('Selecciona una incidencia válida.');
  return id;
}

export function ticketActionPayload(id, body = {}) {
  if (!object(body) || Object.keys(body).some(key => !['action','value','request_id'].includes(key)) || !TICKET_ACTIONS.includes(body.action)) fail(TICKET_ERRORS.ticket_invalid);
  if (typeof body.request_id !== 'string' || !UUID.test(body.request_id)) fail(TICKET_ERRORS.ticket_invalid);
  const payload = { action: body.action, ticket_id: ticketId(id), request_id: body.request_id };
  if (body.action === 'message') {
    const value = typeof body.value === 'string' ? body.value.trim() : '';
    if (!value || value.length > 5000) fail(TICKET_ERRORS.ticket_message_invalid);
    payload.value = value;
  } else if (body.action === 'status') {
    if (!OFFICIAL_CASE_STATUSES.includes(body.value)) fail(TICKET_ERRORS.ticket_status_invalid);
    payload.value = body.value;
  } else if (body.value !== undefined) fail(TICKET_ERRORS.ticket_invalid);
  return payload;
}

/** The thread is bounded and typed before the browser sees it. */
export function ticketThreadResponse(value, id) {
  const invalid = () => { throw new HttpError(502, 'CTP ha devuelto una incidencia no válida.'); };
  if (!object(value) || !object(value.ticket) || value.ticket.id !== id || !Array.isArray(value.messages) || !Array.isArray(value.events)
    || value.messages.length > 300 || value.events.length > 300) invalid();
  const t = value.ticket, author = t.author;
  if (!text(t.code, 64) || !OFFICIAL_CASE_STATUSES.includes(t.status) || !text(t.description, 20000) || !object(author) || !text(author.username, 100)
    || !nullable(author.email, 320) || !nullable(author.gamertag, 100) || !nullable(author.activision_id, 40)
    || t.assigned !== null && (!object(t.assigned) || !text(t.assigned.username, 100))) invalid();
  const messages = value.messages.map(m => {
    if (!object(m) || !text(m.id, 64) || typeof m.is_staff !== 'boolean' || !text(m.body, 5000) || !text(m.created_at, 64) || !nullable(m.author_name, 100)) invalid();
    return { id: m.id, author_id: m.author_id, author_name: m.author_name ?? null, is_staff: m.is_staff, body: m.body, created_at: m.created_at };
  });
  const events = value.events.map(e => {
    if (!object(e) || !text(e.id, 64) || !['assigned','status'].includes(e.kind) || !text(e.value, 100) || !text(e.created_at, 64) || !nullable(e.actor_name, 100)) invalid();
    return { id: e.id, kind: e.kind, value: e.value, actor_name: e.actor_name ?? null, created_at: e.created_at };
  });
  return {
    ticket: { id: t.id, code: t.code, type: t.type, status: t.status, priority: t.priority, description: t.description,
      proof_url: typeof t.proof_url === 'string' && /^https:\/\//.test(t.proof_url) ? t.proof_url : null, resolution: t.resolution ?? null,
      created_at: t.created_at, updated_at: t.updated_at, tournament_match_id: t.tournament_match_id ?? null, challenge_id: t.challenge_id ?? null,
      author: { id: author.id, username: author.username, gamertag: author.gamertag ?? null, activision_id: author.activision_id ?? null, email: author.email ?? null },
      assigned: t.assigned ? { id: t.assigned.id, username: t.assigned.username } : null },
    messages, events, can_change_status: value.can_change_status === true,
    viewer_id: typeof value.viewer_id === 'string' && UUID.test(value.viewer_id) ? value.viewer_id : null,
  };
}
