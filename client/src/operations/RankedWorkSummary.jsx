import {useCallback,useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {Activity,Clock3,Flag,RefreshCw,Users} from 'lucide-react';
import {api} from '../api.js';
import {dateTime} from './model.js';

export function rankedWorkSummary(data){
  if(!data)return null;
  return {waiting:data.summary.waiting_players,active:data.summary.active_lobbies,
    review:data.lobby_statuses.filter(row=>row.status==='disputed').reduce((sum,row)=>sum+row.count,0),
    longest:data.summary.waiting_players?data.queues.reduce((max,row)=>Math.max(max,row.wait_max_seconds||0),0):null,
    partial:!!(data.truncated.active_lobbies||data.truncated.queues),
    cases:data.active_lobbies.filter(row=>row.status==='disputed'||row.open_disputes>0)};
}
export function RankedWorkSummary({actorKey}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const serial=useRef(0),inFlight=useRef(false);
 const load=useCallback(async()=>{
  if(inFlight.current)return;inFlight.current=true;const current=++serial.current;setBusy(true);
  try{const next=await api.get('/operations/ranked/monitor');if(serial.current===current){setData(next);setError('');}}
  catch(cause){if(serial.current===current){setError(cause.message);if([401,403].includes(cause.status))setData(null);}}
  finally{if(serial.current===current){inFlight.current=false;setBusy(false);}}
 },[actorKey]);
 useEffect(()=>{setData(null);setError('');void load();const timer=setInterval(()=>{if(!document.hidden)void load();},20000);return()=>{clearInterval(timer);serial.current++;inFlight.current=false;};},[load]);
 return <RankedWorkSummaryView data={data} error={error} busy={busy} onReload={load}/>;
}

/** Render the typed snapshot without issuing requests or changing any game state. */
export function RankedWorkSummaryView({data,error='',busy=false,onReload}){
 const summary=rankedWorkSummary(data);
 return <section className="op-card" aria-labelledby="ranked-daily-title">
  <div className="op-section-title"><div><h2 id="ranked-daily-title">Ranked ahora</h2><p>Colas, partidas y revisiones oficiales de CTP.</p></div><div className="op-actions"><Link className="btn primary" to="/ranked/monitor">Abrir Ranked</Link><button className="btn sm" disabled={busy} onClick={onReload} aria-label="Actualizar resumen de Ranked"><RefreshCw size={16}/></button></div></div>
  {error&&<p className="op-error" role="alert">{error}{data?' Se conserva la última lectura.':''}</p>}
  {!summary?<p role="status">{busy?'Consultando Ranked…':'Ranked no está disponible en esta lectura.'}</p>:<>
   <div className="op-quick-strip ranked-home-counters">
    <Link to="/ranked/monitor?tab=live"><Users size={19}/><span><strong>{summary.waiting} buscando</strong><small>Personas en cola</small></span></Link>
    <Link to="/ranked/monitor?tab=live"><Activity size={19}/><span><strong>{summary.active} partidas activas</strong><small>Preparación y resultado</small></span></Link>
    <Link to="/ranked/monitor?tab=review"><Flag size={19}/><span><strong>{summary.review} en revisión</strong><small>Atender arbitraje</small></span></Link>
    <Link to="/ranked/monitor?tab=live"><Clock3 size={19}/><span><strong>{summary.longest===null?'—':Math.round(summary.longest)+' s'}</strong><small>Espera más larga</small></span></Link>
   </div>
   <p className="muted">Lectura de {dateTime(data.observed_at)}.{summary.partial?' Listado parcial: los contadores incluyen el conjunto completo.':''}</p>
   {summary.cases.length>0&&<ol className="op-task-list">{summary.cases.slice(0,5).map(lobby=><li key={lobby.id}><Link to={`/ranked/partidas/${lobby.id}?focus=decision&returnTo=${encodeURIComponent('/operaciones/jornada')}`}><Flag size={17}/><span><strong>Revisar partida {lobby.id.slice(0,8)}</strong><small>{lobby.queue_title} · {lobby.open_disputes} disputas abiertas</small></span></Link></li>)}</ol>}
  </>}
 </section>;
}
