import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-administration-contract-'));
Object.assign(process.env,{DATA_DIR:temporary,DB_PATH:path.join(temporary,'qa.sqlite'),CTP_AUTH_MODE:'local'});
const {ADMIN_ACTIONS,ADMIN_CREATE_ACTIONS,administrationQuery,administrationPayload}=await import('../server/administration-contract.js');
const {db}=await import('../server/db.js');
const {actionLabel}=await import('../client/src/operations/actionLabels.js');
const id='16100000-0000-4000-8000-000000000001';
const reason='Revisado por coordinación de competición';
const content=Object.fromEntries(['es','en','it','fr','pt','de'].map(locale=>[locale,{title:'Circuito CTP',body:'Información del próximo torneo.'}]));
after(()=>{db.close();assert.equal(path.dirname(path.resolve(temporary)),path.resolve(os.tmpdir()));assert.ok(path.basename(temporary).startsWith('ctp-administration-contract-'));fs.rmSync(temporary,{recursive:true,force:true});});

test('administration query limits resources, identifiers, filter values and pagination',()=>{
  assert.deepEqual(administrationQuery(),{action:'admin_query',resource:'summary',target_id:null,filters:{page:0,limit:20}});
  assert.deepEqual(administrationQuery({resource:'users',page:'2',limit:'50',query:' Árbitro '}),{action:'admin_query',resource:'users',target_id:null,filters:{page:2,limit:50,query:'Árbitro'}});
  for(const query of [{resource:'auth.users'},{resource:'users',select:'*'},{resource:'user'},{resource:'access',target_id:'no'},{page:'-1'},{page:'1e2'},{limit:'0'},{limit:101},{query:['a']},{team_id:'other'}])assert.throws(()=>administrationQuery(query),error=>error.status===400);
});

test('role and access commands cannot escalate to administrator or smuggle account secrets',()=>{
  assert.deepEqual(administrationPayload('admin.user.role',{role:'referee'}),{role:'referee'});
  for(const payload of [{role:'admin'},{role:'player',is_admin:true},{role:'referee',password:'secret'}])assert.throws(()=>administrationPayload('admin.user.role',payload),error=>error.status===400);
  assert.deepEqual(administrationPayload('admin.entitlement.grant',{team_id:id,kind:'team_pass',amount_cents:0}),{team_id:id,kind:'team_pass',amount_cents:0});
  for(const payload of [{team_id:id,kind:'other'},{team_id:id,kind:'season_pass'},{team_id:id,kind:'tournament_ticket'},{team_id:id,kind:'team_pass',amount_cents:-1},{team_id:id,kind:'team_pass',amount_cents:1.5},{team_id:id,kind:'team_pass',verified:true}])assert.throws(()=>administrationPayload('admin.entitlement.grant',payload),error=>error.status===400);
  assert.throws(()=>administrationPayload('admin.entitlement.revoke',{}),error=>error.status===400);
  assert.deepEqual(administrationPayload('admin.entitlement.revoke',{reason}),{reason});
});

test('map and mode edits have explicit fields, bounded order and safe image URLs',()=>{
  assert.deepEqual(administrationPayload('admin.mode.update',{move:-1,reason}),{reason,move:-1});
  assert.deepEqual(administrationPayload('admin.map.create',{game_id:'cod',mode:'Hardpoint',name:'Mapa',image_url:'https://pre.playctp.com/map.webp',active:true,sort_order:0}),{game_id:'cod',name:'Mapa',mode:'Hardpoint',active:true,sort_order:0,image_url:'https://pre.playctp.com/map.webp'});
  for(const payload of [{},{name:''},{move:2},{active:1},{sort_order:-1},{game_id:'other'}])assert.throws(()=>administrationPayload('admin.mode.update',payload),error=>error.status===400);
  for(const image_url of ['javascript:alert(1)','http://example.test/x','https://user:secret@example.test/x'])assert.throws(()=>administrationPayload('admin.map.update',{image_url}),error=>error.status===400);
  assert.deepEqual(administrationPayload('admin.map.update',{image_url:''}),{image_url:''});
});
test('Circuit Pass grants four-season access without a season, tournament or verification field',()=>{
  assert.deepEqual(administrationPayload('admin.entitlement.grant',{team_id:id,kind:'circuit_pass',amount_cents:60000}),{team_id:id,kind:'circuit_pass',amount_cents:60000});
  for(const extra of [{season:1},{tournament_id:id},{verified:true},{role:'admin'}])assert.throws(()=>administrationPayload('admin.entitlement.grant',{team_id:id,kind:'circuit_pass',...extra}),error=>error.status===400);
});

test('campaigns require every locale and an internal destination, with separate queue confirmation',()=>{
  assert.deepEqual(administrationPayload('admin.campaign.create',{content,link:'/tournaments'}),{content,link:'/tournaments'});
  for(const payload of [{content:{es:content.es},link:'/tournaments'},{content,link:'https://evil.example'},{content,link:'//evil.example'},{content,link:'/ok',recipients:['private@example.test']},{content:{...content,en:{title:'Subject',body:''}},link:'/ok'}])assert.throws(()=>administrationPayload('admin.campaign.create',payload),error=>error.status===400);
  assert.deepEqual(administrationPayload('admin.campaign.queue',{confirm_id:id}),{confirm_id:id});
  assert.throws(()=>administrationPayload('admin.campaign.queue',{}),error=>error.status===400);
  const unicodeContent=Object.fromEntries(Object.keys(content).map(locale=>[locale,{title:'Asunto',body:'競'.repeat(3000)}]));
  assert.deepEqual(administrationPayload('admin.campaign.create',{content:unicodeContent,link:'/tournaments'}).content,unicodeContent);
});

test('Ranked operations require reasons, allow only known sides and never accept a new reset policy',()=>{
  assert.deepEqual(administrationPayload('admin.feature.set',{key:'ranked',enabled:false}),{key:'ranked',enabled:false});
  assert.deepEqual(administrationPayload('admin.ranked.lobby.resolve',{side:'b',reason}),{reason,side:'b'});
  for(const [type,payload]of [['admin.feature.set',{key:'payments',enabled:true}],['admin.ranked.queue.open',{}],['admin.ranked.lobby.resolve',{side:'c',reason}],['admin.ranked.queue.sync',{reason,reset_divisions:0}]])assert.throws(()=>administrationPayload(type,payload),error=>error.status===400);
  assert.equal(ADMIN_ACTIONS.length,18);assert.ok(ADMIN_CREATE_ACTIONS.every(type=>ADMIN_ACTIONS.includes(type)));
});

test('every administrative decision has a readable label for proposals and confirmations',()=>{
  for(const type of ADMIN_ACTIONS){
    assert.notEqual(actionLabel(type),'Acción de staff',type);
    assert.ok(actionLabel(`${type}.acknowledged`).includes('confirmación recibida de CTP'),type);
    assert.ok(actionLabel(`manager.${type}.rejected`).includes('rechazo recibido de CTP'),type);
  }
});
