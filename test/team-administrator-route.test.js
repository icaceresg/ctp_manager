import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// Synthetic HTTP bridge only. No hosted CTP request, account or team is used.
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-team-administrator-route-'));
const origin='https://pre.manager.playctp.com';
const admin='10000000-0000-4000-8000-000000000001',referee='10000000-0000-4000-8000-000000000002',manager='10000000-0000-4000-8000-000000000003',backup='10000000-0000-4000-8000-000000000004';
const teams=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003'];
Object.assign(process.env,{DATA_DIR:temporary,DB_PATH:path.join(temporary,'route.db'),PUBLIC_ORIGIN:origin,
 CTP_AUTH_MODE:'ctp',CTP_AUTH_URL:'https://pre.playctp.com',CTP_WEB_ORIGIN:'https://pre.playctp.com',
 CTP_AUTH_TOKEN_KEY:crypto.randomBytes(32).toString('base64url'),CTP_AUTH_ANON_KEY:`e30.${Buffer.from('{"role":"anon","exp":4102444800}').toString('base64url')}.fixture`,
 CTP_OPERATIONS_URL:'https://pre.playctp.com/functions/v1/manager-operations',CTP_OPERATIONS_TOKEN:'team-admin-fixture-transport-0123456789',
 CTP_SIGNING_SECRET:'team-admin-independent-signature-0123456789',CTP_ENABLE_WRITES:'true',CTP_SYNC_SECONDS:'0'});
const originalFetch=globalThis.fetch,sessions=new Map(),requests=[],receipts=new Map();
const snapshots=new Map(teams.map(team_id=>[team_id,{team_id,version:0,items:[],competitive_members:[]}]));
let forcedError=null;
globalThis.fetch=async(url,init)=>{
 const body=JSON.parse(init.body);
 if(url.includes('grant_type=password')){
  const id=body.email.startsWith('admin')?admin:referee,token=crypto.randomUUID();sessions.set(token,id);
  return Response.json({user:{id},access_token:token,refresh_token:`fixture:${id}`,expires_in:3600});
 }
 if(url.endsWith('/manager-operations')){
  requests.push(body);assert.equal(body.actor_id,`ctp:${admin}`);assert.equal(body.action,'admin_service');assert.equal(body.service,'team_administrators');
  if(forcedError)return Response.json({ok:false,code:'invalid_request',team_administrators_error:forcedError,raw:'private provider data'},{status:422});
  const p=body.payload;
  if(p.action==='candidates')return Response.json({ok:true,data:{items:[{user_id:manager,username:'QA Coordinator',email:'private@example.invalid'}]}});
  if(p.action==='overview')return Response.json({ok:true,data:{user_id:manager,username:'QA Coordinator',teams:teams.filter(id=>snapshots.get(id).items.some(row=>row.user_id===manager)).map((team_id,index)=>({team_id,name:['QA Principal','QA Academy','QA Femenino'][index],tag:`QA${index}`,member_count:4,
   entitlements:index===0?[{kind:'team_pass',receipt:'private payment'}]:[],registrations:[{tournament_id:team_id,name:'QA inaugural',status:'inscripcion_abierta',roster_count:4}],secret:'private'}))}});
  const current=snapshots.get(p.team_id);assert.ok(current);
  if(p.action==='get')return Response.json({ok:true,data:current});
  if(receipts.has(p.request_id))return Response.json({ok:true,data:receipts.get(p.request_id)});
  if(p.expected_version!==current.version)return Response.json({ok:false,team_administrators_error:'teams.administration.conflict'},{status:422});
  if(p.action==='convert')assert.ok(Object.hasOwn(p,'captain_id'));
  const enabled=p.action==='convert'||p.enabled;
  const changed=enabled?!current.items.some(row=>row.user_id===p.user_id):current.items.some(row=>row.user_id===p.user_id);
  if(!enabled&&changed&&current.items.length===1&&!current.competitive_members.length)return Response.json({ok:false,team_administrators_error:'teams.administration.captainRequired'},{status:422});
  const items=enabled?(changed?[...current.items,{user_id:p.user_id,username:'QA Coordinator',created_at:'2026-11-04T10:00:00Z',email:'private@example.invalid'}]:current.items):current.items.filter(row=>row.user_id!==p.user_id);
  const next={...current,version:current.version+Number(changed),items,request_id:p.request_id,changed};
  snapshots.set(p.team_id,next);receipts.set(p.request_id,next);
  return Response.json({ok:true,data:next});
 }
 const id=sessions.get(init.headers.Authorization?.replace('Bearer ',''));
 if(!id)return Response.json({},{status:403});
 return Response.json({ctp_user_id:id,username:'Fixture',role:id===admin?'admin':'referee',actor_id:`ctp:${id}`,scopes:['ranked.read','ranked.chat']});
};
const auth=await import('../server/auth.js');
const {db}=await import('../server/db.js');
const {requestBoundary}=await import('../server/config.js');
const {administrationRouter}=await import('../server/routes/administration.js');
const app=express();
app.use((req,res,next)=>{const error=requestBoundary(req);return error?res.status(403).json({error}):next();});
app.use(express.json());app.use('/api',administrationRouter);
app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.status?error.message:'Internal error'}));
const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
after(async()=>{await new Promise(resolve=>server.close(resolve));globalThis.fetch=originalFetch;db.close();assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5});});
async function signIn(name){let cookie;await auth.loginCtp(`${name}@example.invalid`,'fixture-password',{cookie(key,value){cookie=`${key}=${value}`;}});return cookie;}
function api(method,route,body,cookie=''){
 return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:`/api${route}`,method,headers:{Host:'pre.manager.playctp.com',Origin:origin,'Sec-Fetch-Site':'same-origin',Cookie:cookie,'Content-Type':'application/json'}},res=>{let text='';res.on('data',part=>text+=part);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(text)}));});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));});
}
const pathFor=id=>`/administration/clubs/${id}/managers`;
const bodyFor=(version,enabled=true)=>({user_id:manager,enabled,expected_version:version,request_id:crypto.randomUUID(),reason:'Administración separada de los tres equipos QA'});

test('one confirmed administrator can assign a non-player to three teams and inspect separate passes',async()=>{
 const cookie=await signIn('admin');
 const candidates=await api('GET','/administration/team-administrators/candidates?query=Coordinator',undefined,cookie);
 assert.deepEqual(candidates.data,{items:[{user_id:manager,username:'QA Coordinator'}]});
 for(const team of teams){
  const first=await api('GET',pathFor(team),undefined,cookie);assert.equal(first.status,200);assert.equal(first.data.version,0);
  const body=bodyFor(0),saved=await api('POST',pathFor(team),body,cookie);
  assert.equal(saved.status,200);assert.equal(saved.data.version,1);assert.equal(saved.data.changed,true);
  assert.deepEqual(requests.at(-1).payload,{action:'set',team_id:team,...body});
  const retried=await api('POST',pathFor(team),body,cookie);assert.deepEqual(retried.data,saved.data);
 }
 const overview=await api('GET',`/administration/team-administrators/${manager}`,undefined,cookie);
 assert.equal(overview.status,200);assert.equal(overview.data.teams.length,3);assert.equal(overview.data.teams[0].entitlements[0].kind,'team_pass');
 assert.equal(overview.data.teams[1].entitlements.length,0);assert.doesNotMatch(JSON.stringify(overview.data),/private|email|receipt|secret/);
});
test('revocation checks source version, preserves other teams and converts only an explicit body',async()=>{
 const cookie=await signIn('admin');
 const stale=await api('POST',pathFor(teams[0]),bodyFor(0,false),cookie);assert.equal(stale.status,409);assert.equal(stale.data.error,'manager.teamAdmins.conflict');
 const orphan=await api('POST',pathFor(teams[0]),bodyFor(1,false),cookie);assert.equal(orphan.status,422);assert.equal(orphan.data.error,'manager.teamAdmins.captainRequired');
 assert.equal((await api('GET',pathFor(teams[0]),undefined,cookie)).data.version,1);
 const added=await api('POST',pathFor(teams[0]),{...bodyFor(1),user_id:backup},cookie);assert.equal(added.status,200);assert.equal(added.data.version,2);
 const revoke=await api('POST',pathFor(teams[0]),bodyFor(2,false),cookie);assert.equal(revoke.status,200);assert.equal(revoke.data.version,3);assert.equal(revoke.data.items.length,1);assert.equal(revoke.data.items[0].user_id,backup);
 const others=await api('GET',`/administration/team-administrators/${manager}`,undefined,cookie);assert.equal(others.data.teams.length,2);
 const convert={...bodyFor(3),captain_id:null};delete convert.enabled;
 const converted=await api('POST',`${pathFor(teams[0])}/convert`,convert,cookie);assert.equal(converted.status,200);assert.equal(requests.at(-1).payload.action,'convert');
 assert.equal(requests.at(-1).payload.captain_id,null);
});
test('anonymous/referee/invalid input cannot invoke staff administration and errors never relay raw data',async()=>{
 const cookie=await signIn('admin'),refCookie=await signIn('referee'),count=requests.length;
 assert.equal((await api('GET',pathFor(teams[0]))).status,401);
 for(const [method,route,body] of [['GET',pathFor(teams[0])],['POST',pathFor(teams[0]),bodyFor(3)],['GET',`/administration/team-administrators/${manager}`],['GET','/administration/team-administrators/candidates?query=manager']])assert.equal((await api(method,route,body,refCookie)).status,403);
 for(const patch of [{role:'admin'},{team_id:teams[1]},{expected_version:-1},{reason:'short'}])assert.equal((await api('POST',pathFor(teams[0]),{...bodyFor(3),...patch},cookie)).status,400);
 assert.equal((await api('GET','/administration/team-administrators/candidates?query=manager&email=true',undefined,cookie)).status,400);
 assert.equal(requests.length,count);
 forcedError='teams.administration.activeRoster';
 assert.deepEqual((await api('POST',pathFor(teams[0]),bodyFor(3),cookie)).data,{error:'manager.teamAdmins.activeRoster'});
 forcedError='private SQL provider token';
 const unknown=await api('POST',pathFor(teams[0]),bodyFor(3),cookie);assert.equal(unknown.status,422);assert.doesNotMatch(JSON.stringify(unknown.data),/private|SQL|token/);forcedError=null;
});
