import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-integration-'));
process.env.DATA_DIR = path.join(temp, 'unit'); process.env.DB_PATH = '';
process.env.CTP_OPERATIONS_URL = ''; process.env.CTP_OPERATIONS_TOKEN = '';
process.env.PUBLIC_ORIGIN = '';
const { integrationConfig, createOperationsTransport, webOrigin } = await import('../server/integration.js');
const { db } = await import('../server/db.js');
const token = 'ctp-test-secret-is-only-on-server-0123456789';
const signingSecret = 'ctp-independent-signing-test-secret-0123456789';

test('configuración del puente impide destinos inseguros y credenciales débiles', () => {
  assert.equal(integrationConfig({}).configured, false);
  for (const url of ['http://private.example.test/rpc', 'https://user:pass@example.test/rpc', 'https://example.test/rpc?token=1', 'file:///tmp/data']) {
    assert.throws(() => integrationConfig({ CTP_OPERATIONS_URL: url, CTP_OPERATIONS_TOKEN: token }));
  }
  assert.throws(() => integrationConfig({ CTP_OPERATIONS_URL: 'https://example.test/rpc', CTP_OPERATIONS_TOKEN: 'weak' }));
  assert.equal(integrationConfig({ CTP_OPERATIONS_URL: 'http://127.0.0.1:4000/rpc', CTP_OPERATIONS_TOKEN: token, CTP_SIGNING_SECRET: signingSecret }).writes, false);
  assert.throws(() => integrationConfig({ CTP_OPERATIONS_URL: 'https://example.test/rpc', CTP_OPERATIONS_TOKEN: token, CTP_SIGNING_SECRET: signingSecret, CTP_ENABLE_WRITES: 'true' }));
  assert.throws(() => integrationConfig({ CTP_OPERATIONS_URL: 'https://example.test/rpc', CTP_OPERATIONS_TOKEN: token, CTP_SIGNING_SECRET: token }));
});

test('enlaces a CTP admiten QA loopback y rechazan HTTP remoto, credenciales y rutas', () => {
  assert.equal(webOrigin({}), 'https://playctp.com');
  for (const origin of ['http://127.0.0.1:5181', 'http://localhost:5181', 'http://[::1]:5181', 'https://playctp.com']) {
    assert.equal(webOrigin({ CTP_WEB_ORIGIN: origin }), origin);
  }
  for (const origin of ['http://192.168.1.10:5181', 'http://ctp.example', 'https://user:pass@playctp.com', 'https://playctp.com/app', 'https://playctp.com?token=x', 'javascript:alert(1)']) {
    assert.throws(() => webOrigin({ CTP_WEB_ORIGIN: origin }));
  }
});

test('transporte limita respuestas, rechaza redirecciones y no revela secretos remotos', async () => {
  const config = integrationConfig({ CTP_OPERATIONS_URL: 'https://example.test/bridge', CTP_OPERATIONS_TOKEN: token, CTP_SIGNING_SECRET: signingSecret });
  let seen;
  const request = createOperationsTransport(config, async (url, options) => {
    seen = options;
    return new Response(JSON.stringify({ ok: true, data: { matches: [] } }), { headers: { 'Content-Type': 'application/json' } });
  });
  assert.deepEqual(await request({ action: 'snapshot' }), { matches: [] });
  assert.equal(seen.redirect, 'error'); assert.equal(seen.headers.Authorization, `Bearer ${token}`);
  const bad = [
    async () => new Response(token, { status: 500 }),
    async () => new Response(JSON.stringify({ ok: false, error: token }), { headers: { 'Content-Type': 'application/json' } }),
    async () => new Response('<html>bad</html>', { headers: { 'Content-Type': 'text/html' } }),
    async () => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': '99999999' } }),
    async () => { throw new Error(`network failure ${token}`); },
  ];
  for (const fn of bad) {
    await assert.rejects(createOperationsTransport(config, fn)({ action: 'snapshot' }), (error) => error.status === 502 && !error.message.includes(token));
  }
});

test('solo club_candidates acepta arrays y mantiene el contrato de respuesta de las demás acciones', async () => {
  const config = integrationConfig({ CTP_OPERATIONS_URL: 'https://example.test/bridge', CTP_OPERATIONS_TOKEN: token, CTP_SIGNING_SECRET: signingSecret });
  const invoke = (action, data) => createOperationsTransport(config, async () => Response.json({ ok: true, data }))({ action });
  const candidates = [{ id: '10000000-0000-4000-8000-000000000001', username: 'QA leader' }];
  assert.deepEqual(await invoke('club_candidates', []), []);
  assert.deepEqual(await invoke('club_candidates', candidates), candidates);
  for (const data of [{}, { items: candidates }, null, false, 'players', 1]) {
    await assert.rejects(invoke('club_candidates', data), { status: 502 });
  }
  for (const action of ['snapshot', 'competition', 'command', 'ranked_state', 'guard_state', 'case_context']) {
    assert.deepEqual(await invoke(action, {}), {});
    for (const data of [[], candidates, null, false, 'object', 1]) {
      await assert.rejects(invoke(action, data), { status: 502 });
    }
  }
});

test('Twitch service failures use bounded known copy and never forward provider details', async () => {
  const config = integrationConfig({ CTP_OPERATIONS_URL: 'https://example.test/bridge', CTP_OPERATIONS_TOKEN: token, CTP_SIGNING_SECRET: signingSecret });
  const body = { action: 'admin_service', service: 'twitch', payload: { action: 'complete' } };
  const invoke = payload => createOperationsTransport(config, async () => Response.json(payload, { status: 409 }))(body);
  await assert.rejects(invoke({ code: 'provider_error', provider_error: 'integrations.twitch.wrongChannel', secret: token }), error => error.status === 409 && error.message.includes('playctp') && !error.message.includes(token));
  for (const provider_error of [token, 'integrations.twitch.' + token, 'x'.repeat(9000)]) {
    await assert.rejects(invoke({ code: 'provider_error', provider_error }), error => error.status === 409 && !error.message.includes(token) && error.message.length < 200);
  }
});

test('un rechazo HTTP de autorización es definitivo y una caída mantiene la incertidumbre', async () => {
  const config = integrationConfig({ CTP_OPERATIONS_URL: 'https://example.test/bridge', CTP_OPERATIONS_TOKEN: token, CTP_SIGNING_SECRET: signingSecret });
  for (const status of [401, 403]) {
    const invoke = createOperationsTransport(config, async () => Response.json({ error: token }, { status }));
    await assert.rejects(invoke({ action: 'command' }), error => error.status === 502 && error.remoteRejected === true && !error.message.includes(token));
  }
  for (const status of [409, 500, 503]) {
    const invoke = createOperationsTransport(config, async () => Response.json({ error: token }, { status }));
    await assert.rejects(invoke({ action: 'command' }), error => error.remoteRejected !== true && !error.message.includes(token));
  }
  const unavailable = createOperationsTransport(config, async () => { throw new TypeError('connection lost'); });
  await assert.rejects(unavailable({ action: 'command' }), error => error.remoteRejected !== true);
});

test('read permission revocation reaches the UI as forbidden so earlier private data can be cleared', async () => {
  const config = integrationConfig({ CTP_OPERATIONS_URL: 'https://example.test/bridge', CTP_OPERATIONS_TOKEN: token, CTP_SIGNING_SECRET: signingSecret });
  for (const status of [401,403]) {
    for (const action of ['admin_query','competition','case_query','admin_service']) {
      const invoke = createOperationsTransport(config, async () => Response.json({ error: token }, { status }));
      await assert.rejects(invoke({ action }), error => error.status === 403 && !error.message.includes(token));
    }
  }
});

let port, remote, child, mode = 'ok', observed = [], snapshot = {
  generated_at: '2026-09-29T10:00:00Z', supported_actions: { 'stats.review': true, 'club.verify': true, 'discord.retry': true, 'incident.resolve': true, 'incident.reply': true, 'sanction.create': false },
  matches: [{ id: 'match-integration', title: 'A vs B', kind: 'tournament', status: 'live', team_a: { name: 'A' }, team_b: { name: 'B' }, version: 1 }],
  incidents: [{ id: 'incident-context', match_id: 'match-integration', title: 'Ticket', status: 'open', version: 1 }], stats: [{ id: 'stat-integration', match_id: 'match-integration', status: 'pending', map_name: 'Map', mode: 'Hardpoint', players: [], version: 7 }],
  clubs: [], deliveries: [],
  competition_cutover_enabled: false,
};
let cookie = '', operatorId, clubCandidates = [];
async function api(method, route, body, session = cookie) {
  const response = await fetch(`http://localhost:${port}/api${route}`, { method, headers: { Cookie: session, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie && session === cookie) cookie = setCookie.split(';')[0];
  return { status: response.status, data: await response.json(), cookie: setCookie?.split(';')[0] };
}
async function stop() {
  if (child?.exitCode === null && !child.signalCode) await new Promise((resolve) => { child.once('exit', resolve); child.kill(); });
}
async function start(writes = false) {
  await stop();
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: root,
    env: { ...process.env, PORT: String(port), DATA_DIR: path.join(temp, 'http'), DB_PATH: '', PUBLIC_ORIGIN: '', OPEN_BROWSER: '0',
      CTP_OPERATIONS_URL: `http://127.0.0.1:${remote.address().port}/bridge`, CTP_OPERATIONS_TOKEN: token, CTP_SIGNING_SECRET: signingSecret, CTP_ALLOW_LOCAL_WRITES: 'true', CTP_ENABLE_WRITES: String(writes), CTP_SYNC_SECONDS: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
  const limit = Date.now() + 10000;
  while (!output.includes('funcionando')) {
    if (child.exitCode !== null || Date.now() > limit) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}
before(async () => {
  remote = http.createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    const parsed = JSON.parse(body); observed.push(parsed);
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    response.setHeader('Content-Type', 'application/json');
    if (mode === 'outage') { response.statusCode = 503; response.end(JSON.stringify({ error: token })); return; }
    if (mode === 'rejected') { response.statusCode = 422; response.end(JSON.stringify({ ok: false, code: 'invalid_command' })); return; }
    if (mode === 'unauthenticated' || mode === 'forbidden' || mode === 'self_review' && parsed.action === 'command' && parsed.actor_id === operatorId) {
      response.statusCode = mode === 'unauthenticated' ? 401 : 403;
      response.end(JSON.stringify({ ok: false, code: 'forbidden', error: token })); return;
    }
    if (mode === 'malformed') { response.end(JSON.stringify({ ok: true, data: { matches: 'bad' } })); return; }
    if (parsed.action === 'club_candidates') { response.end(JSON.stringify({ ok: true, data: clubCandidates })); return; }
    if (parsed.action === 'case_context') { response.end(JSON.stringify({ ok: true, data: { incident_id: parsed.target_id, messages: [{ id: 'message-1', author_name: 'Jugador', text: 'Necesitamos ayuda', created_at: '2026-09-29T10:00:00Z', source: 'ticket', is_staff: false, private_token: token }], next_cursor: null, web_path: '/app/retos/test' } })); return; }
    response.end(JSON.stringify({ ok: true, data: parsed.action === 'snapshot' ? snapshot : { applied: true, command_id: mode === 'wrong_ack' ? 'another-command' : parsed.command_id, type: parsed.type, target_id: parsed.target_id, ...(parsed.type?.startsWith('sanction.') ? { version: 1, source_version: 1 } : {}) } }));
  });
  await new Promise((resolve) => remote.listen(0, '127.0.0.1', resolve));
  const reserve = net.createServer(); await new Promise((resolve) => reserve.listen(0, '127.0.0.1', resolve));
  port = reserve.address().port; await new Promise((resolve) => reserve.close(resolve));
  await start();
  assert.equal((await api('POST', '/auth/setup', { username: 'admin', password: 'integration-test-password' })).status, 200);
});
after(async () => {
  await stop(); await new Promise((resolve) => remote.close(resolve)); db.close();
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('sincronización real requiere sesión, preserva datos al fallar y no expone secretos', async () => {
  assert.equal((await api('POST', '/operations/integration/sync', {}, '')).status, 401);
  const synced = await api('POST', '/operations/integration/sync', {});
  assert.equal(synced.status, 200); assert.ok(synced.data.last_sync_at);
  assert.equal(JSON.stringify(synced.data).includes(token), false);
  assert.equal(synced.data.write_enabled, false);
  assert.equal(synced.data.competition_cutover_enabled, false);
  snapshot.competition_cutover_enabled = true;
  assert.equal((await api('POST', '/operations/integration/sync', {})).data.competition_cutover_enabled, true);
  delete snapshot.competition_cutover_enabled;
  assert.equal((await api('POST', '/operations/integration/sync', {})).data.competition_cutover_enabled, null);
  snapshot.competition_cutover_enabled = false;
  assert.deepEqual(synced.data.supported_actions, ['incident.resolve', 'incident.reply', 'stats.review', 'club.verify', 'discord.retry']);
  assert.equal((await api('GET', '/operations/bootstrap')).data.matches.length, 1);
  operatorId = (await api('GET', '/operations/bootstrap')).data.staff.find((s) => s.id === 1).integration_actor_id;
  assert.match(operatorId, /^[0-9a-f-]{36}$/);
  mode = 'outage';
  assert.equal((await api('POST', '/operations/integration/sync', {})).status, 502);
  mode = 'malformed';
  assert.equal((await api('POST', '/operations/integration/sync', {})).status, 502);
  const preserved = await api('GET', '/operations/bootstrap');
  assert.equal(preserved.data.matches[0].id, 'match-integration');
  assert.equal(JSON.stringify(preserved.data.connection).includes(token), false);
  mode = 'ok';
});

let command;
test('preparar una decisión nunca la envía y las escrituras están cerradas por defecto', async () => {
  const initial = observed.length;
  const stat = (await api('GET', '/operations/bootstrap')).data.stats[0];
  const prepared = await api('POST', `/operations/stats/${stat.id}/review`, { expected_version: stat.version, decision: 'approve', reason: 'Revisado por el árbitro' });
  assert.equal(prepared.status, 200); command = prepared.data.command;
  assert.equal(command.status, 'pending'); assert.equal(observed.length, initial);
  assert.equal((await api('POST', `/operations/integration/commands/${command.id}/send`, {})).status, 403);
  assert.equal(observed.length, initial);
});

test('un reintento conserva actor e idempotencia y solo confirma tras ACK remoto', async () => {
  await start(true);
  mode = 'outage';
  assert.equal((await api('POST', `/operations/integration/commands/${command.id}/send`, {})).status, 502);
  let state = (await api('GET', '/operations/bootstrap')).data;
  assert.equal(state.commands.find((c) => c.id === command.id).status, 'failed');
  assert.equal(state.stats[0].status, 'pending');
  const failedCommand = observed.at(-1);
  mode = 'ok';
  const sent = await api('POST', `/operations/integration/commands/${command.id}/send`, { actor_id: 'forged' });
  assert.equal(sent.status, 200); assert.equal(sent.data.confirmed, true);
  assert.deepEqual(observed.at(-1), failedCommand);
  assert.equal(failedCommand.actor_id, operatorId); assert.equal(failedCommand.command_id, command.idempotency_key);
  assert.equal(failedCommand.expected_version, 7); assert.equal(failedCommand.type, 'stats.review');
  assert.deepEqual(failedCommand.payload, { approve: true, note: 'Revisado por el árbitro' });
  state = (await api('GET', '/operations/bootstrap')).data;
  assert.equal(state.stats[0].status, 'approved');
  const calls = observed.length;
  assert.equal((await api('POST', `/operations/integration/commands/${command.id}/send`, {})).status, 409);
  assert.equal(observed.length, calls);
});

test('un ACK de otro comando no confirma la solicitud local', async () => {
  snapshot.stats = [{ id: 'stat-second', match_id: 'match-integration', status: 'pending', version: 1, players: [] }];
  assert.equal((await api('POST', '/operations/integration/sync', {})).status, 200);
  const item = (await api('GET', '/operations/bootstrap')).data.stats.find((s) => s.id === 'stat-second');
  const prepared = (await api('POST', `/operations/stats/${item.id}/review`, { expected_version: item.version, decision: 'reject', reason: 'Lectura dudosa' })).data.command;
  mode = 'wrong_ack';
  assert.equal((await api('POST', `/operations/integration/commands/${prepared.id}/send`, {})).status, 502);
  const state = (await api('GET', '/operations/bootstrap')).data;
  assert.equal(state.stats.find((s) => s.id === item.id).status, 'pending');
  assert.equal(state.commands.find((c) => c.id === prepared.id).status, 'failed');
  mode = 'ok';
});

test('solo administración envía y una revocación del autor impide usar su solicitud pendiente', async () => {
  const role = (await api('POST', '/roles', { name: 'REVISION INTEGRATION', staff_kind: 'referee', sections: ['arbitraje'] })).data;
  const user = (await api('POST', '/users', { username: 'reviewer', password: 'reviewer-test-password', role_ids: [role.id] })).data;
  const reviewer = (await api('POST', '/auth/login', { username: 'reviewer', password: 'reviewer-test-password' }, '')).cookie;
  assert.ok(reviewer);
  assert.equal((await api('POST', '/operations/integration/sync', {}, reviewer)).status, 403);
  assert.equal((await api('POST', `/operations/integration/commands/${command.id}/send`, {}, reviewer)).status, 403);
  snapshot.stats = [{ id: 'stat-revoked', match_id: 'match-integration', status: 'pending', version: 1, players: [] }];
  await api('POST', '/operations/integration/sync', {});
  const item = (await api('GET', '/operations/bootstrap', undefined, reviewer)).data.stats.find((s) => s.id === 'stat-revoked');
  const prepared = await api('POST', `/operations/stats/${item.id}/review`, { expected_version: item.version, decision: 'approve', reason: 'Lectura revisada' }, reviewer);
  assert.equal(prepared.status, 200);
  assert.equal((await api('PATCH', `/users/${user.id}`, { active: false })).status, 200);
  const calls = observed.length;
  assert.equal((await api('POST', `/operations/integration/commands/${prepared.data.command.id}/send`, {})).status, 403);
  assert.equal(observed.length, calls);
});

test('conversación privada usa actor de sesión y solo expone campos permitidos a arbitraje', async () => {
  const result = await api('GET', '/operations/incidents/incident-context/context?actor_id=forged&cursor=opaque-page');
  assert.equal(result.status, 200);
  assert.equal(result.data.messages[0].text, 'Necesitamos ayuda');
  assert.equal(JSON.stringify(result.data).includes(token), false);
  assert.equal(observed.at(-1).actor_id, operatorId); assert.equal(observed.at(-1).cursor, 'opaque-page');
  assert.equal((await api('GET', '/operations/incidents/incident-context/context', undefined, '')).status, 401);
  const role = (await api('POST', '/roles', { name: 'CASTER CONTEXT TEST', staff_kind: 'caster', sections: ['casters'] })).data;
  await api('POST', '/users', { username: 'caster-context', password: 'caster-test-password', role_ids: [role.id] });
  const caster = (await api('POST', '/auth/login', { username: 'caster-context', password: 'caster-test-password' }, '')).cookie;
  const calls = observed.length;
  assert.equal((await api('GET', '/operations/incidents/incident-context/context', undefined, caster)).status, 403);
  assert.equal(observed.length, calls);
});

test('buscar líderes de club funciona por HTTP, filtra campos privados y controla respuestas inválidas', async () => {
  snapshot.supported_actions['club.create'] = true;
  assert.equal((await api('POST', '/operations/integration/sync', {})).status, 200);
  const route = '/operations/clubs/candidates?query=Leader';
  const callsBefore = observed.length;
  assert.equal((await api('GET', route, undefined, '')).status, 401);
  assert.equal((await api('GET', '/operations/clubs/candidates?query=ab')).status, 400);
  assert.equal(observed.length, callsBefore);
  clubCandidates = [];
  const empty = await api('GET', route);
  assert.equal(empty.status, 200); assert.deepEqual(empty.data, []);
  clubCandidates = [{ id: '10000000-0000-4000-8000-000000000001', username: 'QA Leader', email: 'private@example.invalid', provider_secret: token }];
  const found = await api('GET', route);
  assert.equal(found.status, 200);
  assert.deepEqual(found.data, [{ id: clubCandidates[0].id, username: 'QA Leader' }]);
  assert.equal(observed.at(-1).actor_id, operatorId);
  assert.equal(observed.at(-1).query, 'Leader');
  for (const invalid of [{ items: [] }, [{ id: 'not-a-user', username: 'Invalid' }], [{ id: clubCandidates[0].id, username: null }], Array(21).fill(clubCandidates[0])]) {
    clubCandidates = invalid;
    const rejected = await api('GET', route);
    assert.equal(rejected.status, 502);
    assert.equal(JSON.stringify(rejected.data).includes(token), false);
  }
  clubCandidates = [];
  delete snapshot.supported_actions['club.create'];
});

test('solo un rechazo definitivo en primer intento permite descartar; tras fallo ambiguo conserva la solicitud', async () => {
  async function prepare(id) {
    mode = 'ok'; snapshot.stats = [{ id, match_id: 'match-integration', status: 'pending', version: 1, players: [] }];
    await api('POST', '/operations/integration/sync', {});
    const item = (await api('GET', '/operations/bootstrap')).data.stats.find((s) => s.id === id);
    return (await api('POST', `/operations/stats/${id}/review`, { expected_version: item.version, decision: 'approve', reason: 'Comprobación de lectura de estadísticas' })).data.command;
  }
  const first = await prepare('stat-definitive');
  mode = 'rejected';
  assert.equal((await api('POST', `/operations/integration/commands/${first.id}/send`, {})).status, 422);
  const rejected = (await api('GET', '/operations/bootstrap')).data.commands.find((c) => c.id === first.id);
  assert.equal(rejected.status, 'rejected');
  assert.equal((await api('POST', `/operations/commands/${first.id}/cancel`, { expected_updated_at: rejected.updated_at })).status, 200);
  const second = await prepare('stat-ambiguous');
  mode = 'outage'; await api('POST', `/operations/integration/commands/${second.id}/send`, {});
  mode = 'rejected'; await api('POST', `/operations/integration/commands/${second.id}/send`, {});
  const ambiguous = (await api('GET', '/operations/bootstrap')).data.commands.find((c) => c.id === second.id);
  assert.equal(ambiguous.status, 'failed'); assert.equal(ambiguous.attempts, 2);
  assert.equal((await api('POST', `/operations/commands/${second.id}/cancel`, { expected_updated_at: ambiguous.updated_at })).status, 409);
  mode = 'ok';
});

test('un primer rechazo de autorización permite descartar y proponer otra revisión con un actor independiente', async () => {
  const role = (await api('POST', '/roles', { name: 'REVISOR INDEPENDIENTE AUTHZ', staff_kind: 'referee', sections: ['arbitraje'] })).data;
  const reviewer = (await api('POST', '/users', { username: 'independent-authz', password: 'independent-test-password', role_ids: [role.id] })).data;
  const reviewerCookie = (await api('POST', '/auth/login', { username: 'independent-authz', password: 'independent-test-password' }, '')).cookie;
  assert.ok(reviewerCookie);
  const reviewerActor = (await api('GET', '/operations/bootstrap')).data.staff.find(person => person.id === reviewer.id).integration_actor_id;
  for (const denial of ['unauthenticated', 'forbidden', 'self_review']) {
    mode = 'ok';
    const id = `stat-authz-${denial}`;
    snapshot.stats = [{ id, match_id: 'match-integration', status: 'pending', version: 1, players: [] }];
    assert.equal((await api('POST', '/operations/integration/sync', {})).status, 200);
    let item = (await api('GET', '/operations/bootstrap')).data.stats.find(row => row.id === id);
    const first = await api('POST', `/operations/stats/${id}/review`, { expected_version: item.version, decision: 'approve', reason: 'Revisión que requiere comprobar la independencia' });
    assert.equal(first.status, 200);
    mode = denial;
    const rejectedResponse = await api('POST', `/operations/integration/commands/${first.data.command.id}/send`, {});
    assert.equal(rejectedResponse.status, 502);
    assert.equal(JSON.stringify(rejectedResponse.data).includes(token), false);
    let state = (await api('GET', '/operations/bootstrap')).data;
    const rejected = state.commands.find(row => row.id === first.data.command.id);
    assert.equal(rejected.status, 'rejected'); assert.equal(rejected.attempts, 1);
    assert.equal(rejected.result.rejected_confirmed, true);
    assert.equal(state.stats.find(row => row.id === id).status, 'pending');
    assert.equal((await api('POST', `/operations/commands/${rejected.id}/cancel`, { expected_updated_at: rejected.updated_at })).status, 200);
    state = (await api('GET', '/operations/bootstrap')).data;
    item = state.stats.find(row => row.id === id);
    assert.equal(item.pending_command_id, null);
    const independent = await api('POST', `/operations/stats/${id}/review`, { expected_version: item.version, decision: 'approve', reason: 'Revisión completada por un árbitro independiente' }, reviewerCookie);
    assert.equal(independent.status, 200); assert.notEqual(independent.data.command.id, rejected.id);
    mode = denial === 'self_review' ? 'self_review' : 'ok';
    const confirmed = await api('POST', `/operations/integration/commands/${independent.data.command.id}/send`, {});
    assert.equal(confirmed.status, 200); assert.equal(confirmed.data.confirmed, true);
    assert.equal(observed.at(-1).actor_id, reviewerActor);
    assert.notEqual(observed.at(-1).actor_id, operatorId);
    assert.equal((await api('GET', '/operations/bootstrap')).data.stats.find(row => row.id === id).status, 'approved');
  }
  mode = 'ok';
});

test('un rechazo de autorización tras un intento ambiguo no permite borrar ni sustituir el comando', async () => {
  for (const denial of ['unauthenticated', 'forbidden']) {
    mode = 'ok';
    const id = `stat-ambiguous-${denial}`;
    snapshot.stats = [{ id, match_id: 'match-integration', status: 'pending', version: 1, players: [] }];
    await api('POST', '/operations/integration/sync', {});
    const item = (await api('GET', '/operations/bootstrap')).data.stats.find(row => row.id === id);
    const prepared = (await api('POST', `/operations/stats/${id}/review`, { expected_version: item.version, decision: 'approve', reason: 'Comprobar conservación ante un fallo de conexión' })).data.command;
    mode = 'outage'; assert.equal((await api('POST', `/operations/integration/commands/${prepared.id}/send`, {})).status, 502);
    mode = denial; assert.equal((await api('POST', `/operations/integration/commands/${prepared.id}/send`, {})).status, 502);
    const state = (await api('GET', '/operations/bootstrap')).data;
    const ambiguous = state.commands.find(row => row.id === prepared.id);
    assert.equal(ambiguous.status, 'failed'); assert.equal(ambiguous.attempts, 2);
    assert.equal(ambiguous.result, null);
    assert.equal((await api('POST', `/operations/commands/${prepared.id}/cancel`, { expected_updated_at: ambiguous.updated_at })).status, 409);
    assert.equal((await api('POST', `/operations/stats/${id}/review`, { expected_version: state.stats.find(row => row.id === id).version, decision: 'reject', reason: 'Nueva propuesta que no debe sustituir un intento ambiguo' })).status, 409);
  }
  mode = 'ok';
});

test('la sanción cruza el adaptador con alcance explícito y solo el ACK cambia el borrador a oficial', async () => {
  snapshot.supported_actions['sanction.create'] = true;
  assert.equal((await api('POST', '/operations/integration/sync', {})).status, 200);
  const draft = await api('POST', '/operations/sanctions', { incident_id: 'incident-context', subject_type: 'player', subject_id: '70000000-0000-4000-8000-000000000001',
    reason: 'Evidence reviewed by independent staff', restriction: 'competition_suspend', scopes: ['ranked'],
    starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 86400000).toISOString() });
  assert.equal(draft.status, 200); assert.equal(draft.data.official, false);
  const submitted = await api('POST', `/operations/sanctions/${draft.data.id}/submit`, { expected_version: draft.data.version });
  assert.equal(submitted.status, 200);
  const applied = await api('POST', `/operations/integration/commands/${submitted.data.command.id}/send`, {});
  assert.equal(applied.status, 200);
  const sent = observed.at(-1);
  assert.equal(sent.type, 'sanction.create'); assert.equal(sent.expected_version, 0);
  assert.equal(sent.actor_id, operatorId); assert.deepEqual(sent.payload.scopes, ['ranked']);
  const official = (await api('GET', '/operations/bootstrap')).data.sanctions.find((s) => s.id === draft.data.id);
  assert.equal(official.official, true); assert.equal(official.source, 'ctp'); assert.equal(official.source_version, 1);
});
