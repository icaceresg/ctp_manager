import { HttpError } from './auth.js';
import { date as calendarDate } from './validate.js';

export const COMPETITION_ACTIONS = ['tournament.create','tournament.update','tournament.status','tournament.registration','tournament.generate','tournament.publish','tournament.schedule',
  'tournament.delete','tournament.unpublish','tournament.withdraw','tournament.points','tournament.notify','tournament.schedule_rounds',
  'match.resolve','match.revert','veto.prepare','veto.reset','veto.start','veto.staff_gate'];
const fail = message => { throw new HttpError(400,message); };
const text = (value, field, max=2000, optional=false) => {
  if(optional&&(value===null||value===''))return '';
  if(typeof value!=='string'||!value.trim()||value.length>max)fail(`${field} no válido.`);
  return value.trim();
};
const integer = (value,min,max,field) => { if(!Number.isInteger(value)||value<min||value>max)fail(`${field}: usa un entero entre ${min} y ${max}.`);return value; };
const timestamp = (value,field,optional=false) => {
  if(optional&&(value===null||value===''))return null;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d/.test(value)||!Number.isFinite(Date.parse(value)))fail(`${field} no válida.`);
  calendarDate(value.slice(0,10));
  return new Date(value).toISOString();
};
const oneOf = (value, values, field) => {if(!values.includes(value))fail(`${field} no válido.`);return value;};
const reason = value => {const valueText=text(value,'Motivo',500);if(valueText.length<12)fail('Explica el motivo con al menos 12 caracteres.');return valueText;};
const optionalLink=(value,field)=>{if(value==null||value==='')return null;const cleaned=text(value,field,2000);if(cleaned.startsWith('/')&&!cleaned.startsWith('//')&&!/[\\\u0000-\u0020]/.test(cleaned))return cleaned;let parsed;try{parsed=new URL(cleaned);}catch{fail(`${field}: utiliza una dirección HTTPS.`);}if(parsed.protocol!=='https:'||parsed.username||parsed.password)fail(`${field}: utiliza una dirección HTTPS sin credenciales.`);return parsed.href;};
const ROUND_KEYS = ['groups','256','128','64','32','16','8','4','2','third'];
const POINT_STAGES = ['champion','runnerUp','semifinals','third','fourth','quarterfinals','round16','round32','round64','round128','round256','groups'];

/** Explicit allowlist shared by preparation and the transport; never forwards raw form input. */
export function competitionPayload(type,input={}) {
  if(!input||typeof input!=='object'||Array.isArray(input))fail('Solicitud de competición no válida.');
  if(!COMPETITION_ACTIONS.includes(type))fail('Acción de competición no admitida.');
  if(type==='tournament.status')return {status:oneOf(input.status,['borrador','inscripcion_abierta','en_curso','finalizado','cancelado'],'Estado'),reason:reason(input.reason)};
  if(type==='tournament.registration'){
    if(typeof input.approve!=='boolean')fail('Decisión de inscripción no válida.');
    return {approve:input.approve,reason:reason(input.reason)};
  }
  if(type==='tournament.generate')return {phase:oneOf(input.phase,['groups','direct','playoffs'],'Fase'),...(input.round_minutes===undefined?{}:{round_minutes:integer(input.round_minutes,15,720,'Duración de ronda')})};
  if(type==='tournament.publish')return {phase:oneOf(input.phase,['groups','playoffs'],'Fase')};
  if(type==='tournament.schedule')return {scheduled_at:timestamp(input.scheduled_at,'Horario'),reason:reason(input.reason)};
  if(type==='tournament.delete')return {reason:reason(input.reason),confirm_name:text(input.confirm_name,'Nombre de confirmación',120)};
  if(type==='tournament.unpublish')return {phase:oneOf(input.phase,['groups','playoffs'],'Fase'),reason:reason(input.reason)};
  if(['tournament.withdraw','tournament.points','match.revert','veto.prepare','veto.reset','veto.start'].includes(type))return {reason:reason(input.reason)};
  if(type==='match.resolve')return {maps_a:integer(input.maps_a,0,9,'Mapas A'),maps_b:integer(input.maps_b,0,9,'Mapas B'),reason:reason(input.reason)};
  if(type==='veto.staff_gate'){if(typeof input.enabled!=='boolean')fail('Protección de veto no válida.');return {enabled:input.enabled,reason:reason(input.reason)};}
  if(type==='tournament.notify')return {text:text(input.text,'Aviso',2000),reason:reason(input.reason)};
  if(type==='tournament.schedule_rounds')return {first_match_at:timestamp(input.first_match_at,'Primer encuentro'),minutes_per_round:integer(input.minutes_per_round,15,720,'Duración de ronda'),reason:reason(input.reason)};
  const out={};
  for(const field of ['name','game_id','game_mode','participant_type','kind','rules','description']){
    if(input[field]!==undefined)out[field]=text(input[field],field,field==='rules'?10000:field==='description'?5000:field==='name'?120:field==='game_mode'?60:160,['rules','description'].includes(field));
  }
  for(const [field,min,max] of [['season',1,4],['max_participants',2,256],['min_participants',2,256],['roster_min',1,12],['roster_max',1,12],['group_count',1,64],['best_of_groups',1,9],['best_of_playoffs',1,9],['best_of_final',1,9]]){
    if(input[field]!==undefined){if(['season','group_count'].includes(field)&&input[field]===null){out[field]=null;continue;}out[field]=integer(input[field],min,max,field);if(field.startsWith('best_of_')&&out[field]%2!==1)fail('Las series deben tener un número impar de mapas.');}
  }
  for(const field of ['has_group_stage','has_third_place_match'])if(input[field]!==undefined){if(typeof input[field]!=='boolean')fail(`${field} no válido.`);out[field]=input[field];}
  if(input.seeding_mode!==undefined){
    if(!['random','season_points'].includes(input.seeding_mode))fail('manager.tournamentSettings.error.invalidFormat');
    out.seeding_mode=input.seeding_mode;
  }
  if(input.seeding_season!==undefined){
    if(input.seeding_season!==null&&![1,2,3,4].includes(input.seeding_season))fail('manager.tournamentSettings.error.invalidFormat');
    out.seeding_season=input.seeding_season;
  }
  if(input.points_credit_season!==undefined){
    if(input.points_credit_season!==null&&![1,2,3,4].includes(input.points_credit_season))fail('manager.tournamentSettings.error.invalidFormat');
    out.points_credit_season=input.points_credit_season;
  }
  if(input.points_by_finish!==undefined){
    const stages=input.points_by_finish;
    if(!stages||typeof stages!=='object'||Array.isArray(stages)||Object.entries(stages).some(([stage,value])=>!POINT_STAGES.includes(stage)||!Number.isInteger(value)||value<0||value>1000000))fail('manager.tournamentSettings.error.invalidFormat');
    out.points_by_finish=stages;
  }
  if(input.best_of_by_round!==undefined){
    const rounds=input.best_of_by_round;
    if(!rounds||typeof rounds!=='object'||Array.isArray(rounds)||Object.entries(rounds).some(([key,value])=>!ROUND_KEYS.includes(key)||![1,3,5,7,9].includes(value)))fail('manager.tournamentSettings.error.invalidFormat');
    out.best_of_by_round=rounds;
  }
  if(input.allow_roster_edits_after_close!==undefined){
    if(typeof input.allow_roster_edits_after_close!=='boolean')fail('manager.tournamentSettings.error.invalidFormat');
    out.allow_roster_edits_after_close=input.allow_roster_edits_after_close;
  }
  for(const field of ['start_at','registration_close_at'])if(input[field]!==undefined)out[field]=timestamp(input[field],field);
  if(input.registration_open_at!==undefined)out.registration_open_at=timestamp(input.registration_open_at,'Apertura de inscripción',true);
  if(input.draw_visible_at!==undefined){
    if(input.draw_visible_at===null)out.draw_visible_at=null;
    else if(typeof input.draw_visible_at!=='string'||!Number.isFinite(Date.parse(input.draw_visible_at)))fail('tournaments.staff.drawVisibilityWindow');
    else out.draw_visible_at=new Date(input.draw_visible_at).toISOString();
  }
  for(const field of ['image_url','rules_pdf_url','stream_url'])if(input[field]!==undefined)out[field]=optionalLink(input[field],field);
  if(input.host_club_id!==undefined){if(input.host_club_id!==null&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.host_club_id))fail('Club anfitrión no válido.');out.host_club_id=input.host_club_id;}
  for(const [field,max]of [['banner',64],['region',80],['contact_info',2000]])if(input[field]!==undefined)out[field]=text(input[field],field,max,true);
  if(input.format!==undefined)out.format=oneOf(input.format,['eliminacion_simple'],'Formato');
  if(input.platforms!==undefined){if(!Array.isArray(input.platforms)||!input.platforms.length||input.platforms.length>6||new Set(input.platforms).size!==input.platforms.length)fail('Plataformas no válidas.');out.platforms=input.platforms.map(value=>oneOf(value,['PC','PlayStation','Xbox','Switch','Movil','Otra'],'Plataforma'));}
  if(input.description_i18n!==undefined){if(!input.description_i18n||typeof input.description_i18n!=='object'||Array.isArray(input.description_i18n)||Object.keys(input.description_i18n).length>12)fail('Traducciones no válidas.');out.description_i18n=Object.fromEntries(Object.entries(input.description_i18n).map(([locale,value])=>{if(!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(locale))fail('Idioma no válido.');return[locale,text(value,'Descripción traducida',5000,true)];}));}
  if(input.pick_ban_turn_seconds!==undefined)out.pick_ban_turn_seconds=integer(input.pick_ban_turn_seconds,5,300,'Reloj de veto');
  if(input.pick_ban_mode_rotation!==undefined){if(!Array.isArray(input.pick_ban_mode_rotation)||input.pick_ban_mode_rotation.length>9)fail('Rotación de modos no válida.');out.pick_ban_mode_rotation=input.pick_ban_mode_rotation.map(value=>text(value,'Modo de veto',60));}
  if(input.points_per_position!==undefined){if(!Array.isArray(input.points_per_position)||input.points_per_position.length>32||new Set(input.points_per_position.map(row=>row?.position)).size!==input.points_per_position.length)fail('Tabla de puntos no válida.');out.points_per_position=input.points_per_position.map(row=>({position:integer(row?.position,1,64,'Posición'),points:integer(row?.points,0,1000000,'Puntos'),label:text(row?.label,'Etapa',120)}));}
  if(type==='tournament.create')for(const field of ['name','game_id','game_mode','start_at','registration_close_at','participant_type','max_participants','min_participants','roster_min','roster_max'])if(out[field]===undefined)fail(`Falta ${field}.`);
  if(!Object.keys(out).length)fail('No hay cambios de torneo.');
  if(out.name!==undefined&&out.name.length<3)fail('El nombre necesita al menos tres caracteres.');
  if(out.participant_type!==undefined)oneOf(out.participant_type,['individual','equipo','ambos'],'Participación');
  if(out.kind!==undefined)oneOf(out.kind,['cup','major','personalizado','fuera_de_circuito','champ','champs'],'Tipo de torneo');
  if(type==='tournament.create'&&['cup','major'].includes(out.kind)&&out.season==null)fail('CUP y MAJOR requieren una temporada entre 1 y 4.');
  if(out.max_participants!==undefined&&out.min_participants!==undefined&&out.min_participants>out.max_participants)fail('El mínimo de participantes supera al máximo.');
  if(out.roster_min!==undefined&&out.roster_max!==undefined&&out.roster_min>out.roster_max)fail('El mínimo del roster supera al máximo.');
  if(out.registration_close_at&&out.start_at&&Date.parse(out.registration_close_at)>=Date.parse(out.start_at))fail('La inscripción debe cerrar antes del inicio.');
  if(out.registration_open_at&&out.registration_close_at&&Date.parse(out.registration_open_at)>=Date.parse(out.registration_close_at))fail('La apertura debe ser anterior al cierre de inscripción.');
  if(out.draw_visible_at&&((out.registration_close_at&&Date.parse(out.draw_visible_at)<Date.parse(out.registration_close_at))
    ||(out.start_at&&Date.parse(out.draw_visible_at)>Date.parse(out.start_at))))fail('tournaments.staff.drawVisibilityWindow');
  if(new TextEncoder().encode(JSON.stringify(out)).length>8192)fail('La propuesta supera el tamaño permitido por CTP. Reduce la descripción o el reglamento.');
  return out;
}

export function correctionPayload(input={}) {
  const out={reason:reason(input.reason),players:[]};
  if(!Array.isArray(input.players)||input.players.length!==8)fail('La corrección debe incluir los ocho jugadores inscritos.');
  const ids=new Set();
  for(const player of input.players){
    if(!player||typeof player!=='object'||Array.isArray(player))fail('Fila de jugador no válida.');
    const user_id=text(player.user_id,'Jugador',160);
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user_id))fail('Identificador de jugador no válido.');
    if(ids.has(user_id))fail('No repitas jugadores en la corrección.');
    ids.add(user_id);
    const row={user_id};
    for(const field of ['score','kills','deaths','assists','objective'])if(player[field]!==undefined){
      if(player[field]===null)row[field]=null;
      else {const max=field==='score'?1000000:field==='objective'?86400:1000;if(!Number.isSafeInteger(player[field])||player[field]<0||player[field]>max)fail(`${field}: usa un entero entre 0 y ${max}.`);row[field]=player[field];}
    }
    if(!Object.entries(row).some(([field,value])=>field!=='user_id'&&value!==null))fail('Cada jugador corregido necesita al menos una cifra conocida.');
    out.players.push(row);
  }
  return out;
}

/** In progress first, then upcoming (soonest first), then past (most recent first). Missing dates go last. */
export function tournamentsByProximity(items, now = Date.now()) {
  const key = tournament => {
    const start = Date.parse(tournament.start_at);
    const dated = Number.isFinite(start);
    const group = tournament.status === 'en_curso' ? 0 : dated && start >= now ? 1 : 2;
    return [group, dated ? Math.abs(start - now) : Infinity, String(tournament.id)];
  };
  return items.map(item => [key(item), item])
    .sort(([[groupA, distanceA, idA]], [[groupB, distanceB, idB]]) => groupA - groupB || (distanceA === distanceB ? idA.localeCompare(idB) : distanceA < distanceB ? -1 : 1))
    .map(([, item]) => item);
}
