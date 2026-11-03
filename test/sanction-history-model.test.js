import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSanctionHistory, createSanctionHistoryReader, historySubjectKey } from '../client/src/operations/sanctionHistoryModel.js';
import { sanctionHistoryFixture, HISTORY_NOW, HISTORY_PLAYER, HISTORY_OTHER_PLAYER } from './fixtures/sanction-history.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const context = { lobbyId: '20000000-0000-4000-8000-000000000001', slot: 1, username: 'Jugador sintético A' };
const contextual = (target = context, userId = HISTORY_PLAYER) => ({ ...sanctionHistoryFixture(userId),
  context: { lobby_id: target.lobbyId, slot: target.slot, username: target.username } });

test('personal counts distinguish revoked, lifted, warnings and scheduled records from club context', () => {
  const raw = sanctionHistoryFixture(), history = buildSanctionHistory(raw, HISTORY_PLAYER, HISTORY_NOW);
  assert.deepEqual(history.counts, { active: 1, previous: 1, warnings: 2, revoked: 1, scheduled: 1 });
  assert.equal(history.personal.length, 5); assert.equal(history.clubItems.length, 1);
  assert.equal(history.personal[3].period, 'lifted');
  assert.equal(history.personal[4].period, 'expired'); // Recompute the stale stored status.
  assert.equal(history.maybeIncomplete, false);
  assert.equal(raw.items[3].period, undefined); // Display calculation does not mutate the API DTO.
  const afterExpiry = buildSanctionHistory(raw, HISTORY_PLAYER, Date.parse('2026-11-06T12:00:00Z'));
  assert.equal(afterExpiry.counts.active, 0); assert.equal(afterExpiry.counts.previous, 2);
});

test('another account, duplicate evidence and unknown club membership fail rather than disappear', () => {
  const raw = sanctionHistoryFixture();
  const wrongPlayer = structuredClone(raw); wrongPlayer.items[0].subject_id = HISTORY_OTHER_PLAYER;
  const wrongClub = structuredClone(raw); wrongClub.clubs = [];
  const duplicate = structuredClone(raw); duplicate.items.push(duplicate.items[0]);
  for (const value of [wrongPlayer, wrongClub, duplicate, { ...raw, user: { ...raw.user, id: HISTORY_OTHER_PLAYER } },
    { ...raw, items: null }, { ...raw, items: [{ ...raw.items[0], status: 'unknown' }] }]) {
    assert.throws(() => buildSanctionHistory(value, HISTORY_PLAYER, HISTORY_NOW), /verificar/);
  }
});

test('a full page is explicitly partial and a verified empty response remains a successful read', () => {
  const raw = sanctionHistoryFixture();
  const items = Array.from({ length: 500 }, (_, i) => ({ ...raw.items[0],
    id: `22000000-0000-4000-8000-${String(i).padStart(12, '0')}` }));
  assert.equal(buildSanctionHistory({ ...raw, items }, HISTORY_PLAYER, HISTORY_NOW).maybeIncomplete, true);
  assert.throws(() => buildSanctionHistory({ ...raw, items: [...items, { ...items[0], id: HISTORY_OTHER_PLAYER }] }, HISTORY_PLAYER, HISTORY_NOW));
  const empty = buildSanctionHistory({ ...raw, clubs: [], items: [] }, HISTORY_PLAYER, HISTORY_NOW);
  assert.equal(empty.total, 0); assert.equal(empty.maybeIncomplete, false);
  assert.deepEqual(empty.counts, { active: 0, previous: 0, warnings: 0, revoked: 0, scheduled: 0 });
});

test('a later account selection aborts the earlier read and never publishes its late history', async () => {
  const reader = createSanctionHistoryReader(), first = deferred(), changes = [];
  let oldSignal;
  const a = reader.read({ userId: HISTORY_PLAYER, now: HISTORY_NOW, onChange: state => changes.push(state),
    fetchHistory: (_, { signal }) => { oldSignal = signal; return first.promise; } });
  const b = reader.read({ userId: HISTORY_OTHER_PLAYER, now: HISTORY_NOW, onChange: state => changes.push(state),
    fetchHistory: async target => sanctionHistoryFixture(target) });
  await b; first.resolve(sanctionHistoryFixture()); await a;
  assert.equal(oldSignal.aborted, true);
  assert.deepEqual(changes.map(state => [state.status, state.userId]), [
    ['loading', HISTORY_PLAYER], ['loading', HISTORY_OTHER_PLAYER], ['ready', HISTORY_OTHER_PLAYER],
  ]);
  assert.equal(changes.at(-1).history.user.id, HISTORY_OTHER_PLAYER);
});

test('a retry for the same player wins over both an older success and a late failure', async () => {
  for (const failOld of [false, true]) {
    const reader = createSanctionHistoryReader(), old = deferred(), changes = [];
    const a = reader.read({ userId: HISTORY_PLAYER, onChange: state => changes.push(state), fetchHistory: () => old.promise });
    await reader.read({ userId: HISTORY_PLAYER, now: HISTORY_NOW, onChange: state => changes.push(state),
      fetchHistory: async () => ({ ...sanctionHistoryFixture(), items: [] }) });
    if (failOld) old.reject(new Error('old transport failure')); else old.resolve(sanctionHistoryFixture());
    await a;
    assert.deepEqual(changes.map(state => state.status), ['loading', 'loading', 'ready']);
    assert.equal(changes.at(-1).history.total, 0);
  }
});

test('closing the form suppresses both pending success and errors', async () => {
  for (const fail of [false, true]) {
    const reader = createSanctionHistoryReader(), pending = deferred(), changes = [];
    const reading = reader.read({ userId: HISTORY_PLAYER, onChange: state => changes.push(state), fetchHistory: () => pending.promise });
    reader.cancel();
    if (fail) pending.reject(new Error('late')); else pending.resolve(sanctionHistoryFixture());
    await reading; assert.deepEqual(changes.map(state => state.status), ['loading']);
  }
});

test('transport, denied access and expired sessions produce an explicit error rather than an empty history', async () => {
  for (const [status, expected] of [[503, /Reintenta/], [403, /permiso/], [401, /sesión ha caducado/]]) {
    const reader = createSanctionHistoryReader(), changes = [];
    await reader.read({ userId: HISTORY_PLAYER, onChange: state => changes.push(state),
      fetchHistory: async () => { throw Object.assign(new Error('private upstream information'), { status }); } });
    assert.deepEqual(changes.map(state => state.status), ['loading', 'error']);
    assert.match(changes.at(-1).message, expected); assert.equal(changes.at(-1).history, undefined);
    assert.doesNotMatch(changes.at(-1).message, /private|sin historial/i);
  }
});

test('Ranked history accepts the account only after the exact lobby, slot and displayed name are verified', async () => {
  const reader = createSanctionHistoryReader(), changes = [];
  let requested;
  const history = await reader.read({ context, now: HISTORY_NOW, onChange: state => changes.push(state),
    fetchHistory: async (target, options) => { requested = target; assert.ok(options.signal instanceof AbortSignal); return contextual(); } });
  assert.deepEqual(requested, context); assert.equal(history.user.id, HISTORY_PLAYER);
  assert.equal(changes.at(-1).subjectKey, historySubjectKey({ context }));
  for (const mismatch of [null, { ...contextual().context, lobby_id: HISTORY_OTHER_PLAYER },
    { ...contextual().context, slot: 2 }, { ...contextual().context, username: 'Another displayed player' }]) {
    const states = [];
    await reader.read({ context, now: HISTORY_NOW, onChange: state => states.push(state),
      fetchHistory: async () => ({ ...contextual(), context: mismatch }) });
    assert.deepEqual(states.map(state => state.status), ['loading', 'error']);
  }
});

test('changing Ranked selection cannot attach an old response to the next slot', async () => {
  const reader = createSanctionHistoryReader(), old = deferred(), changes = [];
  const next = { ...context, slot: 2, username: 'Jugador sintético B' };
  const a = reader.read({ context, onChange: state => changes.push(state), fetchHistory: () => old.promise });
  await reader.read({ context: next, now: HISTORY_NOW, onChange: state => changes.push(state),
    fetchHistory: async () => contextual(next, HISTORY_OTHER_PLAYER) });
  old.resolve(contextual()); await a;
  assert.deepEqual(changes.map(state => state.status), ['loading', 'loading', 'ready']);
  assert.equal(changes.at(-1).history.user.id, HISTORY_OTHER_PLAYER);
  assert.equal(changes.at(-1).subjectKey, historySubjectKey({ context: next }));
});
