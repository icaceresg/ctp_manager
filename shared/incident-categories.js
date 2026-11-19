export const OFFICIAL_INCIDENT_CATEGORIES = Object.freeze(['support', 'challenge', 'ranked', 'tournament']);
export const INCIDENT_CATEGORIES = Object.freeze([...OFFICIAL_INCIDENT_CATEGORIES, 'internal']);

export function incidentCategory(incident) {
  if (incident.source === 'manager') return 'internal';
  return OFFICIAL_INCIDENT_CATEGORIES.includes(incident.kind) ? incident.kind : 'support';
}
