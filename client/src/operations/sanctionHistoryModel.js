import { sanctionPeriod } from './sanctionsModel.js';

export const SANCTION_HISTORY_LIMIT = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = () => { throw new Error('No se ha podido verificar el historial de esta cuenta.'); };
export const historySubjectKey = ({ userId, context }) => JSON.stringify([userId ?? null, context?.lobbyId ?? null, context?.slot ?? null, context?.username ?? null]);

/** Lifted blocks remain historical decisions, but can never appear active. */
export function historyPeriod(item, now = Date.now()) {
  if (item.status === 'revoked' || item.revoked_at || item.appeal_status === 'revoked') return 'revoked';
  if (item.kind === 'ranked_ban' && item.lifted) return 'lifted';
  return sanctionPeriod(item, now);
}

/** Counts describe returned personal records, never a recommendation to sanction. */
export function buildSanctionHistory(response, expectedId, now = Date.now()) {
  if (!UUID.test(expectedId || '') || response?.user?.id !== expectedId
      || typeof response.user.username !== 'string' || !Array.isArray(response.clubs)
      || !Array.isArray(response.items) || response.items.length > SANCTION_HISTORY_LIMIT) invalid();
  const clubIds = new Set(response.clubs.map(club => club.id));
  const personal = [], clubItems = [], seen = new Set();
  for (const item of response.items) {
    if (!item || !UUID.test(item.id || '') || seen.has(`${item.source}:${item.id}`)
        || !['sanction', 'ranked_ban'].includes(item.source)
        || !['warning', 'suspension', 'ranked_ban'].includes(item.kind)
        || !['active', 'scheduled', 'expired', 'revoked'].includes(item.status)
        || typeof item.reason !== 'string' || !Number.isFinite(Date.parse(item.starts_at))
        || !Number.isFinite(Date.parse(item.ends_at)) || !Array.isArray(item.scopes)) invalid();
    seen.add(`${item.source}:${item.id}`);
    const row = { ...item, period: historyPeriod(item, now) };
    if (item.subject_type === 'player' && item.subject_id === expectedId) personal.push(row);
    else if (item.subject_type === 'club' && clubIds.has(item.subject_id)) clubItems.push(row);
    else invalid(); // A history response must never quietly switch its subject.
  }
  const counts = { active: 0, previous: 0, warnings: 0, revoked: 0, scheduled: 0 };
  for (const item of personal) {
    if (item.period === 'revoked') { counts.revoked++; continue; }
    if (item.period === 'scheduled') counts.scheduled++;
    if (item.kind === 'warning') counts.warnings++;
    else if (item.period === 'active') counts.active++;
    else if (item.period === 'expired' || item.period === 'lifted') counts.previous++;
  }
  return { user: response.user, clubs: response.clubs, personal, clubItems, counts,
    total: response.items.length, maybeIncomplete: response.items.length >= SANCTION_HISTORY_LIMIT };
}

/** One explicit read per opening/retry. Late or aborted responses cannot resurface. */
export function createSanctionHistoryReader() {
  let generation = 0, controller = null;
  const cancel = () => { generation++; controller?.abort(); controller = null; };
  return {
    cancel,
    async read({ userId, context, fetchHistory, onChange, now = Date.now() }) {
      cancel();
      const current = generation;
      controller = new AbortController();
      const signal = controller.signal;
      const subjectKey = historySubjectKey({ userId, context });
      onChange({ status: 'loading', userId, subjectKey });
      try {
        if (context ? !UUID.test(context.lobbyId || '') || !Number.isSafeInteger(context.slot)
            || context.slot < 1 || context.slot > 8 || typeof context.username !== 'string' || !context.username
          : !UUID.test(userId || '')) invalid();
        const response = await fetchHistory(context ? { ...context } : userId, { signal });
        if (current !== generation || signal.aborted) return null;
        if (context && (response?.context?.lobby_id !== context.lobbyId || response?.context?.slot !== context.slot
            || response?.context?.username !== context.username)) invalid();
        if (userId && response?.user?.id !== userId) invalid();
        const history = buildSanctionHistory(response, context ? response?.user?.id : userId, now);
        onChange({ status: 'ready', userId, subjectKey, history });
        return history;
      } catch (error) {
        if (current !== generation || signal.aborted) return null;
        const message = error?.status === 403 ? 'No tienes permiso para consultar este historial.'
          : error?.status === 401 ? 'La sesión ha caducado. Vuelve a entrar para consultar el historial.'
            : 'No se ha podido consultar el historial de esta cuenta. Reintenta antes de valorar sus antecedentes.';
        onChange({ status: 'error', userId, subjectKey, message });
        return null;
      }
    },
  };
}
