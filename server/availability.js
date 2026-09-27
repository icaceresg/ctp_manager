// Disponibilidad: las personas con la sección "disponibilidad" (por sus roles)
// marcan si pueden en cada día de evento. El administrador edita a todos y
// gestiona qué días se piden.
import { db } from './db.js';
import { HttpError } from './auth.js';
import * as v from './validate.js';

const STATUSES = ['disponible', 'no_disponible'];

/** Usuarios activos que tienen la sección por alguno de sus roles. */
export function teamMembers() {
  const roleIds = db
    .prepare('SELECT id, sections FROM roles')
    .all()
    .filter((r) => JSON.parse(r.sections).includes('disponibilidad'))
    .map((r) => r.id);
  if (!roleIds.length) return [];
  return db
    .prepare(
      `SELECT DISTINCT u.id, u.name, u.username FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
        WHERE u.active = 1 AND ur.role_id IN (${roleIds.map(() => '?').join(',')})`,
    )
    .all(...roleIds)
    .map((u) => ({ id: u.id, name: u.name || u.username, username: u.username }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}

export function listEventDays() {
  return db
    .prepare('SELECT date, event, main FROM event_days ORDER BY date')
    .all()
    .map((d) => ({ date: d.date, event: d.event, main: Boolean(d.main) }));
}

/** Días de evento, personas y lo que ha marcado cada una en esos días. */
export function listAvailability(user) {
  const days = listEventDays();
  const members = teamMembers();
  const dates = new Set(days.map((d) => d.date));
  const entries = db
    .prepare('SELECT user_id, date, status, note FROM availability ORDER BY date')
    .all()
    .filter((e) => dates.has(e.date) && members.some((m) => m.id === e.user_id));
  return { days, users: members, entries, me_in_team: members.some((m) => m.id === user.id) };
}

/**
 * Marca (o borra, con status null) la disponibilidad de un día de evento.
 * Cada uno cambia la suya; el administrador, la de cualquiera del equipo.
 */
export function setAvailability(actingUser, dateValue, body = {}) {
  const date = v.date(dateValue);
  if (!date) throw new HttpError(400, 'Fecha no válida.');
  if (!db.prepare('SELECT 1 FROM event_days WHERE date = ?').get(date)) {
    throw new HttpError(400, 'Ese día no es un día de evento.');
  }
  const targetId = body.user_id ? v.id(body.user_id) : actingUser.id;
  if (targetId !== actingUser.id && !actingUser.is_admin) {
    throw new HttpError(403, 'Solo puedes cambiar tu propia disponibilidad.');
  }
  if (!teamMembers().some((m) => m.id === targetId)) {
    throw new HttpError(400, 'Esa persona no tiene un rol con la sección Disponibilidad.');
  }
  const status = body.status ?? null;
  if (status !== null && !STATUSES.includes(status)) throw new HttpError(400, 'Estado de disponibilidad no válido.');

  if (status === null) {
    db.prepare('DELETE FROM availability WHERE user_id = ? AND date = ?').run(targetId, date);
    return null;
  }
  const note = v.text(body.note, { field: 'La nota', max: 200 }).trim();
  db.prepare(
    `INSERT INTO availability (user_id, date, status, note, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET status = excluded.status, note = excluded.note, updated_at = excluded.updated_at`,
  ).run(targetId, date, status, note, Date.now());
  return { user_id: targetId, date, status, note };
}

// ---------- Días de evento (administrador) ----------

/** Añade un día o cambia su evento/tipo si ya existía. */
export function saveEventDay(body = {}) {
  const date = v.date(body.date);
  if (!date) throw new HttpError(400, 'Fecha no válida.');
  const event = v.text(body.event, { field: 'El nombre del evento', max: 60, required: true });
  db.prepare(
    `INSERT INTO event_days (date, event, main) VALUES (?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET event = excluded.event, main = excluded.main`,
  ).run(date, event, body.main === false ? 0 : 1);
  return listEventDays();
}

/** Quita un día de evento. Lo que la gente hubiera marcado ese día se conserva por si vuelve. */
export function deleteEventDay(dateValue) {
  const date = v.date(dateValue);
  const { changes } = db.prepare('DELETE FROM event_days WHERE date = ?').run(date);
  if (!changes) throw new HttpError(404, 'Ese día no estaba en la lista.');
  return listEventDays();
}
