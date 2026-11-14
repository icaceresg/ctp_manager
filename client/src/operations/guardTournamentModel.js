export const GUARD_TOURNAMENT_POLL_MS = 10000;
export const GUARD_TOURNAMENT_DEADLINE_MS = 12000;
export const GUARD_TOURNAMENT_SIGNAL_MS = 15000;
const age = (value, now) => {
 const at = Date.parse(value ?? '');
 return Number.isFinite(at) && at <= now + 5000 ? Math.max(0, now - at) : Infinity;
};

/** A freshly received old response does not renew the player's heartbeat. */
export function guardTournamentView(state, receivedAt, now, failed = false) {
 const fresh = Boolean(state) && !failed && Number.isFinite(receivedAt) && receivedAt > 0
  && now >= receivedAt && now - receivedAt < GUARD_TOURNAMENT_SIGNAL_MS
  && age(state.observed_at, now) < GUARD_TOURNAMENT_SIGNAL_MS;
 const players = (state?.players ?? []).map(player => {
  const current = fresh && (player.state === 'console_verified' || age(player.last_seen_at, now) < GUARD_TOURNAMENT_SIGNAL_MS);
  const displayState = !fresh ? 'unknown' : player.state === 'ready' && !current ? 'signal_lost' : player.state;
  return { ...player, displayState, ready: current && ['ready', 'console_verified'].includes(player.state) };
 });
 const ready = players.filter(player => player.ready).length;
 return { fresh, players, ready, waiting: players.length - ready,
  canStart: fresh && state.enabled === true && state.ready === true && !state.started_at
   && players.length === 8 && ready === 8 && ['a', 'b'].every(side => players.filter(player => player.side === side).length === 4) };
}

export function guardTournamentError(error) {
 if (error?.code === 'guard_timeout') return 'timeout';
 if ([401, 403].includes(error?.status)) return 'forbidden';
 if (error?.status === 409) return 'changed';
 return 'unavailable';
}

export function guardTournamentReport(player, fresh, now) {
 const current=fresh&&player.monitoring_current===true&&age(player.last_seen_at,now)<GUARD_TOURNAMENT_SIGNAL_MS;
 const observation=current?player.observation:null,security=current?player.security_observation:null;
 const readable=value=>['available','partial'].includes(value);
 return {current,review:current?player.review_required:null,priorReview:!current&&player.review_required===true,
  processes:readable(observation?.process_inventory)?observation.process_count:null,processCoverage:observation?.process_inventory??'unknown',
  connections:readable(observation?.network_metadata)?observation.connection_count:null,networkCoverage:observation?.network_metadata??'unknown',
  files:readable(security?.process_file_identity)?security.files_checked:null,fileCoverage:security?.process_file_identity??'unknown',
  ruleMatches:observation?.rule_matches===null||observation?.rule_matches===undefined||security?.rule_matches===null||security?.rule_matches===undefined?null:observation.rule_matches+security.rule_matches,
  integrity:security?.release_integrity??'unknown'};
}

/** Read loop has no player fan-out, no history polling and no hidden requests.
 * read() must honor the signal; obsolete results are discarded even if it does not. */
export function createGuardTournamentReader({ read, publish, visible = () => !document.hidden,
 now = Date.now, schedule = setTimeout, cancel = clearTimeout, interval = GUARD_TOURNAMENT_POLL_MS,
 deadline = GUARD_TOURNAMENT_DEADLINE_MS }) {
 let disposed = false, timer = null, flight = null, serial = 0, lastStart = -Infinity, queuedForce = false;
 const later = delay => { cancel(timer); timer = null; if (!disposed && visible()) timer = schedule(() => load(), delay); };
 async function load(force = false) {
  if (disposed || !visible()) return;
  if (flight) { queuedForce ||= force; return flight.promise; }
  const remaining = interval - (now() - lastStart);
  if (!force && remaining > 0) { later(remaining); return; }
  cancel(timer); lastStart = now(); const token = ++serial, controller = new AbortController();
  let timedOut = false;
  const own = { token, controller, promise: null }; flight = own;
  const timeout = schedule(() => { timedOut = true; controller.abort(); }, deadline);
  publish({ loading: true });
  own.promise = (async () => {
   try {
    const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(Object.assign(Error('aborted'), { name: 'AbortError' })), { once: true }));
    const data = await Promise.race([read(controller.signal), aborted]);
    if (!disposed && token === serial && !controller.signal.aborted && visible()) publish({ data, error: null, loading: false, receivedAt: now(), now: now() });
   } catch (error) {
    if (!disposed && token === serial && (!controller.signal.aborted || timedOut) && visible()) publish({ error: timedOut ? { code: 'guard_timeout' } : error, loading: false, receivedAt: 0, now: now() });
   } finally {
    cancel(timeout);
    if (flight === own) flight = null;
    if (!disposed && token === serial && visible()) {
     publish({ loading: false });
     if (queuedForce) { queuedForce = false; void load(true); } else later(interval);
    }
   }
  })();
  return own.promise;
 }
 return {
  start() { later(0); },
  refresh(force = false) { return load(force); },
  visibilityChanged() {
   cancel(timer); serial++; flight?.controller.abort(); flight = null; queuedForce = false;
   publish({ loading: false, receivedAt: 0, now: now() });
   if (!disposed && visible()) void load();
  },
  stop() { disposed = true; serial++; cancel(timer); flight?.controller.abort(); flight = null; queuedForce = false; },
 };
}
