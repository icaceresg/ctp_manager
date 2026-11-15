import { createHash } from 'node:crypto';

const authority = Symbol('manager.read-authority');

/** Non-enumerable server-only scope. No credential or derived key crosses the API. */
export function bindReadAuthority(user, session, credentials = '') {
  if (!user) return user;
  const scope = createHash('sha256').update(JSON.stringify([session, credentials, user.id,
    user.ctp_user_id, user.ctp_role, user.ctp_staff_kind, user.is_admin, user.sections])).digest('hex');
  Object.defineProperty(user, authority, { value: scope, configurable: true });
  return user;
}

/** Shares concurrent reads only, after current auth/permission checks. No response TTL. */
export function createAuthorizedReads({ maximum = 256,
  conflict = () => Object.assign(new Error('manager.tournamentLive.error.conflict'), { status: 409 }) } = {}) {
  const flights = new Map();
  function run(user, tournamentId, resource, read) {
    const scope = user?.[authority];
    if (!scope) return Promise.resolve().then(read);
    const key = JSON.stringify([scope, tournamentId, resource]);
    if (flights.has(key)) return flights.get(key).promise;
    if (flights.size >= maximum) return Promise.resolve().then(read);
    const flight = { tournamentId, invalidated: false, promise: null };
    flight.promise = Promise.resolve().then(read).then(value => {
      if (flight.invalidated) throw conflict();
      return value;
    }).finally(() => { if (flights.get(key) === flight) flights.delete(key); });
    flights.set(key, flight);
    return flight.promise;
  }
  function invalidate(tournamentId) {
    for (const [key, flight] of flights) if (flight.tournamentId === tournamentId) {
      flight.invalidated = true; flights.delete(key);
    }
  }
  return { run, invalidate, size: () => flights.size };
}
