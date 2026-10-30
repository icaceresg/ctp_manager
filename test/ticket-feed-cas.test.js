import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Synthetic CTP DTO inputs, matching SQL069/226, through the actual Manager
// normalizer, thread contract, mirror, SQLite and CAS/queue. No prebuilt local
// mirror, HTTP mock, real account or DEV/PRE/PROD service is used.
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-ticket-feed-cas-'));
Object.assign(process.env, { DATA_DIR: temporary, DB_PATH: path.join(temporary, 'ticket.db'),
  PUBLIC_ORIGIN: '', CTP_AUTH_MODE: 'local', CTP_SYNC_SECONDS: '0' });
const { db } = await import('../server/db.js');
const operations = await import('../server/operations.js');
const { ticketThreadResponse } = await import('../server/ticket-contract.js');
const { operationsWorkspace } = await import('../server/operations-workspace.js');
const owner = '11111111-1111-4111-8111-111111111111';
const staffId = '22222222-2222-4222-8222-222222222222';
const otherStaffId = '33333333-3333-4333-8333-333333333333';
const insert = db.prepare('INSERT INTO users(username,name,password_hash,ctp_user_id,created_at)VALUES(?,?,?,?,?)');
const staff = { id: Number(insert.run('ticket-cas-ref', 'Referee', '!not-a-login', staffId, Date.now()).lastInsertRowid), sections: ['arbitraje'] };
const otherStaff = Number(insert.run('ticket-cas-other', 'Other referee', '!not-a-login', otherStaffId, Date.now()).lastInsertRowid);
const time = '2026-10-29T13:00:00+00:00';
const messageTime = '2026-10-29T13:00:01+00:00';
let serial = 0;

function source({ assigned = null, optional = null, reply = false } = {}) {
  const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(++serial).padStart(12, '0')}`;
  return { ticket: { id, code: 'CTP-OWNED-CASE', type: 'consulta', status: 'abierto', priority: 'media',
    manager_version: 1, description: 'Consulta de prueba aislada', proof_url: null, resolution: null,
    created_at: time, updated_at: time, tournament_match_id: null, challenge_id: null,
    author: { id: owner, username: 'Jugador', gamertag: optional, activision_id: optional, email: null }, assigned },
    messages: reply ? [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', author_id: owner,
      author_name: 'Jugador', is_staff: false, body: 'Respuesta de prueba', created_at: messageTime }] : [],
    events: [], can_change_status: true, viewer_id: staffId };
}

function feed(thread) {
  const t = thread.ticket, last = thread.messages.at(-1);
  return { incidents: [{ id: t.id, match_id: null, kind: 'support', title: `${t.code} · ${t.type}`,
    status: t.status, reason: t.description.slice(0, 2000), resolution: t.resolution,
    created_at: t.created_at, version: t.manager_version, web_path: `/app/tickets/${t.id}`,
    reporter_id: t.author.id, reporter_name: t.author.username,
    assigned_name: t.assigned?.username ?? null, awaiting_staff: last ? !last.is_staff : false,
    last_message_at: last?.created_at ?? null }] };
}

const read = thread => operations.rememberTicketThread(ticketThreadResponse(thread, thread.ticket.id));
const local = thread => operations.incidentDetail(staff, thread.ticket.id).incident;
function initialize(thread) { operations.ingestSnapshot(feed(thread)); read(thread); return local(thread); }

after(() => {
  db.close();
  assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temporary).startsWith('ctp-ticket-feed-cas-'));
  fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5 });
});

for (const variant of [{ optional: null, reply: false }, { optional: '', reply: false }, { optional: null, reply: true }]) {
  test(`unchanged SQL feed and unassigned thread keep CAS stable: optional=${JSON.stringify(variant.optional)}, reply=${variant.reply}`, () => {
    const thread = source(variant), before = initialize(thread);
    for (let cycle = 0; cycle < 20; cycle++) {
      operations.ingestSnapshot(feed(thread));
      read(thread);
      assert.deepEqual(local(thread), before, `cycle ${cycle}: equivalent feed/thread data must not save a competing local edit`);
    }
    const proposal = operations.resolveIncident(staff, thread.ticket.id,
      { expected_version: before.version, decision: 'close', resolution: 'Resolución escrita mientras el feed se actualiza' });
    assert.equal(proposal.command.expected_version, 1);
    assert.equal(proposal.resource.status, 'resolution_pending');
    for (let cycle = 0; cycle < 3; cycle++) { operations.ingestSnapshot(feed(thread)); read(thread); }
    assert.deepEqual(local(thread), proposal.resource, 'equivalent reads also preserve the pending proposal');
  });
}

test('official assignment survives alternating reads, including an assignee without a local Manager login', () => {
  for (const assigned of [{ id: otherStaffId, username: 'Other referee' },
    { id: '44444444-4444-4444-8444-444444444444', username: 'Unlinked referee' }]) {
    const thread = source({ assigned }), before = initialize(thread);
    for (let cycle = 0; cycle < 5; cycle++) { operations.ingestSnapshot(feed(thread)); read(thread); }
    assert.deepEqual(local(thread), before);
    assert.equal(local(thread).assignee_ctp_id, assigned.id);
    assert.equal(local(thread).assignee_id, assigned.id === otherStaffId ? otherStaff : null);
    assert.equal(operationsWorkspace(staff, { view: 'incidencias', bucket: 'unassigned' }).incidents.some(row => row.id === thread.ticket.id), false);
  }
});

test('real ownership, profile and official revision changes still advance CAS and reject stale drafts', () => {
  const thread = source(), before = initialize(thread);
  thread.ticket.assigned = { id: otherStaffId, username: 'Other referee' };
  thread.ticket.manager_version = 2;
  operations.ingestSnapshot(feed(thread)); read(thread);
  const assigned = local(thread);
  assert.equal(assigned.source_version, 2);
  assert.equal(assigned.assignee_id, otherStaff);
  assert.ok(assigned.version > before.version);
  assert.throws(() => operations.resolveIncident(staff, thread.ticket.id,
    { expected_version: before.version, decision: 'close', resolution: 'Borrador anterior al cambio de responsable' }), { status: 409 });

  thread.ticket.author.username = 'Jugador actualizado';
  thread.ticket.author.gamertag = 'Gamertag nuevo';
  thread.ticket.author.activision_id = 'NewID#1234';
  operations.ingestSnapshot(feed(thread)); read(thread);
  const profile = local(thread);
  assert.equal(profile.source_version, 2, 'a profile update need not increment the ticket revision');
  assert.ok(profile.version > assigned.version);
  assert.equal(profile.reporter_name, thread.ticket.author.username);
  assert.equal(profile.reporter_gamertag, thread.ticket.author.gamertag);
  assert.equal(profile.reporter_activision_id, thread.ticket.author.activision_id);
  assert.throws(() => operations.resolveIncident(staff, thread.ticket.id,
    { expected_version: assigned.version, decision: 'close', resolution: 'Borrador anterior al cambio del perfil' }), { status: 409 });
  for (let cycle = 0; cycle < 5; cycle++) { operations.ingestSnapshot(feed(thread)); read(thread); }
  assert.deepEqual(local(thread), profile, 'the feed must preserve optional identity fields supplied only by the thread');

  thread.ticket.assigned = null;
  thread.ticket.manager_version = 3;
  operations.ingestSnapshot(feed(thread)); read(thread);
  const unassigned = local(thread);
  assert.equal(unassigned.source_version, 3);
  assert.equal(unassigned.assigned_name, '');
  assert.equal(unassigned.assignee_id, null);
  assert.equal(unassigned.assignee_ctp_id, null);
  assert.ok(unassigned.version > profile.version);
  assert.throws(() => operations.resolveIncident(staff, thread.ticket.id,
    { expected_version: profile.version, decision: 'close', resolution: 'Borrador anterior a la desasignación' }), { status: 409 });
  for (let cycle = 0; cycle < 20; cycle++) { operations.ingestSnapshot(feed(thread)); read(thread); }
  assert.deepEqual(local(thread), unassigned, 'the real unassignment changes CAS once, then equivalent reads stay stable');
});
