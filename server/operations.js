import { randomUUID } from 'node:crypto';
import { db, tx } from './db.js';
import { describeUser, HttpError } from './auth.js';
import { competitionPayload, COMPETITION_ACTIONS, correctionPayload } from './competition-contract.js';
import { isStaffUser } from '../shared/access.js';
import { GUARD_ACTIONS, guardPayload } from './guard-contract.js';
import { rankedPayload } from './ranked-contract.js';
import { manualClubPayload } from './manual-club-contract.js';
import { date as calendarDate } from './validate.js';
import { ADMIN_ACTIONS, ADMIN_CREATE_ACTIONS, administrationPayload } from './administration-contract.js';
import { CASE_ACTIONS,CASE_RESOURCE_TYPES,casePayload } from './case-contract.js';
import { PRO_VIEW_ACTION, PRO_VIEW_RESOURCE_ID, validateProViewProposal } from './pro-view-contract.js';

export const OPERATION_SECTIONS = ['operaciones', 'arbitraje', 'casters', 'realizacion', 'clubes', 'comunicaciones'];
const READ_MATCH = ['operaciones', 'arbitraje', 'casters', 'realizacion', 'comunicaciones'];
const now = () => Date.now();
const json = (value) => JSON.stringify(value);
const parse = (value, fallback = null) => { try { return JSON.parse(value); } catch { return fallback; } };
const can = (user, ...sections) => Boolean(user?.is_admin || sections.some((s) => user?.sections?.includes(s)));
function requireSection(user, ...sections) { if (!user?.id) throw new HttpError(401, 'Necesitas iniciar sesión.'); if (!can(user, ...sections)) throw new HttpError(403, 'No tienes permiso para esta operación.'); }
function text(value, label, max = 4000, optional = false) { if (optional && (value == null || value === '')) return ''; if (typeof value !== 'string' || !value.trim() || value.length > max) throw new HttpError(400, `${label} no válido.`); return value.trim(); }
function id(value) { return text(value, 'Identificador', 160); }
function choice(value, values, label) { if (!values.includes(value)) throw new HttpError(400, `${label} no válido.`); return value; }
function dateTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d/.test(value) || !Number.isFinite(Date.parse(value))) throw new HttpError(400, 'Fecha y hora no válidas.');
  calendarDate(value.slice(0,10));
  return new Date(value).toISOString();
}
function version(value, actual) { if (!Number.isInteger(value) || value < 0) throw new HttpError(400, 'Debes indicar expected_version.'); if (value !== actual) throw new HttpError(409, 'Otra persona ha actualizado este registro. Recarga antes de guardar.'); }
function safePath(value) { return typeof value === 'string' && /^\/(?!\/)[A-Za-z0-9/_?=&%.-]*$/.test(value) ? value : null; }
function numeric(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function label(value, max = 500) { return typeof value === 'string' ? value.slice(0, max) : ''; }
function validatedScopes(value,restriction) {
  if(!Array.isArray(value)||value.length>3||new Set(value).size!==value.length||value.some(scope=>!['tournament_registration','challenges','ranked'].includes(scope)))throw new HttpError(400,'Ámbitos de sanción no válidos.');
  if(restriction==='warning'&&value.length)throw new HttpError(400,'Una amonestación no puede bloquear accesos.');
  if(restriction==='competition_suspend'&&!value.length)throw new HttpError(400,'Selecciona expresamente al menos un ámbito de suspensión.');
  return value;
}
function sanctionReason(value,labelText='Motivo') {const reason=text(value,labelText,2000);if(reason.length<12)throw new HttpError(400,`${labelText}: explica al menos 12 caracteres.`);return reason;}
function effectiveSanction(item) {
  if(!item.official||item.status==='revoked')return item;
  return {...item,status:Date.parse(item.ends_at)<=now()?'expired':Date.parse(item.starts_at)>now()?'scheduled':'active'};
}

db.exec(`
 CREATE TABLE IF NOT EXISTS operation_operator_identities (
   user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
   external_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
 );
 CREATE TABLE IF NOT EXISTS operation_records (
   kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
   source TEXT NOT NULL DEFAULT 'ctp', updated_at INTEGER NOT NULL, PRIMARY KEY(kind,id)
 );
 CREATE TABLE IF NOT EXISTS operation_notes (
   id TEXT PRIMARY KEY, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL,
   text TEXT NOT NULL, visibility TEXT NOT NULL, actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
   delivery_status TEXT NOT NULL DEFAULT 'local', created_at INTEGER NOT NULL
 );
 CREATE INDEX IF NOT EXISTS operation_notes_resource ON operation_notes(resource_type,resource_id,created_at);
 CREATE TABLE IF NOT EXISTS operation_assignments (
   id TEXT PRIMARY KEY, match_id TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id), role TEXT NOT NULL,
   starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
   version INTEGER NOT NULL DEFAULT 1, created_by INTEGER REFERENCES users(id), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
 );
 CREATE INDEX IF NOT EXISTS operation_assignments_overlap ON operation_assignments(user_id,starts_at,ends_at);
 CREATE TABLE IF NOT EXISTS operation_production (
   match_id TEXT PRIMARY KEY, rundown_id INTEGER REFERENCES rundowns(id) ON DELETE SET NULL,
   state TEXT NOT NULL DEFAULT 'preparation', scene TEXT NOT NULL DEFAULT 'preview', note TEXT NOT NULL DEFAULT '',
   version INTEGER NOT NULL DEFAULT 1, updated_by INTEGER REFERENCES users(id), updated_at INTEGER NOT NULL
 );
 CREATE TABLE IF NOT EXISTS operation_commands (
   id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, action TEXT NOT NULL, resource_type TEXT NOT NULL,
   resource_id TEXT NOT NULL, actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL, expected_version INTEGER,
   payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
   last_error TEXT, result TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
 );
 CREATE INDEX IF NOT EXISTS operation_commands_pending ON operation_commands(status,created_at);
 CREATE TABLE IF NOT EXISTS operation_audit (
   id INTEGER PRIMARY KEY, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, action TEXT NOT NULL,
   actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL, details TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
 );
 CREATE INDEX IF NOT EXISTS operation_audit_resource ON operation_audit(resource_type,resource_id,created_at);
`);

export function getOperatorIdentity(userId) {
  if(!Number.isInteger(userId)||!db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(userId))throw new HttpError(403,'El operador ya no tiene acceso.');
  db.prepare('INSERT OR IGNORE INTO operation_operator_identities(user_id,external_id,created_at) VALUES(?,?,?)').run(userId,randomUUID(),now());
  return db.prepare('SELECT external_id FROM operation_operator_identities WHERE user_id=?').get(userId).external_id;
}

function unpack(row) { return row ? { ...parse(row.data, {}), id: row.id, source: row.source, version: row.version, updated_at: row.updated_at } : null; }
function record(kind, key, includeRetired = false) { const item = unpack(db.prepare('SELECT * FROM operation_records WHERE kind=? AND id=?').get(kind, id(key))); if (!item || (!includeRetired&&item.in_feed===false)) throw new HttpError(404, 'Registro no encontrado.'); return item; }
function rows(kind, matchId) { return db.prepare(`SELECT id,data,version,source,updated_at FROM operation_records WHERE kind=? AND COALESCE(json_extract(data,'$.in_feed'),1)!=0 ${matchId===undefined?'':"AND json_extract(data,'$.match_id')=?"} ORDER BY updated_at DESC,id`).all(...(matchId===undefined?[kind]:[kind,matchId])).map(unpack); }
function save(kind, item, source = item.source || 'manager') { const old = db.prepare('SELECT version FROM operation_records WHERE kind=? AND id=?').get(kind, item.id); const data = { ...item }; delete data.version; delete data.source; delete data.updated_at; db.prepare(`INSERT INTO operation_records(kind,id,data,version,source,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data,version=excluded.version,source=excluded.source,updated_at=excluded.updated_at`).run(kind, item.id, json(data), (old?.version || 0) + 1, source, now()); return record(kind, item.id, true); }
function audit(kind, key, action, actor, details = {}) { db.prepare('INSERT INTO operation_audit(resource_type,resource_id,action,actor_id,details,created_at) VALUES(?,?,?,?,?,?)').run(kind, key, action, actor?.id || null, json(details), now()); }
function history(kind, key) { return db.prepare(`SELECT a.*,u.name actor_name,u.username actor_username FROM operation_audit a LEFT JOIN users u ON u.id=a.actor_id WHERE a.resource_type=? AND a.resource_id=? ORDER BY a.id DESC LIMIT 100`).all(kind, key).map((a) => ({ ...a, details: parse(a.details, {}) })); }
function notes(kind, key, internal = false) { return db.prepare(`SELECT n.*,u.name actor_name,u.username actor_username FROM operation_notes n LEFT JOIN users u ON u.id=n.actor_id WHERE resource_type=? AND resource_id=? ORDER BY n.created_at,n.id`).all(kind, key).filter((n) => internal || (n.visibility !== 'internal' && (n.visibility !== 'participants' || n.delivery_status === 'delivered'))); }
function statisticsWithRoster(item, knownMatch) {
  if(typeof knownMatch!=='object')knownMatch=undefined;
  const match=knownMatch===undefined?unpack(db.prepare("SELECT id,data,version,source,updated_at FROM operation_records WHERE kind='match' AND id=?").get(item.match_id)):knownMatch;
  const players=new Map((match?.in_feed!==false?match?.roster||[]:[]).map(player=>[player.id,player]));
  return {...item,players:item.players.map(player=>{
    const roster=players.get(player.id);
    return {...player,username:player.username||roster?.username||'',gamertag:player.gamertag||roster?.gamertag||'',avatar:player.avatar||roster?.avatar||null};
  })};
}
function commandView(row) { return row ? { ...row, type: row.action, target_id: row.resource_id, payload: parse(row.payload, {}), result: parse(row.result) } : null; }
function queue(action, kind, item, payload, actor) {
  const existing = db.prepare(`SELECT * FROM operation_commands WHERE resource_type=? AND resource_id=? AND status IN ('pending','sending','failed','rejected') ORDER BY created_at DESC LIMIT 1`).get(kind, item.id);
  if (existing) {
    if (existing.action===action&&existing.payload === json(payload) && existing.actor_id === actor.id) return commandView(existing);
    throw new HttpError(409, 'Ya hay una solicitud pendiente para este registro. Revisa su estado antes de repetirla.');
  }
  const key = randomUUID();
  db.prepare(`INSERT INTO operation_commands(id,idempotency_key,action,resource_type,resource_id,actor_id,expected_version,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(key,key,action,kind,item.id,actor.id,Number.isInteger(item.source_version) ? item.source_version : item.version,json(payload),now(),now());
  audit(kind,item.id,`${action}.requested`,actor,{command_id:key});
  return commandView(db.prepare('SELECT * FROM operation_commands WHERE id=?').get(key));
}

function normalizePlayer(p) { return { id: label(p.id || p.player_id || p.user_id,160), username: label(p.username,100), gamertag: label(p.gamertag,100), team_id: label(p.team_id,160), team: label(p.team,100), side: label(p.side,20), kills: numeric(p.kills), deaths: numeric(p.deaths), assists: numeric(p.assists), score: numeric(p.score), objective: numeric(p.objective), objective_unit: label(p.objective_unit,30), avatar:typeof p.avatar==='string'&&/^https?:\/\//.test(p.avatar)?p.avatar.slice(0,2000):null }; }
function normalizeTeam(t) { if (typeof t === 'string') return t.slice(0,160); if (!t || typeof t !== 'object') return null; return { id: label(t.id,160), name: label(t.name,160), tag: label(t.tag,30), logo: typeof t.logo === 'string' && /^https?:\/\//.test(t.logo) ? t.logo.slice(0,2000) : null }; }
function normalize(kind, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Registro CTP no válido.');
  const base = {id:id(input.id),source_version:Number.isInteger(input.version) ? input.version : Number.isInteger(input.source_version) ? input.source_version : null,in_feed:true};
  if (kind === 'match') return {
    ...base,
    kind:choice(input.kind || 'tournament',['tournament','challenge','ranked','reto','8s'],'Tipo de partido'),
    title:label(input.title,300),status:label(input.status,80),
    scheduled_at:input.scheduled_at ? dateTime(input.scheduled_at) : null,
    team_a:normalizeTeam(input.team_a),team_b:normalizeTeam(input.team_b),
    score_a:numeric(input.score_a),score_b:numeric(input.score_b),confirmed:input.confirmed===true,
    winner_id:label(input.winner_id,160),winner_side:['a','b'].includes(input.winner_side)?input.winner_side:null,
    best_of:numeric(input.best_of),phase:label(input.phase,100),web_path:safePath(input.web_path),
    roster:Array.isArray(input.roster)?input.roster.slice(0,100).map(normalizePlayer):[],
    statistics:Array.isArray(input.statistics)?input.statistics.filter(s=>s.status==='approved').slice(0,100).map((s)=>normalize('stat',{...s,match_id:base.id,id:s.id||`${base.id}:${s.map_name||'summary'}`})):[],
    maps:Array.isArray(input.maps)?input.maps.slice(0,30).map((m)=>typeof m==='string'?m.slice(0,100):{
      name:label(m.name||m.map_name,100),map_name:label(m.map_name||m.name,100),map_number:numeric(m.map_number),
      mode:label(m.mode,100),status:label(m.status,60),score_a:numeric(m.score_a),score_b:numeric(m.score_b),
    }):[],
  };
  if (kind === 'incident') return {...base,match_id:input.match_id?id(input.match_id):null,kind:label(input.kind||'support',30),title:label(input.title,300),status:({abierto:'open',en_revision:'investigating',esperando_respuesta:'waiting',resuelto:'resolved',cerrado:'closed',rechazado:'rejected'})[input.status]||label(input.status || 'open',80),source_status:label(input.status,80),reason:label(input.reason,8000),created_at:input.created_at || now(),priority:input.priority==='urgent'?'urgent':'normal',resolution:label(input.resolution,8000),web_path:safePath(input.web_path),reporter_id:label(input.reporter_id,160),reporter_name:label(input.reporter_name,100),assigned_name:label(input.assigned_name,100),awaiting_staff:input.awaiting_staff===true,last_message_at:typeof input.last_message_at==='string'?input.last_message_at.slice(0,64):null};
  if (kind === 'stat') return {...base,match_id:id(input.match_id),status:label(input.status,60),revision:numeric(input.revision),corrected_from_id:label(input.corrected_from_id,160),correction_reason:label(input.correction_reason,500),review_note:label(input.review_note,500),created_at:input.created_at||null,reviewed_at:input.reviewed_at||null,map_number:numeric(input.map_number),map_name:label(input.map_name,100),mode:label(input.mode,100),objective_label:label(input.objective_label,100),players:Array.isArray(input.players)?input.players.slice(0,100).map(normalizePlayer):[]};
  if (kind === 'club') return {...base,name:label(input.name,160),verified:input.verified===true,pass_active:input.pass_active===true,status:label(input.status,80)};
  if (kind === 'delivery') return {...base,status:label(input.status,60),kind:label(input.kind,100),error:label(input.error,1000),match_id:input.match_id?id(input.match_id):null};
  if (kind === 'sanction') return {
    ...base,incident_id:id(input.incident_id),subject_id:id(input.subject_id),
    subject_type:choice(input.subject_type,['player','club'],'Sujeto'),subject_name:label(input.subject_name,160),
    reason:label(input.reason,2000),starts_at:dateTime(input.starts_at),ends_at:dateTime(input.ends_at),
    restriction:choice(input.restriction||'competition_suspend',['warning','competition_suspend'],'Medida'),
    scopes:validatedScopes(input.scopes||[],input.restriction||'competition_suspend'),
    status:label(input.status,60),appeal_status:label(input.appeal_status||'none',60),
    appeal_reason:label(input.appeal_reason,2000),review_reason:label(input.review_reason||input.revoke_reason,2000),revoke_reason:label(input.revoke_reason,2000),
    source_issued_by:label(input.issued_by||input.created_by,160),source_appealed_by:label(input.appealed_by,160),
    official:input.official===true,
  };
  throw new HttpError(400,'Tipo de registro desconocido.');
}

export function ingestSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new HttpError(400,'Snapshot no válido.');
  const groups = [['matches','match'],['incidents','incident'],[snapshot.stats?'stats':'statistics','stat'],['clubs','club'],['deliveries','delivery'],['sanctions','sanction']];
  const prepared = groups.flatMap(([key,kind])=>{if(snapshot[key]===undefined)return[];if(!Array.isArray(snapshot[key])||snapshot[key].length>20000)throw new HttpError(400,`Colección ${key} no válida.`); const seen=new Set();return snapshot[key].map(input=>{const value=normalize(kind,input);if(seen.has(value.id))throw new HttpError(400,'Identificador CTP duplicado.');seen.add(value.id);return[kind,value];});});
  return tx(()=>{
    let changed=0;
    const previousById=new Map();
    const incomingByKind=new Map();
    for(const [kind,value]of prepared){if(!incomingByKind.has(kind))incomingByKind.set(kind,[]);incomingByKind.get(kind).push(value.id);}
    // Fetch only incoming IDs in bounded batches. An unchanged 20k-record feed
    // no longer creates 20k individual SELECT statements on every poll.
    for(const [kind,ids]of incomingByKind)for(let start=0;start<ids.length;start+=500){
      const batch=ids.slice(start,start+500);
      const existing=db.prepare(`SELECT kind,id,data,version,source,updated_at FROM operation_records WHERE kind=? AND id IN(${batch.map(()=>'?').join(',')})`).all(kind,...batch);
      for(const row of existing)previousById.set(`${row.kind}:${row.id}`,row);
    }
    for(const [kind,value]of prepared){
      const old=previousById.get(`${kind}:${value.id}`);
      const previous=old?parse(old.data,{}):{};
      if(old?.source==='manager'){
        const linked=kind==='sanction'&&value.official&&previous.subject_id===value.subject_id&&previous.incident_id===value.incident_id&&
          db.prepare("SELECT id FROM operation_commands WHERE action='sanction.create' AND resource_id=? AND status IN ('pending','sending','failed','acknowledged')").get(value.id);
        if(!linked)throw new HttpError(409,'Un ID externo colisiona con un registro local.');
      }
      if(old&&Number.isInteger(value.source_version)&&Number.isInteger(previous.source_version)&&value.source_version<previous.source_version)continue;
      const merged={...previous,...value};
      if(kind==='incident'&&old&&value.source_version===previous.source_version&&value.source_status===previous.source_status)merged.status=previous.status;
      if(old && json(merged)===old.data)continue;
      save(kind,merged,'ctp');changed++;
    }
    // A complete feed can retire a projection, but its history and linked local work remain.
    // Truncated feeds cannot establish that an absent resource has left the source.
    if(snapshot.generated_at&&!snapshot.possibly_truncated){
      for(const [key,kind]of groups){
        if(snapshot[key]===undefined)continue;
        const visible=new Set(prepared.filter(([k])=>k===kind).map(([,value])=>value.id));
        for(const item of rows(kind))if(item.source==='ctp'&&!visible.has(item.id)){save(kind,{...item,in_feed:false},'ctp');changed++;}
      }
    }
    return{received:prepared.length,changed};
  });
}

export function getIntegrationStatus() { const row=db.prepare("SELECT value FROM settings WHERE key='operations_integration'").get();return {configured:false,write_enabled:false,last_sync_at:null,last_error:null,supported_actions:[],...parse(row?.value,{})}; }
export function setIntegrationStatus(status) { const safe={...getIntegrationStatus()};for(const key of ['configured','write_enabled','writesEnabled','last_sync_at','lastSyncedAt','last_error','lastError','supported_actions','mode','status','web_origin','possibly_truncated','competition_cutover_enabled','local_test_mode']) if(status?.[key]!==undefined)safe[key]=status[key];db.prepare("INSERT INTO settings(key,value) VALUES('operations_integration',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(json(safe));return safe; }
export function listPendingCommands(limit=50) { const n=Number.isInteger(limit)?Math.min(200,Math.max(1,limit)):50;return db.prepare("SELECT * FROM operation_commands WHERE status='pending' ORDER BY created_at,id LIMIT ?").all(n).map(commandView); }
export function getCommand(commandId) {
  const command=commandView(db.prepare('SELECT * FROM operation_commands WHERE id=?').get(id(commandId)));
  if(!command)throw new HttpError(404,'Solicitud no encontrada.');
  const source=unpack(db.prepare('SELECT * FROM operation_records WHERE kind=? AND id=?').get(command.resource_type,command.resource_id));
  return {...command,source_available:Boolean(source&&(source.in_feed!==false||(command.resource_type==='stat'&&source.queried_at))),source_version_current:source?.source_version??null};
}
export function markCommandSending(commandId) {
  const row=db.prepare("UPDATE operation_commands SET status='sending',attempts=attempts+1,updated_at=? WHERE id=? AND (status IN ('pending','failed') OR (status='sending' AND updated_at<?)) RETURNING *").get(now(),id(commandId),now()-30_000);
  if(!row)throw new HttpError(409,'La solicitud ya se está enviando o no admite envío.');
  return commandView(row);
}
export function cancelCommand(user,commandId,input) {
  return tx(()=>{
    const command=getCommand(commandId);
    const section={'incident.status':'arbitraje','match.reply':'arbitraje','match.resolve':'arbitraje','match.revert':'arbitraje','veto.prepare':'arbitraje','veto.reset':'arbitraje','veto.start':'arbitraje','veto.staff_gate':'arbitraje','guard.configure':'arbitraje','guard.exempt':'arbitraje','guard.start':'arbitraje','incident.resolve':'arbitraje','incident.reply':'arbitraje','stats.review':'arbitraje','stats.correct':'arbitraje','club.verify':'clubes','discord.retry':'comunicaciones','sanction.create':'arbitraje','sanction.appeal':'arbitraje','sanction.review':'arbitraje','sanction.revoke':'arbitraje'}[command.type];
    requireSection(user,command.type===PRO_VIEW_ACTION?'realizacion':section||'operaciones');
    if(!user.is_admin&&command.actor_id!==user.id)throw new HttpError(403,'Solo el autor o un administrador puede descartar esta solicitud.');
    if(!Number.isInteger(input.expected_updated_at)||input.expected_updated_at!==command.updated_at)throw new HttpError(409,'La solicitud ha cambiado. Recarga antes de descartarla.');
    const neverSent=command.status==='pending'&&command.attempts===0;
    const rejectedFirstAttempt=command.status==='rejected'&&command.attempts===1&&command.result?.rejected_confirmed===true;
    if(!neverSent&&!rejectedFirstAttempt)throw new HttpError(409,'No se puede descartar una solicitud aplicada o con un intento ambiguo.');
    const result={cancelled_by:user.id,cancelled_at:now()};
    db.prepare("UPDATE operation_commands SET status='cancelled',result=?,updated_at=? WHERE id=?").run(json(result),now(),command.id);
    const item=record(command.resource_type,command.resource_id,true);
    const patch={...item};
    if(patch.pending_command_id===command.id){
      patch.pending_command_id=null;
      if(command.type==='incident.resolve')patch.status=({abierto:'open',en_revision:'investigating',esperando_respuesta:'waiting',resuelto:'resolved',cerrado:'closed',rechazado:'rejected'})[item.source_status]||item.source_status||'open';
      save(command.resource_type,patch,item.source);
    }
    if(command.type==='incident.reply')db.prepare("UPDATE operation_notes SET delivery_status='cancelled' WHERE id=?").run(command.payload.note_id);
    audit(command.resource_type,command.resource_id,`${command.type}.cancelled`,user,{command_id:command.id});
    return getCommand(command.id);
  });
}
export function acknowledgeCommand(commandId,result) {
  if(!result||result.confirmed!==true)throw new HttpError(400,'CTP no ha confirmado la operación.');
  return tx(()=>{
    const row=db.prepare('SELECT * FROM operation_commands WHERE id=?').get(id(commandId));
    if(!row)throw new HttpError(404,'Solicitud no encontrada.');
    if(row.status==='acknowledged')return commandView(row);
    if(row.status==='cancelled')throw new HttpError(409,'La solicitud fue descartada antes de enviarla.');
    if(row.action==='stats.correct'&&(typeof result.revision_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.revision_id)))throw new HttpError(400,'CTP no ha identificado la nueva revisión de estadísticas.');
    const payload=parse(row.payload,{});
    let item;try{item=record(row.resource_type,row.resource_id,true);}catch{}
    const sourceVersion=Number.isInteger(result.source_version)?result.source_version:Number.isInteger(result.version)?result.version:null;
    if(item){
      const patch={...item,pending_command_id:null,last_command_id:row.id};
      const newerSnapshot=sourceVersion!==null&&Number.isInteger(item.source_version)&&item.source_version>sourceVersion;
      if(!newerSnapshot){
        if(row.action==='incident.resolve'){patch.status='resolved';patch.resolution=payload.resolution;patch.decision=payload.decision;}
        if(row.action==='stats.review')patch.status=payload.decision==='approve'?'approved':'rejected';
        if(row.action==='stats.correct'){
          // A correction creates a different official revision. Never overwrite
          // the original evidence or invent the new record before a source read.
          patch.correction_revision_id=result.revision_id;
        }
        if(row.action==='club.verify')patch.verified=payload.decision==='verify';
        if(row.action==='discord.retry')patch.status='queued';
        if(row.action==='sanction.create'){patch.official=true;patch.appeal_status='none';patch.status=Date.parse(item.starts_at)>now()?'scheduled':Date.parse(item.ends_at)<=now()?'expired':'active';}
        if(row.action==='sanction.appeal'){patch.appeal_status='pending';patch.appeal_reason=payload.reason;patch.appeal_by=row.actor_id;}
        if(row.action==='sanction.review'){patch.appeal_status=payload.decision==='revoke'?'revoked':'upheld';patch.review_reason=payload.reason;if(payload.decision==='revoke')patch.status='revoked';}
        if(row.action==='sanction.revoke'){patch.status='revoked';patch.review_reason=payload.reason;}
        if(sourceVersion!==null)patch.source_version=sourceVersion;
        else if(row.resource_type==='sanction')patch.source_version=(item.source_version||0)+1;
      }
      save(row.resource_type,patch,row.action==='sanction.create'?'ctp':item.source);
    }
    if(row.action==='incident.reply')db.prepare("UPDATE operation_notes SET delivery_status='delivered' WHERE id=?").run(payload.note_id);
    db.prepare("UPDATE operation_commands SET status='acknowledged',attempts=MAX(attempts,1),last_error=NULL,result=?,updated_at=? WHERE id=?").run(json({confirmed:true,external_id:label(result.external_id,160),source_version:sourceVersion,...(result.revision_id?{revision_id:result.revision_id}:{})}),now(),row.id);
    audit(row.resource_type,row.resource_id,`${row.action}.acknowledged`,null,{command_id:row.id});
    return commandView(db.prepare('SELECT * FROM operation_commands WHERE id=?').get(row.id));
  });
}
export function failCommand(commandId,error) {
  const message=label(typeof error==='string'?error:error?.message,1000)||'No se ha podido confirmar la operación.';
  const row=db.prepare('SELECT * FROM operation_commands WHERE id=?').get(id(commandId));
  if(!row)throw new HttpError(404,'Solicitud no encontrada.');
  if(['acknowledged','cancelled','rejected'].includes(row.status))throw new HttpError(409,'La operación ya tiene una respuesta definitiva.');
  const definitive=error?.definitive_rejection===true&&row.status==='sending'&&row.attempts===1;
  db.prepare('UPDATE operation_commands SET status=?,attempts=MAX(attempts,1),last_error=?,result=?,updated_at=? WHERE id=?').run(
    definitive?'rejected':'failed',message,definitive?json({rejected_confirmed:true,rejected_at:now()}):null,now(),row.id,
  );
  if(definitive)audit(row.resource_type,row.resource_id,`${row.action}.rejected`,null,{command_id:row.id});
  return commandView(db.prepare('SELECT * FROM operation_commands WHERE id=?').get(row.id));
}

export function bootstrap(user) {
  requireSection(user,...OPERATION_SECTIONS);
  const staff=can(user,'operaciones','arbitraje','casters','realizacion')?db.prepare('SELECT * FROM users WHERE active=1 ORDER BY name,username').all().filter(u=>isStaffUser(describeUser(u))).map((u)=>{const described=describeUser(u);return{id:u.id,name:described.name,username:u.username,sections:described.sections,...(user.is_admin?{integration_actor_id:getOperatorIdentity(u.id)}:{}),availability:can(user,'operaciones')?db.prepare('SELECT date,status,note FROM availability WHERE user_id=? ORDER BY date').all(u.id):u.id===user.id?db.prepare('SELECT date,status,note FROM availability WHERE user_id=? ORDER BY date').all(u.id):[]};}):[];
  const allowedKinds=new Set();if(can(user,'arbitraje')){allowedKinds.add('guard_match');allowedKinds.add('guard_tournament');allowedKinds.add('fixture');}if(can(user,...READ_MATCH))allowedKinds.add('match');if(can(user,'operaciones')){allowedKinds.add('tournament');allowedKinds.add('registration');allowedKinds.add('fixture');}if(can(user,'arbitraje')){allowedKinds.add('incident');allowedKinds.add('stat');allowedKinds.add('sanction');allowedKinds.add('case_incident');allowedKinds.add('case_match');}if(can(user,'clubes'))allowedKinds.add('club');if(can(user,'comunicaciones'))allowedKinds.add('delivery');
  if (user.is_admin) { allowedKinds.add('ranked_season'); allowedKinds.add('club_create'); allowedKinds.add('administration'); allowedKinds.add('administration_create'); }
  if (can(user,'realizacion')) allowedKinds.add('pro_view');
  const commandRows=db.prepare('SELECT * FROM operation_commands ORDER BY created_at DESC LIMIT 300').all().filter(c=>allowedKinds.has(c.resource_type)).map(c=>getCommand(c.id));
  return {matches:can(user,...READ_MATCH)?rows('match'):[],incidents:can(user,'arbitraje')?rows('incident').map(i=>({...i,notes:notes('incident',i.id,true)})):[],assignments:can(user,'operaciones','arbitraje','casters','realizacion')?db.prepare('SELECT a.*,u.name user_name,u.username FROM operation_assignments a JOIN users u ON u.id=a.user_id ORDER BY starts_at').all():[],staff,stats:can(user,'arbitraje')?rows('stat').map(statisticsWithRoster):[],clubs:can(user,'clubes')?rows('club'):[],deliveries:can(user,'comunicaciones')?rows('delivery'):[],sanctions:can(user,'arbitraje')?rows('sanction').map(effectiveSanction):[],production:can(user,'operaciones','casters','realizacion')?db.prepare('SELECT * FROM operation_production ORDER BY updated_at DESC').all():[],audit:db.prepare('SELECT a.*,u.name actor_name,u.username actor_username FROM operation_audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 200').all().filter(a=>allowedKinds.has(a.resource_type)).map(a=>({...a,details:parse(a.details,{})})),connection:getIntegrationStatus(),commands:commandRows,rundowns:can(user,'realizacion','casters')?db.prepare('SELECT id,title,date,time FROM rundowns ORDER BY date DESC,id DESC').all():[]};
}
export function matchDossier(user,matchId,{historical=false}={}) {
  requireSection(user,...READ_MATCH);if(historical)requireSection(user,'arbitraje');
  const match=record('match',matchId,historical);
  if(historical&&(!match.queried_at||now()-match.queried_at>60_000))throw new HttpError(404,'Vuelve a consultar el partido oficial.');
  return{match,incidents:can(user,'arbitraje')?rows('incident',match.id):[],
    assignments:db.prepare('SELECT a.id,a.match_id,a.user_id,a.role,a.starts_at,a.ends_at,a.status,a.version,a.created_by,a.created_at,a.updated_at,u.name user_name,u.username FROM operation_assignments a JOIN users u ON u.id=a.user_id WHERE match_id=? ORDER BY starts_at').all(match.id),
    statistics:[...new Map([...(match.statistics||[]),...rows('stat',match.id).filter(s=>s.status==='approved'||can(user,'arbitraje')).map(stat=>statisticsWithRoster(stat,match))].map(s=>[s.id,s])).values()],
    notes:can(user,'casters','realizacion')?notes('match',match.id,true):[],production:db.prepare('SELECT match_id,rundown_id,state,scene,note,version,updated_by,updated_at FROM operation_production WHERE match_id=?').get(match.id)||null,
    audit:can(user,'operaciones','arbitraje')?history('match',match.id):[]};
}
export function incidentDetail(user,incidentId) {requireSection(user,'arbitraje');return{incident:record('incident',incidentId),notes:notes('incident',incidentId,true),audit:history('incident',incidentId)};}
export function createIncident(user,input) {requireSection(user,'arbitraje');return tx(()=>{const match=record('match',input.match_id);const item=save('incident',{id:randomUUID(),match_id:match.id,kind:match.kind,title:text(input.title,'Título',300),reason:text(input.reason,'Motivo',8000),priority:choice(input.priority||'normal',['normal','urgent'],'Prioridad'),status:'open',assignee_id:null,created_at:now()});audit('incident',item.id,'incident.created',user,{match_id:match.id});return item;});}
export function updateIncident(user,key,input) {requireSection(user,'arbitraje');return tx(()=>{const item=record('incident',key);version(input.expected_version,item.version);if(['resolved','rejected','closed','closed_internal','resolution_pending'].includes(item.status))throw new HttpError(409,'El expediente ya está resuelto o tiene una resolución pendiente.');const patch={...item};if(input.status!==undefined)patch.status=choice(input.status,['open','investigating','waiting'],'Estado');if(input.priority!==undefined)patch.priority=choice(input.priority,['normal','urgent'],'Prioridad');if(input.assignee_id!==undefined){if(input.assignee_id!==null){if(!Number.isInteger(input.assignee_id)||input.assignee_id<1)throw new HttpError(400,'Responsable no válido.');const staff=db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(input.assignee_id);if(!staff||!can(describeUser(staff),'arbitraje'))throw new HttpError(400,'El responsable debe ser un árbitro activo.');}patch.assignee_id=input.assignee_id;}const result=save('incident',patch,item.source);audit('incident',key,'incident.updated',user,{status:result.status,assignee_id:result.assignee_id});return result;});}
export function addIncidentNote(user,key,input) {
  requireSection(user,'arbitraje');
  return tx(()=>{
    const item=record('incident',key);
    version(input.expected_version,item.version);
    const visibility=choice(input.visibility,['internal','participants'],'Visibilidad');
    if(visibility==='participants'&&item.source==='manager')throw new HttpError(422,'Un expediente interno no tiene un hilo CTP al que enviar respuestas.');
    if(visibility==='participants'&&['resolved','rejected','closed','closed_internal'].includes(item.status))throw new HttpError(409,'El expediente está cerrado; no admite otra respuesta.');
    const max=visibility==='internal'?8000:item.kind==='ranked'?800:2000;
    const note={id:randomUUID(),text:text(input.text,'Nota',max),visibility};
    db.prepare('INSERT INTO operation_notes(id,resource_type,resource_id,text,visibility,actor_id,delivery_status,created_at) VALUES(?,?,?,?,?,?,?,?)').run(note.id,'incident',key,note.text,note.visibility,user.id,note.visibility==='participants'?'pending':'local',now());
    const command=note.visibility==='participants'?queue('incident.reply','incident',item,{note_id:note.id,text:note.text},user):null;
    const resource=save('incident',item,item.source);
    audit('incident',key,'incident.note.created',user,{note_id:note.id,visibility:note.visibility});
    return{resource,command,note};
  });
}
export function resolveIncident(user,key,input) {
  requireSection(user,'arbitraje');
  return tx(()=>{
    const item=record('incident',key);
    version(input.expected_version,item.version);
    if(['resolved','rejected','closed','closed_internal','resolution_pending'].includes(item.status))throw new HttpError(409,'Este expediente no admite otra resolución.');
    const decision=choice(input.decision,['close','award','cancel'],'Decisión');
    const resolution=text(input.resolution,'Resolución',2000);
    if(resolution.length<8)throw new HttpError(400,'La resolución debe explicar el motivo con al menos 8 caracteres.');
    if(item.source==='manager'){
      if(decision!=='close')throw new HttpError(400,'Un expediente interno solo permite un cierre interno; no cambia resultados CTP.');
      const resource=save('incident',{...item,status:'closed_internal',resolution,official:false},item.source);
      audit('incident',key,'incident.closed_internal',user);
      return{command:null,resource};
    }
    const payload={decision,resolution,match_id:item.match_id,kind:item.kind};
    if(input.winner_team_id)payload.winner_team_id=id(input.winner_team_id);
    if(input.winner_side!==undefined)payload.winner_side=choice(input.winner_side,['a','b'],'Equipo ganador');
    for(const field of ['maps_a','maps_b'])if(input[field]!==undefined){if(!Number.isInteger(input[field])||input[field]<0||input[field]>20)throw new HttpError(400,'El marcador debe indicar mapas enteros de 0 a 20.');payload[field]=input[field];}
    if(decision==='award'){
      if(item.kind==='challenge'&&!payload.winner_team_id)throw new HttpError(400,'Selecciona el equipo ganador.');
      if(item.kind==='ranked'&&!payload.winner_side)throw new HttpError(400,'Selecciona el lado ganador.');
      if(item.kind==='tournament'&&(payload.maps_a===undefined||payload.maps_b===undefined||payload.maps_a===payload.maps_b))throw new HttpError(400,'Indica el marcador completo y sin empate.');
    }
    const command=queue('incident.resolve','incident',item,payload,user);
    return{command,resource:save('incident',{...item,status:'resolution_pending',pending_command_id:command.id},item.source)};
  });
}

function day(value) {return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
function validateAssignmentPerson(userId,role,start,end) {
  const person=db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(userId);
  if(!person)throw new HttpError(400,'Persona no disponible.');
  const section={referee:'arbitraje',caster:'casters',producer:'realizacion'}[role];
  if(!can(describeUser(person),section))throw new HttpError(400,'La persona no tiene permiso para ese puesto.');
  const lastDay=day(new Date(Date.parse(end)-1).toISOString());
  for(let date=day(start);date<=lastDay;date=new Date(Date.parse(`${date}T12:00:00Z`)+86400_000).toISOString().slice(0,10)){
    const available=db.prepare('SELECT status FROM availability WHERE user_id=? AND date=?').get(userId,date);
    if(available?.status!=='disponible')throw new HttpError(409,'La persona debe marcar disponibilidad para todo el turno.');
  }
}
export function createAssignment(user,input) {requireSection(user,'operaciones');return tx(()=>{const match=record('match',input.match_id);const role=choice(input.role,['referee','caster','producer'],'Puesto');if(!Number.isInteger(input.user_id))throw new HttpError(400,'Persona no válida.');const start=dateTime(input.starts_at),end=dateTime(input.ends_at);if(Date.parse(end)-Date.parse(start)<60_000||Date.parse(end)-Date.parse(start)>24*3600_000)throw new HttpError(400,'El turno debe durar entre un minuto y 24 horas.');validateAssignmentPerson(input.user_id,role,start,end);const overlap=db.prepare("SELECT id FROM operation_assignments WHERE user_id=? AND status IN ('pending','confirmed') AND starts_at<? AND ends_at>?").get(input.user_id,end,start);if(overlap)throw new HttpError(409,'La persona ya tiene otro turno que se solapa.');const key=randomUUID();db.prepare('INSERT INTO operation_assignments(id,match_id,user_id,role,starts_at,ends_at,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(key,match.id,input.user_id,role,start,end,user.id,now(),now());audit('match',match.id,'assignment.created',user,{assignment_id:key,user_id:input.user_id,role});return db.prepare('SELECT * FROM operation_assignments WHERE id=?').get(key);});}
export function updateAssignment(user,key,input) {
  requireSection(user,'operaciones','arbitraje','casters','realizacion');
  return tx(()=>{
    const item=db.prepare('SELECT * FROM operation_assignments WHERE id=?').get(id(key));
    if(!item)throw new HttpError(404,'Turno no encontrado.');
    version(input.expected_version,item.version);
    if(!['pending','confirmed'].includes(item.status))throw new HttpError(409,'El turno ya está cerrado.');
    const planning=['user_id','starts_at','ends_at'].some(field=>input[field]!==undefined);
    if(planning){
      requireSection(user,'operaciones');
      if(input.status!==undefined||input.role!==undefined||input.match_id!==undefined)throw new HttpError(400,'Reprograma el turno conservando el partido y el puesto.');
      const person=input.user_id??item.user_id;
      if(!Number.isInteger(person))throw new HttpError(400,'Persona no válida.');
      const start=dateTime(input.starts_at??item.starts_at),end=dateTime(input.ends_at??item.ends_at);
      if(Date.parse(end)-Date.parse(start)<60_000||Date.parse(end)-Date.parse(start)>24*3600_000)throw new HttpError(400,'El turno debe durar entre un minuto y 24 horas.');
      const reason=text(input.reason,'Motivo del cambio',1000);
      if(reason.length<8)throw new HttpError(400,'Explica el cambio con al menos 8 caracteres.');
      validateAssignmentPerson(person,item.role,start,end);
      const overlap=db.prepare("SELECT id FROM operation_assignments WHERE id<>? AND user_id=? AND status IN ('pending','confirmed') AND starts_at<? AND ends_at>?").get(key,person,end,start);
      if(overlap)throw new HttpError(409,'La persona ya tiene otro turno que se solapa.');
      if(person===item.user_id&&start===item.starts_at&&end===item.ends_at)throw new HttpError(400,'No hay cambios en el turno.');
      db.prepare("UPDATE operation_assignments SET user_id=?,starts_at=?,ends_at=?,status='pending',version=version+1,updated_at=? WHERE id=?").run(person,start,end,now(),key);
      audit('match',item.match_id,person===item.user_id?'assignment.rescheduled':'assignment.replaced',user,{assignment_id:key,reason,before:{user_id:item.user_id,starts_at:item.starts_at,ends_at:item.ends_at,status:item.status},after:{user_id:person,starts_at:start,ends_at:end,status:'pending'}});
    }else{
      const status=choice(input.status,['confirmed','declined','cancelled'],'Estado');
      if(status==='cancelled')requireSection(user,'operaciones');
      else if(item.user_id!==user.id)throw new HttpError(403,'Solo la persona asignada puede confirmar o rechazar su turno.');
      if(status==='confirmed')validateAssignmentPerson(item.user_id,item.role,item.starts_at,item.ends_at);
      db.prepare('UPDATE operation_assignments SET status=?,version=version+1,updated_at=? WHERE id=?').run(status,now(),key);
      audit('match',item.match_id,`assignment.${status}`,user,{assignment_id:key});
    }
    return db.prepare('SELECT * FROM operation_assignments WHERE id=?').get(key);
  });
}
export function addCasterNote(user,key,input) {requireSection(user,'casters');record('match',key);return tx(()=>{const note={id:randomUUID(),text:text(input.text,'Nota',8000)};db.prepare("INSERT INTO operation_notes(id,resource_type,resource_id,text,visibility,actor_id,created_at) VALUES(?,'match',?,?,'editorial',?,?)").run(note.id,key,note.text,user.id,now());audit('match',key,'caster.note.created',user,{note_id:note.id});return note;});}
const TRANSITIONS={preparation:['preparation','ready'],ready:['ready','preparation','live'],live:['live','paused','finished'],paused:['paused','live','finished'],finished:['finished','preparation']};
export function updateProduction(user,key,input) {requireSection(user,'realizacion');record('match',key);return tx(()=>{const previous=db.prepare('SELECT * FROM operation_production WHERE match_id=?').get(key);version(input.expected_version,previous?.version||0);const state=choice(input.state,Object.keys(TRANSITIONS),'Estado');if(!TRANSITIONS[previous?.state||'preparation'].includes(state))throw new HttpError(409,'Transición de realización no permitida.');const rundown=input.rundown_id===undefined?(previous?.rundown_id||null):input.rundown_id;if(rundown!==null&&(!Number.isInteger(rundown)||!db.prepare('SELECT id FROM rundowns WHERE id=?').get(rundown)))throw new HttpError(400,'Escaleta no encontrada.');const scene=choice(input.scene||previous?.scene||'preview',['preview','teams','map','pause','result','next'],'Escena');db.prepare(`INSERT INTO operation_production(match_id,rundown_id,state,scene,note,version,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(match_id) DO UPDATE SET rundown_id=excluded.rundown_id,state=excluded.state,scene=excluded.scene,note=excluded.note,version=excluded.version,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).run(key,rundown,state,scene,input.note===undefined?(previous?.note||''):text(input.note,'Nota',4000,true),(previous?.version||0)+1,user.id,now());audit('match',key,'production.updated',user,{state,scene,rundown_id:rundown});return db.prepare('SELECT * FROM operation_production WHERE match_id=?').get(key);});}

export function reviewStatistics(user,key,input) {
  requireSection(user,'arbitraje');
  return tx(()=>{
    const item=record('stat',key,true);version(input.expected_source_version??input.expected_version,input.expected_source_version!==undefined?item.source_version:item.version);
    if(item.correction_revision_id)throw new HttpError(409,'CTP ha creado otra revisión. Sincroniza para revisar la nueva versión.');
    if(!['pending','review','pending_review','submitted'].includes(item.status))throw new HttpError(409,'Estas estadísticas no están pendientes de revisión.');
    const reason=text(input.reason,'Motivo',500);
    if(reason.length<3)throw new HttpError(400,'El motivo debe tener al menos 3 caracteres.');
    const command=queue('stats.review','stat',item,{decision:choice(input.decision,['approve','reject'],'Decisión'),reason},user);
    return{command,resource:save('stat',{...item,pending_command_id:command.id},item.source)};
  });
}
export function statisticsDetail(user,key) {
  requireSection(user,'arbitraje');
  const item=record('stat',key,true);
  return {statistic:statisticsWithRoster(item),audit:history('stat',key),commands:db.prepare("SELECT * FROM operation_commands WHERE resource_type='stat' AND resource_id=? ORDER BY created_at DESC LIMIT 100").all(key).map(commandView)};
}
export function correctStatistics(user,key,input) {
  requireSection(user,'arbitraje');
  return tx(()=>{
    if(!getIntegrationStatus().supported_actions?.includes('stats.correct'))throw new HttpError(422,'CTP no anuncia todavía la corrección de estadísticas.');
    const item=record('stat',key,true);version(input.expected_source_version??input.expected_version,input.expected_source_version!==undefined?item.source_version:item.version);
    if(item.correction_revision_id)throw new HttpError(409,'CTP ya ha creado otra revisión. Sincroniza antes de continuar.');
    if(!['pending','review','pending_review','submitted','rejected','approved'].includes(item.status))throw new HttpError(409,'Esta revisión ya está sustituida y no admite otra corrección.');
    const payload=correctionPayload(input);
    const players=new Map(item.players.map(player=>[player.id,player]));
    let changed=false;
    for(const player of payload.players){
      const original=players.get(player.user_id);
      if(!original)throw new HttpError(400,'La corrección contiene un jugador que no pertenece al envío.');
      for(const [field,value]of Object.entries(player))if(field!=='user_id'&&(original[field]??null)!==value)changed=true;
    }
    if(!changed)throw new HttpError(400,'No hay cifras modificadas.');
    const command=queue('stats.correct','stat',item,payload,user);
    audit('stat',key,'stats.correction.prepared',user,{command_id:command.id,reason:payload.reason,before:item.players,corrections:payload.players});
    return {command,resource:save('stat',{...item,pending_command_id:command.id},item.source)};
  });
}

/** Cache only resources returned by the authenticated shared backend, preserving local command links. */
export function rememberCompetitionData(resource,result) {
  if(resource==='statistics')return tx(()=>{
    if(!Array.isArray(result.items)||result.items.length>100||!Array.isArray(result.roster)||result.roster.length>100)throw new HttpError(502,'CTP ha devuelto estadísticas no válidas.');
    const roster=new Map(result.roster.map(player=>[player.user_id,player]));
    const items=result.items.map(raw=>{
      if(!Number.isInteger(raw.manager_version)||raw.manager_version<0)throw new HttpError(502,'CTP ha devuelto una versión de estadísticas no válida.');
      const normalized=normalize('stat',{...raw,version:raw.manager_version,players:(raw.players||[]).map(player=>({...player,username:roster.get(player.user_id)?.username||player.username}))});
      let old=null;try{old=record('stat',normalized.id,true);}catch{}
      if(old&&old.source_version>normalized.source_version)return statisticsWithRoster(old);
      const candidate={...old,...normalized,queried_at:old?.queried_at||now(),pending_command_id:old?.pending_command_id||null};
      const comparable=value=>JSON.stringify(Object.fromEntries(Object.entries(value||{}).filter(([key])=>!['version','source','updated_at'].includes(key)).sort(([left],[right])=>left.localeCompare(right))));
      const item=old&&comparable(old)===comparable(candidate)?old:save('stat',candidate,'ctp');
      return statisticsWithRoster(item);
    });
    return {...result,items};
  });
  const collections=resource==='tournaments'?[['tournament',result.items]]:resource==='tournament'?[['tournament',[result.tournament]],['registration',result.participants],['fixture',result.matches]]:resource==='match'?[['fixture',[result.match]]]:resource==='referee_queue'?[['fixture',result.items]]:[];
  return tx(()=>{
    if(resource==='match'&&result.dossier){
      const normalized=normalize('match',result.dossier);
      if(normalized.id!==result.match?.id||normalized.source_version!==result.match?.manager_version)throw new HttpError(502,'CTP ha devuelto un dossier incoherente.');
      let old=null;try{old=record('match',normalized.id,true);}catch{}
      if(old&&old.source_version>normalized.source_version)throw new HttpError(409,'El dossier recibido está obsoleto. Actualiza el partido.');
      save('match',{...old,...normalized,in_feed:old?.in_feed===true,queried_at:now(),pending_command_id:old?.pending_command_id||null},'ctp');
    }
    for(const [kind,items]of collections){
      if(!Array.isArray(items)||items.length>2000)throw new HttpError(502,'CTP ha devuelto una colección de competición no válida.');
      for(const item of items){
        if(!item||typeof item.id!=='string'||!Number.isInteger(item.manager_version)||item.manager_version<0)throw new HttpError(502,'CTP ha devuelto una versión de competición no válida.');
        let old=null;try{old=record(kind,item.id,true);}catch{}
        if(old&&old.source_version>item.manager_version)continue;
        save(kind,{...item,source_version:item.manager_version,in_feed:true,pending_command_id:old?.pending_command_id||null},'ctp');
      }
    }
    return result;
  });
}

export function rememberGuardState(state) {
 return tx(()=>{
  for(const [kind,key,source_version]of [['guard_match',state.match_id,state.match_version],['guard_tournament',state.tournament_id,state.tournament_version]]){
   let old=null;try{old=record(kind,key,true);}catch{}
   if(old&&old.source_version>source_version)throw new HttpError(409,'Se ha recibido un estado Guard obsoleto.');
   save(kind,{...old,id:key,source_version,in_feed:true,observed_at:state.observed_at},'ctp');
  }
  const commands=db.prepare("SELECT * FROM operation_commands WHERE (resource_type='guard_match' AND resource_id=?) OR (resource_type='guard_tournament' AND resource_id=?) ORDER BY created_at DESC LIMIT 10").all(state.match_id,state.tournament_id).map(c=>getCommand(c.id));
  return {...state,commands};
 });
}
export function prepareGuardCommand(user,input,state) {
 requireSection(user,'arbitraje');
 const payload=guardPayload(input.type,input.payload);
 if(!getIntegrationStatus().supported_actions?.includes(input.type))throw new HttpError(422,'CTP todavía no admite esta acción Guard.');
 const configure=input.type==='guard.configure';
 const key=configure?state.tournament_id:state.match_id;
 if(input.target_id!==key)throw new HttpError(400,'El destino no pertenece al partido.');
 version(input.expected_version,configure?state.tournament_version:state.match_version);
 if(!configure&&(!state.enabled||state.started_at))throw new HttpError(409,'El partido no admite cambios de Guard.');
 if(input.type==='guard.start'&&!state.ready)throw new HttpError(409,'Faltan jugadores por conectar o verificar.');
 if(input.type==='guard.exempt'&&!state.players.some(p=>p.user_id===payload.user_id))throw new HttpError(400,'El jugador no pertenece a esta alineación.');
 return tx(()=>{
  const kind=configure?'guard_tournament':'guard_match',item=record(kind,key);
  const command=queue(input.type,kind,item,payload,user);
  save(kind,{...item,pending_command_id:command.id},'ctp');
  return {command};
 });
}
export function rememberRankedState(state) {
  return tx(() => {
    for (const item of [state.current, state.scheduled].filter(Boolean)) {
      let old = null; try { old = record('ranked_season', item.id, true); } catch {}
      if (old && old.source_version > item.manager_version) throw new HttpError(409, 'Se ha recibido una season obsoleta.');
      save('ranked_season', { ...item, source_version: item.manager_version, in_feed: true, pending_command_id: old?.pending_command_id || null }, 'ctp');
    }
    return { ...state, commands: db.prepare("SELECT * FROM operation_commands WHERE resource_type='ranked_season' ORDER BY created_at DESC LIMIT 10").all().map(commandView) };
  });
}
export function rememberProViewState(state) {
  return tx(() => {
    let old = null; try { old = record('pro_view', PRO_VIEW_RESOURCE_ID, true); } catch {}
    if (old && old.source_version > state.revision) throw new HttpError(409, 'Se ha recibido una configuración de Pro View obsoleta.');
    // Polling an unchanged editor must not invalidate pagination in every other
    // Manager workspace. Automatic snapshot captures do not change this CAS.
    if (!old || old.source_version !== state.revision || old.in_feed === false) save('pro_view', { id: PRO_VIEW_RESOURCE_ID, source_version: state.revision, in_feed: true, pending_command_id: old?.pending_command_id || null }, 'ctp');
    const commands = db.prepare("SELECT id FROM operation_commands WHERE resource_type='pro_view' AND resource_id=? ORDER BY created_at DESC,id DESC LIMIT 10").all(PRO_VIEW_RESOURCE_ID).map(row => getCommand(row.id));
    return { ...state, commands };
  });
}
export function prepareProViewCommand(user, input, state) {
  requireSection(user, 'realizacion');
  if (!getIntegrationStatus().supported_actions?.includes(PRO_VIEW_ACTION)) throw new HttpError(422, 'CTP todavía no tiene habilitada la publicación de Pro View.');
  const payload = validateProViewProposal(input, state);
  return tx(() => {
    const item = record('pro_view', PRO_VIEW_RESOURCE_ID);
    const command = queue(PRO_VIEW_ACTION, 'pro_view', item, payload, user);
    save('pro_view', { ...item, pending_command_id: command.id }, 'ctp');
    return { command };
  });
}
export function prepareRankedCommand(user, input, state) {
  if (!user?.is_admin) throw new HttpError(403, 'Solo administración puede programar Ranked.');
  if (!getIntegrationStatus().supported_actions?.includes(input.type)) throw new HttpError(422, 'El backend CTP todavía no anuncia esta capacidad Ranked.');
  const payload = rankedPayload(input.type, input.payload);
  const scheduledAction = input.type !== 'ranked.season.schedule';
  const target = scheduledAction ? state.scheduled : state.current;
  if (!target || input.target_id !== target.id) throw new HttpError(400, 'La propuesta no pertenece a esta season.');
  version(input.expected_version, target.manager_version);
  if (!scheduledAction && state.scheduled) throw new HttpError(409, 'Ya existe una season programada.');
  if (scheduledAction && Date.parse(state.current.ends_at) <= now()) throw new HttpError(409, 'La season ya ha alcanzado su fecha de reinicio.');
  if (input.type !== 'ranked.season.cancel' && Date.parse(payload.starts_at) <= now()) throw new HttpError(400, 'Programa el inicio en el futuro.');
  return tx(() => {
    const item = record('ranked_season', target.id);
    const command = queue(input.type, 'ranked_season', item, payload, user);
    save('ranked_season', { ...item, pending_command_id: command.id }, 'ctp');
    return { command };
  });
}
export function prepareManualClubCommand(user, input) {
  if (!user?.is_admin) throw new HttpError(403, 'Solo administración puede crear clubes manualmente.');
  if (!getIntegrationStatus().supported_actions?.includes('club.create')) throw new HttpError(422, 'El backend CTP todavía no anuncia altas manuales de clubes.');
  const payload = manualClubPayload(input.type, input.payload);
  return tx(() => {
    for (const row of db.prepare("SELECT * FROM operation_commands WHERE action='club.create' AND status IN('pending','sending','failed','rejected')").all()) {
      const previous = parse(row.payload, {});
      if (previous.leader_id === payload.leader_id || previous.name === payload.name) {
        if (row.payload === json(payload) && row.actor_id === user.id) return { command: commandView(row) };
        throw new HttpError(409, 'Ya hay una propuesta de alta para ese club o líder. Revisa su estado.');
      }
    }
    // A proposal is not an official club. Keep it outside the synced club list.
    const key = randomUUID(), item = save('club_create', { id: key, source_version: 0, in_feed: true, name: payload.name }, 'manager');
    const command = queue('club.create', 'club_create', item, payload, user);
    save('club_create', { ...item, pending_command_id: command.id }, 'manager');
    return { command };
  });
}
export function prepareCompetitionCommand(user,input) {
  const type=choice(input.type,COMPETITION_ACTIONS,'Acción');
  requireSection(user,type.startsWith('match.')||type.startsWith('veto.')?'arbitraje':'operaciones');
  if(!getIntegrationStatus().supported_actions?.includes(type))throw new HttpError(422,'El backend CTP no anuncia esta capacidad. Sincroniza la conexión.');
  const payload=competitionPayload(type,input.payload);
  return tx(()=>{
    const kind=['tournament.registration','tournament.withdraw'].includes(type)?'registration':type==='tournament.schedule'||type.startsWith('match.')||type.startsWith('veto.')?'fixture':'tournament';
    let item;
    if(type==='tournament.create'){
      if(input.expected_version!==0)throw new HttpError(400,'Un torneo nuevo requiere la versión cero.');
      item=save(kind,{id:randomUUID(),source_version:0,in_feed:true,status:'draft_pending',name:payload.name},'manager');
    }else{
      item=record(kind,input.target_id);
      version(input.expected_version,item.source_version);
      if(item.source!=='ctp')throw new HttpError(409,'CTP todavía no ha confirmado este torneo.');
    }
    const command=queue(type,kind,item,payload,user);
    return {command,resource:save(kind,{...item,pending_command_id:command.id},item.source)};
  });
}

export function rememberAdministrationData(result) {
  return tx(() => {
    if (typeof result.sync_target_id === 'string' && /^[a-f0-9-]{36}$/i.test(result.sync_target_id) && Number.isSafeInteger(result.sync_version)) {
      let old; try { old = record('administration', result.sync_target_id, true); } catch { /* First bounded sync target. */ }
      if (!old || old.source_version <= result.sync_version) save('administration', { id:result.sync_target_id,source_version:result.sync_version,in_feed:true,pending_command_id:old?.pending_command_id||null },'ctp');
    }
    for (const item of result.items) {
      const key = item.manager_target_id || item.id;
      if (typeof key !== 'string' || !/^[a-f0-9-]{36}$/i.test(key) || !Number.isSafeInteger(item.manager_version) || item.manager_version < 0) continue;
      let old; try { old = record('administration', key, true); } catch { /* First authenticated projection. */ }
      if (old && old.source_version > item.manager_version) continue;
      save('administration', { ...item, id: key, source_version: item.manager_version, in_feed: true, pending_command_id: old?.pending_command_id || null }, 'ctp');
    }
    return result;
  });
}

export function prepareAdministrationCommand(user, input = {}) {
  if (!user?.is_admin) throw new HttpError(403, 'Esta sección requiere administración CTP.');
  const type = choice(input.type, ADMIN_ACTIONS, 'Acción');
  const payload = administrationPayload(type, input.payload);
  if (!getIntegrationStatus().supported_actions?.includes(type)) throw new HttpError(422, 'El backend CTP no anuncia esta capacidad administrativa.');
  return tx(() => {
    const creation = ADMIN_CREATE_ACTIONS.includes(type);
    let item;
    if (creation) {
      if (input.expected_version !== 0) throw new HttpError(400, 'Un registro nuevo requiere la versión cero.');
      const key = input.target_id || randomUUID();
      if (typeof key !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(key)) throw new HttpError(400, 'Identificador no válido.');
      try { item = record('administration_create', key); } catch { /* No prior proposal. */ }
      if (item && item.source_version !== 0) throw new HttpError(409, 'Este registro ya existe.');
      item ||= save('administration_create', { id: key, source_version: 0, in_feed: true, name: payload.name || payload.kind || 'Nuevo registro' }, 'manager');
    } else {
      item = record('administration', input.target_id);
      version(input.expected_version, item.source_version);
    }
    const kind = creation ? 'administration_create' : 'administration';
    const command = queue(type, kind, item, payload, user);
    return { command, resource: save(kind, { ...item, pending_command_id: command.id }, item.source) };
  });
}

/** A direct ticket action already applied in CTP; mirror it so the inbox reflects it before the next feed. */
export function rememberTicketThread(thread,actorUser=null) {
  return tx(()=>{
    let item;try{item=record('incident',thread.ticket.id,true);}catch{return thread;/* Not in the local feed yet. */}
    const t=thread.ticket,last=thread.messages.at(-1);
    save('incident',{...item,
      status:({abierto:'open',en_revision:'investigating',esperando_respuesta:'waiting',resuelto:'resolved',cerrado:'closed',rechazado:'rejected'})[t.status]||t.status,
      source_status:t.status,reporter_id:t.author.id||item.reporter_id||null,reporter_name:t.author.username,assigned_name:t.assigned?.username||null,
      awaiting_staff:last?!last.is_staff:false,last_message_at:last?.created_at||item.last_message_at||null,
      ...(actorUser?{assignee_id:actorUser.id}:{})},item.source);
    return thread;
  });
}

export function rememberCaseData(resource,result) {
  return tx(()=>{
    const raw=resource==='incident'?result.incident:result.match,kind=resource==='incident'?'case_incident':'case_match';
    let old;try{old=record(kind,raw.id,true);}catch{/* First official lookup. */}
    if(!old||old.source_version<=raw.manager_version)save(kind,{...raw,source_version:raw.manager_version,in_feed:true,pending_command_id:old?.pending_command_id||null},'ctp');
    if(resource==='incident'){
      let previous;try{previous=record('incident',raw.id,true);}catch{/* Archived ticket outside the feed. */}
      const normalized=normalize('incident',{...raw,version:raw.manager_version});
      if(!previous||previous.source_version<=raw.manager_version)save('incident',{...previous,...normalized,pending_command_id:previous?.pending_command_id||null,in_feed:true},'ctp');
    }
    return result;
  });
}
export function prepareCaseCommand(user,input={}) {
  requireSection(user,'arbitraje');
  const type=choice(input.type,CASE_ACTIONS,'Acción');
  if(!getIntegrationStatus().supported_actions?.includes(type))throw new HttpError(422,'CTP aún no admite esta acción de arbitraje.');
  const payload=casePayload(type,input.payload),kind=CASE_RESOURCE_TYPES[type];
  return tx(()=>{const item=record(kind,input.target_id);version(input.expected_version,item.source_version);const command=queue(type,kind,item,payload,user);return{command,resource:save(kind,{...item,pending_command_id:command.id},'ctp')};});
}
export function reviewClub(user,key,input) {
  requireSection(user,'clubes');
  return tx(()=>{
    const item=record('club',key);version(input.expected_version,item.version);
    const reason=text(input.reason,'Motivo',500);
    if(reason.length<12)throw new HttpError(400,'La revisión del club debe explicar el motivo con al menos 12 caracteres.');
    const command=queue('club.verify','club',item,{decision:choice(input.decision,['verify','reject'],'Decisión'),reason},user);
    return{command,resource:save('club',{...item,pending_command_id:command.id},item.source)};
  });
}
export function retryDelivery(user,key,input) {requireSection(user,'comunicaciones');return tx(()=>{const item=record('delivery',key);version(input.expected_version,item.version);if(!['failed','error','dead'].includes(item.status))throw new HttpError(409,'Solo se pueden reintentar entregas fallidas.');const command=queue('discord.retry','delivery',item,{},user);return{command,resource:save('delivery',{...item,pending_command_id:command.id},item.source)};});}
export function createSanction(user,input) {
  requireSection(user,'arbitraje');
  return tx(()=>{
    const incident=record('incident',input.incident_id);
    const start=dateTime(input.starts_at),end=dateTime(input.ends_at);
    if(end<=start)throw new HttpError(400,'La sanción debe terminar después de empezar.');
    const restriction=choice(input.restriction,['warning','competition_suspend'],'Restricción');
    const item=save('sanction',{
      id:randomUUID(),incident_id:incident.id,match_id:incident.match_id,subject_id:id(input.subject_id),
      subject_type:choice(input.subject_type,['player','club'],'Sujeto'),reason:sanctionReason(input.reason),
      restriction,scopes:validatedScopes(input.scopes||[],restriction),starts_at:start,ends_at:end,status:'draft',
      created_by:user.id,created_at:now(),official:false,source_version:0,appeal_status:'none',
    });
    audit('sanction',item.id,'sanction.drafted',user,{incident_id:incident.id});return item;
  });
}
export function submitSanction(user,key,input) {
  requireSection(user,'arbitraje');
  return tx(()=>{
    const item=record('sanction',key);version(input.expected_version,item.version);
    if(item.official||!['draft','reviewed'].includes(item.status))throw new HttpError(409,'Solo una propuesta revisada y sin aplicar admite envío.');
    const incident=record('incident',item.incident_id);
    if(incident.source!=='ctp')throw new HttpError(422,'La sanción oficial necesita un expediente original de CTP.');
    if(Date.parse(item.ends_at)<=now())throw new HttpError(400,'La vigencia propuesta ya ha terminado.');
    const payload={incident_id:item.incident_id,subject_id:item.subject_id,subject_type:item.subject_type,
      reason:sanctionReason(item.reason),restriction:item.restriction,
      starts_at:item.starts_at,ends_at:item.ends_at,scopes:validatedScopes(item.scopes,item.restriction)};
    const command=queue('sanction.create','sanction',{...item,source_version:0},payload,user);
    return{command,resource:save('sanction',{...item,pending_command_id:command.id},item.source)};
  });
}
export function appealSanction(user,key,input) {
  requireSection(user,'arbitraje');
  return tx(()=>{
    const item=record('sanction',key);version(input.expected_version,item.version);
    if(item.status==='appealed'||item.appeal_status==='pending')throw new HttpError(409,'Ya hay un recurso abierto.');
    const reason=sanctionReason(input.reason,'Motivo del recurso');
    if(item.official){
      if(item.status==='revoked')throw new HttpError(409,'La sanción ya está revocada.');
      if(item.appeal_status!=='none')throw new HttpError(409,'Esta sanción oficial ya tiene un recurso registrado.');
      const command=queue('sanction.appeal','sanction',item,{reason},user);
      return{command,resource:save('sanction',{...item,pending_command_id:command.id},item.source)};
    }
    if(item.pending_command_id)throw new HttpError(409,'La propuesta tiene un envío pendiente. Revisa la solicitud antes de modificarla.');
    const result=save('sanction',{...item,status:'appealed',appeal_status:'pending',appeal_reason:reason,appeal_by:user.id,appeal_at:now()});
    audit('sanction',key,'sanction.appealed',user);return result;
  });
}
export function reviewSanction(user,key,input) {
  requireSection(user,'arbitraje');
  return tx(()=>{
    const item=record('sanction',key);version(input.expected_version,item.version);
    if(item.status==='revoked')throw new HttpError(409,'La sanción ya está revocada.');
    if(item.status!=='appealed'&&item.appeal_status!=='pending')throw new HttpError(409,'No hay un recurso pendiente.');
    if(item.created_by===user.id||item.appeal_by===user.id)throw new HttpError(403,'Otro árbitro independiente debe resolver el recurso.');
    const decision=choice(input.decision,['uphold','revoke'],'Decisión');
    const reason=sanctionReason(input.reason,'Resolución del recurso');
    if(item.official){
      const command=queue('sanction.review','sanction',item,{decision,reason},user);
      return{command,resource:save('sanction',{...item,pending_command_id:command.id},item.source)};
    }
    const result=save('sanction',{...item,status:decision==='revoke'?'withdrawn':'reviewed',appeal_status:decision==='revoke'?'revoked':'upheld',review_reason:reason,reviewed_by:user.id,official:false});
    audit('sanction',key,'sanction.reviewed',user,{decision});return result;
  });
}
export function revokeSanction(user,key,input) {
  requireSection(user,'arbitraje');
  return tx(()=>{
    const item=record('sanction',key);version(input.expected_version,item.version);
    if(!item.official||item.status==='revoked')throw new HttpError(409,'La sanción no está aplicada o ya fue revocada.');
    const command=queue('sanction.revoke','sanction',item,{reason:sanctionReason(input.reason,'Motivo de revocación')},user);
    return{command,resource:save('sanction',{...item,pending_command_id:command.id},item.source)};
  });
}
export function createMatchContent(user,key) {
  requireSection(user,'comunicaciones');
  return tx(()=>{
    const match=record('match',key);
    const teamName=(team)=>typeof team==='string'?team:team?.name||'Equipo';
    const a=teamName(match.team_a),b=teamName(match.team_b);
    let resultLine=null;
    if(match.score_a!==null&&match.score_b!==null)resultLine=`${a} ${match.score_a}–${match.score_b} ${b}`;
    else if(match.winner_side==='a'||(match.winner_id&&match.winner_id===match.team_a?.id))resultLine=`Victoria de ${a} frente a ${b}`;
    else if(match.winner_side==='b'||(match.winner_id&&match.winner_id===match.team_b?.id))resultLine=`Victoria de ${b} frente a ${a}`;
    if(!match.confirmed||!resultLine)throw new HttpError(409,'Hace falta un resultado oficial confirmado para preparar contenido.');
    const ref=`ctp-match:${match.id}:result`;
    const previous=db.prepare('SELECT id FROM contents WHERE source_ref=?').get(ref);
    if(previous)return{id:previous.id,created:false};
    const result=db.prepare(`INSERT INTO contents(title,status,description,copy,notes,source_ref,created_at,updated_at) VALUES(?,'no_listo',?,?,?,?,?,?)`).run(
      `Resultado · ${a} vs ${b}`,`${match.title}\nResultado confirmado: ${resultLine}`,resultLine,
      `Origen: CTP ${match.id}. Revisar identidad, texto y datos antes de publicar.`,ref,now(),now(),
    );
    const contentId=Number(result.lastInsertRowid);
    const insert=db.prepare('INSERT INTO resources(content_id,position,text) VALUES(?,?,?)');
    ['Gráfica del resultado con identidad oficial','Logos autorizados de ambos clubes','Revisión editorial antes de publicación'].forEach((resource,index)=>insert.run(contentId,index,resource));
    audit('match',key,'content.created',user,{content_id:contentId});
    return{id:contentId,created:true};
  });
}
