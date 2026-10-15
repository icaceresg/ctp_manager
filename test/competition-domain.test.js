import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-competition-domain-'));
process.env.DATA_DIR=temporary;process.env.DB_PATH=path.join(temporary,'test.db');
const operations=await import('../server/operations.js');
const {competitionPayload,correctionPayload,COMPETITION_ACTIONS}=await import('../server/competition-contract.js');
const {db}=await import('../server/db.js');
const {describeUser}=await import('../server/auth.js');
function user(name,sections,isAdmin=false){
  const id=Number(db.prepare('INSERT INTO users(username,name,password_hash,is_admin,created_at) VALUES(?,?,?,?,?)').run(name,name,'unused',Number(isAdmin),Date.now()).lastInsertRowid);
  const role=Number(db.prepare("INSERT INTO roles(name,sections,staff_kind,created_at) VALUES(?,?,'operations',?)").run(name,JSON.stringify(sections),Date.now()).lastInsertRowid);
  db.prepare('INSERT INTO user_roles(user_id,role_id) VALUES(?,?)').run(id,role);
  return describeUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
}
const admin=user('domain-admin',[],true),coordinator=user('domain-coordinator',['operaciones']),referee=user('domain-referee',['arbitraje']),caster=user('domain-caster',['casters']);
const otherCaster=user('domain-caster-two',['casters']);
after(()=>{db.close();assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5});});
const tournament={id:randomUUID(),name:'Torneo prueba aislada',manager_version:5,status:'borrador',game_id:'cod',game_mode:'4vs4',participant_type:'equipo',kind:'cup',season:1,start_at:'2027-01-12T17:00:00Z',registration_close_at:'2027-01-11T17:00:00Z',min_participants:2,max_participants:8,roster_min:4,roster_max:6};
const players=Array.from({length:8},(_,index)=>({id:randomUUID(),username:`Jugador ${index}`,kills:10+index,deaths:5,assists:2,score:1000,objective:null,side:index<4?'a':'b'}));
const correction=()=>({reason:'Comprobado frente a la captura original',players:players.map((p,index)=>({user_id:p.id,kills:p.kills+(index===0?1:0),deaths:p.deaths,assists:p.assists,score:p.score,objective:p.objective}))});

test('competition creation validates field allowlist, dates, limits and nullable circuit season',()=>{
  const payload=competitionPayload('tournament.create',{...tournament,secret:'never-forward'});
  assert.equal(payload.secret,undefined);assert.equal(payload.id,undefined);assert.equal(payload.season,1);
  assert.throws(()=>competitionPayload('tournament.create',{...tournament,registration_close_at:null}),{status:400});
  assert.throws(()=>competitionPayload('tournament.create',{...tournament,registration_close_at:tournament.start_at}),{status:400});
  assert.throws(()=>competitionPayload('tournament.create',{...tournament,roster_max:13}),{status:400});
  assert.throws(()=>competitionPayload('tournament.create',{...tournament,kind:'cup',season:null}),{status:400});
  assert.equal(competitionPayload('tournament.create',{...tournament,kind:'fuera_de_circuito',season:null}).season,null);
  assert.throws(()=>competitionPayload('tournament.generate',{phase:'groups',round_minutes:14}),{status:400});
});
test('tournament preparation requires capabilities and permission, preserves official data and rejects stale versions',()=>{
  operations.rememberCompetitionData('tournament',{tournament,participants:[],matches:[]});
  const input={type:'tournament.status',target_id:tournament.id,expected_version:5,payload:{status:'inscripcion_abierta',reason:'Abrimos la inscripción de la temporada'}};
  assert.throws(()=>operations.prepareCompetitionCommand(coordinator,input),{status:422});
  operations.setIntegrationStatus({supported_actions:[...COMPETITION_ACTIONS,'stats.correct']});
  assert.throws(()=>operations.prepareCompetitionCommand(caster,input),{status:403});
  assert.throws(()=>operations.prepareCompetitionCommand(coordinator,{...input,expected_version:4}),{status:409});
  const prepared=operations.prepareCompetitionCommand(coordinator,input);
  assert.equal(prepared.resource.status,'borrador');assert.equal(prepared.command.expected_version,5);
  assert.equal(operations.bootstrap(caster).commands.some(c=>c.id===prepared.command.id),false);
  assert.equal(operations.bootstrap(coordinator).commands.some(c=>c.id===prepared.command.id),true);
  operations.cancelCommand(coordinator,prepared.command.id,{expected_updated_at:prepared.command.updated_at});
  assert.equal(operations.getCommand(prepared.command.id).status,'cancelled');
});
test('remote competition cache preserves pending links, handles old versions and transactionally rejects malformed records',()=>{
  const input={type:'tournament.generate',target_id:tournament.id,expected_version:5,payload:{phase:'direct',round_minutes:60}};
  const prepared=operations.prepareCompetitionCommand(coordinator,input);
  operations.rememberCompetitionData('tournaments',{items:[{...tournament,manager_version:6,name:'Cambio oficial'}]});
  const command=operations.getCommand(prepared.command.id);assert.equal(command.source_version_current,6);
  operations.rememberCompetitionData('tournaments',{items:[{...tournament,manager_version:4}]});
  assert.equal(operations.getCommand(command.id).source_version_current,6);
  assert.throws(()=>operations.rememberCompetitionData('tournaments',{items:[{...tournament,manager_version:7},{id:'broken'}]}),{status:502});
  assert.equal(operations.getCommand(command.id).source_version_current,6);
});
test('new tournament UUID is distinct and waits for official confirmation',()=>{
  const result=operations.prepareCompetitionCommand(admin,{type:'tournament.create',expected_version:0,payload:tournament});
  assert.match(result.resource.id,/^[a-f0-9-]{36}$/);assert.notEqual(result.resource.id,tournament.id);
  assert.equal(result.resource.source,'manager');assert.equal(result.command.expected_version,0);
  assert.equal(result.resource.status,'draft_pending');
});
test('statistics corrections enforce eight unique known players and numeric bounds',()=>{
  const payload=correctionPayload(correction());assert.equal(payload.players.length,8);
  assert.throws(()=>correctionPayload({...correction(),players:correction().players.slice(0,7)}),{status:400});
  const duplicate=correction();duplicate.players[7]=duplicate.players[0];assert.throws(()=>correctionPayload(duplicate),{status:400});
  for(const [field,value]of [['kills',1001],['objective',86401],['score',1000001],['deaths',1.2]]){const invalid=correction();invalid.players[0][field]=value;assert.throws(()=>correctionPayload(invalid),{status:400});}
});
test('correction remains unapplied until ACK and review history retains previous figures',()=>{
  operations.ingestSnapshot({matches:[{id:'domain-match',kind:'tournament',roster:players}],stats:[{id:'domain-stats',match_id:'domain-match',status:'pending',version:2,players}]});
  const statistic=operations.statisticsDetail(referee,'domain-stats').statistic;
  assert.throws(()=>operations.correctStatistics(caster,statistic.id,{expected_version:statistic.version,...correction()}),{status:403});
  const unknown=correction();unknown.players[0].user_id=randomUUID();assert.throws(()=>operations.correctStatistics(referee,statistic.id,{expected_version:statistic.version,...unknown}),{status:400});
  const result=operations.correctStatistics(referee,statistic.id,{expected_version:statistic.version,...correction()});
  assert.equal(result.resource.players[0].kills,10);assert.equal(result.command.type,'stats.correct');
  assert.throws(()=>operations.correctStatistics(referee,statistic.id,{expected_version:statistic.version,...correction()}),{status:409});
  const revisionId=randomUUID();
  assert.throws(()=>operations.acknowledgeCommand(result.command.id,{confirmed:true}),{status:400});
  operations.acknowledgeCommand(result.command.id,{confirmed:true,revision_id:revisionId});
  const detail=operations.statisticsDetail(referee,statistic.id);
  assert.equal(detail.statistic.players[0].kills,10);assert.equal(detail.statistic.correction_revision_id,revisionId);
  assert.throws(()=>operations.reviewStatistics(referee,statistic.id,{expected_version:detail.statistic.version,decision:'approve',reason:'Revisión de la versión antigua'}),{status:409});
  const entry=detail.audit.find(a=>a.action==='stats.correction.prepared');assert.equal(entry.details.before[0].kills,10);assert.equal(entry.details.corrections[0].kills,11);
});
test('shift replanning excludes itself from overlaps, requires reason and makes staff reconfirm',()=>{
  for(const person of [caster,otherCaster])db.prepare("INSERT INTO availability(user_id,date,status,updated_at) VALUES(?,'2027-01-12','disponible',?)").run(person.id,Date.now());
  const original=operations.createAssignment(coordinator,{match_id:'domain-match',user_id:caster.id,role:'caster',starts_at:'2027-01-12T17:00:00Z',ends_at:'2027-01-12T18:00:00Z'});
  const confirmed=operations.updateAssignment(caster,original.id,{expected_version:original.version,status:'confirmed'});
  const input={expected_version:confirmed.version,starts_at:'2027-01-12T17:15:00Z',ends_at:'2027-01-12T18:15:00Z',reason:'Cambio del horario oficial'};
  assert.throws(()=>operations.updateAssignment(caster,original.id,input),{status:403});
  assert.throws(()=>operations.updateAssignment(coordinator,original.id,{...input,reason:''}),{status:400});
  const updated=operations.updateAssignment(coordinator,original.id,input);assert.equal(updated.status,'pending');assert.equal(updated.role,'caster');
  const replacement=operations.updateAssignment(coordinator,original.id,{expected_version:updated.version,user_id:otherCaster.id,reason:'Sustitución por indisponibilidad'});assert.equal(replacement.user_id,otherCaster.id);
  operations.createAssignment(coordinator,{match_id:'domain-match',user_id:caster.id,role:'caster',starts_at:'2027-01-12T17:00:00Z',ends_at:'2027-01-12T18:00:00Z'});
  assert.throws(()=>operations.updateAssignment(coordinator,original.id,{expected_version:replacement.version,user_id:caster.id,reason:'Conflicto de turnos deliberado'}),{status:409});
  assert.equal(operations.matchDossier(coordinator,'domain-match').audit.some(a=>a.action==='assignment.replaced'&&a.details.before.user_id===caster.id),true);
});
test('explicit historical statistics reads retain source versions without invalidating unchanged forms',()=>{
  const statisticId=randomUUID();
  const raw={id:statisticId,match_id:'domain-match',status:'approved',manager_version:7,revision:2,map_number:1,players:players.map(player=>({user_id:player.id,kills:player.kills,deaths:player.deaths,assists:player.assists,score:player.score,objective:null}))};
  const source={items:[raw],roster:players.map(player=>({user_id:player.id,username:player.username}))};
  const first=operations.rememberCompetitionData('statistics',source).items[0];
  const second=operations.rememberCompetitionData('statistics',source).items[0];
  assert.equal(second.version,first.version);assert.equal(second.players[0].username,'Jugador 0');
  operations.ingestSnapshot({stats:[],generated_at:new Date().toISOString(),possibly_truncated:false});
  assert.throws(()=>operations.correctStatistics(referee,statisticId,{expected_source_version:6,...correction()}),{status:409});
  const command=operations.correctStatistics(referee,statisticId,{expected_source_version:7,...correction()}).command;
  assert.equal(command.expected_version,7);assert.equal(operations.getCommand(command.id).source_available,true);
});
