// Ruleta de PlayCTP (ruleta.playctp.com): sortea a una de las personas
// registradas. El ganador lo elige siempre el servidor con un generador
// criptográfico, nunca el navegador, y cada sorteo queda guardado.
import crypto from 'node:crypto';
import { db } from './db.js';
import { HttpError } from './auth.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS ruleta_draws (
    id           INTEGER PRIMARY KEY,
    winner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    winner_name  TEXT NOT NULL,
    participants TEXT NOT NULL,              -- JSON: [{ id, name }]
    drawn_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   INTEGER NOT NULL
  );
`);

const byName = (a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });

/** Personas que pueden salir: todos los usuarios activos de PlayCTP. */
export function listParticipants() {
  return db
    .prepare('SELECT id, username, name FROM users WHERE active = 1')
    .all()
    .map((u) => ({ id: u.id, name: (u.name || '').trim() || u.username }))
    .sort(byName);
}

/**
 * Hace un sorteo. Con `participant_ids` se limita a esas personas (la
 * selección del panel de participantes); sin ella entran todas.
 */
export function draw(body = {}, drawnBy) {
  const all = listParticipants();
  let pool = all;
  if (body.participant_ids !== undefined) {
    if (!Array.isArray(body.participant_ids) || body.participant_ids.length > 5000) {
      throw new HttpError(400, 'Lista de participantes no válida.');
    }
    const wanted = new Set(body.participant_ids.map(Number));
    pool = all.filter((p) => wanted.has(p.id));
  }
  if (!pool.length) throw new HttpError(400, 'No hay nadie en el sorteo. Elige al menos a una persona.');

  const winner = pool[crypto.randomInt(pool.length)];
  const createdAt = Date.now();
  const { lastInsertRowid } = db
    .prepare('INSERT INTO ruleta_draws (winner_id, winner_name, participants, drawn_by, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(winner.id, winner.name, JSON.stringify(pool), drawnBy ?? null, createdAt);
  return { id: Number(lastInsertRowid), winner, participants: pool, created_at: createdAt };
}

export function listDraws(limit = 15) {
  return db
    .prepare(
      `SELECT d.id, d.winner_id, d.winner_name, d.participants, d.created_at,
              COALESCE(NULLIF(u.name, ''), u.username) AS drawn_by
         FROM ruleta_draws d LEFT JOIN users u ON u.id = d.drawn_by
        ORDER BY d.id DESC LIMIT ?`,
    )
    .all(limit)
    .map((d) => ({
      id: d.id,
      winner: { id: d.winner_id, name: d.winner_name },
      participant_count: JSON.parse(d.participants).length,
      drawn_by: d.drawn_by || null,
      created_at: d.created_at,
    }));
}
