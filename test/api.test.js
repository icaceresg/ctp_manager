// Prueba de extremo a extremo: arranca el servidor con una base de datos
// temporal y recorre usuarios y permisos, contenidos, recursos y escaletas.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_ROLES } from '../shared/access.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3300 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}/api`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrm-test-'));
const dbPath = path.join(dataDir, 'myredesmanager.db');

let server;
let output = '';

/** Cliente HTTP con su propia cookie de sesión (un "navegador" por usuario). */
function makeClient() {
  let cookie = '';
  return async function request(method, url, body) {
    const res = await fetch(`${BASE}${url}`, {
      method,
      headers: { cookie, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
}

// El administrador; el resto de usuarios se crean en las pruebas de permisos.
const api = makeClient();

function scryptHash(password) {
  const salt = crypto.randomBytes(16);
  return ['scrypt', salt.toString('hex'), crypto.scryptSync(password, salt, 64).toString('hex')].join('$');
}

async function waitFor(fn, timeout = 8000) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - start > timeout) throw new Error(`Tiempo de espera agotado. Salida:\n${output}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

before(async () => {
  // Base de datos con restos de la versión anterior (publicación en X).
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO settings VALUES ('x_client_id', 'id'), ('x_client_secret', 'SECRETO-VIEJO'), ('password_hash', '${scryptHash('contraseña-vieja')}');
    CREATE TABLE accounts (id INTEGER PRIMARY KEY, access_token TEXT, refresh_token TEXT);
    INSERT INTO accounts VALUES (1, 'TOKEN-VIEJO', 'REFRESH-VIEJO');
    CREATE TABLE posts (id INTEGER PRIMARY KEY);
    CREATE TABLE contents (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'idea', date TEXT, time TEXT,
      platforms TEXT NOT NULL DEFAULT '[]', description TEXT NOT NULL DEFAULT '', copy TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    INSERT INTO contents (title, status, created_at, updated_at) VALUES ('Tarjeta antigua', 'guion', 0, 0);
  `);
  legacy.close();
  fs.mkdirSync(path.join(dataDir, 'uploads'));

  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, CTP_OPERATIONS_URL: '', CTP_OPERATIONS_TOKEN: '', CTP_SIGNING_SECRET: '', CTP_ENABLE_WRITES: 'false', PUBLIC_ORIGIN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => (output += d));
  server.stderr.on('data', (d) => (output += d));
  await waitFor(() => output.includes('funcionando'));
});

after(async () => {
  if (server && server.exitCode === null) {
    // En Windows la base de datos sigue bloqueada hasta que el proceso termina.
    await new Promise((resolve) => {
      server.once('exit', resolve);
      server.kill();
    });
  }
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('borra los datos y claves de la antigua conexión con X', () => {
  const raw = fs.readFileSync(dbPath).toString('latin1');
  assert.ok(!raw.includes('SECRETO-VIEJO') && !raw.includes('TOKEN-VIEJO'), 'no quedan restos en el archivo');
  const check = new DatabaseSync(dbPath, { readOnly: true });
  const tables = check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
  const keys = check.prepare('SELECT key FROM settings').all().map((r) => r.key);
  check.close();
  assert.ok(!tables.includes('accounts') && !tables.includes('posts'));
  assert.ok(!keys.includes('password_hash') && !keys.includes('x_client_secret'));
  assert.equal(fs.existsSync(path.join(dataDir, 'uploads')), false);
});

test('adapta las tarjetas de antes a los estados nuevos', () => {
  const check = new DatabaseSync(dbPath, { readOnly: true });
  const row = check.prepare("SELECT status, owner FROM contents WHERE title = 'Tarjeta antigua'").get();
  check.close();
  assert.equal(row.status, 'no_listo');
  assert.equal(row.owner, '');
});

test('la contraseña de antes pasa a ser la del usuario "admin"', async () => {
  assert.equal((await api('GET', '/contents')).status, 401);
  assert.equal((await api('POST', '/auth/setup', { username: 'otro', password: 'contraseña-segura' })).status, 409);
  assert.equal((await api('POST', '/auth/login', { username: 'admin', password: 'mal' })).status, 401);
  const { status, data } = await api('POST', '/auth/login', { username: 'ADMIN', password: 'contraseña-vieja' });
  assert.equal(status, 200);
  assert.equal(data.user.is_admin, true);
  assert.deepEqual(data.user.sections, ['calendario', 'recursos', 'escaleta', 'disponibilidad', 'tablero', 'operaciones', 'arbitraje', 'casters', 'realizacion', 'clubes', 'comunicaciones']);
});

test('crea los roles de partida', async () => {
  const roles = (await api('GET', '/roles')).data;
  assert.deepEqual(
    roles.map((r) => [r.name, r.sections]),
    [...DEFAULT_ROLES].sort((a,b) => a.name.localeCompare(b.name,'es',{sensitivity:'base'})).map(r => [r.name,r.sections]),
  );
});

test('solo staff explícito entra y un rol de jugador no concede acceso aunque tenga secciones', async () => {
  assert.equal((await api('POST','/roles',{name:'JUGADOR',staff_kind:'player',sections:['arbitraje']})).status,400);
  const player=(await api('POST','/users',{username:'outsider',password:'outside-staff-only-123'})).data;
  assert.equal((await makeClient()('POST','/auth/login',{username:'outsider',password:'outside-staff-only-123'})).status,403);
  const fixture=new DatabaseSync(dbPath);
  const legacy=Number(fixture.prepare("INSERT INTO roles(name,sections,created_at) VALUES('LEGACY PLAYER','[\"arbitraje\"]',?)").run(Date.now()).lastInsertRowid);
  fixture.prepare('INSERT INTO user_roles(user_id,role_id) VALUES(?,?)').run(player.id,legacy);
  fixture.close();
  assert.equal((await makeClient()('POST','/auth/login',{username:'outsider',password:'outside-staff-only-123'})).status,403);
  assert.equal((await api('PATCH',`/roles/${legacy}`,{name:'ARBITRO REVISADO',staff_kind:'referee'})).status,200);
  const staff=await loginAs('outsider','outside-staff-only-123');
  assert.equal((await staff('GET','/operations/bootstrap')).status,200);
  assert.equal((await staff('GET','/users')).status,403);
  assert.equal((await api('PATCH',`/users/${player.id}`,{role_ids:[]})).status,200);
  assert.equal((await staff('GET','/operations/bootstrap')).status,401);
  await api('DELETE',`/users/${player.id}`);
  await api('DELETE',`/roles/${legacy}`);
});

let content;

test('crea una tarjeta con redes, formatos y recursos', async () => {
  const { status, data } = await api('POST', '/contents', {
    title: '  Tutorial de edición  ',
    status: 'revision',
    owner: ' Diseño ',
    date: '2026-10-05',
    time: '18:00',
    platforms: [
      { platform: 'tiktok', format: 'inventado' },
      { platform: 'instagram', format: 'story' },
      { platform: 'instagram', format: 'reel' },
      { platform: 'instagram', format: 'reel' },
    ],
    description: 'Vídeo corto enseñando 3 atajos',
    copy: 'Tres atajos que te ahorran horas #edicion',
    resources: [{ text: 'Música sin copyright' }, { text: 'B-roll del ordenador', done: true }, { text: '   ' }],
  });
  assert.equal(status, 201);
  assert.equal(data.title, 'Tutorial de edición');
  assert.equal(data.owner, 'Diseño');
  // Varios formatos por red, sin repetidos y en el orden del catálogo.
  assert.deepEqual(data.platforms, [
    { platform: 'instagram', format: 'reel' },
    { platform: 'instagram', format: 'story' },
    { platform: 'tiktok', format: 'video' },
  ]);
  assert.deepEqual(
    data.resources.map((r) => [r.text, r.done]),
    [
      ['Música sin copyright', false],
      ['B-roll del ordenador', true],
    ],
  );
  content = data;
});

test('valida los datos de la tarjeta', async () => {
  const bad = [
    { title: '' },
    { title: 'x', status: 'inventado' },
    { title: 'x', date: '2026-13-45' },
    { title: 'x', date: '2026-10-01', time: '25:00' },
    { title: 'x', platforms: [{ platform: 'facebook' }] },
    { title: 'x', owner: 'a'.repeat(61) },
  ];
  for (const body of bad) assert.equal((await api('POST', '/contents', body)).status, 400, JSON.stringify(body));
  // Sin fecha, la hora se ignora.
  const idea = (await api('POST', '/contents', { title: 'Idea suelta', time: '10:00' })).data;
  assert.equal(idea.date, null);
  assert.equal(idea.time, null);
  assert.equal(idea.status, 'no_listo');
  const yt = (await api('POST', '/contents', { title: 'Short', platforms: [{ platform: 'youtube', format: 'short' }] })).data;
  assert.deepEqual(yt.platforms, [{ platform: 'youtube', format: 'short' }]);
  await api('DELETE', `/contents/${yt.id}`);
});

test('lista por rango de fechas y las ideas sin fecha', async () => {
  await api('POST', '/contents', { title: 'Noviembre', date: '2026-11-02' });
  const october = (await api('GET', '/contents?from=2026-10-01&to=2026-11-01')).data;
  assert.deepEqual(october.map((c) => c.title), ['Tutorial de edición']);
  const unscheduled = (await api('GET', '/contents?unscheduled=1')).data;
  assert.deepEqual(unscheduled.map((c) => c.title), ['Idea suelta', 'Tarjeta antigua']);
});

test('mueve una tarjeta de día y cambia su estado', async () => {
  const moved = (await api('PATCH', `/contents/${content.id}`, { date: '2026-10-07' })).data;
  assert.equal(moved.date, '2026-10-07');
  assert.equal(moved.time, '18:00', 'conserva la hora');
  assert.equal(moved.resources.length, 2, 'no toca los recursos');
  const done = (await api('PATCH', `/contents/${content.id}`, { status: 'listo' })).data;
  assert.equal(done.status, 'listo');
  const unscheduled = (await api('PATCH', `/contents/${content.id}`, { date: null })).data;
  assert.equal(unscheduled.date, null);
  assert.equal(unscheduled.time, null);
  await api('PATCH', `/contents/${content.id}`, { date: '2026-10-07', time: '18:00' });
});

test('gestiona los recursos desde la vista global', async () => {
  let c = (await api('POST', `/contents/${content.id}/resources`, { text: 'Miniatura' })).data;
  assert.deepEqual(c.resources.map((r) => r.text), ['Música sin copyright', 'B-roll del ordenador', 'Miniatura']);
  const miniatura = c.resources[2];
  c = (await api('PATCH', `/resources/${miniatura.id}`, { done: true })).data;
  assert.equal(c.resources[2].done, true);
  c = (await api('DELETE', `/resources/${c.resources[0].id}`)).data;
  assert.equal(c.resources.length, 2);
  assert.equal((await api('POST', `/contents/${content.id}/resources`, { text: ' ' })).status, 400);

  const withResources = (await api('GET', '/contents?with_resources=1')).data;
  assert.deepEqual(withResources.map((x) => x.title), ['Tutorial de edición']);
});

test('edita, duplica y borra tarjetas', async () => {
  const edited = (
    await api('PUT', `/contents/${content.id}`, {
      title: 'Tutorial de edición (v2)',
      status: 'revision',
      owner: 'Edición',
      date: '2026-10-07',
      platforms: [{ platform: 'x', format: 'hilo' }],
      resources: [{ text: 'Capturas', done: false }],
    })
  ).data;
  assert.equal(edited.time, null);
  assert.deepEqual(edited.platforms, [{ platform: 'x', format: 'hilo' }]);
  assert.deepEqual(edited.resources.map((r) => r.text), ['Capturas']);

  const copy = (await api('POST', `/contents/${content.id}/duplicate`)).data;
  assert.equal(copy.title, 'Tutorial de edición (v2) (copia)');
  assert.equal(copy.status, 'no_listo');
  assert.equal(copy.owner, 'Edición');
  assert.deepEqual((await api('GET', '/owners')).data, ['Edición']);
  assert.notEqual(copy.id, content.id);

  assert.equal((await api('DELETE', `/contents/${copy.id}`)).status, 200);
  assert.equal((await api('GET', `/contents/${copy.id}`)).status, 404);
});

let rundown;

test('crea una escaleta con partes de plantilla', async () => {
  const { status, data } = await api('POST', '/rundowns', { title: 'Episodio 1', date: '2026-10-10' });
  assert.equal(status, 201);
  assert.deepEqual(data.parts.map((p) => p.title), ['Intro', 'Bloque 1', 'Cierre']);
  rundown = data;
  const list = (await api('GET', '/rundowns')).data;
  assert.equal(list[0].part_count, 3);
  assert.equal(list[0].total_duration, 240);
});

test('añade, edita, reordena y borra partes', async () => {
  const [intro, bloque, cierre] = rundown.parts;
  let r = (await api('POST', `/rundowns/${rundown.id}/parts`, { title: 'Patrocinio', duration: 45, after: intro.id })).data;
  assert.deepEqual(r.parts.map((p) => p.title), ['Intro', 'Patrocinio', 'Bloque 1', 'Cierre']);

  const updated = (await api('PATCH', `/parts/${bloque.id}`, { content: 'Explicación principal', duration: 300 })).data;
  assert.equal(updated.title, 'Bloque 1', 'un cambio parcial no borra el resto');
  assert.equal(updated.duration, 300);
  assert.equal((await api('PATCH', `/parts/${bloque.id}`, { duration: -5 })).status, 400);

  const patro = r.parts[1];
  r = (await api('PUT', `/rundowns/${rundown.id}/order`, { ids: [cierre.id, intro.id, patro.id, bloque.id] })).data;
  assert.deepEqual(r.parts.map((p) => p.title), ['Cierre', 'Intro', 'Patrocinio', 'Bloque 1']);
  assert.equal((await api('PUT', `/rundowns/${rundown.id}/order`, { ids: [cierre.id] })).status, 400);

  r = (await api('DELETE', `/parts/${patro.id}`)).data;
  assert.deepEqual(r.parts.map((p) => p.title), ['Cierre', 'Intro', 'Bloque 1']);
  // Las posiciones quedan compactas: añadir detrás de la primera sigue funcionando.
  r = (await api('POST', `/rundowns/${rundown.id}/parts`, { title: 'Nueva', after: cierre.id })).data;
  assert.deepEqual(r.parts.map((p) => p.title), ['Cierre', 'Nueva', 'Intro', 'Bloque 1']);
});

test('edita, duplica y borra escaletas', async () => {
  const edited = (await api('PUT', `/rundowns/${rundown.id}`, { title: 'Episodio 1: directo', time: '20:30' })).data;
  assert.equal(edited.title, 'Episodio 1: directo');
  assert.equal(edited.date, '2026-10-10', 'un cambio parcial conserva la fecha');
  assert.equal(edited.time, '20:30');
  assert.equal((await api('PUT', `/rundowns/${rundown.id}`, { title: '' })).status, 400);

  const copy = (await api('POST', `/rundowns/${rundown.id}/duplicate`)).data;
  assert.equal(copy.parts.length, edited.parts.length);
  assert.notEqual(copy.parts[0].id, edited.parts[0].id);

  assert.equal((await api('DELETE', `/rundowns/${copy.id}`)).status, 200);
  assert.equal((await api('GET', `/rundowns/${copy.id}`)).status, 404);
});

// ---------- Usuarios, roles y permisos ----------

const role = async (name) => (await api('GET', '/roles')).data.find((r) => r.name === name);

async function loginAs(username, password) {
  const client = makeClient();
  const res = await client('POST', '/auth/login', { username, password });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return client;
}

test('el administrador crea usuarios y valida los datos', async () => {
  const rrss = await role('RRSS');
  const created = await api('POST', '/users', { username: 'lucia.rrss', name: 'Lucía', password: 'clave-segura-1', role_ids: [rrss.id] });
  assert.equal(created.status, 201);
  assert.deepEqual(created.data.roles.map((r) => r.name), ['RRSS']);
  assert.equal(created.data.password_hash, undefined, 'nunca se devuelve la contraseña');

  const caster = await role('CASTER');
  assert.equal((await api('POST', '/users', { username: 'pablo', password: 'clave-segura-2', role_ids: [caster.id] })).status, 201);

  const bad = [
    { username: 'LUCIA.RRSS', password: 'clave-segura-1' },
    { username: 'a b', password: 'clave-segura-1' },
    { username: 'corta', password: '123' },
    { username: 'fantasma', password: 'clave-segura-1', role_ids: [999] },
  ];
  const codes = [];
  for (const body of bad) codes.push((await api('POST', '/users', body)).status);
  assert.deepEqual(codes, [409, 400, 400, 400]);
});

test('cada rol solo ve sus secciones', async () => {
  const lucia = await loginAs('lucia.rrss', 'clave-segura-1');
  assert.deepEqual((await lucia('GET', '/me')).data.sections, ['calendario', 'recursos', 'comunicaciones']);
  assert.equal((await lucia('GET', '/contents?from=2026-10-01&to=2026-11-01')).status, 200);
  assert.equal((await lucia('POST', '/contents', { title: 'De Lucía' })).status, 201);
  assert.equal((await lucia('GET', '/rundowns')).status, 403);
  assert.equal((await lucia('PATCH', '/parts/1', { title: 'x' })).status, 403);
  assert.equal((await lucia('GET', '/users')).status, 403);
  assert.equal((await lucia('PATCH', `/roles/${(await role('RRSS')).id}`, { sections: ['escaleta'] })).status, 403);

  const pablo = await loginAs('pablo', 'clave-segura-2');
  assert.equal((await pablo('GET', '/rundowns')).status, 200);
  assert.equal((await pablo('POST', '/rundowns', { title: 'Directo de Pablo' })).status, 201);
  assert.equal((await pablo('GET', '/contents?unscheduled=1')).status, 403);
  assert.equal((await pablo('GET', '/contents?with_resources=1')).status, 403);
});

test('un rol solo de Recursos marca recursos pero no edita tarjetas', async () => {
  const diseno = (await api('POST', '/roles', { name: 'DISEÑO', staff_kind: 'communications', sections: ['recursos'] })).data;
  assert.equal((await api('POST', '/roles', { name: 'diseño', staff_kind: 'communications' })).status, 409);
  await api('POST', '/users', { username: 'dani', password: 'clave-segura-3', role_ids: [diseno.id] });
  const card = (await api('POST', '/contents', { title: 'Con recursos', resources: [{ text: 'Miniatura' }] })).data;

  const dani = await loginAs('dani', 'clave-segura-3');
  const list = (await dani('GET', '/contents?with_resources=1')).data;
  assert.ok(list.some((c) => c.id === card.id));
  assert.equal((await dani('PATCH', `/resources/${card.resources[0].id}`, { done: true })).status, 200);
  assert.equal((await dani('GET', '/contents?from=2026-10-01&to=2026-11-01')).status, 403);
  assert.equal((await dani('PUT', `/contents/${card.id}`, { title: 'Cambiada' })).status, 403);
  assert.equal((await dani('DELETE', `/contents/${card.id}`)).status, 403);
});

test('los cambios de un rol se aplican al momento', async () => {
  const pablo = await loginAs('pablo', 'clave-segura-2');
  assert.equal((await pablo('GET', '/contents?unscheduled=1')).status, 403);
  const caster = await role('CASTER');
  await api('PATCH', `/roles/${caster.id}`, { sections: ['escaleta', 'calendario'] });
  assert.equal((await pablo('GET', '/contents?unscheduled=1')).status, 200);
  await api('DELETE', `/roles/${caster.id}`);
  assert.equal((await pablo('GET', '/rundowns')).status, 401, 'al borrar su último rol de staff pierde la sesión');
  assert.equal((await pablo('GET', '/me')).status, 401);
});

test('desactivar o cambiar la contraseña de alguien cierra sus sesiones', async () => {
  const users = (await api('GET', '/users')).data;
  const lucia = users.find((u) => u.username === 'lucia.rrss');
  const pablo = users.find((u) => u.username === 'pablo');
  await api('PATCH', `/users/${pablo.id}`, { role_ids: [(await role('PRODUCCIÓN')).id] });
  const luciaSession = await loginAs('lucia.rrss', 'clave-segura-1');
  const pabloSession = await loginAs('pablo', 'clave-segura-2');

  await api('PATCH', `/users/${pablo.id}`, { active: false });
  assert.equal((await pabloSession('GET', '/me')).status, 401);
  const blocked = await makeClient()('POST', '/auth/login', { username: 'pablo', password: 'clave-segura-2' });
  assert.equal(blocked.status, 401);
  assert.match(blocked.data.error, /desactivado/);

  await api('PATCH', `/users/${lucia.id}`, { password: 'clave-nueva-123' });
  assert.equal((await luciaSession('GET', '/me')).status, 401);
  await loginAs('lucia.rrss', 'clave-nueva-123');
});

test('nunca se queda la intranet sin administrador', async () => {
  const me = (await api('GET', '/me')).data;
  assert.equal((await api('DELETE', `/users/${me.id}`)).status, 400);
  assert.equal((await api('PATCH', `/users/${me.id}`, { is_admin: false })).status, 400);
  assert.equal((await api('PATCH', `/users/${me.id}`, { active: false })).status, 400);

  // Con un segundo administrador sí se puede degradar al primero (desde el segundo).
  const second = (await api('POST', '/users', { username: 'jefa', password: 'clave-segura-4', is_admin: true })).data;
  const jefa = await loginAs('jefa', 'clave-segura-4');
  assert.equal((await jefa('PATCH', `/users/${me.id}`, { is_admin: false })).status, 200);
  assert.equal((await api('GET', '/users')).status, 401, 'el antiguo admin sin rol staff pierde la sesión');
  assert.equal((await jefa('PATCH', `/users/${me.id}`, { is_admin: true })).status, 200);
  assert.equal((await api('POST', '/auth/login', { username: 'admin', password: 'contraseña-vieja' })).status, 200);
  assert.equal((await api('DELETE', `/users/${second.id}`)).status, 200);
});

test('cada usuario cambia su propia contraseña', async () => {
  const lucia = await loginAs('lucia.rrss', 'clave-nueva-123');
  assert.equal((await lucia('POST', '/me/password', { current: 'mal', next: 'otra-clave-123' })).status, 400);
  assert.equal((await lucia('POST', '/me/password', { current: 'clave-nueva-123', next: 'otra-clave-123' })).status, 200);
  assert.equal((await lucia('GET', '/me')).status, 200, 'la sesión actual sigue abierta');
  await loginAs('lucia.rrss', 'otra-clave-123');
});

// ---------- Disponibilidad ----------

test('la disponibilidad se pide solo para los días de evento de la temporada', async () => {
  const days = (await api('GET', '/availability')).data.days;
  assert.equal(days.length, 14);
  assert.deepEqual(days[0], { date: '2026-11-08', event: 'Inaugural', main: true });
  assert.deepEqual(
    days.filter((d) => !d.main).map((d) => d.date),
    ['2027-05-21', '2027-05-24', '2027-07-01', '2027-07-05'],
    'los días entre paréntesis son previos o posteriores',
  );
});

test('cada caster marca su disponibilidad y el admin ve y edita la de todos', async () => {
  const locutor = (await api('POST', '/roles', { name: 'LOCUTOR', staff_kind: 'caster', sections: ['disponibilidad'] })).data;
  const ana = (await api('POST', '/users', { username: 'ana', name: 'Ana', password: 'clave-segura-5', role_ids: [locutor.id] })).data;
  const bea = (await api('POST', '/users', { username: 'bea', name: 'Bea', password: 'clave-segura-6', role_ids: [locutor.id] })).data;
  const anaS = await loginAs('ana', 'clave-segura-5');
  const beaS = await loginAs('bea', 'clave-segura-6');

  assert.equal((await anaS('PUT', '/availability/2026-11-08', { status: 'disponible', note: 'desde las 16:00' })).status, 200);
  assert.equal((await anaS('PUT', '/availability/2027-05-21', { status: 'no_disponible' })).status, 200);
  assert.equal((await beaS('PUT', '/availability/2026-11-08', { status: 'disponible' })).status, 200);

  // Borrar = status null; solo días de evento y estados válidos.
  assert.equal((await beaS('PUT', '/availability/2026-11-08', { status: null })).status, 200);
  assert.equal((await beaS('PUT', '/availability/2026-11-09', { status: 'disponible' })).status, 400);
  assert.equal((await beaS('PUT', '/availability/2026-12-20', { status: 'quizas' })).status, 400);

  // Nadie cambia la de otro… salvo el administrador.
  assert.equal((await beaS('PUT', '/availability/2026-11-08', { status: 'no_disponible', user_id: ana.id })).status, 403);
  assert.equal((await api('PUT', '/availability/2026-12-20', { status: 'disponible', user_id: bea.id })).status, 200);

  const view = (await anaS('GET', '/availability')).data;
  assert.equal(view.me_in_team, true);
  assert.deepEqual(view.users.map((u) => u.name), ['Ana', 'Bea']);
  assert.deepEqual(
    view.entries.map((e) => [e.user_id === ana.id ? 'Ana' : 'Bea', e.date, e.status, e.note]),
    [
      ['Ana', '2026-11-08', 'disponible', 'desde las 16:00'],
      ['Bea', '2026-12-20', 'disponible', ''],
      ['Ana', '2027-05-21', 'no_disponible', ''],
    ],
  );

  // El admin sin el rol ve el equipo pero no aparece en él.
  const adminView = (await api('GET', '/availability')).data;
  assert.equal(adminView.me_in_team, false);
  assert.equal((await api('PUT', '/availability/2026-11-08', { status: 'disponible' })).status, 400);
});

test('el administrador gestiona los días de evento', async () => {
  const ana = await loginAs('ana', 'clave-segura-5');
  assert.equal((await ana('POST', '/availability/days', { date: '2027-01-17', event: 'Cup' })).status, 403);

  let days = (await api('POST', '/availability/days', { date: '2027-01-17', event: 'Cup' })).data;
  assert.ok(days.some((d) => d.date === '2027-01-17' && d.event === 'Cup' && d.main));
  days = (await api('POST', '/availability/days', { date: '2027-01-17', event: 'Cup #05', main: false })).data;
  assert.deepEqual(days.find((d) => d.date === '2027-01-17'), { date: '2027-01-17', event: 'Cup #05', main: false });
  assert.equal((await api('POST', '/availability/days', { date: '2027-01-17', event: ' ' })).status, 400);

  assert.equal((await ana('PUT', '/availability/2027-01-17', { status: 'disponible' })).status, 200);
  days = (await api('DELETE', '/availability/days/2027-01-17')).data;
  assert.ok(!days.some((d) => d.date === '2027-01-17'));
  // Lo marcado ese día deja de mostrarse.
  assert.ok(!(await ana('GET', '/availability')).data.entries.some((e) => e.date === '2027-01-17'));
  assert.equal((await api('DELETE', '/availability/days/2027-01-17')).status, 404);
});

test('sin un rol con Disponibilidad no se entra en la sección', async () => {
  const lucia = await loginAs('lucia.rrss', 'otra-clave-123');
  assert.equal((await lucia('GET', '/availability')).status, 403);
  assert.equal((await lucia('PUT', '/availability/2026-11-08', { status: 'disponible' })).status, 403);

  // Si se quita la sección al rol, esas personas desaparecen del equipo.
  const locutor = await role('LOCUTOR');
  await api('PATCH', `/roles/${locutor.id}`, { sections: ['escaleta'] });
  const ana = await loginAs('ana', 'clave-segura-5');
  assert.equal((await ana('GET', '/availability')).status, 403);
  assert.deepEqual((await api('GET', '/availability')).data.users, []);
});

// ---------- Tablero (Directivos) ----------

test('el tablero empieza con listas y etiquetas y solo lo ven Directivos y admin', async () => {
  const board = (await api('GET', '/board')).data;
  assert.deepEqual(board.lists.map((l) => l.title), ['Por hacer', 'En curso', 'En revisión', 'Hecho']);
  assert.deepEqual(board.labels.map((l) => l.name), ['Urgente', 'Importante', 'Evento', 'Patrocinio', 'Contenido', 'Equipo']);

  const directivos = await role('DIRECTIVOS');
  await api('POST', '/users', { username: 'dire', name: 'Dirección', password: 'clave-segura-7', role_ids: [directivos.id] });
  const dire = await loginAs('dire', 'clave-segura-7');
  assert.equal((await dire('GET', '/board')).status, 200);
  assert.ok((await dire('GET', '/board')).data.members.some((m) => m.name === 'Dirección'));
  assert.equal((await dire('GET', '/contents?unscheduled=1')).status, 403);

  const lucia = await loginAs('lucia.rrss', 'otra-clave-123');
  assert.equal((await lucia('GET', '/board')).status, 403);
  assert.equal((await lucia('POST', '/board/cards', { list_id: board.lists[0].id, title: 'x' })).status, 403);
});

test('tarjetas: crear, mover entre listas y reordenar', async () => {
  const dire = await loginAs('dire', 'clave-segura-7');
  let board = (await dire('GET', '/board')).data;
  const [todo, doing] = board.lists;
  const titles = ['Cerrar sponsor', 'Reservar sede LAN', 'Contratar casters'];
  const ids = [];
  for (const title of titles) ids.push((await dire('POST', '/board/cards', { list_id: todo.id, title })).data.id);
  assert.equal((await dire('POST', '/board/cards', { list_id: todo.id, title: '  ' })).status, 400);

  // Mover la primera al final de "En curso" y la tercera al principio de "Por hacer".
  board = (await dire('PUT', `/board/cards/${ids[0]}/move`, { list_id: doing.id, position: 0 })).data;
  board = (await dire('PUT', `/board/cards/${ids[2]}/move`, { list_id: todo.id, position: 0 })).data;
  const titlesIn = (b, listId) => b.lists.find((l) => l.id === listId).cards.map((c) => c.title);
  assert.deepEqual(titlesIn(board, todo.id), ['Contratar casters', 'Reservar sede LAN']);
  assert.deepEqual(titlesIn(board, doing.id), ['Cerrar sponsor']);
  // Una posición mayor que la lista la deja al final.
  board = (await dire('PUT', `/board/cards/${ids[2]}/move`, { list_id: todo.id, position: 99 })).data;
  assert.deepEqual(titlesIn(board, todo.id), ['Reservar sede LAN', 'Contratar casters']);
});

test('detalle de tarjeta: etiquetas, personas, fecha, checklist y comentarios', async () => {
  const dire = await loginAs('dire', 'clave-segura-7');
  const board = (await dire('GET', '/board')).data;
  const card = board.lists.flatMap((l) => l.cards).find((c) => c.title === 'Cerrar sponsor');
  const me = board.members.find((m) => m.name === 'Dirección');
  const urgente = board.labels.find((l) => l.name === 'Urgente');

  let full = (
    await dire('PATCH', `/board/cards/${card.id}`, {
      description: 'Llamar el lunes',
      labels: [urgente.id],
      members: [me.id],
      due_date: '2026-10-30',
    })
  ).data;
  assert.equal(full.description, 'Llamar el lunes');
  assert.deepEqual(full.labels, [urgente.id]);
  assert.deepEqual(full.members, [me.id]);
  assert.equal(full.due_date, '2026-10-30');
  full = (await dire('PATCH', `/board/cards/${card.id}`, { due_done: true })).data;
  assert.equal(full.due_done, true);
  assert.equal((await dire('PATCH', `/board/cards/${card.id}`, { labels: [999] })).status, 400);
  const lucia = (await api('GET', '/users')).data.find((u) => u.username === 'lucia.rrss');
  assert.equal((await dire('PATCH', `/board/cards/${card.id}`, { members: [lucia.id] })).status, 400, 'solo gente con acceso al tablero');

  full = (await dire('POST', `/board/cards/${card.id}/checklist`, { text: 'Enviar propuesta' })).data;
  full = (await dire('POST', `/board/cards/${card.id}/checklist`, { text: 'Firmar contrato' })).data;
  full = (await dire('PATCH', `/board/checklist/${full.checklist[0].id}`, { done: true })).data;
  assert.deepEqual(full.checklist.map((i) => [i.text, i.done]), [['Enviar propuesta', true], ['Firmar contrato', false]]);
  full = (await dire('DELETE', `/board/checklist/${full.checklist[1].id}`)).data;
  assert.equal(full.checklist.length, 1);

  full = (await dire('POST', `/board/cards/${card.id}/comments`, { text: 'Me han dicho que sí' })).data;
  assert.equal(full.comments[0].author, 'Dirección');
  // Nadie borra comentarios ajenos… salvo el administrador.
  const directivos = await role('DIRECTIVOS');
  await api('POST', '/users', { username: 'dire2', password: 'clave-segura-8', role_ids: [directivos.id] });
  const dire2 = await loginAs('dire2', 'clave-segura-8');
  assert.equal((await dire2('DELETE', `/board/comments/${full.comments[0].id}`)).status, 403);
  full = (await api('DELETE', `/board/comments/${full.comments[0].id}`)).data;
  assert.equal(full.comments.length, 0);

  // El resumen del tablero refleja los detalles.
  const summary = (await dire('GET', '/board')).data.lists.flatMap((l) => l.cards).find((c) => c.id === card.id);
  assert.deepEqual(
    { desc: summary.has_description, checklist: summary.checklist, comments: summary.comments, due_done: summary.due_done },
    { desc: true, checklist: { total: 1, done: 1 }, comments: 0, due_done: true },
  );
});

test('listas: crear, renombrar, reordenar y borrar (con sus tarjetas)', async () => {
  const dire = await loginAs('dire', 'clave-segura-7');
  let board = (await dire('POST', '/board/lists', { title: 'Ideas' })).data;
  assert.equal(board.lists.at(-1).title, 'Ideas');
  const ideas = board.lists.at(-1);
  board = (await dire('PATCH', `/board/lists/${ideas.id}`, { title: 'Ideas 2027' })).data;
  const order = [ideas.id, ...board.lists.filter((l) => l.id !== ideas.id).map((l) => l.id)];
  board = (await dire('PUT', '/board/lists/order', { ids: order })).data;
  assert.equal(board.lists[0].title, 'Ideas 2027');
  assert.equal((await dire('PUT', '/board/lists/order', { ids: [ideas.id] })).status, 400);

  const card = (await dire('POST', '/board/cards', { list_id: ideas.id, title: 'Merchandising' })).data;
  board = (await dire('DELETE', `/board/lists/${ideas.id}`)).data;
  assert.ok(!board.lists.some((l) => l.id === ideas.id));
  assert.equal((await dire('GET', `/board/cards/${card.id}`)).status, 404, 'sus tarjetas se borran con ella');

  const labels = (await dire('PATCH', `/board/labels/${board.labels[0].id}`, { name: 'Muy urgente' })).data;
  assert.equal(labels[0].name, 'Muy urgente');
});
