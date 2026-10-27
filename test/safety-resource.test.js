import test from 'node:test';
import assert from 'node:assert/strict';
import {createSafetyResource} from '../client/src/pages/safetyResource.js';
import {createAvatarRemovalIntent,createModerationIntent} from '../client/src/pages/safetyModel.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const profile=()=>({report:{id:'reported-fixture',version:1,status:'pending'},user:{manager_version:3,username:'Private synthetic profile'},job:null,eligibility:{matches_reported_avatar:true,avatar_present:true,can_remove:true}});
const accept=value=>value?.report||value?.ticket_id?value:null;

test('401/403/404, other read failures and null reports clear snapshots and disable writes',async()=>{
  for(const failure of [401,403,404,500,null]){
    let reply=profile();const resource=createSafetyResource({load:async()=>{if(reply instanceof Error)throw reply;return reply;},accept});
    await resource.read();assert.ok(resource.getSnapshot().data);
    reply=failure===null?{report:null}:Object.assign(Error('Synthetic access/read failure'),{status:failure});
    await resource.read();const state=resource.getSnapshot();assert.equal(state.data,null);assert.equal(state.needsRead,true);assert.equal(state.loading,false);
    let called=false;assert.equal(await resource.mutate(()=>{called=true;}),false);assert.equal(called,false);
  }
});

test('a mutation response arriving after a failed read or unmount cannot repopulate PII or invoke callbacks',async()=>{
  for(const invalidation of ['permission','unmount']){
    let fail=false;const response=deferred();let accepted=0;
    const resource=createSafetyResource({load:async()=>{if(fail)throw Object.assign(Error('Permission lost'),{status:403});return profile();},accept});
    await resource.read();const pending=resource.mutate(()=>response.promise,()=>accepted++);
    if(invalidation==='permission'){fail=true;await resource.read();}else resource.dispose();
    const before=resource.getSnapshot();response.resolve({...profile(),report:{...profile().report,status:'hidden'}});
    assert.equal(await pending,false);assert.equal(accepted,0);assert.equal(resource.getSnapshot(),before);
    if(invalidation==='permission')assert.equal(resource.getSnapshot().data,null);
  }
});

test('an older successful read cannot overwrite a newer missing report or another resource',async()=>{
  const old=deferred();let loads=0;
  const resource=createSafetyResource({load:()=>++loads===1?old.promise:Promise.resolve({report:null}),accept});
  const first=resource.read();await resource.read();old.resolve(profile());await first;assert.equal(resource.getSnapshot().data,null);
});

test('uncertain avatar retry reads state first and keeps one nonce/CAS/reason; a changed avatar offers no removal',async()=>{
  let current=profile(),sends=0;const bodies=[],intent=createAvatarRemovalIntent(()=> 'one-synthetic-nonce');
  const resource=createSafetyResource({load:async()=>current,accept});
  const send=value=>{const body=intent.begin(value,'A meaningful synthetic removal reason');bodies.push(body);sends++;throw Error('Unknown transport result');};
  await resource.read();await resource.mutate(send);assert.equal(resource.getSnapshot().data,null);assert.equal(resource.getSnapshot().needsRead,true);
  await resource.mutate(send);assert.equal(sends,1,'no blind write retry');
  await resource.read();assert.equal(intent.reconcile(resource.getSnapshot().data),bodies[0]);
  await resource.mutate(send);assert.equal(sends,2);assert.equal(bodies[0],bodies[1]);assert.equal(bodies[1].request_id,'one-synthetic-nonce');
  current={...profile(),user:{...profile().user,manager_version:4},eligibility:{matches_reported_avatar:false,avatar_present:true,can_remove:false}};
  await resource.read();assert.equal(intent.reconcile(resource.getSnapshot().data),null);
  assert.throws(()=>intent.begin(current,'A fresh reason cannot authorize another avatar'));assert.equal(sends,2);
});

test('uncertain report decisions retain the nonce after a current read; terminal/newer reports retire it',()=>{
  const report={id:'fixture',status:'pending',version:2},intent=createModerationIntent(()=> 'fixed-synthetic-nonce');
  const body=intent.begin(report,'hide','A meaningful synthetic review reason');assert.equal(intent.reconcile({...report}),body);
  assert.equal(intent.begin({...report},'hide',body.reason),body);
  assert.equal(intent.reconcile({...report,version:3}),null);
});
