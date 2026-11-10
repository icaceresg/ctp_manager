/** Per-view reads only. No response cache, credentials, commands or cross-actor sharing. */
export function createVisibleReadController({ read, onValue, onError, visible, blocked = () => false,
  retryMs, maxRetryMs = 60_000, clock = Date.now, makeController = () => new AbortController() }) {
  if (typeof read !== 'function' || typeof onValue !== 'function' || typeof onError !== 'function'
    || typeof visible !== 'function' || !Number.isFinite(retryMs) || retryMs < 1000
    || !Number.isFinite(maxRetryMs) || maxRetryMs < retryMs) throw new Error('invalid_read_controller');
  let disposed = false, epoch = 0, current = null, failures = 0, retryAfter = -Infinity;
  function cancel() { epoch++; current?.controller.abort(); }
  function run({ manual = false } = {}) {
    if (disposed || !visible() || blocked()) return Promise.resolve(false);
    if (current) {
      // A cancelled transport may take time to settle. Never overlap it on a
      // quick hide/show or write/refresh; only a fresh explicit read can follow.
      return current.epoch === epoch ? current.promise : current.promise.then(() => run({ manual }));
    }
    if (!manual && clock() < retryAfter) return Promise.resolve(false);
    const job = { epoch, controller: makeController(), promise: null };
    current = job;
    const usable = () => !disposed && job.epoch === epoch && !job.controller.signal.aborted && visible() && !blocked();
    job.promise = Promise.resolve().then(() => usable() ? read(job.controller.signal) : undefined).then(value => {
      if (!usable()) return false;
      failures = 0; retryAfter = -Infinity; onValue(value); return true;
    }).catch(error => {
      if (!usable() || error?.name === 'AbortError') return false;
      failures = Math.min(failures + 1, 7);
      retryAfter = clock() + Math.min(maxRetryMs, retryMs * 2 ** (failures - 1));
      onError(error); return false;
    }).finally(() => { if (current === job) current = null; });
    return job.promise;
  }
  return { run, cancel, dispose() { disposed = true; cancel(); },
    state: () => ({ inFlight: current !== null, failures, retryAfter }) };
}
