export { tournamentState } from '../operations/tournamentState.js';
// Borrador de «Publicación web»: los cambios se acumulan y se publican juntos
// con un único motivo, en una sola revisión de CTP.
// `found` guarda nombre y etiqueta de los clubes añadidos desde la búsqueda; no se envía.
export const EMPTY_DRAFT = Object.freeze({ sections: {}, tournaments: {}, clubs: {}, tax: {}, eu_rates: {}, found: {} });
export const PROGRAM_LABELS = Object.freeze({ team_pass: 'Team Pass', semi_team_pass: 'Semi-Team Pass', circuit_pass: 'Circuit Pass' });

export const COUNTRY_LABELS = Object.freeze({
  AT: 'Austria', BE: 'Bélgica', BG: 'Bulgaria', HR: 'Croacia', CY: 'Chipre', CZ: 'Chequia', DK: 'Dinamarca', EE: 'Estonia', FI: 'Finlandia',
  FR: 'Francia', DE: 'Alemania', GR: 'Grecia', HU: 'Hungría', IE: 'Irlanda', IT: 'Italia', LV: 'Letonia', LT: 'Lituania', LU: 'Luxemburgo',
  MT: 'Malta', NL: 'Países Bajos', PL: 'Polonia', PT: 'Portugal', RO: 'Rumanía', SK: 'Eslovaquia', SI: 'Eslovenia', SE: 'Suecia',
});
export const KIND_LABELS = Object.freeze({ cup: 'Cup', major: 'Major', personalizado: 'Especial', fuera_de_circuito: 'Fuera de circuito' });
export const STATUS_LABELS = Object.freeze({ borrador: 'Oculto', inscripcion_abierta: 'Publicado', en_curso: 'En curso', finalizado: 'Finalizado', cancelado: 'Cancelado' });

const drop = (record, key) => { const next = { ...record }; delete next[key]; return next; };

/** Pone o quita un cambio; si vuelve al valor publicado, deja de estar pendiente. */
export function setSection(draft, snapshot, key, value) {
  const sections = snapshot.sections[key] === value ? drop(draft.sections, key) : { ...draft.sections, [key]: value };
  return { ...draft, sections };
}
/** Valores publicados de un club (o de uno recién encontrado, que aún no tiene programa). */
function clubBase(club) {
  const branding = club.branding || {};
  return { announced: club.announced === true, program: club.program === 'semi_team_pass' ? 'semi_team_pass' : null, circuit_pass: club.circuit_pass === true,
    primary_color: branding.primary_color, secondary_color: branding.secondary_color, tagline: branding.tagline ?? '', logo_path: branding.logo_path ?? null, cover_path: branding.cover_path ?? null };
}
/** change: announced | program | circuit_pass | colores, lema e imágenes. */
export function setClub(draft, club, change) {
  const base = clubBase(club), current = { ...(draft.clubs[club.id] || {}), ...change };
  for (const key of Object.keys(current)) if (current[key] === base[key]) delete current[key];
  const clubs = Object.keys(current).length ? { ...draft.clubs, [club.id]: current } : drop(draft.clubs, club.id);
  const found = club.found && clubs[club.id] ? { ...draft.found, [club.id]: { name: club.name, tag: club.tag } } : clubs[club.id] ? draft.found : drop(draft.found, club.id);
  return { ...draft, clubs, found };
}
export function setTournament(draft, tournament, change) {
  const current = { ...(draft.tournaments[tournament.id] || {}), ...change };
  if (current.visible === tournament.visible) delete current.visible;
  if (current.date_visible === tournament.date_visible) delete current.date_visible;
  if ('host_club_id' in current && current.host_club_id === (tournament.host?.id ?? null)) delete current.host_club_id;
  if (typeof current.registration_open_now !== 'boolean' || current.registration_open_now === tournament.registration_open) delete current.registration_open_now;
  const tournaments = Object.keys(current).length ? { ...draft.tournaments, [tournament.id]: current } : drop(draft.tournaments, tournament.id);
  return { ...draft, tournaments };
}
/** key: spain_rate_bps | oss_active | management_fee_active | management_fee_cents. */
export function setTax(draft, snapshot, key, value) {
  const tax = snapshot.tax[key] === value ? drop(draft.tax, key) : { ...draft.tax, [key]: value };
  return { ...draft, tax };
}
export function setEuRate(draft, rate, value) {
  const eu_rates = rate.rate_bps === value ? drop(draft.eu_rates, rate.country) : { ...draft.eu_rates, [rate.country]: value };
  return { ...draft, eu_rates };
}

export function pendingCount(draft) {
  return Object.keys(draft.sections).length + Object.keys(draft.tournaments).length + Object.keys(draft.clubs).length
    + Object.keys(draft.tax).length + Object.keys(draft.eu_rates).length;
}

/** Convierte el borrador en el `changes` del protocolo; null si no hay nada. */
export function draftChanges(draft) {
  const changes = {};
  if (Object.keys(draft.sections).length) changes.sections = { ...draft.sections };
  const tournaments = Object.entries(draft.tournaments).map(([id, change]) => ({ id, ...change }));
  if (tournaments.length) changes.tournaments = tournaments;
  const clubs = Object.entries(draft.clubs).map(([id, change]) => ({ id, ...change }));
  if (clubs.length) changes.clubs = clubs;
  const tax = { ...draft.tax };
  const rates = Object.entries(draft.eu_rates).map(([country, rate_bps]) => ({ country, rate_bps }));
  if (rates.length) tax.eu_rates = rates;
  if (Object.keys(tax).length) changes.tax = tax;
  return Object.keys(changes).length ? changes : null;
}

/** Valor efectivo (borrador o publicado) para pintar cada control. */
export const effective = {
  section: (draft, snapshot, key) => (key in draft.sections ? draft.sections[key] : snapshot.sections[key]),
  club: (draft, club, key = 'announced') => (draft.clubs[club.id] && key in draft.clubs[club.id] ? draft.clubs[club.id][key] : clubBase(club)[key]),
  visible: (draft, t) => (draft.tournaments[t.id] && 'visible' in draft.tournaments[t.id] ? draft.tournaments[t.id].visible : t.visible),
  dateVisible: (draft, t) => (draft.tournaments[t.id] && 'date_visible' in draft.tournaments[t.id] ? draft.tournaments[t.id].date_visible : t.date_visible !== false),
  host: (draft, t) => (draft.tournaments[t.id] && 'host_club_id' in draft.tournaments[t.id] ? draft.tournaments[t.id].host_club_id : t.host?.id ?? null),
  openNow: (draft, t) => draft.tournaments[t.id]?.registration_open_now === true,
  tax: (draft, snapshot, key) => (key in draft.tax ? draft.tax[key] : snapshot.tax[key]),
  euRate: (draft, rate) => (rate.country in draft.eu_rates ? draft.eu_rates[rate.country] : rate.rate_bps),
};

/** Solo se pueden mostrar/ocultar torneos que aún no han empezado. */
export const tournamentToggleable = t => ['borrador', 'inscripcion_abierta'].includes(t.status);
/** Se puede adelantar la apertura si la inscripción no ha abierto y no ha cerrado. */
export const canOpenRegistration = (t, now = Date.now()) => !t.registration_open
  && (!t.registration_close_at || Date.parse(t.registration_close_at) > now)
  && (!t.registration_open_at || Date.parse(t.registration_open_at) > now);

/** Parse «21» o «21,5» → 2100 / 2150 puntos básicos (o «1,50» € → 150 céntimos con max 20). */
export function percentToBps(text, max = 30) {
  const value = Number(String(text).trim().replace(',', '.'));
  if (!Number.isFinite(value) || value < 0 || value > max) return null;
  return Math.round(value * 100);
}
export const bpsToPercent = bps => (bps / 100).toLocaleString('es-ES', { maximumFractionDigits: 2 });
export const euros = cents => (cents / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
/** Ventas a particulares de la UE este año frente al umbral OSS (10.000 €). */
export function ossProgress(tax) {
  const ratio = tax.oss_threshold_cents > 0 ? tax.eu_consumer_sales_cents / tax.oss_threshold_cents : 0;
  return { ratio, percent: Math.min(100, Math.round(ratio * 100)), level: ratio >= 1 ? 'over' : ratio >= 0.8 ? 'near' : 'ok' };
}
