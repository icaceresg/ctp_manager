import {useEffect,useRef,useState} from 'react';
import {Clock3,Flame,Map as MapIcon,RefreshCw,Save} from 'lucide-react';
import {api} from '../api.js';
import {dateTime} from '../operations/model.js';
import {eventObservationReceivedAt,rankedEventReadDue,rankedEventReading,rotationCountdown} from '../operations/ranked-event-model.js';
import './ranked-event.css';

function MapRotationReading({reading}){
 const rotation=reading.rotation;
 return <section className="ranked-event-rotation" aria-label="Rotación del map pool">
  <h3><MapIcon size={18}/> Map pool de Halloween</h3>
  {reading.status==='active'?<>
   <div className="ranked-event-rotation__header"><strong>6 mapas en el pool</strong><span role="timer" aria-label="Tiempo hasta el próximo cambio de mapa"><Clock3 size={15}/> {rotationCountdown(reading.seconds)}</span></div>
   <dl className="ranked-event-rotation__maps"><div><dt>Dentro del pool</dt><dd>{rotation.active_map}</dd></div><div><dt>Entra en el próximo cambio</dt><dd>{rotation.next_map}</dd></div></dl>
   <p className="muted">Próximo cambio: {dateTime(rotation.next_rotation_at)} (hora local).</p>
   <p className="muted">Cinco mapas fijos: {rotation.fixed_maps.join(' · ')}.</p>
  </>:reading.status==='off'?<><strong>Rotación desactivada</strong><p className="muted">Se utiliza el pool habitual: {rotation.active_pool.join(' · ')}.</p></>
   :<p className="op-notice" role="status">{reading.status==='boundary'?'Esperando la lectura del servidor para confirmar el siguiente mapa.':reading.status==='stale'?'Lectura desactualizada. No se muestra un mapa actual hasta comprobar el servidor.':'La rotación no está disponible en esta lectura. Actualiza para comprobarla.'}</p>}
  <p className="muted">Al activar Halloween, Sentry y Lithium se alternan cada 20 minutos junto a los cinco mapas fijos. Coal y Lotus quedan fuera del pool del evento. Cada partida conserva el pool que recibió al formarse.</p>
 </section>;
}

export default function RankedEventPanel({user}){
 const [snapshot,setSnapshot]=useState(null),[enabled,setEnabled]=useState(false),[reason,setReason]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[uncertain,setUncertain]=useState(false),[stale,setStale]=useState(false);
 const [receivedAt,setReceivedAt]=useState(0),[now,setNow]=useState(Date.now),[readingStatus,setReadingStatus]=useState(false);
 const owner=useRef(user?.id),mounted=useRef(true),lock=useRef(false),pending=useRef(null),reader=useRef(null),lastAttempt=useRef(null),lastBoundary=useRef(null);
 const latest=useRef({snapshot,receivedAt,stale});owner.current=user?.id;latest.current={snapshot,receivedAt,stale};
 function accept(result){
  const at=Date.now(),previous=latest.current;
  if(previous.snapshot&&result.revision<previous.snapshot.revision)throw new Error('La revisión del evento ha retrocedido. Actualiza para comprobar el estado.');
  const received=eventObservationReceivedAt(previous.snapshot,previous.receivedAt,result,at);
  latest.current={snapshot:result,receivedAt:received,stale:false};
  setSnapshot(result);setReceivedAt(received);setNow(at);setStale(false);
 }
 async function readStatus(){
  const controller=new AbortController();reader.current=controller;lastAttempt.current=Date.now();
  if(rankedEventReading(latest.current.snapshot,latest.current.receivedAt,lastAttempt.current,latest.current.stale).status==='boundary')lastBoundary.current={window:latest.current.snapshot.map_rotation.next_rotation_at,at:lastAttempt.current};
  const timeout=window.setTimeout(()=>controller.abort(),6000);
  try{return await api.get('/administration/ranked-event',{signal:controller.signal});}
  finally{clearTimeout(timeout);if(reader.current===controller)reader.current=null;}
 }
 async function refresh({automatic=false}={}){
  if(lock.current||!user?.is_admin)return;lock.current=true;setReadingStatus(true);if(!automatic)setBusy(true);const actor=owner.current;
  try{
   const result=await readStatus();
   if(!mounted.current||owner.current!==actor)return;
   accept(result);if(!pending.current){setError('');setEnabled(result.enabled);}
  }catch(problem){if(mounted.current&&owner.current===actor){setError(problem.message);setStale(true);}}
  finally{lock.current=false;if(mounted.current&&owner.current===actor){setReadingStatus(false);if(!automatic)setBusy(false);}}
 }
 useEffect(()=>{
  mounted.current=true;
  if(!user?.is_admin)return()=>{mounted.current=false;};
  const observe=()=>{
   const at=Date.now(),visible=document.visibilityState!=='hidden';
   if(visible)setNow(at);
   const boundaryAt=lastBoundary.current?.window===latest.current.snapshot?.map_rotation?.next_rotation_at?lastBoundary.current.at:null;
   if(rankedEventReadDue({...latest.current,lastAttemptAt:lastAttempt.current,lastBoundaryAttemptAt:boundaryAt,now:at,visible}))void refresh({automatic:true});
  };
  if(document.visibilityState!=='hidden')void refresh();const timer=window.setInterval(observe,1000);
  document.addEventListener('visibilitychange',observe);window.addEventListener('focus',observe);
  return()=>{mounted.current=false;reader.current?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',observe);window.removeEventListener('focus',observe);};
 },[user?.id,user?.is_admin]);
 if(!user?.is_admin)return null;
 const reading=rankedEventReading(snapshot,receivedAt,now,stale),expired=stale||reading.status==='stale';
 const canActivate=!!snapshot?.map_rotation;
 async function save(event){
  event.preventDefault();if(lock.current||!snapshot||expired||!canActivate&&enabled)return;
  if(!pending.current&&(reason.trim().length<12||reason.length>500))return;
  const payload=pending.current||{action:'configure',expected_version:snapshot.revision,request_id:crypto.randomUUID(),reason:reason.trim(),enabled};
  const retried=Boolean(pending.current),actor=owner.current;pending.current=payload;
  lock.current=true;setBusy(true);setError('');setNotice('');
  try{
   const result=await api.post('/administration/ranked-event',payload);
   if(!mounted.current||owner.current!==actor)return;
   setEnabled(result.enabled);setReason('');setUncertain(false);pending.current=null;setStale(true);
   setNotice(result.enabled?'Halloween y su rotación activados. Las partidas nuevas reciben el pool del evento.':'Halloween desactivado. Las partidas en curso conservan su política y su pool.');
   // A retried acknowledgement may describe an older, successfully applied
   // revision. Always read current policy before offering another switch.
   try{
    const observed=await readStatus();
    if(!mounted.current||owner.current!==actor)return;
    if(observed.revision<result.revision)throw new Error('No se ha podido confirmar la revisión actual del evento.');
    accept(observed);setEnabled(observed.enabled);
    if(observed.revision>result.revision)setNotice('Tu cambio quedó confirmado. Se muestra la configuración más reciente, modificada después por administración.');
   }catch(problem){
    if(mounted.current&&owner.current===actor){setStale(true);setError(`Cambio confirmado. ${problem.message}`);}
   }
  }catch(problem){
   if(!mounted.current||owner.current!==actor)return;setError(problem.message);
   if(!retried&&[400,401,403,409,422].includes(problem.status)){pending.current=null;setUncertain(false);setStale(true);}
   else{setUncertain(true);if([401,403,409].includes(problem.status))setStale(true);}
  }finally{lock.current=false;if(mounted.current&&owner.current===actor)setBusy(false);}
 }
 return <section className="op-card stack ranked-event-panel" aria-label="Evento Halloween Ranked">
  <div className="op-section-title"><h2><Flame size={22}/> Halloween · Ranked</h2><button type="button" className="btn" disabled={busy||readingStatus} onClick={()=>void refresh()}><RefreshCw size={16}/> Actualizar evento</button></div>
  <p>Temática, mapas, rachas, sonidos, música de búsqueda y overlay. Se cambia desde aquí sin desplegar la web.</p>
  {error&&<p className="op-error" role="alert">{error}</p>}{notice&&<p className="op-notice" role="status">{notice}</p>}
  {snapshot?<>
   <div className="ranked-event-state"><strong className={!expired&&snapshot.enabled?'event-on':''}>{expired?'Estado pendiente de comprobar':snapshot.enabled?'Evento ACTIVO':'Evento DESACTIVADO'}</strong><span>Revisión observada {snapshot.revision} · {dateTime(snapshot.server_time)}</span></div>
   {expired&&<p className="op-notice">Esta lectura puede estar desactualizada. Actualiza antes de preparar otro cambio.</p>}
   <MapRotationReading reading={reading}/>
   <dl className="ranked-event-rewards"><div><dt>De 1 a 4 victorias consecutivas</dt><dd>total ×1</dd></div><div><dt>Desde 5 victorias consecutivas</dt><dd>total ×2</dd></div><div><dt>Desde 10 victorias consecutivas</dt><dd>total ×2,5</dd></div></dl>
   <p className="muted">Con Halloween activo, el sistema habitual usa el multiplicador ×1 hasta cuatro victorias consecutivas, ×2 desde la quinta y ×2,5 desde la décima, incluyendo la victoria actual. Una base de 50 XP da 50, 100 o 125 XP, respectivamente. La XP perdida y el MMR mantienen sus reglas.</p>
   <p className="muted">Cada partida guarda la política al formarse. Activar o desactivar afecta a partidas nuevas; no recalcula resultados. La apariencia se actualiza en hasta 30 segundos. El audio necesita consentimiento del jugador.</p>
   <form onSubmit={save} className="stack">
    <label className="op-check"><input type="checkbox" checked={enabled} disabled={busy||expired||uncertain||!canActivate&&!snapshot.enabled} onChange={event=>setEnabled(event.target.checked)}/> Activar Halloween y la rotación de mapas para las partidas nuevas</label>
    {!canActivate&&<p className="op-notice">La lectura no incluye la nueva rotación. No se permite activar el evento con información incompleta; sí se puede desactivar si ya estaba activo.</p>}
    <label className="op-field">Motivo del cambio<input required minLength={12} maxLength={500} value={reason} disabled={busy||expired||uncertain} onChange={event=>setReason(event.target.value)}/></label>
    {uncertain&&<p className="op-notice" role="status">Confirmación pendiente. Conservamos la misma referencia para reintentar sin duplicar el cambio.</p>}
    <button type="submit" className="btn primary" disabled={busy||readingStatus||expired||!canActivate&&enabled||!uncertain&&(enabled===snapshot.enabled||reason.trim().length<12)}><Save size={16}/>{busy?'Confirmando…':uncertain?'Reintentar el mismo cambio':enabled?'Activar Halloween y rotación':'Desactivar evento'}</button>
   </form>
  </>:<p className="muted" role="status">{busy?'Consultando el estado del evento…':'Estado no disponible. Actualiza para comprobarlo.'}</p>}
 </section>;
}
