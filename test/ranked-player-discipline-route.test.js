import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { lobbyFixture, lobbyId } from './fixtures/ranked-lobby.js';
import { sanctionHistoryFixture, HISTORY_PLAYER, HISTORY_OTHER_PLAYER } from './fixtures/sanction-history.js';

// Auth and bridge responses are synthetic and fully intercepted. Only the
// actual Router listens on an ephemeral loopback port; no shared DEV is used.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-ranked-history-route-'));
const origin = 'https://pre.manager.playctp.com';
Object.assign(process.env, { DATA_DIR: directory, DB_PATH: path.join(directory, 'manager.sqlite'), PUBLIC_ORIGIN: origin,
  CTP_AUTH_MODE: 'ctp', CTP_AUTH_URL: 'https://pre.playctp.com', CTP_WEB_ORIGIN: 'https://pre.playctp.com',
  CTP_AUTH_TOKEN_KEY: crypto.randomBytes(32).toString('base64url'),
  CTP_AUTH_ANON_KEY: `e30.${Buffer.from('{"role":"anon","exp":4102444800}').toString('base64url')}.fixture`,
  CTP_OPERATIONS_URL: 'https://pre.playctp.com/functions/v1/manager-operations',
  CTP_OPERATIONS_TOKEN: 'ranked-history-fixture-transport-0123456789',
  CTP_SIGNING_SECRET: 'ranked-history-independent-signature-0123456789', CTP_ENABLE_WRITES: 'false', CTP_SYNC_SECONDS: '0' });
const accounts = Object.fromEntries(['admin', 'referee', 'staffreferee', 'caster'].map((role, index) => [role, {
  ctp_user_id: `10000000-0000-4000-8000-${String(index + 21).padStart(12, '0')}`,
  username: `QA ${role}`, role: role === 'staffreferee' || role === 'caster' ? 'staff' : role,
  ...(['staffreferee', 'caster'].includes(role) ? { staff_kind: role === 'staffreferee' ? 'referee' : 'caster', scopes: ['staff.access'] }
    : { scopes: ['ranked.read', 'ranked.chat'] }),
}]));
const originalFetch = globalThis.fetch, sessions = new Map(), observed = [];
let detail, historyPage, discipline, upstreamFailure;
function resetFixture() {
  detail = lobbyFixture(); detail.can_moderate = true;
  const players = detail.players.map((player, index) => ({ ...player,
    user_id: index === 0 ? HISTORY_PLAYER : `11000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` }));
  historyPage = { items: [{ id: lobbyId, kind: 'match', detail: { id: lobbyId, competition_kind: 'ranked', players } }], next_cursor: null };
  discipline = sanctionHistoryFixture(); discipline.user.username = detail.players[0].username;
  upstreamFailure = null; observed.length = 0;
}
resetFixture();
globalThis.fetch = async (value, init) => {
  const url = new URL(value), body = JSON.parse(init.body);
  if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
    const account = accounts[body.email.split('@')[0]]; assert.ok(account, 'synthetic staff account');
    const token = crypto.randomUUID(); sessions.set(token, account);
    return Response.json({ user: { id: account.ctp_user_id }, access_token: token,
      refresh_token: `fixture:${account.ctp_user_id}`, expires_in: 3600 });
  }
  if (url.pathname === '/rest/v1/rpc/manager_link_own_identity') {
    const account = sessions.get(init.headers.Authorization?.replace('Bearer ', ''));
    assert.ok(account, 'only fixture staff identities are accepted');
    return Response.json({ ...account, actor_id: `ctp:${account.ctp_user_id}` });
  }
  assert.equal(url.pathname, '/functions/v1/manager-operations', 'no additional remote path');
  observed.push(body);
  if (upstreamFailure?.action === body.action) return Response.json({ error: 'private upstream detail' }, { status: upstreamFailure.status });
  if (body.action === 'ranked_lobby_detail') return Response.json({ ok: true, data: detail });
  if (body.action === 'competition') return Response.json({ ok: true, data: historyPage });
  assert.equal(body.action, 'admin_service'); assert.equal(body.service, 'discipline');
  assert.equal(body.payload.action, 'history', 'no sanction, global directory or other write');
  return Response.json({ ok: true, data: discipline });
};
const auth = await import('../server/auth.js');
const { db } = await import('../server/db.js');
const { requestBoundary } = await import('../server/config.js');
const { integrationRouter } = await import('../server/routes/integration.js');
const { getRankedPlayerDiscipline } = await import('../server/integration.js');
const { rankedDisciplineTarget } = await import('../server/ranked-player-discipline.js');
const app = express();
app.use((req, res, next) => { const error = requestBoundary(req); return error ? res.status(403).json({ error }) : next(); });
app.use(express.json()); app.use('/api', integrationRouter);
app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.status ? error.message : 'Error interno.' }));
const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
after(async () => { await new Promise(resolve => server.close(resolve)); globalThis.fetch = originalFetch;
  db.close(); fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5 }); });
const cookies = {};
async function cookie(role) {
  if (!cookies[role]) await auth.loginCtp(`${role}@example.invalid`, 'fixture-password', {
    cookie(name, value) { cookies[role] = `${name}=${value}`; },
  });
  return cookies[role];
}
const route = (slot = 1, query = new URLSearchParams({ username: 'Player 1' }).toString(), id = lobbyId) =>
  `/operations/ranked/lobbies/${id}/players/${slot}/discipline?${query}`;
function api(url, session = '') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: `/api${url}`, method: 'GET',
      headers: { Host: 'pre.manager.playctp.com', Origin: origin, 'Sec-Fetch-Site': 'same-origin', Cookie: session } }, res => {
      let body = ''; res.on('data', part => body += part);
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(body) }));
    }); req.on('error', reject); req.end();
  });
}

test('the exact lobby roster resolves every slot without exposing or globally searching the other accounts', () => {
  resetFixture();
  for (const player of detail.players) {
    assert.equal(rankedDisciplineTarget(detail, historyPage, lobbyId, player.slot, player.username),
      historyPage.items[0].detail.players[player.slot - 1].user_id);
  }
  assert.equal(detail.players[0].user_id, undefined, 'the displayed DTO intentionally has no UUID');
});

test('stale lobby/name/side, ambiguity and incomplete rosters cannot select a different disciplinary subject', () => {
  const conflictCases = [
    () => { detail.players[0].username = 'Changed'; },
    () => { historyPage.items[0].detail.players[0].side = 'b'; },
    () => { historyPage.items[0].detail.players[1].username = 'Player 1'; },
    () => { historyPage.items[0].detail.players.pop(); },
    () => { historyPage.items = []; },
    () => { historyPage.items.push(structuredClone(historyPage.items[0])); },
  ];
  for (const change of conflictCases) { resetFixture(); change(); assert.throws(() => rankedDisciplineTarget(detail, historyPage, lobbyId, 1, 'Player 1'), { status: 409 }); }
  for (const change of [
    () => { historyPage.items[0].detail.players[1].user_id = HISTORY_PLAYER; },
    () => { historyPage.items[0].detail.players[0].user_id = 'display-name'; },
    () => { historyPage.items[0].detail.competition_kind = 'tournament'; },
    () => { historyPage.items[0].detail.id = HISTORY_OTHER_PLAYER; },
  ]) { resetFixture(); change(); assert.throws(() => rankedDisciplineTarget(detail, historyPage, lobbyId, 1, 'Player 1'), { status: 502 }); }
});

test('admin and game referee perform only three scoped reads even when all writes and can_ban are disabled', async () => {
  for (const role of ['admin', 'referee']) {
    const session = await cookie(role); resetFixture(); detail.can_moderate = false;
    const result = await api(route(), session); assert.equal(result.status, 200);
    assert.equal(result.data.user.id, HISTORY_PLAYER);
    assert.deepEqual(result.data.context, { lobby_id: lobbyId, slot: 1, username: 'Player 1' });
    assert.deepEqual(observed.map(call => call.action).sort(), ['admin_service', 'competition', 'ranked_lobby_detail']);
    assert.deepEqual(observed.find(call => call.action === 'competition'), { action: 'competition',
      actor_id: `ctp:${accounts[role].ctp_user_id}`, resource: 'history', target_id: null,
      filters: { kind: 'match', query: lobbyId, limit: 100 } });
    assert.deepEqual(observed.at(-1), { action: 'admin_service', actor_id: `ctp:${accounts[role].ctp_user_id}`,
      service: 'discipline', payload: { action: 'history', user_id: HISTORY_PLAYER } });
    assert.equal(JSON.stringify(result.data).includes(HISTORY_OTHER_PLAYER), false);
  }
});

test('anonymous, caster and organisational referee access cannot query game-player history', async () => {
  resetFixture(); assert.equal((await api(route())).status, 401);
  for (const role of ['caster', 'staffreferee']) assert.equal((await api(route(), await cookie(role))).status, 403);
  assert.equal(observed.length, 0);
  await assert.rejects(getRankedPlayerDiscipline({ id: 99, auth_mode: 'ctp', ctp_role: 'referee',
    ctp_user_id: HISTORY_PLAYER, is_admin: false, sections: [] }, lobbyId, '1', { username: 'Player 1' }), { status: 403 });
  assert.equal(observed.length, 0);
});

test('invalid slot/name/query/lobby input is rejected before reading any CTP data', async () => {
  const session = await cookie('referee');
  for (const url of [route(0), route(9), route('01'), route('1.0'), route(1, ''),
    route(1, 'username=Player+1&user_id=' + HISTORY_OTHER_PLAYER), route(1, 'username=A&username=B'),
    route(1, 'username=' + 'a'.repeat(101)), route(1, 'username=A%00B'), route(1, 'username=Player+1', 'wrong-id')]) {
    resetFixture(); assert.equal((await api(url, session)).status, 400, url); assert.equal(observed.length, 0);
  }
});

test('identity conflict stops before disciplinary history and malformed upstream rosters fail closed', async () => {
  const session = await cookie('referee');
  for (const [mutate, status] of [
    [() => { historyPage.items[0].detail.players[0].username = 'Changed'; }, 409],
    [() => { historyPage.items[0].detail.players[1].user_id = HISTORY_PLAYER; }, 502],
  ]) {
    resetFixture(); mutate(); assert.equal((await api(route(), session)).status, status);
    assert.equal(observed.length, 2); assert.equal(observed.some(call => call.service === 'discipline'), false);
  }
});

test('the final native account history must still match both UUID and the displayed name', async () => {
  const session = await cookie('referee');
  for (const [mutate, status] of [
    [() => { discipline.user.username = 'Renamed'; }, 409],
    [() => { discipline.user.id = HISTORY_OTHER_PLAYER; }, 502],
  ]) { resetFixture(); mutate(); assert.equal((await api(route(), session)).status, status); assert.equal(observed.length, 3); }
});

test('bridge permission and service failures remain explicit and never masquerade as no prior sanctions', async () => {
  const session = await cookie('referee');
  for (const [action, status, expected] of [['ranked_lobby_detail', 403, 403], ['admin_service', 503, 502]]) {
    resetFixture(); upstreamFailure = { action, status };
    const response = await api(route(), session); assert.equal(response.status, expected);
    assert.equal(response.data.items, undefined); assert.doesNotMatch(response.data.error, /private upstream/);
    assert.equal(observed.filter(call => call.action === action).length, 1, 'no automatic retry');
  }
});
