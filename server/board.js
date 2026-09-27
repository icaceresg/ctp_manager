// Tablero tipo Trello: listas ordenadas con tarjetas ordenadas. Cada tarjeta
// tiene descripción, etiquetas, personas asignadas, fecha límite, checklist
// y comentarios.
import { db, tx } from './db.js';
import { HttpError } from './auth.js';
import * as v from './validate.js';

const MAX_LISTS = 30;
const MAX_CARDS_PER_LIST = 500;

function placeholders(list) {
  return list.map(() => '?').join(',');
}

// ---------- Personas que pueden usar el tablero ----------

/** Administradores y personas con la sección "tablero" por sus roles. */
export function boardMembers() {
  const roleIds = db
    .prepare('SELECT id, sections FROM roles')
    .all()
    .filter((r) => JSON.parse(r.sections).includes('tablero'))
    .map((r) => r.id);
  const rows = db
    .prepare(
      `SELECT DISTINCT u.id, u.name, u.username FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
        WHERE u.active = 1 AND (u.is_admin = 1 ${roleIds.length ? `OR ur.role_id IN (${placeholders(roleIds)})` : ''})`,
    )
    .all(...roleIds);
  return rows
    .map((u) => ({ id: u.id, name: u.name || u.username }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}

// ---------- Lectura ----------

function listLabels() {
  return db.prepare('SELECT id, color, name FROM board_labels ORDER BY id').all();
}

/** Tablero completo con el resumen de cada tarjeta (lo que se ve en la columna). */
export function getBoard() {
  const lists = db.prepare('SELECT id, title FROM board_lists ORDER BY position').all();
  const cards = db.prepare('SELECT * FROM board_cards ORDER BY position').all();
  const ids = cards.map((c) => c.id);
  const members = ids.length
    ? db.prepare(`SELECT card_id, user_id FROM board_card_members WHERE card_id IN (${placeholders(ids)})`).all(...ids)
    : [];
  const checklist = ids.length
    ? db
        .prepare(
          `SELECT card_id, COUNT(*) AS total, SUM(done) AS done FROM board_checklist
            WHERE card_id IN (${placeholders(ids)}) GROUP BY card_id`,
        )
        .all(...ids)
    : [];
  const comments = ids.length
    ? db
        .prepare(`SELECT card_id, COUNT(*) AS n FROM board_comments WHERE card_id IN (${placeholders(ids)}) GROUP BY card_id`)
        .all(...ids)
    : [];
  const membersBy = Map.groupBy(members, (m) => m.card_id);
  const checklistBy = new Map(checklist.map((c) => [c.card_id, c]));
  const commentsBy = new Map(comments.map((c) => [c.card_id, c.n]));
  const cardsBy = Map.groupBy(cards, (c) => c.list_id);

  return {
    lists: lists.map((l) => ({
      ...l,
      cards: (cardsBy.get(l.id) || []).map((c) => ({
        id: c.id,
        list_id: c.list_id,
        title: c.title,
        has_description: Boolean(c.description.trim()),
        due_date: c.due_date,
        due_done: Boolean(c.due_done),
        labels: JSON.parse(c.labels),
        members: (membersBy.get(c.id) || []).map((m) => m.user_id),
        checklist: { total: checklistBy.get(c.id)?.total || 0, done: checklistBy.get(c.id)?.done || 0 },
        comments: commentsBy.get(c.id) || 0,
      })),
    })),
    labels: listLabels(),
    members: boardMembers(),
  };
}

function getCardRow(id) {
  const card = db.prepare('SELECT * FROM board_cards WHERE id = ?').get(v.id(id));
  if (!card) throw new HttpError(404, 'Tarjeta no encontrada.');
  return card;
}

/** Tarjeta completa (lo que se ve al abrirla). */
export function getCard(id) {
  const c = getCardRow(id);
  const author = c.created_by ? db.prepare('SELECT name, username FROM users WHERE id = ?').get(c.created_by) : null;
  return {
    id: c.id,
    list_id: c.list_id,
    title: c.title,
    description: c.description,
    due_date: c.due_date,
    due_done: Boolean(c.due_done),
    labels: JSON.parse(c.labels),
    members: db.prepare('SELECT user_id FROM board_card_members WHERE card_id = ?').all(c.id).map((m) => m.user_id),
    checklist: db
      .prepare('SELECT id, text, done FROM board_checklist WHERE card_id = ? ORDER BY position')
      .all(c.id)
      .map((i) => ({ ...i, done: Boolean(i.done) })),
    comments: db
      .prepare(
        `SELECT bc.id, bc.text, bc.created_at, bc.user_id, COALESCE(NULLIF(u.name, ''), u.username, 'Usuario borrado') AS author
           FROM board_comments bc LEFT JOIN users u ON u.id = bc.user_id
          WHERE bc.card_id = ? ORDER BY bc.created_at DESC`,
      )
      .all(c.id),
    created_by: author ? author.name || author.username : null,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

// ---------- Listas ----------

function requireList(id) {
  const list = db.prepare('SELECT * FROM board_lists WHERE id = ?').get(v.id(id));
  if (!list) throw new HttpError(404, 'Lista no encontrada.');
  return list;
}

export function createList(body = {}) {
  const title = v.text(body.title, { field: 'El nombre de la lista', max: 80, required: true });
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM board_lists').get();
  if (n >= MAX_LISTS) throw new HttpError(400, `Como máximo ${MAX_LISTS} listas.`);
  db.prepare('INSERT INTO board_lists (title, position, created_at) VALUES (?, ?, ?)').run(title, n, Date.now());
}

export function renameList(id, body = {}) {
  const list = requireList(id);
  const title = v.text(body.title, { field: 'El nombre de la lista', max: 80, required: true });
  db.prepare('UPDATE board_lists SET title = ? WHERE id = ?').run(title, list.id);
}

export function deleteList(id) {
  const list = requireList(id);
  tx(() => {
    db.prepare('DELETE FROM board_lists WHERE id = ?').run(list.id);
    db.prepare('UPDATE board_lists SET position = position - 1 WHERE position > ?').run(list.position);
  });
}

export function reorderLists(ids) {
  const current = db.prepare('SELECT id FROM board_lists ORDER BY id').all().map((l) => l.id);
  const next = Array.isArray(ids) ? ids.map(Number) : [];
  if (next.length !== current.length || [...next].sort((a, b) => a - b).some((id, i) => id !== current[i])) {
    throw new HttpError(400, 'El nuevo orden no coincide con las listas del tablero.');
  }
  tx(() => {
    const update = db.prepare('UPDATE board_lists SET position = ? WHERE id = ?');
    next.forEach((id, i) => update.run(i, id));
  });
}

// ---------- Tarjetas ----------

function cleanLabels(labels) {
  if (!Array.isArray(labels)) throw new HttpError(400, 'Etiquetas no válidas.');
  const valid = new Set(listLabels().map((l) => l.id));
  const clean = [...new Set(labels.map(Number))];
  if (clean.some((id) => !valid.has(id))) throw new HttpError(400, 'Hay una etiqueta que no existe.');
  return clean;
}

function cleanMembers(members) {
  if (!Array.isArray(members)) throw new HttpError(400, 'Personas no válidas.');
  const valid = new Set(boardMembers().map((m) => m.id));
  const clean = [...new Set(members.map(Number))];
  if (clean.some((id) => !valid.has(id))) throw new HttpError(400, 'Solo puedes asignar a personas con acceso al tablero.');
  return clean;
}

export function createCard(body = {}, userId) {
  const list = requireList(body.list_id);
  const title = v.text(body.title, { field: 'El título', max: 300, required: true });
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM board_cards WHERE list_id = ?').get(list.id);
  if (n >= MAX_CARDS_PER_LIST) throw new HttpError(400, 'Esta lista tiene demasiadas tarjetas.');
  const now = Date.now();
  const { lastInsertRowid } = db
    .prepare('INSERT INTO board_cards (list_id, position, title, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(list.id, n, title, userId, now, now);
  return Number(lastInsertRowid);
}

export function updateCard(id, body = {}) {
  const card = getCardRow(id);
  const next = {
    title: body.title !== undefined ? v.text(body.title, { field: 'El título', max: 300, required: true }) : card.title,
    description: body.description !== undefined ? v.text(body.description, { field: 'La descripción' }) : card.description,
    due_date: body.due_date !== undefined ? v.date(body.due_date) : card.due_date,
    due_done: body.due_done !== undefined ? (body.due_done ? 1 : 0) : card.due_done,
    labels: body.labels !== undefined ? JSON.stringify(cleanLabels(body.labels)) : card.labels,
  };
  const members = body.members !== undefined ? cleanMembers(body.members) : null;
  tx(() => {
    db.prepare(
      'UPDATE board_cards SET title = ?, description = ?, due_date = ?, due_done = ?, labels = ?, updated_at = ? WHERE id = ?',
    ).run(next.title, next.description, next.due_date, next.due_date ? next.due_done : 0, next.labels, Date.now(), card.id);
    if (members) {
      db.prepare('DELETE FROM board_card_members WHERE card_id = ?').run(card.id);
      const insert = db.prepare('INSERT INTO board_card_members (card_id, user_id) VALUES (?, ?)');
      for (const userId of members) insert.run(card.id, userId);
    }
  });
  return card.id;
}

/** Mueve una tarjeta a una lista (la misma u otra) en la posición indicada. */
export function moveCard(id, body = {}) {
  const card = getCardRow(id);
  const target = requireList(body.list_id);
  const position = Number(body.position);
  if (!Number.isInteger(position) || position < 0) throw new HttpError(400, 'Posición no válida.');
  tx(() => {
    const idsIn = (listId) =>
      db
        .prepare('SELECT id FROM board_cards WHERE list_id = ? AND id != ? ORDER BY position')
        .all(listId, card.id)
        .map((c) => c.id);
    const update = db.prepare('UPDATE board_cards SET list_id = ?, position = ?, updated_at = ? WHERE id = ?');
    const now = Date.now();
    if (target.id !== card.list_id) {
      idsIn(card.list_id).forEach((cid, i) => update.run(card.list_id, i, now, cid));
    }
    const ids = idsIn(target.id);
    ids.splice(Math.min(position, ids.length), 0, card.id);
    ids.forEach((cid, i) => update.run(target.id, i, now, cid));
  });
  return card.id;
}

export function deleteCard(id) {
  const card = getCardRow(id);
  tx(() => {
    db.prepare('DELETE FROM board_cards WHERE id = ?').run(card.id);
    db.prepare('UPDATE board_cards SET position = position - 1 WHERE list_id = ? AND position > ?').run(card.list_id, card.position);
  });
}

// ---------- Checklist ----------

export function addChecklistItem(cardId, body = {}) {
  const card = getCardRow(cardId);
  const text = v.text(body.text, { field: 'El elemento', max: 300, required: true });
  const { next } = db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM board_checklist WHERE card_id = ?').get(card.id);
  db.prepare('INSERT INTO board_checklist (card_id, position, text) VALUES (?, ?, ?)').run(card.id, next, text);
  touch(card.id);
  return card.id;
}

function requireChecklistItem(id) {
  const item = db.prepare('SELECT * FROM board_checklist WHERE id = ?').get(v.id(id));
  if (!item) throw new HttpError(404, 'Elemento no encontrado.');
  return item;
}

export function updateChecklistItem(id, body = {}) {
  const item = requireChecklistItem(id);
  const text = body.text !== undefined ? v.text(body.text, { field: 'El elemento', max: 300, required: true }) : item.text;
  const done = body.done !== undefined ? (body.done ? 1 : 0) : item.done;
  db.prepare('UPDATE board_checklist SET text = ?, done = ? WHERE id = ?').run(text, done, item.id);
  touch(item.card_id);
  return item.card_id;
}

export function deleteChecklistItem(id) {
  const item = requireChecklistItem(id);
  db.prepare('DELETE FROM board_checklist WHERE id = ?').run(item.id);
  touch(item.card_id);
  return item.card_id;
}

// ---------- Comentarios ----------

export function addComment(cardId, body = {}, userId) {
  const card = getCardRow(cardId);
  const text = v.text(body.text, { field: 'El comentario', max: 2000, required: true });
  db.prepare('INSERT INTO board_comments (card_id, user_id, text, created_at) VALUES (?, ?, ?, ?)').run(card.id, userId, text, Date.now());
  touch(card.id);
  return card.id;
}

/** Cada uno borra sus comentarios; el administrador, cualquiera. */
export function deleteComment(id, user) {
  const comment = db.prepare('SELECT * FROM board_comments WHERE id = ?').get(v.id(id));
  if (!comment) throw new HttpError(404, 'Comentario no encontrado.');
  if (comment.user_id !== user.id && !user.is_admin) throw new HttpError(403, 'Solo puedes borrar tus comentarios.');
  db.prepare('DELETE FROM board_comments WHERE id = ?').run(comment.id);
  return comment.card_id;
}

// ---------- Etiquetas ----------

export function renameLabel(id, body = {}) {
  const label = db.prepare('SELECT * FROM board_labels WHERE id = ?').get(v.id(id));
  if (!label) throw new HttpError(404, 'Etiqueta no encontrada.');
  db.prepare('UPDATE board_labels SET name = ? WHERE id = ?').run(v.text(body.name, { field: 'El nombre', max: 30 }).trim(), label.id);
  return listLabels();
}

function touch(cardId) {
  db.prepare('UPDATE board_cards SET updated_at = ? WHERE id = ?').run(Date.now(), cardId);
}
