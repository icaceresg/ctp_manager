import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-player-workspace-'));
process.env.DATA_DIR=temp;process.env.DB_PATH=path.join(temp,'workspace.db');
const {playerWorkspaceId,playerWorkspaceQuery,playerWorkspaceResponse}=await import('../server/player-workspace-contract.js');
const {createPlayerWorkspaceReader}=await import('../server/player-workspace-client.js');
const {db}=await import('../server/db.js');
const {playerOffset,playerTab,participationLabel,playerResult,playerWaitSeconds}=await import('../client/src/pages/playerWorkspaceModel.js');
after(()=>{db.close();fs.rmSync(temp,{recursive:true,force:true,maxRetries:5});});
const id='243abcde-0000-4000-8000-000000000001',other='243abcde-0000-4000-8000-000000000002',date='2026-10-26T12:00:00Z';
const person={id,username:'Jugador DEV',gamertag:null,activision_id:'SinNumeros',platform:'PC',role:'player',created_at:date};
const viewer={can_edit:false,can_view_tickets:false,can_view_sanctions:false};
const page=(available=true)=>({available,offset:0,limit:20,total:available?0:null,has_more:false,items:[]});
const detail=()=>({schema_version:1,operation:'detail',observed_at:date,viewer:{...viewer},user:{...person,closed:false,email_confirmed:true,login_banned_until:null},clubs:[],rating:null,
 participation:{state:'idle',queue:null,joined_at:null,presence_expires_at:null,party_id:null,lobby:null},results:page(),tickets:page(false),sanctions:page(false)});
const search=()=>({schema_version:1,operation:'search',observed_at:date,viewer:{...viewer},query:'',offset:0,limit:20,total:1,items:[{...person}]});
const detailQuery={operation:'detail',user_id:id};
const rejectsResponse=value=>assert.throws(()=>playerWorkspaceResponse(value,detailQuery),error=>error.status===502);

test('requests accept canonical identities and independent bounded pages only',()=>{
 assert.equal(playerWorkspaceId(id.toUpperCase()),id);
 assert.deepEqual(playerWorkspaceQuery({query:' Jugador DEV '}),{operation:'search',limit:20,offset:0,query:'Jugador DEV'});
 assert.deepEqual(playerWorkspaceQuery({...detailQuery,limit:1,tickets_offset:4}),{operation:'detail',limit:1,results_offset:0,tickets_offset:4,sanctions_offset:0,user_id:id});
 for(const bad of [{operation:'update',user_id:id},{...detailQuery,email:'private'}, {...detailQuery,user_id:'Jugador DEV'},{...detailQuery,limit:26}, {...detailQuery,limit:0},{query:'x'.repeat(121)},{query:'a\nb'},{offset:-1},{offset:1.5},{offset:1000000},{limit:'20'},{operation:'search',user_id:id}])
  assert.throws(()=>playerWorkspaceQuery(bad),error=>error.status===400);
});
test('search and detail whitelist every field and preserve no-rating versus zero',()=>{
 const raw=detail();raw.email='private@example.invalid';raw.user.email='private@example.invalid';raw.user.encrypted_password='secret';raw.user.obs_url='https://invalid/#secret';raw.session={token:'secret'};
 const result=playerWorkspaceResponse(raw,detailQuery);
 assert.equal(result.rating,null);assert.equal(result.participation.state,'idle');assert.equal(result.tickets.total,null);
 assert.doesNotMatch(JSON.stringify(result),/private@example|encrypted_password|obs_url|token|session/);
 const rawSearch=search();rawSearch.items[0].email='private@example.invalid';assert.equal(playerWorkspaceResponse(rawSearch,{}).items[0].email,undefined);
});
test('a response for another account or echoed search cannot be used for navigation',()=>{
 const value=detail();value.user.id=other;rejectsResponse(value);
 const result=search();result.query='another';assert.throws(()=>playerWorkspaceResponse(result,{}),error=>error.status===502);
 result.query='';result.items.push({...person});assert.throws(()=>playerWorkspaceResponse(result,{}),error=>error.status===502);
});
test('unavailable histories are not presented as empty histories; scope flags must agree',()=>{
 for(const alter of [v=>v.tickets.total=0,v=>v.tickets.available=true,v=>v.viewer.can_view_tickets=true,v=>v.sanctions.has_more=true,v=>v.results.has_more=true,v=>v.results.total=1,v=>v.results.offset=20,v=>v.results.limit=1]){const value=detail();alter(value);rejectsResponse(value);}
 const value=detail();value.viewer.can_view_tickets=true;value.tickets=page();assert.equal(playerWorkspaceResponse(value,detailQuery).tickets.total,0);
});
test('ratings and live participation must be internally consistent',()=>{
 const value=detail();value.rating={game_id:'g_mw4',season_id:other,xp:350,peak_xp:400,wins:2,losses:1,games:3,division_id:'bronze',win_streak:2,updated_at:date};
 assert.equal(playerWorkspaceResponse(value,detailQuery).rating.xp,350);
 value.rating.games=4;rejectsResponse(value);value.rating.games=3;value.rating.peak_xp=300;rejectsResponse(value);
 value.rating=null;value.participation.state='queued';rejectsResponse(value);
 value.participation={state:'queued',queue:{id:other,title:'Ranked',game_id:'g_mw4',mode:'Hardpoint'},joined_at:date,presence_expires_at:'2026-10-26T12:01:00Z',party_id:null,lobby:null};
 assert.equal(playerWorkspaceResponse(value,detailQuery).participation.state,'queued');value.participation.presence_expires_at=date;rejectsResponse(value);
});
test('reader uses the existing signed action once, with current actor and no write fields',async()=>{
 const calls=[],current={id:'local-ref',auth_mode:'ctp',ctp_user_id:other,ctp_role:'referee',is_admin:false};
 const read=createPlayerWorkspaceReader({database:db,actorFor:async me=>{assert.equal(me,current);return 'referee.dev';},request:async payload=>{calls.push(payload);return{...detail(),viewer:{...viewer,can_edit:true}};}});
 const result=await read(current,detailQuery);
 assert.deepEqual(calls,[{action:'player_workspace',actor_id:'referee.dev',query:playerWorkspaceQuery(detailQuery)}]);assert.equal(result.viewer.can_edit,false);
 await assert.rejects(()=>read({auth_mode:'ctp',ctp_role:'player',ctp_user_id:other},detailQuery),error=>error.status===403);assert.equal(calls.length,1);
 await assert.rejects(()=>read({is_admin:false,sections:['arbitraje']},detailQuery),error=>error.status===403);assert.equal(calls.length,1);
});
test('failed or malformed reads cannot masquerade as a successful empty search',async()=>{
 const current={is_admin:true};
 assert.throws(()=>createPlayerWorkspaceReader({actorFor:()=> 'admin.dev',request:async()=>detail()}),TypeError);
 const broken=createPlayerWorkspaceReader({database:db,actorFor:()=> 'admin.dev',request:async()=>({items:[]})});
 await assert.rejects(()=>broken(current,{}),error=>error.status===502);
 const noActor=createPlayerWorkspaceReader({database:db,actorFor:()=>null,request:async()=>{throw Error('must not send');}});
 await assert.rejects(()=>noActor(current,{}),error=>error.status===403);
});
test('presentation preserves waiting, legacy XP, cancelled games and invalid URL bounds',()=>{
 assert.equal(participationLabel('presence_expired'),'Presencia de cola caducada');assert.equal(playerResult({status:'cancelled'}),'Cancelada');
 assert.equal(playerResult({status:'closed',winner:'a',my_side:'b'}),'Derrota');assert.equal(playerResult({status:'closed',winner:null,my_side:'a'}),'Sin resultado asignado');
 for(const value of ['-20','1.5','1000000','Infinity'])assert.equal(playerOffset(value),0);
 assert.equal(playerOffset('999999'),999999);assert.equal(playerTab('sanctions'),'sanctions');assert.equal(playerTab('admin'),'summary');
 assert.equal(playerWaitSeconds({state:'queued',joined_at:'2026-10-26T11:57:46Z'},date),134);
 assert.equal(playerWaitSeconds({state:'presence_expired',joined_at:'2026-10-26T11:57:46Z'},date),null);
 assert.equal(playerWaitSeconds({state:'queued',joined_at:'invalid'},date),null);
});
