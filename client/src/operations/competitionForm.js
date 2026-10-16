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
