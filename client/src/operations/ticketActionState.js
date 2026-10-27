const ACTIONS = new Set(['message', 'assign', 'status']);

/** A pending manual action keeps its reference until CTP confirms that action. */
export function createTicketActionState(scope, createId = () => crypto.randomUUID()) {
  const pending = new Map();
  return {
    scope,
    begin(action, value) {
      if (!ACTIONS.has(action)) throw new Error('La acción sobre la incidencia no es válida.');
      const payload = { action, ...(value === undefined ? {} : { value }) };
      const key = JSON.stringify(payload);
      if (!pending.has(key)) pending.set(key, { ...payload, request_id: createId() });
      return pending.get(key);
    },
    confirm(input, next, ticketId, viewerId) {
      const receipt = next?.receipt;
      if (next?.ticket?.id !== ticketId || !receipt || receipt.request_id !== input.request_id
        || receipt.action !== input.action || !Number.isFinite(Date.parse(receipt.applied_at))
        || viewerId && next.viewer_id !== viewerId) {
        throw new Error('CTP no ha confirmado esta acción. Reintenta la misma acción para comprobarla sin duplicarla.');
      }
      const key = JSON.stringify({ action: input.action, ...(input.value === undefined ? {} : { value: input.value }) });
      if (pending.get(key) === input) pending.delete(key);
      return next;
    },
  };
}
