import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-pro-view-contract-'));
process.env.DATA_DIR = temporary;
process.env.DB_PATH = path.join(temporary, 'test.db');
const { proViewSettings, proViewState, validateProViewProposal } = await import('../server/pro-view-contract.js');
const { db } = await import('../server/db.js');
const matchId = randomUUID(), roomId = randomUUID();
const settings = { channel: 'playctp', delaySeconds: 30, productionDelaySeconds: 10, matchId, roomId, enabled: true, status: 'live' };
const state = { ...settings, revision: 3, matches: [{ id: matchId, title: 'North vs South', scheduledAt: '2026-10-19T16:00:00Z', status: 'pending' }], rooms: [{ id: roomId, matchId, label: 'Final', expiresAt: '2099-01-01T00:00:00Z', status: 'active' }], publicPreview: { revision: 2, sourceAt: '2026-10-19T15:00:00Z', visibleAt: '2026-10-19T15:00:30Z' }, lastErrorCode: null };

test.after(() => { db.close(); assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5 }); });
test('configuration accepts only bounded source settings, never URLs or scores', () => {
  assert.deepEqual(proViewSettings({ ...settings, channel: 'PlayCTP' }), settings);
  for (const changed of [
    { channel: 'https://twitch.tv/playctp' }, { channel: 'playctp?token=private' }, { delaySeconds: -1 }, { delaySeconds: 901 }, { delaySeconds: 10, productionDelaySeconds: 11 },
    { delaySeconds: 30.5 }, { productionDelaySeconds: '0' }, { matchId: 'not-uuid' }, { matchId: null }, { enabled: false }, { status: 'playing' },
    { scoreA: 7 }, { key: 'private-room-capability' }, { href: 'https://evil.invalid' },
  ]) assert.throws(() => proViewSettings({ ...settings, ...changed }), { status: 400 });
});
test('private editor response is a closed projection with no room keys or provider credentials', () => {
  const response = proViewState({ ...state, access_token: 'secret', snapshot: { email: 'private' }, matches: [{ ...state.matches[0], roster: [{ email: 'private' }] }], rooms: [{ ...state.rooms[0], key: 'secret', controllerKey: 'secret' }], publicPreview: { ...state.publicPreview, body: { private: 'secret' } } });
  assert.deepEqual(response, state);
  assert.equal(JSON.stringify(response).includes('secret'), false);
  for (const malformed of [{ revision: -1 }, { revision: 1.2 }, { matches: Array(101).fill(state.matches[0]) }, { rooms: [{ ...state.rooms[0], matchId: 'bad' }] }, { publicPreview: { ...state.publicPreview, visibleAt: 'bad' } }]) assert.throws(() => proViewState({ ...state, ...malformed }), { status: 502 });
});
test('proposals require current CAS revision and a returned match/room association', () => {
  assert.deepEqual(validateProViewProposal({ expected_version: 3, payload: settings }, state), settings);
  assert.throws(() => validateProViewProposal({ expected_version: 2, payload: settings }, state), { status: 409 });
  assert.throws(() => validateProViewProposal({ expected_version: 3, payload: settings, actor_id: 'forged' }, state), { status: 400 });
  assert.throws(() => validateProViewProposal({ expected_version: 3, payload: { ...settings, matchId: randomUUID(), roomId: null } }, state), { status: 400 });
  assert.throws(() => validateProViewProposal({ expected_version: 3, payload: { ...settings, roomId: randomUUID() } }, state), { status: 400 });
  assert.throws(() => validateProViewProposal({ expected_version: 3, payload: settings }, { ...state, rooms: [{ ...state.rooms[0], expiresAt: '2000-01-01T00:00:00Z' }] }), { status: 400 });
});
