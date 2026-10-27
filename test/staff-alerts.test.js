import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-staff-alerts-test-'));
Object.assign(process.env,{DATA_DIR:directory,DB_PATH:path.join(directory,'fixture.sqlite'),CTP_AUTH_MODE:'local',CTP_AUTH_URL:'',PUBLIC_ORIGIN:'',
 CTP_OPERATIONS_URL:'http://127.0.0.1:1/functions/v1/manager-operations',CTP_OPERATIONS_TOKEN:'staff-alerts-test-transport-only-0123456789',CTP_SIGNING_SECRET:'staff-alerts-test-independent-signing-0123456789',CTP_ENABLE_WRITES:'true',CTP_ALLOW_LOCAL_WRITES:'true',CTP_SYNC_SECONDS:'0'});
const uuid='247abcde-0000-4000-8000-000000000001',other='247abcde-0000-4000-8000-000000000002',date='2026-10-27T12:00:00Z';
const snapshot=()=>({available:true,observed_at:date,version:1,providers:[{provider:'discord',enabled:false},{provider:'telegram',enabled:false}],counts:{pending:0,claimed:0,dispatching:0,sent:0,uncertain:1,failed:0,cancelled:0},recent:[{id:uuid,event_kind:'ticket.opened',resource_kind:'ticket',resource_id:other,link_id:other,created_at:date,provider:'discord',status:'uncertain',attempts:1,error_code:'delivery_uncertain'}]});
const configure=()=>({action:'configure',expected_version:1,request_id:uuid,reason:'Activar avisos para el staff',providers:[{provider:'discord',enabled:true},{provider:'telegram',enabled:false}]});
const transportCalls=[],receipts=new Map();
const originalFetch=globalThis.fetch;
globalThis.fetch=async(_url,options)=>{
 const body=JSON.parse(options.body);transportCalls.push(body);
 assert.equal(body.action,'admin_service');
 assert(options.headers['X-CTP-Signature']||Object.keys(options.headers).some(name=>name.toLowerCase().includes('signature')),'transport remains signed');
 if(body.service!=='staff_alerts')return new Response(JSON.stringify({error:'PRIVATE-SQL-DATA'}),{status:503,headers:{'Content-Type':'application/json'}});
 let data=snapshot();
 if(body.payload.action==='configure'){
  if(!receipts.has(body.payload.request_id))receipts.set(body.payload.request_id,{...data,version:2,providers:body.payload.providers,request_id:body.payload.request_id});
  data=receipts.get(body.payload.request_id);
 }
 return new Response(JSON.stringify({ok:true,data:{...data,token:'PRIVATE-SQL-DATA',destination_id:'PRIVATE-SQL-DATA'}}),{headers:{'Content-Type':'application/json'}});
};
const {staffAlertsPayload,staffAlertsResponse}=await import('../server/staff-alerts-contract.js');
const {createStaffAlertsClient}=await import('../server/staff-alerts-client.js');
const {getAdministrationService}=await import('../server/integration.js');
const {integrationServicesStatus}=await import('../server/administration-services.js');
const {administrationRouter}=await import('../server/routes/administration.js');
const {setupAdmin,createSession}=await import('../server/auth.js');
const {SESSION_COOKIE}=await import('../server/config.js');
const {db}=await import('../server/db.js');
after(()=>{globalThis.fetch=originalFetch;db.close();assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true,maxRetries:5});});
const admin={id:1,is_admin:true,auth_mode:'ctp',ctp_role:'admin'};

test('staff alert payloads accept only status or complete versioned configuration with a stable UUID',()=>{
 assert.deepEqual(staffAlertsPayload({action:'status'}),{action:'status'});
 const input=configure();input.reason='  Activar avisos para el staff  ';input.providers.reverse();input.request_id=uuid.toUpperCase();
 assert.deepEqual(staffAlertsPayload(input),configure());
 for(const bad of [null,[],{action:'send'},{action:'retry'},{action:'status',limit:30},{...configure(),expected_version:0},{...configure(),expected_version:'1'},
  {...configure(),request_id:'nonce'},{...configure(),reason:'corto'},{...configure(),reason:'a'.repeat(501)},{...configure(),reason:'motivo con\ncontrol'},
  {...configure(),providers:[{provider:'discord',enabled:true}]},{...configure(),providers:[{provider:'discord',enabled:true},{provider:'discord',enabled:false}]},
  {...configure(),providers:[{provider:'discord',enabled:'true'},{provider:'telegram',enabled:false}]},{...configure(),destination_id:other},
  {...configure(),providers:[{provider:'discord',enabled:true,token:'PRIVATE-SQL-DATA'},{provider:'telegram',enabled:false}]}])assert.throws(()=>staffAlertsPayload(bad),error=>error.status===400&&!error.message.includes('PRIVATE'));
});

test('staff DTO projection removes private extras and preserves complete aggregates without fabricated zeros',()=>{
 const value=snapshot();value.token='PRIVATE-SQL-DATA';value.providers[0].destination_id='PRIVATE-SQL-DATA';value.recent[0].message='PRIVATE-SQL-DATA';value.counts.private=900;
 const result=staffAlertsResponse(value);assert.deepEqual(result,snapshot());assert.doesNotMatch(JSON.stringify(result),/PRIVATE|destination|token|message|private/);
 const changes=[v=>v.available=false,v=>delete v.counts.pending,v=>v.counts.sent=-1,v=>v.version=0,v=>v.observed_at='no-date',v=>v.providers.pop(),v=>v.providers[1].provider='discord',
  v=>v.recent.push(...Array.from({length:30},()=>({...v.recent[0]}))),v=>v.recent[0].status='unknown',v=>v.recent[0].attempts=6,v=>v.recent[0].error_code='PRIVATE-SQL-DATA',
  v=>v.recent[0].link_id='https://private.example/#token',v=>v.recent[0].resource_kind='ranked_dispute',v=>v.recent.push({...v.recent[0]})];
 for(const alter of changes){const invalid=snapshot();alter(invalid);assert.throws(()=>staffAlertsResponse(invalid),error=>error.status===502&&!/PRIVATE|private\.example/.test(error.message));}
});

test('an audited canary has its own type and reference, without creating a new send action',()=>{
 const value=snapshot();value.recent[0]={...value.recent[0],event_kind:'staff.canary',resource_kind:'canary',resource_id:other,link_id:other};
 const projected=staffAlertsResponse(value);assert.equal(projected.recent[0].event_kind,'staff.canary');
 for(const change of [{resource_kind:'ticket'},{event_kind:'ticket.opened'},{resource_id:uuid}]){
  const malformed=structuredClone(value);Object.assign(malformed.recent[0],change);assert.throws(()=>staffAlertsResponse(malformed),{status:502});
 }
 assert.throws(()=>staffAlertsPayload({action:'canary',request_id:uuid}),{status:400});
});

test('configuration success requires the exact receipt and requested provider states',()=>{
 const payload=configure(),result={...snapshot(),version:2,request_id:uuid,providers:payload.providers};
 assert.equal(staffAlertsResponse(result,payload).request_id,uuid);
 for(const alter of [v=>delete v.request_id,v=>v.request_id=other,v=>v.providers[0].enabled=false,v=>v.version=0]){
  const bad=structuredClone(result);alter(bad);assert.throws(()=>staffAlertsResponse(bad,payload),{status:502});
 }
 assert.equal(staffAlertsResponse(result).request_id,undefined,'status never echoes a nonce supplied as an extra field');
});

test('staff client gates current administrators and writes before contacting CTP',async()=>{
 const calls=[];let writes=false;
 const read=createStaffAlertsClient({writesEnabled:()=>writes,actorFor:()=> 'admin.dev',request:async body=>{calls.push(body);return snapshot();}});
 for(const [user,status]of[[null,401],[{id:2,is_admin:false,sections:['arbitraje']},403],[{...admin,ctp_role:'referee'},403]])await assert.rejects(()=>read(user,{action:'status'}),{status});
 await assert.rejects(()=>read(admin,configure()),{status:403});assert.equal(calls.length,0);
 assert.deepEqual(await read(admin,{action:'status'}),snapshot());assert.deepEqual(calls,[{action:'admin_service',actor_id:'admin.dev',service:'staff_alerts',payload:{action:'status'}}]);
 writes=true;await assert.rejects(()=>read(admin,{action:'send'}),{status:400});assert.equal(calls.length,1);
});

test('ambiguous configuration and malformed success are not retried automatically or relayed raw',async()=>{
 for(const upstream of [Object.assign(new Error('PRIVATE SQL provider token'),{status:409}),Object.assign(new Error('PRIVATE SQL provider token'),{status:500})]){
  let calls=0;const service=createStaffAlertsClient({writesEnabled:()=>true,actorFor:()=> 'admin.dev',request:async()=>{calls++;throw upstream;}});
  await assert.rejects(()=>service(admin,configure()),error=>error.status===(upstream.status===409?409:502)&&!/PRIVATE|SQL|token/.test(error.message));assert.equal(calls,1);
 }
 const service=createStaffAlertsClient({writesEnabled:()=>true,actorFor:()=> 'admin.dev',request:async()=>snapshot()});
 await assert.rejects(()=>service(admin,configure()),{status:502});
});

test('existing admin service uses signed staff_alerts requests and leaves partial integrations independent',async()=>{
 const adminId=setupAdmin({username:'alertsadmin',password:'local-test-password',name:'Admin fixture'});
 const user={id:adminId,is_admin:true};
 const before=transportCalls.length,result=await getAdministrationService(user,'staff_alerts',{action:'status'});
 assert.deepEqual(result,snapshot());assert.equal(transportCalls.length,before+1);assert.equal(transportCalls.at(-1).service,'staff_alerts');
 const services=await integrationServicesStatus(user);assert.equal(services.staff_alerts.available,true);assert.equal(services.twitch.available,false);assert.equal(services.push.available,false);
 assert.doesNotMatch(JSON.stringify(services),/PRIVATE-SQL-DATA|destination_id|token/);
});

function routed(method,body,cookie){
 return new Promise((resolve,reject)=>{
  const req={url:'/administration/integrations/staff-alerts',originalUrl:'/administration/integrations/staff-alerts',method,headers:{cookie:cookie||''},body};
  const res={statusCode:200,status(code){this.statusCode=code;return this;},json(data){resolve({status:this.statusCode,data});return this;}};
  administrationRouter.handle(req,res,error=>error?resolve({status:error.status||500,data:{error:error.message}}):reject(new Error('Staff alert route did not answer')));
 });
}
test('existing administration routes deny anonymous and referee sessions; admins can read and idempotently configure with mock CTP',async()=>{
 const adminRow=db.prepare('SELECT id FROM users WHERE username=?').get('alertsadmin');assert(adminRow);
 const staffId=Number(db.prepare('INSERT INTO users(username,name,password_hash,is_admin,created_at) VALUES(?,?,?,?,?)').run('alertsref','Referee fixture','unused',0,Date.now()).lastInsertRowid);
 const role=db.prepare("SELECT id FROM roles WHERE staff_kind='referee' LIMIT 1").get();assert(role);db.prepare('INSERT INTO user_roles(user_id,role_id) VALUES(?,?)').run(staffId,role.id);
 const session=id=>`${SESSION_COOKIE}=${createSession({cookie(){}},id)}`;
 const adminCookie=session(adminRow.id),staffCookie=session(staffId),before=transportCalls.length;
 for(const method of ['GET','POST']){
  assert.equal((await routed(method,configure())).status,401);
  assert.equal((await routed(method,configure(),staffCookie)).status,403);
 }
 assert.equal(transportCalls.length,before,'denied routes do not contact CTP');
 const current=await routed('GET',undefined,adminCookie);assert.equal(current.status,200);assert.deepEqual(current.data,snapshot());
 const invalid=await routed('POST',{...configure(),destination_id:other},adminCookie);assert.equal(invalid.status,400);
 const payload=configure(),first=await routed('POST',payload,adminCookie),second=await routed('POST',payload,adminCookie);
 assert.equal(first.status,200);assert.deepEqual(second,first);assert.equal(first.data.request_id,payload.request_id);assert.equal(receipts.size,1);
 assert.doesNotMatch(JSON.stringify(first),/PRIVATE|destination_id|token/);
});
