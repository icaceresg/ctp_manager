import test from 'node:test';
import assert from 'node:assert/strict';
import {createSiteNoticeClient,siteNoticePayload,siteNoticeResponse} from '../server/site-notice-client.js';
const ADMIN={id:1,is_admin:true,auth_mode:'ctp',ctp_role:'admin'};
const STATE={schema_version:1,revision:1,enabled:false,title:'',html:''};
const ID='00000000-0000-4000-8000-000000000001';
const SAVE={action:'save',expected_revision:1,request_id:ID,enabled:true,title:' News ',html:'<p>Text</p>'};
test('notice protocol rejects arbitrary fields, missing CAS/idempotency and unbounded input',()=>{
 assert.deepEqual(siteNoticePayload({action:'status'}),{action:'status'});
 assert.equal(siteNoticePayload(SAVE).title,'News');
 for(const input of [{...SAVE,request_id:undefined},{...SAVE,expected_revision:0},{...SAVE,document:[]},{...SAVE,html:'x'.repeat(65537)},{action:'preview',enabled:true,title:''}])assert.throws(()=>siteNoticePayload(input),{status:400});
});
test('notice service enforces authenticated admin, native CTP role and official write switch',async()=>{
 let calls=0;const service=createSiteNoticeClient({request:async()=>{calls++;return STATE;},actorFor:()=> 'ctp:fixture',writesEnabled:()=>false});
 for(const user of [null,{id:2,is_admin:false},{...ADMIN,ctp_role:'referee'}])await assert.rejects(()=>service(user,{action:'status'}));
 await assert.rejects(()=>service(ADMIN,SAVE),{status:403});assert.equal(calls,0);
 await service(ADMIN,{action:'preview',enabled:false,title:'',html:''});assert.equal(calls,1);
});
test('bridge request is finite and save receipt must match original request',async()=>{
 const calls=[];const service=createSiteNoticeClient({request:async body=>{calls.push(body);return{...STATE,request_id:ID};},actorFor:()=> 'ctp:fixture',writesEnabled:()=>true});
 const result=await service(ADMIN,SAVE);assert.equal(result.request_id,ID);
 assert.equal(calls[0].service,'site_notice');assert.equal(calls[0].actor_id,'ctp:fixture');
 assert.throws(()=>siteNoticeResponse({...STATE,request_id:'wrong'},SAVE),{status:502});
 assert.throws(()=>siteNoticeResponse({...STATE,secret:'no'},{action:'status'}),{status:502});
});
test('conflicts and uncertain errors never retry or expose upstream diagnostics',async()=>{
 for(const [remote,expected]of [[409,409],[403,403],[422,422],[503,502]]){
  let calls=0;const service=createSiteNoticeClient({request:async()=>{calls++;throw Object.assign(new Error('private diagnostic'),{status:remote});},actorFor:()=> 'ctp:fixture',writesEnabled:()=>true});
  await assert.rejects(()=>service(ADMIN,SAVE),error=>error.status===expected&&!error.message.includes('private diagnostic'));assert.equal(calls,1);
 }
});
