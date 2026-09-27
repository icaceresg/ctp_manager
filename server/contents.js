// Tarjetas de contenido: qué se publica, en qué redes y con qué recursos.
import { db, tx } from './db.js';
import { HttpError } from './auth.js';
import * as v from './validate.js';
import { DEFAULT_STATUS, PLATFORMS, STATUS_IDS, sortPlatforms } from '../shared/catalog.js';

const MAX_RESOURCES = 100;

function placeholders(list) {
  return list.map(() => '?').join(',');
}

function hydrate(rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const resources = db
    .prepare(`SELECT * FROM resources WHERE content_id IN (${placeholders(ids)}) ORDER BY position`)
    .all(...ids);
  const byContent = Map.groupBy(resources, (r) => r.content_id);
  return rows.map((c) => ({
    id: c.id,
    title: c.title,
    status: c.status,
    owner: c.owner,
    date: c.date,
    time: c.time,
    platforms: JSON.parse(c.platforms),
    description: c.description,
    copy: c.copy,
    notes: c.notes,
    created_at: c.created_at,
    updated_at: c.updated_at,
    resources: (byContent.get(c.id) || []).map((r) => ({ id: r.id, text: r.text, done: Boolean(r.done) })),
  }));
}

export function getContent(id) {
  const row = db.prepare('SELECT * FROM contents WHERE id = ?').get(v.id(id));
  if (!row) throw new HttpError(404, 'Contenido no encontrado.');
  return hydrate([row])[0];
}

/**
 * Lista contenidos. Con from/to (AAAA-MM-DD) devuelve los de ese rango;
 * con unscheduled, los que no tienen fecha; con withResources, solo los
 * que tienen algún recurso.
 */
export function listContents({ from, to, unscheduled, withResources } = {}) {
  const where = [];
  const params = [];
  if (unscheduled) where.push('date IS NULL');
  if (from) {
    where.push('date >= ?');
    params.push(v.date(from));
  }
  if (to) {
    where.push('date < ?');
    params.push(v.date(to));
  }
  if (withResources) where.push('EXISTS (SELECT 1 FROM resources r WHERE r.content_id = contents.id)');
  const sql = `SELECT * FROM contents ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY date IS NULL, date, time IS NULL, time, updated_at DESC`;
  return hydrate(db.prepare(sql).all(...params));
}

/** Redes y formatos: una misma red puede ir en varios formatos (p. ej. Carrusel + Story). */
function cleanPlatforms(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > 30) throw new HttpError(400, 'Lista de redes no válida.');
  const unique = new Map();
  for (const p of list) {
    const platform = PLATFORMS[p?.platform];
    if (!platform) throw new HttpError(400, 'Red social no válida.');
    const format = p.format in platform.formats ? p.format : Object.keys(platform.formats)[0];
    unique.set(`${p.platform}:${format}`, { platform: p.platform, format });
  }
  return sortPlatforms([...unique.values()]);
}

function cleanResources(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > MAX_RESOURCES) {
    throw new HttpError(400, `Lista de recursos no válida (máx. ${MAX_RESOURCES}).`);
  }
  return list
    .map((r) => ({ text: v.text(r?.text, { field: 'El recurso', max: 300 }).trim(), done: Boolean(r?.done) }))
    .filter((r) => r.text);
}

function clean(body) {
  const status = body.status ?? DEFAULT_STATUS;
  if (!STATUS_IDS.includes(status)) throw new HttpError(400, 'Estado no válido.');
  const date = v.date(body.date);
  return {
    title: v.text(body.title, { field: 'El título', max: 200, required: true }),
    status,
    owner: v.text(body.owner, { field: 'El responsable', max: 60 }).trim(),
    date,
    time: date ? v.time(body.time) : null,
    platforms: cleanPlatforms(body.platforms),
    description: v.text(body.description, { field: 'La descripción' }),
    copy: v.text(body.copy, { field: 'El copy' }),
    notes: v.text(body.notes, { field: 'Las notas' }),
    resources: cleanResources(body.resources),
  };
}

function writeResources(contentId, resources) {
  db.prepare('DELETE FROM resources WHERE content_id = ?').run(contentId);
  const insert = db.prepare('INSERT INTO resources (content_id, position, text, done) VALUES (?, ?, ?, ?)');
  resources.forEach((r, i) => insert.run(contentId, i, r.text, r.done ? 1 : 0));
}

/** Crea una tarjeta. `sourceRef` solo lo usa el importador para no duplicar filas. */
export function createContent(body = {}, { sourceRef = null } = {}) {
  const c = clean(body);
  const now = Date.now();
  return tx(() => {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO contents (title, status, owner, date, time, platforms, description, copy, notes, source_ref, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(c.title, c.status, c.owner, c.date, c.time, JSON.stringify(c.platforms), c.description, c.copy, c.notes, sourceRef, now, now);
    const id = Number(lastInsertRowid);
    writeResources(id, c.resources);
    return id;
  });
}

export function updateContent(id, body = {}) {
  const existing = getContent(id);
  const c = clean(body);
  tx(() => {
    db.prepare(
      `UPDATE contents SET title = ?, status = ?, owner = ?, date = ?, time = ?, platforms = ?, description = ?,
              copy = ?, notes = ?, updated_at = ? WHERE id = ?`,
    ).run(c.title, c.status, c.owner, c.date, c.time, JSON.stringify(c.platforms), c.description, c.copy, c.notes, Date.now(), existing.id);
    writeResources(existing.id, c.resources);
  });
  return existing.id;
}

/** Cambios rápidos desde el calendario: mover de fecha o cambiar el estado. */
export function patchContent(id, body = {}) {
  const existing = getContent(id);
  const next = { ...existing, ...body };
  if (!STATUS_IDS.includes(next.status)) throw new HttpError(400, 'Estado no válido.');
  const date = v.date(next.date);
  db.prepare('UPDATE contents SET status = ?, date = ?, time = ?, updated_at = ? WHERE id = ?').run(
    next.status,
    date,
    date ? v.time(next.time) : null,
    Date.now(),
    existing.id,
  );
  return existing.id;
}

export function duplicateContent(id) {
  const source = getContent(id);
  return createContent({
    ...source,
    title: `${source.title} (copia)`.slice(0, 200),
    status: DEFAULT_STATUS,
    resources: source.resources.map((r) => ({ text: r.text, done: false })),
  });
}

/** Responsables usados en alguna tarjeta, para sugerirlos y filtrar. */
export function listOwners() {
  return db
    .prepare("SELECT DISTINCT owner FROM contents WHERE owner != '' ORDER BY owner COLLATE NOCASE")
    .all()
    .map((r) => r.owner);
}

export function findBySourceRef(ref) {
  return db.prepare('SELECT id FROM contents WHERE source_ref = ?').get(ref)?.id ?? null;
}

export function deleteContent(id) {
  const { changes } = db.prepare('DELETE FROM contents WHERE id = ?').run(v.id(id));
  if (!changes) throw new HttpError(404, 'Contenido no encontrado.');
}

// ---------- Recursos sueltos (desde la vista global de recursos) ----------

export function addResource(contentId, text) {
  const content = getContent(contentId);
  if (content.resources.length >= MAX_RESOURCES) throw new HttpError(400, 'Demasiados recursos en este contenido.');
  const value = v.text(text, { field: 'El recurso', max: 300, required: true });
  const { next } = db
    .prepare('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM resources WHERE content_id = ?')
    .get(content.id);
  db.prepare('INSERT INTO resources (content_id, position, text, done) VALUES (?, ?, ?, 0)').run(content.id, next, value);
  touch(content.id);
  return content.id;
}

export function setResourceDone(resourceId, done) {
  const row = db.prepare('SELECT content_id FROM resources WHERE id = ?').get(v.id(resourceId));
  if (!row) throw new HttpError(404, 'Recurso no encontrado.');
  db.prepare('UPDATE resources SET done = ? WHERE id = ?').run(done ? 1 : 0, v.id(resourceId));
  touch(row.content_id);
  return row.content_id;
}

export function deleteResource(resourceId) {
  const row = db.prepare('SELECT content_id FROM resources WHERE id = ?').get(v.id(resourceId));
  if (!row) throw new HttpError(404, 'Recurso no encontrado.');
  db.prepare('DELETE FROM resources WHERE id = ?').run(v.id(resourceId));
  touch(row.content_id);
  return row.content_id;
}

function touch(contentId) {
  db.prepare('UPDATE contents SET updated_at = ? WHERE id = ?').run(Date.now(), contentId);
}
