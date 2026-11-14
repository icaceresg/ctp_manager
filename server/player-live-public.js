import { playerLiveResponse } from './player-live-contract.js';

const ORIGINS = new Set(['https://pre.playctp.com', 'https://playctp.com']);
const MAX_BYTES = 128 * 1024;

/** The existing public CTP feed needs only its public anon key, never a staff/user credential. */
export function createPublicPlayerLiveRequest({ config, fetchImpl = fetch, now = Date.now, timeoutMs = 8000 }) {
  const mode = config?.mode, origin = config?.origin, anon = config?.anon;
  const configured = mode === 'ctp' && ORIGINS.has(origin) && typeof anon === 'string' && anon.length <= 8192
    && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(anon)
    && Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 8000;
  return async function requestPublicPlayerLive() {
    const fail = () => new Error('player_live_unavailable');
    let claims;
    try { claims = JSON.parse(Buffer.from(anon.split('.')[1], 'base64url')); } catch { /* fail closed below */ }
    if (!configured || claims?.role !== 'anon' || !Number.isFinite(claims.exp) || claims.exp * 1000 <= now()) throw fail();
    const controller = new AbortController();
    let reader = null, timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); void reader?.cancel().catch(() => {}); reject(fail()); }, timeoutMs);
    });
    const work = async () => {
      const url = origin + '/functions/v1/ranked-live';
      const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: controller.signal,
        credentials: 'omit', cache: 'no-store', headers: { apikey: anon, Authorization: `Bearer ${anon}` } });
      if (!response.ok || response.redirected || response.url && response.url !== url
        || !/^application\/json\b/i.test(response.headers.get('Content-Type') || '')) {
        void response.body?.cancel().catch(() => {}); throw fail();
      }
      const declared = response.headers.get('Content-Length');
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) {
        void response.body?.cancel().catch(() => {}); throw fail();
      }
      reader = response.body?.getReader();
      if (!reader) throw fail();
      const chunks = []; let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES || chunks.length >= 512) { await reader.cancel().catch(() => {}); throw fail(); }
        chunks.push(value);
      }
      try {
        const bytes = Buffer.concat(chunks, size);
        return playerLiveResponse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), now());
      } catch { throw fail(); }
    };
    try { return await Promise.race([work(), deadline]); }
    catch { throw fail(); }
    finally { clearTimeout(timer); controller.abort(); void reader?.cancel().catch(() => {}); }
  };
}
