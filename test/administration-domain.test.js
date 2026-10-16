import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-administration-domain-'));
Object.assign(process.env,{DATA_DIR:temporary,DB_PATH:path.join(temporary,'qa.sqlite'),CTP_AUTH_MODE:'local'});
const operations=await import('../server/operations.js');
const {db}=await import('../server/db.js');
const {describeUser}=await import('../server/auth.js');
const {ADMIN_ACTIONS}=await import('../server/administration-contract.js');
const makeUser=(username,isAdmin)=>{const id=Number(db.prepare('INSERT INTO users(username,name,password_hash,is_admin,created_at) VALUES(?,?,?,?,?)').run(username,username,'unused',Number(isAdmin),Date.now()).lastInsertRowid);return describeUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));};
const admin=makeUser('administration-admin',true),player=makeUser('administration-player',false);
const userId=randomUUID();
const page=(version=3)=>({resource:'users',items:[{id:userId,username:'Player QA',role:'player',manager_version:version}],page:0,limit:20,total:1,has_more:false});
after(()=>{db.close();assert.equal(path.dirname(path.resolve(temporary)),path.resolve(os.tmpdir()));assert.ok(path.basename(temporary).startsWith('ctp-administration-domain-'));fs.rmSync(temporary,{recursive:true,force:true});});

test('administration mutations require administrator, backend capabilities and fresh official versions',()=>{
  operations.rememberAdministrationData(page());
  const input={type:'admin.user.role',target_id:userId,expected_version:3,payload:{role:'referee'}};
  assert.throws(()=>operations.prepareAdministrationCommand(player,input),error=>error.status===403);
  assert.throws(()=>operations.prepareAdministrationCommand(admin,input),error=>error.status===422);
  operations.setIntegrationStatus({supported_actions:ADMIN_ACTIONS});
  assert.throws(()=>operations.prepareAdministrationCommand(admin,{...input,expected_version:2}),error=>error.status===409);
  const proposal=operations.prepareAdministrationCommand(admin,input);
  assert.equal(proposal.command.status,'pending');assert.equal(proposal.command.expected_version,3);assert.equal(proposal.resource.role,'player');
  assert.equal(operations.prepareAdministrationCommand(admin,input).command.id,proposal.command.id);
  assert.throws(()=>operations.prepareAdministrationCommand(admin,{...input,payload:{role:'player'}}),error=>error.status===409);
  const command=operations.getCommand(proposal.command.id);
  operations.cancelCommand(admin,command.id,{expected_updated_at:command.updated_at});
});

test('administrative queries preserve a pending decision and ignore older snapshots',()=>{
  const input={type:'admin.user.role',target_id:userId,expected_version:3,payload:{role:'referee'}};
  const proposal=operations.prepareAdministrationCommand(admin,input);
  operations.rememberAdministrationData(page(4));
  assert.equal(operations.getCommand(proposal.command.id).source_version_current,4);
  operations.rememberAdministrationData(page(2));
  assert.equal(operations.getCommand(proposal.command.id).source_version_current,4);
  const record=db.prepare("SELECT data FROM operation_records WHERE kind='administration' AND id=?").get(userId);
  assert.equal(JSON.parse(record.data).pending_command_id,proposal.command.id);
  const command=operations.getCommand(proposal.command.id);operations.cancelCommand(admin,command.id,{expected_updated_at:command.updated_at});
});

test('new records remain local proposals with stable UUIDs until a confirmed ACK',()=>{
  const id=randomUUID();
  const input={type:'admin.mode.create',target_id:id,expected_version:0,payload:{game_id:'cod',name:'Modo QA'}};
  const prepared=operations.prepareAdministrationCommand(admin,input);
  assert.equal(prepared.command.target_id,id);assert.equal(prepared.command.status,'pending');assert.equal(prepared.resource.source,'manager');
  assert.equal(operations.prepareAdministrationCommand(admin,input).command.id,prepared.command.id);
  assert.throws(()=>operations.prepareAdministrationCommand(admin,{...input,target_id:'bad'}),error=>error.status===400);
  assert.throws(()=>operations.prepareAdministrationCommand(admin,{...input,expected_version:1}),error=>error.status===400);
  operations.markCommandSending(prepared.command.id);
  const acknowledged=operations.acknowledgeCommand(prepared.command.id,{confirmed:true,external_id:id,source_version:1});
  assert.equal(acknowledged.status,'acknowledged');
  assert.equal(operations.acknowledgeCommand(prepared.command.id,{confirmed:true,external_id:id,source_version:1}).status,'acknowledged');
});
