export const OP_SECTIONS = ['operaciones', 'arbitraje', 'casters', 'realizacion', 'clubes', 'comunicaciones'];
// Order is the sidebar order inside each group (Trabajo diario, Competición,
// Emisión y comunidad). Disciplina was replaced by Sanciones.
// `menu: false` keeps the page reachable from its links (match dossier,
// Mi jornada, Administración → Clubes) but out of the sidebar.
export const OP_TABS = [
  { id: 'jornada', title: 'Mi jornada', sections: OP_SECTIONS },
  { id: 'turnos', title: 'Planificador', sections: ['operaciones', 'casters', 'arbitraje', 'realizacion'] },
  { id: 'decisiones', title: 'Decisiones', sections: OP_SECTIONS },
  { id: 'torneos', title: 'Torneos', sections: ['operaciones'] },
  { id: 'incidencias', title: 'Incidencias', sections: ['arbitraje'] },
  { id: 'arbitraje', title: 'Actas y resultados', sections: ['arbitraje'] },
  { id: 'estadisticas', title: 'Estadísticas', sections: ['arbitraje'], menu: false },
  { id: 'sanciones', title: 'Sanciones', sections: ['arbitraje'] },
  { id: 'clubes', title: 'Clubes', sections: ['clubes'], menu: false },
  { id: 'historico', title: 'Histórico', sections: ['operaciones', 'arbitraje'] },
  { id: 'casters', title: 'Dossier', sections: ['casters', 'operaciones', 'realizacion'] },
  { id: 'realizacion', title: 'Preparación', sections: ['realizacion'] },
  { id: 'discord', title: 'Discord', sections: ['comunicaciones'] },
  { id: 'contenido', title: 'Contenido', sections: ['comunicaciones'] },
];
// Old links keep working after the reorganization.
export const OP_TAB_ALIASES = { disciplina: 'sanciones' };
export const labels = {
  open: 'Abierta', investigating: 'En investigación', waiting: 'Esperando respuesta', resolved: 'Resuelta',
  approve: 'Aprobar', reject: 'Rechazar', close: 'Cerrar expediente', award: 'Adjudicar resultado', cancel: 'Cancelar', verify: 'Verificar',
  groups: 'Grupos', grupos: 'Grupos', direct: 'Eliminatorias directas', playoffs: 'Eliminatorias', eliminacion: 'Eliminatoria',
  borrador: 'Borrador', inscripcion_abierta: 'Inscripción abierta', en_curso: 'En curso',
  resolution_pending: 'Resolución por enviar', pending: 'Pendiente', approved: 'Aprobada', rejected: 'Rechazada',
  scheduled: 'Programado', upcoming: 'Próximo', in_progress: 'En curso', live: 'En directo', completed: 'Finalizado',
  finished: 'Finalizado', cancelled: 'Cancelado', disputed: 'En disputa', confirmed: 'Confirmado', declined: 'Rechazado',
  assigned: 'Por confirmar', preparation: 'Preparación', ready: 'Listo', paused: 'Pausa',
  queued: 'En cola', sent: 'Enviado', failed: 'Error', delivered: 'Entregado', acknowledged: 'Aplicado en CTP',
  expired: 'Caducado', draft: 'Propuesta', proposed: 'Propuesta', active: 'Activo', revoked: 'Revocado',
  appeal_pending: 'Recurso pendiente', appealed: 'Recurrido', upheld: 'Ratificado',
  tournament: 'Torneo', challenge: 'Reto', eights: 'Ranked 8s', referee: 'Árbitro', caster: 'Caster', producer: 'Realizador',
  preview: 'Previa', teams: 'Equipos', map: 'Mapa', pause: 'Pausa', result: 'Resultado', next: 'Siguiente partido',
  warning: 'Amonestación', competition_suspend: 'Suspensión competitiva',
  closed_internal: 'Cerrado internamente', withdrawn: 'Propuesta retirada', reviewed: 'Recurso revisado',
  ranked: 'Ranked 8s', '8s': 'Ranked 8s', reto: 'Reto', aceptado: 'Aceptado', publicado: 'Publicado',
  en_disputa: 'En disputa', jugado: 'Jugado', cancelado: 'Cancelado', finalizado: 'Finalizado',
  none: 'Sin resultado', pending_result: 'Pendiente de resultado', waiting_players: 'Esperando jugadores', playing: 'Jugando',
  done: 'Completado', superseded: 'Sustituido', claimed: 'Enviado al PC',
  reported: 'Resultado comunicado', closed: 'Cerrado', processing: 'En proceso',
  challenge_announcement: 'Anuncio de reto', queue_sync: 'Actualizar cola ranked',
  'incident.resolve': 'Resolver incidencia', 'incident.reply': 'Responder al expediente',
  'stats.review': 'Revisar estadísticas', 'club.verify': 'Verificar club', 'discord.retry': 'Reintentar aviso de Discord',
  'sanction.create': 'Aplicar sanción', 'sanction.appeal': 'Registrar recurso',
  'sanction.review': 'Resolver recurso', 'sanction.revoke': 'Revocar sanción',
};
export const label = (value) => labels[value] || value || 'Sin estado';
export function dateTime(value) {
  if (!value) return 'Sin horario';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'Horario no disponible' : new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}
export const teamName = (team) => typeof team === 'string' ? team : team?.name || 'Equipo por confirmar';
export const matchName = (match) => match?.team_a && match?.team_b ? `${teamName(match.team_a)} · ${teamName(match.team_b)}` : match?.title || 'Partido por confirmar';
export const matchOption = (match) => `${matchName(match)} · ${match.title || label(match.kind)} · ${dateTime(match.scheduled_at)}`;
export function numeric(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
export function displayNumber(value) { return numeric(value) === null ? '—' : value; }
export function safeWebUrl(origin, webPath) {
  if (!origin || typeof webPath !== 'string' || !webPath.startsWith('/') || webPath.startsWith('//') || webPath.includes('\\')) return null;
  try {
    const base = new URL(origin);
    const url = new URL(webPath, base);
    if (!['http:', 'https:'].includes(base.protocol) || url.origin !== base.origin) return null;
    return url.href;
  } catch { return null; }
}
export function approvedMaps(statistics) {
  const maps = Array.isArray(statistics) ? statistics : statistics?.maps || [];
  return maps.filter((m) => m.status === 'approved');
}
export function playersForMap(map) { return Array.isArray(map?.players) ? map.players : []; }
export function rosterRows(roster) {
  if (Array.isArray(roster)) return roster;
  if (roster && typeof roster === 'object') return Object.entries(roster).flatMap(([side, rows]) => Array.isArray(rows) ? rows.map((p) => ({ ...p, side })) : []);
  return [];
}
export function canSendCommand(command, writeEnabled, supported, now = Date.now()) {
  if (!writeEnabled || !supported || ['acknowledged', 'sent', 'cancelled', 'rejected'].includes(command.status)) return false;
  if (command.status === 'sending' && now - command.updated_at < 30000) return false;
  // A lost ACK can remove the source from the pending feed. The same command ID
  // must remain retryable so CTP can return its already-committed decision.
  // Fresh proposals and the Ranked command list may omit source metadata.
  // Only a known integer revision can prove that a first attempt is stale;
  // the server independently revalidates the resource and actor before sending.
  if (command.attempts === 0 && (command.source_available === false || (command.type !== 'sanction.create' && Number.isInteger(command.source_version_current) && command.source_version_current !== command.expected_version))) return false;
  return true;
}

export function officialResult(match) {
  if (!match?.confirmed) return 'Pendiente de confirmación';
  if (numeric(match.score_a) !== null && numeric(match.score_b) !== null) return `${match.score_a} – ${match.score_b}`;
  if (match.winner_id && match.team_a?.id === match.winner_id) return `Gana ${teamName(match.team_a)}`;
  if (match.winner_id && match.team_b?.id === match.winner_id) return `Gana ${teamName(match.team_b)}`;
  if (match.winner_side === 'a' || match.winner_side === 'b') return `Gana ${teamName(match[`team_${match.winner_side}`])}`;
  return 'Confirmado · marcador no disponible';
}

// Each ratio states its sample and excludes maps with either missing numerator or denominator.
// Pending/rejected revisions never contribute to a caster comparison.
export function playerInsights(matches, playerIds) {
  const ids = new Set(playerIds);
  const totals = new Map([...ids].map((id) => [id, { id, name: '', maps: 0, complete_maps: 0, kills: 0, deaths: 0, modes: new Map() }]));
  const seen = new Set();
  for (const match of matches) for (const map of approvedMaps(match.statistics)) {
    const mapId = `${match.id}:${map.id || map.map_number || map.map_name}`;
    if (seen.has(mapId)) continue;
    seen.add(mapId);
    for (const p of playersForMap(map)) {
      const id = p.id || p.player_id || p.user_id;
      const row = totals.get(id);
      if (!row) continue;
      row.maps++; row.name ||= p.username || p.gamertag || p.name || 'Jugador';
      const mode = map.mode || 'Sin modo';
      row.modes.set(mode, (row.modes.get(mode) || 0) + 1);
      if (numeric(p.kills) !== null && numeric(p.deaths) !== null) { row.complete_maps++; row.kills += p.kills; row.deaths += p.deaths; }
    }
  }
  return [...totals.values()].filter((r) => r.maps > 0).map((r) => ({ ...r, kd: r.complete_maps && r.deaths > 0 ? r.kills / r.deaths : null, modes: [...r.modes].map(([name, maps]) => ({ name, maps })) }));
}
