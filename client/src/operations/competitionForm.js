import { translate } from '../i18n/runtime.js';

const RANDOM_SEED_EVENTS = new Set(['inaugural', 'cup-1', 'cup-4', 'cup-7', 'cup-10']);
const PUBLICATION_ERRORS = ['tournaments.staff.drawBeforeClose', 'tournaments.staff.drawVisibilityWindow', 'tournaments.staff.drawVisibilityLocked',
  'tournaments.staff.directDrawIncomplete', 'tournaments.staff.directDrawChanged'];

const RESULT_ERRORS = {
  tournament_live_downstream_started: 'manager.tournamentLive.error.downstreamStarted',
  tournament_live_playoffs_started: 'manager.tournamentLive.error.playoffsStarted',
  tournament_live_redraw_required: 'manager.tournamentLive.error.redrawRequired',
};

export function competitionErrorMessage(message, fallback = message) {
  if (PUBLICATION_ERRORS.includes(message)) return translate(message);
  return Object.hasOwn(RESULT_ERRORS, message) ? translate(RESULT_ERRORS[message]) : fallback;
}

export function effectiveTournamentSeedMode(tournament) {
  return tournament?.seeding_mode ?? (RANDOM_SEED_EVENTS.has(tournament?.circuit_code) ? 'random' : 'season_points');
}

export const TOURNAMENT_PRESENTATION_FIELDS = ['name','description','rules','banner','image_url','host_club_id','description_i18n','rules_pdf_url','stream_url','contact_info'];

/** A live tournament edit can never forward structure/calendar inputs. */
export function tournamentPresentationPayload(body, previousTranslations = {}) {
  const payload = Object.fromEntries(TOURNAMENT_PRESENTATION_FIELDS.filter(key => key !== 'description_i18n' && body[key] !== undefined).map(key => [key, body[key]]));
  if ('host_club_id' in payload) payload.host_club_id ||= null;
  payload.description_i18n = { ...previousTranslations, ...Object.fromEntries(['es','en','it','fr','pt','de'].map(locale => [locale, body[`description_${locale}`] ?? previousTranslations[locale] ?? ''])) };
  return payload;
}

/** A cancelled proposal did not delete anything. Navigate only after a real ACK. */
export function shouldLeaveDeletedTournament(command, action, selectedId) {
  return action === 'send' && (command?.type || command?.action) === 'tournament.delete'
    && Boolean(selectedId) && (command.target_id || command.resource_id) === selectedId;
}
