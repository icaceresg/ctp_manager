import crypto from 'node:crypto';
import { db } from './db.js';
import { HttpError, describeUser } from './auth.js';

export const OBS_SCENES = ['preview', 'teams', 'map', 'pause', 'result', 'next'];
const LEASE_MS = 30_000;
const CONNECTED_MS = 15_000;
const token = process.env.OBS_AGENT_TOKEN || '';
if (token && (token.length < 32 || /[\r\n]/.test(token))) throw new Error('OBS_AGENT_TOKEN debe tener al menos 32 caracteres.');
const configured = Boolean(token);
const enabled = configured && process.env.OBS_ENABLE_CONTROL === 'true';
const secretHash = crypto.createHash('sha256').update(token).digest();

db.exec(`
  CREATE TABLE IF NOT EXISTS obs_agent_state (
    id INTEGER PRIMARY KEY CHECK(id=1), last_seen INTEGER, last_error TEXT
  );
  INSERT OR IGNORE INTO obs_agent_state(id) VALUES(1);
  CREATE TABLE IF NOT EXISTS obs_commands (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, match_id TEXT NOT NULL,
    scene TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, lease_id TEXT, lease_until INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0, error TEXT, confirmed_scene TEXT
  );
  CREATE INDEX IF NOT EXISTS obs_commands_pending ON obs_commands(status,seq);
`);

function requireProducer(user) {
  if (!user?.is_admin && !user?.sections?.includes('realizacion')) throw new HttpError(403, 'Necesitas permiso de Realización.');
}
function commandView(row) {
  if (!row) return null;
  return { id: row.id, sequence: row.seq, match_id: row.match_id, scene: row.scene, status: row.status,
    created_at: row.created_at, updated_at: row.updated_at, attempts: row.attempts,
    error: row.error, confirmed_scene: row.confirmed_scene };
}
function transactional(work) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function obsStatus(user) {
  requireProducer(user);
  const state = db.prepare('SELECT * FROM obs_agent_state WHERE id=1').get();
  return { configured, enabled, connected: configured && Boolean(state.last_seen) && Date.now() - state.last_seen < CONNECTED_MS,
    last_seen: state.last_seen, last_error: state.last_error,
    commands: db.prepare('SELECT * FROM obs_commands ORDER BY seq DESC LIMIT 30').all().map(commandView) };
}

export function queueObsCommand(user, input) {
  requireProducer(user);
  if (!enabled) throw new HttpError(403, 'El control de OBS está desactivado en el servidor.');
  if (!OBS_SCENES.includes(input?.scene)) throw new HttpError(400, 'Escena no admitida.');
  const match = typeof input?.match_id === 'string' ? db.prepare("SELECT data FROM operation_records WHERE kind='match' AND id=?").get(input.match_id) : null;
  if (!match || JSON.parse(match.data).in_feed === false) {
    throw new HttpError(404, 'Partido no encontrado.');
  }
  return transactional(() => {
    const last = db.prepare('SELECT * FROM obs_commands ORDER BY seq DESC LIMIT 1').get();
    // Repeated taps on the same still-pending action do not create duplicate work.
    if (last && ['pending', 'claimed'].includes(last.status) && last.scene === input.scene && last.match_id === input.match_id) return commandView(last);
    db.prepare("UPDATE obs_commands SET status='superseded',updated_at=? WHERE status='pending'").run(Date.now());
    const id = crypto.randomUUID(), now = Date.now();
    db.prepare('INSERT INTO obs_commands(id,match_id,scene,actor_id,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(id, input.match_id, input.scene, user.id, now, now);
    return commandView(db.prepare('SELECT * FROM obs_commands WHERE id=?').get(id));
  });
}

export function requireObsAgent(req, res, next) {
  if (!configured) return res.status(503).json({ error: 'Agente sin configurar.' });
  const authorization = req.get('authorization') || '';
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const hash = crypto.createHash('sha256').update(supplied).digest();
  if (!supplied || !crypto.timingSafeEqual(hash, secretHash)) return res.status(401).json({ error: 'Agente no autorizado.' });
  next();
}

export function claimObsCommand() {
  return transactional(() => {
    const now = Date.now();
    db.prepare('UPDATE obs_agent_state SET last_seen=? WHERE id=1').run(now);
    if (!enabled) return { enabled: false, command: null };
    // One in-flight action for the OBS instance; a new scene waits for ACK/lease expiry.
    const active = db.prepare("SELECT * FROM obs_commands WHERE status='claimed' AND lease_until>? ORDER BY seq DESC LIMIT 1").get(now);
    if (active) return { enabled: true, command: null };
    const latest = db.prepare("SELECT * FROM obs_commands WHERE status IN ('pending','claimed') ORDER BY seq DESC LIMIT 1").get();
    if (!latest) return { enabled: true, command: null };
    db.prepare("UPDATE obs_commands SET status='superseded',updated_at=? WHERE status IN ('pending','claimed') AND seq<?").run(now, latest.seq);
    const author = db.prepare('SELECT * FROM users WHERE id=?').get(latest.actor_id);
    const permissions = author?.active ? describeUser(author) : null;
    if (!permissions || (!permissions.is_admin && !permissions.sections.includes('realizacion'))) {
      db.prepare("UPDATE obs_commands SET status='failed',error='Permiso del operador revocado.',updated_at=? WHERE id=?").run(now, latest.id);
      return { enabled: true, command: null };
    }
    if (latest.attempts >= 3) {
      db.prepare("UPDATE obs_commands SET status='failed',error='El agente no confirmó tras tres intentos.',updated_at=? WHERE id=?").run(now, latest.id);
      return { enabled: true, command: null };
    }
    const lease = crypto.randomUUID();
    db.prepare("UPDATE obs_commands SET status='claimed',lease_id=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=?")
      .run(lease, now + LEASE_MS, now, latest.id);
    return { enabled: true, command: { id: latest.id, sequence: latest.seq, scene: latest.scene, lease_id: lease, lease_until: now + LEASE_MS } };
  });
}

export function acknowledgeObsCommand(input) {
  if (typeof input?.id !== 'string' || typeof input?.lease_id !== 'string') throw new HttpError(400, 'Confirmación no válida.');
  const now = Date.now();
  const row = db.prepare('SELECT * FROM obs_commands WHERE id=?').get(input.id);
  if (!row || row.lease_id !== input.lease_id) throw new HttpError(409, 'La reserva de esta orden ya no es válida.');
  if (['confirmed', 'failed'].includes(row.status)) return { ok: true, status: row.status };
  if (row.status !== 'claimed' || row.lease_until < now) throw new HttpError(409, 'La reserva de esta orden ha caducado.');
  if (input.ok !== true && input.ok !== false) throw new HttpError(400, 'Falta el resultado de la orden.');
  if (input.ok && input.scene !== row.scene) throw new HttpError(400, 'La escena confirmada no coincide.');
  // The agent sends a code, never raw OBS errors or local paths/passwords.
  const errors = { unavailable: 'OBS no está disponible.', authentication: 'OBS ha rechazado la autenticación.',
    scene_missing: 'La escena configurada no existe en OBS.', timeout: 'OBS no confirmó dentro del plazo.',
    mismatch: 'OBS no confirmó la escena solicitada.', configuration: 'La escena no está configurada en el agente.', unknown: 'No se pudo aplicar la escena.' };
  const error = input.ok ? null : errors[input.error_code] || errors.unknown;
  return transactional(() => {
    db.prepare('UPDATE obs_commands SET status=?,confirmed_scene=?,error=?,updated_at=? WHERE id=?')
      .run(input.ok ? 'confirmed' : 'failed', input.ok ? row.scene : null, error, now, row.id);
    db.prepare('UPDATE obs_agent_state SET last_seen=?,last_error=? WHERE id=1').run(now, error);
    return { ok: true, status: input.ok ? 'confirmed' : 'failed' };
  });
}
