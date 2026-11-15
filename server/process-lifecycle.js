/** Service configuration only; requests cannot turn background jobs on/off. */
export function backgroundJobsEnabled(env = process.env) {
  const value = env.MANAGER_BACKGROUND_JOBS_ENABLED ?? 'true';
  if (!['true', 'false'].includes(value)) throw new Error('manager_background_jobs_configuration_invalid');
  return value === 'true';
}

export function startBackgroundJobs({ enabled, shadow, cleanupSessions, startOperations, startRuleta,
  interval = setInterval }) {
  if (!enabled || shadow) return [];
  const cleanup = interval(cleanupSessions, 60 * 60 * 1000); cleanup.unref?.();
  return [cleanup, startOperations(), startRuleta()].filter(Boolean);
}

/** Stop accepting HTTP work; let pending requests finish before bounded force-close. */
export function createHttpDrain(servers, { deadlineMs = 25_000, beforeClose = () => {}, afterClose = () => {} } = {}) {
  let flight;
  return () => {
    if (flight) return flight;
    flight = new Promise((resolve, reject) => {
      let finished = false, timeout;
      const finish = forced => {
        if (finished) return; finished = true; clearTimeout(timeout);
        try { afterClose(); resolve({ forced }); } catch (error) { reject(error); }
      };
      try { beforeClose(); } catch (error) { reject(error); return; }
      const active = servers.filter(server => server.listening);
      if (!active.length) { finish(false); return; }
      timeout = setTimeout(() => {
        for (const server of active) server.closeAllConnections();
        finish(true);
      }, deadlineMs);
      const closed = active.map(server => new Promise(done => {
        server.close(() => done());
        server.closeIdleConnections();
      }));
      void Promise.all(closed).then(() => finish(false));
    });
    return flight;
  };
}
