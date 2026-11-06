import { HttpError } from './auth.js';

// CTP 369 manager_tournament_live: administrators and referees correct a
// running tournament (results, bracket slots, participants, schedule, status).
// Errors travel as translation keys; the browser translates them.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const REVISION = /^[a-f0-9]{32}$/;
const STATUSES = ['borrador', 'inscripcion_abierta', 'en_curso', 'finalizado', 'cancelado'];
const TARGET_STATUSES = ['inscripcion_abierta', 'en_curso', 'finalizado', 'cancelado'];
const RESULTS = ['none', 'pending', 'disputed', 'confirmed'];
const VETO = ['none', 'ready', 'running', 'done'];
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
  tournament_live_closed: 'closed', tournament_live_message_invalid: 'messageInvalid', tournament_live_match_started: 'matchStarted',
  tournament_live_veto_not_ready: 'vetoNotReady', tournament_live_veto_too_early: 'vetoTooEarly', tournament_live_step_missing: 'stepMissing',
  tournament_live_step_open: 'stepOpen', tournament_live_step_unchanged: 'stepUnchanged', tournament_live_map_unavailable: 'mapUnavailable',
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
        result_status: row.result_status, pick_ban_status: VETO.includes(row.pick_ban_status) ? row.pick_ban_status : 'none',
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

// CTP 370: the referee match page. Read one match, write in its chat as staff
// and control its pick & ban directly (prepare, open, reset, correct a step).
export const TOURNAMENT_LIVE_MATCH_WRITES = Object.freeze({
  chat_send: ['body'],
  veto_prepare: [],
  veto_start: [],
  veto_reset: [],
  veto_set_step: ['step_index', 'map_name'],
});
const STEP_ACTIONS = ['ban', 'pick', 'side'];
const SIDES = ['a', 'b'];
export const CHAT_MAX = 1000;

export function tournamentLiveMatchRead(tournamentId, matchId) {
  return { action: 'match_get', tournament_id: id(tournamentId), match_id: id(matchId) };
}
/** Chat needs no reason or revision; every veto action needs both. */
export function tournamentLiveMatchPayload(tournamentId, matchId, body = {}) {
  if (!object(body) || typeof body.action !== 'string' || !Object.hasOwn(TOURNAMENT_LIVE_MATCH_WRITES, body.action)) fail();
  const fields = TOURNAMENT_LIVE_MATCH_WRITES[body.action];
  const base = { action: body.action, tournament_id: id(tournamentId), match_id: id(matchId) };
  if (body.action === 'chat_send') {
    if (!only(body, ['action', 'body'])) fail();
    const message = typeof body.body === 'string' ? body.body.replace(/\r\n?/g, '\n').trim() : '';
    if (!message || message.length > CHAT_MAX || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(message)) fail(400, 'messageInvalid');
    return { ...base, body: message };
  }
  if (!only(body, ['action', 'expected_revision', 'reason', ...fields])) fail();
  if (typeof body.expected_revision !== 'string' || !REVISION.test(body.expected_revision)) fail(409, 'conflict');
  if (!text(body.reason, 500) || body.reason.trim().length < 12) fail(400, 'reason');
  const payload = { ...base, expected_revision: body.expected_revision, reason: body.reason.trim() };
  if (body.action === 'veto_set_step') {
    if (!Number.isInteger(body.step_index) || body.step_index < 0 || body.step_index > 999) fail();
    if (!text(body.map_name, 80) || !body.map_name.trim()) fail();
    payload.step_index = body.step_index; payload.map_name = body.map_name.trim();
  }
  return payload;
}

/** Explicit DTO for one match: public names, veto sequence, pool and chat. */
export function tournamentLiveMatchResponse(value, payload) {
  if (!object(value)) fail(502, 'unavailable');
  const t = value.tournament, m = value.match;
  if (!object(t) || t.id !== payload.tournament_id || !text(t.name) || !STATUSES.includes(t.status)
    || !object(m) || typeof m.id !== 'string' || m.id.toLowerCase() !== payload.match_id
    || !['grupos', 'eliminacion'].includes(m.phase) || !Number.isInteger(m.round) || !Number.isInteger(m.position)
    || ![1, 3, 5, 7, 9].includes(m.best_of) || !RESULTS.includes(m.result_status)
    || (m.winner_id != null && (typeof m.winner_id !== 'string' || !UUID.test(m.winner_id)))
    || typeof value.revision !== 'string' || !REVISION.test(value.revision)
    || !Array.isArray(value.steps) || value.steps.length > 200 || !Array.isArray(value.pool) || value.pool.length > 300
    || !Array.isArray(value.messages) || value.messages.length > 100) fail(502, 'unavailable');
  const result = {
    tournament: { id: t.id, name: t.name, status: t.status, pick_ban_turn_seconds: Number.isInteger(t.pick_ban_turn_seconds) ? t.pick_ban_turn_seconds : null },
    match: {
      id: m.id.toLowerCase(), phase: m.phase, group_label: text(m.group_label, 20) ? m.group_label : null, round: m.round, position: m.position,
      is_third_place: m.is_third_place === true, best_of: m.best_of,
      entrant_a: entrant(m.entrant_a), entrant_b: entrant(m.entrant_b),
      winner_id: m.winner_id ? m.winner_id.toLowerCase() : null, score_a: optionalInt(m.score_a), score_b: optionalInt(m.score_b),
      result_status: m.result_status, scheduled_at: optionalDate(m.scheduled_at),
      pick_ban_status: VETO.includes(m.pick_ban_status) ? m.pick_ban_status : 'none',
      pick_ban_ready_a: m.pick_ban_ready_a === true, pick_ban_ready_b: m.pick_ban_ready_b === true,
      pick_ban_started_at: optionalDate(m.pick_ban_started_at), pick_ban_role_choice: ['A', 'B'].includes(m.pick_ban_role_choice) ? m.pick_ban_role_choice : null,
      started: m.started === true,
    },
    steps: value.steps.map(row => {
      if (!object(row) || typeof row.id !== 'string' || !UUID.test(row.id) || !Number.isInteger(row.step_index) || !Number.isInteger(row.map_slot)
        || !STEP_ACTIONS.includes(row.action) || !SIDES.includes(row.actor_side) || !text(row.mode, 80)
        || (row.map_name != null && !text(row.map_name, 80))) fail(502, 'unavailable');
      return { id: row.id.toLowerCase(), step_index: row.step_index, map_slot: row.map_slot, mode: row.mode, action: row.action, actor_side: row.actor_side,
        map_name: row.map_name ?? null, auto: row.auto === true, deadline_at: optionalDate(row.deadline_at), decided_at: optionalDate(row.decided_at) };
    }),
    pool: value.pool.map(row => {
      if (!object(row) || !text(row.mode, 80) || !text(row.name, 80)) fail(502, 'unavailable');
      const image = typeof row.image_url === 'string' && row.image_url.length <= 500 && /^https:\/\//.test(row.image_url) ? row.image_url : null;
      return { mode: row.mode, name: row.name, image_url: image };
    }),
    messages: value.messages.map(row => {
      if (!object(row) || typeof row.id !== 'string' || !UUID.test(row.id) || typeof row.body !== 'string' || row.body.length > 4000
        || !date(row.created_at) || (row.author_name != null && !text(row.author_name))) fail(502, 'unavailable');
      return { id: row.id.toLowerCase(), body: row.body, system: row.system === true, created_at: row.created_at, author_name: row.author_name ?? null };
    }),
    revision: value.revision,
  };
  if (payload.action !== 'match_get') {
    if (value.action !== payload.action || value.applied !== true) fail(502, 'unavailable');
    result.action = value.action; result.applied = true;
  }
  return result;
}
