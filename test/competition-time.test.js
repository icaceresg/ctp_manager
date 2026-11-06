import assert from 'node:assert/strict';
import test from 'node:test';
import { competitionDateInput, competitionDateToIso } from '../client/src/operations/competitionTime.js';

test('manual match dates round-trip in the tournament time zone across seasons', () => {
  for (const [wallTime, utc] of [
    ['2026-07-18T11:00', '2026-07-18T09:00:00.000Z'],
    ['2026-11-06T11:00', '2026-11-06T10:00:00.000Z'],
  ]) {
    assert.equal(competitionDateToIso(wallTime), utc);
    assert.equal(competitionDateInput(utc), wallTime);
  }
});

test('manual scheduling rejects missing times and preserves the original repeated hour', () => {
  assert.throws(() => competitionDateToIso('2026-03-29T02:30'));
  assert.throws(() => competitionDateToIso('2026-02-31T11:00'));
  assert.equal(competitionDateToIso('2026-10-25T02:30'), '2026-10-25T00:30:00.000Z');
  assert.equal(competitionDateToIso('2026-10-25T02:30', '2026-10-25T01:30:00.000Z'), '2026-10-25T01:30:00.000Z');
});
