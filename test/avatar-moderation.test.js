import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {createAvatarRemovalIntent} from '../client/src/pages/safetyModel.js';

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-avatar-moderation-'));
Object.assign(process.env,{DATA_DIR:temp,DB_PATH:path.join(temp,'fixture.sqlite'),CTP_AUTH_MODE:'local',PUBLIC_ORIGIN:'',CTP_OPERATIONS_URL:'',CTP_OPERATIONS_TOKEN:''});
const {avatarModerationPayload,avatarModerationResponse}=await import('../server/mobile-safety-contract.js');
const {createMobileSafetyClient}=await import('../server/mobile-safety-services.js');
const {db:moduleDb}=await import('../server/db.js');
let vite,AvatarModerationView;
before(async()=>{vite=await createServer({server:{middlewareMode:true,watch:null,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});({AvatarModerationView}=await vite.ssrLoadModule('/src/pages/AvatarModerationPanel.jsx'));});
after(async()=>{await vite?.close();moduleDb.close();assert.equal(path.dirname(temp),os.tmpdir());assert.ok(path.basename(temp).startsWith('ctp-avatar-moderation-'));fs.rmSync(temp,{recursive:true,force:true});});
const user=randomUUID(),report=randomUUID(),jobId=randomUUID(),nonce=randomUUID();
const admin={id:1,is_admin:true,auth_mode:'ctp',ctp_role:'admin'};
const body=()=>({expected_report_version:1,expected_user_version:3,reason:'Synthetic reason for removing this avatar',request_id:nonce});
const dto=()=>({schema_version:1,report:{id:report,ticket_id:randomUUID(),ticket_code:'CTP-123',context:'user',reason:'abuse',details:'Synthetic avatar report',status:'pending',version:1,created_at:'2026-10-27T08:00:00Z',target_id:user,target_username:'PlayerFixture',message_id:null,lobby_id:null,evidence:{avatar:'https://external.invalid/tracking.png',username:'Old nickname'},hidden:false,reviewed_at:null,review_note:null},
  user:{id:user,username:'PlayerFixture',avatar:'https://external.invalid/current.png',bio:'<script>private fixture</script>',manager_version:3},job:null,preview:{reported_avatar_url:null,current_avatar_url:`https://playctp.com/storage/v1/object/public/avatars/${user}/avatar.png`}});
const job=()=>({job_id:jobId,report_id:report,user_id:user,state:'retryable',phase:'storage',kind:'owned',version:2,display_detached:true,storage_verified:false,object_removed:false,error_code:'storage_unavailable',created_at:'2026-10-27T08:00:00Z',completed_at:null});

test('avatar intent binds report/user versions, reason and nonce and rejects arbitrary authority or object paths',()=>{
  assert.deepEqual(avatarModerationPayload('remove',report,body()),{action:'remove',report_id:report,...body()});
  for(const key of ['actor_id','user_id','avatar_url','path','bucket','status','storage_verified','force'])assert.throws(()=>avatarModerationPayload('remove',report,{...body(),[key]:'injected'}),{status:400});
  for(const bad of [{...body(),expected_report_version:0},{...body(),expected_user_version:0},{...body(),request_id:'bad'},{...body(),reason:'short'},{...body(),reason:'x'.repeat(501)}])assert.throws(()=>avatarModerationPayload('remove',report,bad),{status:400});
  assert.throws(()=>avatarModerationPayload('retry',jobId,{expected_version:2,status:'completed'}),{status:400});
});
test('avatar DTO limits preview to the trusted origin and exact owner namespace without remote fetches',()=>{
  const current=dto();assert.equal(avatarModerationResponse(current,{action:'get',report_id:report}).preview.reported_avatar_url,null);
  for(const url of ['https://external.invalid/photo.png',`https://playctp.com/storage/v1/object/public/avatars/${randomUUID()}/avatar.png`,`https://user:pass@playctp.com/storage/v1/object/public/avatars/${user}/avatar.png`,`https://playctp.com/storage/v1/object/public/avatars/${user}/avatar.png?token=secret`,`https://playctp.com/storage/v1/object/public/avatars/${user}/%2f..%2fprivate`,`https://playctp.com/storage/v1/object/public/avatars/${user}/avatar.svg`])assert.throws(()=>avatarModerationResponse({...current,preview:{...current.preview,current_avatar_url:url}},{action:'get',report_id:report}),{status:502});
  assert.throws(()=>avatarModerationResponse({...current,user:{...current.user,id:randomUUID()}},{action:'get',report_id:report}),{status:502});
  assert.throws(()=>avatarModerationResponse({...current,report:{...current.report,context:'message'}},{action:'get',report_id:report}),{status:502});
  const safe=avatarModerationResponse({...current,user:{...current.user,access_token:'NEVER RELAY'}},{action:'get',report_id:report});assert.equal(safe.user.access_token,undefined);
});
test('detaching a profile is not Storage acknowledgement and no owned completion is accepted without it',()=>{
  const current={...dto(),job:job()};
  assert.equal(avatarModerationResponse(current,{action:'remove',report_id:report}).job.state,'retryable');
  assert.throws(()=>avatarModerationResponse({...current,job:{...current.job,state:'completed',phase:'complete',completed_at:'2026-10-27T08:01:00Z'}},{action:'remove',report_id:report}),{status:502});
  const complete={...current,job:{...current.job,state:'completed',phase:'complete',storage_verified:true,object_removed:true,completed_at:'2026-10-27T08:01:00Z',error_code:null}};
  assert.equal(avatarModerationResponse(complete,{action:'retry',job_id:jobId}).job.state,'completed');
  assert.throws(()=>avatarModerationResponse(complete,{action:'retry',job_id:randomUUID()}),{status:502});
});
test('null report notes, hostile avatar data and legacy biography stay bounded and moderable',()=>{
  const current=dto(),huge='data:image/png;base64,'+'A'.repeat(100000);
  current.report.details=null;current.report.evidence.avatar=huge;current.user.avatar=huge;current.user.bio='Legacy biography '.repeat(80);
  const safe=avatarModerationResponse(current,{action:'get',report_id:report});
  assert.equal(safe.report.details,'');assert.equal(safe.report.evidence.avatar,null);assert.equal(safe.user.avatar,null);
  assert.equal(safe.user.bio,current.user.bio);assert.equal(safe.user.manager_version,3);assert.equal(safe.report.version,1);
  assert.equal(safe.report.meta.avatar_preview_omitted,true);assert.equal(safe.user.meta.content_omitted,true);
  assert.deepEqual(safe.preview,{reported_avatar_url:null,current_avatar_url:null});assert.ok(JSON.stringify(safe).length<5000);
  const intent=createAvatarRemovalIntent(()=>nonce);assert.equal(intent.begin(safe,body().reason).expected_user_version,3);
  current.user.bio='B'.repeat(10000);assert.equal(avatarModerationResponse(current,{action:'get',report_id:report}).user.bio,null);
});
test('lost remove response retains one nonce and both original CAS versions until an acknowledged job',()=>{
  const current=dto(),intent=createAvatarRemovalIntent(()=>nonce),first=intent.begin(current,body().reason);
  assert.equal(intent.begin(current,body().reason),first);
  assert.throws(()=>intent.begin({...current,user:{...current.user,manager_version:4}},body().reason));
  assert.throws(()=>intent.begin(current,'A changed synthetic reason'));
  assert.throws(()=>intent.confirm(report,first,current));
  intent.confirm(report,first,{...current,job:job()});assert.equal(intent.pending,null);
});
test('private avatar service stamps actor and service after local admin/write and closed-body checks',async t=>{
  const database=new DatabaseSync(':memory:');t.after(()=>database.close());const observed=[];let writes=true;
  const client=createMobileSafetyClient({database,writesEnabled:()=>writes,actorFor:actor=>`ctp:${actor.id}`,request:async envelope=>{observed.push(envelope);return{...dto(),job:envelope.payload.action==='get'?null:job()};}});
  const count=()=>observed.length;
  await assert.rejects(client.avatarRemove({...admin,ctp_role:'staff'},report,body()),{status:403});
  writes=false;await assert.rejects(client.avatarRemove(admin,report,body()),{status:403});assert.equal(count(),0);
  await client.avatarGet(admin,report);assert.deepEqual(observed.at(-1),{action:'admin_service',actor_id:'ctp:1',service:'ugc_avatar',payload:{action:'get',report_id:report}});
  writes=true;await assert.rejects(client.avatarRemove(admin,report,{...body(),actor_id:'forged'}),{status:400});assert.equal(count(),1);
  await client.avatarRemove(admin,report,body());assert.equal(observed.at(-1).payload.request_id,nonce);assert.equal(observed.at(-1).payload.expected_user_version,3);
  await client.avatarRetry(admin,jobId,{expected_version:2});assert.deepEqual(observed.at(-1).payload,{action:'retry',job_id:jobId,expected_version:2});
});
test('avatar view escapes current profile, embeds only typed preview, and distinguishes pending or display-only outcomes',()=>{
  const render=value=>renderToStaticMarkup(createElement(AvatarModerationView,{value,reason:'Synthetic removal reason',busy:false,locked:false,onReason(){},onRemove(){},onRetry(){},onEdit(){}}));
  const current=dto(),pending=render({...current,job:job()});
  assert.equal(pending.includes('<script>'),false);assert.ok(pending.includes('&lt;script&gt;'));assert.equal(pending.includes('src="https://external.invalid'),false);assert.ok(pending.includes('referrerPolicy="no-referrer"'));assert.ok(pending.includes('comprobación del archivo sigue pendiente'));assert.equal(pending.includes('archivo propio eliminado'),false);assert.ok(pending.includes('Reintentar comprobación'));
  const displayOnly=render({...current,job:{...job(),kind:'display_only',state:'completed',phase:'complete',completed_at:'2026-10-27T08:01:00Z',error_code:null}});
  assert.ok(displayOnly.includes('No se ha eliminado ningún archivo externo'));assert.equal(displayOnly.includes('Reintentar comprobación'),false);
  assert.ok(render(current).includes('Corregir nombre o biografía'));assert.ok(render(current).includes('maxLength="500"'));
});
