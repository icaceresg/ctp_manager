import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebPublicationClient, webPublicationPayload, webPublicationResponse } from '../server/web-publication-client.js';
import { EMPTY_DRAFT, canOpenRegistration, draftChanges, effective, ossProgress, pendingCount, percentToBps, setClub, setEuRate, setSection, setTax, setTournament, tournamentState } from '../client/src/pages/webPublicationModel.js';
import { managerNavigation, navigationSearch } from '../client/src/navigation.js';

const T = '31100000-0000-4000-8000-0000000000aa', C = '31100000-0000-4000-8000-0000000000bb', R = '31100000-0000-4000-8000-0000000000cc';
const snapshot = { schema_version: 1, revision: 3, sections: { calendar: false, market: false },
  tournaments: [{ id: T, name: 'CTP Cup #4', status: 'inscripcion_abierta', visible: true, registration_open: false, registration_open_at: '2099-01-01T00:00:00Z', registration_close_at: '2099-02-01T00:00:00Z', entrants: 0, host: { id: C, name: 'Blast', announced: true } }],
  clubs: [{ id: C, name: 'Blast', tag: 'BLST', announced: true, hosting: [] }], tax: { spain_rate_bps: 2100, oss_active: false, oss_threshold_cents: 1000000, management_fee_active: false, management_fee_cents: 100, eu_consumer_sales_cents: 850000, eu_rates: [{ country: 'FR', rate_bps: 2000 }] } };

test('draft collects one batch and forgets changes reverted to the published value', () => {
  let draft = setSection(EMPTY_DRAFT, snapshot, 'calendar', true);
  draft = setClub(draft, snapshot.clubs[0], { announced: false });
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
  draft = setClub(draft, snapshot.clubs[0], { announced: true });
  draft = setTournament(draft, snapshot.tournaments[0], { registration_open_now: false });
  assert.equal(pendingCount(draft), 3);
  assert.equal(draftChanges(EMPTY_DRAFT), null);
  assert.equal(canOpenRegistration(snapshot.tournaments[0], Date.parse('2026-11-01')), true);
  assert.equal(percentToBps('21,5'), 2150); assert.equal(percentToBps('31'), null);
});

test('draft handles hosts, hidden dates, programs and club pages', () => {
  const t = { ...snapshot.tournaments[0], date_visible: true };
  let draft = setTournament(EMPTY_DRAFT, t, { host_club_id: null, date_visible: false });
  assert.deepEqual(draftChanges(draft).tournaments, [{ id: T, host_club_id: null, date_visible: false }]);
  assert.equal(effective.host(draft, t), null); assert.equal(effective.dateVisible(draft, t), false);
  draft = setTournament(draft, t, { host_club_id: C, date_visible: true });
  assert.equal(pendingCount(draft), 0);
  const found = { id: R, name: 'Imperial', tag: 'IMP', program: null, found: true };
  draft = setClub(draft, found, { program: 'semi_team_pass' });
  assert.deepEqual(draft.found, { [R]: { name: 'Imperial', tag: 'IMP' } });
  const club = { ...snapshot.clubs[0], program: 'team_pass', branding: { primary_color: '#D4A843', secondary_color: '#F5F1E8', tagline: '', logo_path: null, cover_path: null } };
  draft = setClub(draft, club, { primary_color: '#112233', logo_path: C + '/' + R + '.png' });
  assert.deepEqual(draftChanges(draft).clubs, [{ id: R, program: 'semi_team_pass' }, { id: C, primary_color: '#112233', logo_path: C + '/' + R + '.png' }]);
  assert.equal(effective.club(draft, club, 'primary_color'), '#112233');
  draft = setClub(setClub(draft, found, { program: null }), club, { primary_color: '#D4A843', logo_path: null });
  assert.equal(pendingCount(draft), 0); assert.deepEqual(draft.found, {});
  const configure = { action: 'configure', expected_version: 3, request_id: R, reason: 'Imagen del club anfitrión',
    changes: { tournaments: [{ id: T, host_club_id: null, date_visible: false }], clubs: [{ id: C, primary_color: '#aabbcc', tagline: 'Lema', cover_path: C + '/' + R + '.jpg' }, { id: R, program: 'semi_team_pass' }, { id: T, circuit_pass: true }] } };
  assert.equal(webPublicationPayload(configure).changes.clubs[0].primary_color, '#AABBCC');
  for (const clubs of [[{ id: C, logo_path: R + '/' + R + '.png' }], [{ id: C, cover_path: C + '/' + R + '.png' }], [{ id: C, program: 'team_pass' }], [{ id: C, primary_color: 'red' }], [{ id: C, tagline: 'x'.repeat(81) }]])
    assert.throws(() => webPublicationPayload({ ...configure, changes: { clubs } }), { status: 400 });
  assert.deepEqual(webPublicationPayload({ action: 'search', query: ' imp ' }), { action: 'search', query: 'imp' });
  assert.throws(() => webPublicationPayload({ action: 'search', query: 'i' }), { status: 400 });
  const upload = { action: 'upload', team_id: C, kind: 'logo', content_type: 'image/png', base64: 'iVBORw0KGgo=', request_id: R };
  assert.deepEqual(webPublicationPayload(upload), upload);
  assert.throws(() => webPublicationPayload({ ...upload, content_type: 'image/jpeg' }), { status: 400 });
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


test('publication and competition derive one state from the authoritative registration window', () => {
  const now=Date.parse('2026-11-02T12:00:00Z');
  const base={status:'inscripcion_abierta',visible:true,registration_open_at:'2026-11-01T00:00:00Z',registration_close_at:'2026-11-08T09:00:00Z'};
  assert.equal(tournamentState(base,now).key,'open');
  assert.equal(tournamentState({...base,registration_open_at:base.registration_close_at},now).key,'published');
  assert.equal(tournamentState({...base,status:'borrador'},now).key,'hidden');
  assert.equal(tournamentState(base,Date.parse('2026-11-08T09:00:00Z')).key,'published');
});

test('an administrator can close registration while leaving the tournament published', () => {
  const t={...snapshot.tournaments[0],registration_open:true};
  const draft=setTournament(EMPTY_DRAFT,t,{visible:true,registration_open_now:false});
  assert.deepEqual(draftChanges(draft).tournaments,[{id:T,registration_open_now:false}]);
  const payload={action:'configure',expected_version:3,request_id:R,reason:'Cerrar inscripción manteniendo el anuncio',changes:draftChanges(draft)};
  assert.equal(webPublicationPayload(payload).changes.tournaments[0].registration_open_now,false);
});
