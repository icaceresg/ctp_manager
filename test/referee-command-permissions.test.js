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
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-referee-command-'));
const token = 'isolated-referee-command-token-0123456789';
const secret = 'isolated-referee-command-signature-0123456789';
const matchId = randomUUID();
const players = Array.from({ length: 8 }, (_, index) => ({
  id: randomUUID(), username: `Referee test player ${index + 1}`, side: index < 4 ? 'a' : 'b',
  kills: 10, deaths: 5, assists: 2, score: 1000, objective: null,
}));
const statistics = [randomUUID(), randomUUID()].map(id => ({
  id, match_id: matchId, status: 'pending', version: 1, revision: 1, players,
}));
const snapshot = {
  matches: [{ id: matchId, kind: 'tournament', roster: players }], incidents: [], stats: statistics,
  clubs: [], deliveries: [], supported_actions: { 'stats.correct': true },
};
const commands = [];
let bridge, manager, port, adminCookie, refereeCookie, refereeId, refereeActor;

async function api(method, route, body, cookie = adminCookie) {
  const response = await fetch(`http://localhost:${port}/api${route}`, {
    method, headers: { Cookie: cookie || '', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

before(async () => {
  bridge = http.createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    assert.ok(request.headers['x-ctp-signature']);
    if (body.action === 'command') commands.push(body);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ ok: true, data: body.action === 'snapshot' ? snapshot : {
      applied: true, command_id: body.command_id, type: body.type, target_id: body.target_id,
      revision_id: randomUUID(), source_version: 2,
    } }));
  });
  await new Promise(resolve => bridge.listen(0, '127.0.0.1', resolve));
  const reserve = net.createServer();
  await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  manager = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: root, env: {
      ...process.env, PORT: String(port), DATA_DIR: temporary, DB_PATH: '', PUBLIC_ORIGIN: '', OPEN_BROWSER: '0',
      CTP_AUTH_MODE: 'local', CTP_OPERATIONS_URL: `http://127.0.0.1:${bridge.address().port}/bridge`,
      CTP_OPERATIONS_TOKEN: token, CTP_SIGNING_SECRET: secret, CTP_ALLOW_LOCAL_WRITES: 'true',
      CTP_ENABLE_WRITES: 'true', CTP_SYNC_SECONDS: '0', OBS_ENABLE_CONTROL: 'false',
    }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  manager.stdout.on('data', chunk => { output += chunk; });
  manager.stderr.on('data', chunk => { output += chunk; });
  const until = Date.now() + 10_000;
  while (!output.includes('funcionando')) {
    if (manager.exitCode !== null || Date.now() > until) throw new Error(output || 'Manager startup failed');
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  const admin = await api('POST', '/auth/setup', { username: 'referee-test-admin', password: randomUUID() });
  assert.equal(admin.status, 200); adminCookie = admin.cookie;
  const role = await api('POST', '/roles', { name: 'Independent referee correction', staff_kind: 'referee', sections: ['arbitraje'] });
  assert.equal(role.status, 201);
  const password = randomUUID();
  const referee = await api('POST', '/users', { username: 'referee-test-author', password, role_ids: [role.data.id] });
  assert.equal(referee.status, 201); refereeId = referee.data.id;
  const login = await api('POST', '/auth/login', { username: 'referee-test-author', password }, '');
  assert.equal(login.status, 200); refereeCookie = login.cookie;
  assert.equal((await api('POST', '/operations/integration/sync', {})).status, 200);
  const bootstrap = (await api('GET', '/operations/bootstrap')).data;
  refereeActor = bootstrap.staff.find(person => person.id === refereeId).integration_actor_id;
  assert.ok(refereeActor);
});

after(async () => {
  if (manager?.exitCode === null && !manager.signalCode) await new Promise(resolve => { manager.once('exit', resolve); manager.kill(); });
  if (bridge?.listening) await new Promise(resolve => bridge.close(resolve));
  const resolved = path.resolve(temporary);
  assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function prepare(statisticId) {
  const own = (await api('GET', '/me', undefined, refereeCookie)).data;
  assert.deepEqual(own.sections, ['arbitraje']);
  assert.equal(own.is_admin, false);
  const statistic = (await api('GET', '/operations/bootstrap', undefined, refereeCookie)).data.stats.find(row => row.id === statisticId);
  const result = await api('POST', `/operations/stats/${statisticId}/correct`, {
    expected_version: statistic.version, reason: 'Correction independently checked against the original scoreboard',
    players: players.map((player, index) => ({ user_id: player.id, kills: index === 0 ? 11 : 10, deaths: 5, assists: 2, score: 1000, objective: null })),
  }, refereeCookie);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data.command;
}

test('an arbitration-only author can prepare a correction and an administrator sends it using that author', async () => {
  const command = await prepare(statistics[0].id);
  assert.equal(commands.length, 0, 'Preparing must not write to CTP');
  assert.equal((await api('POST', `/operations/integration/commands/${command.id}/send`, {}, refereeCookie)).status, 403);
  assert.equal(commands.length, 0, 'A referee cannot bypass the admin send step');
  const sent = await api('POST', `/operations/integration/commands/${command.id}/send`, { actor_id: 'forged-admin' });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  assert.equal(sent.data.confirmed, true);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].type, 'stats.correct');
  assert.equal(commands[0].actor_id, refereeActor);
  assert.equal(commands[0].command_id, command.idempotency_key);
  assert.equal(commands[0].payload.players[0].kills, 11);
  const saved = (await api('GET', '/operations/bootstrap')).data.commands.find(row => row.id === command.id);
  assert.equal(saved.status, 'acknowledged');
});

test('removing the arbitration permission after preparation blocks the administrator from forwarding it', async () => {
  const command = await prepare(statistics[1].id);
  assert.equal((await api('PATCH', `/users/${refereeId}`, { role_ids: [] })).status, 200);
  const count = commands.length;
  const sent = await api('POST', `/operations/integration/commands/${command.id}/send`, {});
  assert.equal(sent.status, 403);
  assert.equal(commands.length, count, 'Revoked authority must not reach the CTP gateway');
});
