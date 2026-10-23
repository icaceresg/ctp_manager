import {useCallback,useEffect,useRef,useState} from 'react';
import {Link,Navigate,useParams} from 'react-router-dom';
import {ArrowLeft,MessageSquare,RefreshCw,ShieldCheck,Users} from 'lucide-react';
import {api} from '../api.js';
import {useApp} from '../context.jsx';
import {Spinner} from '../components/ui.jsx';
import {Badge,Empty} from '../operations/ui.jsx';
import {dateTime} from '../operations/model.js';
import '../operations/operations.css';
import './ranked-monitor.css';

const STATUS={voting:'Sorteo de mapa',drafting:'Formando equipos',ready:'Lista para jugar',reported:'Confirmando resultado',disputed:'En revisión',closed:'Finalizada',cancelled:'Cancelada'};
const team=side=>side==='a'?'Equipo A':side==='b'?'Equipo B':'Sin asignar';
export default function RankedLobbyPage(){
 const {me}=useApp(),{lobbyId}=useParams();
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[before,setBefore]=useState(null);
 const serial=useRef(0),inFlight=useRef(false),chatBox=useRef(null),scrollToLatest=useRef(true);
 const validId=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lobbyId||'');
 const load=useCallback(async()=>{
  if(!me?.is_admin||!validId||inFlight.current)return;
  inFlight.current=true;const request=++serial.current;setBusy(true);
  const box=chatBox.current;scrollToLatest.current=!before&&(!box||box.scrollHeight-box.scrollTop-box.clientHeight<80);
  try{const next=await api.get(`/operations/ranked/lobbies/${encodeURIComponent(lobbyId)}${before?'?before='+encodeURIComponent(before):''}`);if(serial.current===request){setData(next);setError('');}}
  catch(cause){if(serial.current===request){setError(cause.message);if([401,403,404].includes(cause.status))setData(null);}}
  finally{if(serial.current===request){inFlight.current=false;setBusy(false);}}
 },[me?.is_admin,lobbyId,before,validId]);
 useEffect(()=>{setData(null);setError('');void load();return()=>{++serial.current;inFlight.current=false;};},[load]);
 useEffect(()=>{setBefore(null);},[lobbyId]);
 useEffect(()=>{const visible=()=>{if(!document.hidden)void load();};const timer=setInterval(visible,15000);document.addEventListener('visibilitychange',visible);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visible);};},[load]);
 useEffect(()=>{if(scrollToLatest.current&&chatBox.current)chatBox.current.scrollTop=chatBox.current.scrollHeight;},[data]);
 if(!me?.is_admin)return <Navigate to="/operaciones/jornada" replace/>;
 const lobby=data?.lobby,result=data?.result;
 return <div className="page wide op-page rm-page rl-page">
  <Link className="rl-back" to="/ranked/monitor"><ArrowLeft size={16}/> Volver al monitor de Ranked</Link>
  <header className="op-heading"><div><div className="op-eyebrow"><ShieldCheck size={15}/> SUPERVISIÓN DE PARTIDA</div><h1>{lobby?.map_name||'Partida Ranked'}</h1><p>{lobby?.queue_title||'Equipos, resultado y conversación de la partida.'}</p></div><button className="btn primary" disabled={busy||!validId} onClick={()=>void load()}><RefreshCw size={16} className={busy?'spin':''}/> Actualizar</button></header>
  <p className="op-notice rl-readonly">Solo lectura. Esta vista no entra en la partida ni envía mensajes, votos o resultados.</p>
  {!validId&&<div className="op-error" role="alert">La referencia de la partida no es válida.</div>}
  {error&&<div className="op-error" role="alert">{error}{data?' Se conserva la última lectura correcta.':''}</div>}
  {!data?busy?<div className="op-loading"><Spinner/>Consultando la partida…</div>:null:<>
   <div className={`op-connection ${error?'is-stale':''}`} role="status"><span className={`rm-dot ${error?'is-stale':''}`}/><span>{error?'Última lectura conservada':'Datos de CTP'} · {dateTime(data.observed_at)}</span><span className="op-connection-mode">Cada 15 s con la pestaña visible</span></div>
   <section className="op-card rl-overview"><div><span className="muted">Estado</span><Badge value={lobby.status}>{STATUS[lobby.status]}</Badge></div><div><span className="muted">Partida</span><span className="rm-id" title={lobby.id}>{lobby.id.slice(0,8)}</span></div><div><span className="muted">Creada</span><span>{dateTime(lobby.created_at)}</span></div><div><span className="muted">Disputas abiertas</span><strong>{data.open_disputes}</strong></div></section>
   <section className="op-card"><div className="op-section-title"><div><h2>Resultado</h2><p>{result.winner?`Ganador confirmado: ${team(result.winner)}`:lobby.status==='cancelled'?'La partida se ha cancelado.':'Todavía no hay ganador confirmado.'}</p></div></div>
    <div className="rl-votes"><div><span>Votos al equipo A</span><strong>{result.votes_a}</strong></div><div><span>Votos al equipo B</span><strong>{result.votes_b}</strong></div><div><span>Confirmaciones necesarias</span><strong>{result.confirmations_required}</strong></div></div>
    <p className="muted rl-caption">Estos contadores son votos de resultado; no son el marcador del juego.</p>
    {result.resolution&&<p className="op-notice rl-copy">{result.resolution}</p>}
    {result.resolution_truncated&&<p className="muted rl-caption">La resolución es extensa. Se muestran sus primeros 2.000 caracteres.</p>}
    <dl className="rl-times"><div><dt>Votos disponibles desde</dt><dd>{result.opens_at?dateTime(result.opens_at):'—'}</dd></div><div><dt>Decisión de la votación</dt><dd>{result.decides_at?dateTime(result.decides_at):'Sin primer voto'}</dd></div><div><dt>Suspensión sin votos</dt><dd>{result.suspends_at?dateTime(result.suspends_at):'—'}</dd></div></dl>
   </section>
   <section className="rl-teams" aria-label="Equipos de la partida">{['a','b',null].map(side=>{const players=data.players.filter(p=>p.side===side);if(side===null&&!players.length)return null;return <article key={side||'pending'} className={`op-card rl-team team-${side||'pending'}`}><h2><Users size={18}/> {team(side)} <span className="muted">{players.length}</span></h2>{players.length?<ol>{players.map(player=><li key={player.slot}><strong>{player.username||'Jugador no disponible'}</strong><span>{player.is_captain?'Capitán · ':''}{player.result_vote?`Votó ${team(player.result_vote)}`:'Sin voto de resultado'}</span></li>)}</ol>:<Empty title="Sin jugadores asignados">El equipo se mostrará al formarse.</Empty>}</article>;})}</section>
   <section className="op-card"><div className="op-section-title"><div><h2><MessageSquare size={18}/> Chat de la partida</h2><p>Conversación compartida de esta partida. Los mensajes se muestran como texto.</p></div><div className="op-actions">{before&&<button className="btn" disabled={busy} onClick={()=>setBefore(null)}>Últimos mensajes</button>}<button className="btn" disabled={busy||!data.chat.has_more} onClick={()=>setBefore(data.chat.next_before)}>Mensajes anteriores</button></div></div>
    <div className="rl-chat" ref={chatBox} role="log" aria-label="Chat de la partida">{data.chat.messages.length?data.chat.messages.map(message=><article key={message.id} className={message.is_system?'is-system':''}><header><strong>{message.is_system?'CTP':message.username||'Jugador no disponible'}</strong><time dateTime={message.created_at}>{dateTime(message.created_at)}</time></header><p>{message.message}</p></article>):<Empty title="Sin mensajes en esta página">La conversación aparecerá cuando alguien escriba en la partida.</Empty>}</div>
   </section>
   <section className="op-card"><div className="op-section-title"><div><h2>Sorteos de mapa</h2><p>Historial de esta partida, incluidos los mapas omitidos.</p></div></div>{data.map_draws.length?<ol className="rl-draws">{data.map_draws.map(draw=><li key={draw.revision}><strong>{draw.map_name}</strong><span>{draw.skipped_at?'Omitido':'Asignado'}</span><time dateTime={draw.drawn_at}>{dateTime(draw.drawn_at)}</time></li>)}</ol>:<p className="muted">El mapa todavía no se ha sorteado.</p>}</section>
  </>}
 </div>;
}
