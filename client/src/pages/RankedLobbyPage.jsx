import {useCallback,useEffect,useRef,useState} from 'react';
import {Link,Navigate,useParams} from 'react-router-dom';
import {ArrowLeft,Ban,Flag,Gavel,MessageSquare,RefreshCw,Send,ShieldCheck,Users} from 'lucide-react';
import {api} from '../api.js';
import {useApp} from '../context.jsx';
import {Spinner} from '../components/ui.jsx';
import {Badge,Empty} from '../operations/ui.jsx';
import {dateTime} from '../operations/model.js';
import {canManageRanked} from '../../../shared/access.js';
import {ModeTag,RankTag} from './RankedTags.jsx';
import {BAN_DURATIONS} from './rankedLabels.js';
import '../operations/operations.css';
import './ranked-monitor.css';

const STATUS={voting:'Sorteo de mapa',drafting:'Formando equipos',ready:'Lista para jugar',reported:'Confirmando resultado',disputed:'En revisión',closed:'Finalizada',cancelled:'Cancelada'};
const team=side=>side==='a'?'Equipo A':side==='b'?'Equipo B':'Sin asignar';
/** Player disputes: who opened each one, their team and the message they wrote in CTP. */
function RankedDisputes({lobby,disputes,open}){
 const title=count=><h2><Flag size={18}/> Disputas{count?<span className="muted"> {count}</span>:null}</h2>;
 // Older CTP versions only send the open count.
 if(disputes===null)return open>0||lobby.status==='disputed'?<section className="op-card rl-disputes has-open"><div className="op-section-title"><div>{title()}<p>{open===1?'Hay 1 disputa abierta':`Hay ${open} disputas abiertas`}. CTP todavía no envía quién la ha abierto ni su mensaje.</p></div></div></section>:null;
 if(!disputes.length)return lobby.status==='disputed'?<section className="op-card rl-disputes has-open"><div className="op-section-title"><div>{title()}<p>Ningún jugador ha abierto una disputa: la partida pasó a revisión por empate en la votación del resultado.</p></div></div></section>:null;
 const shownOpen=disputes.filter(d=>!d.resolved).length;
 return <section className={`op-card rl-disputes ${shownOpen?'has-open':''}`}><div className="op-section-title"><div>{title(disputes.length)}<p>Quién ha abierto cada disputa y el mensaje que escribió al reportar la partida.</p></div></div>
  <ol className="rl-dispute-list">{disputes.map((dispute,index)=><li key={`${dispute.created_at}:${index}`} className={dispute.resolved?'is-resolved':''}>
   <header><strong>{dispute.username||'Jugador no disponible'}</strong><span className="muted">{team(dispute.side)}</span><Badge value={dispute.resolved?'resolved':'disputed'}>{dispute.resolved?'Resuelta':'Abierta'}</Badge><time dateTime={dispute.created_at}>{dateTime(dispute.created_at)}</time></header>
   <p>{dispute.reason}</p>
  </li>)}</ol>
  {open>shownOpen&&<p className="muted rl-caption">Hay más disputas abiertas de las que se muestran aquí.</p>}
 </section>;
}
/** Manual arbitration: CTP closes the match at once with this winner (XP applied) or cancels it (no XP). */
function RankedDecision({lobby,players,onApplied}){
 const playable=['ready','reported','disputed'].includes(lobby.status);
 const [decision,setDecision]=useState(playable?'a':'cancel'),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState('');
 const pending=useRef(null),length=Array.from(reason.trim()).length;
 const label=decision==='cancel'?'cancelar la partida sin cambios de XP':`dar la victoria al ${team(decision)}`;
 async function submit(event){
  event.preventDefault();if(busy||length<12||length>500)return;
  if(!window.confirm(`¿Seguro que quieres ${label}? CTP lo aplicará al momento y no se puede deshacer desde Manager.`))return;
  const input={decision:decision==='cancel'?'cancel':'winner',...(decision==='cancel'?{}:{side:decision}),reason:reason.trim()};
  // Keep the reference while the input is unchanged, so an unconfirmed retry cannot apply twice.
  if(!pending.current||JSON.stringify(pending.current.input)!==JSON.stringify(input))pending.current={input,request_id:crypto.randomUUID()};
  setBusy(true);setError('');setDone('');
  try{await api.post(`/operations/ranked/lobbies/${encodeURIComponent(lobby.id)}/decision`,{...input,request_id:pending.current.request_id});pending.current=null;setDone(decision==='cancel'?'Partida cancelada en CTP.':`Victoria registrada para el ${team(decision)}.`);onApplied();}
  catch(cause){setError(cause.message||'No se ha confirmado la decisión. Reintenta para comprobarla sin duplicarla.');}
  finally{setBusy(false);}
 }
 const names=side=>players.filter(p=>p.side===side).map(p=>p.username||'Jugador no disponible').join(', ');
 return <section className="op-card"><div className="op-section-title"><div><h2><Gavel size={18}/> Decisión arbitral</h2><p>Cierra la partida a mano: da la victoria a un equipo (se aplican los XP) o cancélala (nadie gana ni pierde XP).</p></div></div>
  <form className="rl-decision" onSubmit={submit}>
   <fieldset disabled={busy}><legend>Decisión</legend>
    {['a','b'].map(side=><label key={side} className="rl-decision-option"><input type="radio" name="ranked-decision" value={side} checked={decision===side} disabled={!playable} onChange={()=>setDecision(side)}/><span><strong>Victoria para el {team(side)}</strong><small className="muted">{names(side)||'Sin jugadores asignados'}</small></span></label>)}
    <label className="rl-decision-option"><input type="radio" name="ranked-decision" value="cancel" checked={decision==='cancel'} onChange={()=>setDecision('cancel')}/><span><strong>Cancelar partida</strong><small className="muted">Sin ganador y sin cambios de XP.</small></span></label>
   </fieldset>
   {!playable&&<p className="muted rl-caption">La victoria solo se puede dar cuando los equipos y el mapa están asignados.</p>}
   <label htmlFor="ranked-decision-reason">Motivo (lo verán los jugadores en el chat de la partida)</label>
   <textarea id="ranked-decision-reason" rows={3} maxLength={1000} value={reason} disabled={busy} onChange={event=>{setReason(event.target.value);setDone('');}} placeholder="Explica la decisión…"/>
   <div className="rl-chat-compose-actions"><span className="muted">{length}/500 caracteres · mínimo 12.</span><button className={`btn ${decision==='cancel'?'danger':'primary'}`} type="submit" disabled={busy||length<12||length>500}>{busy?'Aplicando…':decision==='cancel'?'Cancelar partida':`Dar victoria al ${team(decision)}`}</button></div>
   {error&&<p className="op-error" role="alert">{error}</p>}
   {done&&<p className="op-notice" role="status">{done}</p>}
  </form>
 </section>;
}
/** Temporary Ranked block: the player cannot search or join Ranked until it ends. */
function RankedBan({lobby,players,onApplied}){
 const choices=players.filter(p=>p.username);
 const [slot,setSlot]=useState(''),[minutes,setMinutes]=useState(60),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState('');
 const pending=useRef(null),length=Array.from(reason.trim()).length,player=choices.find(p=>String(p.slot)===slot);
 const durationTitle=BAN_DURATIONS.find(([value])=>value===minutes)?.[1]||`${minutes} minutos`;
 async function submit(event){
  event.preventDefault();if(busy||!player||length<12||length>500)return;
  if(!window.confirm(`¿Bloquear a ${player.username} de Ranked durante ${durationTitle}? No podrá buscar ni entrar en partidas Ranked hasta que termine.`))return;
  const input={slot:player.slot,username:player.username,minutes,reason:reason.trim()};
  // Keep the reference while the input is unchanged, so an unconfirmed retry cannot block twice.
  if(!pending.current||JSON.stringify(pending.current.input)!==JSON.stringify(input))pending.current={input,request_id:crypto.randomUUID()};
  setBusy(true);setError('');setDone('');
  try{const receipt=await api.post(`/operations/ranked/lobbies/${encodeURIComponent(lobby.id)}/ban`,{...input,request_id:pending.current.request_id});pending.current=null;setReason('');setDone(`${receipt.username} no podrá jugar Ranked hasta el ${dateTime(receipt.ends_at)}.`);onApplied();}
  catch(cause){setError(cause.message||'No se ha confirmado el bloqueo. Reintenta para comprobarlo sin duplicarlo.');}
  finally{setBusy(false);}
 }
 return <section className="op-card"><div className="op-section-title"><div><h2><Ban size={18}/> Bloqueo temporal de Ranked</h2><p>El jugador no podrá buscar ni entrar en partidas Ranked durante el tiempo elegido; si está buscando, sale de la cola al momento. No afecta a su cuenta ni a torneos o retos.</p></div></div>
  <form className="rl-decision" onSubmit={submit}>
   <div className="rl-ban-fields">
    <label>Jugador<select value={slot} disabled={busy} onChange={event=>{setSlot(event.target.value);setDone('');}}><option value="">Selecciona un jugador</option>{choices.map(p=><option key={p.slot} value={p.slot}>{p.username}{p.side?` · ${team(p.side)}`:''}</option>)}</select></label>
    <label>Duración<select value={minutes} disabled={busy} onChange={event=>setMinutes(Number(event.target.value))}>{BAN_DURATIONS.map(([value,title])=><option key={value} value={value}>{title}</option>)}</select></label>
   </div>
   <label htmlFor="ranked-ban-reason">Motivo (queda registrado en CTP)</label>
   <textarea id="ranked-ban-reason" rows={3} maxLength={1000} value={reason} disabled={busy} onChange={event=>{setReason(event.target.value);setDone('');}} placeholder="Explica el motivo del bloqueo…"/>
   <div className="rl-chat-compose-actions"><span className="muted">{length}/500 caracteres · mínimo 12. No se puede bloquear a administradores ni árbitros.</span><button className="btn danger" type="submit" disabled={busy||!player||length<12||length>500}>{busy?'Aplicando…':'Bloquear de Ranked'}</button></div>
   {error&&<p className="op-error" role="alert">{error}</p>}
   {done&&<p className="op-notice" role="status">{done}</p>}
  </form>
 </section>;
}
export default function RankedLobbyPage(){
 const {me}=useApp(),{lobbyId}=useParams();
 const allowed=canManageRanked(me),actorKey=`${me?.id}:${me?.ctp_user_id||''}:${me?.ctp_role||''}`,scope=`${actorKey}:${lobbyId}`;
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[before,setBefore]=useState(null);
 const [draft,setDraft]=useState(''),[sending,setSending]=useState(false),[sendError,setSendError]=useState(''),[sent,setSent]=useState(false);
 const pendingMessage=useRef(null),sendInFlight=useRef(false),currentScope=useRef(scope);currentScope.current=scope;
 const serial=useRef(0),inFlight=useRef(false),chatBox=useRef(null),scrollToLatest=useRef(true);
 const validId=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lobbyId||'');
 const load=useCallback(async()=>{
  if(!allowed||!validId||inFlight.current)return;
  inFlight.current=true;const request=++serial.current;setBusy(true);
  const box=chatBox.current;scrollToLatest.current=!before&&(!box||box.scrollHeight-box.scrollTop-box.clientHeight<80);
  try{const next=await api.get(`/operations/ranked/lobbies/${encodeURIComponent(lobbyId)}${before?'?before='+encodeURIComponent(before):''}`);if(serial.current===request){setData(next);setError('');}}
  catch(cause){if(serial.current===request){setError(cause.message);if([401,403,404].includes(cause.status))setData(null);}}
  finally{if(serial.current===request){inFlight.current=false;setBusy(false);}}
 },[allowed,actorKey,lobbyId,before,validId]);
 useEffect(()=>{setData(null);setError('');void load();return()=>{++serial.current;inFlight.current=false;};},[load]);
 useEffect(()=>{setBefore(null);},[lobbyId]);
 useEffect(()=>{currentScope.current=scope;setDraft('');setSendError('');setSent(false);setSending(false);pendingMessage.current=null;sendInFlight.current=false;return()=>{currentScope.current=null;};},[scope]);
 useEffect(()=>{const visible=()=>{if(!document.hidden)void load();};const timer=setInterval(visible,15000);document.addEventListener('visibilitychange',visible);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visible);};},[load]);
 useEffect(()=>{if(scrollToLatest.current&&chatBox.current)chatBox.current.scrollTop=chatBox.current.scrollHeight;},[data]);
 async function sendMessage(event){
  event.preventDefault();const message=draft.trim(),originScope=scope;
  if(!allowed||!data?.chat.can_send||sendInFlight.current||!message||Array.from(message).length>800)return;
  sendInFlight.current=true;setSending(true);setSendError('');setSent(false);
  try{
   if(pendingMessage.current?.scope!==originScope||pendingMessage.current.message!==message)pendingMessage.current={scope:originScope,message,request_id:crypto.randomUUID()};
   const input=pendingMessage.current;
   const receipt=await api.post(`/operations/ranked/lobbies/${encodeURIComponent(lobbyId)}/chat`,{message:input.message,request_id:input.request_id});
   if(currentScope.current!==originScope)return;
   if(receipt?.lobby_id!==lobbyId||receipt.request_id!==input.request_id||receipt.message?.message!==message||receipt.message.is_system!==false)throw new Error('No se ha podido verificar la confirmación del mensaje.');
   pendingMessage.current=null;setDraft('');setSent(true);setBefore(null);scrollToLatest.current=true;
   // A verified receipt is real data. Retire reads started before this write.
   ++serial.current;inFlight.current=false;setBusy(false);
   setData(previous=>{
    if(!previous||previous.lobby.id!==lobbyId||before)return previous;
    const all=[...previous.chat.messages.filter(item=>item.id!==receipt.message.id),receipt.message].sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:1),messages=all.slice(-50),has_more=previous.chat.has_more||all.length>50;
    return{...previous,chat:{...previous.chat,messages,has_more,next_before:has_more?messages[0].id:null}};
   });
   if(!before)void load();
  }catch(cause){if(currentScope.current===originScope){setSendError(cause.message||'No se ha confirmado el envío. Reintenta para comprobarlo sin duplicarlo.');if([401,403,404].includes(cause.status)){setData(null);setDraft('');pendingMessage.current=null;}}}
  finally{if(currentScope.current===originScope){sendInFlight.current=false;setSending(false);}}
 }
 if(!allowed)return <Navigate to="/operaciones/jornada" replace/>;
 const lobby=data?.lobby,result=data?.result;
 return <div className="page wide op-page rm-page rl-page">
  <Link className="rl-back" to="/ranked/monitor"><ArrowLeft size={16}/> Volver al monitor de Ranked</Link>
  <header className="op-heading"><div><div className="op-eyebrow"><ShieldCheck size={15}/> SUPERVISIÓN DE PARTIDA</div><h1>{lobby?.map_name||'Partida Ranked'}</h1><p>{lobby?.queue_title||'Equipos, resultado y conversación de la partida.'}</p></div><button className="btn primary" disabled={busy||!validId} onClick={()=>void load()}><RefreshCw size={16} className={busy?'spin':''}/> Actualizar</button></header>
  <p className="op-notice rl-readonly">Supervisión de la partida. Administración y arbitraje pueden escribir en el chat (también cuando la partida ha terminado), dar la victoria a un equipo, cancelar la partida y bloquear jugadores de Ranked durante un tiempo.</p>
  {!validId&&<div className="op-error" role="alert">La referencia de la partida no es válida.</div>}
  {error&&<div className="op-error" role="alert">{error}{data?' Se conserva la última lectura correcta.':''}</div>}
  {!data?busy?<div className="op-loading"><Spinner/>Consultando la partida…</div>:null:<>
   <div className={`op-connection ${error?'is-stale':''}`} role="status"><span className={`rm-dot ${error?'is-stale':''}`}/><span>{error?'Última lectura conservada':'Datos de CTP'} · {dateTime(data.observed_at)}</span><span className="op-connection-mode">Cada 15 s con la pestaña visible</span></div>
   <section className="op-card rl-overview"><div><span className="muted">Estado</span><Badge value={lobby.status}>{STATUS[lobby.status]}</Badge></div><div><span className="muted">Modo</span><ModeTag mode={lobby.mode} pending={lobby.mode_pending}/></div><div><span className="muted">Partida</span><span className="rm-id" title={lobby.id}>{lobby.id.slice(0,8)}</span></div><div><span className="muted">Creada</span><span>{dateTime(lobby.created_at)}</span></div><div><span className="muted">Disputas abiertas</span><strong>{data.open_disputes}</strong></div></section>
   <RankedDisputes lobby={lobby} disputes={data.disputes??null} open={data.open_disputes}/>
   <section className="op-card"><div className="op-section-title"><div><h2>Resultado</h2><p>{result.winner?`Ganador confirmado: ${team(result.winner)}`:lobby.status==='cancelled'?'La partida se ha cancelado.':'Todavía no hay ganador confirmado.'}</p></div></div>
    <div className="rl-votes"><div><span>Votos al equipo A</span><strong>{result.votes_a}</strong></div><div><span>Votos al equipo B</span><strong>{result.votes_b}</strong></div><div><span>Confirmaciones necesarias</span><strong>{result.confirmations_required}</strong></div></div>
    <p className="muted rl-caption">Estos contadores son votos de resultado; no son el marcador del juego.</p>
    {result.resolution&&<p className="op-notice rl-copy">{result.resolution}</p>}
    {result.resolution_truncated&&<p className="muted rl-caption">La resolución es extensa. Se muestran sus primeros 2.000 caracteres.</p>}
    <dl className="rl-times"><div><dt>Votos disponibles desde</dt><dd>{result.opens_at?dateTime(result.opens_at):'—'}</dd></div><div><dt>Decisión de la votación</dt><dd>{result.decides_at?dateTime(result.decides_at):'Sin primer voto'}</dd></div><div><dt>Suspensión sin votos</dt><dd>{result.suspends_at?dateTime(result.suspends_at):'—'}</dd></div></dl>
   </section>
   {data.can_decide&&!['closed','cancelled'].includes(lobby.status)&&<RankedDecision key={scope} lobby={lobby} players={data.players} onApplied={()=>{setBefore(null);void load();}}/>}
   <section className="rl-teams" aria-label="Equipos de la partida">{['a','b',null].map(side=>{const players=data.players.filter(p=>p.side===side);if(side===null&&!players.length)return null;return <article key={side||'pending'} className={`op-card rl-team team-${side||'pending'}`}><h2><Users size={18}/> {team(side)} <span className="muted">{players.length}</span></h2>{players.length?<ol>{players.map(player=><li key={player.slot}><span className="rl-player"><strong>{player.username||'Jugador no disponible'}</strong><RankTag player={player}/></span><span>{player.is_captain?'Capitán · ':''}{player.result_vote?`Votó ${team(player.result_vote)}`:'Sin voto de resultado'}{player.ranked_ban_until&&<em className="rl-banned">Sin Ranked hasta el {dateTime(player.ranked_ban_until)}</em>}</span></li>)}</ol>:<Empty title="Sin jugadores asignados">El equipo se mostrará al formarse.</Empty>}</article>;})}</section>
   {data.can_ban&&<RankedBan key={`ban-${scope}`} lobby={lobby} players={data.players} onApplied={()=>{setBefore(null);void load();}}/>}
   <section className="op-card"><div className="op-section-title"><div><h2><MessageSquare size={18}/> Chat de la partida</h2><p>Conversación compartida de esta partida. Los mensajes se muestran como texto.</p></div><div className="op-actions">{before&&<button className="btn" disabled={busy} onClick={()=>setBefore(null)}>Últimos mensajes</button>}<button className="btn" disabled={busy||!data.chat.has_more} onClick={()=>setBefore(data.chat.next_before)}>Mensajes anteriores</button></div></div>
    <div className="rl-chat" ref={chatBox} role="log" aria-label="Chat de la partida">{data.chat.messages.length?data.chat.messages.map(message=><article key={message.id} className={message.is_system?'is-system':''}><header><strong>{message.is_system?'CTP':message.username||'Jugador no disponible'}{message.author_role&&<small className="rl-staff-role">{message.author_role==='admin'?'Administración':'Árbitro'}</small>}</strong><time dateTime={message.created_at}>{dateTime(message.created_at)}</time></header><p>{message.message}</p></article>):<Empty title="Sin mensajes en esta página">La conversación aparecerá cuando alguien escriba en la partida.</Empty>}</div>
    {data.chat.can_send?<form className="rl-chat-compose" onSubmit={sendMessage}>
     <label htmlFor="ranked-staff-message">Mensaje de {me.ctp_role==='referee'?'arbitraje':'administración'}</label>
     <textarea id="ranked-staff-message" rows={3} maxLength={1600} value={draft} disabled={sending} onChange={event=>{setDraft(event.target.value);setSent(false);}} aria-describedby="ranked-chat-help" placeholder="Escribe a los jugadores de esta partida…"/>
     <div className="rl-chat-compose-actions"><span id="ranked-chat-help" className="muted">{new Intl.NumberFormat('es-ES').format(Array.from(draft.trim()).length)}/800 caracteres. Lo verán los jugadores de esta partida.</span><button className="btn primary" type="submit" disabled={sending||!draft.trim()||Array.from(draft.trim()).length>800}><Send size={15}/>{sending?'Enviando…':'Enviar mensaje'}</button></div>
     {sendError&&<p className="op-error" role="alert">{sendError} Si el envío no se ha confirmado, reintenta el mismo texto para comprobarlo sin duplicarlo.</p>}
     {sent&&<p className="op-notice" role="status">Mensaje confirmado en el chat de la partida.</p>}
    </form>:<p className="muted rl-caption">El envío de mensajes no está disponible para esta cuenta o todavía no se ha habilitado en CTP.</p>}
   </section>
   <section className="op-card"><div className="op-section-title"><div><h2>Sorteos de mapa</h2><p>Historial de esta partida, incluidos los mapas omitidos.</p></div></div>{data.map_draws.length?<ol className="rl-draws">{data.map_draws.map(draw=><li key={draw.revision}><strong>{draw.map_name}</strong><span>{draw.skipped_at?'Omitido':'Asignado'}</span><time dateTime={draw.drawn_at}>{dateTime(draw.drawn_at)}</time></li>)}</ol>:<p className="muted">El mapa todavía no se ha sorteado.</p>}</section>
  </>}
 </div>;
}
