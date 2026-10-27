import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import {signManagerRequest} from '../server/bridge-signature.js';

// Real Manager HTTP, authenticated routes, signed transport and SQLite. Only
// the remote Auth/CTP responses are synthetic; nothing contacts PRE or PROD.
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-profile-erasure-http-'));
const origin='https://pre.manager.playctp.com',adminId=randomUUID();
const signingSecret='synthetic-profile-erasure-signature-only-0123456789';
Object.assign(process.env,{DATA_DIR:temporary,DB_PATH:path.join(temporary,'synthetic.sqlite'),PUBLIC_ORIGIN:origin,
  CTP_AUTH_MODE:'ctp',CTP_AUTH_URL:'https://pre.playctp.com',CTP_WEB_ORIGIN:'https://pre.playctp.com',
  CTP_AUTH_TOKEN_KEY:randomBytes(32).toString('base64url'),
  CTP_AUTH_ANON_KEY:`e30.${Buffer.from('{"role":"anon","exp":4102444800}').toString('base64url')}.fixture`,
  CTP_OPERATIONS_URL:'https://pre.playctp.com/functions/v1/manager-operations',
  CTP_OPERATIONS_TOKEN:'synthetic-profile-erasure-transport-only-0123456789',
  CTP_SIGNING_SECRET:signingSecret,CTP_ENABLE_WRITES:'true',CTP_SYNC_SECONDS:'0'});
const date='2026-10-27T08:00:00Z',profiles=new Map(),sessions=new Set(),observed=[];
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const fixture=()=>({id:randomUUID(),username:'Synthetic private profile',email:'synthetic-private@example.invalid',email_confirmed:true,
  gamertag:'Synthetic private gamertag',activision_id:'Synthetic#123',platform:'PC',discord:null,twitter:null,
  bio:'Synthetic private biography',birthdate:null,role:'player',avatar:null,created_at:date,manager_version:3});
const page=(available,items=[])=>({available,offset:0,limit:20,total:available?items.length:null,has_more:false,items});
const detail=profile=>({schema_version:1,operation:'detail',observed_at:date,viewer:{can_edit:true,can_view_tickets:false,can_view_sanctions:false},
  user:{...profile,closed:false,login_banned_until:null},clubs:[],rating:null,
  participation:{state:'idle',queue:null,joined_at:null,presence_expires_at:null,party_id:null,lobby:null},
  results:page(true,[{id:randomUUID(),status:'closed',map_name:'Synthetic map',winner:'a',my_side:'a',created_at:date,closed_at:date,
    game_id:'synthetic-game',queue_title:'Synthetic ranked',mode:'hardpoint',xp_delta:25,new_xp:75,season_id:randomUUID()}]),
  tickets:page(false),sanctions:page(false)});
let held=null,searchRows=[];
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,init)=>{
  const body=JSON.parse(init.body);
  if(url.includes('grant_type=password')){
    const token=randomUUID();sessions.add(token);
    return Response.json({user:{id:adminId},access_token:token,refresh_token:'synthetic-refresh',expires_in:3600});
  }
  if(url.endsWith('/manager-operations')){
    observed.push(body);
    assert.equal(init.headers['X-CTP-Signature'],signManagerRequest(init.body,signingSecret,
      {timestamp:Number(init.headers['X-CTP-Timestamp']),nonce:init.headers['X-CTP-Nonce']})['X-CTP-Signature']);
    let value;
    if(body.action==='admin_service'){
      assert.equal(body.service,'users');assert.equal(body.actor_id,`ctp:${adminId}`);
      const profile=profiles.get(body.payload.user_id);assert.ok(profile);
      value=body.payload.action==='update'?{...profile,...body.payload.changes,manager_version:profile.manager_version+1,changed:Object.keys(body.payload.changes)}:{...profile};
    }else{
      assert.equal(body.action,'player_workspace');assert.equal(body.actor_id,`ctp:${adminId}`);
      value=body.query.operation==='detail'?detail(profiles.get(body.query.user_id)):
        {schema_version:1,operation:'search',observed_at:date,viewer:{can_edit:true,can_view_tickets:false,can_view_sanctions:false},
          query:body.query.query,offset:body.query.offset,limit:body.query.limit,total:searchRows.length,items:searchRows.map(row=>({...row}))};
    }
    if(held){held.snapshot=value;held.arrived.resolve();await held.release.promise;}
    return Response.json({ok:true,data:value});
  }
  const token=init.headers.Authorization?.replace('Bearer ','');assert.ok(sessions.has(token));
  return Response.json({ctp_user_id:adminId,username:'Synthetic administrator',role:'admin',actor_id:`ctp:${adminId}`,scopes:['ranked.read','admin.console']});
};
const auth=await import('../server/auth.js');
const {db}=await import('../server/db.js');
const {createErasureInspector}=await import('../server/erasure-local.js');
const {requestBoundary}=await import('../server/config.js');
const {administrationRouter}=await import('../server/routes/administration.js');
const {integrationRouter}=await import('../server/routes/integration.js');
const inspect=createErasureInspector(db),app=express();
app.use((req,res,next)=>{const error=requestBoundary(req);return error?res.status(403).json({error}):next();});
app.use(express.json());app.use('/api',administrationRouter);app.use('/api',integrationRouter);
app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.status?error.message:'Error interno.'}));
const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let cookie;await auth.loginCtp('synthetic-admin@example.invalid','synthetic-password',{cookie(name,value){cookie=`${name}=${value}`;}});
after(async()=>{await new Promise(resolve=>server.close(resolve));globalThis.fetch=originalFetch;db.close();
  assert.equal(path.dirname(temporary),os.tmpdir());assert.ok(path.basename(temporary).startsWith('ctp-profile-erasure-http-'));
  fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5});});
function api(method,route,body){
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/api'+route,method,
      headers:{Host:'pre.manager.playctp.com',Origin:origin,'Sec-Fetch-Site':'same-origin',Cookie:cookie,'Content-Type':'application/json'}},res=>{
      let text='';res.on('data',part=>text+=part);res.on('end',()=>resolve({status:res.statusCode,text,data:JSON.parse(text)}));
    });
    req.setTimeout(10000,()=>req.destroy(Error('synthetic HTTP deadline')));req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
}
async function arrived(promise){let timer;try{await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('synthetic bridge deadline')),5000);})]);}finally{clearTimeout(timer);}}

for(const operation of ['profile_read','profile_update','workspace_detail','workspace_search']){
  test(`a held ${operation} response cannot relay profile PII after a real local erasure marker`,async()=>{
    const profile=fixture();profiles.set(profile.id,profile);searchRows=[profile,fixture()];
    held={arrived:deferred(),release:deferred(),snapshot:null};const current=held;
    const route=operation.startsWith('profile')?`/administration/users/${profile.id}`:operation==='workspace_detail'?`/players/${profile.id}`:'/players';
    const pending=api(operation==='profile_update'?'PATCH':'GET',route,operation==='profile_update'?{expected_version:3,changes:{bio:'Synthetic updated private biography'}}:undefined);
    try{
      await arrived(current.arrived.promise);
      assert.ok(JSON.stringify(current.snapshot).includes(profile.username),'PII was present in the held upstream DTO');
      const checked=inspect({job_id:randomUUID(),ticket_id:randomUUID(),user_id:profile.id,version:3,phase:'external',
        progress:{database_sanitized:true,auth_closed:true,storage_verified:true}});
      assert.equal(checked.status,'clear');assert.ok(db.prepare('SELECT 1 FROM account_erasure_subjects WHERE subject_id=?').get(profile.id));
      current.release.resolve();const result=await pending;
      assert.equal(result.status,404);assert.deepEqual(Object.keys(result.data),['error']);
      for(const privateValue of [profile.id,profile.username,profile.email,profile.gamertag,profile.bio,'Synthetic updated private biography'])assert.equal(result.text.includes(privateValue),false);
      const count=observed.length;
      if(operation!=='workspace_search')assert.equal((await api('GET',route)).status,404);
      if(operation==='profile_update')assert.equal((await api('PATCH',route,{expected_version:3,changes:{bio:'Another synthetic private biography'}})).status,404);
      assert.equal(observed.length,count,'known closed targeted profiles are refused before another bridge call');
    }finally{current.release.resolve();await pending;held=null;}
  });
}

test('unmarked profiles and complete ranked history still cross the authenticated HTTP adapter unchanged',async()=>{
  const profile=fixture();profiles.set(profile.id,profile);searchRows=[profile,fixture()];
  const profileReply=await api('GET',`/administration/users/${profile.id}`);assert.equal(profileReply.status,200);assert.equal(profileReply.data.email,profile.email);
  const workspace=await api('GET',`/players/${profile.id}`);assert.equal(workspace.status,200);assert.equal(workspace.data.user.id,profile.id);
  assert.equal(workspace.data.results.total,1);assert.equal(workspace.data.results.items[0].xp_delta,25);assert.equal(workspace.data.results.items[0].new_xp,75);
  assert.equal(workspace.data.results.items[0].winner,'a');assert.equal(workspace.data.participation.state,'idle');
  const search=await api('GET','/players');assert.equal(search.status,200);assert.equal(search.data.total,2);assert.equal(search.data.items.length,2);
  assert.equal(search.data.items[0].id,profile.id);assert.equal(db.prepare("SELECT count(*) n FROM operation_records WHERE kind='stat' OR kind='match'").get().n,0,'profile queries do not rewrite or cache competitive history');
});
