import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-owner-state-'));
Object.assign(process.env, { DATA_DIR: directory, DB_PATH: path.join(directory, 'manager.sqlite'), CTP_OPERATIONS_URL: '', CTP_OPERATIONS_TOKEN: '' });
const { createOwnerStateStore, safeOwnerUrl } = await import('../server/administration-services.js');
const { db } = await import('../server/db.js');
const database = new DatabaseSync(':memory:');
let now = 1_000;
const states = createOwnerStateStore(database, () => now);
const state = 'a'.repeat(64);

after(() => {
  database.close(); db.close();
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  fs.rmSync(directory, { recursive: true, force: true });
});

test('Twitch owner state belongs to one user and session, expires and cannot be replayed', () => {
  states.begin(state, 12, 'original-session');
  const row = database.prepare('SELECT * FROM administration_oauth_states').get();
  assert.notEqual(row.state_hash, state);
  assert.notEqual(row.session_hash, 'original-session');
  for (const [user, session] of [[13, 'original-session'], [12, 'other-session']]) {
    assert.throws(() => states.consume(state, user, session), { status: 400 });
  }
  states.consume(state, 12, 'original-session');
  assert.throws(() => states.consume(state, 12, 'original-session'), { status: 400 });
  states.begin(state, 12, 'original-session');
  now += 600_000;
  assert.throws(() => states.consume(state, 12, 'original-session'), { status: 400 });
});

test('starting again invalidates the previous state in the same session only', () => {
  const other = 'b'.repeat(64), anotherSession = 'c'.repeat(64);
  states.begin(state, 12, 'session-one');
  states.begin(anotherSession, 12, 'session-two');
  states.begin(other, 12, 'session-one');
  assert.throws(() => states.consume(state, 12, 'session-one'), { status: 400 });
  states.consume(other, 12, 'session-one');
  states.consume(anotherSession, 12, 'session-two');
});

test('owner authorization cannot redirect to an arbitrary site or request unrelated permissions', () => {
  const address = new URL('https://id.twitch.tv/oauth2/authorize');
  address.search = new URLSearchParams({ client_id: 'ctp-public-client', response_type: 'code', redirect_uri: 'https://manager.playctp.com/administracion/integraciones?twitch_admin=1', scope: 'channel:read:subscriptions', state });
  assert.ok(safeOwnerUrl(address.href));
  for (const [key, value] of [['redirect_uri', 'https://attacker.test'], ['scope', 'chat:edit'], ['state', 'short'], ['response_type', 'token']]) {
    const invalid = new URL(address); invalid.searchParams.set(key, value);
    assert.equal(safeOwnerUrl(invalid.href), null);
  }
  for (const value of [address.href.replace('id.twitch.tv', 'attacker.test'), address.href.replace('https:', 'http:'), address.href + '&state=' + state, address.href + '#fragment', address.href.replace('id.twitch.tv', 'user:pass@id.twitch.tv')]) {
    assert.equal(safeOwnerUrl(value), null);
  }
});
