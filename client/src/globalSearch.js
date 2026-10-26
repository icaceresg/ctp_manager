import {canManageRanked} from '../../shared/access.js';
import {managerUserId,playerWorkspacePath} from './navigation.js';
import {rankedPhaseLabel} from '../../shared/ranked-lobby-presentation.js';

const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max=160)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const invalid=()=>{throw new Error('invalid-search-response');};
export function globalSearchContext(me,can=()=>false){
  return {actor:JSON.stringify([me?.id??null,me?.auth_mode??null,me?.ctp_user_id??null,me?.ctp_role??null,Boolean(me?.is_admin)]),
    players:canManageRanked(me),tickets:Boolean(me?.id&&can('arbitraje'))};
}
export function globalSearchQuery(value){
  return text(value,120)?value.trim():null;
}
export function globalSearchKey(context,query){return JSON.stringify([context.actor,context.players,context.tickets,globalSearchQuery(query)]);}
export function globalSearchPlan(context,raw){
  const query=globalSearchQuery(raw),sources=[];
  if(query===null||query.length<2)return {query,sources};
  if(context.players)sources.push({kind:'players',url:'/players?'+new URLSearchParams({query,limit:'5'})});
  if(context.tickets)sources.push({kind:'tickets',url:'/operations/bootstrap?'+new URLSearchParams({view:'incidencias',q:query,limit:'5'})});
  const lobbyId=managerUserId(query)?.toLowerCase();
  if(context.players&&lobbyId)sources.push({kind:'lobby',url:`/operations/ranked/lobbies/${lobbyId}`});
  return {query,sources};
}
export function globalSearchInitial(context,raw){
  const {query,sources}=globalSearchPlan(context,raw),waiting=new Set(sources.map(source=>source.kind));
  return {key:globalSearchKey(context,raw),query,error:query===null?'Escribe una consulta de hasta 120 caracteres sin controles.':null,
    players:{status:!context.players?'forbidden':waiting.has('players')?'waiting':'idle',items:[]},
    tickets:{status:!context.tickets?'forbidden':waiting.has('tickets')?'waiting':'idle',items:[]},
    lobby:{status:!context.players?'forbidden':waiting.has('lobby')?'waiting':'hint',items:[]}};
}
/** Only known fields form labels; every destination is built here, never supplied by a result. */
export function globalSearchProjection(kind,value,query){
  if(kind==='players'){
    if(!object(value)||value.operation!=='search'||value.query!==query||!Array.isArray(value.items)||value.items.length>5)invalid();
    return value.items.map(row=>{
      const id=managerUserId(row?.id)?.toLowerCase();
      if(!id||!text(row.username,100)||!row.username.trim())invalid();
      const aliases=[row.gamertag,row.activision_id].filter(value=>typeof value==='string'&&value);
      if(aliases.some(value=>!text(value,100)))invalid();
      return {id:'player:'+id,type:'Jugador',title:row.username,detail:aliases.join(' · '),to:playerWorkspacePath(id)};
    });
  }
  if(kind==='tickets'){
    if(!object(value)||!Array.isArray(value.incidents)||value.incidents.length>5)invalid();
    return value.incidents.map(row=>{
      if(!object(row)||!text(row.id,160)||!row.id||!text(row.title,300)||!text(row.status,80))invalid();
      return {id:'ticket:'+row.id,type:row.source==='ctp'?'Ticket CTP · copia sincronizada':'Incidencia local',title:row.title||'Incidencia sin título',detail:row.status,
        to:'/operaciones/incidencias?'+new URLSearchParams({case:row.id,state:'all'})};
    });
  }
  if(kind==='lobby'){
    const id=managerUserId(query)?.toLowerCase(),lobby=value?.lobby;
    if(!id||!object(lobby)||lobby.id?.toLowerCase()!==id||!['voting','drafting','ready','reported','disputed','closed','cancelled'].includes(lobby.status)
      ||lobby.map_name!==null&&!text(lobby.map_name,120))invalid();
    return [{id:'lobby:'+id,type:'Partida Ranked',title:`Ranked · ${id.slice(0,8)}`,detail:`${rankedPhaseLabel(lobby)}${lobby.map_name?' · '+lobby.map_name:''}`,to:`/ranked/partidas/${id}`}];
  }
  invalid();
}

/** Each run owns an AbortController and generation. Even transports ignoring abort cannot publish old data. */
export function createGlobalSearch(get){
  let current=null;
  return {
    cancel(){if(current){current.controller.abort();current=null;}},
    run(context,raw,publish){
      this.cancel();
      const run={controller:new AbortController()},plan=globalSearchPlan(context,raw);
      current=run;
      let state=globalSearchInitial(context,raw);
      const emit=()=>{if(current===run&&!run.controller.signal.aborted)publish(state);};
      state={...state,...Object.fromEntries(plan.sources.map(source=>[source.kind,{status:'loading',items:[]}]))};emit();
      const done=Promise.all(plan.sources.map(async source=>{
        try{
          const value=await get(source.url,{signal:run.controller.signal});
          if(current!==run||run.controller.signal.aborted)return;
          state={...state,[source.kind]:{status:'ready',items:globalSearchProjection(source.kind,value,plan.query)}};
        }catch(error){
          if(current!==run||run.controller.signal.aborted)return;
          const status=error.status===403?'forbidden':error.status===401?'session':error.status===404&&source.kind==='lobby'?'ready':'error';
          state={...state,[source.kind]:{status,items:[]}};
        }
        emit();
      }));
      return {done,cancel:()=>{if(current===run){run.controller.abort();current=null;}}};
    },
  };
}
