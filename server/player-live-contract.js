const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNEL = /^[a-z0-9_]{1,25}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export const PLAYER_LIVE_SECTIONS = Object.freeze(['clubes', 'arbitraje', 'operaciones', 'casters', 'realizacion']);
export const PLAYER_LIVE_REFRESH_MS = 60_000;
export const unavailablePlayerLive = () => ({ schema_version: 1, status: 'unavailable', checked_at: null, fresh_for_seconds: 90, streams: [] });

/** Public, consented feed only. Never forward provider identity or arbitrary URLs. */
export function playerLiveResponse(value, now = Date.now()) {
  const invalid = () => { throw new TypeError('invalid_player_live_directory'); };
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema_version !== 1
    || !['ready', 'unavailable'].includes(value.status) || !Number.isInteger(value.fresh_for_seconds)
    || value.fresh_for_seconds < 1 || value.fresh_for_seconds > 90 || !Array.isArray(value.streams) || value.streams.length > 100
    || !(value.checked_at === null || typeof value.checked_at === 'string' && value.checked_at.length <= 40 && ISO.test(value.checked_at) && Number.isFinite(Date.parse(value.checked_at)))
    || value.status === 'unavailable' && value.streams.length !== 0 || value.status === 'ready' && value.checked_at === null) return invalid();
  const ids = new Set(), channels = new Set();
  const streams = value.streams.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.user_id !== 'string' || !UUID.test(row.user_id)
      || typeof row.channel !== 'string' || !CHANNEL.test(row.channel) || ids.has(row.user_id.toLowerCase()) || channels.has(row.channel)) return invalid();
    ids.add(row.user_id.toLowerCase()); channels.add(row.channel);
    return { user_id: row.user_id.toLowerCase(), channel: row.channel };
  });
  const checked = Date.parse(value.checked_at);
  if (value.status !== 'ready' || !Number.isFinite(now) || now < checked - 10_000 || now >= checked + value.fresh_for_seconds * 1000) return unavailablePlayerLive();
  return { schema_version: 1, status: 'ready', checked_at: value.checked_at, fresh_for_seconds: value.fresh_for_seconds, streams };
}
