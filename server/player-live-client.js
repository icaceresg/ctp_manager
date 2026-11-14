import { HttpError } from './auth.js';
import { canAccess } from '../shared/access.js';
import { PLAYER_LIVE_SECTIONS, PLAYER_LIVE_REFRESH_MS, playerLiveResponse, unavailablePlayerLive } from './player-live-contract.js';

/** One bounded public-feed cache; each staff actor retains a separate permission boundary. */
export function createPlayerLiveReader({ request, actorFor, configured = () => true, now = Date.now, maxEntries = 64 }) {
  if (typeof request !== 'function' || typeof actorFor !== 'function' || typeof configured !== 'function' || typeof now !== 'function'
    || !Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 256) throw new TypeError('invalid_player_live_reader');
  const cache = new Map();
  return async function readPlayerLive(user) {
    if (!user?.id) throw new HttpError(401, 'Necesitas iniciar sesión.');
    if (!PLAYER_LIVE_SECTIONS.some(section => canAccess(user, section))) throw new HttpError(403, 'No tienes acceso a esta sección. Pídeselo a un administrador.');
    if (!configured()) return unavailablePlayerLive();
    let actor;
    try { actor = await actorFor(user); } catch { return unavailablePlayerLive(); }
    if (typeof actor !== 'string' || !/^[A-Za-z0-9._:@-]{1,100}$/.test(actor)) return unavailablePlayerLive();
    const stamp = now();
    // Remove expired settled entries, never evict an in-flight request and start it twice.
    for (const [key, entry] of cache) if (!entry.flight && stamp >= entry.nextAt) cache.delete(key);
    let entry = cache.get(actor);
    if (!entry) {
      if (cache.size >= maxEntries) return unavailablePlayerLive();
      entry = { value: unavailablePlayerLive(), nextAt: stamp + PLAYER_LIVE_REFRESH_MS, flight: null };
      cache.set(actor, entry);
      entry.flight = Promise.resolve().then(async () => {
        try {
          entry.value = playerLiveResponse(await request(), now());
        } catch { entry.value = unavailablePlayerLive(); }
        finally { entry.flight = null; }
      });
    }
    if (entry.flight) await entry.flight;
    return playerLiveResponse(entry.value, now());
  };
}
