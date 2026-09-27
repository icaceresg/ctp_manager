import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from './config.js';
import { DEFAULT_ROLES } from '../shared/access.js';

// [fecha, evento, 1 = día del evento / 0 = día previo o posterior]
const SEASON_EVENT_DAYS = [
  ['2026-11-08', 'Inaugural', 1],
  ['2026-12-20', 'Major', 1],
  ['2027-02-28', 'Major', 1],
  ['2027-04-25', 'Major', 1],
  ['2027-05-21', 'Freakcom con Cup', 0],
  ['2027-05-22', 'Freakcom con Cup', 1],
  ['2027-05-23', 'Freakcom con Cup', 1],
  ['2027-05-24', 'Freakcom con Cup', 0],
  ['2027-06-20', 'Major', 1],
  ['2027-07-01', 'LAN Champ', 0],
  ['2027-07-02', 'LAN Champ', 1],
  ['2027-07-03', 'LAN Champ', 1],
  ['2027-07-04', 'LAN Champ', 1],
  ['2027-07-05', 'LAN Champ', 0],
];

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(process.env.DB_PATH || path.join(DATA_DIR, 'myredesmanager.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  -- Usuarios de la intranet. El administrador ve todo y gestiona usuarios y roles.
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    INTEGER NOT NULL,
    last_login_at INTEGER
  );

  -- Roles (RRSS, CASTER…): cada uno da acceso a unas secciones.
  CREATE TABLE IF NOT EXISTS roles (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    sections   TEXT NOT NULL DEFAULT '[]',   -- JSON: ["calendario", "recursos"]
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_roles (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
  );

  -- Disponibilidad por día de cada persona (casters…). Sin fila = sin marcar.
  CREATE TABLE IF NOT EXISTS availability (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,                -- AAAA-MM-DD
    status     TEXT NOT NULL,                -- 'disponible' | 'no_disponible'
    note       TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, date)
  );
  CREATE INDEX IF NOT EXISTS availability_date ON availability(date);

  -- Días de evento en los que se pide disponibilidad. main = 0: día previo o
  -- posterior al evento (en el calendario del equipo, entre paréntesis).
  CREATE TABLE IF NOT EXISTS event_days (
    date  TEXT PRIMARY KEY,                  -- AAAA-MM-DD
    event TEXT NOT NULL,
    main  INTEGER NOT NULL DEFAULT 1
  );

  -- Tablero tipo Trello: listas (columnas) con tarjetas.
  CREATE TABLE IF NOT EXISTS board_lists (
    id         INTEGER PRIMARY KEY,
    title      TEXT NOT NULL,
    position   INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS board_labels (
    id    INTEGER PRIMARY KEY,
    color TEXT NOT NULL,
    name  TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS board_cards (
    id          INTEGER PRIMARY KEY,
    list_id     INTEGER NOT NULL REFERENCES board_lists(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    due_date    TEXT,                        -- AAAA-MM-DD
    due_done    INTEGER NOT NULL DEFAULT 0,
    labels      TEXT NOT NULL DEFAULT '[]',  -- JSON: ids de board_labels
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS board_cards_list ON board_cards(list_id, position);

  CREATE TABLE IF NOT EXISTS board_card_members (
    card_id INTEGER NOT NULL REFERENCES board_cards(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (card_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS board_checklist (
    id       INTEGER PRIMARY KEY,
    card_id  INTEGER NOT NULL REFERENCES board_cards(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    text     TEXT NOT NULL,
    done     INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS board_comments (
    id         INTEGER PRIMARY KEY,
    card_id    INTEGER NOT NULL REFERENCES board_cards(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    text       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- Tarjetas de contenido para redes (organización, no se publica nada).
  CREATE TABLE IF NOT EXISTS contents (
    id          INTEGER PRIMARY KEY,
    title       TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'no_listo',
    date        TEXT,                        -- AAAA-MM-DD (NULL = sin fecha)
    time        TEXT,                        -- HH:MM opcional
    platforms   TEXT NOT NULL DEFAULT '[]',  -- JSON: [{ platform, format }]
    description TEXT NOT NULL DEFAULT '',
    copy        TEXT NOT NULL DEFAULT '',
    notes       TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS contents_date ON contents(date);

  CREATE TABLE IF NOT EXISTS resources (
    id         INTEGER PRIMARY KEY,
    content_id INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL,
    text       TEXT NOT NULL,
    done       INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS resources_content ON resources(content_id, position);

  -- Escaletas: guiones por bloques, independientes de las tarjetas.
  CREATE TABLE IF NOT EXISTS rundowns (
    id          INTEGER PRIMARY KEY,
    title       TEXT NOT NULL,
    date        TEXT,
    time        TEXT,
    description TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rundown_parts (
    id         INTEGER PRIMARY KEY,
    rundown_id INTEGER NOT NULL REFERENCES rundowns(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL,
    title      TEXT NOT NULL DEFAULT '',
    duration   INTEGER NOT NULL DEFAULT 0,   -- segundos
    content    TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS rundown_parts_rundown ON rundown_parts(rundown_id, position);
`);

// Columnas añadidas después de la primera versión del esquema.
function addColumn(table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn('contents', 'owner', "TEXT NOT NULL DEFAULT ''");
// Identifica las tarjetas importadas (p. ej. "CTP_Calendario#12") para no duplicarlas.
addColumn('contents', 'source_ref', 'TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS contents_source_ref ON contents(source_ref) WHERE source_ref IS NOT NULL');

// Cada sesión pertenece a un usuario; las de la versión de un solo usuario ya no valen.
addColumn('sessions', 'user_id', 'INTEGER REFERENCES users(id) ON DELETE CASCADE');
db.prepare('DELETE FROM sessions WHERE user_id IS NULL').run();

// Antes había una única contraseña: pasa a ser la del usuario "admin".
const legacyPassword = db.prepare("SELECT value FROM settings WHERE key = 'password_hash'").get();
if (legacyPassword) {
  if (!db.prepare('SELECT COUNT(*) AS n FROM users').get().n) {
    db.prepare(
      "INSERT INTO users (username, name, password_hash, is_admin, created_at) VALUES ('admin', 'Administrador', ?, 1, ?)",
    ).run(legacyPassword.value, Date.now());
    console.log('[datos] Tu contraseña de siempre ahora es la del usuario "admin".');
  }
  db.prepare("DELETE FROM settings WHERE key = 'password_hash'").run();
}

// Roles de partida (solo la primera vez: luego el administrador los gestiona).
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'roles_seeded'").get()) {
  const insert = db.prepare('INSERT OR IGNORE INTO roles (name, sections, created_at) VALUES (?, ?, ?)');
  for (const role of DEFAULT_ROLES) insert.run(role.name, JSON.stringify(role.sections), Date.now());
  db.prepare("INSERT INTO settings (key, value) VALUES ('roles_seeded', '1')").run();
}

// La sección Disponibilidad llegó después: se añade una vez al rol CASTER existente.
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'availability_seeded'").get()) {
  const caster = db.prepare("SELECT id, sections FROM roles WHERE name = 'CASTER'").get();
  if (caster) {
    const sections = JSON.parse(caster.sections);
    if (!sections.includes('disponibilidad')) sections.push('disponibilidad');
    db.prepare('UPDATE roles SET sections = ? WHERE id = ?').run(JSON.stringify(sections), caster.id);
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('availability_seeded', '1')").run();
}

// Días de evento de la temporada 2026/27 (solo la primera vez; luego los
// gestiona el administrador desde Disponibilidad).
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'event_days_seeded'").get()) {
  const insert = db.prepare('INSERT OR IGNORE INTO event_days (date, event, main) VALUES (?, ?, ?)');
  for (const [date, event, main] of SEASON_EVENT_DAYS) insert.run(date, event, main);
  db.prepare("INSERT INTO settings (key, value) VALUES ('event_days_seeded', '1')").run();
}

// Tablero para Directivos: rol, listas y etiquetas de partida (una sola vez).
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'board_seeded'").get()) {
  db.prepare("INSERT OR IGNORE INTO roles (name, sections, created_at) VALUES ('DIRECTIVOS', '[\"tablero\"]', ?)").run(Date.now());
  if (!db.prepare('SELECT COUNT(*) AS n FROM board_lists').get().n) {
    const insertList = db.prepare('INSERT INTO board_lists (title, position, created_at) VALUES (?, ?, ?)');
    ['Por hacer', 'En curso', 'En revisión', 'Hecho'].forEach((title, i) => insertList.run(title, i, Date.now()));
  }
  if (!db.prepare('SELECT COUNT(*) AS n FROM board_labels').get().n) {
    const insertLabel = db.prepare('INSERT INTO board_labels (color, name) VALUES (?, ?)');
    for (const [color, name] of [
      ['red', 'Urgente'],
      ['amber', 'Importante'],
      ['gold', 'Evento'],
      ['purple', 'Patrocinio'],
      ['blue', 'Contenido'],
      ['green', 'Equipo'],
    ]) {
      insertLabel.run(color, name);
    }
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('board_seeded', '1')").run();
}

// Los estados pasaron de etapas de producción al flujo de revisión del equipo.
db.prepare("UPDATE contents SET status = 'no_listo' WHERE status IN ('idea', 'guion', 'grabacion', 'edicion')").run();

// La primera versión publicaba en X. Se borran sus tablas, las claves de la
// app de X y los tokens de las cuentas, y se compacta el archivo para que no
// queden restos de esos datos en disco.
const LEGACY_TABLES = ['usage_log', 'queue_slots', 'media', 'post_items', 'posts', 'accounts', 'oauth_states'];
const hasLegacy = db
  .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN (${LEGACY_TABLES.map(() => '?').join(',')})`)
  .get(...LEGACY_TABLES).n;
if (hasLegacy) {
  for (const table of LEGACY_TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`);
  db.prepare("DELETE FROM settings WHERE key IN ('x_client_id', 'x_client_secret', 'monthly_budget')").run();
  db.exec('VACUUM');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  fs.rmSync(path.join(DATA_DIR, 'uploads'), { recursive: true, force: true });
  console.log('[datos] Eliminados los datos y claves de la antigua conexión con X.');
}

/** Ejecuta fn dentro de una transacción. */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
