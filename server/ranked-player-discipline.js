import { HttpError } from './auth.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const malformed = () => { throw new HttpError(502, 'CTP no ha devuelto la identidad del jugador de forma verificable.'); };
const changed = () => { throw new HttpError(409, 'La partida o sus jugadores han cambiado. Actualiza la partida antes de consultar el historial.'); };

/** Resolve an account only inside the authoritative roster of this one lobby.
 * Slot/name are checked against the current Ranked detail. The historical roster
 * supplies the account id; a global username search is never used.
 */
export function rankedDisciplineTarget(detail, historyPage, lobbyId, slot, username) {
  if (!object(detail) || detail.lobby?.id !== lobbyId || !Array.isArray(detail.players)
    || detail.players.length > 8 || !object(historyPage) || !Array.isArray(historyPage.items)
    || historyPage.items.length > 100) malformed();
  const selected = detail.players.filter(player => player.slot === slot);
  if (selected.length !== 1 || selected[0].username !== username) changed();
  const entries = historyPage.items.filter(item => item.id === lobbyId);
  if (entries.length !== 1) changed();
  const entry = entries[0], roster = entry.detail?.players;
  if (entry.kind !== 'match' || entry.detail?.id !== lobbyId || entry.detail?.competition_kind !== 'ranked'
    || !Array.isArray(roster) || roster.length < 1 || roster.length > 8
    || roster.some(player => !object(player) || !UUID.test(player.user_id || '')
      || typeof player.username !== 'string' || ![null, 'a', 'b'].includes(player.side))
    || new Set(roster.map(player => player.user_id.toLowerCase())).size !== roster.length) malformed();
  if (roster.length !== detail.players.length) changed();
  // A name/side collision, changed team or stale roster cannot select an account.
  for (const player of detail.players) {
    if (roster.filter(row => row.username === player.username && row.side === player.side).length !== 1) changed();
  }
  const matches = roster.filter(player => player.username === username && player.side === selected[0].side);
  if (matches.length !== 1) changed();
  return matches[0].user_id.toLowerCase();
}
