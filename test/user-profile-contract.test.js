import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { userProfilePayload, userProfileResponse, USER_PROFILE_ERRORS } from '../server/user-profile-contract.js';

const id = randomUUID();

test('profile edits send only known, changed fields with the read version', () => {
  assert.deepEqual(userProfilePayload(id, { expected_version: 4, changes: { email: ' nuevo@playctp.com ', activision_id: '', twitter: 'ctp' } }),
    { action: 'update', user_id: id, expected_version: 4, changes: { email: 'nuevo@playctp.com', activision_id: null, twitter: 'ctp' } });
  for (const body of [
    { expected_version: 4, changes: {} }, { changes: { gamertag: 'x' } }, { expected_version: 0, changes: { gamertag: 'x' } },
    { expected_version: 4, changes: { role: 'admin' } }, { expected_version: 4, changes: { points: 1 } }, { expected_version: 4, changes: { username: '' } },
    { expected_version: 4, changes: { username: 'a' } }, { expected_version: 4, changes: { email: 'no-es-correo' } }, { expected_version: 4, changes: { activision_id: 'sinalmohadilla' } },
    { expected_version: 4, changes: { platform: 'Atari' } }, { expected_version: 4, changes: { gamertag: 'x' }, password: 'secret' },
  ]) assert.throws(() => userProfilePayload(id, body), error => error.status === 400);
  assert.throws(() => userProfilePayload('nope', { expected_version: 1, changes: { gamertag: 'x' } }), error => error.status === 400);
});

test('profile responses are bounded and every SQL code has Spanish copy', () => {
  const row = { id, username: 'Mau', email: 'mau@playctp.com', email_confirmed: true, gamertag: 'Mau', activision_id: null, platform: 'PC', discord: null, twitter: null, bio: null, birthdate: '2000-01-01', role: 'player', avatar: '🎮', created_at: '2026-10-01T00:00:00Z', manager_version: 3, changed: ['email'] };
  assert.equal(userProfileResponse(row, id).email, 'mau@playctp.com');
  for (const bad of [{ ...row, id: randomUUID() }, { ...row, platform: 'Atari' }, { ...row, manager_version: '3' }, { ...row, changed: ['role'] }]) assert.throws(() => userProfileResponse(bad, id), error => error.status === 502);
  assert.equal(userProfileResponse({ ...row, encrypted_password: 'x' }, id).encrypted_password, undefined);
  for (const message of Object.values(USER_PROFILE_ERRORS)) assert.ok(message.length > 10);
});
