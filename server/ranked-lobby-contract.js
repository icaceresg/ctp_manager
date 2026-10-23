import {HttpError} from './auth.js';
const fail=()=>{throw new HttpError(502,'CTP ha devuelto un detalle de Ranked incompleto.');};
export function rankedLobbyId(value){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new HttpError(400,'La referencia de la partida no es válida.');return value.toLowerCase();}
export function rankedChatCursor(value){if(value==null)return null;if(typeof value!=='string'||!/^[1-9][0-9]{0,18}$/.test(value)||BigInt(value)>9223372036854775807n)throw new HttpError(400,'La página del chat no es válida.');return value;}
// PostgreSQL length/left count Unicode code points rather than UTF-16 units.
const text=(v,max)=>typeof v==='string'&&Array.from(v).length<=max?v:fail();
const date=v=>typeof v==='string'&&v.length<=40&&Number.isFinite(Date.parse(v))?v:fail();
const optionalDate=v=>v===null?null:date(v);
const number=v=>Number.isSafeInteger(v)&&v>=0?v:fail();
const side=v=>v===null||v==='a'||v==='b'?v:fail();
const bool=v=>typeof v==='boolean'?v:fail();
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
 const lobby={id:l.id,queue_id,queue_title:text(l.queue_title,160),game_id:text(l.game_id,100),mode:text(l.mode,80),status:l.status,map_name:l.map_name===null?null:text(l.map_name,120),created_at:date(l.created_at),closed_at:optionalDate(l.closed_at),deadline_at:optionalDate(l.deadline_at)};
 const players=rows(value.players,8,p=>({slot:number(p.slot),username:p.username===null?null:text(p.username,100),side:side(p.side),is_captain:bool(p.is_captain),result_vote:side(p.result_vote)}));
 if(players.some(p=>p.slot<1||p.slot>8)||new Set(players.map(p=>p.slot)).size!==players.length)fail();
 const r=value.result;if(!r)fail();
 const result={winner:side(r.winner),resolution:r.resolution===null?null:systemCopy(text(r.resolution,2000)),resolution_truncated:bool(r.resolution_truncated),votes_a:number(r.votes_a),votes_b:number(r.votes_b),confirmations_required:number(r.confirmations_required),opens_at:optionalDate(r.opens_at),decides_at:optionalDate(r.decides_at),suspends_at:optionalDate(r.suspends_at)};
 if(result.votes_a+result.votes_b>8||result.confirmations_required<1||result.confirmations_required>8)fail();
 const chat=value.chat;if(!chat)fail();
 const messages=rows(chat.messages,50,m=>{const is_system=bool(m.is_system),message=text(m.message,800);let id;try{id=rankedChatCursor(m.id);}catch{fail();}if(id===null)fail();return{id,username:m.username===null?null:text(m.username,100),message:is_system?systemCopy(message):message,is_system,created_at:date(m.created_at)};});
 for(let i=1;i<messages.length;i++)if(BigInt(messages[i].id)<=BigInt(messages[i-1].id))fail();
 let next_before;try{next_before=rankedChatCursor(chat.next_before);}catch{fail();}
 const has_more=bool(chat.has_more);if(has_more&&(!messages.length||next_before!==messages[0].id)||!has_more&&next_before!==null)fail();
 const map_draws=rows(value.map_draws,64,d=>({revision:number(d.revision),map_name:text(d.map_name,120),drawn_at:date(d.drawn_at),skipped_at:optionalDate(d.skipped_at)}));
 return {schema_version:1,observed_at:date(value.observed_at),lobby,players,result,chat:{messages,next_before,has_more},map_draws,open_disputes:number(value.open_disputes)};
}
