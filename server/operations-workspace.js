import { createHash, randomUUID } from 'node:crypto';
import { db, tx } from './db.js';
import { CTP_AUTH_ENABLED, HttpError } from './auth.js';
import { getIntegrationStatus } from './operations.js';
import { SECTION_IDS, STAFF_KINDS } from '../shared/access.js';

const can=(user,...sections)=>Boolean(user?.is_admin||sections.some(section=>user?.sections?.includes(section)));
const CLOSED=['resolved','closed','closed_internal','rejected'];
const DONE=['cancelled','cancelado','closed','finished','completed','finalizado','jugado'];
const madridDayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid'});
const VIEWS={overview:null,jornada:'matches',casters:'matches',contenido:'matches',incidencias:'incidents',estadisticas:'stats',clubes:'clubs',discord:'deliveries',disciplina:'sanctions',sanciones:null,turnos:'assignments',decisiones:'commands',integracion:'commands',partido:null,torneos:null,historico:null,arbitraje:null,realizacion:'matches',administration:'commands'};
const KINDS={matches:['match','operaciones','arbitraje','casters','realizacion','comunicaciones'],incidents:['incident','arbitraje'],stats:['stat','arbitraje'],clubs:['club','clubes'],deliveries:['delivery','comunicaciones'],sanctions:['sanction','arbitraje']};
const fields={
  match:['kind','title','status','scheduled_at','team_a','team_b','score_a','score_b','confirmed','winner_id','winner_side','best_of','phase','web_path'],
  incident:['match_id','kind','title','status','source_status','created_at','priority','assignee_id','reporter_id','reporter_name','assigned_name','awaiting_staff','last_message_at','pending_command_id'],
  stat:['match_id','status','revision','created_at','map_number','map_name','mode','objective_label','pending_command_id'],
  club:['name','verified','pass_active','status','pending_command_id'],
  delivery:['status','kind','error','match_id','pending_command_id'],
  sanction:['incident_id','subject_id','subject_type','subject_name','reason','starts_at','ends_at','restriction','scopes','status','appeal_status','appeal_reason','review_reason','revoke_reason','official','pending_command_id'],
};
const col=(key,alias='r')=>`json_extract(${alias}.data,'$.${key}')`;
const incidentAssignee = (alias='r') => `COALESCE(${col('assignee_id',alias)},(SELECT id FROM users WHERE ctp_user_id=${col('assignee_ctp_id',alias)} LIMIT 1))`;
const incidentUnassigned = (alias='r') => `(${incidentAssignee(alias)} IS NULL AND NULLIF(trim(${col('assigned_name',alias)}),'') IS NULL AND NULLIF(${col('assignee_ctp_id',alias)},'') IS NULL)`;
const visible=alias=>`COALESCE(${col('in_feed',alias)},1)=1`;
// Tickets lists only CTP tickets. Match disputes (Ranked, tournament, challenge) and internal match cases stay with their match.
const ticketOnly=(alias='r')=>`${alias}.source='ctp' AND ${col('match_id',alias)} IS NULL`;
const jsonProjection=(kind,alias='r')=>`json_object(${[...fields[kind],'source_version'].map(key=>`'${key}',${kind==='incident'&&key==='assignee_id'?incidentAssignee(alias):col(key,alias)}`).join(',')}${kind==='stat'?`, 'player_count',COALESCE(json_array_length(${alias}.data,'$.players'),0)`:''}) AS data`;
const projection=(kind,alias='r')=>`${alias}.id,${jsonProjection(kind,alias)},${alias}.version,${alias}.source,${alias}.updated_at`;
const unpack=row=>{const value={...JSON.parse(row.data),id:row.id,version:row.version,source:row.source,updated_at:row.updated_at};for(const key of ['confirmed','verified','pass_active','official','awaiting_staff'])if(key in value)value[key]=Boolean(value[key]);if(value.official&&value.status!=='revoked')value.status=Date.parse(value.ends_at)<=Date.now()?'expired':Date.parse(value.starts_at)>Date.now()?'scheduled':'active';return value;};
const marks=items=>items.map(()=>'?').join(',');
const assignmentCols='a.id,a.match_id,a.user_id,a.role,a.starts_at,a.ends_at,a.status,a.version,a.created_by,a.created_at,a.updated_at,u.name user_name,u.username';
const commandCols='c.id,c.idempotency_key,c.action,c.resource_type,c.resource_id,c.actor_id,c.expected_version,c.payload,c.status,c.attempts,c.last_error,c.result,c.created_at,c.updated_at';

db.exec(`CREATE INDEX IF NOT EXISTS operation_records_match_lookup ON operation_records(kind,json_extract(data,'$.match_id'));
 CREATE INDEX IF NOT EXISTS operation_records_feed_page ON operation_records(kind,COALESCE(json_extract(data,'$.in_feed'),1),id);
 CREATE INDEX IF NOT EXISTS operation_assignments_match ON operation_assignments(match_id,starts_at);
 CREATE INDEX IF NOT EXISTS operation_commands_type_status ON operation_commands(resource_type,status,created_at DESC,id);`);
// Keep name search Unicode-aware without materializing whole JSON records in Node.
db.function('ctp_contains',{deterministic:true},(value,query)=>String(value??'').toLocaleLowerCase('es').includes(String(query??'').toLocaleLowerCase('es'))?1:0);
db.function('ctp_madrid_day',{deterministic:true},value=>{const date=new Date(value);return Number.isFinite(date.getTime())?madridDayFormatter.format(date):null;});
db.function('ctp_time',{deterministic:true},value=>{const time=new Date(value).getTime();return Number.isFinite(time)?time:Number.MAX_SAFE_INTEGER;});
const monday=value=>{const day=new Date(`${value}T12:00:00Z`).getUTCDay();return new Date(Date.parse(`${value}T12:00:00Z`)-(day===0?6:day-1)*86400000).toISOString().slice(0,10);};

function parameters(query={}) {
  const view=query.view||'overview';
  if(typeof view!=='string'||!Object.hasOwn(VIEWS,view))throw new HttpError(400,'Vista de operaciones no válida.');
  const integer=(key,fallback,max)=>{const value=query[key]===undefined?fallback:Number(query[key]);if(!Number.isSafeInteger(value)||value<0||value>max)throw new HttpError(400,'Página de operaciones no válida.');return value;};
  const page=integer('page',0,100000),matchPage=integer('match_page',0,100000),limit=integer('limit',30,100);
  if(!limit)throw new HttpError(400,'Tamaño de página no válido.');
  for(const [key,value]of Object.entries(query))if(typeof value!=='string')throw new HttpError(400,'Filtro de operaciones no válido.');
  if((page>0||matchPage>0)&&(!query.revision||!/^[a-f0-9]{64}$/.test(query.revision)))throw new HttpError(400,'Vuelve a la primera página antes de continuar la consulta.');
  if((query.q||'').length>120||['match','case','club','review','resource_type','resource_id'].some(key=>(query[key]||'').length>160))throw new HttpError(400,'Filtro de operaciones demasiado largo.');
  if(query.week&&(!/^\d{4}-\d{2}-\d{2}$/.test(query.week)||!Number.isFinite(Date.parse(`${query.week}T12:00:00Z`))))throw new HttpError(400,'Semana no válida.');
  if(query.role&&!['all','referee','caster','producer'].includes(query.role))throw new HttpError(400,'Función no válida.');
  return {...query,view,page,matchPage,limit,...(view==='turnos'?{week:monday(query.week||madridDayFormatter.format(Date.now()))}:{})};
}
function permittedKinds(user) {
  const result=[];
  if(can(user,'realizacion'))result.push('pro_view');
  for(const [collection,[kind,...sections]]of Object.entries(KINDS))if(can(user,...sections))result.push(kind);
  if(can(user,'arbitraje'))result.push('guard_match','guard_tournament','fixture','case_incident','case_match');
  if(can(user,'operaciones'))result.push('tournament','registration','fixture');
  if(user.is_admin)result.push('ranked_season','club_create','administration','administration_create');
  return [...new Set(result)];
}
function recordPage(kind,where=[],args=[],{page=0,limit=30,order=''}={}) {
  const predicate=`r.kind=? AND ${visible('r')}${where.length?` AND ${where.join(' AND ')}`:''}`;
  const total=db.prepare(`SELECT COUNT(1) total FROM operation_records r WHERE ${predicate}`).get(kind,...args).total;
  const items=db.prepare(`SELECT ${projection(kind)} FROM operation_records r WHERE ${predicate} ORDER BY ${order?`${order},`:''}r.id LIMIT ? OFFSET ?`).all(kind,...args,limit,page*limit).map(unpack);
  return{items,total,page,limit,has_more:(page+1)*limit<total};
}
function search(where,args,query,expressions) {if(query){where.push(`ctp_contains(${expressions.join("||' '||")},?)=1`);args.push(query);}}
function conditions(kind,p,user) {
  const where=[],args=[];
  if(kind==='match') {
    search(where,args,p.q,[`COALESCE(${col('title')},'')`,`COALESCE(${col('team_a.name')},'')`,`COALESCE(${col('team_b.name')},'')`]);
    if(p.view==='contenido')where.push(`${col('confirmed')}=1`);
    if(p.view==='jornada') {
      const scope=p.scope|| (can(user,'operaciones')?'team':'mine');
      if(scope==='mine'){where.push("EXISTS(SELECT 1 FROM operation_assignments a WHERE a.match_id=r.id AND a.user_id=? AND a.status IN('pending','assigned','confirmed'))");args.push(user.id);}
      if((p.period||'upcoming')==='upcoming')where.push(`COALESCE(${col('confirmed')},0)!=1 AND COALESCE(${col('status')},'') NOT IN (${marks(DONE)})`),args.push(...DONE);
      if(p.period==='today'){where.push(`ctp_madrid_day(${col('scheduled_at')})=?`);args.push(madridDayFormatter.format(Date.now()));}
    }
    if(p.view==='turnos'){where.push(`ctp_madrid_day(${col('scheduled_at')})>=? AND ctp_madrid_day(${col('scheduled_at')})<?`);args.push(p.week,new Date(Date.parse(`${p.week}T12:00:00Z`)+7*86400000).toISOString().slice(0,10));if(p.match)where.push('r.id=?'),args.push(p.match);}
    if(p.view==='turnos'&&p.coverage==='missing')where.push("NOT EXISTS(SELECT 1 FROM operation_assignments a WHERE a.match_id=r.id AND a.role='referee' AND a.status='confirmed')");
  }
  if(kind==='incident') {
    const state=p.view==='overview'?'all':p.view==='incidencias'?(p.state||'active'):'active';
    if(state!=='all'){where.push(`${col('status')} ${state==='resolved'?'IN':'NOT IN'} (${marks(CLOSED)})`);args.push(...CLOSED);}
    if(p.view==='incidencias')where.push(ticketOnly());
    if(p.bucket==='mine')where.push(`${incidentAssignee()}=?`),args.push(user.id);
    if(p.bucket==='unassigned')where.push(incidentUnassigned());
    if(p.bucket==='urgent')where.push(`${col('priority')}='urgent'`);
    if(p.view==='jornada')where.push(`(${incidentUnassigned()} OR ${incidentAssignee()}=?)`),args.push(user.id);
    search(where,args,p.q,[`COALESCE(${col('title')},'')`,`COALESCE(${col('reason')},'')`,`COALESCE(${col('reporter_name')},'')`,`COALESCE(${col('reporter_id')},'')`,`COALESCE(${col('reporter_gamertag')},'')`,`COALESCE(${col('reporter_activision_id')},'')`,`COALESCE(${col('assigned_name')},'')`,`r.id`,`COALESCE((SELECT json_extract(m.data,'$.team_a.name')||' '||json_extract(m.data,'$.team_b.name') FROM operation_records m WHERE m.kind='match' AND m.id=${col('match_id')}),'')`,`COALESCE((SELECT name FROM users WHERE id=${col('assignee_id')}),'')`]);
  }
  if(kind==='stat') {
    const state=p.state||(p.view==='overview'?'all':'pending');
    if(state==='pending')where.push(`${col('status')} IN('pending','review','pending_review','submitted')`);
    else if(state!=='all')where.push(`${col('status')}=?`),args.push(state);
    if(p.match)where.push(`${col('match_id')}=?`),args.push(p.match);
    if(p.view==='jornada')where.push(`${col('pending_command_id')} IS NULL`);
  }
  if(kind==='club') {if(p.club)where.push('r.id=?'),args.push(p.club);search(where,args,p.q,[`COALESCE(${col('name')},'')`]);if(p.view==='jornada')where.push(`COALESCE(${col('verified')},0)=0 AND ${col('pending_command_id')} IS NULL`);}
  if(kind==='delivery'&&p.view==='jornada')where.push(`${col('status')} IN('failed','error','dead')`);
  return{where,args};
}
function staffRows(user,p) {
  const kinds=STAFF_KINDS.map(role=>role.id);
  const people=db.prepare(`SELECT id,username,name,is_admin,ctp_user_id,ctp_role FROM users WHERE active=1 AND (is_admin=1 OR ctp_role='admin' OR EXISTS(SELECT 1 FROM user_roles ur JOIN roles ro ON ro.id=ur.role_id WHERE ur.user_id=users.id AND ro.staff_kind IN(${marks(kinds)}))) ORDER BY name,id`).all(...kinds);
  // Two bulk reads replace role + availability reads for each member of staff.
  const roles=db.prepare('SELECT ur.user_id,r.sections,r.staff_kind FROM user_roles ur JOIN roles r ON r.id=ur.role_id').all();
  const rolesByUser=new Map();for(const role of roles){const list=rolesByUser.get(role.user_id)||[];list.push(role);rolesByUser.set(role.user_id,list);}
  const allowed=new Set(STAFF_KINDS.map(role=>role.id));
  const [year,month,day]=(p.week||new Date().toISOString().slice(0,10)).split('-').map(Number);
  const start=new Date(Date.UTC(year,month-1,day-31)).toISOString().slice(0,10),end=new Date(Date.UTC(year,month-1,day+62)).toISOString().slice(0,10);
  const availability=can(user,'operaciones')?db.prepare('SELECT user_id,date,status,note FROM availability WHERE date>=? AND date<=? ORDER BY user_id,date').all(start,end):db.prepare('SELECT user_id,date,status,note FROM availability WHERE user_id=? AND date>=? AND date<=? ORDER BY date').all(user.id,start,end);
  const byUser=new Map();for(const row of availability){const list=byUser.get(row.user_id)||[];list.push({date:row.date,status:row.status,note:row.note});byUser.set(row.user_id,list);}
  let identities=new Map();
  if(user.is_admin&&['integracion','overview'].includes(p.view)&&people.length){
    const missing=db.prepare(`SELECT id FROM users WHERE active=1 AND id IN(${marks(people)}) AND NOT EXISTS(SELECT 1 FROM operation_operator_identities i WHERE i.user_id=users.id)`).all(...people.map(person=>person.id));
    for(let offset=0;offset<missing.length;offset+=100){const batch=missing.slice(offset,offset+100);db.prepare(`INSERT OR IGNORE INTO operation_operator_identities(user_id,external_id,created_at) VALUES ${batch.map(()=>'(?,?,?)').join(',')}`).run(...batch.flatMap(person=>[person.id,randomUUID(),Date.now()]));}
    identities=new Map(db.prepare(`SELECT user_id,external_id FROM operation_operator_identities WHERE user_id IN(${marks(people)})`).all(...people.map(person=>person.id)).map(row=>[row.user_id,row.external_id]));
  }
  return people.map(person=>{const admin=CTP_AUTH_ENABLED?person.ctp_user_id&&person.ctp_role==='admin':person.is_admin;
    const userRoles=(rolesByUser.get(person.id)||[]).filter(role=>allowed.has(role.staff_kind));
    const sections=admin?SECTION_IDS:SECTION_IDS.filter(section=>userRoles.some(role=>JSON.parse(role.sections).includes(section)));
    return{id:person.id,name:person.name||person.username,username:person.ctp_user_id?person.name:person.username,is_admin:Boolean(admin),sections,availability:byUser.get(person.id)||[],...(identities.has(person.id)?{integration_actor_id:identities.get(person.id)}:{})};
  }).filter(person=>person.is_admin||person.sections.length);
}
function commandPage(user,p,focusedId) {
  const kinds=permittedKinds(user),where=[`c.resource_type IN(${marks(kinds)})`],args=[...kinds];
  if(p.view==='administration')where.push("c.action LIKE 'admin.%'");
  if(p.resource_type){if(!kinds.includes(p.resource_type))throw new HttpError(403,'No tienes permiso para estas solicitudes.');where.push('c.resource_type=?');args.push(p.resource_type);}
  if(focusedId)where.push('c.resource_id=?'),args.push(focusedId);
  if(!['1','true'].includes(p.include_closed)&&p.view!=='overview'&&!focusedId)where.push("c.status NOT IN('acknowledged','cancelled')");
  const predicate=where.join(' AND ');
  const total=db.prepare(`SELECT COUNT(1) total FROM operation_commands c WHERE ${predicate}`).get(...args).total;
  const page=VIEWS[p.view]==='commands'?p.page:0,limit=VIEWS[p.view]==='commands'?p.limit:30;
  const items=db.prepare(`SELECT ${commandCols},r.source source_record,json_extract(r.data,'$.in_feed') in_feed,json_extract(r.data,'$.queried_at') queried_at,json_extract(r.data,'$.source_version') source_version_current,u.name actor_name FROM operation_commands c LEFT JOIN operation_records r ON r.kind=c.resource_type AND r.id=c.resource_id LEFT JOIN users u ON u.id=c.actor_id WHERE ${predicate} ORDER BY c.created_at DESC,c.id LIMIT ? OFFSET ?`).all(...args,limit,page*limit).map(row=>{
    const{source_record,in_feed,queried_at,payload,result,...safe}=row;return{...safe,type:row.action,target_id:row.resource_id,payload:JSON.parse(payload),result:result?JSON.parse(result):null,source_available:Boolean(source_record&&(in_feed!==0||(row.resource_type==='stat'&&queried_at)))};
  });return{items,total,page,limit,has_more:(page+1)*limit<total};
}

export function operationsWorkspace(user,query={}) {
  if(!user?.id)throw new HttpError(401,'Necesitas iniciar sesión.');
  if(!can(user,'operaciones','arbitraje','casters','realizacion','clubes','comunicaciones'))throw new HttpError(403,'No tienes permiso para esta operación.');
  const p=parameters(query),primary=VIEWS[p.view];
  if(['administration','integracion'].includes(p.view)&&!user.is_admin)throw new HttpError(403,'Solo administración puede acceder a esta vista.');
  return tx(()=>{
    const revision=createHash('sha256').update(JSON.stringify([
      db.prepare('SELECT COUNT(1) n,COALESCE(SUM(version),0) v FROM operation_records').get(),
      db.prepare('SELECT COUNT(1) n,COALESCE(SUM(version),0) v FROM operation_assignments').get(),
      db.prepare('SELECT COUNT(1) n,CAST(COALESCE(SUM(updated_at),0) AS TEXT) v FROM operation_commands').get(),
    ])).digest('hex');
    if((p.page>0||p.matchPage>0)&&p.revision&&p.revision!==revision)throw new HttpError(409,'Los datos han cambiado durante la consulta. Vuelve a la primera página para continuar.');
    const data={matches:[],context_matches:[],incidents:[],assignments:[],staff:[],stats:[],clubs:[],deliveries:[],sanctions:[],production:[],audit:[],commands:[],rundowns:[],connection:getIntegrationStatus(),pages:{},view:p.view};
    const include=new Set([primary]);
    if(p.view==='overview')for(const key of Object.keys(KINDS))include.add(key);
    if(p.view==='jornada')for(const key of ['incidents','stats','clubs','deliveries'])include.add(key);
    if(p.view==='disciplina')include.add('incidents');
    if(['turnos','partido','realizacion','estadisticas','incidencias'].includes(p.view))include.add('matches');
    if(p.view==='estadisticas'&&p.match)include.delete('stats'); // Official per-match revisions use the existing detail query.
    for(const [collection,[kind,...sections]]of Object.entries(KINDS))if(include.has(collection)&&can(user,...sections)) {
      const filters=conditions(kind,p,user);
      const order=kind==='match'?`COALESCE(${col('scheduled_at')},'9999')`:kind==='incident'?`${p.order==='priority'||!p.order?`CASE WHEN ${col('priority')}='urgent' THEN 0 ELSE 1 END,`:''}ctp_time(${col('created_at')}) ${p.order==='newest'?'DESC':'ASC'}`:'';
      const page=recordPage(kind,filters.where,filters.args,{page:collection===primary?p.page:p.view==='turnos'&&collection==='matches'?p.matchPage:0,limit:collection===primary?p.limit:30,order});
      data[collection]=page.items;data.pages[collection]={...page,items:undefined};
      if(p.view==='turnos'&&collection==='matches')data.match_page_ids=page.items.map(item=>item.id);
    }
    if(can(user,'operaciones','arbitraje','casters','realizacion')&&['overview','jornada','turnos','partido','realizacion','incidencias','integracion','decisiones','torneos','administration'].includes(p.view))data.staff=staffRows(user,p);
    if(can(user,'operaciones','arbitraje','casters','realizacion')&&['jornada','turnos','partido','realizacion','casters'].includes(p.view)) {
      const where=[],args=[];
      if(p.view==='turnos'){
        const start=p.week;
        const end=new Date(Date.parse(`${start}T12:00:00Z`)+7*86400000).toISOString().slice(0,10);
        where.push('ctp_madrid_day(a.starts_at)<? AND ctp_madrid_day(a.ends_at)>=?');args.push(end,start);
        if(p.closed!=='1')where.push("a.status IN('pending','assigned','confirmed')");
      }else{where.push("a.status IN('pending','assigned','confirmed') AND a.ends_at>?");args.push(new Date().toISOString());}
      if(p.match)where.push('a.match_id=?'),args.push(p.match);
      if(p.person&&p.person!=='all'){const person=p.person==='me'?user.id:Number(p.person);if(!Number.isSafeInteger(person)||person<1)throw new HttpError(400,'Persona no válida.');where.push('a.user_id=?');args.push(person);}
      if(p.role&&p.role!=='all')where.push('a.role=?'),args.push(p.role);
      const predicate=where.length?`WHERE ${where.join(' AND ')}`:'';
      const total=db.prepare(`SELECT COUNT(1) total FROM operation_assignments a ${predicate}`).get(...args).total;
      const page=primary==='assignments'?p.page:0,limit=primary==='assignments'?p.limit:100;
      data.assignments=db.prepare(`SELECT ${assignmentCols} FROM operation_assignments a JOIN users u ON u.id=a.user_id ${predicate} ORDER BY a.starts_at,a.id LIMIT ? OFFSET ?`).all(...args,limit,page*limit);
      data.pages.assignments={total,page,limit,has_more:(page+1)*limit<total};
    }
    const focused=p.resource_id||p.review||p.case||p.club||p.match;
    if(['overview','torneos','incidencias','estadisticas','disciplina','clubes','decisiones','integracion','administration'].includes(p.view)||p.view==='partido'&&focused){const commands=commandPage(user,p,focused);data.commands=commands.items;data.pages.commands={...commands,items:undefined};}
    const matchIds=[...new Set([p.match,...data.incidents.map(item=>item.match_id),...data.stats.map(item=>item.match_id),...data.deliveries.map(item=>item.match_id),...data.assignments.map(item=>item.match_id)].filter(Boolean))];
    if(can(user,'operaciones','arbitraje','casters','realizacion','comunicaciones')&&matchIds.length){const existing=new Set(data.matches.map(item=>item.id));const related=db.prepare(`SELECT ${projection('match')} FROM operation_records r WHERE r.kind='match' AND ${visible('r')} AND r.id IN(${marks(matchIds)})`).all(...matchIds).map(unpack).filter(item=>!existing.has(item.id));if(primary==='matches')data.context_matches=related;else data.matches.push(...related);}
    if(can(user,'operaciones','casters','realizacion')&&['jornada','turnos','realizacion','partido'].includes(p.view)&&data.matches.length){const ids=data.matches.map(item=>item.id);data.production=db.prepare(`SELECT match_id,rundown_id,state,scene,note,version,updated_by,updated_at FROM operation_production WHERE match_id IN(${marks(ids)})`).all(...ids);}
    if(can(user,'operaciones','arbitraje','casters','realizacion')&&data.matches.length){const ids=data.matches.map(item=>item.id);data.coverage={};for(const row of db.prepare(`SELECT match_id,role,COUNT(1) assigned,SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END) confirmed FROM operation_assignments WHERE match_id IN(${marks(ids)}) AND status IN('pending','assigned','confirmed') GROUP BY match_id,role`).all(...ids)){data.coverage[row.match_id]||={};data.coverage[row.match_id][row.role]={assigned:row.assigned,confirmed:row.confirmed};}}
    if(can(user,'arbitraje')&&p.view==='incidencias')data.incident_counts=db.prepare(`SELECT COUNT(1) all_open,COALESCE(SUM(CASE WHEN ${incidentAssignee()}=? THEN 1 ELSE 0 END),0) mine,COALESCE(SUM(CASE WHEN ${incidentUnassigned()} THEN 1 ELSE 0 END),0) unassigned,COALESCE(SUM(CASE WHEN ${col('priority')}='urgent' THEN 1 ELSE 0 END),0) urgent FROM operation_records r WHERE r.kind='incident' AND ${visible('r')} AND ${ticketOnly()} AND ${col('status')} NOT IN(${marks(CLOSED)})`).get(user.id,...CLOSED);
    if(p.view==='jornada'){
      data.summary={};
      if(can(user,'operaciones'))data.summary.uncovered_matches=db.prepare(`SELECT COUNT(1) total FROM operation_records r WHERE r.kind='match' AND ${visible('r')} AND COALESCE(${col('confirmed')},0)=0 AND COALESCE(${col('status')},'') NOT IN(${marks(DONE)}) AND NOT EXISTS(SELECT 1 FROM operation_assignments a WHERE a.match_id=r.id AND a.role='referee' AND a.status='confirmed')`).get(...DONE).total;
      if(can(user,'operaciones','arbitraje','casters','realizacion'))data.summary.pending_assignments=db.prepare("SELECT COUNT(1) total FROM operation_assignments WHERE user_id=? AND status IN('pending','assigned') AND ends_at>?").get(user.id,new Date().toISOString()).total;
    }
    if(can(user,'realizacion','casters')&&p.view==='realizacion')data.rundowns=db.prepare('SELECT id,title,date,time FROM rundowns ORDER BY date DESC,id DESC LIMIT 100').all();
    // Activity is a small explicit timeline, never a whole-table browser filter.
    if(can(user,'operaciones')&&p.view==='jornada')data.audit=db.prepare('SELECT a.id,a.resource_type,a.resource_id,a.action,a.actor_id,a.created_at,u.name actor_name FROM operation_audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 20').all();
    data.primary=primary;data.revision=revision;return data;
  });
}
