import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-case-contract-'));
Object.assign(process.env,{DATA_DIR:temporary,DB_PATH:path.join(temporary,'qa.sqlite'),CTP_AUTH_MODE:'local'});
const{CASE_ACTIONS,CASE_RESOURCE_TYPES,casePayload,caseQueryParameters}=await import('../server/case-contract.js');
const{db}=await import('../server/db.js');
const id='16500000-0000-4000-8000-000000000001';
after(()=>{db.close();assert.equal(path.dirname(path.resolve(temporary)),path.resolve(os.tmpdir()));assert.ok(path.basename(temporary).startsWith('ctp-case-contract-'));fs.rmSync(temporary,{recursive:true,force:true});});
test('case queries are allowlisted, scoped and bounded',()=>{
 assert.deepEqual(caseQueryParameters({resource:'incident',target_id:id}),{resource:'incident',target_id:id,filters:{}});
 assert.deepEqual(caseQueryParameters({resource:'match_context',target_id:id,kind:'challenge'}),{resource:'match_context',target_id:id,filters:{kind:'challenge'}});
 for(const query of [{resource:'auth.users',target_id:id},{resource:'incident',target_id:'bad'},{resource:'match_context',target_id:id},{resource:'incident',target_id:id,cursor:'x'.repeat(161)},{resource:'incident',target_id:id,select:'*'}])assert.throws(()=>caseQueryParameters(query),error=>error.status===400);
});
test('official status controls require known states and a communicated reason',()=>{
 assert.deepEqual(casePayload('incident.status',{status:'en_revision',reason:' Seguimiento oficial del expediente '}),{status:'en_revision',reason:'Seguimiento oficial del expediente'});
 for(const body of [{status:'open',reason:'Seguimiento oficial del expediente'},{status:'cerrado',reason:'short'},{status:'resuelto',reason:'Seguimiento oficial del expediente',official:true}])assert.throws(()=>casePayload('incident.status',body),error=>error.status===400);
 assert.equal(CASE_RESOURCE_TYPES['incident.status'],'case_incident');
});
test('participant messages preserve room-specific limits and cannot forge author or system',()=>{
 assert.deepEqual(casePayload('match.reply',{kind:'challenge',text:' Hola equipos '}),{kind:'challenge',text:'Hola equipos'});
 for(const body of [{kind:'challenge',text:'x'.repeat(301)},{kind:'tournament',text:'x'.repeat(5001)},{kind:'tournament',text:'Hola',system:true},{kind:'ranked',text:'Hola'},{kind:'challenge',text:''}])assert.throws(()=>casePayload('match.reply',body),error=>error.status===400);
 assert.equal(CASE_ACTIONS.length,2);
});
