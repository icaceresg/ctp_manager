import { HttpError } from './auth.js';

// CTP 369 manager_tournament_live: administrators and referees correct a
// running tournament (results, bracket slots, participants, schedule, status).
// Errors travel as translation keys; the browser translates them.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const REVISION = /^[a-f0-9]{32}$/;
const STATUSES = ['borrador', 'inscripcion_abierta', 'en_curso', 'finalizado', 'cancelado'];
const TARGET_STATUSES = ['inscripcion_abierta', 'en_curso', 'finalizado', 'cancelado'];
const RESULTS = ['none', 'pending', 'disputed', 'confirmed'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const text = (value, max = 200) => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const fail = (status = 400, key = 'invalid') => { throw new HttpError(status, `manager.tournamentLive.error.${key}`); };
const id = value => { if (typeof value !== 'string' || !UUID.test(value)) fail(); return value.toLowerCase(); };
const date = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const optionalDate = value => value == null ? null : date(value) ? value : fail(502, 'unavailable');
const optionalInt = value => value == null ? null : Number.isInteger(value) && value >= 0 && value <= 99 ? value : fail(502, 'unavailable');

export const TOURNAMENT_LIVE_WRITES = Object.freeze({
  set_result: ['match_id', 'maps_a', 'maps_b'],
  revert_result: ['match_id'],
  replace_entrant: ['match_id', 'side', 'participant_id'],
  swap_entrants: ['match_id', 'side', 'other_match_id', 'other_side'],
  schedule_match: ['match_id', 'scheduled_at'],
  set_best_of: ['match_id', 'best_of'],
  substitute_participant: ['participant_id', 'entrant_id'],
  add_participant: ['entrant_kind', 'entrant_id'],
  remove_participant: ['participant_id'],
  disqualify: ['participant_id'],
  set_status: ['status'],
});
/** Fixed CTP machine codes → `manager.tournamentLive.error.*` keys. */
export const TOURNAMENT_LIVE_ERRORS = Object.freeze({
  tournament_live_invalid: 'invalid', tournament_live_not_found: 'notFound', tournament_live_conflict: 'conflict',
  tournament_live_reason_invalid: 'reason', tournament_live_forbidden: 'forbidden', tournament_live_match_missing: 'matchMissing',
  tournament_live_own_match: 'ownMatch', tournament_live_participant_missing: 'participantMissing',
  tournament_live_match_incomplete: 'matchIncomplete', tournament_live_score_invalid: 'scoreInvalid',
  tournament_live_match_unplayed: 'matchUnplayed', tournament_live_match_played: 'matchPlayed', tournament_live_veto_started: 'vetoStarted',
  tournament_live_same_entrant: 'sameEntrant', tournament_live_entrant_missing: 'entrantMissing',
  tournament_live_already_registered: 'alreadyRegistered', tournament_live_kind_mismatch: 'kindMismatch', tournament_live_full: 'full',
  tournament_live_empty_roster: 'emptyRoster', tournament_live_in_bracket: 'inBracket', tournament_live_nothing_pending: 'nothingPending',
  tournament_live_status_invalid: 'statusInvalid', tournament_live_unpublished: 'unpublished',
  tournament_live_matches_pending: 'matchesPending', tournament_live_rejected: 'rejected',
});
export function tournamentLiveProblem(code) {
  return typeof code === 'string' && Object.hasOwn(TOURNAMENT_LIVE_ERRORS, code) ? `manager.tournamentLive.error.${TOURNAMENT_LIVE_ERRORS[code]}` : null;
}

export function tournamentLiveRead(tournamentId) { return { action: 'get', tournament_id: id(tournamentId) }; }
export function tournamentLiveQuery(tournamentId, query) {
  if (typeof query !== 'string' || !text(query, 40) || query.trim().length < 3) fail(400, 'query');
  return { action: 'candidates', tournament_id: id(tournamentId), query: query.trim() };
}

/** Only known fields for the chosen action cross the bridge; CTP re-validates every rule. */
export function tournamentLivePayload(tournamentId, body = {}) {
  if (!object(body) || typeof body.action !== 'string' || !Object.hasOwn(TOURNAMENT_LIVE_WRITES, body.action)) fail();
  const fields = TOURNAMENT_LIVE_WRITES[body.action];
  if (!only(body, ['action', 'expected_revision', 'reason', ...fields])) fail();
  if (typeof body.expected_revision !== 'string' || !REVISION.test(body.expected_revision)) fail(409, 'conflict');
  if (!text(body.reason, 500) || body.reason.trim().length < 12) fail(400, 'reason');
  const payload = { action: body.action, tournament_id: id(tournamentId), expected_revision: body.expected_revision, reason: body.reason.trim() };
  for (const field of ['match_id', 'other_match_id', 'entrant_id']) if (fields.includes(field)) payload[field] = id(body[field]);
  for (const field of ['side', 'other_side']) if (fields.includes(field)) {
    if (!['a', 'b'].includes(body[field])) fail();
    payload[field] = body[field];
  }
  if (fields.includes('participant_id')) {
    // Only replace_entrant may clear a slot (participant_id null).
    payload.participant_id = body.action === 'replace_entrant' && body.participant_id == null ? null : id(body.participant_id);
  }
  if (body.action === 'set_result') for (const field of ['maps_a', 'maps_b']) {
    if (!Number.isInteger(body[field]) || body[field] < 0 || body[field] > 9) fail(400, 'scoreInvalid');
    payload[field] = body[field];
  }
  if (body.action === 'set_best_of') { if (![1, 3, 5, 7, 9].includes(body.best_of)) fail(); payload.best_of = body.best_of; }
  if (body.action === 'add_participant') { if (!['team', 'user'].includes(body.entrant_kind)) fail(); payload.entrant_kind = body.entrant_kind; }
  if (body.action === 'set_status') { if (!TARGET_STATUSES.includes(body.status)) fail(); payload.status = body.status; }
  if (body.action === 'schedule_match') {
    if (body.scheduled_at == null || body.scheduled_at === '') payload.scheduled_at = null;
    else { if (!date(body.scheduled_at)) fail(); payload.scheduled_at = new Date(body.scheduled_at).toISOString(); }
  }
  return payload;
}

function entrant(value) {
  if (value == null) return null;
  if (!object(value) || !['team', 'user'].includes(value.kind) || typeof value.id !== 'string' || !UUID.test(value.id) || (value.name != null && !text(value.name))) fail(502, 'unavailable');
  return { kind: value.kind, id: value.id.toLowerCase(), name: value.name ?? null };
}
/** Explicit DTO: public names, bracket structure, results and schedule. */
export function tournamentLiveResponse(value, payload) {
  if (!object(value)) fail(502, 'unavailable');
  if (payload.action === 'candidates') {
    if (!Array.isArray(value.items) || value.items.length > 20) fail(502, 'unavailable');
    return { items: value.items.map(row => {
      const base = entrant(row);
      if (!base || !base.name || typeof row.registered !== 'boolean') fail(502, 'unavailable');
      return { ...base, registered: row.registered };
    }) };
  }
  const t = value.tournament;
  if (!object(t) || t.id !== payload.tournament_id || !text(t.name) || !STATUSES.includes(t.status)
    || typeof value.revision !== 'string' || !REVISION.test(value.revision)
    || !Array.isArray(value.participants) || value.participants.length > 512 || !Array.isArray(value.matches) || value.matches.length > 1024) fail(502, 'unavailable');
  const result = {
    tournament: {
      id: t.id, name: t.name, status: t.status,
      participant_type: ['individual', 'equipo', 'ambos'].includes(t.participant_type) ? t.participant_type : null,
      max_participants: Number.isInteger(t.max_participants) && t.max_participants > 0 && t.max_participants <= 1024 ? t.max_participants : null,
      start_at: optionalDate(t.start_at), groups_published_at: optionalDate(t.groups_published_at), bracket_published_at: optionalDate(t.bracket_published_at),
    },
    participants: value.participants.map(row => {
      if (!object(row) || typeof row.id !== 'string' || !UUID.test(row.id) || !['team', 'user'].includes(row.entrant_kind)
        || typeof row.entrant_id !== 'string' || !UUID.test(row.entrant_id) || (row.name != null && !text(row.name))
        || !Array.isArray(row.roster) || row.roster.length > 30 || row.roster.some(name => !text(name))) fail(502, 'unavailable');
      return { id: row.id.toLowerCase(), entrant_kind: row.entrant_kind, entrant_id: row.entrant_id.toLowerCase(), name: row.name ?? null,
        seed: Number.isInteger(row.seed) ? row.seed : null, roster: row.roster };
    }),
    matches: value.matches.map(row => {
      if (!object(row) || typeof row.id !== 'string' || !UUID.test(row.id) || !Number.isInteger(row.round) || !Number.isInteger(row.position)
        || !['grupos', 'eliminacion'].includes(row.phase) || (row.group_label != null && !text(row.group_label, 20))
        || ![1, 3, 5, 7, 9].includes(row.best_of) || !RESULTS.includes(row.result_status)
        || (row.winner_id != null && (typeof row.winner_id !== 'string' || !UUID.test(row.winner_id)))) fail(502, 'unavailable');
      return {
        id: row.id.toLowerCase(), phase: row.phase, group_label: row.group_label ?? null, round: row.round, position: row.position,
        is_third_place: row.is_third_place === true, best_of: row.best_of,
        entrant_a: entrant(row.entrant_a), entrant_b: entrant(row.entrant_b),
        winner_id: row.winner_id ? row.winner_id.toLowerCase() : null, score_a: optionalInt(row.score_a), score_b: optionalInt(row.score_b),
        result_status: row.result_status, veto_status: text(row.pick_ban_status, 20) ? row.pick_ban_status : 'none',
        scheduled_at: optionalDate(row.scheduled_at),
      };
    }),
    revision: value.revision,
  };
  if (payload.action !== 'get') {
    if (value.action !== payload.action || value.applied !== true) fail(502, 'unavailable');
    result.action = value.action; result.applied = true;
  }
  return result;
}
