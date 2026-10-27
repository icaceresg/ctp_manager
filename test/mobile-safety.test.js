import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createModerationIntent,canProcessErasure,canInspectErasure} from '../client/src/pages/safetyModel.js';
import {createErasureInspector,redactErasedProjection} from '../server/erasure-local.js';
import {createPcCheckStore} from '../server/pc-check.js';

// Every database and every backend reply in this suite is synthetic and local.
// This is not a real player's erasure, SMTP acceptance or deployed CTP flow.
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-mobile-safety-'));
Object.assign(process.env,{DATA_DIR:temp,DB_PATH:path.join(temp,'module.sqlite'),CTP_AUTH_MODE:'local',PUBLIC_ORIGIN:'',CTP_OPERATIONS_URL:'',CTP_OPERATIONS_TOKEN:''});
const contract=await import('../server/mobile-safety-contract.js');
const {createMobileSafetyClient}=await import('../server/mobile-safety-services.js');
const {db:moduleDb}=await import('../server/db.js');
after(()=>{moduleDb.close();assert.equal(path.dirname(temp),os.tmpdir());assert.ok(path.basename(temp).startsWith('ctp-mobile-safety-'));fs.rmSync(temp,{recursive:true,force:true});});
const subject=randomUUID(),ticket=randomUUID(),jobId=randomUUID();
const request=()=>({ticket_id:ticket,user_id:subject,request_version:1,username:'PlayerFixture',user_version:3,ticket_status:'abierto',requested_at:'2026-10-27T08:00:00Z'});
const job=()=>({schema_version:1,job_id:jobId,ticket_id:ticket,user_id:subject,state:'running',phase:'external',version:3,retryable:true,completed_at:null,blocked_reasons:[],retained_categories:['competitive_keys_and_results'],progress:{database_sanitized:true,auth_closed:true,storage_verified:true,external_verified:false,confirmation_state:null},request:request()});
const report=()=>({id:randomUUID(),ticket_id:ticket,ticket_code:'CTP-123',context:'message',reason:'abuse',details:'Reported synthetic message',status:'pending',version:1,created_at:'2026-10-27T08:00:00Z',target_id:subject,target_username:'PlayerFixture',message_id:'123',lobby_id:randomUUID(),evidence:{message:'<img src=x onerror=alert(1)>',username:'PlayerFixture'},hidden:false,reviewed_at:null,review_note:null});
const admin={id:1,name:'Admin fixture',username:'admin-fixture',is_admin:true,auth_mode:'ctp',ctp_role:'admin'};
function fixture() {
  const db=new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,name TEXT,password_hash TEXT,active INTEGER,ctp_user_id TEXT,ctp_role TEXT);
    INSERT INTO users VALUES(1,'admin','Admin fixture','unused',1,NULL,'admin');
    CREATE TABLE sessions(token TEXT,user_id INTEGER);
    CREATE TABLE operation_records(kind TEXT,id TEXT,data TEXT,version INTEGER,updated_at INTEGER,PRIMARY KEY(kind,id));
    CREATE TABLE operation_notes(id TEXT,resource_id TEXT,text TEXT,actor_id INTEGER);
    CREATE TABLE operation_audit(id INTEGER,resource_id TEXT,details TEXT,actor_id INTEGER);
    CREATE TABLE operation_commands(id TEXT,resource_id TEXT,payload TEXT,actor_id INTEGER);`);
  return db;
}
test('moderation rejects authority injection, missing CAS/nonce, unbounded reasons and unexpected response data',()=>{
  const row=report(),body={action:'hide',expected_version:1,reason:'Reason for this synthetic decision',request_id:randomUUID()};
  assert.equal(contract.ugcWritePayload(row.id,body).report_id,row.id);
  for(const bad of [{...body,actor_id:'admin'},{...body,rpc:'arbitrary'},{...body,expected_version:0},{...body,request_id:'bad'},{...body,reason:'too short'},{...body,reason:'x'.repeat(501)},{...body,reason:'bad\0content long enough'}])assert.throws(()=>contract.ugcWritePayload(row.id,bad),{status:400});
  const safe=contract.ugcResponse({schema_version:1,report:{...row,access_token:'NEVER RELAY',evidence:{...row.evidence,private_key:'NEVER RELAY'}}},{action:'get',report_id:row.id});
  assert.equal(safe.report.access_token,undefined);assert.equal(safe.report.evidence.private_key,undefined);
  assert.equal(safe.report.evidence.message,row.evidence.message);
  assert.throws(()=>contract.ugcResponse({schema_version:1,report:row},{action:'hide',report_id:row.id}),{status:502});
});
test('erasure actions admit only current versions and completed requires every real backend gate',()=>{
  const current=job();assert.equal(contract.erasureResponse(current,{job_id:jobId}).state,'running');
  for(const bad of [{expected_version:3,status:'clear'},{expected_version:3,receipt_sha256:'a'.repeat(64)},{expected_version:3,actor_id:'admin'},{expected_version:3,recipient_email:'fixture@example.invalid'},{}])assert.throws(()=>contract.erasurePayload('inspect',jobId,bad),{status:400});
  const notPrepared={schema_version:1,ticket_id:ticket,state:'not_prepared',request:request()};
  assert.equal(contract.erasureResponse(notPrepared,{ticket_id:ticket}).request.request_version,1);
  assert.throws(()=>contract.erasureResponse({...current,state:'completed',phase:'complete',completed_at:new Date().toISOString()}),{status:502});
  const complete={...current,state:'completed',phase:'complete',completed_at:new Date().toISOString(),progress:{...current.progress,external_verified:true,confirmation_state:'sent'}};
  assert.equal(contract.erasureResponse(complete).state,'completed');
  assert.equal(canProcessErasure(current),false);assert.equal(canInspectErasure(current),true);
  assert.equal(canProcessErasure({...current,state:'blocked_policy',retryable:false,phase:'database'}),false);
});
test('uncertain moderation preserves the exact reason, CAS and nonce',()=>{
  const row=report(),state=createModerationIntent(()=> 'synthetic-fixed-nonce');
  const first=state.begin(row,'hide','A meaningful synthetic reason');
  assert.equal(state.begin(row,'hide','A meaningful synthetic reason'),first);
  for(const [r,a,reason]of [[row,'dismiss',first.reason],[{...row,version:2},'hide',first.reason],[row,'hide','Another meaningful reason']])assert.throws(()=>state.begin(r,a,reason));
  assert.throws(()=>state.confirm(row.id,first,{report:{...row,status:'pending'}}));
  state.confirm(row.id,first,{report:{...row,status:'hidden'}});assert.equal(state.pending,null);
});
test('real SQLite inspection purges identified operational PII and sessions, preserves competition and produces a receipt without PII',t=>{
  const db=fixture();t.after(()=>db.close());
  const inspector=createErasureInspector(db,{now:()=>1793088000000});
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run(2,'PlayerFixture','Player Fixture','old-hash',1,subject,'player');
  db.prepare('INSERT INTO sessions VALUES(?,?)').run('private-session',2);
  db.prepare('INSERT INTO operation_records VALUES(?,?,?,?,?)').run('administration',subject,JSON.stringify({id:subject,username:'PlayerFixture',email:'fixture@example.invalid'}),1,0);
  const match=randomUUID();
  db.prepare('INSERT INTO operation_records VALUES(?,?,?,?,?)').run('match',match,JSON.stringify({id:match,roster:[{id:subject,username:'PlayerFixture',gamertag:'PlayerFixture',kills:15,deaths:3}],score_a:3,score_b:1}),1,0);
  const checked=inspector(job());
  assert.equal(checked.status,'clear');assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM operation_records WHERE kind=?').get('administration').n,0);
  const cached=JSON.parse(db.prepare('SELECT data FROM operation_records WHERE kind=?').get('match').data);
  assert.equal(cached.roster[0].username,'Cuenta eliminada');assert.equal(cached.roster[0].gamertag,null);assert.equal(cached.roster[0].kills,15);assert.equal(cached.roster[0].id,subject);assert.equal(cached.score_a,3);
  assert.equal(db.prepare('SELECT active FROM users WHERE id=2').get().active,0);
  for(const pii of [subject,ticket,'PlayerFixture','fixture@example.invalid','private-session'])assert.equal(JSON.stringify(checked.report).includes(pii),false);
  assert.equal(checked.receipt_sha256,createHash('sha256').update(JSON.stringify({job_id:jobId,version:job().version,report:checked.report})).digest('hex'));
  assert.equal(redactErasedProjection(db,'match',{id:match,roster:[{id:subject,username:'Stale Name',gamertag:'Stale Tag',kills:15}]}).roster[0].username,'Cuenta eliminada');
});
test('PC Check custody and reviews remain blocked for policy; operational upload is revoked and cannot be recreated',t=>{
  const db=fixture();t.after(()=>db.close());
  const store=createPcCheckStore(db,{origin:'http://localhost:3210',key:randomBytes(32)});
  const item=store.create(admin,{playerId:subject,playerAlias:'PlayerFixture',purpose:'Synthetic preservation policy case',retentionDays:7,allowedScopes:1});
  db.prepare('UPDATE pc_check_cases SET evidence_ciphertext=?,summary_json=?,token_hash=? WHERE id=?').run(Buffer.from('protected-custody-bytes'),'{}','assignment-hash',item.id);
  db.prepare('INSERT INTO pc_check_reviews VALUES(?,?,?,?,?,?)').run(randomUUID(),item.id,1,'Admin fixture','Protected synthetic review',Date.now());
  const checked=createErasureInspector(db)(job());assert.equal(checked.status,'blocked_policy');assert.ok(checked.report.reasons.includes('pc_check_evidence_policy_required'));
  assert.equal(Buffer.from(db.prepare('SELECT evidence_ciphertext FROM pc_check_cases').get().evidence_ciphertext).toString(),'protected-custody-bytes');
  assert.equal(db.prepare('SELECT token_hash FROM pc_check_cases').get().token_hash,null);
  assert.equal(db.prepare('SELECT count(*) n FROM pc_check_reviews').get().n,1);
  assert.throws(()=>store.create(admin,{playerId:subject,playerAlias:'PlayerFixture',purpose:'Synthetic preservation policy case',retentionDays:7,allowedScopes:1}),{status:409});
});
test('unknown populated schema, broken JSON, retained history and unclassified prose cannot become clear',t=>{
  for(const kind of ['unknown_table','broken_json','unclassified_text','unknown_personal_field','history']) {
    const db=fixture();t.after(()=>db.close());const inspector=createErasureInspector(db);
    if(kind==='unknown_table')db.exec('CREATE TABLE future_processor(secret TEXT);INSERT INTO future_processor VALUES(\'not classified\')');
    if(kind==='broken_json')db.prepare('INSERT INTO operation_records VALUES(?,?,?,?,?)').run('match',randomUUID(),'invalid-json',1,0);
    if(kind==='unclassified_text')db.prepare('INSERT INTO operation_records VALUES(?,?,?,?,?)').run('match',randomUUID(),JSON.stringify({free_text:`Sensitive mention ${subject}`}),1,0);
    if(kind==='unknown_personal_field')db.prepare('INSERT INTO operation_records VALUES(?,?,?,?,?)').run('match',randomUUID(),JSON.stringify({roster:[{id:subject,unknown_profile_name:'Private name'}]}),1,0);
    if(kind==='history')db.prepare('INSERT INTO operation_records VALUES(?,?,?,?,?)').run('incident',ticket,JSON.stringify({reporter_id:subject,reporter_name:'PlayerFixture',reason:'Evidence to retain'}),1,0);
    const result=inspector(job());assert.equal(result.status,kind==='unknown_table'||kind==='broken_json'?'retryable':'blocked_policy');
    assert.equal(JSON.stringify(result.report).includes(subject),false);
  }
});
test('only the server inspection can generate external_check; wrong actor, caller-supplied clear and stale versions never reach the bridge',async t=>{
  const db=fixture();t.after(()=>db.close());const observed=[];let current=job(),writes=true;
  const client=createMobileSafetyClient({database:db,actorFor:user=>`ctp:${user.id}`,writesEnabled:()=>writes,request:async envelope=>{
    observed.push(envelope);assert.equal(envelope.action,'admin_service');assert.equal(envelope.actor_id,'ctp:1');
    const p=envelope.payload;
    if(p.action==='list')return {schema_version:1,requests:[{request:request(),job:current}],has_more:false};
    if(p.action==='status')return current;
    assert.equal(p.action,'external_check');assert.equal(p.status,'clear');assert.match(p.receipt_sha256,/^[a-f0-9]{64}$/);
    current={...current,version:4,state:'awaiting_confirmation',phase:'confirmation',progress:{...current.progress,external_verified:true,confirmation_state:'queued'}};return current;
  }});
  await client.erasureList(admin,{});
  const count=observed.length;
  for(const body of [{expected_version:3,status:'clear'},{expected_version:3,receipt_sha256:'a'.repeat(64)}])await assert.rejects(client.erasureInspect(admin,jobId,body),{status:400});
  await assert.rejects(client.erasureInspect({...admin,ctp_role:'staff'},jobId,{expected_version:3}),{status:403});
  assert.equal(observed.length,count);
  await assert.rejects(client.erasureInspect(admin,jobId,{expected_version:2}),{status:409});
  assert.equal(observed.at(-1).payload.action,'status');
  const checked=await client.erasureInspect(admin,jobId,{expected_version:3});assert.equal(checked.state,'awaiting_confirmation');assert.notEqual(checked.state,'completed');
  assert.equal(observed.at(-1).payload.action,'external_check');assert.equal(checked.local_inspection.status,'clear');
  writes=false;await assert.rejects(client.erasureInspect(admin,jobId,{expected_version:4}),{status:403});
  writes=true;await assert.rejects(client.erasureInspect(admin,jobId,{expected_version:4}),{status:409});
});
test('the schema manifest accepts actual initialized Manager tables and detects future columns with data',async()=>{
  await import('../server/operations.js');await import('../server/ruleta.js');await import('../server/obs.js');
  const rundown=moduleDb.prepare("INSERT INTO rundowns(title,created_at,updated_at) VALUES('Synthetic editorial rundown',0,0)").run().lastInsertRowid;
  moduleDb.prepare("INSERT INTO rundown_parts(rundown_id,position,title,duration,content,notes) VALUES(?,0,'Synthetic section',30,'Editorial text','')").run(rundown);
  const inspector=createErasureInspector(moduleDb);assert.equal(inspector(job()).status,'clear');
  moduleDb.exec('ALTER TABLE rundown_parts ADD COLUMN unclassified_personal_field TEXT');
  assert.equal(inspector(job()).status,'retryable');
});
