// Pure model for Manager's live tournament control: bracket layout, match
// states, schedule planning and reason checks. No React and no translations:
// components turn the returned keys into copy.

export const REASON_MIN = 12;
export const REASON_MAX = 500;
export const BEST_OF = Object.freeze([1, 3, 5, 7, 9]);
/** Same transitions CTP accepts in manager_tournament_live (369). */
export const LIVE_STATUS_TRANSITIONS = Object.freeze({
  borrador: ['inscripcion_abierta', 'cancelado'], inscripcion_abierta: ['en_curso', 'cancelado'],
  en_curso: ['finalizado', 'cancelado'], finalizado: ['en_curso'], cancelado: [],
});
export const STATUSES = Object.freeze(['borrador', 'inscripcion_abierta', 'en_curso', 'finalizado', 'cancelado']);

const byPosition = (a, b) => (a.position ?? 0) - (b.position ?? 0) || String(a.id).localeCompare(String(b.id));
export const isGroupMatch = match => match?.phase === 'grupos';
export const winsNeeded = bestOf => (Number(bestOf) + 1) / 2;
export const hasResult = match => Boolean(match?.winner_id) || (match?.result_status ?? 'none') !== 'none';
export const isComplete = match => Boolean(match?.entrant_a && match?.entrant_b);
export const vetoStarted = match => ['running', 'done'].includes(match?.pick_ban_status);
/** Entrants and series length only change before any result and before the veto. */
export const slotsLocked = match => Boolean(match?.started) || hasResult(match) || vetoStarted(match);
/** Leave the schedule intact once the match has started. */
export const scheduleLocked = slotsLocked;

/**
 * One visual state per match, ordered by how much it needs staff:
 * disputed > pending report > playing > ready > scheduled > waiting for rivals > confirmed.
 */
export function matchState(match) {
  if (!match) return 'waiting';
  if (match.result_status === 'disputed') return 'disputed';
  if (match.result_status === 'pending') return 'reported';
  if (match.winner_id || match.result_status === 'confirmed') return 'confirmed';
  if (!isComplete(match)) return 'waiting';
  if (match.pick_ban_status === 'running') return 'veto';
  if (match.started || match.pick_ban_status === 'done') return 'playing';
  return 'ready';
}
export const needsAttention = match => ['disputed', 'reported'].includes(matchState(match));
export const isLive = match => ['veto', 'playing'].includes(matchState(match));

/** Valid final scores for a series, winner of side A first. BO3 → 2-0, 2-1, 1-2, 0-2. */
export function validScores(bestOf) {
  const wins = winsNeeded(bestOf);
  if (!Number.isInteger(wins) || wins < 1) return [];
  const forA = [], forB = [];
  for (let loser = 0; loser < wins; loser++) { forA.push([wins, loser]); forB.unshift([loser, wins]); }
  return [...forA, ...forB];
}
export const scoreValid = (bestOf, a, b) => validScores(bestOf).some(([x, y]) => x === a && y === b);

/**
 * Single-elimination rounds, earliest first, named from the final backwards so
 * byes or partial brackets keep correct names: final, semi, quarter, then
 * "round of N" (16, 32, 64, 128).
 */
export function playoffRounds(matches = []) {
  const main = matches.filter(match => !isGroupMatch(match) && !match.is_third_place);
  const maxRound = Math.max(0, ...main.map(match => match.round ?? 0));
  const rounds = [];
  for (const round of [...new Set(main.map(match => match.round))].sort((a, b) => a - b)) {
    const fromFinal = maxRound - round;
    const size = 2 ** (fromFinal + 1);
    rounds.push({ key: `r:${round}`, round, size, name: fromFinal === 0 ? 'final' : fromFinal === 1 ? 'semi' : fromFinal === 2 ? 'quarter' : 'ofN',
      matches: main.filter(match => match.round === round).sort(byPosition) });
  }
  const third = matches.find(match => !isGroupMatch(match) && match.is_third_place) || null;
  // Connectors only when every round is exactly half the previous one.
  const regular = rounds.every((round, index) => index === 0 || round.matches.length * 2 === rounds[index - 1].matches.length);
  return { rounds, third, regular, maxRound };
}

/** Groups with their matchdays and a simple won/lost table from firm results. */
export function groupStage(matches = [], standingsOrder = {}) {
  const groups = new Map();
  for (const match of matches.filter(isGroupMatch)) {
    const label = match.group_label || '—';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(match);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, items]) => {
    const rounds = [...new Set(items.map(match => match.round))].sort((a, b) => a - b)
      .map(round => ({ round, matches: items.filter(match => match.round === round).sort(byPosition) }));
    const table = new Map();
    const row = entrant => {
      const key = `${entrant.kind}:${entrant.id}`;
      if (!table.has(key)) table.set(key, { entrant, played: 0, wins: 0, losses: 0, mapsFor: 0, mapsAgainst: 0 });
      return table.get(key);
    };
    for (const match of items) {
      const a = match.entrant_a && row(match.entrant_a), b = match.entrant_b && row(match.entrant_b);
      if (!a || !b || !match.winner_id) continue;
      a.played++; b.played++;
      a.mapsFor += match.score_a ?? 0; a.mapsAgainst += match.score_b ?? 0;
      b.mapsFor += match.score_b ?? 0; b.mapsAgainst += match.score_a ?? 0;
      if (match.winner_id === match.entrant_a.id) { a.wins++; b.losses++; } else { b.wins++; a.losses++; }
    }
    const order = Array.isArray(standingsOrder?.[label]) ? standingsOrder[label] : [];
    const positions = new Map(order.map((id, index) => [id, index]));
    const standings = [...table.values()].sort((x, y) =>
      (positions.get(x.entrant.id) ?? Infinity) - (positions.get(y.entrant.id) ?? Infinity)
      || y.wins - x.wins || (y.mapsFor - y.mapsAgainst) - (x.mapsFor - x.mapsAgainst)
      || String(x.entrant.name).localeCompare(String(y.entrant.name)));
    return { label, rounds, standings, matches: items };
  });
}

/** Where the winner (and, from a semi-final, the loser) goes next. */
export function nextMatches(match, matches = []) {
  if (!match || isGroupMatch(match) || match.is_third_place) return { winner: null, loser: null };
  const position = Math.ceil((match.position ?? 1) / 2);
  const winner = matches.find(other => !isGroupMatch(other) && !other.is_third_place && other.round === match.round + 1 && other.position === position) || null;
  const { maxRound } = playoffRounds(matches);
  const loser = match.round === maxRound - 1 ? matches.find(other => other.is_third_place) || null : null;
  return { winner, loser, side: (match.position ?? 1) % 2 === 1 ? 'a' : 'b' };
}

export function resultChangeLock(match, matches, winner) {
  if (isGroupMatch(match)) return matches.some(other => !isGroupMatch(other) && slotsLocked(other)) ? 'playoffsStarted' : null;
  if (winner && winner.id === match.winner_id) return null;
  const { winner: next, loser } = nextMatches(match, matches);
  return [next, loser].some(slotsLocked) ? 'downstreamStarted' : null;
}

export function counts(matches = []) {
  return {
    total: matches.length,
    attention: matches.filter(needsAttention).length,
    live: matches.filter(isLive).length,
    confirmed: matches.filter(match => matchState(match) === 'confirmed').length,
  };
}

/**
 * Schedule rows: one per group matchday (all groups together) and one per
 * playoff round, plus the third-place match. Works for any bracket size.
 */
export function scheduleRows(matches = []) {
  const rows = [];
  const groups = matches.filter(isGroupMatch);
  for (const round of [...new Set(groups.map(match => match.round))].sort((a, b) => a - b)) {
    const items = groups.filter(match => match.round === round)
      .sort((a, b) => String(a.group_label).localeCompare(String(b.group_label)) || byPosition(a, b));
    rows.push({ key: `g:${round}`, stage: 'groups', name: 'matchday', round, matches: items });
  }
  const { rounds, third } = playoffRounds(matches);
  for (const round of rounds) rows.push({ key: round.key, stage: 'playoffs', name: round.name, size: round.size, round: round.round, matches: round.matches });
  if (third) rows.push({ key: 'third', stage: 'playoffs', name: 'third', matches: [third] });
  return rows;
}

/** `YYYY-MM-DDTHH:mm` in the browser's zone ↔ ISO instants. */
export function toLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function fromLocalInput(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export function addMinutes(localValue, minutes) {
  const date = new Date(localValue);
  if (!localValue || !Number.isFinite(date.getTime())) return '';
  return toLocalInput(new Date(date.getTime() + minutes * 60000).toISOString());
}

/**
 * Fill the pending rows from one start time with a fixed gap between rows.
 * Rows whose matches all have a firm result keep their time and take no slot.
 */
export function autoFill(rows, firstStart, gapMinutes) {
  const gap = Number(gapMinutes);
  if (!firstStart || !Number.isFinite(gap) || gap < 0) return {};
  const pending = rows.filter(row => row.matches.some(match => !scheduleLocked(match)));
  return Object.fromEntries(pending.map((row, index) => [row.key, { start: addMinutes(firstStart, index * gap) }]));
}

/**
 * Planned instant for each match: row start + index × stagger. Matches with a
 * firm result keep their time. Returns only matches whose time changes.
 */
export function scheduleChanges(rows, plan) {
  const changes = [];
  for (const row of rows) {
    const entry = plan[row.key];
    if (!entry?.start) continue;
    const stagger = Math.max(0, Number(entry.stagger) || 0);
    row.matches.filter(match => !scheduleLocked(match)).forEach((match, index) => {
      const scheduled_at = fromLocalInput(addMinutes(entry.start, index * stagger));
      if (!scheduled_at) return;
      const current = match.scheduled_at ? new Date(match.scheduled_at).getTime() : null;
      if (current !== new Date(scheduled_at).getTime()) changes.push({ match_id: match.id, scheduled_at, row: row.key });
    });
  }
  return changes;
}

/** Current times of a row: none, one shared time, or a first–last span. */
export function rowTimes(row) {
  const times = row.matches.map(match => match.scheduled_at).filter(Boolean).map(value => new Date(value).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
  if (!times.length) return { kind: 'none' };
  const missing = row.matches.length - times.length;
  if (times[0] === times.at(-1)) return { kind: 'single', first: new Date(times[0]).toISOString(), missing };
  return { kind: 'range', first: new Date(times[0]).toISOString(), last: new Date(times.at(-1)).toISOString(), missing };
}

export function reasonCheck(reason) {
  const length = String(reason ?? '').trim().length;
  return { length, ready: length >= REASON_MIN && length <= REASON_MAX, missing: Math.max(0, REASON_MIN - length), tooLong: length > REASON_MAX };
}

// ── Referee match page (CTP 370) ─────────────────────────────────────────────
export const CHAT_MAX = 1000;
export const VETO_SIDES = Object.freeze(['SAS', 'NKA']);

/** Veto sequence grouped by map slot: bans, the pick and the side choice of each map. */
export function vetoSlots(steps = []) {
  const slots = new Map();
  for (const step of [...steps].sort((a, b) => a.step_index - b.step_index)) {
    if (!slots.has(step.map_slot)) slots.set(step.map_slot, { slot: step.map_slot, mode: step.mode, steps: [] });
    slots.get(step.map_slot).steps.push(step);
  }
  return [...slots.values()].sort((a, b) => a.slot - b.slot).map(slot => {
    const pick = slot.steps.find(step => step.action === 'pick') || null;
    const side = slot.steps.find(step => step.action === 'side') || null;
    return { ...slot, map: pick?.map_name || null, side: side?.map_name || null, sideBy: side?.actor_side || null };
  });
}
/** The turn being played now: first step without a decision. */
export const currentStep = (steps = []) => [...steps].sort((a, b) => a.step_index - b.step_index).find(step => !step.map_name && !step.automatic_map) || null;

/**
 * Values staff may put in a decided step: SAS/NKA for a side choice; for a
 * ban or pick, pool maps of that mode not used by another ban/pick.
 */
export function stepChoices(step, steps = [], pool = []) {
  if (!step || step.automatic_map) return [];
  if (step.action === 'side') return VETO_SIDES.filter(value => value !== step.map_name);
  const used = new Set(steps.filter(other => other.id !== step.id && other.action !== 'side'
    && (!other.automatic_map || !step.map_name) && other.mode === step.mode && other.map_name).map(other => other.map_name));
  return pool.filter(map => map.mode === step.mode && map.name !== step.map_name && !used.has(map.name)).map(map => map.name);
}

export function stepSwapChoices(step, steps = [], pool = []) {
  if (!step?.map_name || step.automatic_map || step.action === 'side' || !pool.some(map => map.mode === step.mode && map.name === step.map_name)) return [];
  const available = new Set(pool.filter(map => map.mode === step.mode).map(map => map.name));
  return steps.filter(other => other.id !== step.id && other.mode === step.mode && !other.automatic_map && other.action !== 'side' && available.has(other.map_name));
}

/** Why staff cannot touch the pick & ban right now (a key under `page.veto.blocked`), or ''. */
export function vetoBlocked(match, tournamentStatus) {
  if (!match) return 'unavailable';
  if (['cancelado', 'finalizado'].includes(tournamentStatus)) return 'closed';
  if (match.winner_id || (match.result_status ?? 'none') !== 'none') return 'played';
  if (match.started) return 'started';
  if (!isComplete(match)) return 'incomplete';
  return '';
}
/** Veto actions offered for each status, most useful first. */
export function vetoActions(match) {
  const status = match?.pick_ban_status ?? 'none';
  if (status === 'none') return ['veto_prepare'];
  if (status === 'ready') return ['veto_start', 'startManual', 'veto_reset'];
  if (status === 'running') return [match.pick_ban_manual_referee ? 'resumeTeams' : 'takeControl', 'veto_reset'];
  return ['veto_reset'];
}

export function canEditVetoStep(step, current, status) {
  return !step.automatic_map && (Boolean(step.map_name) || (status === 'running' && current?.id === step.id));
}
/** Opening before the scheduled time is refused by CTP. */
export const vetoTooEarly = (match, now = Date.now()) => Boolean(match?.scheduled_at) && new Date(match.scheduled_at).getTime() > now;

/** CTP system notices are stored as `tournaments.staff.<name>` keys; anything else is shown as written. */
export function systemNotice(body) {
  const found = /^tournaments\.staff\.([A-Za-z]{1,40})$/.exec(String(body ?? ''));
  return found ? found[1] : null;
}
export function chatCheck(body) {
  const value = String(body ?? '').replace(/\r\n?/g, '\n').trim();
  return { value, ready: value.length > 0 && value.length <= CHAT_MAX, tooLong: value.length > CHAT_MAX, left: CHAT_MAX - value.length };
}
