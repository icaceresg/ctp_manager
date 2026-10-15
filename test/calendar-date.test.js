import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-calendar-validation-'));
Object.assign(process.env, { DATA_DIR: temporary, DB_PATH: path.join(temporary, 'qa.sqlite'), CTP_AUTH_MODE: 'local' });
const { date } = await import('../server/validate.js');
const { db } = await import('../server/db.js');
after(() => {
  db.close();
  assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temporary).startsWith('ctp-calendar-validation-'));
  fs.rmSync(temporary, { recursive: true, force: true });
});

test('calendar date validation rejects normalization and uses Gregorian leap-year rules', () => {
  for (const value of ['2026-02-29', '2026-02-30', '2026-04-31', '1900-02-29', '2100-02-29', '2026-13-01', '2026-01-00', '2026-2-01', '2026-10-15T00:00:00Z', 'bad']) {
    assert.throws(() => date(value), error => error.status === 400, value);
  }
  for (const value of ['2024-02-29', '2000-02-29', '2026-02-28', '2026-03-29', '2026-10-25', '2026-12-31', '0099-01-01']) assert.equal(date(value), value);
  for (const value of [undefined, null, '']) assert.equal(date(value), null);
});

test('calendar validation is independent of the server timezone', () => {
  const original = process.env.TZ;
  try {
    for (const zone of ['UTC', 'Europe/Madrid', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      process.env.TZ = zone;
      assert.equal(date('2026-03-29'), '2026-03-29');
      assert.equal(date('2024-02-29'), '2024-02-29');
      assert.throws(() => date('2026-02-30'), error => error.status === 400);
    }
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});
