export const PLAYER_LIVE_POLL_MS = 60_000;
const MAX_FRESH_MS = 90_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const channelPattern = /^[a-z0-9_]{1,25}$/;
const timestamp = value => typeof value === 'string' && value.length <= 40
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

/** Only a validated Twitch login can become a destination; never accept a URL. */
export function playerLiveUrl(channel) {
  return typeof channel === 'string' && channelPattern.test(channel) ? `https://www.twitch.tv/${channel}` : null;
}

/** The public, consented feed carries neither OAuth identity data nor provider tokens. */
export function parsePlayerLive(value) {
  const invalid = () => { throw new Error('invalid_player_live'); };
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema_version !== 1
    || !['ready', 'unavailable'].includes(value.status) || !(value.checked_at === null || timestamp(value.checked_at))
    || !Number.isInteger(value.fresh_for_seconds) || value.fresh_for_seconds < 1 || value.fresh_for_seconds > 90
    || !Array.isArray(value.streams) || value.streams.length > 100
    || value.status === 'unavailable' && value.streams.length || value.status === 'ready' && value.checked_at === null) return invalid();
  const ids = new Set(), channels = new Set();
  const streams = value.streams.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.user_id !== 'string' || !uuid.test(row.user_id)
      || !playerLiveUrl(row.channel) || ids.has(row.user_id.toLowerCase()) || channels.has(row.channel)) return invalid();
    ids.add(row.user_id.toLowerCase()); channels.add(row.channel);
    return { user_id: row.user_id.toLowerCase(), channel: row.channel };
  });
  return { schema_version: 1, status: value.status, checked_at: value.checked_at, fresh_for_seconds: value.fresh_for_seconds, streams };
}

/** A failed or old observation is unknown, never evidence of an active stream. */
export function freshPlayerLive(value, now = Date.now()) {
  if (!value || value.status !== 'ready' || !Number.isFinite(now)) return null;
  const checked = Date.parse(value.checked_at), until = checked + Math.min(MAX_FRESH_MS, value.fresh_for_seconds * 1000);
  return !Number.isFinite(checked) || now < checked - 10_000 || now >= until ? null : value;
}

/** One observer per staff session, shared by every mounted roster badge. */
export function createPlayerLiveStore({ request, isVisible, observeVisibility, now = Date.now,
  setTimer = (task, delay) => setTimeout(task, delay), clearTimer = timer => clearTimeout(timer) }) {
  let snapshot = null, timer = null, expiry = null, visible = false, removeVisibility = null;
  let pending = null, epoch = 0, failures = 0, nextAt = 0;
  const listeners = new Set();
  const clear = value => { if (value !== null) clearTimer(value); };
  const notify = () => { for (const listener of listeners) listener(); };
  const publish = value => {
    clear(expiry); expiry = null; snapshot = freshPlayerLive(value, now()); notify();
    if (snapshot && visible) expiry = setTimer(() => { expiry = null; snapshot = null; notify(); },
      Math.max(0, Date.parse(snapshot.checked_at) + snapshot.fresh_for_seconds * 1000 - now()));
  };
  function schedule() {
    if (!visible || pending || timer !== null) return;
    timer = setTimer(() => { timer = null; void run(); }, Math.max(0, nextAt - now()));
  }
  async function run() {
    if (!visible || pending) return;
    const job = { epoch, controller: new AbortController() }; pending = job;
    nextAt = now() + PLAYER_LIVE_POLL_MS;
    const timeout = setTimer(() => job.controller.abort(), 8000);
    const current = () => visible && job.epoch === epoch && !job.controller.signal.aborted;
    try {
      const value = parsePlayerLive(await request(job.controller.signal));
      if (!current()) return;
      failures = 0; nextAt = now() + PLAYER_LIVE_POLL_MS; publish(value);
    } catch {
      if (job.epoch !== epoch || !visible) return;
      failures = Math.min(3, failures + 1);
      nextAt = now() + Math.min(300_000, PLAYER_LIVE_POLL_MS * 2 ** failures); publish(null);
    } finally {
      clear(timeout); if (pending === job) pending = null; schedule();
    }
  }
  function visibilityChanged() {
    const next = listeners.size > 0 && isVisible();
    if (visible === next) return;
    visible = next; epoch++;
    if (!visible) { clear(timer); timer = null; clear(expiry); expiry = null; pending?.controller.abort(); }
    else { publish(snapshot); schedule(); }
  }
  return {
    getSnapshot: () => freshPlayerLive(snapshot, now()),
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) { removeVisibility = observeVisibility(visibilityChanged); visibilityChanged(); }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) { removeVisibility?.(); removeVisibility = null; visibilityChanged(); }
      };
    },
  };
}
