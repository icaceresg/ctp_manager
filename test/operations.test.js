import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-operations-'));
process.env.DATA_DIR = temporary;
process.env.DB_PATH = path.join(temporary, 'operations.db');
const operations = await import('../server/operations.js');
const { db } = await import('../server/db.js');
const { describeUser } = await import('../server/auth.js');
const adminId = Number(db.prepare("INSERT INTO users(username,name,password_hash,is_admin,created_at) VALUES('admin-ops','Admin','unused',1,?)").run(Date.now()).lastInsertRowid);
function createStaff(username, sections) {
  const userId = Number(db.prepare('INSERT INTO users(username,name,password_hash,created_at) VALUES(?,?,?,?)').run(username,username,'unused',Date.now()).lastInsertRowid);
  const roleId = Number(db.prepare("INSERT INTO roles(name,sections,created_at,staff_kind) VALUES(?,?,?,'operations')").run(username,JSON.stringify(sections),Date.now()).lastInsertRowid);
  db.prepare('INSERT INTO user_roles(user_id,role_id) VALUES(?,?)').run(userId,roleId);
  return describeUser(db.prepare('SELECT * FROM users WHERE id=?').get(userId));
}
const admin = describeUser(db.prepare('SELECT * FROM users WHERE id=?').get(adminId));
const referee = createStaff('referee-ops', ['arbitraje']);
const caster = createStaff('caster-ops', ['casters']);
const comms = createStaff('comms-ops', ['comunicaciones']);
const clubs = createStaff('clubs-ops', ['clubes']);
const noAccess = createStaff('none-ops', ['calendario']);
const baseMatch = {id:'match-a',kind:'tournament',title:'Final',status:'scheduled',scheduled_at:'2026-10-01T17:00:00Z',team_a:{id:'a',name:'Alpha'},team_b:{id:'b',name:'Beta'},score_a:3,score_b:1,confirmed:true,web_path:'/torneos/final',roster:[],maps:[]};
operations.ingestSnapshot({matches:[baseMatch,{...baseMatch,id:'match-b',confirmed:false}],incidents:[{id:'incident-ctp',match_id:'match-a',title:'Disputa',reason:'Resultado distinto',status:'open',version:7}],stats:[{id:'stats-a',match_id:'match-a',status:'pending',map_name:'Mapa',players:[{id:'p1',gamertag:'Jugador',kills:15,deaths:9,private_email:'not-exported@example.test'}]}],clubs:[{id:'club-a',name:'Alpha',verified:false,pass_active:true}],deliveries:[{id:'delivery-a',status:'failed',kind:'challenge',match_id:'match-a',error:'Temporal'}]});

after(() => {
  db.close();
  // The temporary directory is created and owned by this test only.
  assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5});
});

test('snapshot validates atomically, strips private fields and preserves unknown statistics as null', () => {
  const snap=operations.bootstrap(admin);
  assert.equal(snap.stats[0].players[0].private_email,undefined);
  assert.equal(snap.stats[0].players[0].assists,null);
  assert.throws(()=>operations.ingestSnapshot({clubs:[{id:'must-not-exist',name:'One'},{}]}),{status:400});
  assert.equal(operations.bootstrap(admin).clubs.some(c=>c.id==='must-not-exist'),false);
  const before=snap.matches.find(m=>m.id==='match-a').version;
  operations.ingestSnapshot({matches:[baseMatch]});
  assert.equal(operations.bootstrap(admin).matches.find(m=>m.id==='match-a').version,before);
});

test('server permissions exclude incidents, pending stats and staff data from unrelated roles', () => {
  assert.throws(()=>operations.bootstrap(noAccess),{status:403});
  const data=operations.bootstrap(caster);
  assert.deepEqual(data.incidents,[]);
  assert.deepEqual(data.stats,[]);
  assert.deepEqual(data.clubs,[]);
  assert.deepEqual(operations.matchDossier(caster,'match-a').statistics,[]);
  assert.deepEqual(operations.bootstrap(clubs).matches,[]);
  assert.throws(()=>operations.resolveIncident(caster,'incident-ctp',{expected_version:1,decision:'close',resolution:'No'}),{status:403});
});

test('incident internal notes stay private and stale revisions cannot overwrite', () => {
  const incident=operations.createIncident(referee,{match_id:'match-a',title:'Rival ausente',reason:'No llegó a la sala'});
  const result=operations.addIncidentNote(referee,incident.id,{expected_version:incident.version,text:'Nota privada de arbitraje',visibility:'internal'});
  assert.equal(result.command,null);
  assert.throws(()=>operations.updateIncident(referee,incident.id,{expected_version:incident.version,status:'waiting'}),{status:409});
  assert.equal(operations.incidentDetail(referee,incident.id).notes[0].text,'Nota privada de arbitraje');
  assert.throws(()=>operations.incidentDetail(caster,incident.id),{status:403});
  assert.equal(JSON.stringify(operations.bootstrap(caster)).includes('Nota privada'),false);
});

test('official resolution remains pending until explicit CTP ACK, and ACK is idempotent', () => {
  const original=operations.bootstrap(referee).incidents.find(i=>i.id==='incident-ctp');
  const result=operations.resolveIncident(referee,original.id,{expected_version:original.version,decision:'close',resolution:'Revisión completada'});
  assert.equal(result.resource.status,'resolution_pending');
  assert.equal(result.command.expected_version,7);
  assert.equal(result.command.type,'incident.resolve');
  assert.throws(()=>operations.acknowledgeCommand(result.command.id,{confirmed:false}),{status:400});
  operations.failCommand(result.command.id,'Conexión interrumpida');
  assert.equal(operations.getCommand(result.command.id).status,'failed');
  assert.equal(operations.incidentDetail(referee,original.id).incident.status,'resolution_pending');
  operations.acknowledgeCommand(result.command.id,{confirmed:true,external_id:'receipt-1'});
  const first=operations.incidentDetail(referee,original.id).incident;
  operations.acknowledgeCommand(result.command.id,{confirmed:true,external_id:'receipt-1'});
  assert.equal(first.status,'resolved');
  assert.equal(operations.incidentDetail(referee,original.id).incident.version,first.version);
});

test('participant-facing notes have durable pending delivery instead of claiming they were sent', () => {
  operations.ingestSnapshot({incidents:[{id:'incident-reply',kind:'tournament',match_id:'match-a',title:'Falta mapa',reason:'Solicitar captura',status:'open',version:1}]});
  const incident=operations.incidentDetail(referee,'incident-reply').incident;
  const result=operations.addIncidentNote(referee,incident.id,{expected_version:incident.version,text:'Adjuntad la captura del mapa',visibility:'participants'});
  assert.equal(result.command.type,'incident.reply');
  assert.equal(operations.incidentDetail(referee,incident.id).notes[0].delivery_status,'pending');
  operations.acknowledgeCommand(result.command.id,{confirmed:true});
  assert.equal(operations.incidentDetail(referee,incident.id).notes[0].delivery_status,'delivered');
});

test('rejected official tickets block legacy editing, participant replies and duplicate resolutions',()=>{
  operations.ingestSnapshot({incidents:[{id:'incident-rejected',kind:'tournament',match_id:'match-a',title:'Ticket rechazado',reason:'Revisión completada',status:'rechazado',version:9}]});
  const incident=operations.incidentDetail(referee,'incident-rejected').incident;
  assert.equal(incident.status,'rejected');
  assert.throws(()=>operations.updateIncident(referee,incident.id,{expected_version:incident.version,status:'open'}),{status:409});
  assert.throws(()=>operations.addIncidentNote(referee,incident.id,{expected_version:incident.version,text:'Mensaje que no debe salir',visibility:'participants'}),{status:409});
  assert.throws(()=>operations.resolveIncident(referee,incident.id,{expected_version:incident.version,decision:'close',resolution:'Segunda resolución improcedente'}),{status:409});
  assert.equal(operations.incidentDetail(referee,incident.id).notes.length,0);
});

test('assignments require explicit availability and role, reject overlap, and only assignee confirms', () => {
  const input={match_id:'match-a',user_id:caster.id,role:'caster',starts_at:'2026-10-01T17:00:00Z',ends_at:'2026-10-01T19:00:00Z'};
  assert.throws(()=>operations.createAssignment(admin,input),{status:409});
  db.prepare("INSERT INTO availability(user_id,date,status,updated_at) VALUES(?,'2026-10-01','disponible',?)").run(caster.id,Date.now());
  const assignment=operations.createAssignment(admin,input);
  assert.throws(()=>operations.createAssignment(admin,{...input,match_id:'match-b'}),{status:409});
  assert.throws(()=>operations.updateAssignment(admin,assignment.id,{expected_version:1,status:'confirmed'}),{status:403});
  assert.equal(operations.updateAssignment(caster,assignment.id,{expected_version:1,status:'confirmed'}).status,'confirmed');
  assert.throws(()=>operations.updateAssignment(caster,assignment.id,{expected_version:1,status:'declined'}),{status:409});
  assert.throws(()=>operations.createAssignment(admin,{...input,user_id:comms.id}),{status:400});
});

test('caster notes are persisted only in their authorized dossier', () => {
  operations.addCasterNote(caster,'match-a',{text:'Pronunciación revisada por el equipo'});
  assert.equal(operations.matchDossier(caster,'match-a').notes.length,1);
  assert.deepEqual(operations.matchDossier(comms,'match-a').notes,[]);
  assert.throws(()=>operations.addCasterNote(comms,'match-a',{text:'No'}),{status:403});
});

test('production requires a real rundown, legal transitions and optimistic version', () => {
  const rundownId=Number(db.prepare('INSERT INTO rundowns(title,created_at,updated_at) VALUES(?,?,?)').run('Directo',Date.now(),Date.now()).lastInsertRowid);
  assert.throws(()=>operations.updateProduction(admin,'match-a',{expected_version:0,state:'live'}),{status:409});
  assert.throws(()=>operations.updateProduction(admin,'match-a',{expected_version:0,state:'ready',rundown_id:99999}),{status:400});
  const ready=operations.updateProduction(admin,'match-a',{expected_version:0,state:'ready',rundown_id:rundownId,note:''});
  assert.equal(ready.version,1);
  const live=operations.updateProduction(admin,'match-a',{expected_version:ready.version,state:'live',scene:'map'});
  assert.equal(live.rundown_id,rundownId);
  assert.throws(()=>operations.updateProduction(admin,'match-a',{expected_version:1,state:'paused'}),{status:409});
});

test('statistics and club review request changes without approving data or changing payment entitlement', () => {
  const stats=operations.bootstrap(referee).stats[0];
  const result=operations.reviewStatistics(referee,stats.id,{expected_version:stats.version,decision:'approve',reason:'Ocho jugadores y cifras revisados'});
  assert.equal(result.resource.status,'pending');
  assert.throws(()=>operations.reviewStatistics(referee,stats.id,{expected_version:result.resource.version,decision:'reject',reason:'Otra decisión'}),{status:409});
  const club=operations.bootstrap(clubs).clubs[0];
  const review=operations.reviewClub(clubs,club.id,{expected_version:club.version,decision:'verify',reason:'Identidad revisada'});
  assert.equal(review.resource.verified,false);
  assert.equal(review.resource.pass_active,true);
  operations.acknowledgeCommand(review.command.id,{confirmed:true});
  assert.equal(operations.bootstrap(clubs).clubs[0].verified,true);
  assert.equal(operations.bootstrap(clubs).clubs[0].pass_active,true);
});

test('Discord retry stays failed until external ACK and does not pretend the message was delivered', () => {
  const delivery=operations.bootstrap(comms).deliveries[0];
  const result=operations.retryDelivery(comms,delivery.id,{expected_version:delivery.version});
  assert.equal(result.resource.status,'failed');
  operations.acknowledgeCommand(result.command.id,{confirmed:true});
  assert.equal(operations.bootstrap(comms).deliveries[0].status,'queued');
});

test('disciplinary record stays internal and a different referee decides the appeal', () => {
  const sanction=operations.createSanction(referee,{incident_id:'incident-ctp',subject_id:'player-1',subject_type:'player',reason:'Conducta revisada',restriction:'warning',starts_at:'2026-10-01T00:00:00Z',ends_at:'2026-10-02T00:00:00Z'});
  assert.equal(sanction.official,false);
  const appealed=operations.appealSanction(referee,sanction.id,{expected_version:sanction.version,reason:'Nueva información'});
  assert.throws(()=>operations.reviewSanction(referee,sanction.id,{expected_version:appealed.version,decision:'revoke',reason:'Aceptada'}),{status:403});
  const reviewed=operations.reviewSanction(admin,sanction.id,{expected_version:appealed.version,decision:'revoke',reason:'Nueva información comprobada'});
  assert.equal(reviewed.official,false);
  assert.equal(reviewed.status,'withdrawn');
});

test('confirmed results create one editorial card and checklist, never auto-publish', () => {
  assert.throws(()=>operations.createMatchContent(comms,'match-b'),{status:409});
  const first=operations.createMatchContent(comms,'match-a');
  const repeated=operations.createMatchContent(comms,'match-a');
  assert.equal(first.created,true);
  assert.equal(repeated.created,false);
  assert.equal(first.id,repeated.id);
  const content=db.prepare('SELECT * FROM contents WHERE id=?').get(first.id);
  assert.equal(content.status,'no_listo');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM resources WHERE content_id=?').get(first.id).n,3);
});

test('local incidents close internally and cannot publish a reply or a competitive result', () => {
  const item=operations.createIncident(referee,{match_id:'match-a',title:'Seguimiento interno',reason:'Comprobación de organización'});
  assert.throws(()=>operations.addIncidentNote(referee,item.id,{expected_version:item.version,visibility:'participants',text:'Respuesta'}),{status:422});
  assert.throws(()=>operations.resolveIncident(referee,item.id,{expected_version:item.version,decision:'award',resolution:'Ganador propuesto',winner_team_id:'a'}),{status:400});
  const closed=operations.resolveIncident(referee,item.id,{expected_version:item.version,decision:'close',resolution:'Seguimiento completado'});
  assert.equal(closed.command,null);
  assert.equal(closed.resource.status,'closed_internal');
  assert.equal(closed.resource.official,false);
  assert.throws(()=>operations.updateIncident(referee,item.id,{expected_version:closed.resource.version,status:'open'}),{status:409});
});

test('commands can be discarded only before sending; cancellation preserves audit and releases resource', () => {
  operations.ingestSnapshot({incidents:[{id:'cancel-case',match_id:null,kind:'support',status:'abierto',version:0,title:'Consulta',reason:'Ayuda'}]});
  const item=operations.incidentDetail(referee,'cancel-case').incident;
  const queued=operations.resolveIncident(referee,item.id,{expected_version:item.version,decision:'close',resolution:'Cierre a revisar'});
  assert.throws(()=>operations.cancelCommand(caster,queued.command.id,{expected_updated_at:queued.command.updated_at}),{status:403});
  assert.throws(()=>operations.cancelCommand(referee,queued.command.id,{expected_updated_at:0}),{status:409});
  const cancelled=operations.cancelCommand(referee,queued.command.id,{expected_updated_at:queued.command.updated_at});
  assert.equal(cancelled.status,'cancelled');
  assert.equal(cancelled.result.cancelled_by,referee.id);
  assert.equal(operations.incidentDetail(referee,item.id).incident.status,'open');
  assert.equal(operations.incidentDetail(referee,item.id).incident.pending_command_id,null);
  assert.throws(()=>operations.acknowledgeCommand(queued.command.id,{confirmed:true}),{status:409});
  const again=operations.resolveIncident(referee,item.id,{expected_version:operations.incidentDetail(referee,item.id).incident.version,decision:'close',resolution:'Nueva resolución revisada'});
  assert.notEqual(again.command.id,queued.command.id);
  operations.markCommandSending(again.command.id);
  const sending=operations.getCommand(again.command.id);
  assert.equal(sending.attempts,1);
  assert.throws(()=>operations.cancelCommand(referee,sending.id,{expected_updated_at:sending.updated_at}),{status:409});
  assert.throws(()=>operations.markCommandSending(sending.id),{status:409});
  operations.failCommand(sending.id,'Respuesta no confirmada');
  const failed=operations.getCommand(sending.id);
  assert.throws(()=>operations.cancelCommand(referee,failed.id,{expected_updated_at:failed.updated_at}),{status:409});
  assert.equal(operations.markCommandSending(failed.id).idempotency_key,again.command.idempotency_key);
});

test('stale sending commands can be reclaimed with the same idempotency key after timeout', () => {
  const command=operations.listPendingCommands().find(c=>c.type==='stats.review');
  operations.markCommandSending(command.id);
  db.prepare('UPDATE operation_commands SET updated_at=? WHERE id=?').run(Date.now()-31_000,command.id);
  const reclaimed=operations.markCommandSending(command.id);
  assert.equal(reclaimed.id,command.id);
  assert.equal(reclaimed.idempotency_key,command.idempotency_key);
  assert.equal(reclaimed.attempts,2);
});

test('snapshot refresh preserves local follow-up while external version is unchanged and ignores older versions', () => {
  const feed={id:'tracking-case',match_id:null,kind:'support',status:'abierto',version:5,title:'Consulta',reason:'Ayuda'};
  operations.ingestSnapshot({incidents:[feed]});
  let item=operations.incidentDetail(referee,feed.id).incident;
  operations.updateIncident(referee,item.id,{expected_version:item.version,status:'investigating',assignee_id:referee.id});
  operations.ingestSnapshot({incidents:[feed]});
  item=operations.incidentDetail(referee,feed.id).incident;
  assert.equal(item.status,'investigating');
  assert.equal(item.assignee_id,referee.id);
  operations.ingestSnapshot({incidents:[{...feed,version:4,status:'cerrado'}]});
  assert.equal(operations.incidentDetail(referee,feed.id).incident.status,'investigating');
  operations.ingestSnapshot({incidents:[{...feed,version:6,status:'resuelto'}]});
  assert.equal(operations.incidentDetail(referee,feed.id).incident.status,'resolved');
});

test('caster DTO includes approved source statistics but never pending embedded data or private attributes', () => {
  operations.ingestSnapshot({matches:[{...baseMatch,id:'with-stats',statistics:[{id:'approved-map',status:'approved',map_name:'Mapa A',players:[{user_id:'p-ctp',kills:10,deaths:7,email:'private'}]},{id:'pending-map',status:'pending',map_name:'Mapa secreto',players:[]}]}]});
  const dossier=operations.matchDossier(caster,'with-stats');
  assert.equal(dossier.statistics.length,1);
  assert.equal(dossier.statistics[0].players[0].id,'p-ctp');
  assert.equal(JSON.stringify(operations.bootstrap(caster)).includes('Mapa secreto'),false);
  assert.equal(JSON.stringify(dossier).includes('email'),false);
});

test('winner-only confirmed matches prepare editorial content without inventing map scores', () => {
  operations.ingestSnapshot({matches:[{...baseMatch,id:'winner-content',kind:'challenge',score_a:null,score_b:null,winner_id:'a',confirmed:true}]});
  const result=operations.createMatchContent(comms,'winner-content');
  assert.equal(db.prepare('SELECT copy FROM contents WHERE id=?').get(result.id).copy,'Victoria de Alpha frente a Beta');
});

test('complete feeds retire absent projections, truncated feeds retain them, and history stays available', () => {
  operations.ingestSnapshot({generated_at:new Date().toISOString(),possibly_truncated:true,incidents:[]});
  assert.ok(operations.bootstrap(referee).incidents.some(i=>i.id==='tracking-case'));
  operations.ingestSnapshot({generated_at:new Date().toISOString(),possibly_truncated:false,incidents:[]});
  assert.equal(operations.bootstrap(referee).incidents.some(i=>i.id==='tracking-case'),false);
  assert.throws(()=>operations.incidentDetail(referee,'tracking-case'),{status:404});
  assert.ok(db.prepare("SELECT COUNT(*) n FROM operation_audit WHERE resource_id='tracking-case'").get().n>0);
  assert.ok(operations.bootstrap(referee).incidents.some(i=>i.source==='manager'));
});

test('staff availability notes are private to the person and operations coordinators', () => {
  db.prepare("UPDATE availability SET note='Nota personal del caster' WHERE user_id=?").run(caster.id);
  assert.equal(operations.bootstrap(referee).staff.find(s=>s.id===caster.id).availability.length,0);
  assert.equal(operations.bootstrap(caster).staff.find(s=>s.id===caster.id).availability[0].note,'Nota personal del caster');
  assert.equal(operations.bootstrap(admin).staff.find(s=>s.id===caster.id).availability[0].note,'Nota personal del caster');
});

test('suspension scopes are explicit and warnings never grant hidden enforcement scopes', () => {
  operations.ingestSnapshot({incidents:[{id:'official-discipline-case',match_id:'match-a',kind:'tournament',status:'resolved',version:1,title:'Arbitraje',reason:'Expediente revisado'}]});
  const input={incident_id:'official-discipline-case',subject_id:'player-discipline',subject_type:'player',reason:'Propuesta motivada y documentada',restriction:'competition_suspend',starts_at:new Date(Date.now()+60_000).toISOString(),ends_at:new Date(Date.now()+3600_000).toISOString()};
  assert.throws(()=>operations.createSanction(referee,input),{status:400});
  assert.throws(()=>operations.createSanction(referee,{...input,restriction:'warning',scopes:['ranked']}),{status:400});
  assert.throws(()=>operations.createSanction(referee,{...input,scopes:['ranked','ranked']}),{status:400});
  assert.throws(()=>operations.createSanction(referee,{...input,scopes:['payments']}),{status:400});
});

test('official sanctions preserve UUID, require CTP ACK, and route appeals to independent review', () => {
  const independent=createStaff('independent-referee',['arbitraje']);
  const draft=operations.createSanction(referee,{incident_id:'official-discipline-case',subject_id:'player-discipline',subject_type:'player',reason:'Medida motivada por resolución arbitral',restriction:'competition_suspend',scopes:['ranked'],starts_at:new Date(Date.now()+60_000).toISOString(),ends_at:new Date(Date.now()+3600_000).toISOString()});
  const submitted=operations.submitSanction(referee,draft.id,{expected_version:draft.version});
  assert.equal(submitted.command.target_id,draft.id);
  assert.equal(submitted.command.expected_version,0);
  assert.equal(submitted.resource.official,false);
  assert.deepEqual(submitted.command.payload.scopes,['ranked']);
  operations.markCommandSending(submitted.command.id);
  operations.acknowledgeCommand(submitted.command.id,{confirmed:true,source_version:1});
  let sanction=operations.bootstrap(referee).sanctions.find(s=>s.id===draft.id);
  assert.equal(sanction.official,true);
  assert.equal(sanction.source,'ctp');
  assert.equal(sanction.status,'scheduled');
  assert.equal(sanction.source_version,1);
  const appeal=operations.appealSanction(admin,sanction.id,{expected_version:sanction.version,reason:'El afectado aporta información adicional'});
  assert.equal(appeal.resource.appeal_status,'none');
  assert.equal(appeal.command.expected_version,1);
  operations.acknowledgeCommand(appeal.command.id,{confirmed:true,source_version:2});
  sanction=operations.bootstrap(referee).sanctions.find(s=>s.id===draft.id);
  assert.equal(sanction.appeal_status,'pending');
  assert.throws(()=>operations.reviewSanction(referee,sanction.id,{expected_version:sanction.version,decision:'revoke',reason:'Motivo suficientemente detallado'}),{status:403});
  assert.throws(()=>operations.reviewSanction(admin,sanction.id,{expected_version:sanction.version,decision:'revoke',reason:'Motivo suficientemente detallado'}),{status:403});
  const reviewed=operations.reviewSanction(independent,sanction.id,{expected_version:sanction.version,decision:'revoke',reason:'Las nuevas pruebas justifican retirar la medida'});
  assert.notEqual(reviewed.resource.status,'revoked');
  operations.acknowledgeCommand(reviewed.command.id,{confirmed:true,source_version:3});
  sanction=operations.bootstrap(referee).sanctions.find(s=>s.id===draft.id);
  assert.equal(sanction.status,'revoked');
  assert.equal(sanction.appeal_status,'revoked');
});

test('snapshot may arrive before sanction ACK without losing the proposal, and older ACK cannot revert it', () => {
  const draft=operations.createSanction(referee,{incident_id:'official-discipline-case',subject_id:'player-warning',subject_type:'player',reason:'Amonestación explicada en expediente',restriction:'warning',scopes:[],starts_at:new Date(Date.now()-60_000).toISOString(),ends_at:new Date(Date.now()+3600_000).toISOString()});
  const submitted=operations.submitSanction(referee,draft.id,{expected_version:draft.version});
  operations.markCommandSending(submitted.command.id);
  const incoming={...draft,official:true,status:'revoked',version:2,issued_by:'ctp-operator-uuid',appeal_status:'none'};
  operations.ingestSnapshot({sanctions:[incoming]});
  operations.acknowledgeCommand(submitted.command.id,{confirmed:true,source_version:1});
  const synced=operations.bootstrap(referee).sanctions.find(s=>s.id===draft.id);
  assert.equal(synced.source,'ctp');
  assert.equal(synced.status,'revoked');
  assert.equal(synced.source_version,2);
  assert.equal(synced.created_by,referee.id);
  assert.equal(synced.source_issued_by,'ctp-operator-uuid');
});

test('a source snapshot cannot seize an unrelated local sanction UUID', () => {
  const draft=operations.createSanction(referee,{incident_id:'official-discipline-case',subject_id:'unsubmitted-player',subject_type:'player',reason:'Propuesta que aún no se ha enviado',restriction:'warning',scopes:[],starts_at:new Date(Date.now()).toISOString(),ends_at:new Date(Date.now()+3600_000).toISOString()});
  assert.throws(()=>operations.ingestSnapshot({sanctions:[{...draft,version:1,official:true,status:'active'}]}),{status:409});
  assert.equal(operations.bootstrap(referee).sanctions.find(s=>s.id===draft.id).official,false);
});

test('integration operator UUID survives sessions but not deletion and reuse of numeric user ID', () => {
  const previousId=Number(db.prepare("INSERT INTO users(username,name,password_hash,created_at) VALUES('identity-before','Before','unused',?)").run(Date.now()).lastInsertRowid);
  const before=operations.getOperatorIdentity(previousId);
  assert.match(before,/^[0-9a-f-]{36}$/);
  assert.equal(operations.getOperatorIdentity(previousId),before);
  db.prepare('DELETE FROM users WHERE id=?').run(previousId);
  const reusedId=Number(db.prepare("INSERT INTO users(username,name,password_hash,created_at) VALUES('identity-after','After','unused',?)").run(Date.now()).lastInsertRowid);
  assert.equal(reusedId,previousId);
  db.prepare('INSERT INTO user_roles(user_id,role_id) SELECT ?,role_id FROM user_roles WHERE user_id=?').run(reusedId,caster.id);
  assert.notEqual(operations.getOperatorIdentity(reusedId),before);
  assert.equal(operations.bootstrap(caster).staff.find(s=>s.id===reusedId).integration_actor_id,undefined);
  assert.equal(operations.bootstrap(admin).staff.find(s=>s.id===reusedId).integration_actor_id,operations.getOperatorIdentity(reusedId));
});

test('availability covers the intermediate local date across spring DST and rejects subminute shifts', () => {
  const input={match_id:'match-a',user_id:caster.id,role:'caster',starts_at:'2027-03-27T22:30:00Z',ends_at:'2027-03-28T22:30:00Z'};
  const set=db.prepare("INSERT INTO availability(user_id,date,status,updated_at) VALUES(?,?,'disponible',?)");
  set.run(caster.id,'2027-03-27',Date.now());
  set.run(caster.id,'2027-03-29',Date.now());
  assert.throws(()=>operations.createAssignment(admin,input),{status:409});
  set.run(caster.id,'2027-03-28',Date.now());
  assert.equal(operations.createAssignment(admin,input).status,'pending');
  assert.throws(()=>operations.createAssignment(admin,{...input,ends_at:'2027-03-27T22:30:59Z'}),{status:400});
});

test('certified first-attempt rejection can be discarded and replaced without leaving a blocked resource', () => {
  operations.ingestSnapshot({incidents:[{id:'definitive-rejection',match_id:null,kind:'support',status:'open',title:'Revisión',reason:'Consulta',version:0}]});
  let item=operations.incidentDetail(referee,'definitive-rejection').incident;
  const first=operations.resolveIncident(referee,item.id,{expected_version:item.version,decision:'close',resolution:'Solicitud inicial que CTP rechazará'});
  operations.markCommandSending(first.command.id);
  const rejected=operations.failCommand(first.command.id,{message:'CTP rechazó el formato.',definitive_rejection:true});
  assert.equal(rejected.status,'rejected');
  assert.equal(rejected.result.rejected_confirmed,true);
  assert.throws(()=>operations.markCommandSending(rejected.id),{status:409});
  operations.cancelCommand(referee,rejected.id,{expected_updated_at:rejected.updated_at});
  item=operations.incidentDetail(referee,item.id).incident;
  const second=operations.resolveIncident(referee,item.id,{expected_version:item.version,decision:'close',resolution:'Solicitud corregida para el expediente'});
  assert.notEqual(second.command.id,first.command.id);
});

test('a rejection after an ambiguous attempt never becomes safe to discard', () => {
  operations.ingestSnapshot({incidents:[{id:'ambiguous-rejection',match_id:null,kind:'support',status:'open',title:'Revisión',reason:'Consulta',version:0}]});
  const item=operations.incidentDetail(referee,'ambiguous-rejection').incident;
  const queued=operations.resolveIncident(referee,item.id,{expected_version:item.version,decision:'close',resolution:'Solicitud con respuesta de red incierta'});
  operations.markCommandSending(queued.command.id);
  operations.failCommand(queued.command.id,'Timeout sin confirmación.');
  operations.markCommandSending(queued.command.id);
  const second=operations.failCommand(queued.command.id,{message:'CTP devolvió 422 después del timeout.',definitive_rejection:true});
  assert.equal(second.attempts,2);
  assert.equal(second.status,'failed');
  assert.equal(second.result,null);
  assert.throws(()=>operations.cancelCommand(referee,second.id,{expected_updated_at:second.updated_at}),{status:409});
});
