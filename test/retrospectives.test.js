import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createRetrospectiveStore, RetrospectiveError } from '../server/retrospectives.js';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,username TEXT,is_admin INTEGER,active INTEGER);
    CREATE TABLE roles(id INTEGER PRIMARY KEY,staff_kind TEXT);
    CREATE TABLE user_roles(user_id INTEGER,role_id INTEGER);
    INSERT INTO users VALUES(1,'Responsable','admin',1,1),(2,'Coordinación','coord',0,1),(3,'Caster','caster',0,1),
      (4,'Otra persona','outsider',0,1),(5,'Desactivado','disabled',0,0),(6,'Árbitro','referee',0,1);
    INSERT INTO roles VALUES(1,'operations'),(2,'caster'),(3,'referee');
    INSERT INTO user_roles VALUES(2,1),(3,2),(5,2),(6,3);
    CREATE TABLE preserved_data(value TEXT);INSERT INTO preserved_data VALUES('keep');`);
  const now = Date.parse('2026-11-09T15:36:42.000Z');
  const store = createRetrospectiveStore(db, { clock: () => now });
  const admin = { id: 1, is_admin: true, auth_mode: 'local', roles: [] };
  const coord = { id: 2, is_admin: false, auth_mode: 'local', roles: [{ staff_kind: 'operations' }] };
  const staff = { id: 3, is_admin: false, auth_mode: 'local', roles: [{ staff_kind: 'caster' }] };
  const referee = { id: 6, is_admin: false, auth_mode: 'local', roles: [{ staff_kind: 'referee' }] };
  const outsider = { id: 4, is_admin: false, auth_mode: 'local', roles: [] };
  const cycle = store.create(admin, { title: 'Retrospectiva Inaugural', eventName: 'Torneo Inaugural CTP', eventDate: '2026-11-08' });
  const item = (overrides = {}, viewer = staff, id = cycle.id) => store.createItem(viewer, id, {
    kind: 'improve', area: 'technology', severity: 'high', title: 'Reducir las esperas',
    description: 'Un hecho concreto', proposal: 'Preparar una comprobación previa', evidenceUrl: '', anonymous: false, ...overrides,
  });
  return { db, store, admin, coord, staff, referee, outsider, cycle, item, now };
}
const error = (run, status) => assert.throws(run, value => value instanceof RetrospectiveError && value.status === status);

test('retrospective schema is additive, idempotent and does not seed event or staff data', () => {
  const f = fixture();
  const counts = f.db.prepare('SELECT count(*) n FROM users').get().n;
  createRetrospectiveStore(f.db);
  assert.equal(f.db.prepare('SELECT value FROM preserved_data').get().value, 'keep');
  assert.equal(f.db.prepare('SELECT count(*) n FROM users').get().n, counts);
  assert.equal(f.store.list(f.admin).retrospectives.length, 1);
  f.db.close();
});

test('every authorized staff role participates but only management creates or configures cycles', () => {
  const f = fixture();
  assert.equal(f.store.list(f.staff).permissions.participate, true);
  assert.equal(f.store.list(f.referee).permissions.manage, false);
  assert.equal(f.store.list(f.coord).permissions.manage, true);
  assert.equal(f.item({}, f.referee).item.author.id, f.referee.id);
  error(() => f.store.create(f.staff, { title: 'Bad', eventName: 'Bad' }), 403);
  error(() => f.store.update(f.staff, f.cycle.id, { phase: 'closed' }), 403);
  error(() => f.store.list(f.outsider), 403);
  error(() => f.store.list({ ...f.staff, id: 5 }), 403);
  error(() => f.store.list({ ...f.staff, id: 999 }), 403);
  error(() => f.store.list(null), 403);
  f.db.close();
});

test('anonymous contribution stores no author, only a hashed possession key and a coarse day', () => {
  const f = fixture(); const { item, editKey } = f.item({ anonymous: true });
  assert.match(editKey, /^[a-f0-9]{64}$/);
  const raw = f.db.prepare('SELECT * FROM retro_items WHERE id=?').get(item.id);
  assert.equal(raw.author_id, null);
  assert.notEqual(raw.edit_key_hash, editKey);
  assert.equal(raw.edit_key_hash, createHash('sha256').update(editKey).digest('hex'));
  assert.equal(raw.created_at, Date.parse('2026-11-09T00:00:00Z'));
  assert.equal(raw.updated_at, raw.created_at);
  const visible = f.store.detail(f.admin, f.cycle.id).items[0];
  assert.equal(visible.anonymous, true); assert.equal(visible.author, null);
  assert.equal(visible.createdAt, '2026-11-09');
  assert.doesNotMatch(JSON.stringify(visible), /editKey|edit_key_hash|author_id|ctp_user_id|password|session/);
  assert.equal(f.store.detail(f.staff, f.cycle.id).items[0].canEdit, false);
  f.db.close();
});

test('only the anonymous possession key can edit; identity cannot be added later even by management', () => {
  const f = fixture(); const created = f.item({ anonymous: true });
  error(() => f.store.updateItem(f.referee, f.cycle.id, created.item.id, { title: 'Hijack' }), 403);
  error(() => f.store.updateItem(f.admin, f.cycle.id, created.item.id, { title: 'Management rewrite' }), 403);
  error(() => f.store.updateItem(f.referee, f.cycle.id, created.item.id, { title: 'Hijack', editKey: 'a'.repeat(64) }), 403);
  const result = f.store.updateItem(f.staff, f.cycle.id, created.item.id, { title: 'Ajuste propio', editKey: created.editKey });
  assert.equal(result.item.title, 'Ajuste propio');
  error(() => f.store.updateItem(f.staff, f.cycle.id, created.item.id, { anonymous: false, editKey: created.editKey }), 400);
  error(() => f.store.updateItem(f.staff, f.cycle.id, created.item.id, { authorId: f.staff.id, editKey: created.editKey }), 400);
  assert.equal(f.db.prepare('SELECT author_id FROM retro_items WHERE id=?').get(created.item.id).author_id, null);
  f.db.close();
});

test('named authors can edit their own text; moderator archiving never deletes the contribution', () => {
  const f = fixture(); const created = f.item();
  assert.equal(created.item.author.id, f.staff.id);
  error(() => f.store.updateItem(f.referee, f.cycle.id, created.item.id, { title: 'Other' }), 403);
  assert.equal(f.store.updateItem(f.staff, f.cycle.id, created.item.id, { title: 'Updated' }).item.title, 'Updated');
  f.store.archiveItem(f.coord, f.cycle.id, created.item.id);
  assert.equal(f.store.detail(f.staff, f.cycle.id).items.length, 0);
  const raw = f.db.prepare('SELECT archived,title,author_id FROM retro_items WHERE id=?').get(created.item.id);
  assert.equal(raw.archived, 1); assert.equal(raw.title, 'Updated'); assert.equal(raw.author_id, f.staff.id);
  const archived = f.store.detail(f.admin, f.cycle.id).items[0];
  assert.equal(archived.archived, true); assert.equal(archived.canEdit, false); assert.equal(archived.canArchive, false);
  assert.equal(f.store.export(f.admin, f.cycle.id).items.length, 0);
  f.db.close();
});

test('anonymous withdrawal needs the possession key and keeps an author-free record', () => {
  const f = fixture(); const created = f.item({ anonymous: true });
  error(() => f.store.archiveItem(f.referee, f.cycle.id, created.item.id), 403);
  f.store.archiveItem(f.staff, f.cycle.id, created.item.id, { editKey: created.editKey });
  const raw = f.db.prepare('SELECT archived,author_id FROM retro_items WHERE id=?').get(created.item.id);
  assert.equal(raw.archived, 1); assert.equal(raw.author_id, null);
  f.db.close();
});

test('item and action IDs cannot cross cycles, including with a valid possession key', () => {
  const f = fixture(); const created = f.item({ anonymous: true });
  const other = f.store.create(f.admin, { title: 'Otro evento', eventName: 'Otro evento' });
  error(() => f.store.updateItem(f.staff, other.id, created.item.id, { title: 'Wrong cycle', editKey: created.editKey }), 404);
  error(() => f.store.vote(f.staff, other.id, created.item.id, { voted: true }), 404);
  error(() => f.store.createComment(f.staff, other.id, created.item.id, { text: 'Wrong', anonymous: true }), 404);
  error(() => f.store.createAction(f.admin, other.id, { itemId: created.item.id, title: 'Wrong' }), 404);
  const action = f.store.createAction(f.admin, f.cycle.id, { title: 'Correct action' });
  error(() => f.store.updateAction(f.admin, other.id, action.id, { status: 'done' }), 404);
  f.db.close();
});

test('votes are idempotent per staff account, counts never duplicate and voter lists remain private', () => {
  const f = fixture(); const created = f.item();
  assert.deepEqual(f.store.vote(f.staff, f.cycle.id, created.item.id, { voted: true }), { votes: 1, viewerVoted: true });
  assert.equal(f.store.vote(f.staff, f.cycle.id, created.item.id, { voted: true }).votes, 1);
  assert.equal(f.store.vote(f.referee, f.cycle.id, created.item.id, { voted: true }).votes, 2);
  const dto = f.store.detail(f.coord, f.cycle.id).items[0];
  assert.equal(dto.votes, 2); assert.equal(dto.viewerVoted, false); assert.equal('voters' in dto, false);
  assert.equal(f.store.vote(f.staff, f.cycle.id, created.item.id, { voted: false }).votes, 1);
  assert.equal(f.store.detail(f.admin, f.cycle.id).retrospective.counts.votes, 1);
  f.db.close();
});

test('anonymous comments retain no author or exact timestamp in database or export', () => {
  const f = fixture(); const created = f.item();
  const result = f.store.createComment(f.referee, f.cycle.id, created.item.id, { text: 'Otra perspectiva', anonymous: true });
  const raw = f.db.prepare('SELECT * FROM retro_comments WHERE id=?').get(result.comment.id);
  assert.equal(raw.author_id, null); assert.equal(raw.created_at, Date.parse('2026-11-09T00:00:00Z'));
  assert.equal(result.comment.author, null); assert.equal(result.comment.createdAt, '2026-11-09');
  const out = f.store.export(f.admin, f.cycle.id);
  assert.equal(out.items[0].comments[0].author, null);
  assert.doesNotMatch(JSON.stringify(out), /editKey|edit_key_hash|author_id|viewerVoted|canEdit|canArchive|voters/);
  assert.equal(f.store.createComment(f.staff, f.cycle.id, created.item.id, { text: 'Firmado', anonymous: false }).comment.author.id, f.staff.id);
  f.db.close();
});

test('removed staff accounts do not erase criticism or invent an anonymous author', () => {
  const f = fixture(); const named = f.item(); const anonymous = f.item({ anonymous: true });
  f.store.createComment(f.staff, f.cycle.id, named.item.id, { text: 'Comentario firmado', anonymous: false });
  f.db.prepare('DELETE FROM users WHERE id=?').run(f.staff.id);
  const detail = f.store.detail(f.admin, f.cycle.id);
  const kept = detail.items.find(item => item.id === named.item.id);
  assert.equal(kept.anonymous, false); assert.equal(kept.author, null);
  assert.equal(kept.comments[0].anonymous, false); assert.equal(kept.comments[0].author, null);
  assert.equal(detail.items.find(item => item.id === anonymous.item.id).anonymous, true);
  assert.equal(f.db.prepare('SELECT count(*) n FROM retro_items').get().n, 2);
  f.db.close();
});

test('reviewing locks new or edited feedback; closed locks votes/comments but action follow-up continues', () => {
  const f = fixture(); const created = f.item();
  const action = f.store.createAction(f.admin, f.cycle.id, { title: 'Resolver', ownerId: f.staff.id });
  f.store.update(f.coord, f.cycle.id, { phase: 'reviewing' });
  error(() => f.item(), 409);
  error(() => f.store.updateItem(f.staff, f.cycle.id, created.item.id, { title: 'Locked' }), 409);
  assert.equal(f.store.vote(f.staff, f.cycle.id, created.item.id, { voted: true }).votes, 1);
  f.store.update(f.admin, f.cycle.id, { phase: 'closed', summary: 'Acuerdos confirmados' });
  error(() => f.store.vote(f.staff, f.cycle.id, created.item.id, { voted: false }), 409);
  error(() => f.store.createComment(f.staff, f.cycle.id, created.item.id, { text: 'Locked', anonymous: true }), 409);
  assert.equal(f.store.updateAction(f.staff, f.cycle.id, action.id, { status: 'done' }).status, 'done');
  assert.equal(f.store.detail(f.staff, f.cycle.id).retrospective.summary, 'Acuerdos confirmados');
  f.db.close();
});

test('only management assigns actions; assignees can change only their own progress', () => {
  const f = fixture(); const created = f.item();
  error(() => f.store.createAction(f.staff, f.cycle.id, { title: 'Not allowed' }), 403);
  error(() => f.store.createAction(f.admin, f.cycle.id, { title: 'Inactive owner', ownerId: 5 }), 400);
  error(() => f.store.createAction(f.admin, f.cycle.id, { title: 'Non-staff owner', ownerId: 4 }), 400);
  const action = f.store.createAction(f.coord, f.cycle.id, { itemId: created.item.id, title: 'Plan operativo', ownerId: f.staff.id, dueDate: '2026-11-20', priority: 'high' });
  error(() => f.store.updateAction(f.referee, f.cycle.id, action.id, { status: 'doing' }), 403);
  error(() => f.store.updateAction(f.staff, f.cycle.id, action.id, { ownerId: f.referee.id }), 400);
  assert.equal(f.store.updateAction(f.staff, f.cycle.id, action.id, { status: 'doing' }).status, 'doing');
  const detail = f.store.detail(f.admin, f.cycle.id);
  assert.equal(detail.retrospective.counts.openActions, 1);
  assert.equal(detail.actions[0].owner.id, f.staff.id);
  assert.equal(detail.people.some(person => person.id === 4 || person.id === 5), false);
  f.db.close();
});

test('management can archive a criticism but cannot silently rewrite another author', () => {
  const f = fixture(); const created = f.item();
  const dto = f.store.detail(f.admin, f.cycle.id).items[0];
  assert.equal(dto.canEdit, false); assert.equal(dto.canArchive, true);
  error(() => f.store.updateItem(f.admin, f.cycle.id, created.item.id, { description: 'Replacement criticism' }), 403);
  assert.equal(f.db.prepare('SELECT description FROM retro_items WHERE id=?').get(created.item.id).description, 'Un hecho concreto');
  f.store.archiveItem(f.admin, f.cycle.id, created.item.id);
  assert.equal(f.store.detail(f.admin, f.cycle.id).items[0].archived, true);
  f.db.close();
});

test('CTP assignee eligibility follows central staff grants rather than stale local roles', () => {
  const f = fixture();
  f.db.exec(`ALTER TABLE users ADD COLUMN ctp_user_id TEXT;ALTER TABLE users ADD COLUMN ctp_role TEXT;
    ALTER TABLE users ADD COLUMN ctp_staff_kind TEXT;
    UPDATE users SET ctp_user_id='11111111-1111-4111-8111-111111111111',ctp_role='admin' WHERE id=1;
    UPDATE users SET ctp_user_id='22222222-2222-4222-8222-222222222222',ctp_role='staff',ctp_staff_kind='operations' WHERE id=2;
    UPDATE users SET ctp_user_id='33333333-3333-4333-8333-333333333333',ctp_role='staff',ctp_staff_kind='caster' WHERE id=3;
    UPDATE users SET ctp_user_id='44444444-4444-4444-8444-444444444444',ctp_role='player' WHERE id=4;
    DELETE FROM user_roles WHERE user_id=3;INSERT INTO user_roles VALUES(4,1);`);
  const store = createRetrospectiveStore(f.db, { authMode: 'ctp' });
  const admin = { ...f.admin, auth_mode: 'ctp', ctp_user_id: '11111111-1111-4111-8111-111111111111', ctp_role: 'admin' };
  const people = store.detail(admin, f.cycle.id).people;
  assert.equal(people.some(person => person.id === 3), true, 'central caster is eligible without a legacy local assignment');
  assert.equal(people.some(person => person.id === 4), false, 'former local coordinator with central player role is not staff');
  assert.equal(people.some(person => person.id === 5), false, 'inactive account stays excluded');
  error(() => store.createAction(admin, f.cycle.id, { title: 'Invalid', ownerId: 4 }), 400);
  assert.equal(store.createAction(admin, f.cycle.id, { title: 'Valid', ownerId: 3 }).owner.id, 3);
  f.db.close();
});

test('validation rejects unknown fields, malformed dates/links, oversized text and identity spoofing', () => {
  const f = fixture();
  error(() => f.store.create(f.admin, { title: 'Title', eventName: 'Event', eventDate: '2026-02-31' }), 400);
  error(() => f.store.create(f.admin, { title: 'Title', eventName: 'Event', ownerId: 3 }), 400);
  for (const overrides of [{ title: '' }, { description: 'a'.repeat(6001) }, { title: 'x'.repeat(161) },
    { severity: 'fatal' }, { area: 'secret' }, { evidenceUrl: 'javascript:alert(1)' }, { evidenceUrl: 'https://user:password@example.invalid' },
    { anonymous: 'true' }, { authorId: 1 }, { createdAt: 0 }]) error(() => f.item(overrides), 400);
  const created = f.item();
  error(() => f.store.createComment(f.staff, f.cycle.id, created.item.id, { text: 'Test', anonymous: true, authorId: 1 }), 400);
  error(() => f.store.vote(f.staff, f.cycle.id, created.item.id, { voted: true, userId: 1 }), 400);
  error(() => f.store.createAction(f.admin, f.cycle.id, { title: 'Date', dueDate: 'yesterday' }), 400);
  f.db.close();
});

test('the cycle text budget rolls back rejected writes and retains archived criticism in its budget', () => {
  const f = fixture(); const original = f.item();
  const action = f.store.createAction(f.admin, f.cycle.id, { title: 'Acuerdo existente', description: 'Conservar' });
  const large = { title: 'Aportación extensa', description: 'a'.repeat(6000), proposal: 'b'.repeat(3000), anonymous: true };
  const accepted = [];
  for (let index = 0; index < 200; index++) {
    try { accepted.push(f.item(large).item); }
    catch (value) { assert.equal(value.status, 413); break; }
  }
  assert.ok(accepted.length > 100 && accepted.length < 120);
  for (let index = 0; index < 5; index++) {
    try { f.store.createComment(f.staff, f.cycle.id, original.item.id, { text: 'c'.repeat(3000), anonymous: true }); }
    catch (value) { assert.equal(value.status, 413); break; }
  }
  const total = f.db.prepare('SELECT count(*) n FROM retro_items').get().n;
  const commentCount = f.db.prepare('SELECT count(*) n FROM retro_comments').get().n;
  error(() => f.item(large), 413);
  assert.equal(f.db.prepare('SELECT count(*) n FROM retro_items').get().n, total, 'rejected create leaves no anonymous key or partial row');
  error(() => f.store.updateItem(f.staff, f.cycle.id, original.item.id, { description: 'a'.repeat(6000), proposal: 'b'.repeat(3000) }), 413);
  assert.equal(f.db.prepare('SELECT description FROM retro_items WHERE id=?').get(original.item.id).description, 'Un hecho concreto');
  error(() => f.store.createComment(f.staff, f.cycle.id, original.item.id, { text: 'c'.repeat(3000), anonymous: true }), 413);
  assert.equal(f.db.prepare('SELECT count(*) n FROM retro_comments').get().n, commentCount);
  error(() => f.store.updateAction(f.admin, f.cycle.id, action.id, { description: 'a'.repeat(6000) }), 413);
  assert.equal(f.db.prepare('SELECT description FROM retro_actions WHERE id=?').get(action.id).description, 'Conservar');
  error(() => f.store.createAction(f.admin, f.cycle.id, { title: 'Nueva', description: 'a'.repeat(6000) }), 413);
  assert.equal(f.db.prepare('SELECT count(*) n FROM retro_actions').get().n, 1);
  error(() => f.store.update(f.admin, f.cycle.id, { summary: 'c'.repeat(12000) }), 413);
  assert.equal(f.db.prepare('SELECT summary FROM retro_sessions WHERE id=?').get(f.cycle.id).summary, '');
  f.store.archiveItem(f.admin, f.cycle.id, accepted[0].id);
  assert.equal(f.db.prepare('SELECT count(*) n FROM retro_items').get().n, total);
  error(() => f.item(large), 413, 'archiving cannot replenish storage capacity');
  assert.equal(f.db.prepare('SELECT description FROM retro_items WHERE id=?').get(accepted[0].id).description.length, 6000);
  f.db.close();
});

test('the global comment cap cannot be bypassed by spreading comments across items', () => {
  const f = fixture(); const items = Array.from({ length: 11 }, () => f.item().item);
  for (const item of items.slice(0, 10)) {
    for (let index = 0; index < 100; index++) f.store.createComment(f.staff, f.cycle.id, item.id, { text: 'x', anonymous: true });
  }
  assert.equal(f.db.prepare('SELECT count(*) n FROM retro_comments').get().n, 1000);
  error(() => f.store.createComment(f.staff, f.cycle.id, items[10].id, { text: 'x', anonymous: true }), 413);
  assert.equal(f.db.prepare('SELECT count(*) n FROM retro_comments').get().n, 1000);
  f.store.archiveItem(f.admin, f.cycle.id, items[0].id);
  error(() => f.store.createComment(f.staff, f.cycle.id, items[10].id, { text: 'x', anonymous: true }), 413);
  assert.equal(f.db.prepare('SELECT count(*) n FROM retro_comments').get().n, 1000);
  f.db.close();
});

test('large detail reads batch authors, comments and votes with a constant query bound', () => {
  const f = fixture();
  for (let itemIndex = 0; itemIndex < 20; itemIndex++) {
    const { item } = f.item({ anonymous: itemIndex % 2 === 0 });
    f.store.vote(f.referee, f.cycle.id, item.id, { voted: true });
    for (let index = 0; index < 10; index++) f.store.createComment(f.referee, f.cycle.id, item.id, { text: 'Comentario útil', anonymous: index % 2 === 0 });
    f.store.createAction(f.admin, f.cycle.id, { itemId: item.id, title: 'Acción de seguimiento', ownerId: f.staff.id });
  }
  let queries = 0;
  const tracked = { exec: (...args) => f.db.exec(...args), prepare: (...args) => { queries++; return f.db.prepare(...args); } };
  const store = createRetrospectiveStore(tracked); queries = 0;
  const detail = store.detail(f.admin, f.cycle.id);
  assert.ok(queries <= 20, `detail should batch lookups, observed ${queries} queries`);
  assert.equal(detail.items.length, 20); assert.equal(detail.actions.length, 20);
  assert.equal(detail.items.reduce((sum, item) => sum + item.comments.length, 0), 200);
  for (const item of detail.items) {
    assert.equal(item.votes, 1);
    if (item.anonymous) assert.equal(item.author, null);
    for (const comment of item.comments) if (comment.anonymous) assert.equal(comment.author, null);
  }
  assert.equal(detail.actions[0].owner.id, f.staff.id);
  assert.doesNotMatch(JSON.stringify(detail), /editKey|edit_key_hash|author_id/);
  f.db.close();
});
