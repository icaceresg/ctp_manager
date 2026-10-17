import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { agentConfig, obsAuthentication, setObsScene } from '../scripts/obs-agent.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-obs-'));
process.env.DATA_DIR = temp; process.env.DB_PATH = ''; process.env.PUBLIC_ORIGIN = '';
process.env.OBS_AGENT_TOKEN = 'obs-test-private-token-01234567890123456789'; process.env.OBS_ENABLE_CONTROL = 'true';
const { db } = await import('../server/db.js');
const { setupAdmin, describeUser } = await import('../server/auth.js');
const { ingestSnapshot } = await import('../server/operations.js');
const { queueObsCommand, claimObsCommand, acknowledgeObsCommand, obsStatus, requireObsAgent } = await import('../server/obs.js');
const adminId = setupAdmin({ username: 'producer', password: 'production-test-password' });
const admin = { id: adminId, is_admin: true, sections: [] };
ingestSnapshot({ matches: [{ id: 'obs-match', title: 'Test', team_a: 'A', team_b: 'B' }] });
after(() => { db.close(); fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

test('la cola OBS exige realizador, partido válido y escenas de la lista cerrada', () => {
  assert.throws(() => queueObsCommand({ id: 2, sections: ['casters'] }, { match_id: 'obs-match', scene: 'map' }), { status: 403 });
  assert.throws(() => queueObsCommand(admin, { match_id: 'missing', scene: 'map' }), { status: 404 });
  assert.throws(() => queueObsCommand(admin, { match_id: 'obs-match', scene: 'StartStream' }), { status: 400 });
  assert.throws(() => obsStatus({ sections: ['casters'] }), { status: 403 });
});

test('órdenes repetidas son idempotentes y nuevas escenas sustituyen pendientes', () => {
  const first = queueObsCommand(admin, { match_id: 'obs-match', scene: 'preview' });
  assert.equal(queueObsCommand(admin, { match_id: 'obs-match', scene: 'preview' }).id, first.id);
  const next = queueObsCommand(admin, { match_id: 'obs-match', scene: 'teams' });
  const leased = claimObsCommand().command;
  assert.equal(leased.id, next.id); assert.equal(leased.scene, 'teams');
  assert.equal(obsStatus(admin).commands.find((c) => c.id === first.id).status, 'superseded');
  const map = queueObsCommand(admin, { match_id: 'obs-match', scene: 'map' });
  assert.equal(claimObsCommand().command, null, 'solo una orden en vuelo');
  assert.throws(() => acknowledgeObsCommand({ id: leased.id, lease_id: 'wrong', ok: true, scene: 'teams' }), { status: 409 });
  assert.throws(() => acknowledgeObsCommand({ ...leased, ok: true, scene: 'wrong' }), { status: 400 });
  acknowledgeObsCommand({ ...leased, ok: true, scene: 'teams' });
  assert.equal(acknowledgeObsCommand({ ...leased, ok: true, scene: 'teams' }).status, 'confirmed');
  const nextLease = claimObsCommand().command;
  assert.equal(nextLease.id, map.id);
  acknowledgeObsCommand({ ...nextLease, ok: false, error_code: 'OBS_SECRET_PASSWORD' });
  const state = obsStatus(admin);
  assert.equal(state.connected, true);
  assert.equal(state.commands[0].status, 'failed');
  assert.equal(JSON.stringify(state).includes('OBS_SECRET_PASSWORD'), false);
  assert.equal(JSON.stringify(state).includes('lease_id'), false);
});

test('reservas caducadas se recuperan sin aceptar ACK de una reserva anterior', () => {
  queueObsCommand(admin, { match_id: 'obs-match', scene: 'pause' });
  const first = claimObsCommand().command;
  db.prepare('UPDATE obs_commands SET lease_until=? WHERE id=?').run(Date.now() - 1, first.id);
  const second = claimObsCommand().command;
  assert.equal(first.id, second.id); assert.notEqual(first.lease_id, second.lease_id);
  assert.throws(() => acknowledgeObsCommand({ ...first, ok: true, scene: 'pause' }), { status: 409 });
  acknowledgeObsCommand({ ...second, ok: true, scene: 'pause' });
});

test('credencial del agente no depende de cookies y revocar al operador bloquea la orden', () => {
  let status;
  const response = { status: (s) => { status = s; return response; }, json: () => {} };
  requireObsAgent({ get: () => 'Bearer wrong' }, response, () => assert.fail('wrong token'));
  assert.equal(status, 401);
  let allowed = false;
  requireObsAgent({ get: () => `Bearer ${process.env.OBS_AGENT_TOKEN}` }, response, () => { allowed = true; });
  assert.equal(allowed, true);
  const command = queueObsCommand(admin, { match_id: 'obs-match', scene: 'result' });
  db.prepare('UPDATE users SET active=0 WHERE id=?').run(adminId);
  assert.equal(claimObsCommand().command, null);
  assert.equal(obsStatus(admin).commands.find((c) => c.id === command.id).status, 'failed');
  db.prepare('UPDATE users SET active=1 WHERE id=?').run(adminId);
});

test('retirar la clasificación staff del rol invalida una orden OBS aún pendiente', () => {
  const roleId = Number(db.prepare("INSERT INTO roles(name,sections,staff_kind,created_at) VALUES('TEST OBS SECURITY','[\"realizacion\"]','production',?)").run(Date.now()).lastInsertRowid);
  const userId = Number(db.prepare("INSERT INTO users(username,name,password_hash,is_admin,active,created_at) VALUES('test-obs-security','Producer','unused',0,1,?)").run(Date.now()).lastInsertRowid);
  db.prepare('INSERT INTO user_roles(user_id,role_id) VALUES(?,?)').run(userId, roleId);
  const user = describeUser(db.prepare('SELECT * FROM users WHERE id=?').get(userId));
  const command = queueObsCommand(user, { match_id: 'obs-match', scene: 'next' });
  db.prepare("UPDATE roles SET staff_kind='' WHERE id=?").run(roleId);
  assert.equal(describeUser(db.prepare('SELECT * FROM users WHERE id=?').get(userId)).sections.includes('realizacion'), false);
  assert.equal(claimObsCommand().command, null);
  assert.equal(db.prepare('SELECT status,error FROM obs_commands WHERE id=?').get(command.id).status, 'failed');
});

test('agente mantiene credenciales locales, origen HTTPS y mapeo cerrado de escenas', () => {
  const env = { CTP_MANAGER_URL: 'https://manager.ctp.test', OBS_AGENT_TOKEN: process.env.OBS_AGENT_TOKEN,
    OBS_SCENES_JSON: JSON.stringify({ preview: 'Previa', teams: 'Equipos', map: 'Mapa', pause: 'Pausa', result: 'Resultado', next: 'Siguiente' }) };
  assert.equal(agentConfig(env).obs, 'ws://127.0.0.1:4455/');
  assert.throws(() => agentConfig({ ...env, CTP_MANAGER_URL: 'http://public.test' }));
  assert.throws(() => agentConfig({ ...env, OBS_WEBSOCKET_URL: 'ws://public.test:4455' }));
  assert.throws(() => agentConfig({ ...env, OBS_SCENES_JSON: '{}' }));
  assert.equal(obsAuthentication('supersecretpassword', 'lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=', '+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY='), '1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=');
});

// Real local WebSocket handshake/framing, isolated OBS protocol fixture.
async function fakeObs({ missing = false, mismatch = false, rejectPassword = false } = {}) {
  const requests = [], sockets = new Set(); let current = 'Previa';
  const server = http.createServer();
  function frame(message, opcode = 1) {
    const body = Buffer.isBuffer(message) ? message : Buffer.from(JSON.stringify(message));
    const header = Buffer.alloc(body.length < 126 ? 2 : 4); header[0] = 0x80 | opcode;
    if (body.length < 126) header[1] = body.length; else { header[1] = 126; header.writeUInt16BE(body.length, 2); }
    return Buffer.concat([header, body]);
  }
  server.on('upgrade', (request, socket) => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    const accept = crypto.createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: obswebsocket.json\r\n\r\n`);
    socket.write(frame({ op: 0, d: { rpcVersion: 1, authentication: { salt: 'salt', challenge: 'challenge' } } }));
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      // A close acknowledgement can arrive after the fixture has ended its side.
      if (socket.writableEnded || socket.destroyed) return;
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 0x0f; let length = buffer[1] & 127, offset = 2;
        if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
        const maskBytes = buffer[1] & 128 ? 4 : 0;
        if (buffer.length < offset + maskBytes + length) return;
        const body = Buffer.from(buffer.subarray(offset + maskBytes, offset + maskBytes + length));
        if (maskBytes) for (let i = 0; i < body.length; i++) body[i] ^= buffer[offset + (i % 4)];
        buffer = buffer.subarray(offset + maskBytes + length);
        if (opcode === 8) { socket.end(frame(Buffer.alloc(0), 8)); return; }
        const message = JSON.parse(body.toString());
        if (message.op === 1) {
          if (rejectPassword || message.d.authentication !== obsAuthentication('secret', 'salt', 'challenge')) {
            const close = Buffer.alloc(2); close.writeUInt16BE(4009); socket.end(frame(close, 8)); return;
          }
          socket.write(frame({ op: 2, d: { negotiatedRpcVersion: 1 } }));
        } else if (message.op === 6) {
          requests.push(message.d.requestType); let data = {};
          if (message.d.requestType === 'GetSceneList') data = { currentProgramSceneName: current, scenes: missing ? [] : [{ sceneName: 'Mapa' }, { sceneName: 'Previa' }] };
          if (message.d.requestType === 'SetCurrentProgramScene' && !mismatch) current = message.d.requestData.sceneName;
          if (message.d.requestType === 'GetCurrentProgramScene') data = { currentProgramSceneName: current };
          socket.write(frame({ op: 7, d: { requestId: message.d.requestId, requestStatus: { result: true, code: 100 }, responseData: data } }));
        }
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { config: { obs: `ws://127.0.0.1:${server.address().port}`, password: 'secret', scenes: { map: 'Mapa', preview: 'Previa' } }, requests,
    close: async () => { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); } };
}

test('OBS v5 autentica, cambia programa y verifica la escena; reintento no repite transición', async () => {
  const obs = await fakeObs();
  try {
    assert.deepEqual(await setObsScene(obs.config, 'map'), { scene: 'map' });
    assert.deepEqual(obs.requests, ['GetSceneList', 'SetCurrentProgramScene', 'GetCurrentProgramScene']);
    await setObsScene(obs.config, 'map');
    assert.equal(obs.requests.filter((r) => r === 'SetCurrentProgramScene').length, 1);
  } finally { await obs.close(); }
});

test('OBS no confirma éxito si falta escena, autenticación o no cambia programa', async () => {
  for (const [options, code] of [[{ missing: true }, 'scene_missing'], [{ rejectPassword: true }, 'authentication'], [{ mismatch: true }, 'mismatch']]) {
    const obs = await fakeObs(options);
    try { await assert.rejects(setObsScene(obs.config, 'map'), { code }); } finally { await obs.close(); }
  }
});
