import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {signManagerRequest} from '../server/bridge-signature.js';

// Real local HTTP/auth/router/transport; CTP/Auth/Storage replies are fixtures.
// No request is sent to a hosted service and no real player is changed.
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-moderation-http-'));
const admin=crypto.randomUUID(),player=crypto.randomUUID(),reportId=crypto.randomUUID(),ticket=crypto.randomUUID(),jobId=crypto.randomUUID();
const origin='https://pre.manager.playctp.com',secret='moderation-http-independent-signature-0123456789';
Object.assign(process.env,{DATA_DIR:temp,DB_PATH:path.join(temp,'fixture.sqlite'),PUBLIC_ORIGIN:origin,CTP_AUTH_MODE:'ctp',CTP_AUTH_URL:'https://pre.playctp.com',CTP_WEB_ORIGIN:'https://pre.playctp.com',
  CTP_AUTH_TOKEN_KEY:crypto.randomBytes(32).toString('base64url'),CTP_AUTH_ANON_KEY:`e30.${Buffer.from('{"role":"anon","exp":4102444800}').toString('base64url')}.fixture`,
  CTP_OPERATIONS_URL:'https://pre.playctp.com/functions/v1/manager-operations',CTP_OPERATIONS_TOKEN:'moderation-http-fixture-transport-0123456789',CTP_SIGNING_SECRET:secret,CTP_ENABLE_WRITES:'true',CTP_SYNC_SECONDS:'0'});
const rawLegacyAvatar='data:image/png;base64,'+'A'.repeat(100000),observed=[],sessions=new Set();
let profile={id:player,username:'PlayerFixture',email:'fixture@example.invalid',email_confirmed:true,gamertag:'PlayerFixture',activision_id:null,platform:'PC',discord:null,twitter:null,bio:'B'.repeat(1500),birthdate:null,role:'player',avatar:rawLegacyAvatar,created_at:'2026-10-27T08:00:00Z',manager_version:3};
let report={id:reportId,ticket_id:ticket,ticket_code:'CTP-123',context:'user',reason:'abuse',details:null,status:'pending',version:1,created_at:'2026-10-27T08:00:00Z',target_id:player,target_username:'PlayerFixture',message_id:null,lobby_id:null,evidence:{avatar:rawLegacyAvatar,username:'PlayerFixture'},hidden:false,reviewed_at:null,review_note:null};
let job=null;
const avatarDto=()=>({schema_version:1,report,user:{id:profile.id,username:profile.username,avatar:profile.avatar,bio:profile.bio,manager_version:profile.manager_version},job,preview:{reported_avatar_url:null,current_avatar_url:null}});
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,init)=>{
  const body=JSON.parse(init.body);
  if(String(url).includes('grant_type=password')){const access=crypto.randomUUID();sessions.add(access);return Response.json({user:{id:admin},access_token:access,refresh_token:'fixture-refresh',expires_in:3600});}
  if(String(url).endsWith('/manager-operations')){
    observed.push(body);assert.equal(body.actor_id,`ctp:${admin}`);assert.equal(body.action,'admin_service');
    const signature=signManagerRequest(init.body,secret,{timestamp:Number(init.headers['X-CTP-Timestamp']),nonce:init.headers['X-CTP-Nonce']});
    assert.equal(init.headers['X-CTP-Signature'],signature['X-CTP-Signature']);
    const p=body.payload;
    if(body.service==='ugc')return Response.json({ok:true,data:p.action==='list'?{schema_version:1,total:1,items:[report]}:{schema_version:1,report}});
    if(body.service==='users'){
      assert.equal(p.user_id,player);
      if(p.action==='update'){assert.equal(p.expected_version,profile.manager_version);assert.deepEqual(p.changes,{bio:'Corrected biography'});profile={...profile,...p.changes,manager_version:profile.manager_version+1};}
      return Response.json({ok:true,data:profile});
    }
    assert.equal(body.service,'ugc_avatar');
    if(p.action==='remove'){
      assert.equal(p.expected_report_version,report.version);assert.equal(p.expected_user_version,profile.manager_version);assert.equal(Object.hasOwn(p,'avatar_url'),false);
      profile={...profile,avatar:'🎮',manager_version:profile.manager_version+1};
      report={...report,status:'hidden',version:report.version+1,review_note:p.reason,reviewed_at:'2026-10-27T08:01:00Z'};
      job={job_id:jobId,report_id:reportId,user_id:player,state:'completed',phase:'complete',kind:'display_only',version:3,display_detached:true,storage_verified:false,object_removed:false,error_code:null,created_at:'2026-10-27T08:01:00Z',completed_at:'2026-10-27T08:01:00Z'};
    }
    return Response.json({ok:true,data:avatarDto()});
  }
  const access=init.headers.Authorization?.replace('Bearer ','');assert.ok(sessions.has(access),'only the fixture Auth scope request may remain');
  return Response.json({ctp_user_id:admin,username:'AdminFixture',role:'admin',actor_id:`ctp:${admin}`,scopes:['ranked.read']});
};
const auth=await import('../server/auth.js');
const {db}=await import('../server/db.js');
const {requestBoundary}=await import('../server/config.js');
const {administrationRouter}=await import('../server/routes/administration.js');
const app=express();app.use((req,res,next)=>{const error=requestBoundary(req);return error?res.status(403).json({error}):next();});app.use(express.json());app.use('/api',administrationRouter);
app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.status?error.message:'Internal error.'}));
const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
after(async()=>{await new Promise(resolve=>server.close(resolve));globalThis.fetch=originalFetch;db.close();assert.equal(path.dirname(temp),os.tmpdir());assert.ok(path.basename(temp).startsWith('ctp-moderation-http-'));fs.rmSync(temp,{recursive:true,force:true});});
const api=(method,route,body,cookie)=>new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:`/api${route}`,method,headers:{Host:'pre.manager.playctp.com',Origin:origin,'Sec-Fetch-Site':'same-origin',Cookie:cookie||'','Content-Type':'application/json'}},res=>{let text='';res.on('data',part=>text+=part);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(text),bytes:Buffer.byteLength(text)}));});
  req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
});
test('valid null-notes and legacy-avatar HTTP pages remain 200, bounded, editable and removable through the signed actor',async()=>{
  let cookie;await auth.loginCtp('admin@example.invalid','fixture-password',{cookie(name,value){cookie=`${name}=${value}`;}});
  const paths=['/administration/ugc','/administration/ugc/'+reportId,'/administration/ugc/'+reportId+'/avatar','/administration/users/'+player];
  for(const route of paths){const reply=await api('GET',route,undefined,cookie);assert.equal(reply.status,200,route);assert.ok(reply.bytes<7000,route);assert.equal(JSON.stringify(reply.data).includes(rawLegacyAvatar),false);}
  const page=await api('GET','/administration/ugc',undefined,cookie);assert.equal(page.data.items[0].details,'');assert.equal(page.data.items[0].meta.avatar_preview_omitted,true);
  const avatar=await api('GET',`/administration/ugc/${reportId}/avatar`,undefined,cookie);assert.equal(avatar.data.user.bio.length,1500);assert.equal(avatar.data.user.meta.avatar_preview_omitted,true);
  const edited=await api('PATCH',`/administration/users/${player}`,{expected_version:3,changes:{bio:'Corrected biography'}},cookie);assert.equal(edited.status,200);assert.equal(edited.data.bio,'Corrected biography');assert.equal(edited.data.avatar,null);
  const count=observed.length;
  const bad=await api('POST',`/administration/ugc/${reportId}/avatar/remove`,{expected_report_version:1,expected_user_version:4,reason:'Synthetic reason for avatar removal',request_id:crypto.randomUUID(),avatar_url:rawLegacyAvatar},cookie);
  assert.equal(bad.status,400);assert.equal(observed.length,count);
  const removed=await api('POST',`/administration/ugc/${reportId}/avatar/remove`,{expected_report_version:1,expected_user_version:4,reason:'Synthetic reason for avatar removal',request_id:crypto.randomUUID()},cookie);
  assert.equal(removed.status,200);assert.equal(removed.data.job.state,'completed');assert.equal(removed.data.job.kind,'display_only');assert.equal(removed.data.job.object_removed,false);assert.equal(removed.data.report.evidence.avatar,null);
  assert.equal(rawLegacyAvatar.length>100000,true); // Original fixture binding is not rewritten/truncated for CAS.
});
