import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { canUseRetrospectives, canManageRetrospectives } from '../shared/access.js';
import {
  RETRO_KINDS, RETRO_AREAS, RETRO_SEVERITIES, RETRO_PHASES,
  RETRO_ACTION_STATUSES, RETRO_ACTION_PRIORITIES,
} from '../shared/retrospectives.js';

export class RetrospectiveError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, text) => { throw new RetrospectiveError(status, text); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
function object(value, keys) {
  if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))) fail(400, 'Datos de retrospectiva no válidos.');
  return value;
}
function text(value, max, { required = false, fallback = '' } = {}) {
  if (value === undefined) value = fallback;
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail(400, 'El texto supera el tamaño permitido o contiene caracteres no válidos.');
  const result = value.trim();
  if (required && !result) fail(400, 'Completa los campos obligatorios.');
  return result;
}
function choice(value, catalogue, fallback) {
  const selected = value === undefined ? fallback : value;
  if (!catalogue.some(row => row.id === selected)) fail(400, 'Selecciona una opción válida.');
  return selected;
}
function date(value, optional = true) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) fail(400, 'Selecciona una fecha válida.');
  return value;
}
function evidence(value) {
  const result = text(value, 1000);
  if (!result) return '';
  let url;
  try { url = new URL(result); } catch { fail(400, 'La referencia debe ser un enlace HTTP o HTTPS válido.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail(400, 'La referencia debe ser un enlace HTTP o HTTPS válido.');
  return result;
}
const digest = key => createHash('sha256').update(key).digest('hex');
const keyMatches = (provided, expected) => typeof provided === 'string' && /^[a-f0-9]{64}$/.test(provided)
  && typeof expected === 'string' && expected.length === 64
  && timingSafeEqual(Buffer.from(digest(provided), 'hex'), Buffer.from(expected, 'hex'));
const day = now => Math.floor(now / 86400000) * 86400000;
const iso = value => new Date(value).toISOString();
const itemFields = ['kind', 'area', 'severity', 'title', 'description', 'proposal', 'evidenceUrl'];
const MAX_CYCLE_TEXT = 1_000_000;
const MAX_CYCLE_COMMENTS = 1000;

/** Local Manager data only. Call with an owned connection after users/roles exist. */
export function createRetrospectiveStore(db, { clock = Date.now, authMode = 'local' } = {}) {
  if (!['local', 'ctp'].includes(authMode)) throw new TypeError('Invalid retrospective identity mode.');
  db.exec(`
    CREATE TABLE IF NOT EXISTS retro_sessions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, event_name TEXT NOT NULL,
      event_date TEXT, description TEXT NOT NULL DEFAULT '',
      phase TEXT NOT NULL DEFAULT 'collecting' CHECK(phase IN('collecting','reviewing','closed')),
      summary TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS retro_items (
      id TEXT PRIMARY KEY, retrospective_id TEXT NOT NULL REFERENCES retro_sessions(id),
      kind TEXT NOT NULL CHECK(kind IN('keep','improve','idea')),
      area TEXT NOT NULL CHECK(area IN('competition','refereeing','production','technology','communications','clubs','organization')),
      severity TEXT NOT NULL CHECK(severity IN('low','medium','high','critical')),
      title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', proposal TEXT NOT NULL DEFAULT '', evidence_url TEXT NOT NULL DEFAULT '',
      anonymous INTEGER NOT NULL CHECK(anonymous IN(0,1)),
      author_id INTEGER REFERENCES users(id) ON DELETE SET NULL, edit_key_hash TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),
      CHECK((anonymous=1 AND author_id IS NULL AND edit_key_hash IS NOT NULL AND length(edit_key_hash)=64) OR (anonymous=0 AND edit_key_hash IS NULL))
    );
    CREATE INDEX IF NOT EXISTS retro_items_cycle ON retro_items(retrospective_id,archived,kind);
    CREATE TABLE IF NOT EXISTS retro_comments (
      id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES retro_items(id), text TEXT NOT NULL,
      anonymous INTEGER NOT NULL CHECK(anonymous IN(0,1)), author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      edit_key_hash TEXT, created_at INTEGER NOT NULL,
      CHECK((anonymous=1 AND author_id IS NULL AND edit_key_hash IS NOT NULL AND length(edit_key_hash)=64) OR (anonymous=0 AND edit_key_hash IS NULL))
    );
    CREATE INDEX IF NOT EXISTS retro_comments_item ON retro_comments(item_id,created_at);
    CREATE TABLE IF NOT EXISTS retro_votes (
      item_id TEXT NOT NULL REFERENCES retro_items(id), user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY(item_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS retro_actions (
      id TEXT PRIMARY KEY, retrospective_id TEXT NOT NULL REFERENCES retro_sessions(id),
      item_id TEXT REFERENCES retro_items(id), title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL, due_date TEXT,
      status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN('todo','doing','done')),
      priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN('low','normal','high')),
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS retro_actions_cycle ON retro_actions(retrospective_id,status,due_date);
  `);
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  function access(viewer, manage = false) {
    if (!viewer || !Number.isSafeInteger(viewer.id) || !canUseRetrospectives(viewer)
      || !db.prepare('SELECT 1 FROM users WHERE id=? AND active=1').get(viewer.id)) fail(403, 'La retrospectiva es exclusiva del staff autorizado.');
    if (manage && !canManageRetrospectives(viewer)) fail(403, 'Sólo coordinación y dirección pueden gestionar la retrospectiva.');
  }
  const permissions = viewer => ({ participate: true, manage: canManageRetrospectives(viewer) });
  function assertBudget(id) {
    // Archived criticism remains part of the capacity budget: withdrawal never
    // deletes history or lets repeated create/archive calls grow storage forever.
    const usage = db.prepare(`SELECT
      (SELECT length(title)+length(event_name)+length(description)+length(summary) FROM retro_sessions WHERE id=?)
      +coalesce((SELECT sum(length(title)+length(description)+length(proposal)+length(evidence_url)) FROM retro_items WHERE retrospective_id=?),0)
      +coalesce((SELECT sum(length(c.text)) FROM retro_comments c JOIN retro_items i ON i.id=c.item_id WHERE i.retrospective_id=?),0)
      +coalesce((SELECT sum(length(title)+length(description)) FROM retro_actions WHERE retrospective_id=?),0) AS text_chars,
      (SELECT count(*) FROM retro_comments c JOIN retro_items i ON i.id=c.item_id WHERE i.retrospective_id=?) AS comments`)
      .get(id, id, id, id, id);
    if (usage.text_chars > MAX_CYCLE_TEXT) fail(413, 'Esta retrospectiva ha alcanzado el tamaño máximo. Resume la aportación antes de continuar.');
    if (usage.comments > MAX_CYCLE_COMMENTS) fail(413, 'Esta retrospectiva ha alcanzado el límite de comentarios.');
  }
  function session(id) {
    if (!uuid(id)) fail(404, 'Retrospectiva no encontrada.');
    const row = db.prepare('SELECT * FROM retro_sessions WHERE id=?').get(id);
    if (!row) fail(404, 'Retrospectiva no encontrada.');
    return row;
  }
  function feedbackOpen(row, newItem = false) {
    if (row.phase === 'closed' || newItem && row.phase !== 'collecting') fail(409, 'La recogida de aportaciones está cerrada.');
  }
  function getItem(sessionId, itemId, { allowArchived = false } = {}) {
    if (!uuid(itemId)) fail(404, 'Aportación no encontrada.');
    const row = db.prepare('SELECT * FROM retro_items WHERE id=? AND retrospective_id=?').get(itemId, sessionId);
    if (!row || row.archived && !allowArchived) fail(404, 'Aportación no encontrada.');
    return row;
  }
  const name = (id, context) => {
    if (id == null) return null;
    if (context) return context.names.get(id) || null;
    const row = db.prepare('SELECT id,name,username FROM users WHERE id=?').get(id);
    return row ? { id: row.id, name: row.name || row.username } : null;
  };
  function counts(id) {
    const row = db.prepare(`SELECT count(*) total,coalesce(sum(kind='keep'),0) keep,coalesce(sum(kind='improve'),0) improve,
      coalesce(sum(kind='idea'),0) idea FROM retro_items WHERE retrospective_id=? AND archived=0`).get(id);
    const actions = db.prepare(`SELECT coalesce(sum(status<>'done'),0) openActions,coalesce(sum(status='done'),0) doneActions FROM retro_actions WHERE retrospective_id=?`).get(id);
    const votes = db.prepare('SELECT count(*) n FROM retro_votes v JOIN retro_items i ON i.id=v.item_id WHERE i.retrospective_id=? AND i.archived=0').get(id).n;
    return { ...row, votes, ...actions };
  }
  function sessionDto(row) {
    return { id: row.id, title: row.title, eventName: row.event_name, eventDate: row.event_date,
      description: row.description, phase: row.phase, summary: row.summary,
      createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), counts: counts(row.id) };
  }
  function commentDto(row, context) {
    return { id: row.id, text: row.text, anonymous: Boolean(row.anonymous), author: row.anonymous ? null : name(row.author_id, context),
      createdAt: row.anonymous ? iso(row.created_at).slice(0, 10) : iso(row.created_at) };
  }
  function itemDto(row, viewer, context) {
    return { id: row.id, retrospectiveId: row.retrospective_id, kind: row.kind, area: row.area, severity: row.severity,
      title: row.title, description: row.description, proposal: row.proposal, evidenceUrl: row.evidence_url,
      anonymous: Boolean(row.anonymous), author: row.anonymous ? null : name(row.author_id, context),
      createdAt: row.anonymous ? iso(row.created_at).slice(0, 10) : iso(row.created_at),
      votes: context ? context.votes.get(row.id)?.votes || 0 : db.prepare('SELECT count(*) n FROM retro_votes WHERE item_id=?').get(row.id).n,
      viewerVoted: context ? Boolean(context.votes.get(row.id)?.viewerVoted) : Boolean(db.prepare('SELECT 1 FROM retro_votes WHERE item_id=? AND user_id=?').get(row.id, viewer.id)),
      canEdit: !row.archived && !row.anonymous && row.author_id === viewer.id,
      canArchive: !row.archived && (canManageRetrospectives(viewer) || !row.anonymous && row.author_id === viewer.id),
      archived: Boolean(row.archived),
      comments: context ? context.comments.get(row.id) || []
        : db.prepare('SELECT * FROM retro_comments WHERE item_id=? ORDER BY created_at,id LIMIT 100').all(row.id).map(row => commentDto(row)) };
  }
  function actionDto(row, context) {
    return { id: row.id, itemId: row.item_id, title: row.title, description: row.description,
      owner: name(row.owner_id, context), dueDate: row.due_date, status: row.status, priority: row.priority,
      createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
  }
  function people() {
    const centralColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map(row => row.name));
    const projection = ['ctp_user_id', 'ctp_role', 'ctp_staff_kind'].map(column =>
      centralColumns.has(column) ? `u.${column}` : `NULL AS ${column}`).join(',');
    const rows = db.prepare(`SELECT u.id,u.name,u.username,u.is_admin,${projection},r.staff_kind AS role_kind FROM users u
      LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id WHERE u.active=1`).all();
    const users = new Map();
    for (const row of rows) {
      if (!users.has(row.id)) users.set(row.id, { id: row.id, name: row.name || row.username, is_admin: Boolean(row.is_admin),
        auth_mode: authMode, ctp_user_id: row.ctp_user_id, ctp_role: row.ctp_role, staff_kind: row.ctp_staff_kind, roles: [] });
      if (row.role_kind) users.get(row.id).roles.push({ staff_kind: row.role_kind });
    }
    return [...users.values()].filter(canUseRetrospectives).map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }
  function owner(value) {
    if (value === null || value === '' || value === undefined) return null;
    if (!Number.isSafeInteger(value) || !people().some(row => row.id === value)) fail(400, 'El responsable debe ser una persona activa del staff.');
    return value;
  }
  function content(body, previous = {}) {
    return {
      kind: choice(body.kind, RETRO_KINDS, previous.kind || 'improve'),
      area: choice(body.area, RETRO_AREAS, previous.area || 'organization'),
      severity: choice(body.severity, RETRO_SEVERITIES, previous.severity || 'medium'),
      title: text(body.title, 160, { required: true, fallback: previous.title }),
      description: text(body.description, 6000, { fallback: previous.description || '' }),
      proposal: text(body.proposal, 3000, { fallback: previous.proposal || '' }),
      evidenceUrl: evidence(body.evidenceUrl === undefined ? previous.evidence_url : body.evidenceUrl),
    };
  }
  function itemOwner(row, viewer, body) {
    if (!(row.anonymous ? keyMatches(body.editKey, row.edit_key_hash) : row.author_id === viewer.id)) fail(403, 'Sólo su autor puede modificar esta aportación.');
  }
  function action(sessionId, actionId) {
    if (!uuid(actionId)) fail(404, 'Acción no encontrada.');
    const row = db.prepare('SELECT * FROM retro_actions WHERE id=? AND retrospective_id=?').get(actionId, sessionId);
    if (!row) fail(404, 'Acción no encontrada.');
    return row;
  }
  function detailContext(id, viewer) {
    const names = new Map(db.prepare(`SELECT id,name,username FROM users WHERE id IN (
      SELECT author_id FROM retro_items WHERE retrospective_id=?
      UNION SELECT c.author_id FROM retro_comments c JOIN retro_items i ON i.id=c.item_id WHERE i.retrospective_id=?
      UNION SELECT owner_id FROM retro_actions WHERE retrospective_id=?)`).all(id, id, id)
      .map(row => [row.id, { id: row.id, name: row.name || row.username }]));
    const votes = new Map(db.prepare(`SELECT v.item_id,count(*) votes,max(v.user_id=?) viewerVoted FROM retro_votes v
      JOIN retro_items i ON i.id=v.item_id WHERE i.retrospective_id=? GROUP BY v.item_id`).all(viewer.id, id)
      .map(row => [row.item_id, row]));
    const context = { names, votes, comments: new Map() };
    const comments = db.prepare(`SELECT c.* FROM retro_comments c JOIN retro_items i ON i.id=c.item_id
      WHERE i.retrospective_id=? AND (?=1 OR i.archived=0) ORDER BY c.created_at,c.id`)
      .all(id, Number(canManageRetrospectives(viewer)));
    for (const row of comments) {
      if (!context.comments.has(row.item_id)) context.comments.set(row.item_id, []);
      context.comments.get(row.item_id).push(commentDto(row, context));
    }
    return context;
  }
  const store = {
    list(viewer) {
      access(viewer);
      return { retrospectives: db.prepare('SELECT * FROM retro_sessions ORDER BY created_at DESC,id LIMIT 50').all().map(sessionDto), permissions: permissions(viewer) };
    },
    create(viewer, input) {
      access(viewer, true); const body = object(input, ['title', 'eventName', 'eventDate', 'description']);
      if (db.prepare('SELECT count(*) n FROM retro_sessions').get().n >= 200) fail(409, 'Se ha alcanzado el límite de retrospectivas.');
      const id = randomUUID(), now = clock();
      db.prepare('INSERT INTO retro_sessions(id,title,event_name,event_date,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
        .run(id, text(body.title, 160, { required: true }), text(body.eventName, 160, { required: true }), date(body.eventDate), text(body.description, 3000), now, now);
      return sessionDto(session(id));
    },
    detail(viewer, id) {
      access(viewer); const row = session(id);
      const context = detailContext(id, viewer);
      return { retrospective: sessionDto(row), permissions: permissions(viewer),
        items: db.prepare('SELECT * FROM retro_items WHERE retrospective_id=? AND (?=1 OR archived=0) ORDER BY created_at,id LIMIT 500')
          .all(id, Number(canManageRetrospectives(viewer))).map(item => itemDto(item, viewer, context)),
        actions: db.prepare('SELECT * FROM retro_actions WHERE retrospective_id=? ORDER BY created_at,id LIMIT 250').all(id).map(row => actionDto(row, context)),
        people: people(), areas: RETRO_AREAS, kinds: RETRO_KINDS };
    },
    update(viewer, id, input) {
      access(viewer, true); const row = session(id); const body = object(input, ['title', 'eventName', 'eventDate', 'description', 'phase', 'summary']);
      db.prepare('UPDATE retro_sessions SET title=?,event_name=?,event_date=?,description=?,phase=?,summary=?,updated_at=? WHERE id=?')
        .run(text(body.title, 160, { required: true, fallback: row.title }), text(body.eventName, 160, { required: true, fallback: row.event_name }),
          date(body.eventDate === undefined ? row.event_date : body.eventDate), text(body.description, 3000, { fallback: row.description }),
          choice(body.phase, RETRO_PHASES, row.phase), text(body.summary, 12000, { fallback: row.summary }), clock(), id);
      return sessionDto(session(id));
    },
    createItem(viewer, id, input) {
      access(viewer); const cycle = session(id); feedbackOpen(cycle, true);
      const body = object(input, [...itemFields, 'anonymous']);
      if (typeof body.anonymous !== 'boolean') fail(400, 'Selecciona cómo publicar tu aportación.');
      const value = content(body);
      if (db.prepare('SELECT count(*) n FROM retro_items WHERE retrospective_id=?').get(id).n >= 500) fail(409, 'Se ha alcanzado el límite de aportaciones.');
      const itemId = randomUUID(), editKey = body.anonymous ? randomBytes(32).toString('hex') : null;
      const stamp = body.anonymous ? day(clock()) : clock();
      db.prepare(`INSERT INTO retro_items(id,retrospective_id,kind,area,severity,title,description,proposal,evidence_url,anonymous,author_id,edit_key_hash,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(itemId, id, value.kind, value.area, value.severity, value.title, value.description, value.proposal,
          value.evidenceUrl, Number(body.anonymous), body.anonymous ? null : viewer.id, editKey ? digest(editKey) : null, stamp, stamp);
      return { item: itemDto(getItem(id, itemId), viewer), ...(editKey ? { editKey } : {}) };
    },
    updateItem(viewer, id, itemId, input) {
      access(viewer); feedbackOpen(session(id), true); const row = getItem(id, itemId);
      const body = object(input, [...itemFields, 'editKey']); itemOwner(row, viewer, body); const value = content(body, row);
      db.prepare('UPDATE retro_items SET kind=?,area=?,severity=?,title=?,description=?,proposal=?,evidence_url=?,updated_at=? WHERE id=?')
        .run(value.kind, value.area, value.severity, value.title, value.description, value.proposal, value.evidenceUrl, row.anonymous ? day(clock()) : clock(), itemId);
      return { item: itemDto(getItem(id, itemId), viewer) };
    },
    archiveItem(viewer, id, itemId, input = {}) {
      access(viewer); const cycle = session(id); const row = getItem(id, itemId);
      const body = object(input, ['editKey']);
      if (!canManageRetrospectives(viewer)) feedbackOpen(cycle, true);
      if (!canManageRetrospectives(viewer)) itemOwner(row, viewer, body);
      db.prepare('UPDATE retro_items SET archived=1,updated_at=? WHERE id=?').run(row.anonymous ? day(clock()) : clock(), itemId);
      return { ok: true };
    },
    vote(viewer, id, itemId, input) {
      access(viewer); feedbackOpen(session(id)); const row = getItem(id, itemId); const body = object(input, ['voted']);
      if (typeof body.voted !== 'boolean') fail(400, 'El voto no es válido.');
      return transaction(() => {
        if (body.voted) db.prepare('INSERT OR IGNORE INTO retro_votes(item_id,user_id) VALUES(?,?)').run(row.id, viewer.id);
        else db.prepare('DELETE FROM retro_votes WHERE item_id=? AND user_id=?').run(row.id, viewer.id);
        return { votes: db.prepare('SELECT count(*) n FROM retro_votes WHERE item_id=?').get(row.id).n, viewerVoted: body.voted };
      });
    },
    createComment(viewer, id, itemId, input) {
      access(viewer); feedbackOpen(session(id)); const item = getItem(id, itemId); const body = object(input, ['text', 'anonymous']);
      if (typeof body.anonymous !== 'boolean') fail(400, 'Selecciona cómo publicar tu comentario.');
      if (db.prepare('SELECT count(*) n FROM retro_comments WHERE item_id=?').get(item.id).n >= 100) fail(409, 'Se ha alcanzado el límite de comentarios.');
      const commentId = randomUUID(), editKey = body.anonymous ? randomBytes(32).toString('hex') : null;
      db.prepare('INSERT INTO retro_comments(id,item_id,text,anonymous,author_id,edit_key_hash,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(commentId, item.id, text(body.text, 3000, { required: true }), Number(body.anonymous), body.anonymous ? null : viewer.id,
          editKey ? digest(editKey) : null, body.anonymous ? day(clock()) : clock());
      return { comment: commentDto(db.prepare('SELECT * FROM retro_comments WHERE id=?').get(commentId)), ...(editKey ? { editKey } : {}) };
    },
    createAction(viewer, id, input) {
      access(viewer, true); session(id); const body = object(input, ['itemId', 'title', 'description', 'ownerId', 'dueDate', 'status', 'priority']);
      if (db.prepare('SELECT count(*) n FROM retro_actions WHERE retrospective_id=?').get(id).n >= 250) fail(409, 'Se ha alcanzado el límite de acciones.');
      const itemId = body.itemId || null;
      if (itemId) getItem(id, itemId);
      const actionId = randomUUID(), now = clock();
      db.prepare('INSERT INTO retro_actions(id,retrospective_id,item_id,title,description,owner_id,due_date,status,priority,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(actionId, id, itemId, text(body.title, 160, { required: true }), text(body.description, 6000), owner(body.ownerId), date(body.dueDate),
          choice(body.status, RETRO_ACTION_STATUSES, 'todo'), choice(body.priority, RETRO_ACTION_PRIORITIES, 'normal'), now, now);
      return actionDto(action(id, actionId));
    },
    updateAction(viewer, id, actionId, input) {
      access(viewer); session(id); const row = action(id, actionId); const manage = canManageRetrospectives(viewer);
      const body = object(input, manage ? ['title', 'description', 'ownerId', 'dueDate', 'status', 'priority'] : ['status']);
      if (!manage && row.owner_id !== viewer.id) fail(403, 'Sólo el responsable puede actualizar esta acción.');
      db.prepare('UPDATE retro_actions SET title=?,description=?,owner_id=?,due_date=?,status=?,priority=?,updated_at=? WHERE id=?')
        .run(text(body.title, 160, { required: true, fallback: row.title }), text(body.description, 6000, { fallback: row.description }),
          body.ownerId === undefined ? row.owner_id : owner(body.ownerId), date(body.dueDate === undefined ? row.due_date : body.dueDate),
          choice(body.status, RETRO_ACTION_STATUSES, row.status), choice(body.priority, RETRO_ACTION_PRIORITIES, row.priority), clock(), row.id);
      return actionDto(action(id, actionId));
    },
    export(viewer, id) {
      const result = store.detail(viewer, id);
      // Export the shared review, never possession keys, hashes, voters or per-viewer controls.
      const { items, actions, retrospective } = result;
      return { retrospective, items: items.filter(item => !item.archived).map(({ viewerVoted, canEdit, canArchive, ...item }) => item), actions,
        exportedAt: iso(clock()), confidentiality: 'Uso interno del staff de CTP' };
    },
  };
  // Content writes reserve the shared cycle budget under the same SQLite writer
  // transaction. A rejected write leaves neither text, ownership key nor counters.
  for (const method of ['create', 'update', 'createItem', 'updateItem', 'createComment', 'createAction', 'updateAction']) {
    const mutate = store[method];
    store[method] = (...args) => transaction(() => {
      const result = mutate(...args);
      assertBudget(method === 'create' ? result.id : args[1]);
      return result;
    });
  }
  return store;
}
