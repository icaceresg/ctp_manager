// Borrador de «Publicación web»: los cambios se acumulan y se publican juntos
// con un único motivo, en una sola revisión de CTP.
export const EMPTY_DRAFT = Object.freeze({ sections: {}, tournaments: {}, clubs: {}, tax_zones: {} });

export const ZONE_LABELS = Object.freeze({
  ES: 'España · Península y Baleares', 'ES-CN': 'España · Canarias', 'ES-CE': 'España · Ceuta', 'ES-ML': 'España · Melilla',
  EU: 'Resto de la Unión Europea', NON_EU: 'Fuera de la Unión Europea',
});
export const KIND_LABELS = Object.freeze({ cup: 'Cup', major: 'Major', personalizado: 'Especial', fuera_de_circuito: 'Fuera de circuito' });
export const STATUS_LABELS = Object.freeze({ borrador: 'Oculto', inscripcion_abierta: 'Publicado', en_curso: 'En curso', finalizado: 'Finalizado', cancelado: 'Cancelado' });

const drop = (record, key) => { const next = { ...record }; delete next[key]; return next; };

/** Pone o quita un cambio; si vuelve al valor publicado, deja de estar pendiente. */
export function setSection(draft, snapshot, key, value) {
  const sections = snapshot.sections[key] === value ? drop(draft.sections, key) : { ...draft.sections, [key]: value };
  return { ...draft, sections };
}
export function setClub(draft, club, announced) {
  const clubs = club.announced === announced ? drop(draft.clubs, club.id) : { ...draft.clubs, [club.id]: announced };
  return { ...draft, clubs };
}
export function setTournament(draft, tournament, change) {
  const current = { ...(draft.tournaments[tournament.id] || {}), ...change };
  if (current.visible === tournament.visible) delete current.visible;
  if (current.registration_open_now !== true) delete current.registration_open_now;
  const tournaments = Object.keys(current).length ? { ...draft.tournaments, [tournament.id]: current } : drop(draft.tournaments, tournament.id);
  return { ...draft, tournaments };
}
export function setTaxZone(draft, zone, change) {
  const current = { ...(draft.tax_zones[zone.code] || {}), ...change };
  if (current.rate_bps === zone.rate_bps) delete current.rate_bps;
  if (current.active === zone.active) delete current.active;
  const tax_zones = Object.keys(current).length ? { ...draft.tax_zones, [zone.code]: current } : drop(draft.tax_zones, zone.code);
  return { ...draft, tax_zones };
}

export function pendingCount(draft) {
  return Object.keys(draft.sections).length + Object.keys(draft.tournaments).length + Object.keys(draft.clubs).length + Object.keys(draft.tax_zones).length;
}

/** Convierte el borrador en el `changes` del protocolo; null si no hay nada. */
export function draftChanges(draft) {
  const changes = {};
  if (Object.keys(draft.sections).length) changes.sections = { ...draft.sections };
  const tournaments = Object.entries(draft.tournaments).map(([id, change]) => ({ id, ...change }));
  if (tournaments.length) changes.tournaments = tournaments;
  const clubs = Object.entries(draft.clubs).map(([id, announced]) => ({ id, announced }));
  if (clubs.length) changes.clubs = clubs;
  const zones = Object.entries(draft.tax_zones).map(([code, change]) => ({ code, ...change }));
  if (zones.length) changes.tax_zones = zones;
  return Object.keys(changes).length ? changes : null;
}

/** Valor efectivo (borrador o publicado) para pintar cada control. */
export const effective = {
  section: (draft, snapshot, key) => (key in draft.sections ? draft.sections[key] : snapshot.sections[key]),
  club: (draft, club) => (club.id in draft.clubs ? draft.clubs[club.id] : club.announced),
  visible: (draft, t) => (draft.tournaments[t.id] && 'visible' in draft.tournaments[t.id] ? draft.tournaments[t.id].visible : t.visible),
  openNow: (draft, t) => draft.tournaments[t.id]?.registration_open_now === true,
  rate: (draft, z) => (draft.tax_zones[z.code] && 'rate_bps' in draft.tax_zones[z.code] ? draft.tax_zones[z.code].rate_bps : z.rate_bps),
  active: (draft, z) => (draft.tax_zones[z.code] && 'active' in draft.tax_zones[z.code] ? draft.tax_zones[z.code].active : z.active),
};

/** Solo se pueden mostrar/ocultar torneos que aún no han empezado. */
export const tournamentToggleable = t => ['borrador', 'inscripcion_abierta'].includes(t.status);
/** Se puede adelantar la apertura si la inscripción no ha abierto y no ha cerrado. */
export const canOpenRegistration = (t, now = Date.now()) => !t.registration_open
  && (!t.registration_close_at || Date.parse(t.registration_close_at) > now)
  && (!t.registration_open_at || Date.parse(t.registration_open_at) > now);

/** Parse «21» o «21,5» → 2100 / 2150 puntos básicos. */
export function percentToBps(text) {
  const value = Number(String(text).trim().replace(',', '.'));
  if (!Number.isFinite(value) || value < 0 || value > 30) return null;
  return Math.round(value * 100);
}
export const bpsToPercent = bps => (bps / 100).toLocaleString('es-ES', { maximumFractionDigits: 2 });
