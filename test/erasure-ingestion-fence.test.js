import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Real Manager SQLite and ingestion, isolated synthetic data only. The held
// bridge reply is not a CTP deployment, SMTP receipt or real player erasure.
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-erasure-ingestion-'));
Object.assign(process.env,{DATA_DIR:temp,DB_PATH:path.join(temp,'fixture.sqlite'),CTP_AUTH_MODE:'local',PUBLIC_ORIGIN:'',CTP_OPERATIONS_URL:'',CTP_OPERATIONS_TOKEN:''});
const {db}=await import('../server/db.js');
const {ingestSnapshot,rememberCompetitionData,rememberCaseData}=await import('../server/operations.js');
const {createMobileSafetyClient}=await import('../server/mobile-safety-services.js');
const {createErasureInspector}=await import('../server/erasure-local.js');
const {createPcCheckStore}=await import('../server/pc-check.js');
after(()=>{db.close();assert.equal(path.dirname(temp),os.tmpdir());assert.ok(path.basename(temp).startsWith('ctp-erasure-ingestion-'));fs.rmSync(temp,{recursive:true,force:true});});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const admin={id:1,is_admin:true,auth_mode:'ctp',ctp_role:'admin'};
const fixture=()=>{
  const user=randomUUID(),ticket=randomUUID(),id=randomUUID();
  return{schema_version:1,job_id:id,ticket_id:ticket,user_id:user,state:'running',phase:'external',version:3,retryable:true,completed_at:null,blocked_reasons:[],retained_categories:['competitive_keys_and_results'],progress:{database_sanitized:true,auth_closed:true,storage_verified:true,external_verified:false,confirmation_state:null},request:{ticket_id:ticket,user_id:user,request_version:1,username:'Synthetic player',user_version:3,ticket_status:'abierto',requested_at:'2026-10-27T08:00:00Z'}};
};
const cached=(kind,id)=>db.prepare('SELECT * FROM operation_records WHERE kind=? AND id=?').get(kind,id);
const personalAbsent=words=>{const cache=JSON.stringify(db.prepare('SELECT data FROM operation_records').all());for(const word of words)assert.equal(cache.includes(word),false,word);};

test('a held poll cannot restore PII between local clear and external ACK, or after that ACK',async()=>{
  const job=fixture(),match=randomUUID(),other=randomUUID();
  const roster=()=>[{id:job.user_id,username:'Original private name',gamertag:'Original private tag',kills:15,deaths:3},{id:other,username:'Other player',kills:8,deaths:6}];
  ingestSnapshot({matches:[{id:match,version:1,kind:'ranked',title:'Synthetic match',score_a:3,score_b:1,roster:roster()}]});
  const ackRequested=deferred(),ack=deferred(),pollArrived=deferred();
  const poll=(async()=>{const snapshot=await pollArrived.promise;return ingestSnapshot(snapshot);})();
  const client=createMobileSafetyClient({database:db,writesEnabled:()=>true,actorFor:()=> 'ctp:synthetic-admin',request:async({payload:p})=>{
    if(p.action==='status')return job;
    assert.equal(p.action,'external_check');assert.equal(p.status,'clear');assert.match(p.receipt_sha256,/^[a-f0-9]{64}$/);
    ackRequested.resolve(p);await ack.promise;
    return{...job,version:4,state:'awaiting_confirmation',phase:'confirmation',progress:{...job.progress,external_verified:true,confirmation_state:'queued'}};
  }});
  await client.erasureStatus(admin,job.ticket_id);
  const inspection=client.erasureInspect(admin,job.job_id,{expected_version:3});
  const sent=await ackRequested.promise;
  assert.ok(db.prepare('SELECT 1 FROM account_erasure_subjects WHERE subject_id=?').get(job.user_id));
  pollArrived.resolve({incidents:[{id:randomUUID(),reporter_id:job.user_id,reporter_name:'Late private name',reason:'Late private evidence'}]});
  await assert.rejects(poll,{status:409,code:'erased_projection_refused'});
  // Classified history may advance; only the erased actor's personal display
  // fields are scrubbed, keeping scores, membership UUIDs and other players.
  ingestSnapshot({matches:[{id:match,version:2,kind:'ranked',title:'Synthetic match',score_a:4,score_b:1,roster:roster().map(p=>({...p,kills:p.id===job.user_id?16:p.kills}))}]});
  const history=JSON.parse(cached('match',match).data);
  assert.equal(history.roster[0].username,'Cuenta eliminada');assert.equal(history.roster[0].gamertag,null);
  assert.equal(history.roster[0].id,job.user_id);assert.equal(history.roster[0].kills,16);assert.equal(history.score_a,4);assert.equal(history.roster[1].username,'Other player');
  const returned=rememberCompetitionData('match',{match:{id:match,manager_version:3},dossier:{id:match,version:3,kind:'ranked',roster:roster(),score_a:4,score_b:1}});
  assert.equal(returned.dossier.roster[0].username,'Cuenta eliminada','HTTP/memory envelope is sanitized too, not just Save');
  assert.equal(returned.dossier.roster[1].username,'Other player');
  assert.throws(()=>rememberCaseData('incident',{incident:{id:randomUUID(),manager_version:1},messages:[{author_id:job.user_id,body:'Private late HTTP-only message'}]}),{status:409});
  personalAbsent(['Original private name','Original private tag','Late private name','Late private evidence','Private late HTTP-only message']);
  assert.ok(db.prepare('SELECT 1 FROM account_erasure_local_receipts WHERE receipt_sha256=?').get(sent.receipt_sha256));
  ack.resolve();const result=await inspection;assert.equal(result.state,'awaiting_confirmation');
  assert.throws(()=>ingestSnapshot({sanctions:[{id:randomUUID(),subject_id:job.user_id,subject_name:'Post ACK private name',reason:'Post ACK private evidence'}]}),{status:409});
  personalAbsent(['Post ACK private name','Post ACK private evidence']);
});

test('UUIDs only in prose/keys and raw unknown profile fields cannot evade the ingestion fence',()=>{
  const job=fixture();assert.equal(createErasureInspector(db)(job).status,'clear');
  const safeId=randomUUID(),safe={id:safeId,kind:'ranked',version:1,title:'Independent synthetic match',roster:[]};
  for(const input of [
    {id:randomUUID(),title:`Private title ${job.user_id.toUpperCase()}`},
    {id:randomUUID(),reason:`Private reason ${job.user_id}`},
    {id:randomUUID(),[job.user_id]:'Unclassified private value'},
    {id:randomUUID(),roster:[{id:job.user_id,username:'Raw private name',unknown_profile_note:'Raw private note'}]},
    {id:randomUUID(),ctp_user_id:job.user_id,title:'Discarded identity private title'},
  ]){
    assert.throws(()=>ingestSnapshot({matches:[safe,input]}),{status:409,code:'erased_projection_refused'});
    assert.equal(cached('match',safeId),undefined,'a refused snapshot rolls back the entire batch');
  }
  // Direct cache adapters also fence before normalization can drop new fields.
  assert.throws(()=>rememberCompetitionData('match',{match:{id:safeId,manager_version:1},dossier:{...safe,roster:[{id:job.user_id,username:'Private dossier',unknown_note:'Private note'}]}}),{status:409});
  assert.equal(cached('match',safeId),undefined);
});

test('late evidence is refused without overwriting evidence already under custody',()=>{
  const job=fixture(),id=randomUUID();
  ingestSnapshot({incidents:[{id,version:1,reporter_id:job.user_id,reporter_name:'Custodied alias',title:'Custodied synthetic incident',reason:'Protected original evidence'}]});
  const checked=createErasureInspector(db)(job);assert.equal(checked.status,'blocked_policy');
  const before=cached('incident',id);
  assert.throws(()=>ingestSnapshot({incidents:[{id,version:2,reporter_id:job.user_id,reporter_name:'New private alias',reason:'New late private evidence'}]}),{status:409});
  assert.deepEqual(cached('incident',id),before);personalAbsent(['New private alias','New late private evidence']);
});

test('two SQLite writers cannot create a PC Check case between custody count and clear; prior custody blocks clear',t=>{
  const second=new DatabaseSync(process.env.DB_PATH);t.after(()=>second.close());second.exec('PRAGMA busy_timeout=0');
  const operatorId=Number(db.prepare("INSERT INTO users(username,name,password_hash,is_admin,created_at) VALUES(?,'Synthetic custodian','not-a-login',1,0)").run(`custodian_${randomUUID()}`).lastInsertRowid);
  const operator={...admin,id:operatorId,name:'Synthetic custodian'},store=createPcCheckStore(second,{origin:'http://localhost:3210',key:randomBytes(32)});store.init();
  const job=fixture(),create=id=>store.create(operator,{playerId:id,playerAlias:'Synthetic case alias',purpose:'Synthetic policy custody check',retentionDays:7,allowedScopes:1});
  const inspect=createErasureInspector(db),prepare=db.prepare;let attempted=false,writeFailure;
  db.prepare=function(sql,...args){
    const statement=prepare.call(this,sql,...args);
    if(sql==='SELECT id FROM pc_check_cases WHERE lower(player_id)=?'){
      const all=statement.all.bind(statement);
      statement.all=(...params)=>{const result=all(...params);if(params[0]===job.user_id){attempted=true;try{create(job.user_id);}catch(error){writeFailure=error;}}return result;};
    }
    return statement;
  };
  let checked;try{checked=inspect(job);}finally{db.prepare=prepare;}
  assert.equal(attempted,true);assert.equal(writeFailure?.errcode,5,'the competing real connection observed SQLITE_BUSY while inspection owned the writer lock');
  assert.equal(checked.status,'clear');assert.equal(checked.report.counts.pc_check_cases,0);
  assert.equal(second.prepare('SELECT count(*) n FROM pc_check_cases WHERE player_id=?').get(job.user_id).n,0);
  assert.throws(()=>create(job.user_id),{status:409},'after lock release the durable mark denies collection');
  const earlier=fixture(),item=create(earlier.user_id);
  second.prepare('UPDATE pc_check_cases SET evidence_ciphertext=? WHERE id=?').run(Buffer.from('Synthetic protected custody bytes'),item.id);
  const blocked=inspect(earlier);assert.equal(blocked.status,'blocked_policy');assert.equal(blocked.report.counts.pc_check_cases,1);
  assert.equal(Buffer.from(second.prepare('SELECT evidence_ciphertext FROM pc_check_cases WHERE id=?').get(item.id).evidence_ciphertext).toString(),'Synthetic protected custody bytes');
});
