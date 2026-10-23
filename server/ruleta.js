// Ruleta de PlayCTP (ruleta.playctp.com): sortea a una de las personas
// registradas en CTP. El ganador lo elige siempre el servidor con un generador
// criptográfico; el navegador solo lo anima. Cada sorteo queda guardado.
//
// Fuente de participantes:
//  - Con el puente CTP configurado: usuarios registrados en CTP. La lista solo
//    la puede recargar un administrador CTP (es lo que permite el puente) y se
//    guarda aquí, así el resto del staff puede sortear con la última copia.
//    Quién sale como staff se calcula en cada lectura con el mismo criterio de
//    acceso a Manager: rol CTP o permiso de la página de staff (que se apunta
//    aquí en cuanto se cambia), salvo que Manager desactive a la persona o le
//    quite todos sus roles.
//  - Sin puente (desarrollo local): los usuarios activos del propio Manager.
import crypto from 'node:crypto';
import { db, tx } from './db.js';
import { HttpError } from './auth.js';
import { ctpBridgeConfigured, getRegisteredPlayers } from './integration.js';
import { ruletaPerson } from './ruleta-contract.js';
import { STAFF_KINDS } from '../shared/access.js';

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
// Las copias anteriores solo guardaban el rol CTP: se añaden los datos de
// acceso a Manager y se fuerza una recarga para no seguir con la lista antigua.
for (const [column, definition] of [['staff_kind', "TEXT NOT NULL DEFAULT ''"], ['staff_enabled', 'INTEGER NOT NULL DEFAULT 0'], ['email_confirmed', 'INTEGER NOT NULL DEFAULT 0']]) {
  if (!db.prepare('PRAGMA table_info(ruleta_people)').all().some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ruleta_people ADD COLUMN ${column} ${definition}`);
    db.prepare("DELETE FROM settings WHERE key='ruleta_refreshed_at'").run();
  }
}

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

const STAFF_KIND_IDS = STAFF_KINDS.map((kind) => kind.id);

/** Cuentas CTP a las que Manager ha quitado el acceso: desactivadas o sin ningún rol de staff. */
function revokedInManager() {
  const withRoles = new Set(
    db.prepare(`SELECT DISTINCT ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.staff_kind IN (${STAFF_KIND_IDS.map(() => '?').join(',')})`)
      .all(...STAFF_KIND_IDS)
      .map((r) => r.user_id),
  );
  return new Set(
    db.prepare('SELECT id, ctp_user_id, ctp_role, active FROM users WHERE ctp_user_id IS NOT NULL').all()
      .filter((u) => !u.active || (u.ctp_role !== 'admin' && !withRoles.has(u.id)))
      .map((u) => u.ctp_user_id.toLowerCase()),
  );
}

/** Rol con el que sale en la ruleta: el mismo criterio con el que CTP deja entrar en Manager. */
function effectiveRole(p, revoked) {
  if (revoked.has(p.ctp_id)) return { role: 'player' };
  if (p.role === 'admin') return { role: 'admin' };
  if (p.role === 'referee') return { role: 'referee', staff_kind: 'referee' };
  if (p.staff_enabled && p.email_confirmed && p.staff_kind) return { role: p.staff_kind === 'referee' ? 'referee' : 'staff', staff_kind: p.staff_kind };
  return { role: 'player' };
}

function cachedPeople() {
  const revoked = revokedInManager();
  return db
    .prepare('SELECT ctp_id, name, role, staff_kind, staff_enabled, email_confirmed FROM ruleta_people')
    .all()
    .map((p) => ({ key: p.ctp_id, name: p.name, ...effectiveRole(p, revoked) }))
    .sort(byName);
}

/** Filas del directorio de staff recién leídas en Manager: ponen al día la copia de la ruleta. */
export function rememberStaffDirectory(items = []) {
  const update = db.prepare('UPDATE ruleta_people SET role=?, staff_kind=?, staff_enabled=?, email_confirmed=? WHERE ctp_id=?');
  tx(() => {
    for (const row of items) {
      const person = ruletaPerson(row);
      if (person) update.run(person.role, person.staff_kind, person.staff_enabled ? 1 : 0, person.email_confirmed ? 1 : 0, person.ctp_id);
    }
  });
}

/** Cambio de acceso confirmado por CTP en la página de staff (mismas reglas que manager_set_staff_access). */
export function rememberStaffAccess(change) {
  const id = String(change?.id || '').toLowerCase();
  const current = db.prepare('SELECT role FROM ruleta_people WHERE ctp_id=?').get(id);
  if (!current || current.role === 'admin') return;
  const role = change.enabled && change.staff_kind === 'referee' ? 'referee' : 'player';
  db.prepare('UPDATE ruleta_people SET role=?, staff_kind=?, staff_enabled=? WHERE ctp_id=?').run(role, change.staff_kind || '', change.enabled ? 1 : 0, id);
}

async function refreshFromCtp(user) {
  refreshing ||= getRegisteredPlayers(user)
    .then(({ people, total, truncated }) => {
      tx(() => {
        db.prepare('DELETE FROM ruleta_people').run();
        const insert = db.prepare('INSERT INTO ruleta_people(ctp_id,name,role,staff_kind,staff_enabled,email_confirmed) VALUES(?,?,?,?,?,?)');
        for (const p of people) insert.run(p.ctp_id, p.name, p.role, p.staff_kind, p.staff_enabled ? 1 : 0, p.email_confirmed ? 1 : 0);
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
