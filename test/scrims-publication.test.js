import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWebPublicationClient, webPublicationPayload, webPublicationResponse } from '../server/web-publication-client.js';
import { EMPTY_DRAFT, draftChanges, effective, pendingCount, sectionSupported, setSection } from '../client/src/pages/webPublicationModel.js';
import { managerNavigation, navigationSearch } from '../client/src/navigation.js';

const REQUEST_ID = '40900000-0000-4000-8000-000000000001';
const admin = { id: 'qa-admin', is_admin: true, auth_mode: 'ctp', ctp_role: 'admin' };
const snapshot = {
  schema_version: 1, revision: 3, sections: { calendar: true, market: false, scrims: false },
  tournaments: [], clubs: [], tax: { spain_rate_bps: 2100, oss_active: false, eu_rates: [] },
};
const request = () => ({ action: 'configure', expected_version: 3, request_id: REQUEST_ID,
  reason: 'Abrir la agenda de entrenamientos', changes: { sections: { scrims: true } } });

test('Scrims publication changes only its independent section and can be reverted before saving', () => {
  assert.equal(sectionSupported(snapshot, 'scrims'), true);
  let draft = setSection(EMPTY_DRAFT, snapshot, 'scrims', true);
  assert.equal(effective.section(draft, snapshot, 'scrims'), true);
  assert.equal(effective.section(draft, snapshot, 'calendar'), true);
  assert.equal(effective.section(draft, snapshot, 'market'), false);
  assert.equal(pendingCount(draft), 1);
  assert.deepEqual(draftChanges(draft), { sections: { scrims: true } });
  assert.deepEqual(snapshot.sections, { calendar: true, market: false, scrims: false });
  draft = setSection(draft, snapshot, 'scrims', false);
  assert.equal(pendingCount(draft), 0);
  assert.equal(draftChanges(draft), null);
  for (const key of ['challenges', 'retos', 'ranked']) assert.throws(() => setSection(EMPTY_DRAFT, snapshot, key, true), TypeError);
  assert.throws(() => setSection(EMPTY_DRAFT, snapshot, 'scrims', 'true'), TypeError);
});

test('an older CTP backend leaves Scrims unavailable while preserving its existing section controls', () => {
  const legacy = webPublicationResponse({ ...snapshot, sections: { calendar: true, market: false } });
  assert.equal(Object.hasOwn(legacy.sections, 'scrims'), false);
  assert.equal(sectionSupported(legacy, 'scrims'), false);
  assert.equal(effective.section(EMPTY_DRAFT, legacy, 'scrims'), false);
  assert.throws(() => setSection(EMPTY_DRAFT, legacy, 'scrims', true), TypeError);
  const draft = setSection(EMPTY_DRAFT, legacy, 'calendar', false);
  assert.deepEqual(draftChanges(draft), { sections: { calendar: false } });
});

test('Scrims is a finite boolean publication field, never a shortcut to Challenges or other changes', () => {
  assert.deepEqual(webPublicationPayload(request()), request());
  for (const sections of [{ scrims: 'true' }, { scrims: 1 }, { scrims: null }, { scrims: true, challenges: true }, { retos: true }]) {
    assert.throws(() => webPublicationPayload({ ...request(), changes: { sections } }), { status: 400 });
  }
  const parsed = webPublicationResponse(snapshot);
  assert.deepEqual(parsed.sections, snapshot.sections);
  for (const sections of [{ ...snapshot.sections, scrims: 'true' }, { ...snapshot.sections, challenges: false }]) {
    assert.throws(() => webPublicationResponse({ ...snapshot, sections }), { status: 502 });
  }
});

test('Scrims activation retains the existing admin and global-write gates before reaching CTP', async () => {
  const calls = [], actors = [];
  const client = createWebPublicationClient({ request: async body => { calls.push(body); return snapshot; },
    actorFor: async user => { actors.push(user.id); return 'ctp:qa-admin'; }, writesEnabled: () => true });
  await assert.rejects(client(null, request()), { status: 401 });
  await assert.rejects(client({ id: 'qa-staff', is_admin: false }, request()), { status: 403 });
  await assert.rejects(client({ ...admin, ctp_role: 'referee' }, request()), { status: 403 });
  const closed = createWebPublicationClient({ request: async body => { calls.push(body); return snapshot; },
    actorFor: async () => { actors.push('blocked'); return 'ctp:qa-admin'; }, writesEnabled: () => false });
  await assert.rejects(closed(admin, request()), { status: 403 });
  assert.deepEqual(calls, []);
  assert.deepEqual(actors, []);
});

test('a lost Scrims response can be retried with the identical revision and request id', async () => {
  const calls = [];
  const client = createWebPublicationClient({ request: async body => {
    calls.push(body);
    if (calls.length === 1) throw Object.assign(new Error('Synthetic lost response'), { status: 503 });
    return { ...snapshot, revision: 4, request_id: REQUEST_ID, sections: { ...snapshot.sections, scrims: true } };
  }, actorFor: async () => 'ctp:qa-admin', writesEnabled: () => true });
  const input = request();
  await assert.rejects(client(admin, input), { status: 502 });
  assert.equal(calls.length, 1, 'the Manager does not automatically repeat an uncertain write');
  const result = await client(admin, input);
  assert.equal(result.revision, 4);
  assert.equal(result.sections.scrims, true);
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(calls[1], { action: 'admin_service', actor_id: 'ctp:qa-admin', service: 'web_publication', payload: input });
  assert.deepEqual(input.changes, { sections: { scrims: true } });
});

test('concurrent Scrims publication still reports a revision conflict without a retry', async () => {
  const calls = [];
  const client = createWebPublicationClient({ request: async body => {
    calls.push(body); throw Object.assign(new Error('Synthetic revision conflict'), { status: 409 });
  }, actorFor: async () => 'ctp:qa-admin', writesEnabled: () => true });
  await assert.rejects(client(admin, request()), { status: 409 });
  assert.equal(calls.length, 1);
});

test('administrators can find the Scrims publication control and its copy exists in all six languages', () => {
  for (const query of ['scrims', 'entrenamientos']) {
    assert.ok(navigationSearch(managerNavigation(() => true, true), query).some(item => item.id === 'publicacion'));
    assert.equal(navigationSearch(managerNavigation(() => true, false), query).some(item => item.id === 'publicacion'), false);
  }
  for (const language of ['es', 'en', 'it', 'fr', 'pt', 'de']) {
    const catalogue = JSON.parse(readFileSync(new URL(`../client/src/i18n/locales/${language}.json`, import.meta.url), 'utf8'));
    for (const suffix of ['title', 'description', 'unavailable']) assert.ok(catalogue[`manager.scrims.publication.${suffix}`]?.trim(), `${language}:${suffix}`);
  }
});
