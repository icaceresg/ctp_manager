import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import { createRetrospectiveStore } from '../server/retrospectives.js';

// The module's default server instance stays in a throwaway in-memory database.
// This harness neither opens the shared DEV SQLite file nor contacts CTP.
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-retro-http-'));
process.env.DATA_DIR = temporary;
process.env.DB_PATH = ':memory:';
process.env.CTP_AUTH_MODE = 'local';
process.env.PUBLIC_ORIGIN = '';
const { createRetrospectivesRouter } = await import('../server/routes/retrospectives.js');

test('HTTP routes require staff, preserve anonymous authorship and return controlled errors', async t => {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,username TEXT,is_admin INTEGER,active INTEGER);
    CREATE TABLE roles(id INTEGER PRIMARY KEY,staff_kind TEXT);
    CREATE TABLE user_roles(user_id INTEGER,role_id INTEGER);
    INSERT INTO users VALUES(1,'QA Admin','qaadmin',1,1),(2,'QA Staff','qastaff',0,1),(3,'QA Sin rol','qaoutsider',0,1);
    INSERT INTO roles VALUES(1,'caster');INSERT INTO user_roles VALUES(2,1);`);
  const admin = { id: 1, is_admin: true, auth_mode: 'local', roles: [] };
  const staff = { id: 2, is_admin: false, auth_mode: 'local', roles: [{ staff_kind: 'caster' }] };
  const outsider = { id: 3, is_admin: false, auth_mode: 'local', roles: [] };
  const store = createRetrospectiveStore(db);
  const app = express(); app.use(express.json({ limit: '1mb' }));
  const authenticate = (req, res, next) => {
    const user = { admin, staff, outsider }[req.get('x-fixture-user')];
    if (!user) return res.status(401).json({ error: 'Necesitas iniciar sesión.' });
    req.user = user; next();
  };
  app.use('/api', createRetrospectivesRouter(store, authenticate));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.status ? error.message : 'Error interno.' }));
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  const origin = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (user, route, method = 'GET', body) => {
    const response = await fetch(origin + route, { method, headers: { ...(user ? { 'x-fixture-user': user } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  t.after(async () => {
    await new Promise(resolve => server.close(resolve)); db.close();
    const target = fs.realpathSync(temporary), expectedParent = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(target).toLowerCase(), expectedParent.toLowerCase());
    assert.ok(path.basename(target).startsWith('ctp-retro-http-'));
    fs.rmSync(target, { recursive: true, force: true });
  });
  assert.equal((await call(null, '/retrospectives')).status, 401);
  assert.equal((await call('outsider', '/retrospectives')).status, 403);
  assert.equal((await call('staff', '/retrospectives', 'POST', { title: 'No', eventName: 'No' })).status, 403);
  const created = await call('admin', '/retrospectives', 'POST', { title: 'QA Retrospectiva', eventName: 'QA Evento', eventDate: '2026-11-08' });
  assert.equal(created.status, 201); const id = created.body.id;
  const contribution = await call('staff', `/retrospectives/${id}/items`, 'POST', { kind: 'improve', area: 'technology', severity: 'high', title: 'QA crítica anónima', anonymous: true });
  assert.equal(contribution.status, 201); assert.equal(contribution.body.item.author, null);
  const itemId = contribution.body.item.id, editKey = contribution.body.editKey;
  const detail = await call('staff', `/retrospectives/${id}`);
  assert.equal(detail.status, 200); assert.equal(detail.body.items.length, 1);
  assert.doesNotMatch(JSON.stringify(detail.body), /editKey|edit_key_hash|author_id/);
  assert.equal((await call('staff', `/retrospectives/${id}/items/${itemId}`, 'PATCH', { title: 'Sin clave' })).status, 403);
  assert.equal((await call('staff', `/retrospectives/${id}/items/${itemId}`, 'PATCH', { title: 'Con clave', editKey })).status, 200);
  const exported = await call('admin', `/retrospectives/${id}/export`);
  assert.equal(exported.status, 200); assert.doesNotMatch(JSON.stringify(exported.body), /editKey|edit_key_hash|viewerVoted|canEdit|author_id/);
  assert.equal((await call('staff', `/retrospectives/${id}/items/${itemId}`, 'DELETE', { editKey })).status, 200);
  assert.equal(db.prepare('SELECT archived FROM retro_items WHERE id=?').get(itemId).archived, 1);
  assert.equal((await call('staff', '/retrospectives/not-a-uuid')).status, 404);
});
