// Secciones de la intranet y roles con los que se crea al empezar.
// El administrador ve todo; el resto de usuarios ve las secciones de sus roles.

export const SECTIONS = [
  { id: 'calendario', label: 'Calendario', description: 'Tarjetas de contenido para redes e ideas sin fecha' },
  { id: 'recursos', label: 'Recursos', description: 'Recursos necesarios de cada publicación' },
  { id: 'escaleta', label: 'Escaleta', description: 'Escaletas de directos y vídeos' },
  { id: 'disponibilidad', label: 'Disponibilidad', description: 'Calendario de disponibilidad: cada persona marca qué días puede' },
  { id: 'tablero', label: 'Tablero', description: 'Tablero de tareas tipo Trello (listas y tarjetas)' },
];

export const SECTION_IDS = SECTIONS.map((s) => s.id);

export const DEFAULT_ROLES = [
  { name: 'RRSS', sections: ['calendario', 'recursos'] },
  { name: 'CASTER', sections: ['escaleta', 'disponibilidad'] },
  { name: 'ÁRBITROS', sections: ['escaleta'] },
  { name: 'DIRECTIVOS', sections: ['tablero'] },
];

export function canAccess(user, section) {
  return Boolean(user && (user.is_admin || user.sections?.includes(section)));
}
