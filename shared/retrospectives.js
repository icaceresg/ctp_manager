/** Shared display catalogues for internal, staff-only retrospectives. */
export const RETRO_KINDS = Object.freeze([
  { id: 'keep', label: 'Mantener' },
  { id: 'improve', label: 'Corregir' },
  { id: 'idea', label: 'Proponer' },
]);
export const RETRO_AREAS = Object.freeze([
  { id: 'competition', label: 'Competición' },
  { id: 'refereeing', label: 'Arbitraje' },
  { id: 'production', label: 'Producción y directo' },
  { id: 'technology', label: 'Web y tecnología' },
  { id: 'communications', label: 'Comunicación' },
  { id: 'clubs', label: 'Clubes y jugadores' },
  { id: 'organization', label: 'Organización' },
]);
export const RETRO_SEVERITIES = Object.freeze([
  { id: 'low', label: 'Bajo' },
  { id: 'medium', label: 'Medio' },
  { id: 'high', label: 'Alto' },
  { id: 'critical', label: 'Crítico' },
]);
export const RETRO_PHASES = Object.freeze([
  { id: 'collecting', label: 'Recogiendo aportaciones' },
  { id: 'reviewing', label: 'En revisión' },
  { id: 'closed', label: 'Cerrada' },
]);
export const RETRO_ACTION_STATUSES = Object.freeze([
  { id: 'todo', label: 'Pendiente' },
  { id: 'doing', label: 'En curso' },
  { id: 'done', label: 'Completada' },
]);
export const RETRO_ACTION_PRIORITIES = Object.freeze([
  { id: 'low', label: 'Baja' },
  { id: 'normal', label: 'Normal' },
  { id: 'high', label: 'Alta' },
]);
