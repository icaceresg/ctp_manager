import { HttpError } from './auth.js';
export const GUARD_ACTIONS = Object.freeze(['guard.configure','guard.exempt','guard.start']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const count=(value,max)=>Number.isSafeInteger(value)&&value>=0&&value<=max?value:null;
const coverage=value=>['not_collected','available','partial','unavailable'].includes(value)?value:'unknown';
const optionalBool=value=>typeof value==='boolean'?value:null;
/** Only bounded counters and coverage reach the staff browser. Never project
 * device identities, rule IDs, network destinations or process paths. */
function pcReport(player) {
 const observation=object(player.observation)?player.observation:null,security=object(player.security_observation)?player.security_observation:null;
 return {monitoring_current:optionalBool(player.monitoring_current),review_required:optionalBool(player.review_required),
  observation:observation?{process_inventory:coverage(observation.process_inventory),network_metadata:coverage(observation.network_metadata),
   integrity:['self_reported','unavailable'].includes(observation.integrity)?observation.integrity:'unknown',process_count:count(observation.process_count,512),connection_count:count(observation.connection_count,4096),rule_matches:count(observation.rule_matches,32)}:null,
  security_observation:security?{release_integrity:['verified','mismatch','unavailable'].includes(security.release_integrity)?security.release_integrity:'unknown',
   process_file_identity:coverage(security.process_file_identity),files_checked:count(security.files_checked,512),rule_matches:count(security.rule_matches,8)}:null};
}
export function guardId(v){if(typeof v!=='string'||!uuid.test(v))throw new HttpError(400,'Identificador de partido no válido.');return v;}
export function guardReadOptions(query={}) {
 if(!query||typeof query!=='object'||Array.isArray(query)||Object.keys(query).some(key=>key!=='include_events')
  ||query.include_events!==undefined&&!['true','false'].includes(query.include_events))throw new HttpError(400,'La consulta de Guard no es válida.');
 return {includeEvents:query.include_events!=='false'};
}
export function guardPayload(type,p){
 const keys=type==='guard.configure'?['enabled','controller_required','capture_required','reason']:type==='guard.exempt'?['user_id','approve','reason']:[];
 if(!GUARD_ACTIONS.includes(type)||!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!keys.includes(k)))throw new HttpError(400,'Acción Guard no válida.');
 if(type==='guard.start')return {};
 if(typeof p.reason!=='string'||p.reason.trim().length<12||p.reason.length>160)throw new HttpError(400,'Explica el motivo entre 12 y 160 caracteres.');
 if(type==='guard.configure'){
  if(['enabled','controller_required','capture_required'].some(k=>typeof p[k]!=='boolean'))throw new HttpError(400,'Requisitos Guard no válidos.');
  return {enabled:p.enabled,controller_required:p.controller_required,capture_required:p.capture_required,reason:p.reason.trim()};
 }
 if(typeof p.approve!=='boolean')throw new HttpError(400,'Verificación de consola no válida.');
 return {user_id:guardId(p.user_id),approve:p.approve,reason:p.reason.trim()};
}
export function guardState(v,id){
 if(!v||typeof v.enabled!=='boolean'||v.match_id!==id||!uuid.test(v.tournament_id??'')||!Number.isInteger(v.match_version)||v.match_version<1
  ||!Number.isInteger(v.tournament_version)||v.tournament_version<1||!Number.isFinite(Date.parse(v.observed_at)))throw new HttpError(502,'CTP ha devuelto un estado Guard incompleto.');
 const states=['ready','console_verified','guard_not_connected','signal_lost','controller_missing','camera_missing','capture_missing'];
 const players=v.players??[];
 if(!Array.isArray(players)||players.length>24||new Set(players.map(p=>p.user_id)).size!==players.length||players.some(p=>!uuid.test(p.user_id??'')||!['a','b'].includes(p.side)||!states.includes(p.state)))throw new HttpError(502,'CTP ha devuelto una alineación Guard no válida.');
 const ready=v.enabled&&v.ready===true&&players.length===8&&['a','b'].every(side=>players.filter(p=>p.side===side).length===4)&&players.every(p=>['ready','console_verified'].includes(p.state));
 const str=(x,n)=>typeof x==='string'?x.slice(0,n):null;
 return {enabled:v.enabled,match_id:id,tournament_id:v.tournament_id,match_version:v.match_version,tournament_version:v.tournament_version,observed_at:v.observed_at,
  ready,started_at:str(v.started_at,50),lineup_pending:v.lineup_pending===true,controller_required:v.controller_required===true,capture_required:v.capture_required===true,camera_required:v.camera_required===true,
  expected_count:8,players:players.map(p=>({user_id:p.user_id,side:p.side,username:str(p.username,100)||'Jugador',state:p.state,last_seen_at:str(p.last_seen_at,50),reason:str(p.reason,64),...pcReport(p)})),
  events:Array.isArray(v.events)?v.events.slice(0,30).map(e=>({id:String(e.id).slice(0,30),user_id:uuid.test(e.user_id??'')?e.user_id:null,kind:str(e.kind,40),created_at:str(e.created_at,50)})):[]};
}
