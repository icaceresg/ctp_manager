import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { signManagerRequest } from '../server/bridge-signature.js';

test('on-demand operations sync keeps the incident worker and official command refresh', async t => {
  const temporary = mkdtempSync(join(tmpdir(), 'ctp-on-demand-sync-'));
  const token = 'operations-demand-test-token-only-0123456789';
  const signingSecret = 'operations-demand-test-signing-only-0123456789';
  const url = 'http://127.0.0.1:4239/bridge';
  Object.assign(process.env, {
    DATA_DIR: temporary, DB_PATH: join(temporary, 'manager.db'), PUBLIC_ORIGIN: '',
    CTP_AUTH_MODE: 'local', CTP_OPERATIONS_URL: url, CTP_OPERATIONS_TOKEN: token, CTP_SIGNING_SECRET: signingSecret,
    CTP_ENABLE_WRITES: 'true', CTP_ALLOW_LOCAL_WRITES: 'true', CTP_SYNC_SECONDS: '60',
    CTP_OPERATIONS_SNAPSHOT_ON_DEMAND: 'true',
  });
  const startedAt = Date.parse('2026-11-21T09:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now: startedAt });
  const now = () => new Date().toISOString();
  const ticketId = 'dd2eb3ea-e33f-4483-928a-a9060dbed444';
  const dispute = { id: 'ranked-dispute', title: 'Ranked dispute', kind: 'ranked', status: 'abierto', version: 1 };
  let ticket = { id: ticketId, title: 'Fixture ticket', kind: 'support', status: 'abierto',
    awaiting_staff: true, version: 1, created_at: now() };
  let matches = [{ id: 'match-1', title: 'Original match', version: 1 }];
  let incidentFailure = false, snapshotFailure = false, delayedSnapshot;
  const calls = [];
  const ok = data => Response.json({ ok: true, data });
  t.mock.method(globalThis, 'fetch', async (target, options) => {
    const body = JSON.parse(options.body);
    assert.equal(target, url);
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    const signature = signManagerRequest(options.body, signingSecret, {
      timestamp: Number(options.headers['X-CTP-Timestamp']), nonce: options.headers['X-CTP-Nonce'],
    });
    assert.equal(options.headers['X-CTP-Signature'], signature['X-CTP-Signature']);
    calls.push(body);
    if (body.action === 'incidents_snapshot') {
      return incidentFailure ? Response.json({}, { status: 503 }) : ok({
        generated_at: now(), incidents: [ticket, dispute], collection_complete: { incidents: true },
      });
    }
    if (body.action === 'snapshot') {
      if (delayedSnapshot) await delayedSnapshot;
      return snapshotFailure ? Response.json({}, { status: 503 }) : ok({
        generated_at: now(), matches, incidents: [ticket, dispute], stats: [], clubs: [], deliveries: [],
        supported_actions: { 'incident.status': true }, collection_complete: { matches: true, incidents: true },
      });
    }
    if (body.action === 'case_query') {
      assert.equal(body.target_id, ticketId);
      return ok({ incident: { ...ticket, manager_version: ticket.version }, messages: [] });
    }
    if (body.action === 'command') {
      assert.equal(body.type, 'incident.status');
      assert.equal(body.target_id, ticketId);
      assert.equal(body.expected_version, ticket.version);
      assert.ok(body.actor_id);
      ticket = { ...ticket, status: body.payload.status, version: ticket.version + 1 };
      return ok({ applied: true, type: body.type, target_id: body.target_id, command_id: body.command_id,
        source_version: ticket.version });
    }
    if (body.action === 'ranked_monitor') {
      assert.ok(body.actor_id);
      return ok({ schema_version: 1, observed_at: now(), window_started_at: now(), queues: [], lobby_statuses: [],
        active_lobbies: [], map_activity: [],
        summary: { waiting_players: 0, waiting_parties: 0, solo_players: 0, active_lobbies: 0,
          players_in_lobbies: 0, active_queues: 0, open_queues: 0 },
        activity_24h: { created_matches: 0, completed_matches: 0, cancelled_matches: 0, disputes_opened: 0,
          map_draws: 0, map_skips: 0, duration_avg_seconds: null },
        truncated: { queues: false, active_lobbies: false, map_activity: false } });
    }
    assert.fail(`Unexpected action ${body.action}`);
  });
  const { db } = await import('../server/db.js');
  t.after(() => {
    db.close();
    assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
    assert.ok(basename(temporary).startsWith('ctp-on-demand-sync-'));
    rmSync(temporary, { recursive: true, force: true });
  });
  const { loadOperationsWorkspace } = await import('../server/operations-workspace.js');
  const operations = await import('../server/operations.js');
  const integration = await import('../server/integration.js');
  const { refreshOperationsOnDemand } = integration;
  const enabledConfig = { ...process.env };
  delete enabledConfig.CTP_OPERATIONS_SNAPSHOT_ON_DEMAND;
  assert.equal(integration.integrationConfig(enabledConfig).snapshotOnDemand, false);
  const insert = db.prepare('INSERT INTO users(username,name,password_hash,is_admin,created_at) VALUES(?,?,?,?,?)');
  const admin = { id: Number(insert.run('demand-admin', 'Admin', 'fixture', 1, Date.now()).lastInsertRowid), is_admin: true };
  const referee = { id: Number(insert.run('demand-referee', 'Referee', 'fixture', 0, Date.now()).lastInsertRowid), sections: ['arbitraje'] };
  const load = (user, view, query = {}) => loadOperationsWorkspace(user, { view, ...query }, refreshOperationsOnDemand);
  const count = (action = 'snapshot') => calls.filter(call => call.action === action).length;
  let poll;
  integration.startOperationsSync({ interval: (callback, ms) => {
    assert.equal(ms, 60_000);
    poll = callback;
    return { unref() {} };
  } });
  await refreshOperationsOnDemand();
  assert.equal(count(), 1);
  assert.equal(count('incidents_snapshot'), 1);
  assert.deepEqual(integration.integrationStatus().supported_actions, ['incident.status']);

  // Idle ticks ingest tickets independently while the full snapshot is unavailable.
  snapshotFailure = true;
  ticket = { ...ticket, version: 2, status: 'en_revision' };
  for (let tick = 0; tick < 3; tick++) {
    t.mock.timers.tick(60_000);
    await poll();
  }
  const inbox = await load(referee, 'incidencias');
  assert.equal(inbox.incidents.find(row => row.id === ticketId).status, 'investigating');
  assert.equal(inbox.incident_counts.all_open, 2);
  assert.equal(inbox.connection.last_incident_sync_at, now());
  assert.equal(inbox.connection.last_sync_at, new Date(startedAt).toISOString());
  await load(referee, 'incidencias', { q: 'fixture', limit: '5' });
  await load(referee, 'arbitraje');
  assert.equal((await integration.getRankedMonitor(admin)).summary.active_lobbies, 0);
  await assert.rejects(load(null, 'jornada'), { status: 401 });
  await assert.rejects(load({ id: referee.id }, 'jornada'), { status: 403 });
  await assert.rejects(load(referee, 'administration'), { status: 403 });
  await assert.rejects(load(referee, 'jornada', { limit: '0' }), { status: 400 });
  assert.equal(count(), 1);
  assert.equal(count('incidents_snapshot'), 4);

  // First-page readers share one full snapshot. Paginated readers do not refresh.
  snapshotFailure = false;
  matches = [{ id: 'match-1', title: 'New match', version: 2 }, { id: 'match-2', title: 'Second match', version: 1 }];
  const gate = Promise.withResolvers();
  delayedSnapshot = gate.promise;
  const pending = [load(admin, 'casters', { limit: '1' }), load(referee, 'casters', { limit: '1' })];
  assert.equal(count(), 2);
  gate.resolve();
  const [first, second] = await Promise.all(pending);
  delayedSnapshot = undefined;
  assert.equal(first.matches[0].title, 'New match');
  assert.equal(second.revision, first.revision);
  await load(admin, 'casters', { limit: '1' });
  assert.equal(count(), 2);
  t.mock.timers.tick(60_000);
  const page = await load(admin, 'casters', { limit: '1', page: '1', revision: first.revision });
  assert.equal(page.matches[0].id, 'match-2');
  assert.equal(count(), 2);

  // Until the backoff expires, failures use the last complete local copy.
  snapshotFailure = true;
  assert.equal((await load(admin, 'casters')).matches[0].title, 'New match');
  assert.equal((await load(referee, 'casters')).matches[0].title, 'New match');
  assert.equal(count(), 3);
  snapshotFailure = false;
  incidentFailure = true;
  ticket = { ...ticket, version: 3, status: 'esperando_respuesta' };
  t.mock.timers.tick(60_000);
  await poll();
  assert.equal(count(), 4);
  assert.equal((await load(referee, 'incidencias')).incidents.find(row => row.id === ticketId).status, 'waiting');

  // The manual sync bypasses the window, and an acknowledged command still triggers a full sync.
  incidentFailure = false;
  await integration.syncOperations();
  assert.equal(count(), 5);
  await integration.getCaseData(admin, { resource: 'incident', target_id: ticketId });
  const { command } = operations.prepareCaseCommand(admin, { type: 'incident.status', target_id: ticketId,
    expected_version: 3, payload: { status: 'cerrado', reason: 'Confirmed in the local test' } });
  t.mock.timers.tick(60_000);
  const inFlight = Promise.withResolvers();
  delayedSnapshot = inFlight.promise;
  const oldRead = load(referee, 'casters');
  const sending = integration.sendOperationCommand(command.id);
  for (let turn = 0; turn < 50 && operations.getCommand(command.id).status !== 'acknowledged'; turn++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(operations.getCommand(command.id).status, 'acknowledged');
  assert.equal(count(), 6);
  delayedSnapshot = undefined;
  inFlight.resolve();
  await oldRead;
  const receipt = await sending;
  assert.equal(receipt.confirmed, true);
  assert.equal(receipt.sync_pending, false);
  assert.equal(operations.getCommand(command.id).status, 'acknowledged');
  assert.equal(count(), 7);
  assert.equal((await load(referee, 'incidencias')).incidents.find(row => row.id === ticketId).status, 'closed');

  // Restart against the same SQLite image, then simulate both readers failing.
  const restarted = await import('../server/integration.js?restart');
  const beforeRestart = count('incidents_snapshot');
  const capturePoll = callback => {
    poll = callback;
    return { unref() {} };
  };
  restarted.startOperationsSync({ interval: capturePoll });
  assert.equal(count(), 7);
  assert.equal(count('incidents_snapshot'), beforeRestart);
  t.mock.timers.tick(60_000);
  await poll();
  assert.equal(count(), 7);
  assert.equal(count('incidents_snapshot'), beforeRestart + 1);
  incidentFailure = true;
  snapshotFailure = true;
  t.mock.timers.tick(60_000);
  await poll();
  assert.equal(count(), 8);
  t.mock.timers.tick(60_000);
  await poll();
  assert.equal(count(), 8);
  assert.equal(count('incidents_snapshot'), beforeRestart + 3);
  snapshotFailure = false;
  ticket = { ...ticket, version: 5, status: 'en_revision' };
  t.mock.timers.tick(60_000);
  await poll();
  assert.equal(count(), 9);
  assert.equal((await load(referee, 'incidencias')).incidents.find(row => row.id === ticketId).status, 'investigating');

  incidentFailure = false;
  operations.setIntegrationStatus({ supported_actions: [] });
  const withoutCapabilities = await import('../server/integration.js?no-capabilities');
  withoutCapabilities.startOperationsSync({ interval: capturePoll });
  await withoutCapabilities.refreshOperationsOnDemand();
  assert.equal(count(), 10);
  assert.deepEqual(withoutCapabilities.integrationStatus().supported_actions, ['incident.status']);

  delete process.env.CTP_OPERATIONS_SNAPSHOT_ON_DEMAND;
  const legacy = await import('../server/integration.js?legacy');
  legacy.startOperationsSync({ interval: capturePoll });
  t.mock.timers.tick(60_000);
  await legacy.refreshOperationsOnDemand();
  assert.equal(count(), 10);
  const previousIncidentReads = count('incidents_snapshot');
  await poll();
  assert.equal(count(), 11);
  assert.equal(count('incidents_snapshot'), previousIncidentReads + 1);
});
