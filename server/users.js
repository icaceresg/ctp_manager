// Gestión de usuarios y roles (solo administradores).
import { db, tx } from './db.js';
import { HttpError, describeUser, hashPassword, validatePassword, validateUsername } from './auth.js';
import * as v from './validate.js';
import { SECTION_IDS, STAFF_KINDS } from '../shared/access.js';

// ---------- Usuarios ----------

function serializeUser(u) {
  const { roles } = describeUser(u);
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    is_admin: Boolean(u.is_admin),
    active: Boolean(u.active),
    roles,
    created_at: u.created_at,
    last_login_at: u.last_login_at,
  };
}

function getUserRow(id) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(v.id(id));
  if (!u) throw new HttpError(404, 'Usuario no encontrado.');
  return u;
}

// Orden alfabético en español (SQLite no ordena bien las tildes ni la ñ).
const byName = (a, b) => (a.name || a.username).localeCompare(b.name || b.username, 'es', { sensitivity: 'base' });

export function listUsers() {
  return db
    .prepare('SELECT * FROM users')
    .all()
    .sort((a, b) => b.is_admin - a.is_admin || byName(a, b))
    .map(serializeUser);
}

export function getUser(id) {
  return serializeUser(getUserRow(id));
}

function cleanRoleIds(ids) {
  if (ids === undefined) return undefined;
  if (!Array.isArray(ids)) throw new HttpError(400, 'Lista de roles no válida.');
  const unique = [...new Set(ids.map(Number))];
  for (const id of unique) {
    const role = db.prepare('SELECT staff_kind FROM roles WHERE id = ?').get(id);
    if (!role || !STAFF_KINDS.some((kind) => kind.id === role.staff_kind)) throw new HttpError(400, 'Solo puedes asignar roles de staff clasificados.');
  }
  return unique;
}

function setRoles(userId, roleIds) {
  db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(userId);
  const insert = db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)');
  for (const roleId of roleIds) insert.run(userId, roleId);
}

function usernameTaken(username, exceptId = 0) {
  return Boolean(db.prepare('SELECT 1 FROM users WHERE username = ? AND id != ?').get(username, exceptId));
}

export function createUser(body = {}) {
  const username = validateUsername(body.username);
  if (usernameTaken(username)) throw new HttpError(409, `Ya existe el usuario "${username}".`);
  const roleIds = cleanRoleIds(body.role_ids) || [];
  const name = v.text(body.name, { field: 'El nombre', max: 80 }).trim();
  const hash = hashPassword(validatePassword(body.password));
  return tx(() => {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (username, name, password_hash, is_admin, active, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(username, name, hash, body.is_admin ? 1 : 0, body.active === false ? 0 : 1, Date.now());
    const id = Number(lastInsertRowid);
    setRoles(id, roleIds);
    return id;
  });
}

function activeAdminCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND active = 1').get().n;
}

export function updateUser(id, body = {}, actingUserId) {
  const user = getUserRow(id);
  const self = user.id === actingUserId;
  const next = {
    username: body.username !== undefined ? validateUsername(body.username) : user.username,
    name: body.name !== undefined ? v.text(body.name, { field: 'El nombre', max: 80 }).trim() : user.name,
    is_admin: body.is_admin !== undefined ? (body.is_admin ? 1 : 0) : user.is_admin,
    active: body.active !== undefined ? (body.active ? 1 : 0) : user.active,
  };
  if (self && (!next.is_admin || !next.active)) {
    throw new HttpError(400, 'No puedes quitarte el rol de administrador ni desactivarte a ti mismo.');
  }
  if (user.is_admin && user.active && (!next.is_admin || !next.active) && activeAdminCount() <= 1) {
    throw new HttpError(400, 'Tiene que quedar al menos un administrador activo.');
  }
  if (usernameTaken(next.username, user.id)) throw new HttpError(409, `Ya existe el usuario "${next.username}".`);
  const roleIds = cleanRoleIds(body.role_ids);
  const newHash = body.password ? hashPassword(validatePassword(body.password)) : null;

  tx(() => {
    db.prepare('UPDATE users SET username = ?, name = ?, is_admin = ?, active = ? WHERE id = ?').run(
      next.username,
      next.name,
      next.is_admin,
      next.active,
      user.id,
    );
    if (roleIds) setRoles(user.id, roleIds);
    if (newHash) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, user.id);
    // Contraseña nueva o usuario desactivado: se cierran sus sesiones abiertas.
    if ((newHash && !self) || !next.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  });
  return user.id;
}

export function deleteUser(id, actingUserId) {
  const user = getUserRow(id);
  if (user.id === actingUserId) throw new HttpError(400, 'No puedes borrar tu propio usuario.');
  if (user.is_admin && user.active && activeAdminCount() <= 1) {
    throw new HttpError(400, 'Tiene que quedar al menos un administrador activo.');
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
}

// ---------- Roles ----------

function serializeRole(r) {
  return {
    id: r.id,
    name: r.name,
    staff_kind: r.staff_kind,
    sections: JSON.parse(r.sections),
    user_count: db.prepare('SELECT COUNT(*) AS n FROM user_roles WHERE role_id = ?').get(r.id).n,
  };
}

export function listRoles() {
  return db.prepare('SELECT * FROM roles').all().sort(byName).map(serializeRole);
}

function cleanRole(body, existing = {}) {
  const name = v.text(body.name ?? existing.name, { field: 'El nombre del rol', max: 40, required: true });
  const sections = body.sections ?? JSON.parse(existing.sections || '[]');
  if (!Array.isArray(sections) || sections.some((s) => !SECTION_IDS.includes(s))) {
    throw new HttpError(400, 'Hay una sección que no existe.');
  }
  const staff_kind = body.staff_kind ?? existing.staff_kind;
  if (!STAFF_KINDS.some((kind) => kind.id === staff_kind)) throw new HttpError(400, 'Selecciona una función de staff válida.');
  return { name, staff_kind, sections: SECTION_IDS.filter((s) => sections.includes(s)) };
}

// Sin distinguir mayúsculas, también en letras con tilde o ñ ("DISEÑO" = "diseño").
function roleNameTaken(name, exceptId = 0) {
  return db
    .prepare('SELECT id, name FROM roles WHERE id != ?')
    .all(exceptId)
    .some((r) => r.name.localeCompare(name, 'es', { sensitivity: 'accent' }) === 0);
}

export function createRole(body = {}) {
  const r = cleanRole(body);
  if (roleNameTaken(r.name)) throw new HttpError(409, `Ya existe el rol "${r.name}".`);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO roles (name, sections, staff_kind, created_at) VALUES (?, ?, ?, ?)')
    .run(r.name, JSON.stringify(r.sections), r.staff_kind, Date.now());
  return serializeRole(db.prepare('SELECT * FROM roles WHERE id = ?').get(Number(lastInsertRowid)));
}

export function updateRole(id, body = {}) {
  const existing = db.prepare('SELECT * FROM roles WHERE id = ?').get(v.id(id));
  if (!existing) throw new HttpError(404, 'Rol no encontrado.');
  const r = cleanRole(body, existing);
  if (roleNameTaken(r.name, existing.id)) throw new HttpError(409, `Ya existe el rol "${r.name}".`);
  db.prepare('UPDATE roles SET name = ?, sections = ?, staff_kind = ? WHERE id = ?').run(r.name, JSON.stringify(r.sections), r.staff_kind, existing.id);
  return serializeRole(db.prepare('SELECT * FROM roles WHERE id = ?').get(existing.id));
}

export function deleteRole(id) {
  const { changes } = db.prepare('DELETE FROM roles WHERE id = ?').run(v.id(id));
  if (!changes) throw new HttpError(404, 'Rol no encontrado.');
}
