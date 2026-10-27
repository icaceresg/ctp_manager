/** Browser-safe presentation of the private Ranked detail; never fetch evidence. */
export function safeRankedClipUrl(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 500
    || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || !url.hostname.includes('.')) return null;
    return url.href;
  } catch { return null; }
}

const STATUSES = Object.freeze({drafting:'Formando equipos',ready:'Lista para jugar',
  reported:'Confirmando resultado',disputed:'En revisión',closed:'Finalizada',cancelled:'Cancelada'});

export function rankedPhaseLabel(lobby) {
  if (lobby?.status === 'voting') {
    if (lobby.mode_pending === true) return 'Votando modo';
    if (!lobby.map_name) return 'Votando mapa';
    // Older lobbies may still have an assigned map during their selection phase.
    return 'Selección de mapa';
  }
  return STATUSES[lobby?.status] || 'Estado no disponible';
}

/** A Ranked history row must not enter the tournament statistics workflow. */
export function rankedHistoryPath(item) {
  const detail = item?.detail || item;
  return item?.kind === 'match' && detail?.competition_kind === 'ranked'
    && typeof item.id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(item.id)
    ? `/ranked/partidas/${item.id.toLowerCase()}` : null;
}
