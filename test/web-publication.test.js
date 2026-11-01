import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebPublicationClient, webPublicationPayload, webPublicationResponse } from '../server/web-publication-client.js';
import { EMPTY_DRAFT, canOpenRegistration, draftChanges, ossProgress, pendingCount, percentToBps, setClub, setEuRate, setSection, setTax, setTournament } from '../client/src/pages/webPublicationModel.js';
import { managerNavigation, navigationSearch } from '../client/src/navigation.js';

const T = '31100000-0000-4000-8000-0000000000aa', C = '31100000-0000-4000-8000-0000000000bb', R = '31100000-0000-4000-8000-0000000000cc';
const snapshot = { schema_version: 1, revision: 3, sections: { calendar: false, market: false },
  tournaments: [{ id: T, name: 'CTP Cup #4', status: 'inscripcion_abierta', visible: true, registration_open: false, registration_open_at: '2099-01-01T00:00:00Z', registration_close_at: '2099-02-01T00:00:00Z', entrants: 0, host: { id: C, name: 'Blast', announced: true } }],
  clubs: [{ id: C, name: 'Blast', tag: 'BLST', announced: true, hosting: [] }], tax: { spain_rate_bps: 2100, oss_active: false, oss_threshold_cents: 1000000, management_fee_active: false, management_fee_cents: 100, eu_consumer_sales_cents: 850000, eu_rates: [{ country: 'FR', rate_bps: 2000 }] } };

test('draft collects one batch and forgets changes reverted to the published value', () => {
  let draft = setSection(EMPTY_DRAFT, snapshot, 'calendar', true);
  draft = setClub(draft, snapshot.clubs[0], false);
  draft = setTournament(draft, snapshot.tournaments[0], { registration_open_now: true });
  draft = setTax(draft, snapshot, 'spain_rate_bps', 2100);
  assert.equal(pendingCount(draft), 3);
  assert.deepEqual(draftChanges(draft), { sections: { calendar: true }, tournaments: [{ id: T, registration_open_now: true }], clubs: [{ id: C, announced: false }] });
  draft = setTax(draft, snapshot, 'oss_active', true);
  draft = setEuRate(draft, snapshot.tax.eu_rates[0], 2100);
  assert.deepEqual(draftChanges(draft).tax, { oss_active: true, eu_rates: [{ country: 'FR', rate_bps: 2100 }] });
  draft = setTax(setEuRate(draft, snapshot.tax.eu_rates[0], 2000), snapshot, 'oss_active', false);
  assert.equal(pendingCount(draft), 3);
  assert.equal(ossProgress(snapshot.tax).level, 'near');
  draft = setTax(setTax(draft, snapshot, 'management_fee_active', true), snapshot, 'management_fee_cents', 150);
  assert.deepEqual(draftChanges(draft).tax, { management_fee_active: true, management_fee_cents: 150 });
  assert.equal(percentToBps('1,5', 20), 150);
  assert.equal(percentToBps('25', 20), null);
  draft = setClub(draft, snapshot.clubs[0], true);
  draft = setTournament(draft, snapshot.tournaments[0], { registration_open_now: false });
  assert.equal(pendingCount(draft), 3);
  assert.equal(draftChanges(EMPTY_DRAFT), null);
  assert.equal(canOpenRegistration(snapshot.tournaments[0], Date.parse('2026-11-01')), true);
  assert.equal(percentToBps('21,5'), 2150); assert.equal(percentToBps('31'), null);
});

test('payload accepts only known changes and keeps the request id for retries', () => {
  const payload = { action: 'configure', expected_version: 3, request_id: R, reason: 'Anuncio de Blast y su Major', changes: { clubs: [{ id: C, announced: true }] } };
  assert.deepEqual(webPublicationPayload(payload), payload);
  for (const changes of [{}, { sql: 1 }, { clubs: [] }, { tournaments: [{ id: T }] }, { tax: { spain_rate_bps: 3500 } }, { tax: { eu_rates: [{ country: 'ES', rate_bps: 2100 }] } }, { tax: { oss_active: 'yes' } }, { tax: {} }, { tax: { management_fee_cents: 2500 } }, { tax: { management_fee_active: 1 } }])
    assert.throws(() => webPublicationPayload({ ...payload, changes }), /./);
  assert.throws(() => webPublicationPayload({ ...payload, reason: 'corto' }), /./);
  const tax = { ...payload, changes: { tax: { oss_active: true, eu_rates: [{ country: 'FR', rate_bps: 2000 }] } } };
  assert.deepEqual(webPublicationPayload(tax), tax);
  assert.throws(() => webPublicationResponse({ ...snapshot }, payload), /verificar/);
  assert.equal(webPublicationResponse({ ...snapshot, request_id: R }, payload).request_id, R);
});

test('only CTP admins reach the bridge and writes respect the global switch', async () => {
  const calls = [];
  const client = createWebPublicationClient({ request: async body => { calls.push(body); return snapshot; }, actorFor: async () => 'ctp:admin', writesEnabled: () => false });
  await assert.rejects(client({ id: 'u', is_admin: false }, { action: 'status' }), /administración/);
  assert.equal((await client({ id: 'u', is_admin: true }, { action: 'status' })).revision, 3);
  assert.deepEqual(calls, [{ action: 'admin_service', actor_id: 'ctp:admin', service: 'web_publication', payload: { action: 'status' } }]);
  await assert.rejects(client({ id: 'u', is_admin: true }, { action: 'configure', expected_version: 3, request_id: R, reason: 'Anuncio de Blast y su Major', changes: { sections: { calendar: true } } }), /desactivados/);
});

test('admins find Publicación web from the menu search', () => {
  const items = managerNavigation(() => true, true);
  assert.equal(items.find(item => item.id === 'publicacion')?.to, '/publicacion');
  for (const query of ['publicar web', 'anunciar equipo', 'calendario fechas', 'iva']) assert.ok(navigationSearch(items, query).some(item => item.id === 'publicacion'), query);
  assert.equal(managerNavigation(() => true, false).some(item => item.id === 'publicacion'), false);
});
