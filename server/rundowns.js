// Escaletas: listas ordenadas de partes (bloques) con duración, contenido y notas.
import { db, tx } from './db.js';
import { HttpError } from './auth.js';
import * as v from './validate.js';

const MAX_PARTS = 300;
const MAX_DURATION = 24 * 60 * 60;

// Partes con las que empieza una escaleta nueva.
const TEMPLATE = [
  { title: 'Intro', duration: 30, content: 'Gancho y presentación del tema.' },
  { title: 'Bloque 1', duration: 180 },
  { title: 'Cierre', duration: 30, content: 'Resumen y llamada a la acción.' },
];

function serializePart(p) {
  return { id: p.id, title: p.title, duration: p.duration, content: p.content, notes: p.notes };
}

export function listRundowns() {
  return db
    .prepare(
      `SELECT r.id, r.title, r.date, r.time, r.updated_at,
              COUNT(p.id) AS part_count, COALESCE(SUM(p.duration), 0) AS total_duration
         FROM rundowns r LEFT JOIN rundown_parts p ON p.rundown_id = r.id
        GROUP BY r.id
        ORDER BY r.updated_at DESC`,
    )
    .all();
}

export function getRundown(id) {
  const r = db.prepare('SELECT * FROM rundowns WHERE id = ?').get(v.id(id));
  if (!r) throw new HttpError(404, 'Escaleta no encontrada.');
  const parts = db.prepare('SELECT * FROM rundown_parts WHERE rundown_id = ? ORDER BY position').all(r.id);
  return {
    id: r.id,
    title: r.title,
    date: r.date,
    time: r.time,
    description: r.description,
    created_at: r.created_at,
    updated_at: r.updated_at,
    parts: parts.map(serializePart),
  };
}

function cleanMeta(body, existing = {}) {
  const merged = { ...existing, ...body };
  const date = v.date(merged.date);
  return {
    title: v.text(merged.title, { field: 'El título', max: 200, required: true }),
    date,
    time: date ? v.time(merged.time) : null,
    description: v.text(merged.description, { field: 'La descripción' }),
  };
}

function cleanPart(body, existing = {}) {
  const merged = { ...existing, ...body };
  const duration = Number(merged.duration ?? 0);
  if (!Number.isInteger(duration) || duration < 0 || duration > MAX_DURATION) {
    throw new HttpError(400, 'Duración no válida.');
  }
  return {
    title: v.text(merged.title, { field: 'El título de la parte', max: 200 }),
    duration,
    content: v.text(merged.content, { field: 'El contenido' }),
    notes: v.text(merged.notes, { field: 'Las notas' }),
  };
}

function touch(rundownId) {
  db.prepare('UPDATE rundowns SET updated_at = ? WHERE id = ?').run(Date.now(), rundownId);
}

function insertParts(rundownId, parts, startPosition = 0) {
  const insert = db.prepare(
    'INSERT INTO rundown_parts (rundown_id, position, title, duration, content, notes) VALUES (?, ?, ?, ?, ?, ?)',
  );
  parts.forEach((p, i) => {
    const c = cleanPart(p);
    insert.run(rundownId, startPosition + i, c.title, c.duration, c.content, c.notes);
  });
}

export function createRundown(body = {}) {
  const meta = cleanMeta({ title: 'Nueva escaleta', ...body });
  const parts = Array.isArray(body.parts) ? body.parts : TEMPLATE;
  if (parts.length > MAX_PARTS) throw new HttpError(400, 'Demasiadas partes.');
  const now = Date.now();
  return tx(() => {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO rundowns (title, date, time, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(meta.title, meta.date, meta.time, meta.description, now, now);
    const id = Number(lastInsertRowid);
    insertParts(id, parts);
    return id;
  });
}

export function updateRundown(id, body = {}) {
  const existing = getRundown(id);
  const meta = cleanMeta(body, existing);
  db.prepare('UPDATE rundowns SET title = ?, date = ?, time = ?, description = ?, updated_at = ? WHERE id = ?').run(
    meta.title,
    meta.date,
    meta.time,
    meta.description,
    Date.now(),
    existing.id,
  );
  return existing.id;
}

export function duplicateRundown(id) {
  const source = getRundown(id);
  return createRundown({
    title: `${source.title} (copia)`.slice(0, 200),
    date: source.date,
    time: source.time,
    description: source.description,
    parts: source.parts,
  });
}

export function deleteRundown(id) {
  const { changes } = db.prepare('DELETE FROM rundowns WHERE id = ?').run(v.id(id));
  if (!changes) throw new HttpError(404, 'Escaleta no encontrada.');
}

// ---------- Partes ----------

function getPartRow(partId) {
  const p = db.prepare('SELECT * FROM rundown_parts WHERE id = ?').get(v.id(partId));
  if (!p) throw new HttpError(404, 'Parte no encontrada.');
  return p;
}

/** Añade una parte al final o justo después de `after` (id de otra parte). */
export function addPart(rundownId, body = {}) {
  const rundown = getRundown(rundownId);
  if (rundown.parts.length >= MAX_PARTS) throw new HttpError(400, 'Demasiadas partes.');
  return tx(() => {
    let position = rundown.parts.length;
    if (body.after) {
      const after = getPartRow(body.after);
      if (after.rundown_id !== rundown.id) throw new HttpError(400, 'Parte no válida.');
      position = after.position + 1;
      db.prepare('UPDATE rundown_parts SET position = position + 1 WHERE rundown_id = ? AND position >= ?').run(
        rundown.id,
        position,
      );
    }
    insertParts(rundown.id, [body], position);
    touch(rundown.id);
    return rundown.id;
  });
}

export function updatePart(partId, body = {}) {
  const existing = getPartRow(partId);
  const c = cleanPart(body, existing);
  db.prepare('UPDATE rundown_parts SET title = ?, duration = ?, content = ?, notes = ? WHERE id = ?').run(
    c.title,
    c.duration,
    c.content,
    c.notes,
    existing.id,
  );
  touch(existing.rundown_id);
  return serializePart({ ...existing, ...c });
}

export function deletePart(partId) {
  const existing = getPartRow(partId);
  tx(() => {
    db.prepare('DELETE FROM rundown_parts WHERE id = ?').run(existing.id);
    db.prepare('UPDATE rundown_parts SET position = position - 1 WHERE rundown_id = ? AND position > ?').run(
      existing.rundown_id,
      existing.position,
    );
    touch(existing.rundown_id);
  });
  return existing.rundown_id;
}

/** Guarda un nuevo orden: `ids` debe contener todas las partes de la escaleta. */
export function reorderParts(rundownId, ids) {
  const rundown = getRundown(rundownId);
  const current = rundown.parts.map((p) => p.id).sort((a, b) => a - b);
  const next = Array.isArray(ids) ? ids.map(Number) : [];
  if (next.length !== current.length || [...next].sort((a, b) => a - b).some((idValue, i) => idValue !== current[i])) {
    throw new HttpError(400, 'El nuevo orden no coincide con las partes de la escaleta.');
  }
  tx(() => {
    const update = db.prepare('UPDATE rundown_parts SET position = ? WHERE id = ?');
    next.forEach((partId, i) => update.run(i, partId));
    touch(rundown.id);
  });
  return rundown.id;
}
