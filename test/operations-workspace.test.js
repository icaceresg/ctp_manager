import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-workspace-'));
process.env.DATA_DIR=folder;process.env.DB_PATH=path.join(folder,'workspace.db');
const {db}=await import('../server/db.js');
const {ingestSnapshot,bootstrap,matchDossier,statisticsDetail,createIncident}=await import('../server/operations.js');
const {operationsWorkspace}=await import('../server/operations-workspace.js');
const {describeUser}=await import('../server/auth.js');
const adminId=Number(db.prepare("INSERT INTO users(username,name,password_hash,is_admin,created_at) VALUES('workspace-admin','Admin','not-a-login',1,?)").run(Date.now()).lastInsertRowid);
const admin=describeUser(db.prepare('SELECT id,username,name,is_admin FROM users WHERE id=?').get(adminId));
const caster={id:adminId,is_admin:false,sections:['casters']};
const referee={id:adminId,is_admin:false,sections:['arbitraje']};
const players=Array.from({length:8},(_,index)=>({id:`player-${index}`,username:`Player ${index}`,side:index<4?'a':'b',kills:21,deaths:10,assists:3,score:3000}));
const matches=Array.from({length:1007},(_,index)=>({id:`match-${String(index).padStart(4,'0')}`,kind:'tournament',title:index===1006?'Águilas Únicas':'Circuito CTP',status:'scheduled',scheduled_at:'2026-10-19T18:00:00Z',version:1,team_a:{id:'a',name:'Alpha'},team_b:{id:'b',name:'Beta'},roster:players,maps:[{name:'Map one',mode:'Hardpoint'}],statistics:[{id:`approved-${index}`,status:'approved',players}]}));
// Tickets from CTP have no match; one tournament dispute stays linked to its match.
const incidents=Array.from({length:1007},(_,index)=>({id:`case-${String(index).padStart(4,'0')}`,match_id:null,kind:'support',title:index===1006?'Búsqueda única':'Revisión del resultado',reason:'Long private investigation context '.repeat(100),status:index%2?'resolved':'open',priority:index%5===0?'urgent':'normal',created_at:Date.now()-index*1000,version:1}));
const stats=matches.map((match,index)=>({id:`stats-${String(index).padStart(4,'0')}`,match_id:match.id,status:index%2?'approved':'pending',players,version:1,map_name:'Hardpoint'}));
incidents.push({id:'dispute-1006',match_id:matches[1006].id,kind:'tournament',title:'Disputa del resultado',reason:'Resultado en disputa',status:'open',priority:'urgent',created_at:Date.now(),version:1});
ingestSnapshot({matches,incidents,stats,clubs:[],deliveries:[]});
after(()=>{db.close();assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(folder,{recursive:true,force:true,maxRetries:5});});
const measured=fn=>{const prepare=db.prepare;let calls=0;db.prepare=function(...args){calls++;return prepare.apply(this,args);};const start=performance.now();try{const value=fn();return{value,calls,ms:performance.now()-start,bytes:Buffer.byteLength(JSON.stringify(value))};}finally{db.prepare=prepare;}};

test('a 1007-match workspace is paginated in SQL and list DTOs omit players, maps, notes and other collections',()=>{
  const old=measured(()=>bootstrap(admin));
  const optimized=measured(()=>operationsWorkspace(admin,{view:'casters',limit:'30'}));
  assert.equal(optimized.value.matches.length,30);assert.equal(optimized.value.pages.matches.total,1007);
  assert.deepEqual(optimized.value.stats,[]);assert.deepEqual(optimized.value.incidents,[]);assert.deepEqual(optimized.value.staff,[]);
  for(const match of optimized.value.matches){assert.equal(match.roster,undefined);assert.equal(match.statistics,undefined);assert.equal(match.maps,undefined);}
  assert.ok(optimized.bytes<old.bytes/20,`${optimized.bytes} vs ${old.bytes}`);
  assert.ok(optimized.calls<15,`Bounded number of SQLite reads: ${optimized.calls}`);
  console.log(JSON.stringify({metric:'manager_1007_matches',beforeBytes:old.bytes,afterBytes:optimized.bytes,beforeQueries:old.calls,afterQueries:optimized.calls,beforeMs:Math.round(old.ms),afterMs:Math.round(optimized.ms)}));
});

test('search and status filters run before pagination and Unicode names remain searchable',()=>{
  const matches=operationsWorkspace(caster,{view:'casters',q:'águilas únicas',limit:'5'});
  assert.deepEqual(matches.matches.map(row=>row.id),['match-1006']);assert.equal(matches.pages.matches.total,1);
  const cases=operationsWorkspace(referee,{view:'incidencias',q:'búsqueda única',state:'active',limit:'5'});
  assert.deepEqual(cases.incidents.map(row=>row.id),['case-1006']);assert.equal(cases.pages.incidents.total,1);
  assert.equal(cases.incidents[0].reason,undefined);assert.equal(cases.incident_counts.all_open,504);
  const reviewed=operationsWorkspace(referee,{view:'estadisticas',state:'approved',limit:'5'});
  assert.equal(reviewed.pages.stats.total,503);assert.ok(reviewed.stats.every(row=>row.status==='approved'&&row.player_count===8&&!row.players));
});

test('all 1007 records remain reachable with a stable revision and invalid input never becomes unlimited SQL',()=>{
  const ids=[],first=operationsWorkspace(caster,{view:'casters',limit:'100'});
  for(let page=0;page<11;page++){
    const result=operationsWorkspace(caster,{view:'casters',limit:'100',page:String(page),revision:first.revision});
    ids.push(...result.matches.map(row=>row.id));assert.ok(result.matches.length<=100);
  }
  assert.equal(ids.length,1007);assert.equal(new Set(ids).size,1007);
  for(const query of [{limit:'0'},{limit:'1001'},{page:'-1'},{page:'1.2'},{page:'1'},{q:'x'.repeat(121)},{view:'unknown'},{limit:['10','1000']}])assert.throws(()=>operationsWorkspace(admin,query),{status:400});
  assert.throws(()=>operationsWorkspace({id:adminId,sections:[]},{view:'casters'}),{status:403});
  assert.deepEqual(operationsWorkspace(caster,{view:'estadisticas'}).stats,[]);
});

test('concurrent changes invalidate a subsequent page without overwriting commands or source versions',()=>{
  const before=operationsWorkspace(caster,{view:'casters',limit:'10'});
  ingestSnapshot({matches:[{...matches[0],version:2,title:'New official source revision'}]});
  assert.throws(()=>operationsWorkspace(caster,{view:'casters',limit:'10',page:'1',revision:before.revision}),{status:409});
  const fresh=operationsWorkspace(caster,{view:'casters',limit:'10'});
  assert.equal(fresh.matches[0].source_version,2);assert.notEqual(fresh.revision,before.revision);
});

test('details keep all eight statistics rows and query only the requested match',()=>{
  const result=measured(()=>matchDossier(referee,matches[1006].id));
  assert.equal(result.value.match.roster.length,8);assert.equal(result.value.incidents.length,1);
  assert.ok(result.value.statistics.every(row=>row.match_id===matches[1006].id));
  assert.equal(statisticsDetail(referee,'stats-1006').statistic.players.length,8);
  assert.ok(result.calls<12,`Dossier read count is independent of total match count: ${result.calls}`);
  assert.ok(db.prepare("EXPLAIN QUERY PLAN SELECT id,data,version,source,updated_at FROM operation_records WHERE kind='stat' AND json_extract(data,'$.match_id')=?").all(matches[1006].id).some(row=>row.detail.includes('operation_records_match_lookup')));
});

test('an unchanged thousand-record sync reuses bounded reads rather than querying each row',()=>{
  const result=measured(()=>ingestSnapshot({matches:matches.slice(1)}));
  assert.equal(result.value.changed,0);assert.equal(result.value.received,1006);
  assert.ok(result.calls<=3,`Expected 3 batches for 1006 records, got ${result.calls}`);
});

test('old pending commands remain visible despite a thousand newer acknowledgements, with current source metadata',()=>{
  const insert=db.prepare("INSERT INTO operation_commands(id,idempotency_key,action,resource_type,resource_id,actor_id,expected_version,payload,status,created_at,updated_at) VALUES(?,?,'match.resolve','match',?,?,?,? ,?,?,?)");
  db.exec('BEGIN');try{
    for(let index=0;index<1001;index++)insert.run(`command-${index}`,`key-${index}`,matches[0].id,adminId,2,JSON.stringify({reason:'Validated source record'}),index===0?'pending':'acknowledged',Date.now()+index,Date.now()+index);
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  const result=measured(()=>operationsWorkspace(admin,{view:'decisiones'}));
  assert.equal(result.value.pages.commands.total,1);assert.equal(result.value.commands[0].id,'command-0');
  assert.equal(result.value.commands[0].expected_version,2);assert.equal(result.value.commands[0].source_version_current,2);assert.equal(result.value.commands[0].source_available,true);
  assert.equal(db.prepare("SELECT status,attempts FROM operation_commands WHERE id='command-0'").get().attempts,0);
  const historical=operationsWorkspace(admin,{view:'decisiones',include_closed:'1'});
  assert.equal(historical.pages.commands.total,1001);assert.equal(historical.commands.length,30);assert.ok(historical.pages.commands.has_more);
  assert.deepEqual(operationsWorkspace(caster,{view:'decisiones',resource_type:'match',resource_id:matches[0].id}).commands.map(row=>row.id),historical.commands.map(row=>row.id));
  assert.throws(()=>operationsWorkspace(caster,{view:'decisiones',resource_type:'stat'}),{status:403});
});

test('weekly matches and assignments have independent pages and coverage counts include assignments outside either page',()=>{
  const insert=db.prepare("INSERT INTO operation_assignments(id,match_id,user_id,role,starts_at,ends_at,status,created_by,created_at,updated_at) VALUES(?,?,?,'referee','2026-10-19T17:00:00Z','2026-10-19T21:00:00Z',?,?,?,?)");
  db.exec('BEGIN');try{for(let index=0;index<1007;index++)insert.run(`assignment-${index}`,matches[index].id,adminId,index%2?'confirmed':'pending',adminId,Date.now(),Date.now());db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  const first=operationsWorkspace(admin,{view:'turnos',week:'2026-10-19'});
  assert.equal(first.pages.assignments.total,1007);assert.equal(first.assignments.length,30);assert.equal(first.pages.matches.total,1007);
  const second=operationsWorkspace(admin,{view:'turnos',week:'2026-10-19',match_page:'1',revision:first.revision});
  assert.equal(second.pages.assignments.page,0);assert.equal(second.pages.matches.page,1);assert.equal(second.match_page_ids.length,30);
  assert.equal(second.coverage['match-0031'].referee.confirmed,1);
  const missing=operationsWorkspace(admin,{view:'turnos',week:'2026-10-19',coverage:'missing'});
  assert.equal(missing.pages.matches.total,504);assert.ok(missing.match_page_ids.every(id=>missing.coverage[id].referee.confirmed===0));
  const closed=operationsWorkspace(admin,{view:'turnos',week:'2026-10-26'});assert.equal(closed.pages.assignments.total,0);assert.equal(closed.pages.matches.total,0);
});

test('Tickets lists only CTP tickets; match disputes and internal match cases stay with their match',()=>{
  ingestSnapshot({incidents:[{id:'ranked-dispute',match_id:'lobby-0001',kind:'ranked',title:'Disputa ranked',reason:'El otro equipo no se presentó',status:'abierto',created_at:Date.now(),version:1}]});
  const internal=createIncident(referee,{match_id:matches[0].id,title:'Expediente interno',reason:'Revisar conexión',priority:'normal'});
  const tickets=operationsWorkspace(referee,{view:'incidencias',state:'all',limit:'100'});
  assert.equal(tickets.pages.incidents.total,1007);
  assert.ok(tickets.incidents.every(row=>row.source==='ctp'&&!row.match_id));
  assert.equal(tickets.incident_counts.all_open,504,'open disputes and internal cases are not counted as tickets');
  for(const id of ['ranked-dispute','dispute-1006',internal.id])assert.equal(operationsWorkspace(referee,{view:'incidencias',state:'all',q:id}).pages.incidents.total,0,id);
  // Inicio still surfaces them, so an open dispute is never lost.
  assert.deepEqual(operationsWorkspace(referee,{view:'jornada',q:'ranked-dispute'}).incidents.map(row=>row.id),['ranked-dispute']);
  assert.equal(matchDossier(referee,matches[0].id).incidents.some(row=>row.id===internal.id),true);
});
