import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';

const SCENES = ['preview', 'teams', 'map', 'pause', 'result', 'next'];
function error(code) { const value = new Error(code); value.code = code; return value; }

export function agentConfig(env = process.env) {
  let manager, obs;
  try { manager = new URL(env.CTP_MANAGER_URL); obs = new URL(env.OBS_WEBSOCKET_URL || 'ws://127.0.0.1:4455'); } catch { throw error('configuration'); }
  const local = (url) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((manager.protocol !== 'https:' && !(manager.protocol === 'http:' && local(manager))) || manager.username || manager.password || manager.search || manager.hash || manager.pathname !== '/') throw error('configuration');
  if (!['ws:', 'wss:'].includes(obs.protocol) || !local(obs) || obs.username || obs.password || obs.search || obs.hash || obs.pathname !== '/') throw error('configuration');
  if (!env.OBS_AGENT_TOKEN || env.OBS_AGENT_TOKEN.length < 32 || /[\r\n]/.test(env.OBS_AGENT_TOKEN)) throw error('configuration');
  let scenes;
  try { scenes = JSON.parse(env.OBS_SCENES_JSON || '{}'); } catch { throw error('configuration'); }
  if (!scenes || Array.isArray(scenes) || SCENES.some((key) => typeof scenes[key] !== 'string' || !scenes[key].trim() || scenes[key].length > 200)) throw error('configuration');
  return { manager: manager.origin, token: env.OBS_AGENT_TOKEN, obs: obs.href, password: env.OBS_WEBSOCKET_PASSWORD || '',
    scenes: Object.fromEntries(SCENES.map((key) => [key, scenes[key]])) };
}

export function obsAuthentication(password, salt, challenge) {
  const secret = crypto.createHash('sha256').update(password + salt).digest('base64');
  return crypto.createHash('sha256').update(secret + challenge).digest('base64');
}

/** OBS WebSocket v5: authenticate, validate scene, apply and read back program scene. */
export function setObsScene(config, key, { WebSocketImpl = WebSocket, timeoutMs = 6000 } = {}) {
  if (!SCENES.includes(key) || !config.scenes[key]) return Promise.reject(error('configuration'));
  return new Promise((resolve, reject) => {
    let ws, settled = false, identified = false, helloSeen = false, requestId, stage;
    const target = config.scenes[key];
    const timer = setTimeout(() => finish(error('timeout')), timeoutMs);
    function finish(failure) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      try { ws?.close(); } catch {}
      if (failure) reject(failure); else resolve({ scene: key });
    }
    function request(type, data = {}) {
      requestId = crypto.randomUUID(); stage = type;
      ws.send(JSON.stringify({ op: 6, d: { requestType: type, requestId, requestData: data } }));
    }
    try { ws = new WebSocketImpl(config.obs, 'obswebsocket.json'); } catch { finish(error('unavailable')); return; }
    ws.addEventListener('error', () => finish(error('unavailable')));
    ws.addEventListener('close', (event) => finish(error(event.code === 4009 ? 'authentication' : event.code === 4011 ? 'session_invalidated' : 'unavailable')));
    ws.addEventListener('message', (event) => {
      if (settled) return;
      try {
        if (typeof event.data !== 'string' || event.data.length > 1024 * 1024) throw error('unknown');
        const message = JSON.parse(event.data);
        if (message.op === 0) {
          if (helloSeen) throw error('unknown');
          helloSeen = true;
          const d = { rpcVersion: 1, eventSubscriptions: 0 };
          if (message.d?.authentication) {
            const { salt, challenge } = message.d.authentication;
            if (typeof salt !== 'string' || typeof challenge !== 'string' || !config.password) throw error('authentication');
            d.authentication = obsAuthentication(config.password, salt, challenge);
          }
          ws.send(JSON.stringify({ op: 1, d }));
        } else if (message.op === 2 && helloSeen && !identified) {
          identified = true; request('GetSceneList');
        } else if (message.op === 7 && identified && message.d?.requestId === requestId) {
          if (message.d.requestStatus?.result !== true) throw error('unknown');
          const data = message.d.responseData || {};
          if (stage === 'GetSceneList') {
            if (!Array.isArray(data.scenes) || !data.scenes.some((scene) => scene.sceneName === target)) throw error('scene_missing');
            // Idempotent recovery: an already-applied scene needs no repeated transition.
            if (data.currentProgramSceneName === target) finish();
            else request('SetCurrentProgramScene', { sceneName: target });
          } else if (stage === 'SetCurrentProgramScene') request('GetCurrentProgramScene');
          else if (stage === 'GetCurrentProgramScene') {
            if ((data.currentProgramSceneName || data.sceneName) !== target) throw error('mismatch');
            finish();
          }
        }
      } catch (failure) { finish(error(failure.code || 'unknown')); }
    });
  });
}

async function managerRequest(config, route, body) {
  const response = await fetch(`${config.manager}/api/agent/obs/${route}`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) { await response.body?.cancel(); throw error(response.status === 401 ? 'agent_authentication' : 'manager_unavailable'); }
  if (!/^application\/json\b/i.test(response.headers.get('content-type') || '')) { await response.body?.cancel(); throw error('manager_unavailable'); }
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 65536) { await reader.cancel(); throw error('manager_unavailable'); }
    chunks.push(Buffer.from(value));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function runAgent(config, signal) {
  let failures = 0;
  while (!signal.aborted) {
    try {
      const response = await managerRequest(config, 'claim', {});
      const command = response.command;
      if (command) {
        if (typeof command.id !== 'string' || typeof command.lease_id !== 'string' || !SCENES.includes(command.scene) || command.lease_until < Date.now() + 7000) throw error('manager_unavailable');
        let result;
        try { result = { ok: true, ...(await setObsScene(config, command.scene)) }; }
        catch (failure) {
          result = { ok: false, error_code: failure.code || 'unknown' };
          await managerRequest(config, 'ack', { id: command.id, lease_id: command.lease_id, ...result });
          if (failure.code === 'session_invalidated') throw failure;
        }
        if (result.ok) await managerRequest(config, 'ack', { id: command.id, lease_id: command.lease_id, ...result });
      }
      failures = 0;
    } catch (failure) {
      if (['session_invalidated', 'agent_authentication'].includes(failure.code)) throw failure;
      failures++;
      // Avoid logging tokens, remote bodies, OBS passwords, scene filenames or URLs.
      if (failures === 1) console.error('Conexión con Manager interrumpida; se reintentará.');
    }
    try { await pause(Math.min(10000, 2000 * Math.max(1, failures)), undefined, { signal }); } catch { break; }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile(path.resolve('.env.obs-agent')); } catch {}
  const controller = new AbortController();
  process.on('SIGINT', () => controller.abort()); process.on('SIGTERM', () => controller.abort());
  try {
    const config = agentConfig();
    console.log('Agente OBS preparado. Ctrl+C para detenerlo.');
    await runAgent(config, controller.signal);
  } catch (failure) {
    console.error(failure.code === 'session_invalidated' ? 'OBS ha revocado la sesión. Revisa el acceso antes de reiniciar el agente.' : 'El agente se ha detenido. Revisa configuración y permisos.');
    process.exitCode = 1;
  }
}
