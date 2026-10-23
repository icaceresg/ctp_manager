import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {lobbyFixture,lobbyId} from './fixtures/ranked-lobby.js';
import {monitorFixture} from './fixtures/ranked-monitor.js';

// An in-process fake CTP exercises real Manager sessions and HTTP middleware.
// It never contacts PRE/PROD or creates a CTP account/message.
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-ranked-chat-'));
const origin='https://pre.manager.playctp.com',host='pre.manager.playctp.com';
const secret='ranked-chat-signature-fixture-independent-0123456789';
const token='ranked-chat-transport-fixture-only-0123456789';
const admin='10000000-0000-4000-8000-000000000001',referee='10000000-0000-4000-8000-000000000002',staff='10000000-0000-4000-8000-000000000003';
Object.assign(process.env,{DATA_DIR:temp,DB_PATH:path.join(temp,'chat.db'),PUBLIC_ORIGIN:origin,CTP_AUTH_MODE:'ctp',CTP_AUTH_URL:'https://pre.playctp.com',CTP_WEB_ORIGIN:'https://pre.playctp.com',CTP_AUTH_TOKEN_KEY:crypto.randomBytes(32).toString('base64url'),CTP_AUTH_ANON_KEY:`e30.${Buffer.from('{"role":"anon","exp":4102444800}').toString('base64url')}.fixture`,CTP_OPERATIONS_URL:'https://pre.playctp.com/functions/v1/manager-operations',CTP_OPERATIONS_TOKEN:token,CTP_SIGNING_SECRET:secret,CTP_ENABLE_WRITES:'true',CTP_SYNC_SECONDS:'0'});
const roles=new Map([[admin,'admin'],[referee,'referee'],[staff,'staff']]),sessions=new Map(),messages=new Map(),observed=[];
let canSend=true,mode='ok',status='ready';
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,init)=>{
 const body=JSON.parse(init.body);
 if(url.includes('grant_type=password')){
  const id=body.email.startsWith('admin')?admin:body.email.startsWith('ref')?referee:staff,access=crypto.randomUUID();sessions.set(access,id);
  return Response.json({user:{id},access_token:access,refresh_token:`fixture:${id}`,expires_in:3600});
 }
 if(url.endsWith('/manager-operations')){
  observed.push(body);assert.equal(init.headers.Authorization,`Bearer ${token}`);
  const signed=signManagerRequest(init.body,secret,{timestamp:Number(init.headers['X-CTP-Timestamp']),nonce:init.headers['X-CTP-Nonce']});
  assert.equal(init.headers['X-CTP-Signature'],signed['X-CTP-Signature']);
  if(mode==='forbidden')return Response.json({secret:token},{status:403});
  if(body.action==='ranked_monitor')return Response.json({ok:true,data:monitorFixture()});
  if(body.action==='ranked_lobby_detail'){const data=lobbyFixture();data.chat.can_send=canSend;data.lobby.status=status;return Response.json({ok:true,data});}
  assert.equal(body.action,'ranked_lobby_chat');
  assert.deepEqual(Object.keys(body).sort(),['action','actor_id','message','request_id','target_id']);
  const prior=messages.get(body.request_id);
  if(prior&&(prior.actor_id!==body.actor_id||prior.target_id!==body.target_id||prior.message.message!==body.message))return Response.json({error:'conflict'},{status:409});
  const receipt=prior||{schema_version:1,lobby_id:body.target_id,request_id:body.request_id,replayed:false,message:{id:String(9007199254740994n+BigInt(messages.size)),username:'CTP staff',message:body.message,is_system:false,author_role:body.actor_id===`ctp:${referee}`?'referee':'admin',created_at:'2026-10-23T16:00:00Z'}};
  messages.set(body.request_id,{...receipt,actor_id:body.actor_id,target_id:body.target_id});
  if(mode==='outage-after-write'){mode='ok';throw new TypeError('fixture connection lost after commit');}
  return Response.json({ok:true,data:{...receipt,replayed:Boolean(prior),secret:token,message:{...receipt.message,private_token:token},...(mode==='wrong-receipt'?{request_id:lobbyId}:{})}});
 }
 const id=sessions.get(init.headers.Authorization?.replace('Bearer ','')),role=roles.get(id);
 if(!id||role==='player')return Response.json({},{status:403});
 return Response.json({ctp_user_id:id,username:'CTP fixture',role,actor_id:`ctp:${id}`,scopes:role==='staff'?['staff.access']:['ranked.read','ranked.chat'],...(role==='staff'?{staff_kind:'operations'}:{})});
};
const auth=await import('../server/auth.js');
const {db}=await import('../server/db.js');
const {requestBoundary}=await import('../server/config.js');
const {integrationRouter}=await import('../server/routes/integration.js');
const {signManagerRequest}=await import('../server/bridge-signature.js');
const {canManageRanked}=await import('../shared/access.js');
const app=express();
app.use((req,res,next)=>{const error=requestBoundary(req);if(error)return res.status(403).json({error});next();});
app.use(express.json({limit:'1mb'}));app.use('/api',integrationRouter);
app.use((req,res)=>res.status(404).json({error:'Ruta no encontrada.'}));
app.use((err,req,res,next)=>res.status(err.status||500).json({error:err.status?err.message:'Error interno.'}));
const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
after(async()=>{await new Promise(resolve=>server.close(resolve));globalThis.fetch=originalFetch;db.close();assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));assert.ok(path.basename(temp).startsWith('ctp-ranked-chat-'));fs.rmSync(temp,{recursive:true,force:true,maxRetries:5});});
async function signIn(email){let cookie;const user=await auth.loginCtp(email,'fixture-password',{cookie(name,value){cookie=`${name}=${value}`;}});return{user,cookie};}
function api(method,route,body,cookie='',headers={}){
 return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:`/api${route}`,method,headers:{Host:host,Origin:origin,'Sec-Fetch-Site':'same-origin',Cookie:cookie,'Content-Type':'application/json',...headers}},res=>{let text='';res.on('data',part=>text+=part);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(text)}));});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));});
}
const route=`/operations/ranked/lobbies/${lobbyId}/chat`;
const input=()=>({message:'Mensaje de prueba <b>como texto</b>',request_id:crypto.randomUUID()});

test('only current real CTP admin/referee gain Ranked supervision without admin promotion',async()=>{
 const ref=await signIn('ref@example.invalid'),adm=await signIn('admin@example.invalid'),org=await signIn('staff@example.invalid');
 assert.equal(ref.user.is_admin,false);assert.equal(canManageRanked(ref.user),true);assert.equal(canManageRanked(adm.user),true);assert.equal(canManageRanked(org.user),false);
 for(const user of[ref,adm]){assert.equal((await api('GET','/operations/ranked/monitor',undefined,user.cookie)).status,200);const detail=await api('GET',`/operations/ranked/lobbies/${lobbyId}`,undefined,user.cookie);assert.equal(detail.status,200);assert.equal(detail.data.chat.can_send,true);}
 assert.equal((await api('GET','/operations/ranked/monitor',undefined,org.cookie)).status,403);
 assert.equal((await api('POST',route,input(),org.cookie)).status,403);
 assert.equal((await api('POST','/operations/ranked/commands',{},ref.cookie)).status,403);
 for(const user of[null,{auth_mode:'ctp',ctp_role:'staff',staff_kind:'referee',ctp_user_id:staff,is_admin:true},{auth_mode:'ctp',ctp_role:'player',ctp_user_id:staff,is_admin:true},{auth_mode:'local',is_admin:false,sections:['arbitraje']}])assert.equal(canManageRanked(user),false);
});

test('HTTP chat derives the signed actor from session and confirms text/badge for every lobby status',async()=>{
 const ref=await signIn('ref@example.invalid');
 for(const state of['voting','drafting','ready','reported','disputed','closed','cancelled']){
  status=state;assert.equal((await api('GET',`/operations/ranked/lobbies/${lobbyId}`,undefined,ref.cookie)).data.lobby.status,state);
  const body=input(),reply=await api('POST',route,body,ref.cookie);assert.equal(reply.status,200);assert.equal(reply.data.message.author_role,'referee');assert.equal(reply.data.message.message,body.message);assert.equal(reply.data.replayed,false);assert.equal(JSON.stringify(reply.data).includes(token),false);
  assert.deepEqual(observed.at(-1),{action:'ranked_lobby_chat',actor_id:`ctp:${referee}`,target_id:lobbyId,...body});
 }
 status='ready';assert.equal((await auth.currentUser({headers:{cookie:ref.cookie}})).is_admin,false);
});

test('finite input, query, auth and CSRF checks stop invalid messages before the bridge',async()=>{
 const ref=await signIn('ref@example.invalid'),count=observed.length;
 assert.equal((await api('POST',route,input())).status,401);
 for(const body of[{...input(),actor_id:`ctp:${admin}`},{...input(),role:'admin'}, {...input(),message:'🔥'.repeat(801)},{...input(),message:' '},{...input(),request_id:'bad'},[]])assert.equal((await api('POST',route,body,ref.cookie)).status,400);
 assert.equal((await api('POST',route+'?actor_id=forged',input(),ref.cookie)).status,400);
 assert.equal((await api('POST','/operations/ranked/lobbies/bad/chat',input(),ref.cookie)).status,400);
 for(const headers of[{Origin:'https://evil.example'},{Origin:'https://pre.playctp.com'},{'Sec-Fetch-Site':'cross-site'},{'Sec-Fetch-Site':'same-site',Origin:''},{Host:'evil.example'}])assert.equal((await api('POST',route,input(),ref.cookie,headers)).status,403);
 assert.equal(observed.length,count);
});

test('uncertain sends preserve the request UUID for idempotent retry and reject unrelated acknowledgements',async()=>{
 const adm=await signIn('admin@example.invalid'),body=input(),count=messages.size;mode='outage-after-write';
 const uncertain=await api('POST',route,body,adm.cookie);assert.equal(uncertain.status,502);assert.equal(JSON.stringify(uncertain).includes(token),false);
 const retry=await api('POST',route,body,adm.cookie);assert.equal(retry.status,200);assert.equal(retry.data.replayed,true);assert.equal(messages.size,count+1);
 assert.equal((await api('POST',route,{...body,message:'different'},adm.cookie)).status,409);
 mode='wrong-receipt';try{assert.equal((await api('POST',route,input(),adm.cookie)).status,502);}finally{mode='ok';}
});

test('current permissions and central revocation are checked on each request',async()=>{
 const ref=await signIn('ref@example.invalid');canSend=false;
 try{assert.equal((await api('GET',`/operations/ranked/lobbies/${lobbyId}`,undefined,ref.cookie)).data.chat.can_send,false);mode='forbidden';assert.equal((await api('POST',route,input(),ref.cookie)).status,403);}finally{canSend=true;mode='ok';}
 const count=observed.length;roles.set(referee,'staff');
 try{assert.equal((await api('POST',route,input(),ref.cookie)).status,403);assert.equal(observed.length,count);}finally{roles.set(referee,'referee');}
 roles.set(referee,'player');try{assert.equal((await api('POST',route,input(),ref.cookie)).status,401);assert.equal(observed.length,count);}finally{roles.set(referee,'referee');}
});
