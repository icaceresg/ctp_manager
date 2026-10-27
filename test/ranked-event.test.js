import test,{after}from'node:test';
import assert from'node:assert/strict';
import fs from'node:fs';import os from'node:os';import path from'node:path';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-event-test-'));
Object.assign(process.env,{DATA_DIR:directory,DB_PATH:path.join(directory,'fixture.sqlite'),CTP_AUTH_MODE:'local',CTP_AUTH_URL:'',PUBLIC_ORIGIN:'',CTP_SYNC_SECONDS:'0'});
const{createRankedEventClient,rankedEventPayload,rankedEventResponse}=await import('../server/ranked-event-client.js');
const{db}=await import('../server/db.js');
after(()=>{db.close();assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert(path.basename(directory).startsWith('ctp-event-test-'));fs.rmSync(directory,{recursive:true,force:true,maxRetries:5});});
const admin={id:1,is_admin:true,auth_mode:'ctp',ctp_role:'admin'};
const snapshot=()=>({schema_version:1,event_id:'hw-2026',enabled:false,theme:'halloween',xp_multiplier:1,streak_bonus:0.5,starts_at:null,ends_at:null,revision:1,server_time:'2026-10-27T12:00:00Z'});
const request=()=>({action:'configure',expected_version:1,request_id:'26000000-0000-4000-8000-000000000001',reason:'Activate the reviewed Halloween event',enabled:true});
test('event payload accepts only fixed switches and safe reasons',()=>{
 assert.deepEqual(rankedEventPayload(request()),request());assert.deepEqual(rankedEventPayload({action:'status'}),{action:'status'});
 for(const mutation of[{xp_multiplier:99},{streak_bonus:99},{user_id:'1'},{enabled:'true'},{reason:'short'},{reason:'bad\n'.repeat(5)},{expected_version:0},{request_id:'wrong'}])assert.throws(()=>rankedEventPayload({...request(),...mutation}),error=>error.status===400);
});
test('event response validates policy and strips every unagreed field',()=>{
 assert.deepEqual(rankedEventResponse({...snapshot(),secret:'do not expose'}),snapshot());
 for(const mutation of[{enabled:null},{revision:0},{xp_multiplier:2},{xp_multiplier:99},{streak_bonus:0.6},{theme:'other'},{server_time:'invalid'},{ends_at:'future'}])assert.throws(()=>rankedEventResponse({...snapshot(),...mutation}),error=>error.status===502);
 assert.throws(()=>rankedEventResponse({...snapshot(),enabled:true,revision:2,request_id:'26000000-0000-4000-8000-000000000002'},request()),error=>error.status===502);
});

test('event contract keeps the base win at one and rejects double XP in every flag state',()=>{
 for(const enabled of[false,true]){
  const policy={...snapshot(),enabled};
  assert.equal(rankedEventResponse(policy).xp_multiplier,1);
  assert.equal(rankedEventResponse(policy).streak_bonus,0.5);
  assert.throws(()=>rankedEventResponse({...policy,xp_multiplier:2}),error=>error.status===502);
 }
});
test('event client enforces the current CTP admin identity and writes switch',async()=>{
 const calls=[],actorCalls=[];
 const client=createRankedEventClient({writesEnabled:()=>true,actorFor:async user=>{actorCalls.push(user.id);return'fixture.admin';},request:async body=>{calls.push(body);return snapshot();}});
 for(const user of[null,{id:2,is_admin:false},{id:2,is_admin:true,auth_mode:'ctp',ctp_role:'referee'}])await assert.rejects(client(user,{action:'status'}),error=>[401,403].includes(error.status));
 assert.equal(calls.length,0);assert.equal(actorCalls.length,0);
 assert.deepEqual(await client(admin,{action:'status'}),snapshot());
 assert.deepEqual(calls[0],{action:'admin_service',actor_id:'fixture.admin',service:'ranked_event',payload:{action:'status'}});
 const disabled=createRankedEventClient({writesEnabled:()=>false,actorFor:()=>assert.fail('no actor lookup'),request:()=>assert.fail('no request')});
 await assert.rejects(disabled(admin,request()),error=>error.status===403);
});
test('event retries preserve request identity and errors never echo bridge text',async()=>{
 const seen=[];
 const client=createRankedEventClient({writesEnabled:()=>true,actorFor:async()=> 'fixture.admin',request:async body=>{seen.push(body.payload);return{...snapshot(),enabled:true,revision:2,request_id:body.payload.request_id};}});
 assert.deepEqual(await client(admin,request()),await client(admin,request()));assert.deepEqual(seen[0],seen[1]);
 for(const[status,expected]of[[403,403],[409,409],[422,422],[503,502]]){
  const failed=createRankedEventClient({writesEnabled:()=>true,actorFor:async()=> 'fixture.admin',request:async()=>{throw Object.assign(new Error('PRIVATE_DATABASE_TEXT'),{status});}});
  await assert.rejects(failed(admin,request()),error=>error.status===expected&&!error.message.includes('PRIVATE_DATABASE_TEXT'));
 }
});
