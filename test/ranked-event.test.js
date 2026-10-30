import test,{after}from'node:test';
import assert from'node:assert/strict';
import fs from'node:fs';import os from'node:os';import path from'node:path';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-event-test-'));
Object.assign(process.env,{DATA_DIR:directory,DB_PATH:path.join(directory,'fixture.sqlite'),CTP_AUTH_MODE:'local',CTP_AUTH_URL:'',PUBLIC_ORIGIN:'',CTP_SYNC_SECONDS:'0'});
const{createRankedEventClient,rankedEventPayload,rankedEventResponse}=await import('../server/ranked-event-client.js');
const{db}=await import('../server/db.js');
const{eventObservationReceivedAt,rankedEventBoundaryAttempt,rankedEventBoundaryWindow,rankedEventConfigured,rankedEventReadDue,rankedEventReading,rotationCountdown}=await import('../client/src/operations/ranked-event-model.js');
after(()=>{db.close();assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert(path.basename(directory).startsWith('ctp-event-test-'));fs.rmSync(directory,{recursive:true,force:true,maxRetries:5});});
const admin={id:1,is_admin:true,auth_mode:'ctp',ctp_role:'admin'};
const snapshot=()=>({schema_version:1,event_id:'hw-2026',enabled:false,theme:'halloween',xp_multiplier:2,streak_bonus:0.5,starts_at:null,ends_at:null,revision:1,server_time:'2026-10-27T12:00:00Z'});
const request=()=>({action:'configure',expected_version:1,request_id:'26000000-0000-4000-8000-000000000001',reason:'Activate the reviewed Halloween event',enabled:true});
const fixed=['Lotus','Mumbai','Munition','Reactor U92','Rooftops','Silkworm'];
const rotation=(enabled=true,active='Sentry')=>({schema_version:1,event_id:'hw-2026',enabled,interval_seconds:1200,frozen:false,
 active_map:enabled?active:null,next_map:enabled?(active==='Sentry'?'Lithium':'Sentry'):null,
 slot_starts_at:enabled?'2026-10-28T12:00:00Z':null,next_rotation_at:enabled?'2026-10-28T12:20:00Z':null,
 observed_at:'2026-10-28T12:19:59Z',fixed_maps:[...fixed],active_pool:enabled?[...fixed,active]:['Coal',...fixed]});
const rotated=(enabled=true)=>({...snapshot(),enabled,server_time:'2026-10-28T12:19:59Z',map_rotation:rotation(enabled)});
const scheduled=(configured_enabled=true,server_time='2026-10-30T13:59:59Z')=>{
 const at=Date.parse(server_time),phase=!configured_enabled?'disabled':at<Date.parse('2026-10-30T14:00:00Z')?'scheduled':at<Date.parse('2026-11-03T14:00:00Z')?'active':'ended';
 const enabled=phase==='active',slot=Math.floor(at/1200000)*1200000;
 return{...snapshot(),configured_enabled,phase,enabled,server_time,timezone:'Europe/Madrid',starts_at:'2026-10-30T14:00:00Z',ends_at:'2026-11-03T14:00:00Z',
  map_rotation:{...rotation(enabled),observed_at:server_time,slot_starts_at:enabled?new Date(slot).toISOString():null,next_rotation_at:enabled?new Date(slot+1200000).toISOString():null}};
};
test('event payload accepts only fixed switches and safe reasons',()=>{
 assert.deepEqual(rankedEventPayload(request()),request());assert.deepEqual(rankedEventPayload({action:'status'}),{action:'status'});
 for(const mutation of[{xp_multiplier:99},{streak_bonus:99},{map_rotation:{}},{active_map:'Sentry'},{interval_seconds:1},{user_id:'1'},{starts_at:'2026-10-30T14:00:00Z'},{ends_at:'2026-11-03T14:00:00Z'},{configured_enabled:true},{phase:'active'},{timezone:'Europe/Madrid'},{enabled:'true'},{reason:'short'},{reason:'bad\n'.repeat(5)},{expected_version:0},{request_id:'wrong'}])assert.throws(()=>rankedEventPayload({...request(),...mutation}),error=>error.status===400);
});

test('scheduled event validates the fixed Madrid window, server phases and effective activity',()=>{
 for(const [configured,at,phase]of[[false,'2026-10-30T14:00:00Z','disabled'],[true,'2026-10-30T13:59:59.999999Z','scheduled'],[true,'2026-10-30T14:00:00Z','active'],[true,'2026-11-03T13:59:59.999999Z','active'],[true,'2026-11-03T14:00:00Z','ended']]){
  const source=scheduled(configured,at),result=rankedEventResponse(source);
  assert.deepEqual(result,source);assert.equal(result.phase,phase);assert.equal(result.enabled,phase==='active');
  assert.equal(result.map_rotation.enabled,result.enabled);assert.equal(rankedEventConfigured(result),configured);
 }
 const offsets=scheduled();offsets.starts_at='2026-10-30T15:00:00+01:00';offsets.ends_at='2026-11-03T15:00:00+01:00';
 assert.deepEqual(rankedEventResponse(offsets),offsets);
 assert.equal(Date.parse(offsets.ends_at)-Date.parse(offsets.starts_at),96*60*60*1000);
});

test('scheduled event rejects partial, arbitrary and internally inconsistent schedule responses',()=>{
 const source=scheduled();
 for(const mutation of[{configured_enabled:undefined},{configured_enabled:'true'},{phase:undefined},{timezone:undefined},{timezone:'UTC'},
  {starts_at:null},{ends_at:null},{starts_at:'2026-10-30T15:00:00Z'},{ends_at:'2026-11-03T15:00:00Z'},
  {phase:'active'},{phase:'ended'},{enabled:true},{configured_enabled:false},{phase:'disabled'},
  {map_rotation:{...source.map_rotation,enabled:true}}])assert.throws(()=>rankedEventResponse({...source,...mutation}),error=>error.status===502);
 for(const key of['configured_enabled','phase','timezone'])assert.throws(()=>rankedEventResponse({...snapshot(),[key]:source[key]}),error=>error.status===502);
 const parsed=rankedEventResponse({...source,staff_token:'PRIVATE_VALUE'});assert.equal(parsed.staff_token,undefined);
});

test('only an explicit PRE preview accepts a bounded early start and server phase',()=>{
 const source={...scheduled(true,'2026-10-30T10:02:00Z'),starts_at:'2026-10-30T10:01:00.123456Z',
  preview_environment:'pre',phase:'active',enabled:true};
 const at=Date.parse(source.server_time),slot=Math.floor(at/1200000)*1200000;
 source.map_rotation={...rotation(true),observed_at:source.server_time,slot_starts_at:new Date(slot).toISOString(),next_rotation_at:new Date(slot+1200000).toISOString()};
 assert.deepEqual(rankedEventResponse(source),source);
 assert.equal(rankedEventReading(rankedEventResponse(source),1000,1500).status,'active');
 const before={...source,server_time:'2026-10-30T10:00:59Z',phase:'scheduled',enabled:false,
  map_rotation:{...rotation(false),observed_at:'2026-10-30T10:00:59Z'}};
 assert.deepEqual(rankedEventResponse(before),before);
 assert.equal(rankedEventBoundaryWindow(before),source.starts_at);
 assert.equal(rankedEventReading(before,1000,3000).status,'boundary');
 const normal={...source};delete normal.preview_environment;
 assert.throws(()=>rankedEventResponse(normal),error=>error.status===502,'ordinary PROD contract still rejects early start');
 for(const mutation of[{preview_environment:'prod'},{preview_environment:'PRE'},{preview_environment:null},{preview_environment:undefined},
  {starts_at:'2026-10-29T23:59:59.999Z'},{starts_at:'2026-10-30T14:00:00Z'},{starts_at:'2026-10-30T15:00:00Z'},
  {ends_at:'2026-11-03T13:59:59Z'},{phase:'scheduled'},{enabled:false}]){
  assert.throws(()=>rankedEventResponse({...source,...mutation}),error=>error.status===502);
 }
 for(const preview_environment of['pre','prod',null,undefined])assert.throws(()=>rankedEventResponse({...snapshot(),preview_environment}),error=>error.status===502);
 assert.throws(()=>rankedEventPayload({...request(),preview_environment:'pre'}),error=>error.status===400);
});

test('configure acknowledges armed state before start and after expiry, preserving exact receipt replay',()=>{
 for(const at of['2026-10-30T13:59:59Z','2026-11-03T14:00:00Z']){
  const result={...scheduled(true,at),revision:2,request_id:request().request_id};
  assert.equal(result.enabled,false);assert.deepEqual(rankedEventResponse(result,request()),result);
  assert.throws(()=>rankedEventResponse({...result,configured_enabled:false,phase:'disabled'},request()),error=>error.status===502);
 }
 const disabled={...scheduled(false),revision:2,request_id:request().request_id};
 assert.deepEqual(rankedEventResponse(disabled,{...request(),enabled:false}),disabled);
});

test('schedule boundaries request a fresh server read without inferring activity or resetting armed state',()=>{
 const before=scheduled(true,'2026-10-30T13:59:59Z');
 assert.equal(rankedEventConfigured(before),true);assert.equal(before.enabled,false);
 assert.equal(rankedEventReading(before,1000,1500).status,'off');
 assert.equal(rankedEventBoundaryWindow(before),before.starts_at);
 const boundary=rankedEventReading(before,1000,2000);assert.equal(boundary.status,'boundary');assert.equal(boundary.rotation,null);
 assert.equal(before.phase,'scheduled');assert.equal(before.enabled,false);
 assert.equal(rankedEventBoundaryAttempt(before,{window:before.starts_at,at:2000}),2000);
 const read={snapshot:before,receivedAt:1000,lastAttemptAt:1000,lastBoundaryAttemptAt:null,now:2000,visible:true};
 assert.equal(rankedEventReadDue(read),true);assert.equal(rankedEventReadDue({...read,visible:false}),false);
 assert.equal(rankedEventReadDue({...read,lastBoundaryAttemptAt:2000,now:6999}),false);
 assert.equal(rankedEventReadDue({...read,lastBoundaryAttemptAt:2000,now:7000}),true);
 const ending=scheduled(true,'2026-11-03T13:59:59Z');
 assert.equal(rankedEventBoundaryWindow(ending),ending.ends_at);
 assert.equal(rankedEventReading(ending,1000,1500).status,'active');
 assert.equal(rankedEventReading(ending,1000,2000).status,'boundary');
 assert.equal(rankedEventConfigured(scheduled(true,'2026-11-03T14:00:00Z')),true);
 assert.equal(rankedEventReading(scheduled(true,'2026-11-03T14:00:00Z'),1000,1500).status,'off');
 assert.equal(rankedEventBoundaryWindow(scheduled(false)),null);
});

test('event rotation whitelists the exact seven-map server pool with Lotus and preserves the ordinary OFF pool',()=>{
 for(const enabled of[false,true]){
  const source=rotated(enabled),parsed=rankedEventResponse({...source,map_rotation:{...source.map_rotation,token:'PRIVATE_VALUE'}});
  assert.deepEqual(parsed,source);assert.notEqual(parsed.map_rotation.fixed_maps,source.map_rotation.fixed_maps);
  assert.notEqual(parsed.map_rotation.active_pool,source.map_rotation.active_pool);
  assert.equal(parsed.map_rotation.active_pool.length,7);
  assert.equal(parsed.map_rotation.fixed_maps.length,6);
  assert.ok(parsed.map_rotation.active_pool.includes('Lotus'));
  assert.equal(parsed.map_rotation.active_pool.includes('Coal'),!enabled);
 }
 const next=rotated(true);next.map_rotation=rotation(true,'Lithium');assert.equal(rankedEventResponse(next).map_rotation.active_map,'Lithium');
 assert.equal(rankedEventResponse(snapshot()).map_rotation,undefined,'legacy responses remain readable without inventing a pool');
});

test('event rotation rejects foreign maps, bad windows, mismatched flags and historical lobby snapshots',()=>{
 const bad=[{schema_version:2},{event_id:'other'},{enabled:false},{interval_seconds:1199},{frozen:true},{active_map:'Coal'},{next_map:'Sentry'},
  {active_pool:[...fixed,'Sentry','Lithium']},{active_pool:['Coal',...fixed]},{fixed_maps:[...fixed.slice(0,5),'Mumbai']},
  {fixed_maps:fixed.filter(name=>name!=='Lotus')},{fixed_maps:['Coal',...fixed.slice(1)]},
  {fixed_maps:['lotus',...fixed.slice(1)]},{active_pool:[...fixed,'Unknown map']},
  {slot_starts_at:'2026-10-28T12:00:01Z'},{next_rotation_at:'2026-10-28T12:19:59Z'},
  {observed_at:'2026-10-28T12:19:59'},{observed_at:'2026-10-28T12:20:00Z'},{observed_at:'2026-10-28T11:59:59Z'}];
 for(const mutation of bad)assert.throws(()=>rankedEventResponse({...rotated(true),map_rotation:{...rotation(),...mutation}}),error=>error.status===502);
 for(const mutation of[{active_map:'Sentry'},{next_map:'Lithium'},{slot_starts_at:'2026-10-28T12:00:00Z'},{active_pool:[...fixed,'Lithium']}]){
  assert.throws(()=>rankedEventResponse({...rotated(false),map_rotation:{...rotation(false),...mutation}}),error=>error.status===502);
 }
});

test('displayed rotation expires at the server boundary without predicting the next map',()=>{
 const event=rotated(true);
 assert.equal(rankedEventReading(event,1000,1500).status,'active');assert.equal(rankedEventReading(event,1000,1500).seconds,1);
 const boundary=rankedEventReading(event,1000,2000);assert.equal(boundary.status,'boundary');assert.equal(boundary.rotation,null);
 for(const reading of[rankedEventReading(event,1000,1000+75000),rankedEventReading(event,1000,999),rankedEventReading(event,1000,1500,true)]){
  assert.equal(reading.status,'stale');assert.equal(reading.rotation,null);
 }
 assert.equal(rankedEventReading(rotated(false),1000,1500).status,'off');
 assert.equal(rankedEventReading(snapshot(),1000,1500).status,'unavailable');
 assert.equal(rotationCountdown(1200),'20:00');assert.equal(rotationCountdown(59),'00:59');assert.equal(rotationCountdown(-1),'—');
});

test('cached status cannot extend a map slot and regressing server observations fail closed',()=>{
 const prior=rotated(true),received=eventObservationReceivedAt(prior,1000,prior,3000);
 assert.equal(received,1000);assert.equal(rankedEventReading(prior,received,3000).status,'boundary');
 const next={...prior,server_time:'2026-10-28T12:20:01Z',map_rotation:{...rotation(true,'Lithium'),observed_at:'2026-10-28T12:20:01Z',slot_starts_at:'2026-10-28T12:20:00Z',next_rotation_at:'2026-10-28T12:40:00Z'}};
 assert.equal(eventObservationReceivedAt(prior,1000,next,3000),3000);
 assert.equal(rankedEventReading(next,3000,3000).rotation.active_map,'Lithium');
 assert.throws(()=>eventObservationReceivedAt(next,3000,prior,4000));
});

test('read-only refresh is visible-only, bounded on failures and immediate at a new server boundary',()=>{
 const state={snapshot:rotated(true),receivedAt:1000,lastAttemptAt:1000,now:2000,visible:true};
 assert.equal(rankedEventReadDue(state),true);
 assert.equal(rankedEventReadDue({...state,visible:false}),false);
 assert.equal(rankedEventReadDue({...state,lastBoundaryAttemptAt:1900}),false);
 assert.equal(rankedEventReadDue({...state,lastBoundaryAttemptAt:1900,now:6900}),true);
 assert.equal(rankedEventReadDue({...state,stale:true}),false);
 assert.equal(rankedEventReadDue({...state,stale:true,now:31000}),true);
 assert.equal(rankedEventReadDue({...state,snapshot:rotated(false),now:30999}),false);
 assert.equal(rankedEventReadDue({...state,snapshot:rotated(false),now:31000}),true);
});
test('boundary lookup is safe before the first response and for OFF or legacy snapshots',()=>{
 const last={window:'2026-10-28T12:20:00Z',at:1900};
 for(const event of[null,snapshot(),rotated(false)]){
  assert.equal(rankedEventBoundaryAttempt(event,null),null);
  assert.equal(rankedEventBoundaryAttempt(event,last),null);
 }
 assert.equal(rankedEventBoundaryAttempt(rotated(true),null),null);
 assert.equal(rankedEventBoundaryAttempt(rotated(true),last),1900);
 assert.equal(rankedEventBoundaryAttempt(rotated(true),{...last,window:'2026-10-28T12:40:00Z'}),null);
});
test('event response validates policy and strips every unagreed field',()=>{
 assert.deepEqual(rankedEventResponse({...snapshot(),secret:'do not expose'}),snapshot());
 for(const mutation of[{enabled:null},{revision:0},{xp_multiplier:1},{xp_multiplier:99},{streak_bonus:0.6},{theme:'other'},{server_time:'invalid'},{ends_at:'future'}])assert.throws(()=>rankedEventResponse({...snapshot(),...mutation}),error=>error.status===502);
 assert.throws(()=>rankedEventResponse({...snapshot(),enabled:true,revision:2,request_id:'26000000-0000-4000-8000-000000000002'},request()),error=>error.status===502);
});

test('event contract accepts only the canonical double base XP policy in every flag state',()=>{
 for(const enabled of[false,true]){
  const policy={...snapshot(),enabled};
  assert.equal(rankedEventResponse(policy).xp_multiplier,2);
  assert.equal(rankedEventResponse(policy).streak_bonus,0.5);
  for(const xp_multiplier of[null,0,1,2.5,99,'2'])assert.throws(()=>rankedEventResponse({...policy,xp_multiplier}),error=>error.status===502);
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
