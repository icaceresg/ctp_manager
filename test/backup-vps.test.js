import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { snapshotDatabase, fileReceipt, BACKUP_PATHS } from '../scripts/backup-vps.mjs';

test('online backup includes committed WAL rows while the source remains open and writable', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ctp-manager-backup-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('ctp-manager-backup-test-'));
    await fs.rm(temporary, { recursive: true, force: true });
  });
  const source = path.join(temporary, 'source.db');
  const destination = path.join(temporary, 'backup.db');
  const writer = new DatabaseSync(source);
  try {
    writer.exec('PRAGMA journal_mode=WAL; CREATE TABLE records(id INTEGER PRIMARY KEY, value TEXT);');
    writer.prepare('INSERT INTO records(value) VALUES(?)').run('committed in the WAL');
    assert.ok((await fs.stat(source + '-wal')).size > 0);
    await snapshotDatabase(source, destination);
    writer.prepare('INSERT INTO records(value) VALUES(?)').run('source still writable');
    const copy = new DatabaseSync(destination, { readOnly: true });
    try {
      assert.equal(copy.prepare('SELECT count(*) AS n FROM records').get().n, 1);
      assert.equal(copy.prepare('SELECT value FROM records').get().value, 'committed in the WAL');
      assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.equal(copy.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
      assert.equal(writer.prepare('SELECT count(*) AS n FROM records').get().n, 2);
    } finally { copy.close(); }
    const receipt = await fileReceipt(destination, 'myredesmanager.db');
    assert.match(receipt.sha256, /^[a-f0-9]{64}$/);
    assert.ok(receipt.bytes > 0);
    assert.deepEqual(Object.keys(receipt).sort(), ['bytes', 'path', 'sha256']);
    if (process.platform !== 'win32') assert.equal((await fs.stat(destination)).mode & 0o777, 0o600);
  } finally { writer.close(); }
});

test('backup destinations cannot overwrite an existing file', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ctp-manager-backup-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('ctp-manager-backup-test-'));
    await fs.rm(temporary, { recursive: true, force: true });
  });
  const source = path.join(temporary, 'source.db'), destination = path.join(temporary, 'existing');
  const database = new DatabaseSync(source); database.exec('CREATE TABLE records(id);'); database.close();
  await fs.writeFile(destination, 'preserve');
  await assert.rejects(snapshotDatabase(source, destination), /backup_destination_exists/);
  assert.equal(await fs.readFile(destination, 'utf8'), 'preserve');
});

test('scheduled backup locations are fixed to Manager PRE and include private configuration', () => {
  assert.equal(BACKUP_PATHS.database, '/var/lib/ctp-manager-pre/myredesmanager.db');
  assert.equal(BACKUP_PATHS.directory, '/opt/ctp/backups/manager-pre');
  assert.equal(BACKUP_PATHS.environment, '/etc/ctp-manager/pre.env');
  assert.equal(BACKUP_PATHS.current, '/srv/ctp-manager/pre/current');
});
