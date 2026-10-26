import {HttpError} from './auth.js';
const fail=()=>{throw new HttpError(502,'CTP ha devuelto un detalle de Ranked incompleto.');};
export function rankedLobbyId(value){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new HttpError(400,'La referencia de la partida no es válida.');return value.toLowerCase();}
export function rankedChatCursor(value){if(value==null)return null;if(typeof value!=='string'||!/^[1-9][0-9]{0,18}$/.test(value)||BigInt(value)>9223372036854775807n)throw new HttpError(400,'La página del chat no es válida.');return value;}
export function rankedChatRequest(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['message','request_id'].includes(key)))throw new HttpError(400,'La solicitud del mensaje no es válida.');
 if(typeof value.request_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.request_id))throw new HttpError(400,'La referencia del mensaje no es válida.');
 if(typeof value.message!=='string')throw new HttpError(400,'Escribe un mensaje de entre 1 y 800 caracteres.');
 const message=value.message.trim();
 if(!message||Array.from(message).length>800||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message))throw new HttpError(400,'Escribe un mensaje de entre 1 y 800 caracteres, sin caracteres de control.');
 return{request_id:value.request_id.toLowerCase(),message};
}
/** A manual Ranked decision: give the win to one team or cancel the match without XP changes. */
export function rankedDecisionRequest(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['decision','side','reason','request_id'].includes(key)))throw new HttpError(400,'La decisión no es válida.');
 if(typeof value.request_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.request_id))throw new HttpError(400,'La referencia de la decisión no es válida.');
 if(!['winner','cancel'].includes(value.decision))throw new HttpError(400,'Elige dar la victoria a un equipo o cancelar la partida.');
 if(value.decision==='winner'?!['a','b'].includes(value.side):value.side!==undefined&&value.side!==null)throw new HttpError(400,'Selecciona el equipo ganador.');
 const reason=typeof value.reason==='string'?value.reason.trim():'';
 if(Array.from(reason).length<12||Array.from(reason).length>500||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reason))throw new HttpError(400,'Escribe un motivo de entre 12 y 500 caracteres.');
 return{request_id:value.request_id.toLowerCase(),decision:value.decision,side:value.decision==='winner'?value.side:null,reason};
}
/** Block one player of this match from Ranked for 1 minute to 7 days. The slot and shown name must still match in CTP. */
export function rankedBanRequest(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['slot','username','minutes','reason','request_id'].includes(key)))throw new HttpError(400,'El bloqueo no es válido.');
 if(typeof value.request_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.request_id))throw new HttpError(400,'La referencia del bloqueo no es válida.');
 if(!Number.isSafeInteger(value.slot)||value.slot<1||value.slot>8||typeof value.username!=='string'||!value.username||Array.from(value.username).length>100||CONTROL.test(value.username))throw new HttpError(400,'Selecciona un jugador de la partida.');
 if(!Number.isSafeInteger(value.minutes)||value.minutes<1||value.minutes>10080)throw new HttpError(400,'La duración debe estar entre 1 minuto y 7 días.');
 const reason=typeof value.reason==='string'?value.reason.trim():'';
 if(Array.from(reason).length<12||Array.from(reason).length>500||CONTROL.test(reason))throw new HttpError(400,'Escribe un motivo de entre 12 y 500 caracteres.');
 return{request_id:value.request_id.toLowerCase(),slot:value.slot,username:value.username,minutes:value.minutes,reason};
}
// PostgreSQL length/left count Unicode code points rather than UTF-16 units.
const text=(v,max)=>typeof v==='string'&&Array.from(v).length<=max?v:fail();
const date=v=>typeof v==='string'&&v.length<=40&&Number.isFinite(Date.parse(v))?v:fail();
const optionalDate=v=>v===null?null:date(v);
const number=v=>Number.isSafeInteger(v)&&v>=0?v:fail();
const side=v=>v===null||v==='a'||v==='b'?v:fail();
const bool=v=>typeof v==='boolean'?v:fail();
const authorRole=v=>v===undefined||v===null?null:['admin','referee'].includes(v)?v:fail();
const CONTROL=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const optional=(v,clean)=>v===undefined||v===null?null:clean(v);
// Division ids come from CTP's XP policy (bronze … iridescent); unknown future ids are shown as sent.
const division=v=>typeof v==='string'&&/^[a-z_]{1,40}$/.test(v)?v:fail();
const rows=(v,max,clean)=>Array.isArray(v)&&v.length<=max?v.map(row=>row&&typeof row==='object'&&!Array.isArray(row)?clean(row):fail()):fail();
const SYSTEM={
 'ranked.system.balancedMatchReady':'Partida Ranked preparada: equipos equilibrados y mapa asignado.',
 'ranked.system.xpAwarded':'Resultado confirmado. XP actualizados.',
 'ranked.system.resultConfirmed':'Resultado confirmado por al menos cinco de los ocho jugadores.',
 'ranked.system.resultMajority':'Resultado decidido por mayoría al finalizar el plazo de confirmación.',
 'ranked.system.resultTieDisputed':'Empate en la votación. La partida pasa a revisión.',
 'ranked.system.matchSuspended':'Partida suspendida sin votos de resultado. No cambian los XP.',
};
function systemCopy(value){return value.startsWith('ranked.system.')?(SYSTEM[value]||'Actualización de la partida.'):value;}
export function rankedLobbyDetail(value,expectedId){
 if(!value||value.schema_version!==1||typeof value.found!=='boolean')fail();
 if(!value.found){if(value.lobby_id!==expectedId)fail();return null;}
 const l=value.lobby;if(!l||l.id!==expectedId||!['voting','drafting','ready','reported','disputed','closed','cancelled'].includes(l.status))fail();
 let queue_id;try{queue_id=rankedLobbyId(l.queue_id);}catch{fail();}
 const lobby={id:l.id,queue_id,queue_title:text(l.queue_title,160),game_id:text(l.game_id,100),mode:text(l.mode,80),mode_pending:l.mode_pending===undefined?false:bool(l.mode_pending),status:l.status,map_name:l.map_name===null?null:text(l.map_name,120),created_at:date(l.created_at),closed_at:optionalDate(l.closed_at),deadline_at:optionalDate(l.deadline_at)};
 const players=rows(value.players,8,p=>({slot:number(p.slot),username:p.username===null?null:text(p.username,100),side:side(p.side),is_captain:bool(p.is_captain),result_vote:side(p.result_vote),division:optional(p.division,division),xp:optional(p.xp,number),top50:optional(p.top50,bool),ranked_ban_until:optional(p.ranked_ban_until,date)}));
 if(players.some(p=>p.slot<1||p.slot>8)||new Set(players.map(p=>p.slot)).size!==players.length)fail();
 const r=value.result;if(!r)fail();
 const result={winner:side(r.winner),resolution:r.resolution===null?null:systemCopy(text(r.resolution,2000)),resolution_truncated:bool(r.resolution_truncated),votes_a:number(r.votes_a),votes_b:number(r.votes_b),confirmations_required:number(r.confirmations_required),opens_at:optionalDate(r.opens_at),decides_at:optionalDate(r.decides_at),suspends_at:optionalDate(r.suspends_at)};
 if(result.votes_a+result.votes_b>8||result.confirmations_required<1||result.confirmations_required>8)fail();
 const chat=value.chat;if(!chat)fail();
 const messages=rows(chat.messages,50,m=>{const is_system=bool(m.is_system),message=text(m.message,800);let id;try{id=rankedChatCursor(m.id);}catch{fail();}if(id===null)fail();const author_role=authorRole(m.author_role);if(is_system&&author_role!==null)fail();return{id,username:m.username===null?null:text(m.username,100),message:is_system?systemCopy(message):message,is_system,author_role,created_at:date(m.created_at)};});
 for(let i=1;i<messages.length;i++)if(BigInt(messages[i].id)<=BigInt(messages[i-1].id))fail();
 let next_before;try{next_before=rankedChatCursor(chat.next_before);}catch{fail();}
 const has_more=bool(chat.has_more);if(has_more&&(!messages.length||next_before!==messages[0].id)||!has_more&&next_before!==null)fail();
 const map_draws=rows(value.map_draws,64,d=>({revision:number(d.revision),map_name:text(d.map_name,120),drawn_at:date(d.drawn_at),skipped_at:optionalDate(d.skipped_at)}));
 // Player disputes (CTP 238): who opened each one, their team, what they wrote and whether it is resolved.
 // null = this CTP version does not send them yet; the open count still comes alone.
 const open_disputes=number(value.open_disputes);
 const disputes=value.disputes===undefined?null:rows(value.disputes,16,d=>({username:d.username===null?null:text(d.username,100),side:side(d.side),reason:text(d.reason,2000),created_at:date(d.created_at),resolved:bool(d.resolved)}));
 if(disputes&&disputes.filter(d=>!d.resolved).length>open_disputes)fail();
 // Player reports (CTP 239): who reported whom in this match, why and when. No user ids.
 // null = this CTP version does not send them yet. reported_slot is the slot the Ranked block expects.
 const player_reports=value.player_reports===undefined?null:rows(value.player_reports,56,r=>{const reported_slot=number(r.reported_slot);if(reported_slot<1||reported_slot>8)fail();return{reporter:text(r.reporter,100),reporter_side:side(r.reporter_side),reported:text(r.reported,100),reported_side:side(r.reported_side),reported_slot,reason:typeof r.reason==='string'&&/^[a-z_]{1,40}$/.test(r.reason)?r.reason:fail(),details:r.details===null||r.details===undefined?null:text(r.details,500),created_at:date(r.created_at)};});
 return {schema_version:1,observed_at:date(value.observed_at),lobby,players,result,chat:{messages,next_before,has_more,can_send:chat.can_send===undefined?false:bool(chat.can_send)},map_draws,open_disputes,disputes,player_reports,can_moderate:value.can_moderate===undefined?false:bool(value.can_moderate)};
}

/** Accept an acknowledged message only for this exact lobby, request and text. */
export function rankedLobbyChatReceipt(value,lobbyId,input){
 if(!value||value.schema_version!==1||value.lobby_id!==lobbyId||value.request_id!==input.request_id||typeof value.replayed!=='boolean')fail();
 const m=value.message;if(!m||m.is_system!==false||!['admin','referee'].includes(m.author_role)||m.message!==input.message)fail();
 let id;try{id=rankedChatCursor(m.id);}catch{fail();}if(!id)fail();
 return{schema_version:1,lobby_id:lobbyId,request_id:input.request_id,replayed:value.replayed,message:{id,username:m.username===null?null:text(m.username,100),message:text(m.message,800),is_system:false,author_role:m.author_role,created_at:date(m.created_at)}};
}

/** A referee/admin decision acknowledged by CTP for exactly this lobby and request. */
export function rankedDecisionReceipt(value,lobbyId,input){
 if(!value||value.schema_version!==1||value.lobby_id!==lobbyId||value.request_id!==input.request_id||value.decision!==input.decision
  ||(value.side??null)!==input.side||!['admin','referee'].includes(value.author_role)||typeof value.replayed!=='boolean')fail();
 return{applied:true,lobby_id:lobbyId,request_id:input.request_id,decision:input.decision,side:input.side};
}
/** A temporary Ranked block acknowledged by CTP for exactly this lobby, request, player and duration. */
export function rankedBanReceipt(value,lobbyId,input){
 if(!value||value.schema_version!==1||value.lobby_id!==lobbyId||value.request_id!==input.request_id||value.slot!==input.slot
  ||value.username!==input.username||value.minutes!==input.minutes||typeof value.replayed!=='boolean')fail();
 return{schema_version:1,lobby_id:lobbyId,request_id:input.request_id,slot:input.slot,username:input.username,minutes:input.minutes,ends_at:date(value.ends_at),replayed:value.replayed};
}
