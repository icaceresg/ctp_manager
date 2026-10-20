// Ruleta de PlayCTP (ruleta.playctp.com): sortea a una de las personas
// registradas en CTP. El ganador lo elige siempre el servidor con un generador
// criptográfico; el navegador solo lo anima. Cada sorteo queda guardado.
//
// Fuente de participantes:
//  - Con el puente CTP configurado: usuarios registrados en CTP. La lista solo
//    la puede recargar un administrador CTP (es lo que permite el puente) y se
//    guarda aquí, así el resto del staff puede sortear con la última copia.
//  - Sin puente (desarrollo local): los usuarios activos del propio Manager.
import crypto from 'node:crypto';
import { db, tx } from './db.js';
import { HttpError } from './auth.js';
import { ctpBridgeConfigured, getRegisteredPlayers } from './integration.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS ruleta_people (
    ctp_id TEXT PRIMARY KEY,
    name   TEXT NOT NULL,
    role   TEXT NOT NULL DEFAULT 'player'
  );
  CREATE TABLE IF NOT EXISTS ruleta_draws (
    id           INTEGER PRIMARY KEY,
    winner_key   TEXT NOT NULL,
    winner_name  TEXT NOT NULL,
    participants INTEGER NOT NULL,
    source       TEXT NOT NULL,
    drawn_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   INTEGER NOT NULL
  );
`);

const REFRESH_MS = 10 * 60 * 1000;
const setting = (key) => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value ?? null;
const saveSetting = (key, value) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
const byName = (a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
let refreshing = null;

function localPeople() {
  return db
    .prepare('SELECT id, username, name FROM users WHERE active = 1')
    .all()
    .map((u) => ({ key: `m${u.id}`, name: (u.name || '').trim() || u.username, role: 'staff' }))
    .sort(byName);
}

function cachedPeople() {
  return db.prepare('SELECT ctp_id, name, role FROM ruleta_people').all().map((p) => ({ key: p.ctp_id, name: p.name, role: p.role })).sort(byName);
}

async function refreshFromCtp(user) {
  refreshing ||= getRegisteredPlayers(user)
    .then(({ people, total, truncated }) => {
      tx(() => {
        db.prepare('DELETE FROM ruleta_people').run();
        const insert = db.prepare('INSERT INTO ruleta_people(ctp_id,name,role) VALUES(?,?,?)');
        for (const p of people) insert.run(p.ctp_id, p.name, p.role);
        saveSetting('ruleta_refreshed_at', Date.now());
        saveSetting('ruleta_total', total);
        saveSetting('ruleta_truncated', truncated ? 1 : 0);
      });
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** Lista de participantes. `force` recarga desde CTP (solo administradores). */
export async function listParticipants(user, { force = false } = {}) {
  if (!ctpBridgeConfigured()) {
    return { source: 'manager', people: localPeople(), refreshed_at: Date.now(), can_refresh: false, truncated: false };
  }
  const refreshedAt = Number(setting('ruleta_refreshed_at')) || 0;
  let warning = null;
  if (user.is_admin && (force || Date.now() - refreshedAt > REFRESH_MS)) {
    try {
      await refreshFromCtp(user);
    } catch (error) {
      // Una caída de CTP no borra la última lista buena; se avisa y se sigue.
      if (force || !refreshedAt) throw error instanceof HttpError ? error : new HttpError(503, 'No se pudo cargar la lista de CTP.');
      warning = 'No se pudo actualizar desde CTP; se usa la última lista guardada.';
    }
  }
  const people = cachedPeople();
  if (!people.length) {
    throw new HttpError(409, user.is_admin
      ? 'CTP no ha devuelto ninguna persona registrada.'
      : 'Aún no hay lista de jugadores. Un administrador de CTP tiene que abrir la ruleta una vez para cargarla.');
  }
  return {
    source: 'ctp',
    people,
    refreshed_at: Number(setting('ruleta_refreshed_at')) || null,
    total: Number(setting('ruleta_total')) || people.length,
    truncated: setting('ruleta_truncated') === '1',
    can_refresh: Boolean(user.is_admin),
    warning,
  };
}

/** Sorteo. `excluded` son las claves desmarcadas en el panel de participantes. */
export async function draw(user, body = {}) {
  const excluded = body.excluded ?? [];
  if (!Array.isArray(excluded) || excluded.length > 20000 || excluded.some((k) => typeof k !== 'string' || k.length > 64)) {
    throw new HttpError(400, 'Lista de exclusiones no válida.');
  }
  const { people, source } = await listParticipants(user);
  const skip = new Set(excluded);
  const pool = people.filter((p) => !skip.has(p.key));
  if (!pool.length) throw new HttpError(400, 'No hay nadie en el sorteo. Elige al menos a una persona.');
  const winner = pool[crypto.randomInt(pool.length)];
  const createdAt = Date.now();
  const { lastInsertRowid } = db
    .prepare('INSERT INTO ruleta_draws(winner_key,winner_name,participants,source,drawn_by,created_at) VALUES(?,?,?,?,?,?)')
    .run(winner.key, winner.name, pool.length, source, user.id, createdAt);
  // Para la animación basta con una muestra: nombres de relleno + el ganador.
  const sample = pool.length <= 400 ? pool : [winner, ...Array.from({ length: 399 }, () => pool[crypto.randomInt(pool.length)])];
  const unique = [...new Map(sample.map((p) => [p.key, p])).values()];
  return { id: Number(lastInsertRowid), winner, participants: unique, participant_count: pool.length, created_at: createdAt };
}

export function listDraws(limit = 15) {
  return db
    .prepare(
      `SELECT d.id, d.winner_key, d.winner_name, d.participants, d.source, d.created_at, u.name AS drawn_by
         FROM ruleta_draws d LEFT JOIN users u ON u.id = d.drawn_by
        ORDER BY d.id DESC LIMIT ?`,
    )
    .all(limit)
    .map((d) => ({
      id: d.id,
      winner: { key: d.winner_key, name: d.winner_name },
      participant_count: d.participants,
      source: d.source,
      drawn_by: d.drawn_by || null,
      created_at: d.created_at,
    }));
}
