import crypto from 'node:crypto';

// This module accepts an already selected SQLite connection. It never opens a
// database, follows filesystem paths, decrypts PC Check evidence or guesses a
// retention period. Unknown layouts and retained evidence fail closed.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const identityKeys = new Set(['id','user_id','player_id','author_id','reporter_id','target_id','subject_id','ctp_id','ctp_user_id']);
const personalKeys = new Set(['username','name','email','gamertag','activision_id','discord','twitter','bio','birthdate','avatar','avatar_url','phone','platform','reporter_name','reporter_gamertag','reporter_activision_id','subject_name','player_alias']);
const ownedProjectionKeys = new Set([...identityKeys,...personalKeys,'team_id','team','side','kills','deaths','assists','score','objective','objective_unit','points','wins','losses','role','manager_version','source_version','in_feed','pending_command_id','rank','ranked_division','rating','elo','mmr','xp','level','ready','is_ready','status']);
const historicalKinds = new Set(['match','stat','fixture','registration','tournament','ranked_season','club','administration']);
const evidenceKinds = new Set(['incident','case_incident','case_match','sanction']);
const knownTables = new Set(['settings','sessions','users','roles','user_roles','availability','event_days','board_lists','board_labels','board_cards','board_card_members','board_checklist','board_comments','contents','resources','rundowns','rundown_parts','operation_operator_identities','operation_records','operation_notes','operation_assignments','operation_production','operation_commands','operation_audit','administration_oauth_states','obs_agent_state','obs_commands','ruleta_people','ruleta_draws','pc_check_migrations','pc_check_cases','pc_check_reviews','pc_check_case_reviewers','pc_check_audit','account_erasure_subjects','account_erasure_job_refs','account_erasure_local_receipts']);
const columnsManifest = Object.fromEntries(Object.entries({
  settings:'key value',sessions:'token created_at expires_at user_id auth_mode ctp_tokens',users:'id username name password_hash is_admin active created_at last_login_at ctp_user_id ctp_role ctp_staff_kind',
  roles:'id name sections created_at staff_kind',user_roles:'user_id role_id',availability:'user_id date status note updated_at',event_days:'date event main',
  board_lists:'id title position created_at',board_labels:'id color name',board_cards:'id list_id position title description due_date due_done labels created_by created_at updated_at',board_card_members:'card_id user_id',board_checklist:'id card_id position text done',board_comments:'id card_id user_id text created_at',
  contents:'id title status date time platforms description copy notes created_at updated_at owner source_ref',resources:'id content_id position text done',rundowns:'id title date time description created_at updated_at',rundown_parts:'id rundown_id position title duration content notes',
  operation_operator_identities:'user_id external_id created_at',operation_records:'kind id data version source updated_at',operation_notes:'id resource_type resource_id text visibility actor_id delivery_status created_at',operation_assignments:'id match_id user_id role starts_at ends_at status version created_by created_at updated_at',operation_production:'match_id rundown_id state scene note version updated_by updated_at',operation_commands:'id idempotency_key action resource_type resource_id actor_id expected_version payload status attempts last_error result created_at updated_at',operation_audit:'id resource_type resource_id action actor_id details created_at',
  administration_oauth_states:'state_hash user_id session_hash expires_at used',obs_agent_state:'id last_seen last_error',obs_commands:'seq id match_id scene status actor_id created_at updated_at lease_id lease_until attempts error confirmed_scene',ruleta_people:'ctp_id name role staff_kind staff_enabled email_confirmed',ruleta_draws:'id winner_key winner_name participants source drawn_by created_at',
  pc_check_migrations:'id applied_at',pc_check_cases:'id player_id player_alias assigned_operator_id operator_alias purpose retention_days allowed_scopes created_at expires_at token_hash token_expires_at receipt_id received_at manifest_sha256 upload_sha256 summary_json evidence_ciphertext evidence_nonce evidence_tag',pc_check_reviews:'id case_id actor_id actor_alias note created_at',pc_check_case_reviewers:'case_id user_id assigned_by assigned_at',pc_check_audit:'id case_id actor_id action created_at',
  account_erasure_subjects:'subject_id requires_review created_at',account_erasure_job_refs:'job_id ticket_id user_id',account_erasure_local_receipts:'receipt_sha256 report_json created_at',
}).map(([table,columns])=>[table,new Set(columns.split(' '))]));
const quote = name => '"' + name.replaceAll('"','""') + '"';
const parse = value => { if (typeof value !== 'string' || value.length > 4*1024*1024) throw Error('unrecognized_projection'); return JSON.parse(value); };
const equals = (value,id) => typeof value === 'string' && [id,`ctp:${id}`].includes(value.toLowerCase());
const contains = (value,id) => typeof value === 'string' && value.toLowerCase().includes(id);
const tables = db => new Map(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => [row.name,new Set(db.prepare(`PRAGMA table_info(${quote(row.name)})`).all().map(col => col.name))]));

function scrub(value, id, aliases, parentKey = '') {
  if (Array.isArray(value)) return value.map(item => scrub(item,id,aliases,parentKey));
  if (value === null || typeof value !== 'object') return value;
  const owned = Object.entries(value).some(([key,v]) => identityKeys.has(key) && equals(v,id));
  const result = {};
  for (const [key,child] of Object.entries(value)) {
    if (owned && personalKeys.has(key)) {
      if (typeof child === 'string' && child.length >= 3 && child !== 'Cuenta eliminada') aliases?.add(child);
      result[key] = ['username','name','reporter_name','subject_name','player_alias'].includes(key) ? 'Cuenta eliminada' : null;
    } else result[key] = scrub(child,id,aliases,key);
  }
  return result;
}
const collectIds = value => new Set((JSON.stringify(value)?.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi) || []).map(id=>id.toLowerCase()));
function unclassifiedReference(value,id,key='') {
  if (typeof value === 'string') return contains(value,id) && !(identityKeys.has(key) && equals(value,id));
  if (Array.isArray(value)) return value.some(item => unclassifiedReference(item,id,key));
  if (!value || typeof value !== 'object') return false;
  // A new profile field needs a deliberate privacy policy. Knowing its UUID
  // does not justify classifying arbitrary sibling text as a sporting result.
  const owned=Object.entries(value).some(([childKey,child])=>identityKeys.has(childKey)&&equals(child,id));
  return Object.keys(value).some(childKey=>contains(childKey,id))
    || owned && Object.keys(value).some(childKey=>!ownedProjectionKeys.has(childKey))
    || Object.entries(value).some(([childKey,child]) => unclassifiedReference(child,id,childKey));
}

/** Capture marks only inside the writer's transaction. The inspector commits
 * its permanent mark and purge together. A late poll then cannot reintroduce
 * PII while its clear receipt is being acknowledged by CTP (or afterwards).
 * Evidence already held locally remains under custody; new copies are refused,
 * rather than storing them and trying to revoke an in-flight clear receipt. */
export function createErasureProjectionFence(db) {
  const marked = new Set(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='account_erasure_subjects'").get()
    ? db.prepare('SELECT subject_id FROM account_erasure_subjects').all().map(row=>row.subject_id.toLowerCase()) : []);
  if(!marked.size)return(_kind,input)=>input;
  return (kind,input) => {
    let value=input;
    for(const id of collectIds(input)) {
      if(!marked.has(id))continue;
      if(!historicalKinds.has(kind)||evidenceKinds.has(kind))throw Object.assign(Error('La entrada contiene datos de una cuenta marcada para eliminación. No se ha guardado; actualiza desde CTP.'),{status:409,code:'erased_projection_refused'});
      value=scrub(value,id);
      // Knowing an ID does not classify arbitrary prose or sibling fields as
      // competitive history. No raw payload or quarantine copy is persisted.
      if(unclassifiedReference(value,id))throw Object.assign(Error('La entrada contiene referencias personales sin clasificar de una cuenta marcada para eliminación. No se ha guardado.'),{status:409,code:'erased_projection_refused'});
    }
    return value;
  };
}
export function redactErasedProjection(db,kind,input) {return createErasureProjectionFence(db)(kind,input);}
export const isErasedSubject = (db,id) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='account_erasure_subjects'").get()
  && db.prepare('SELECT 1 FROM account_erasure_subjects WHERE subject_id=?').get(id.toLowerCase()));

export function createErasureInspector(db, { now = Date.now, maximumRows = 50000 } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS account_erasure_subjects(subject_id TEXT PRIMARY KEY,requires_review INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS account_erasure_local_receipts(receipt_sha256 TEXT PRIMARY KEY,report_json TEXT NOT NULL,created_at INTEGER NOT NULL);`);
  return function inspect(job) {
    if (!job || !UUID.test(job.user_id ?? '') || !UUID.test(job.job_id ?? '') || job.phase !== 'external'
      || !job.progress?.database_sanitized || !job.progress?.auth_closed || !job.progress?.storage_verified) throw Error('external_phase_required');
    const id = job.user_id.toLowerCase(), reasons = new Set(), aliases = new Set(), counts = {projections:0,profiles:0,sessions:0,draws:0,pc_check_cases:0,retained_evidence:0};
    let status = 'clear', scanned = 0;
    const unavailable = reason => { reasons.add(reason); status = 'retryable'; };
    const retained = reason => { reasons.add(reason); counts.retained_evidence++; if (status !== 'retryable') status = 'blocked_policy'; };
    let transaction = false;
    try {
      // Schema, custody counts and the final decision must see one locked
      // database. Counting PC Check before this lock allowed another writer
      // to create a case between that count and a false clear receipt.
      db.exec('PRAGMA secure_delete=ON; BEGIN IMMEDIATE'); transaction = true;
      const schema = tables(db);
      const requireColumns = (table,columns) => {
        if (!schema.has(table) || columns.some(key => !schema.get(table).has(key))) throw Error('schema_unrecognized');
      };
      requireColumns('operation_records',['kind','id','data','version','updated_at']);
      requireColumns('users',['id','username','name','password_hash','active','ctp_user_id','ctp_role']);
      requireColumns('sessions',['user_id']);
      const pcTables = ['pc_check_cases','pc_check_reviews','pc_check_case_reviewers','pc_check_audit','pc_check_migrations'];
      if (pcTables.some(table => schema.has(table)) && !pcTables.every(table => schema.has(table))) throw Error('pc_check_schema_unrecognized');
      if (schema.has('pc_check_cases')) {
        requireColumns('pc_check_cases',['id','player_id','player_alias','summary_json','evidence_ciphertext','token_hash','expires_at']);
        const cases = db.prepare('SELECT id FROM pc_check_cases WHERE lower(player_id)=?').all(id);
        counts.pc_check_cases = cases.length;
        if (cases.length) retained('pc_check_evidence_policy_required');
      }
      for (const [table,columns] of schema) {
        if (!knownTables.has(table) && db.prepare(`SELECT 1 FROM ${quote(table)} LIMIT 1`).get()) throw Error('schema_unrecognized');
        const n = db.prepare(`SELECT count(*) n FROM ${quote(table)}`).get().n;
        if (n && columnsManifest[table] && [...columns].some(column=>!columnsManifest[table].has(column))) throw Error('schema_unrecognized');
        scanned += n;
        if (scanned > maximumRows) throw Error('inspection_batch_limit');
      }
      if (db.prepare('SELECT coalesce(sum(length(CAST(data AS BLOB))),0) bytes FROM operation_records').get().bytes > 32*1024*1024) throw Error('inspection_batch_limit');
      db.prepare('INSERT OR IGNORE INTO account_erasure_subjects(subject_id,created_at) VALUES(?,?)').run(id,now());
      const subjects = db.prepare('SELECT requires_review FROM account_erasure_subjects WHERE subject_id=?').get(id);
      if (subjects.requires_review) retained('late_evidence_policy_required');
      if (schema.has('pc_check_cases')) {
        // Revoke operational uploads; retained custody/review data requires a
        // documented policy decision and is never destroyed by this operation.
        db.prepare('UPDATE pc_check_cases SET token_hash=NULL,expires_at=min(expires_at,?) WHERE lower(player_id)=?').run(now(),id);
      }
      const related = new Set([id,job.ticket_id]);
      for (const row of db.prepare('SELECT kind,id,data FROM operation_records').all()) {
        let value = parse(row.data);
        if (!contains(row.data,id) && !equals(row.id,id)) continue;
        related.add(row.id);
        if (evidenceKinds.has(row.kind)) { retained('operational_evidence_policy_required'); continue; }
        if (!historicalKinds.has(row.kind)) { retained('unclassified_projection_policy_required'); continue; }
        if (row.kind === 'administration' && equals(row.id,id)) {
          scrub(value,id,aliases); // Discover identity-only text before dropping this cache.
          db.prepare('DELETE FROM operation_records WHERE kind=? AND id=?').run(row.kind,row.id); counts.projections++; continue;
        }
        const clean = JSON.stringify(scrub(value,id,aliases));
        if (clean !== row.data) { db.prepare('UPDATE operation_records SET data=?,version=version+1,updated_at=? WHERE kind=? AND id=?').run(clean,now(),row.kind,row.id); counts.projections++; }
      }
      for (const row of db.prepare('SELECT id,username,name,ctp_role FROM users WHERE lower(ctp_user_id)=?').all(id)) {
        for (const alias of [row.username,row.name]) if (typeof alias === 'string' && alias.length >= 3) aliases.add(alias);
        if (['admin','staff','referee'].includes(row.ctp_role)) { retained('staff_history_policy_required'); continue; }
        counts.sessions += db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.id).changes;
        if (schema.has('administration_oauth_states')) db.prepare('DELETE FROM administration_oauth_states WHERE user_id=?').run(row.id);
        if (schema.has('operation_operator_identities')) db.prepare('DELETE FROM operation_operator_identities WHERE user_id=?').run(row.id);
        // Local staff work is evidence, including references through integer IDs.
        for (const table of ['operation_audit','operation_notes','operation_commands','pc_check_reviews','pc_check_audit']) {
          if (schema.get(table)?.has('actor_id') && db.prepare(`SELECT 1 FROM ${quote(table)} WHERE actor_id=? LIMIT 1`).get(row.id)) retained('local_staff_evidence_policy_required');
        }
        db.prepare("UPDATE users SET username=?,name='Cuenta eliminada',password_hash='',active=0,ctp_user_id=NULL,ctp_role='' WHERE id=?").run(`erased_${row.id}`,row.id); counts.profiles++;
      }
      if (schema.has('ruleta_people')) {
        requireColumns('ruleta_people',['ctp_id','name']);
        const person = db.prepare('SELECT name FROM ruleta_people WHERE lower(ctp_id)=?').get(id);
        if (person?.name?.length >= 3) aliases.add(person.name);
        db.prepare('DELETE FROM ruleta_people WHERE lower(ctp_id)=?').run(id);
      }
      if (schema.has('ruleta_draws')) {
        requireColumns('ruleta_draws',['winner_key','winner_name']);
        counts.draws = db.prepare("UPDATE ruleta_draws SET winner_name='Cuenta eliminada' WHERE lower(winner_key) IN(?,?)").run(id,`ctp:${id}`).changes;
      }
      // Classify every remaining reference, including free text and linked
      // command payloads. No raw values are copied into the receipt or errors.
      for (const [table,columns] of schema) {
        if (['account_erasure_subjects','account_erasure_job_refs','account_erasure_local_receipts','pc_check_cases','pc_check_reviews','pc_check_case_reviewers','pc_check_audit','pc_check_migrations'].includes(table)) continue;
        for (const row of db.prepare(`SELECT * FROM ${quote(table)}`).all()) {
          for (const [column,value] of Object.entries(row)) {
            if (typeof value !== 'string') continue;
            const exactReference = contains(value,id);
            const nameReference = [...aliases].some(alias => value !== 'Cuenta eliminada' && value.includes(alias));
            if (!exactReference && !nameReference) continue;
            if (table === 'operation_records' && ['data','id'].includes(column)) {
              if (evidenceKinds.has(row.kind) || !historicalKinds.has(row.kind)) { retained('operational_evidence_policy_required'); continue; }
              // Structured competitive UUIDs can remain; arbitrary prose cannot.
              if (column === 'id' && equals(value,id)) continue;
              if (column === 'data' && !nameReference && !unclassifiedReference(parse(value),id)) continue;
            }
            if (table === 'ruleta_draws' && column === 'winner_key' && equals(value,id)) continue;
            retained('unclassified_local_reference_policy_required');
          }
          if (['operation_notes','operation_audit','operation_commands'].includes(table) && related.has(row.resource_id)) retained('linked_history_policy_required');
        }
      }
      db.exec('COMMIT'); transaction = false;
      // secure_delete applies to the modified pages; checkpoint must actually
      // finish before any clear report. Busy readers are a retryable dependency.
      const checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
      if (checkpoint?.busy) unavailable('sqlite_checkpoint_busy');
    } catch (error) {
      if (transaction) { try { db.exec('ROLLBACK'); } catch { /* reported unavailable */ } }
      unavailable(['schema_unrecognized','pc_check_schema_unrecognized','inspection_batch_limit','unrecognized_projection'].includes(error?.message) ? error.message : 'sqlite_inspection_unavailable');
    }
    const report = {schema_version:1,coverage:'manager-sqlite-and-pc-check-v1',inspected_at:new Date(now()).toISOString(),status,scanned_rows:scanned,counts,reasons:[...reasons].sort()};
    const reportJson = JSON.stringify(report), receipt_sha256 = crypto.createHash('sha256').update(JSON.stringify({job_id:job.job_id,version:job.version,report})).digest('hex');
    db.prepare('INSERT OR IGNORE INTO account_erasure_local_receipts(receipt_sha256,report_json,created_at) VALUES(?,?,?)').run(receipt_sha256,reportJson,now());
    return {status,receipt_sha256,report};
  };
}
