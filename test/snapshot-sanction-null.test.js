import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-snapshot-null-sanction-'));
const root = fileURLToPath(new URL('..', import.meta.url));
Object.assign(process.env, {
  DATA_DIR: temporary, DB_PATH: path.join(temporary, 'snapshot.db'), PUBLIC_ORIGIN: '',
  CTP_AUTH_MODE: 'local', CTP_OPERATIONS_URL: '', CTP_OPERATIONS_TOKEN: '', CTP_SIGNING_SECRET: '',
  CTP_ENABLE_WRITES: 'false', CTP_SYNC_SECONDS: '0', OBS_ENABLE_CONTROL: 'false',
});
const operations = await import('../server/operations.js');
const { db } = await import('../server/db.js');
const { operationsWorkspace } = await import('../server/operations-workspace.js');
const { describeUser } = await import('../server/auth.js');
const adminId = Number(db.prepare("INSERT INTO users(username,name,password_hash,is_admin,created_at) VALUES('snapshot-admin','Synthetic admin','unused',1,?)").run(Date.now()).lastInsertRowid);
const admin = describeUser(db.prepare('SELECT * FROM users WHERE id=?').get(adminId));
const observer = { id: adminId, is_admin: false, sections: ['casters'] };
const copy = value => JSON.parse(JSON.stringify(value));
const rows = () => db.prepare('SELECT kind,id,data,version,source,updated_at FROM operation_records ORDER BY kind,id').all();
const sanction = (id, incident_id) => ({ id, incident_id, subject_id: 'synthetic-player', subject_type: 'player',
  reason: 'Synthetic official warning for the snapshot contract', restriction: 'warning', scopes: [],
  starts_at: '2026-10-26T13:06:05Z', ends_at: '2026-11-26T13:06:05Z', version: 1, official: true });
const snapshot = () => ({ generated_at: '2026-10-29T09:00:00Z', possibly_truncated: false,
  matches: [{ id: 'synthetic-match', kind: 'ranked', title: 'Synthetic match', status: 'playing', roster: [], maps: [] }],
  incidents: [{ id: 'synthetic-case', match_id: 'synthetic-match', kind: 'ranked', status: 'open', created_at: '2026-10-26T13:00:00Z' }],
  stats: [], clubs: [{ id: 'synthetic-club', name: 'Synthetic club' }], deliveries: [],
  sanctions: [sanction('direct-warning', null), sanction('case-warning', 'synthetic-case')] });
function reset() { db.prepare('DELETE FROM operation_records').run(); }
after(() => {
  db.close();
  assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5 });
});

test('a mixed CTP snapshot persists direct sanctions without a case alongside case sanctions and other collections', () => {
  reset();
  assert.deepEqual(operations.ingestSnapshot(snapshot()), { received: 5, changed: 5 });
  const stored = rows();
  assert.equal(stored.length, 5);
  const direct = stored.find(row => row.id === 'direct-warning');
  assert.equal(JSON.parse(direct.data).incident_id, null);
  assert.equal(JSON.parse(direct.data).official, true);
  assert.equal(direct.source, 'ctp');
  assert.equal(JSON.parse(stored.find(row => row.id === 'case-warning').data).incident_id, 'synthetic-case');
});

test('repeat snapshots and a fresh Manager process preserve the null case and do not rewrite unchanged records', () => {
  reset(); operations.ingestSnapshot(snapshot());
  const before = rows();
  assert.deepEqual(operations.ingestSnapshot(snapshot()), { received: 5, changed: 0 });
  assert.deepEqual(rows(), before);
  const child = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', `
    import fs from 'node:fs';
    import { ingestSnapshot } from './server/operations.js';
    import { db } from './server/db.js';
    const value=JSON.parse(fs.readFileSync(0,'utf8'));
    const before=db.prepare("SELECT data,version,updated_at FROM operation_records WHERE kind='sanction' AND id='direct-warning'").get();
    const result=ingestSnapshot(value);
    const after=db.prepare("SELECT data,version,updated_at FROM operation_records WHERE kind='sanction' AND id='direct-warning'").get();
    console.log(JSON.stringify({result,incidentId:JSON.parse(after.data).incident_id,unchanged:JSON.stringify(before)===JSON.stringify(after)}));
    db.close();
  `], { cwd: root, env: { ...process.env }, input: JSON.stringify(snapshot()), encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { result: { received: 5, changed: 0 }, incidentId: null, unchanged: true });
  assert.deepEqual(rows(), before);
});

test('missing or invalid non-null case identifiers still reject the entire incoming snapshot', () => {
  reset(); operations.ingestSnapshot(snapshot());
  const before = rows();
  for (const incidentId of [undefined, '', '   ', 0, false, {}, [], 'x'.repeat(161)]) {
    const invalid = copy(snapshot());
    invalid.matches[0].title = 'Must not replace the last good match';
    invalid.clubs.push({ id: 'must-not-persist', name: 'Rejected synthetic club' });
    invalid.sanctions[0].incident_id = incidentId;
    assert.throws(() => operations.ingestSnapshot(invalid), { status: 400 });
    assert.deepEqual(rows(), before);
  }
});

test('a local-source collision rolls back earlier updates even when the snapshot includes a valid direct sanction', () => {
  reset(); operations.ingestSnapshot(snapshot());
  db.prepare("INSERT INTO operation_records(kind,id,data,version,source,updated_at) VALUES('club','local-owned-club',?,1,'manager',?)").run(JSON.stringify({ id: 'local-owned-club', name: 'Retained local work' }), Date.now());
  const before = rows(), incoming = snapshot();
  incoming.matches[0].title = 'Must roll back';
  incoming.clubs.push({ id: 'local-owned-club', name: 'Cannot seize local work' });
  assert.throws(() => operations.ingestSnapshot(incoming), { status: 409 });
  assert.deepEqual(rows(), before);
});

test('null case snapshots remain readable in workspace and dossiers without weakening local creation or permissions', () => {
  reset(); operations.ingestSnapshot(snapshot());
  const overview = operations.bootstrap(admin);
  assert.equal(overview.sanctions.find(item => item.id === 'direct-warning').incident_id, null);
  const workspace = operationsWorkspace(admin, { view: 'disciplina' });
  assert.equal(workspace.sanctions.find(item => item.id === 'direct-warning').incident_id, null);
  const dossier = operations.matchDossier(admin, 'synthetic-match');
  assert.deepEqual(dossier.incidents.map(item => item.id), ['synthetic-case']);
  assert.equal(operations.matchDossier(observer, 'synthetic-match').incidents.length, 0);
  assert.equal(operations.bootstrap(observer).sanctions.length, 0);
  assert.throws(() => operations.createSanction(admin, { ...sanction('local-draft', null), incident_id: null }), { status: 400 });
  assert.throws(() => operations.createSanction(observer, { ...sanction('unauthorized-draft', null), incident_id: null }), { status: 403 });
  assert.throws(() => operations.submitSanction(admin, 'direct-warning', { expected_version: overview.sanctions.find(item => item.id === 'direct-warning').version }), { status: 409 });
});
