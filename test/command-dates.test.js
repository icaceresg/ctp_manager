import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-command-dates-'));
Object.assign(process.env, { DATA_DIR: temporary, DB_PATH: path.join(temporary, 'qa.sqlite'), CTP_AUTH_MODE: 'local' });
const { competitionPayload } = await import('../server/competition-contract.js');
const { rankedPayload } = await import('../server/ranked-contract.js');
const operations = await import('../server/operations.js');
const { db } = await import('../server/db.js');
const { describeUser } = await import('../server/auth.js');
const adminId = Number(db.prepare("INSERT INTO users(username,name,password_hash,is_admin,created_at) VALUES('date-admin','Date QA','unused',1,?)").run(Date.now()).lastInsertRowid);
const admin = describeUser(db.prepare('SELECT * FROM users WHERE id=?').get(adminId));
const reason = 'Horario revisado por el equipo de competición';
const invalid = ['2026-02-30T18:00:00Z', '2026-02-29T18:00:00Z', '2026-04-31T18:00:00+02:00', '1900-02-29T18:00:00Z', '2100-02-29T18:00:00Z', '2026-12-31T24:00:00Z'];

after(() => {
  db.close();
  assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temporary).startsWith('ctp-command-dates-'));
  fs.rmSync(temporary, { recursive: true, force: true });
});

test('tournament edits and rescheduling reject impossible dates instead of normalizing them', () => {
  for (const value of invalid) {
    assert.throws(() => competitionPayload('tournament.update', { start_at: value }), error => error.status === 400, value);
    assert.throws(() => competitionPayload('tournament.update', { registration_close_at: value }), error => error.status === 400, value);
    assert.throws(() => competitionPayload('tournament.schedule', { scheduled_at: value, reason }), error => error.status === 400, value);
  }
  assert.equal(competitionPayload('tournament.schedule', { scheduled_at: '2028-02-29T00:30:00+02:00', reason }).scheduled_at, '2028-02-28T22:30:00.000Z');
  assert.equal(competitionPayload('tournament.update', { start_at: '2000-02-29T18:00:00Z' }).start_at, '2000-02-29T18:00:00.000Z');
});

test('Ranked schedule and correction reject impossible dates for either season boundary', () => {
  for (const type of ['ranked.season.schedule', 'ranked.season.update']) {
    for (const value of invalid) {
      assert.throws(() => rankedPayload(type, { name: 'Season QA', starts_at: value, ends_at: '2101-01-01T00:00:00Z', reason }), error => error.status === 400, value);
      assert.throws(() => rankedPayload(type, { name: 'Season QA', starts_at: '1800-01-01T00:00:00Z', ends_at: value, reason }), error => error.status === 400, value);
    }
  }
  const payload = rankedPayload('ranked.season.schedule', { name: 'Season QA', starts_at: '2028-02-29T00:30:00+02:00', ends_at: '2028-03-30T00:30:00+02:00', reason });
  assert.equal(payload.starts_at, '2028-02-28T22:30:00.000Z');
});

test('invalid incoming match dates leave the last valid projection unchanged', () => {
  const original = { id: 'date-match', title: 'Horario original', scheduled_at: '2028-02-29T00:30:00+02:00' };
  operations.ingestSnapshot({ matches: [original] });
  const before = operations.matchDossier(admin, original.id).match;
  assert.equal(before.scheduled_at, '2028-02-28T22:30:00.000Z');
  for (const scheduled_at of invalid) {
    assert.throws(() => operations.ingestSnapshot({ matches: [{ ...original, title: 'No aplicar', scheduled_at }] }), error => error.status === 400, scheduled_at);
    assert.deepEqual(operations.matchDossier(admin, original.id).match, before);
  }
});
