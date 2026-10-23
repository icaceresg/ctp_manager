// Secciones de la intranet y roles con los que se crea al empezar.
// El administrador ve todo; el resto de usuarios ve las secciones de sus roles.

export const SECTIONS = [
  { id: 'calendario', label: 'Calendario', description: 'Tarjetas de contenido para redes e ideas sin fecha' },
  { id: 'recursos', label: 'Recursos', description: 'Recursos necesarios de cada publicación' },
  { id: 'escaleta', label: 'Escaleta', description: 'Escaletas de directos y vídeos' },
  { id: 'disponibilidad', label: 'Disponibilidad', description: 'Calendario de disponibilidad: cada persona marca qué días puede' },
  { id: 'tablero', label: 'Tablero', description: 'Tablero de tareas tipo Trello (listas y tarjetas)' },
  { id: 'operaciones', label: 'Jornada y turnos', description: 'Coordinar partidos y asignar personal a la jornada' },
  { id: 'arbitraje', label: 'Incidencias y revisión', description: 'Expedientes, revisión de estadísticas y propuestas disciplinarias' },
  { id: 'casters', label: 'Dossier de casters', description: 'Partidos, estadísticas aprobadas y notas editoriales' },
  { id: 'realizacion', label: 'Preparación de directos', description: 'Vincular escaletas, coordinar al equipo y preparar notas para el directo' },
  { id: 'clubes', label: 'Revisión de clubes', description: 'Revisar identidad de clubes; no concede ni modifica pagos' },
  { id: 'comunicaciones', label: 'Comunicación operativa', description: 'Entregas a Discord y contenido de resultados confirmados' },
];

export const SECTION_IDS = SECTIONS.map((s) => s.id);

export const STAFF_KINDS = [
  { id: 'operations', label: 'Coordinación de competición' },
  { id: 'referee', label: 'Arbitraje' },
  { id: 'production', label: 'Producción' },
  { id: 'caster', label: 'Caster' },
  { id: 'communications', label: 'Comunicación y diseño' },
  { id: 'clubs', label: 'Revisión de clubes' },
  { id: 'executive', label: 'Dirección' },
];
export const DEFAULT_ROLES = [
  { name: 'RRSS', staff_kind: 'communications', sections: ['calendario', 'recursos', 'comunicaciones'] },
  { name: 'CASTER', staff_kind: 'caster', sections: ['escaleta', 'disponibilidad', 'casters'] },
  { name: 'ÁRBITROS', staff_kind: 'referee', sections: ['arbitraje', 'disponibilidad'] },
  { name: 'PRODUCCIÓN', staff_kind: 'production', sections: ['realizacion', 'escaleta', 'disponibilidad'] },
  { name: 'COORDINACIÓN', staff_kind: 'operations', sections: ['operaciones', 'disponibilidad', 'tablero'] },
  { name: 'CLUBES', staff_kind: 'clubs', sections: ['clubes'] },
  { name: 'DIRECTIVOS', staff_kind: 'executive', sections: ['tablero', 'operaciones'] },
];

// Central grants cap editable local templates; extra role assignments cannot
// enlarge the authority of a CTP staff account.
export const STAFF_SECTION_CAPS = Object.freeze(Object.fromEntries(DEFAULT_ROLES.map(role => [role.staff_kind, Object.freeze([...role.sections])])));

export function canManageStaff(user) {
  return Boolean(user && (user.is_admin || user.auth_mode === 'ctp' && user.ctp_role === 'staff' && user.staff_kind === 'operations'));
}

export function isStaffUser(user) {
  return Boolean(user && (user.is_admin || user.roles?.some((r) => STAFF_KINDS.some((kind) => kind.id === r.staff_kind))));
}

export function canAccess(user, section) {
  return Boolean(user && (user.is_admin || user.sections?.includes(section)));
}

/** Ranked supervision is limited to the current CTP game role, not local sections. */
export function canManageRanked(user) {
  if (!user) return false;
  if (user.auth_mode === 'ctp') return Boolean(user.ctp_user_id && (user.ctp_role === 'referee' || user.ctp_role === 'admin' && user.is_admin));
  return Boolean(user.is_admin);
}
