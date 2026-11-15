import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('runtime uses bounded SQLite lock waits and WAL-backed sessions visible to a second connection', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-wal-runtime-'));
  Object.assign(process.env, { DATA_DIR: temporary, DB_PATH: '', PUBLIC_ORIGIN: '', CTP_AUTH_MODE: 'local' });
  const { db } = await import('../server/db.js');
  const auth = await import('../server/auth.js');
  const other = new DatabaseSync(path.join(temporary, 'myredesmanager.db'));
  t.after(() => {
    other.close(); db.close();
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('manager-wal-runtime-'));
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 5000);
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  const id = auth.setupAdmin({ username: 'qa-wal-admin', password: 'qa-wal-password' });
  let token;
  auth.createSession({ cookie(name, value) { assert.equal(name, 'mrm_session'); token = value; } }, id);
  assert.equal(other.prepare('SELECT user_id FROM sessions WHERE token=?').get(token).user_id, id);
  const request = () => ({ headers: { cookie: `mrm_session=${token}` } });
  assert.equal((await auth.currentUser(request())).id, id);
  other.prepare('DELETE FROM sessions WHERE token=?').run(token);
  assert.equal(await auth.currentUser(request()), null);
});
