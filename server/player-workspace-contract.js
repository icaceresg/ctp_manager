import {HttpError} from './auth.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const invalid=()=>{throw new HttpError(400,'La consulta de jugadores no es válida.');};
const incomplete=()=>{throw new HttpError(502,'CTP ha devuelto una ficha de jugador incompleta.');};
const integer=(value,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&value>=0&&value<=max?value:incomplete();
const text=(value,max=160)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)?value:incomplete();
const nullable=(value,clean)=>value===null?null:clean(value);
const id=value=>typeof value==='string'&&UUID.test(value)?value.toLowerCase():incomplete();
const date=value=>typeof value==='string'&&value.length<=40&&Number.isFinite(Date.parse(value))?value:incomplete();
const bool=value=>typeof value==='boolean'?value:incomplete();
const oneOf=(value,values)=>values.includes(value)?value:incomplete();
const rows=(value,max,clean)=>Array.isArray(value)&&value.length<=max?value.map(row=>object(row)?clean(row):incomplete()):incomplete();
export const PLAYER_WORKSPACE_ERRORS=Object.freeze({player_workspace_forbidden:'No tienes permiso para consultar jugadores.',player_workspace_invalid:'La consulta de jugadores no es válida.',player_workspace_not_found:'La cuenta no está disponible en CTP.'});
export function playerWorkspaceId(value){if(typeof value!=='string'||!UUID.test(value))invalid();return value.toLowerCase();}
export function playerWorkspaceQuery(raw={}){
 if(!object(raw))invalid();
 const operation=raw.operation??'search';
 const keys=operation==='search'?['operation','query','offset','limit']:operation==='detail'?['operation','user_id','limit','results_offset','tickets_offset','sanctions_offset']:invalid();
 if(Object.keys(raw).some(key=>!keys.includes(key)))invalid();
 const out={operation,limit:raw.limit??20};
 if(!Number.isSafeInteger(out.limit)||out.limit<1||out.limit>25)invalid();
 for(const key of keys.filter(key=>key.endsWith('offset'))){out[key]=raw[key]??0;if(!Number.isSafeInteger(out[key])||out[key]<0||out[key]>999999)invalid();}
 if(operation==='search'){
  if(raw.query!==undefined&&(typeof raw.query!=='string'||raw.query.length>120||/[\u0000-\u001f\u007f]/.test(raw.query)))invalid();
  out.query=(raw.query??'').trim();
 }else out.user_id=playerWorkspaceId(raw.user_id);
 return out;
}
function person(value){
 if(!object(value))incomplete();
 return{id:id(value.id),username:text(value.username,100),gamertag:nullable(value.gamertag,v=>text(v,100)),activision_id:nullable(value.activision_id,v=>text(v,100)),
  platform:text(value.platform,40),role:oneOf(value.role,['player','admin','referee']),created_at:date(value.created_at)};
}
function page(value,query,key,available,clean){
 if(!object(value)||value.available!==available||value.offset!==query[key]||value.limit!==query.limit)incomplete();
 const out={available:bool(value.available),offset:integer(value.offset,999999),limit:integer(value.limit,25),total:nullable(value.total,integer),has_more:bool(value.has_more),items:rows(value.items,query.limit,clean)};
 if(!available&&(out.total!==null||out.has_more||out.items.length)||available&&(out.total===null||out.items.length!==Math.min(out.limit,Math.max(0,out.total-out.offset))||out.has_more!==(out.total>out.offset+out.limit)))incomplete();
 return out;
}
/** A whitelist projection: emails, tokens, raw Auth rows and private bodies are never copied. */
export function playerWorkspaceResponse(value,rawQuery){
 const query=playerWorkspaceQuery(rawQuery);
 if(!object(value)||value.schema_version!==1||value.operation!==query.operation||!object(value.viewer))incomplete();
 const viewer={can_edit:bool(value.viewer.can_edit),can_view_tickets:bool(value.viewer.can_view_tickets),can_view_sanctions:bool(value.viewer.can_view_sanctions)};
 const base={schema_version:1,operation:query.operation,observed_at:date(value.observed_at),viewer};
 if(query.operation==='search'){
  if(value.offset!==query.offset||value.limit!==query.limit||typeof value.query!=='string'||value.query!==query.query)incomplete();
  const items=rows(value.items,query.limit,person),total=integer(value.total);
  if(items.length!==Math.min(query.limit,Math.max(0,total-query.offset))||new Set(items.map(row=>row.id)).size!==items.length)incomplete();
  return{...base,query:value.query,offset:query.offset,limit:query.limit,total,items};
 }
 const user=person(value.user);if(user.id!==query.user_id)incomplete();
 Object.assign(user,{closed:bool(value.user.closed),email_confirmed:bool(value.user.email_confirmed),login_banned_until:nullable(value.user.login_banned_until,date)});
 const clubs=rows(value.clubs,10,row=>({id:id(row.id),name:text(row.name,120),role:text(row.role,60)}));
 const rating=nullable(value.rating,row=>{
  if(!object(row))incomplete();
  const out={game_id:text(row.game_id,100),season_id:id(row.season_id),xp:integer(row.xp),peak_xp:integer(row.peak_xp),wins:integer(row.wins),losses:integer(row.losses),games:integer(row.games),
   division_id:nullable(row.division_id,v=>oneOf(v,['bronze','silver','gold','platinum','diamond','crimson','iridescent'])),win_streak:integer(row.win_streak),updated_at:date(row.updated_at)};
  if(out.games!==out.wins+out.losses||out.peak_xp<out.xp)incomplete();return out;
 });
 if(!object(value.participation))incomplete();const current=value.participation;
 const participation={state:oneOf(current.state,['idle','queued','presence_expired','in_lobby']),
  queue:nullable(current.queue,row=>({id:id(row.id),title:text(row.title,120),game_id:text(row.game_id,100),mode:text(row.mode,80)})),
  joined_at:nullable(current.joined_at,date),presence_expires_at:nullable(current.presence_expires_at,date),party_id:nullable(current.party_id,id),
  lobby:nullable(current.lobby,row=>({id:id(row.id),status:oneOf(row.status,['voting','drafting','ready','reported','disputed']),map_name:nullable(row.map_name,v=>text(v,120)),side:nullable(row.side,v=>oneOf(v,['a','b'])),created_at:date(row.created_at),deadline_at:nullable(row.deadline_at,date)}))};
 if(participation.state==='in_lobby'&&!participation.lobby||participation.state==='queued'&&(!participation.queue||!participation.presence_expires_at||Date.parse(participation.presence_expires_at)<=Date.parse(base.observed_at)))incomplete();
 const results=page(value.results,query,'results_offset',true,row=>({id:id(row.id),status:oneOf(row.status,['closed','cancelled']),map_name:nullable(row.map_name,v=>text(v,120)),
  winner:nullable(row.winner,v=>oneOf(v,['a','b'])),my_side:nullable(row.my_side,v=>oneOf(v,['a','b'])),created_at:date(row.created_at),closed_at:nullable(row.closed_at,date),game_id:text(row.game_id,100),queue_title:text(row.queue_title,120),mode:nullable(row.mode,v=>text(v,80)),
  xp_delta:nullable(row.xp_delta,v=>Number.isSafeInteger(v)?v:incomplete()),new_xp:nullable(row.new_xp,integer),season_id:nullable(row.season_id,id)}));
 const tickets=page(value.tickets,query,'tickets_offset',viewer.can_view_tickets,row=>({id:id(row.id),code:text(row.code,120),type:text(row.type,80),status:text(row.status,80),priority:text(row.priority,40),created_at:date(row.created_at),updated_at:date(row.updated_at)}));
 const sanctions=page(value.sanctions,query,'sanctions_offset',viewer.can_view_sanctions,row=>({id:id(row.id),source:oneOf(row.source,['sanction','ranked_ban']),kind:text(row.kind,80),scopes:Array.isArray(row.scopes)&&row.scopes.length<=8?row.scopes.map(v=>text(v,80)):incomplete(),reason:text(row.reason,2000),starts_at:date(row.starts_at),ends_at:date(row.ends_at),created_at:date(row.created_at),status:oneOf(row.status,['revoked','scheduled','expired','active'])}));
 return{...base,user,clubs,rating,participation,results,tickets,sanctions};
}
