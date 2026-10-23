import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {lobbyFixture,lobbyId} from './fixtures/ranked-lobby.js';

// An in-process fake CTP: manual Ranked decisions never reach PRE/PROD here.
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-ranked-decision-'));
const origin='https://pre.manager.playctp.com',host='pre.manager.playctp.com';
const secret='ranked-decision-signature-fixture-0123456789abcdef';
const token='ranked-decision-transport-fixture-0123456789abcdef';
const admin='10000000-0000-4000-8000-000000000011',referee='10000000-0000-4000-8000-000000000012';
Object.assign(process.env,{DATA_DIR:temp,DB_PATH:path.join(temp,'decision.db'),PUBLIC_ORIGIN:origin,CTP_AUTH_MODE:'ctp',CTP_AUTH_URL:'https://pre.playctp.com',CTP_WEB_ORIGIN:'https://pre.playctp.com',CTP_AUTH_TOKEN_KEY:crypto.randomBytes(32).toString('base64url'),CTP_AUTH_ANON_KEY:`e30.${Buffer.from('{"role":"anon","exp":4102444800}').toString('base64url')}.fixture`,CTP_OPERATIONS_URL:'https://pre.playctp.com/functions/v1/manager-operations',CTP_OPERATIONS_TOKEN:token,CTP_SIGNING_SECRET:secret,CTP_ENABLE_WRITES:'true',CTP_SYNC_SECONDS:'0'});
const roles=new Map([[admin,'admin'],[referee,'referee']]),sessions=new Map(),commands=new Map(),observed=[];
let status='ready',version=3,mode='ok';
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,init)=>{
 const body=JSON.parse(init.body);
 if(url.includes('grant_type=password')){
  const id=body.email.startsWith('admin')?admin:referee,access=crypto.randomUUID();sessions.set(access,id);
  return Response.json({user:{id},access_token:access,refresh_token:`fixture:${id}`,expires_in:3600});
 }
 if(url.endsWith('/manager-operations')){
  observed.push(body);
  if(body.action==='ranked_lobby_detail'){const data=lobbyFixture();data.lobby.status=status;return Response.json({ok:true,data});}
  if(body.action==='admin_query'){
   assert.deepEqual(body,{action:'admin_query',actor_id:body.actor_id,resource:'ranked_lobbies',target_id:lobbyId,filters:{page:0,limit:1}});
   return Response.json({ok:true,data:{resource:'ranked_lobbies',items:[{id:lobbyId,status,manager_version:version}],total:1,has_more:false}});
  }
  assert.equal(body.action,'command');
  const hash=JSON.stringify([body.actor_id,body.type,body.target_id,body.expected_version,body.payload]),prior=commands.get(body.command_id);
  if(prior&&prior.hash!==hash)return Response.json({ok:false,code:'conflict'},{status:409});
  if(!prior&&body.expected_version!==version)return Response.json({ok:false,code:'invalid_command'},{status:422});
  const result={applied:true,command_id:body.command_id,type:body.type,target_id:body.target_id,source_version:version+1,data:{ok:true}};
  if(!prior){commands.set(body.command_id,{hash,result});version++;status=body.type==='admin.ranked.lobby.cancel'?'cancelled':'closed';}
  if(mode==='outage-after-write'){mode='ok';throw new TypeError('fixture connection lost after commit');}
  return Response.json({ok:true,data:result});
 }
 const id=sessions.get(init.headers.Authorization?.replace('Bearer ','')),role=roles.get(id);
 if(!id)return Response.json({},{status:403});
 return Response.json({ctp_user_id:id,username:'CTP fixture',role,actor_id:`ctp:${id}`,scopes:['ranked.read','ranked.chat']});
};
const auth=await import('../server/auth.js');
const {db}=await import('../server/db.js');
const {requestBoundary}=await import('../server/config.js');
const {integrationRouter}=await import('../server/routes/integration.js');
const {setIntegrationStatus}=await import('../server/operations.js');
setIntegrationStatus({supported_actions:['admin.ranked.lobby.resolve','admin.ranked.lobby.cancel']});
const app=express();
app.use((req,res,next)=>{const error=requestBoundary(req);if(error)return res.status(403).json({error});next();});
app.use(express.json({limit:'1mb'}));app.use('/api',integrationRouter);
app.use((err,req,res,next)=>res.status(err.status||500).json({error:err.status?err.message:'Error interno.'}));
const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
after(async()=>{await new Promise(resolve=>server.close(resolve));globalThis.fetch=originalFetch;db.close();fs.rmSync(temp,{recursive:true,force:true,maxRetries:5});});
async function signIn(email){let cookie;await auth.loginCtp(email,'fixture-password',{cookie(name,value){cookie=`${name}=${value}`;}});return cookie;}
function api(method,route,body,cookie=''){
 return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:`/api${route}`,method,headers:{Host:host,Origin:origin,'Sec-Fetch-Site':'same-origin',Cookie:cookie,'Content-Type':'application/json'}},res=>{let text='';res.on('data',part=>text+=part);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(text)}));});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));});
}
const route=`/operations/ranked/lobbies/${lobbyId}/decision`;
const winner=(side='a')=>({decision:'winner',side,reason:'Captura del marcador final enviada',request_id:crypto.randomUUID()});

test('only CTP administrators see and use the manual decision',async()=>{
 const adm=await signIn('admin@example.invalid'),ref=await signIn('ref@example.invalid');
 assert.equal((await api('GET',`/operations/ranked/lobbies/${lobbyId}`,undefined,adm)).data.can_decide,true);
 assert.equal((await api('GET',`/operations/ranked/lobbies/${lobbyId}`,undefined,ref)).data.can_decide,false);
 const count=observed.length;
 assert.equal((await api('POST',route,winner(),ref)).status,403);
 assert.equal(observed.length,count);
});

test('a winner is applied at once with the current lobby version and the signed admin actor',async()=>{
 status='disputed';const adm=await signIn('admin@example.invalid'),body=winner('b');
 const reply=await api('POST',route,body,adm);
 assert.equal(reply.status,200);assert.deepEqual(reply.data,{applied:true,lobby_id:lobbyId,request_id:body.request_id,decision:'winner',side:'b'});
 assert.deepEqual(observed.at(-1),{action:'command',actor_id:`ctp:${admin}`,command_id:body.request_id,type:'admin.ranked.lobby.resolve',target_id:lobbyId,expected_version:version-1,payload:{side:'b',reason:body.reason}});
 assert.equal((await api('POST',route,{...winner(),request_id:crypto.randomUUID()},adm)).status,409);
});

test('cancel works before teams exist and an unconfirmed retry does not apply twice',async()=>{
 status='voting';const adm=await signIn('admin@example.invalid');
 assert.equal((await api('POST',route,winner(),adm)).status,409);
 const body={decision:'cancel',reason:'Jugadores ausentes en el lobby',request_id:crypto.randomUUID()},before=commands.size;mode='outage-after-write';
 assert.equal((await api('POST',route,body,adm)).status,502);
 const retry=await api('POST',route,body,adm);
 assert.equal(retry.status,200);assert.equal(retry.data.decision,'cancel');assert.equal(commands.size,before+1);
 assert.deepEqual(observed.at(-1).payload,{reason:body.reason});
});

test('invalid decisions stop before CTP',async()=>{
 status='ready';const adm=await signIn('admin@example.invalid'),count=observed.length;
 for(const body of[{...winner(),side:'c'},{...winner(),reason:'corto'},{...winner(),decision:'draw'},{...winner(),request_id:'bad'},{decision:'cancel',side:'a',reason:'Motivo suficientemente largo',request_id:crypto.randomUUID()},{...winner(),actor_id:'forged'},[]])
  assert.equal((await api('POST',route,body,adm)).status,400);
 assert.equal((await api('POST','/operations/ranked/lobbies/bad/decision',winner(),adm)).status,400);
 assert.equal(observed.length,count);
});
