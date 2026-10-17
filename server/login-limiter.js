// Reserve before contacting CTP (or running scrypt), not after a failed await.
// The peer comes from the socket, never X-Forwarded-For. Behind the local proxy
// this is a shared budget, so it is deliberately larger than the account limit.
export class LoginLimitError extends Error {
  constructor(milliseconds) {
    const seconds = Math.max(1, Math.ceil(milliseconds / 1000));
    super(`Demasiados intentos. Espera ${seconds} s.`);
    this.retryAfterSeconds = seconds;
  }
}

export function createLoginLimiter({
  now = Date.now, windowMs = 60_000, failureWindowMs = 15 * 60_000,
  lockMs = 60_000, maxFailures = 5, peerAttempts = 120, totalAttempts = 240,
  maxConcurrent = 16, maxAccounts = 4096, maxPeers = 1024,
} = {}) {
  const accounts = new Map(), peers = new Map();
  let total = { count: 0, resetsAt: 0 }, concurrent = 0;
  function bucket(map, key, time, maximum) {
    let state = map.get(key);
    if (state && state.resetsAt > time) return state;
    if (!state && map.size >= maximum) {
      for (const [id, old] of map) if (old.resetsAt <= time) map.delete(id);
      if (map.size >= maximum) throw new LoginLimitError(windowMs);
    }
    state = { count: 0, resetsAt: time + windowMs };
    map.set(key, state);
    return state;
  }
  return {
    begin(account, peer = 'direct') {
      const time = now();
      const client = bucket(peers, peer, time, maxPeers);
      if (total.resetsAt <= time) total = { count: 0, resetsAt: time + windowMs };
      // Count rejected bursts too; changing account names cannot reset a budget.
      if (client.count >= peerAttempts || total.count >= totalAttempts) {
        throw new LoginLimitError(Math.max(client.count >= peerAttempts ? client.resetsAt - time : 0,
          total.count >= totalAttempts ? total.resetsAt - time : 0));
      }
      client.count++; total.count++;
      let state = accounts.get(account);
      if (state?.lockedUntil > time) throw new LoginLimitError(state.lockedUntil - time);
      if (state?.inFlight || concurrent >= maxConcurrent) throw new LoginLimitError(1000);
      if (!state) {
        if (accounts.size >= maxAccounts) {
          for (const [key, old] of accounts) if (!old.inFlight && old.lockedUntil <= time && old.lastFailureAt + failureWindowMs <= time) accounts.delete(key);
          // Fail closed instead of evicting a locked account and resetting it.
          if (accounts.size >= maxAccounts) throw new LoginLimitError(windowMs);
        }
        state = { failures: 0, lastFailureAt: 0, lockedUntil: 0, inFlight: false };
        accounts.set(account, state);
      }
      if (state.lastFailureAt + failureWindowMs <= time) state.failures = 0;
      state.inFlight = true; concurrent++;
      let finished = false;
      return {
        finish({ success = false, credentialFailure = false } = {}) {
          if (finished) return;
          finished = true; state.inFlight = false; concurrent--;
          if (success) accounts.delete(account);
          else if (credentialFailure) {
            state.lastFailureAt = now();
            if (++state.failures >= maxFailures) {
              state.failures = 0; state.lockedUntil = state.lastFailureAt + lockMs;
            }
          } else if (!state.failures && !state.lockedUntil) accounts.delete(account);
        },
      };
    },
  };
}
