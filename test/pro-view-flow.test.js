import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-pro-view-flow-'));
const token = 'pro-view-test-isolated-token-0123456789', secret = 'pro-view-test-isolated-signature-0123456789';
const matchId = randomUUID(), roomId = randomUUID();
let state = { revision: 0, channel: 'playctp', delaySeconds: 30, productionDelaySeconds: 0, matchId: null, roomId: null, enabled: false, status: 'standby', lastErrorCode: null, publicPreview: null,
  matches: [{ id: matchId, title: 'QA North vs QA South', scheduledAt: '2026-10-19T18:00:00Z', status: 'pending' }], rooms: [{ id: roomId, matchId, label: 'QA production room', status: 'active', expiresAt: '2099-01-01T00:00:00Z', key: 'must-not-reach-browser' }], token: 'must-not-reach-browser' };
const received = [], applied = new Map();
let mode = 'ok', bridge, manager, port, adminCookie, producerCookie, otherProducerCookie, refereeCookie, producerId, producerRole, producerActor;

async function api(method, route, body, cookie = adminCookie, extra = {}) {
  const response = await fetch(`http://localhost:${port}/api${route}`, { method, headers: { Cookie: cookie || '', 'Content-Type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function proposal(payload, cookie = producerCookie, revision = state.revision) {
  return api('POST', '/operations/pro-view/commands', { expected_version: revision, payload }, cookie);
}
const selected = () => ({ channel: 'playctp', delaySeconds: 30, productionDelaySeconds: 10, matchId, roomId, enabled: true, status: 'live' });
async function send(command, cookie = producerCookie) { return api('POST', `/operations/pro-view/commands/${command.id}/send`, {}, cookie); }

before(async () => {
  bridge = http.createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw); received.push(body);
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    assert.ok(request.headers['x-ctp-signature']);
    response.setHeader('Content-Type', 'application/json');
    let data;
    if (body.action === 'snapshot') data = { matches: [{ id: matchId, title: 'QA fixture', kind: 'tournament' }], incidents: [], stats: [], clubs: [], deliveries: [], supported_actions: { 'pro_view.configure': true } };
    else if (body.action === 'pro_view_state') data = state;
    else if (body.action === 'pro_view_configure') {
      assert.deepEqual(Object.keys(body).sort(), ['action', 'actor_id', 'commandId', 'expectedRevision', 'settings']);
      if (applied.has(body.commandId)) data = applied.get(body.commandId);
      else if (mode === 'conflict' || body.expectedRevision !== state.revision) { response.statusCode = 409; response.end(JSON.stringify({ ok: false })); return; }
      else {
        state = { ...state, ...body.settings, revision: state.revision + 1 };
        data = { applied: true, commandId: body.commandId, revision: state.revision }; applied.set(body.commandId, data);
        if (mode === 'lostAck') { response.statusCode = 503; response.end(JSON.stringify({ ok: false })); return; }
      }
    } else throw new Error('Unexpected bridge action');
    response.end(JSON.stringify({ ok: true, data }));
  });
  await new Promise(resolve => bridge.listen(0, '127.0.0.1', resolve));
  const reserve = net.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve)); port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  manager = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: temporary, DB_PATH: '', PUBLIC_ORIGIN: '', OPEN_BROWSER: '0', CTP_AUTH_MODE: 'local', CTP_OPERATIONS_URL: `http://127.0.0.1:${bridge.address().port}/bridge`, CTP_OPERATIONS_TOKEN: token, CTP_SIGNING_SECRET: secret, CTP_ALLOW_LOCAL_WRITES: 'true', CTP_ENABLE_WRITES: 'true', CTP_SYNC_SECONDS: '0', OBS_ENABLE_CONTROL: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; manager.stdout.on('data', chunk => { output += chunk; }); manager.stderr.on('data', chunk => { output += chunk; });
  const until = Date.now() + 15000;
  while (!output.includes('funcionando')) { if (manager.exitCode !== null || Date.now() > until) throw new Error(output || 'Manager startup failed'); await new Promise(resolve => setTimeout(resolve, 40)); }
  const admin = await api('POST', '/auth/setup', { username: 'pro-view-admin', password: randomUUID() }); assert.equal(admin.status, 200); adminCookie = admin.cookie;
  async function account(name, section, kind) {
    const role = await api('POST', '/roles', { name, staff_kind: kind, sections: [section] }); assert.equal(role.status, 201);
    const password = randomUUID(); const user = await api('POST', '/users', { username: name, password, role_ids: [role.data.id] }); assert.equal(user.status, 201);
    const login = await api('POST', '/auth/login', { username: name, password }, ''); assert.equal(login.status, 200);
    return { id: user.data.id, cookie: login.cookie, role: role.data.id };
  }
  const producer = await account('pro-view-producer', 'realizacion', 'production'); producerCookie = producer.cookie; producerId = producer.id; producerRole = producer.role;
  otherProducerCookie = (await account('pro-view-producer-two', 'realizacion', 'production')).cookie;
  refereeCookie = (await account('pro-view-referee', 'arbitraje', 'referee')).cookie;
  assert.equal((await api('POST', '/operations/integration/sync', {})).status, 200);
  producerActor = (await api('GET', '/operations/bootstrap')).data.staff.find(item => item.id === producerId).integration_actor_id;
});
after(async () => {
  if (manager?.exitCode === null && !manager.signalCode) await new Promise(resolve => { manager.once('exit', resolve); manager.kill(); });
  if (bridge?.listening) await new Promise(resolve => bridge.close(resolve));
  assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('only production staff can read the closed editor and cross-site requests fail before CTP', async () => {
  const before = received.length;
  assert.equal((await api('GET', '/operations/pro-view', undefined, '')).status, 401);
  assert.equal((await api('GET', '/operations/pro-view', undefined, refereeCookie)).status, 403);
  assert.equal((await api('POST', '/operations/pro-view/commands', {}, producerCookie, { Origin: 'https://untrusted.invalid' })).status, 403);
  assert.equal(received.length, before);
  const result = await api('GET', '/operations/pro-view', undefined, producerCookie); assert.equal(result.status, 200); assert.equal(result.data.revision, 0);
  assert.equal(JSON.stringify(result.data).includes('must-not-reach-browser'), false);
  assert.equal(received.at(-1).actor_id, producerActor);
  const revision = (await api('GET', '/operations/bootstrap?view=realizacion')).data.revision;
  assert.equal((await api('GET', '/operations/pro-view', undefined, producerCookie)).status, 200);
  assert.equal((await api('GET', '/operations/bootstrap?view=realizacion')).data.revision, revision, 'unchanged polling does not invalidate unrelated pagination');
});
test('prepare validates source CAS, rejects forged actor and foreign room, and never publishes', async () => {
  assert.equal((await proposal(selected(), producerCookie, 20)).status, 409);
  assert.equal((await api('POST', '/operations/pro-view/commands', { expected_version: state.revision, payload: selected(), actor_id: 'forged' }, producerCookie)).status, 400);
  assert.equal((await proposal({ ...selected(), roomId: randomUUID() })).status, 400);
  const count = received.filter(item => item.action === 'pro_view_configure').length;
  const prepared = await proposal(selected()); assert.equal(prepared.status, 200, JSON.stringify(prepared.data));
  const command = prepared.data.command; assert.equal(command.actor_id, producerId); assert.equal(command.expected_version, 0); assert.equal(command.status, 'pending');
  assert.equal(received.filter(item => item.action === 'pro_view_configure').length, count);
  assert.equal((await proposal(selected())).data.command.id, command.id, 'same-author preparation is idempotent');
  assert.equal((await send(command, otherProducerCookie)).status, 403);
  assert.equal((await api('POST', `/operations/integration/commands/${command.id}/send`, {}, producerCookie)).status, 403);
  const sent = await send(command); assert.equal(sent.status, 200, JSON.stringify(sent.data)); assert.equal(sent.data.confirmed, true);
  assert.equal(state.revision, 1); assert.equal(state.status, 'live'); assert.equal(received.at(-1).actor_id, producerActor);
  assert.equal((await send(command)).status, 409);
});
test('lost acknowledgement retries the same command after source CAS advances, applying only once', async () => {
  const prepared = await proposal({ ...selected(), status: 'paused' }); assert.equal(prepared.status, 200); const command = prepared.data.command;
  const before = applied.size; mode = 'lostAck'; assert.equal((await send(command)).status, 502); assert.equal(applied.size, before + 1); assert.equal(state.revision, 2);
  const current = await api('GET', '/operations/pro-view', undefined, producerCookie); assert.equal(current.data.commands.find(item => item.id === command.id).status, 'failed');
  assert.equal((await api('POST', `/operations/commands/${command.id}/cancel`, { expected_updated_at: current.data.commands[0].updated_at }, producerCookie)).status, 409, 'ambiguous delivery cannot be discarded');
  mode = 'ok'; const retried = await send(command); assert.equal(retried.status, 200, JSON.stringify(retried.data)); assert.equal(applied.size, before + 1);
  const attempts = received.filter(item => item.action === 'pro_view_configure' && item.commandId === command.idempotency_key);
  assert.equal(attempts.length, 2); assert.equal(attempts[0].expectedRevision, attempts[1].expectedRevision); assert.equal(state.revision, 2);
});
test('a definitive first conflict can be discarded; a revoked producer cannot be forwarded by admin', async () => {
  mode = 'conflict'; const first = await proposal({ ...selected(), status: 'ended', enabled: false }); const rejected = first.data.command;
  assert.equal((await send(rejected)).status, 409);
  const current = (await api('GET', '/operations/pro-view', undefined, producerCookie)).data.commands.find(item => item.id === rejected.id);
  assert.equal(current.status, 'rejected'); assert.equal(current.result.rejected_confirmed, true);
  assert.equal((await api('POST', `/operations/commands/${current.id}/cancel`, { expected_updated_at: current.updated_at }, producerCookie)).status, 200);
  mode = 'ok'; const next = await proposal({ ...selected(), status: 'ended', enabled: false }); assert.equal(next.status, 200); const command = next.data.command;
  assert.equal((await api('PATCH', `/users/${producerId}`, { role_ids: [] })).status, 200);
  const before = received.filter(item => item.action === 'pro_view_configure').length;
  assert.equal((await send(command)).status, 401, 'changing roles invalidates the producer session');
  assert.equal((await send(command, adminCookie)).status, 403);
  assert.equal(received.filter(item => item.action === 'pro_view_configure').length, before);
  assert.equal((await api('PATCH', `/users/${producerId}`, { role_ids: [producerRole] })).status, 200);
  assert.equal((await send(command, adminCookie)).status, 200, 'restored production authority forwards the original author');
});
