/** A single ordered writer. Failed fields remain pending until a later save. */
export function createAutosaveQueue({ save, onStatus, delay = 600, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let pending = null;
  let timer = null;
  let running = null;
  let active = null;
  let error = null;

  const clearDelay = () => { if (timer !== null) clearTimer(timer); timer = null; };
  function flush() {
    clearDelay();
    if (running) return running;
    if (!pending) return Promise.resolve(true);
    // Start on the next microtask so even a synchronous save() exception cannot
    // finish before `running` has been assigned and strand subsequent retries.
    running = Promise.resolve().then(async () => {
      try {
        while (pending) {
          clearDelay();
          active = pending;
          pending = null;
          error = null;
          onStatus?.('saving');
          try {
            await save(active);
          } catch (cause) {
            // Edits entered during the failed request take precedence, while
            // untouched failed fields are retained for retry.
            pending = { ...active, ...pending };
            error = cause;
            onStatus?.('error', cause);
            return false;
          } finally { active = null; }
        }
        onStatus?.('saved');
        return true;
      } finally { running = null; }
    });
    return running;
  }

  return {
    schedule(patch) {
      pending = { ...pending, ...patch };
      clearDelay();
      timer = setTimer(() => { timer = null; void flush(); }, delay);
    },
    flush,
    retry: flush,
    getState: () => ({ pending: Boolean(pending || active), saving: Boolean(active), error }),
  };
}
