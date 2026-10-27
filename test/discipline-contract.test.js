import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-discipline-'));
Object.assign(process.env, { DATA_DIR: directory, DB_PATH: path.join(directory, 'manager.sqlite'), CTP_OPERATIONS_URL: '', CTP_OPERATIONS_TOKEN: '', PUBLIC_ORIGIN: '' });
const contract = await import('../server/discipline-contract.js');
const { integrationConfig, createOperationsTransport, getDisciplineOverview, writeDiscipline, deleteCtpUser } = await import('../server/integration.js');
const { db } = await import('../server/db.js');
const { managerNavigation } = await import('../client/src/navigation.js');
const { OP_TABS, OP_TAB_ALIASES } = await import('../client/src/operations/model.js');
const { remainingLabel, sanctionPeriod, isStaffRole } = await import('../client/src/operations/sanctionsModel.js');
after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

const now = Date.parse('2026-10-26T12:00:00Z');
const user = randomUUID(), request = randomUUID();
const suspension = { request_id: request, user_id: user, restriction: 'competition_suspend', scopes: ['ranked', 'challenges'], starts_at: new Date(now).toISOString(), ends_at: new Date(now + 86_400_000).toISOString(), reason: '  Abandono reiterado de partidas Ranked.  ' };
const item = { source: 'sanction', id: randomUUID(), kind: 'suspension', restriction: 'competition_suspend', scopes: ['ranked'], subject_type: 'player', subject_id: user, subject_name: 'Mau',
  reason: 'Abandono reiterado de partidas Ranked.', starts_at: '2026-10-26T12:00:00Z', ends_at: '2026-10-27T12:00:00Z', created_at: '2026-10-26T12:00:00Z', issued_by_name: 'Arbi',
  incident_id: null, status: 'active', revoked_at: null, revoke_reason: null, appeal_status: 'none', appeal_reason: null, appealed_at: null, review_reason: null, reviewed_at: null, version: 1 };

test('una sanción directa se valida antes de llegar a CTP', () => {
  const payload = contract.disciplineSanctionPayload(suspension, now);
  assert.deepEqual(payload.scopes, ['challenges', 'ranked']);
  assert.equal(payload.reason, 'Abandono reiterado de partidas Ranked.');
  assert.equal(payload.action, 'sanction');
  const warning = contract.disciplineSanctionPayload({ ...suspension, restriction: 'warning', scopes: [] }, now);
  assert.deepEqual(warning.scopes, []);
  for (const body of [
    { ...suspension, restriction: 'warning' }, { ...suspension, scopes: [] }, { ...suspension, scopes: ['login'] }, { ...suspension, scopes: ['ranked', 'ranked'] },
    { ...suspension, reason: 'corto' }, { ...suspension, reason: 'Motivo con\u0000control suficiente' }, { ...suspension, ends_at: suspension.starts_at },
    { ...suspension, ends_at: new Date(now - 1000).toISOString() }, { ...suspension, starts_at: new Date(now - 7_200_000).toISOString() },
    { ...suspension, ends_at: new Date(now + 3651 * 86_400_000).toISOString() }, { ...suspension, user_id: 'mau' }, { ...suspension, request_id: undefined },
    { ...suspension, incident_id: randomUUID() }, { ...suspension, subject_type: 'club' },
  ]) assert.throws(() => contract.disciplineSanctionPayload(body, now), { status: 400 }, JSON.stringify(body));
  assert.deepEqual(contract.disciplineReviewPayload(item.id, { request_id: request, expected_version: 2, decision: 'uphold', reason: 'Se mantiene por las pruebas aportadas.' }).decision, 'uphold');
  assert.throws(() => contract.disciplineReviewPayload(item.id, { request_id: request, expected_version: 2, decision: 'cancel', reason: 'Se mantiene por las pruebas aportadas.' }), { status: 400 });
  assert.throws(() => contract.disciplineRevokePayload(item.id, { request_id: request, expected_version: 0, reason: 'Sanción aplicada por error.' }), { status: 400 });
  assert.throws(() => contract.disciplineLiftPayload(item.id, { request_id: request, reason: 'x'.repeat(501) }), { status: 400 });
  assert.deepEqual(contract.disciplineUsersQuery({ q: ' mau ', page: '2' }), { action: 'users', query: 'mau', offset: 50, limit: 25 });
  assert.throws(() => contract.disciplineUsersQuery({ page: '-1' }), { status: 400 });
});

test('las respuestas de CTP se reducen a los campos que muestra Manager', () => {
  const clean = contract.disciplineItem({ ...item, email: 'privado@example.test', issued_by: randomUUID() });
  assert.equal(clean.email, undefined); assert.equal(clean.issued_by, undefined); assert.equal(clean.lifted, false);
  for (const bad of [{ ...item, kind: 'ban' }, { ...item, scopes: ['login'] }, { ...item, id: 'x' }, { ...item, reason: 7 }, { ...item, version: 0 }, { ...item, status: 'gone' }])
    assert.throws(() => contract.disciplineItem(bad), { status: 502 });
  const overview = contract.disciplineOverviewResponse({ generated_at: '2026-10-26T12:00:00Z', active: [item], appeals: [], recent: [item] });
  assert.equal(overview.active.length, 1);
  const users = contract.disciplineUsersResponse({ total: 1, items: [{ id: user, username: 'Mau', gamertag: 'MauTag', avatar: '🎮', role: 'player', platform: 'PC', created_at: '2026-01-01T00:00:00Z', restricted_until: null, warnings: 1, history: 2, email: 'x@y.z' }] }, { offset: 0, limit: 25 });
  assert.equal(users.items[0].email, undefined); assert.equal(users.items[0].warnings, 1);
  assert.throws(() => contract.disciplineHistoryResponse({ user: { id: randomUUID(), username: 'Otro', role: 'player' }, clubs: [], items: [] }, user), { status: 502 });
});

test('el borrado exige versión y el nombre escrito, y solo acepta un resultado coherente', () => {
  assert.deepEqual(contract.userDeletePayload(user, { expected_version: 3, confirm_username: 'Mau' }), { action: 'delete', user_id: user, expected_version: 3, confirm_username: 'Mau' });
  for (const body of [{ expected_version: 0, confirm_username: 'Mau' }, { expected_version: 3, confirm_username: '' }, { expected_version: 3, confirm_username: 'Mau', mode: 'hard' }, null])
    assert.throws(() => contract.userDeletePayload(user, body), { status: 400 });
  assert.equal(contract.userDeleteResponse({ user_id: user, mode: 'anonymized', alias: 'eliminada_0123456789', kept: [], storage_cleaned: true }, user).mode, 'anonymized');
  assert.throws(() => contract.userDeleteResponse({ user_id: randomUUID(), mode: 'deleted' }, user), { status: 502 });
  assert.throws(() => contract.userDeleteResponse({ user_id: user, mode: 'soft' }, user), { status: 502 });
});

test('los errores del puente de sanciones usan mensajes propios', async () => {
  const config = integrationConfig({ CTP_OPERATIONS_URL: 'https://example.test/bridge', CTP_OPERATIONS_TOKEN: 'ctp-test-secret-is-only-on-server-0123456789', CTP_SIGNING_SECRET: 'ctp-independent-signing-test-secret-0123456789' });
  const invoke = (body, payload, status = 422) => createOperationsTransport(config, async () => Response.json(payload, { status }))(body);
  const discipline = { action: 'admin_service', service: 'discipline', payload: { action: 'sanction' } };
  await assert.rejects(invoke(discipline, { code: 'invalid_request', discipline_error: 'discipline_staff' }), error => error.status === 422 && error.message.includes('administradores, árbitros'));
  await assert.rejects(invoke(discipline, { code: 'conflict', discipline_error: 'discipline_conflict' }, 409), error => error.status === 409 && error.message.includes('Actualiza'));
  await assert.rejects(invoke(discipline, { code: 'invalid_request', discipline_error: 'SELECT secret' }), error => error.status === 422 && !error.message.includes('SELECT'));
  const remove = { action: 'admin_service', service: 'users', payload: { action: 'delete' } };
  await assert.rejects(invoke(remove, { code: 'invalid_request', delete_error: 'user_delete_club_leader' }), error => error.status === 422 && error.message.includes('liderazgo'));
  await assert.rejects(invoke(remove, { code: 'invalid_request', delete_error: 'user_delete_staff' }), error => error.message.includes('staff'));
});

test('el borrado conserva el diagnóstico acotado de CTP y nunca se reintenta automáticamente', async () => {
  const config = integrationConfig({ CTP_OPERATIONS_URL: 'https://example.test/bridge', CTP_OPERATIONS_TOKEN: 'ctp-test-secret-is-only-on-server-0123456789', CTP_SIGNING_SECRET: 'ctp-independent-signing-test-secret-0123456789' });
  const remove = { action: 'admin_service', service: 'users', payload: { action: 'delete' } };
  for(const [code,status,phrase]of [
    ['user_delete_busy',409,'otra operación'],['user_delete_timeout',504,'resultado no está confirmado'],
    ['user_delete_schema_pending',503,'esquema publicado'],['user_delete_dependency',409,'referencia'],
    ['user_delete_identity_conflict',409,'conflicto de identidad'],['user_delete_forbidden',403,'permisos'],
    ['user_delete_unavailable',503,'no ha podido confirmar'],
  ]) {
    let calls=0;
    const request=createOperationsTransport(config,async()=>{calls++;return Response.json({code:'bridge_unavailable',delete_error:code,delete_diagnostic:{stage:'database',category:'private account',sqlstate:'private SQL body'},details:'private token'},{status});});
    await assert.rejects(request(remove),error=>error.status===status&&error.message.includes(phrase)&&!error.message.includes('private'));
    assert.equal(calls,1);
  }
  const mismatch=createOperationsTransport(config,async()=>Response.json({delete_error:'user_delete_schema_pending'},{status:422}));
  await assert.rejects(mismatch(remove),error=>error.status===422&&!error.message.includes('esquema publicado'));
});

test('un fallo de transporte o confirmación de borrado exige comprobar el estado, sin recomendar repetir a ciegas', async () => {
  const config = integrationConfig({ CTP_OPERATIONS_URL: 'https://example.test/bridge', CTP_OPERATIONS_TOKEN: 'ctp-test-secret-is-only-on-server-0123456789', CTP_SIGNING_SECRET: 'ctp-independent-signing-test-secret-0123456789' });
  const remove = { action: 'admin_service', service: 'users', payload: { action: 'delete' } };
  for(const fail of [
    ()=>{throw new Error('private connection URL');},
    ()=>{throw new DOMException('private host timeout','TimeoutError');},
    ()=>Response.json({ok:false,code:'bridge_unavailable',error:'private SQL detail'},{status:503}),
    ()=>new Response('<html>private edge response</html>',{headers:{'Content-Type':'text/html'}}),
    ()=>Response.json({ok:true,data:null}),
  ]) {
    let calls=0;
    const request=createOperationsTransport(config,async()=>{calls++;return fail();});
    await assert.rejects(request(remove),error=>error.status===502&&error.message===contract.USER_DELETE_UNCERTAIN_MESSAGE);
    assert.equal(calls,1);
  }
  assert.throws(()=>contract.userDeleteResponse({user_id:randomUUID(),mode:'deleted'},user),error=>error.message===contract.USER_DELETE_UNCERTAIN_MESSAGE);
  const read=createOperationsTransport(config,async()=>{throw new Error('private connection URL');});
  await assert.rejects(read({...remove,payload:{action:'get'}}),error=>error.message.includes('contactar con CTP')&&!error.message.includes('borrado'));
});

test('sanciones y borrado comprueban permisos antes de llamar a CTP', async () => {
  const editorial = { id: 9, is_admin: false, sections: ['calendario'] };
  await assert.rejects(getDisciplineOverview(editorial), { status: 403 });
  await assert.rejects(writeDiscipline(editorial, 'sanction', null, suspension), { status: 403 });
  const referee = { id: 9, is_admin: false, sections: ['arbitraje'] };
  await assert.rejects(writeDiscipline(referee, 'sanction', null, suspension), { status: 403 }); // writes disabled in this test process
  await assert.rejects(deleteCtpUser(referee, user, { expected_version: 1, confirm_username: 'Mau' }), { status: 403 });
  await assert.rejects(deleteCtpUser({ id: 1, is_admin: true, auth_mode: 'ctp', ctp_role: 'staff' }, user, { expected_version: 1, confirm_username: 'Mau' }), { status: 403 });
});

test('el menú agrupa Competición sin pestañas duplicadas y redirige Disciplina', () => {
  const items = managerNavigation(() => true, false);
  const group = name => items.filter(entry => entry.group === name).map(entry => entry.id);
  assert.deepEqual(group('Trabajo diario'), ['jornada', 'disponibilidad', 'turnos', 'decisiones']);
  assert.deepEqual(group('Competición'), ['incidencias', 'torneos', 'arbitraje', 'sanciones', 'historico']);
  assert.deepEqual(managerNavigation(() => true, true).filter(entry => entry.group === 'Competición').map(entry => entry.id), ['ranked-monitor', 'incidencias', 'torneos', 'arbitraje', 'sanciones', 'historico']);
  assert.equal(items.some(entry => entry.group === 'Seguimiento' || entry.id === 'disciplina'), false);
  assert.equal(new Set(items.map(entry => entry.title)).size, items.length, 'cada pestaña tiene un nombre distinto');
  assert.equal(items.find(entry => entry.id === 'incidencias').title, 'Tickets');
  assert.equal(items.find(entry => entry.id === 'incidencias').to, '/operaciones/incidencias', 'old ticket links keep working');
  assert.equal(items.find(entry => entry.id === 'arbitraje').title, 'Actas y resultados');
  assert.equal(OP_TAB_ALIASES.disciplina, 'sanciones');
  assert.deepEqual(OP_TABS.find(tab => tab.id === 'sanciones').sections, ['arbitraje']);
});

test('el tiempo restante se lee de un vistazo', () => {
  assert.equal(remainingLabel(30_000), '1 min');
  assert.equal(remainingLabel(59 * 60_000), '59 min');
  assert.equal(remainingLabel(2 * 3_600_000 + 5 * 60_000), '2 h 5 min');
  assert.equal(remainingLabel(3 * 86_400_000 + 4 * 3_600_000), '3 d 4 h');
  assert.equal(remainingLabel(7 * 86_400_000), '7 d');
  assert.equal(remainingLabel(400 * 86_400_000), '1 año y 1 m');
  assert.equal(sanctionPeriod({ ...item, status: 'revoked' }, now), 'revoked');
  assert.equal(sanctionPeriod(item, Date.parse(item.ends_at)), 'expired');
  assert.equal(sanctionPeriod({ ...item, starts_at: '2026-10-27T00:00:00Z' }, now), 'scheduled');
  assert.equal(isStaffRole('referee'), true); assert.equal(isStaffRole('player'), false);
});
