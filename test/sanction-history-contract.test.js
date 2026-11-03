import test from 'node:test';
import assert from 'node:assert/strict';
import { disciplineHistoryQuery, disciplineHistoryResponse } from '../server/discipline-contract.js';
import { sanctionHistoryFixture, HISTORY_PLAYER, HISTORY_OTHER_PLAYER } from './fixtures/sanction-history.js';

test('a history read is bound to the requested account, never the last selected or named player', () => {
  assert.deepEqual(disciplineHistoryQuery(HISTORY_PLAYER), { action: 'history', user_id: HISTORY_PLAYER });
  const raw = sanctionHistoryFixture();
  assert.equal(disciplineHistoryResponse(raw, HISTORY_PLAYER).user.id, HISTORY_PLAYER);
  assert.throws(() => disciplineHistoryResponse(raw, HISTORY_OTHER_PLAYER), { status: 502 });
  assert.throws(() => disciplineHistoryQuery('Jugador sintético A'), { status: 400 });
  assert.throws(() => disciplineHistoryQuery('../another-account'), { status: 400 });
});

test('history preserves revoked, lifted and expired evidence together with separate club context', () => {
  const raw = sanctionHistoryFixture();
  const clean = disciplineHistoryResponse(raw, HISTORY_PLAYER);
  assert.equal(clean.items.length, 6);
  assert.deepEqual(clean.items.map(({ id, source, status, lifted, revoke_reason, subject_type, subject_id }) =>
    ({ id, source, status, lifted, revoke_reason, subject_type, subject_id })),
  raw.items.map(({ id, source, status, lifted, revoke_reason, subject_type, subject_id }) =>
    ({ id, source, status, lifted, revoke_reason, subject_type, subject_id })));
  assert.equal(clean.clubs[0].id, raw.clubs[0].id);
  assert.notEqual(clean.items, raw.items);
  assert.notEqual(clean.items[0].scopes, raw.items[0].scopes);
});

test('failed or malformed upstream history cannot become a clean empty disciplinary record', () => {
  const raw = sanctionHistoryFixture();
  for (const value of [null, {}, { ...raw, user: null }, { ...raw, items: null },
    { ...raw, clubs: null }, { ...raw, items: [{ ...raw.items[0], status: 'unknown' }] }]) {
    assert.throws(() => disciplineHistoryResponse(value, HISTORY_PLAYER), { status: 502 });
  }
  assert.deepEqual(disciplineHistoryResponse({ ...raw, items: [], clubs: [] }, HISTORY_PLAYER).items, []);
});

test('history exposes the display identity and reasons while stripping unrelated account and staff credentials', () => {
  const raw = sanctionHistoryFixture();
  Object.assign(raw.user, { email: 'sensitive@example.invalid', password_hash: 'private', access_token: 'private' });
  Object.assign(raw.items[0], { issued_by: HISTORY_OTHER_PLAYER, token: 'private' });
  Object.assign(raw.clubs[0], { secret: 'private' });
  const clean = disciplineHistoryResponse(raw, HISTORY_PLAYER);
  assert.equal(clean.items[0].reason, raw.items[0].reason);
  assert.equal(clean.items[0].issued_by_name, 'Staff sintético');
  assert.equal(JSON.stringify(clean).includes('private'), false);
  assert.equal(JSON.stringify(clean).includes('sensitive@example.invalid'), false);
});
