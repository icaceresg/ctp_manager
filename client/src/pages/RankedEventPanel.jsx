import {useEffect,useRef,useState} from 'react';
import {Clock3,Flame,Map as MapIcon,RefreshCw,Save} from 'lucide-react';
import {api} from '../api.js';
import {dateTime} from '../operations/model.js';
import {eventObservationReceivedAt,rankedEventBoundaryAttempt,rankedEventBoundaryWindow,rankedEventConfigured,rankedEventReadDue,rankedEventReading,rotationCountdown} from '../operations/ranked-event-model.js';
import './ranked-event.css';

const madridTime=value=>new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',dateStyle:'full',timeStyle:'short'}).format(new Date(value));
function configurationNotice(result){
 if(!rankedEventConfigured(result))return'Halloween deshabilitado. Las partidas en curso conservan su política y su pool.';
 if(result.phase==='scheduled')return'Horario de Halloween habilitado. El servidor lo activará el 30 de octubre a las 15:00 de Madrid y lo finalizará el 3 de noviembre a las 15:00.';
 if(result.phase==='ended')return'Configuración confirmada. El horario de Halloween ya ha terminado; las partidas nuevas utilizan las reglas habituales.';
 return'Halloween y su rotación activos hasta el final del horario. Las partidas nuevas reciben el pool del evento.';
}

function MapRotationReading({reading}){
 const rotation=reading.rotation;
 return <section className="ranked-event-rotation" aria-label="Rotación del map pool">
  <h3><MapIcon size={18}/> Map pool de Halloween</h3>
  {reading.status==='active'?<>
   <div className="ranked-event-rotation__header"><strong>7 mapas en el pool</strong><span role="timer" aria-label="Tiempo hasta el próximo cambio de mapa"><Clock3 size={15}/> {rotationCountdown(reading.seconds)}</span></div>
   <dl className="ranked-event-rotation__maps"><div><dt>Dentro del pool</dt><dd>{rotation.active_map}</dd></div><div><dt>Entra en el próximo cambio</dt><dd>{rotation.next_map}</dd></div></dl>
   <p className="muted">Próximo cambio: {dateTime(rotation.next_rotation_at)} (hora local).</p>
   <p className="muted">Seis mapas fijos: {rotation.fixed_maps.join(' · ')}.</p>
  </>:reading.status==='off'?<><strong>Rotación desactivada</strong><p className="muted">Se utiliza el pool habitual: {rotation.active_pool.join(' · ')}.</p></>
   :<p className="op-notice" role="status">{reading.status==='boundary'?'Esperando la lectura del servidor para confirmar el siguiente mapa.':reading.status==='stale'?'Lectura desactualizada. No se muestra un mapa actual hasta comprobar el servidor.':'La rotación no está disponible en esta lectura. Actualiza para comprobarla.'}</p>}
  <p className="muted">Al activar Halloween, Sentry y Lithium se alternan cada 20 minutos junto a los seis mapas fijos. Lotus se conserva; Coal queda fuera del pool del evento. Cada partida conserva el pool que recibió al formarse.</p>
 </section>;
}

export default function RankedEventPanel({user}){
 const [snapshot,setSnapshot]=useState(null),[enabled,setEnabled]=useState(false),[reason,setReason]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[uncertain,setUncertain]=useState(false),[stale,setStale]=useState(false);
 const [receivedAt,setReceivedAt]=useState(0),[now,setNow]=useState(Date.now),[readingStatus,setReadingStatus]=useState(false);
 const owner=useRef(user?.id),mounted=useRef(true),lifecycle=useRef(0),lock=useRef(false),pending=useRef(null),reader=useRef(null),lastAttempt=useRef(null),lastBoundary=useRef(null);
 // The polling effect keeps its first callback; refs preserve the latest intent.
 const draftActor=useRef(user?.id),draftTouched=useRef(false);
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
  if(rankedEventReading(latest.current.snapshot,latest.current.receivedAt,lastAttempt.current,latest.current.stale).status==='boundary')lastBoundary.current={window:rankedEventBoundaryWindow(latest.current.snapshot),at:lastAttempt.current};
  const timeout=window.setTimeout(()=>controller.abort(),6000);
  try{return await api.get('/administration/ranked-event',{signal:controller.signal});}
  finally{clearTimeout(timeout);if(reader.current===controller)reader.current=null;}
 }
 async function refresh({automatic=false}={}){
  if(lock.current||!user?.is_admin)return;lock.current=true;setReadingStatus(true);if(!automatic)setBusy(true);const actor=owner.current,generation=lifecycle.current;
  try{
   const result=await readStatus();
   if(!mounted.current||owner.current!==actor||lifecycle.current!==generation)return;
   accept(result);if(!pending.current){setError('');if(!draftTouched.current)setEnabled(rankedEventConfigured(result));}
  }catch(problem){if(mounted.current&&owner.current===actor&&lifecycle.current===generation){setError(problem.message);setStale(true);}}
  finally{if(lifecycle.current===generation){lock.current=false;if(mounted.current&&owner.current===actor){setReadingStatus(false);if(!automatic)setBusy(false);}}}
 }
 useEffect(()=>{
  mounted.current=true;lifecycle.current+=1;
  if(draftActor.current!==user?.id||!user?.is_admin){
   draftActor.current=user?.id;draftTouched.current=false;pending.current=null;
   latest.current={snapshot:null,receivedAt:0,stale:false};lastAttempt.current=null;lastBoundary.current=null;
   setSnapshot(null);setReceivedAt(0);setEnabled(false);setReason('');setError('');setNotice('');setUncertain(false);setStale(false);setBusy(false);setReadingStatus(false);
  }
  if(!user?.is_admin)return()=>{mounted.current=false;};
  const observe=()=>{
   const at=Date.now(),visible=document.visibilityState!=='hidden';
   if(visible)setNow(at);
   const boundaryAt=rankedEventBoundaryAttempt(latest.current.snapshot,lastBoundary.current);
   if(rankedEventReadDue({...latest.current,lastAttemptAt:lastAttempt.current,lastBoundaryAttemptAt:boundaryAt,now:at,visible}))void refresh({automatic:true});
  };
  if(document.visibilityState!=='hidden')void refresh();const timer=window.setInterval(observe,1000);
  document.addEventListener('visibilitychange',observe);window.addEventListener('focus',observe);
  return()=>{mounted.current=false;lifecycle.current+=1;reader.current?.abort();lock.current=false;clearInterval(timer);document.removeEventListener('visibilitychange',observe);window.removeEventListener('focus',observe);};
 },[user?.id,user?.is_admin]);
 if(!user?.is_admin||draftActor.current!==user?.id)return null;
 const reading=rankedEventReading(snapshot,receivedAt,now,stale),expired=stale||reading.status==='stale',unverified=expired||reading.status==='boundary';
 const canActivate=!!snapshot?.map_rotation;
 async function save(event){
  event.preventDefault();if(lock.current||!snapshot||unverified||!canActivate&&enabled)return;
  if(!pending.current&&(reason.trim().length<12||reason.length>500))return;
  const payload=pending.current||{action:'configure',expected_version:snapshot.revision,request_id:crypto.randomUUID(),reason:reason.trim(),enabled};
  const retried=Boolean(pending.current),actor=owner.current,generation=lifecycle.current;pending.current=payload;
  lock.current=true;setBusy(true);setError('');setNotice('');
  try{
   const result=await api.post('/administration/ranked-event',payload);
   if(!mounted.current||owner.current!==actor||lifecycle.current!==generation)return;
   draftTouched.current=false;setEnabled(rankedEventConfigured(result));setReason('');setUncertain(false);pending.current=null;setStale(true);
   setNotice(configurationNotice(result));
   // A retried acknowledgement may describe an older, successfully applied
   // revision. Always read current policy before offering another switch.
   try{
    const observed=await readStatus();
    if(!mounted.current||owner.current!==actor||lifecycle.current!==generation)return;
    if(observed.revision<result.revision)throw new Error('No se ha podido confirmar la revisión actual del evento.');
    accept(observed);setEnabled(rankedEventConfigured(observed));
    if(observed.revision>result.revision)setNotice('Tu cambio quedó confirmado. Se muestra la configuración más reciente, modificada después por administración.');
   }catch(problem){
    if(mounted.current&&owner.current===actor&&lifecycle.current===generation){setStale(true);setError(`Cambio confirmado. ${problem.message}`);}
   }
  }catch(problem){
   if(!mounted.current||owner.current!==actor||lifecycle.current!==generation)return;setError(problem.message);
   if(!retried&&[400,401,403,409,422].includes(problem.status)){pending.current=null;setUncertain(false);setStale(true);}
   else{setUncertain(true);if([401,403,409].includes(problem.status))setStale(true);}
  }finally{if(lifecycle.current===generation){lock.current=false;if(mounted.current&&owner.current===actor)setBusy(false);}}
 }
 return <section className="op-card stack ranked-event-panel" aria-label="Evento Halloween Ranked">
  <div className="op-section-title"><h2><Flame size={22}/> Halloween · Ranked</h2><button type="button" className="btn" disabled={busy||readingStatus} onClick={()=>void refresh()}><RefreshCw size={16}/> Actualizar evento</button></div>
  <p>Temática, mapas, XP de victoria, rachas, efectos de sonido y overlay. Se cambia desde aquí sin desplegar la web.</p>
  {error&&<p className="op-error" role="alert">{error}</p>}{notice&&<p className="op-notice" role="status">{notice}</p>}
  {snapshot?<>
   <div className="ranked-event-state"><strong className={!unverified&&snapshot.enabled?'event-on':''}>{unverified?'Estado pendiente de comprobar':snapshot.phase==='scheduled'?'Evento PROGRAMADO':snapshot.phase==='ended'?'Evento FINALIZADO':snapshot.enabled?'Evento ACTIVO':'Evento DESHABILITADO'}</strong><span>Revisión observada {snapshot.revision} · {dateTime(snapshot.server_time)}</span></div>
   {snapshot.timezone==='Europe/Madrid'&&<div className="ranked-event-schedule"><strong>Horario de Madrid · Europe/Madrid</strong><dl><div><dt>Inicio</dt><dd>{madridTime(snapshot.starts_at)}</dd></div><div><dt>Fin</dt><dd>{madridTime(snapshot.ends_at)}</dd></div></dl><p className="muted">El servidor aplica el horario indicado, sin depender de un navegador abierto. Deshabilitarlo interrumpe el evento para las partidas nuevas.</p></div>}
   {expired&&<p className="op-notice">Esta lectura puede estar desactualizada. Actualiza antes de preparar otro cambio.</p>}
   <MapRotationReading reading={reading}/>
   <dl className="ranked-event-rewards"><div><dt>De 1 a 4 victorias consecutivas</dt><dd>total ×2</dd></div><div><dt>Desde 5 victorias consecutivas</dt><dd>total ×4</dd></div><div><dt>Desde 10 victorias consecutivas</dt><dd>total ×5</dd></div></dl>
   <p className="muted">Con Halloween activo, la XP base de una victoria se multiplica por ×2. La racha aplica por separado ×1 hasta cuatro victorias consecutivas, ×2 desde la quinta y ×2,5 desde la décima, incluyendo la victoria actual. Los factores se aplican una sola vez: una base de 50 XP da 100, 200 o 250 XP. La XP perdida y el MMR mantienen sus reglas.</p>
   <p className="muted">Cada partida guarda la política al formarse. Las partidas formadas dentro del horario conservan sus reglas y recompensas aunque terminen después. Habilitar o deshabilitar afecta a partidas nuevas; no recalcula resultados. La apariencia se actualiza en hasta 30 segundos. El audio necesita consentimiento del jugador.</p>
   <p className="muted">La música de búsqueda no está disponible: falta el MP3 completo aprobado. No se activa ni se sustituye por efectos de sonido.</p>
   <form onSubmit={save} className="stack">
    <label className="op-check"><input type="checkbox" checked={enabled} disabled={busy||unverified||uncertain||!canActivate&&!rankedEventConfigured(snapshot)} onChange={event=>{draftTouched.current=true;setEnabled(event.target.checked);}}/> {snapshot.timezone==='Europe/Madrid'?'Habilitar el horario de Halloween y su rotación para las partidas nuevas':'Activar Halloween y la rotación de mapas para las partidas nuevas'}</label>
    {!canActivate&&<p className="op-notice">La lectura no incluye la nueva rotación. No se permite activar el evento con información incompleta; sí se puede desactivar si ya estaba activo.</p>}
    <label className="op-field">Motivo del cambio<input required minLength={12} maxLength={500} value={reason} disabled={busy||unverified||uncertain} onChange={event=>setReason(event.target.value)}/></label>
    {uncertain&&<p className="op-notice" role="status">Confirmación pendiente. Conservamos la misma referencia para reintentar sin duplicar el cambio.</p>}
    <button type="submit" className="btn primary" disabled={busy||readingStatus||unverified||!canActivate&&enabled||!uncertain&&(enabled===rankedEventConfigured(snapshot)||reason.trim().length<12)}><Save size={16}/>{busy?'Confirmando…':uncertain?'Reintentar el mismo cambio':enabled?(snapshot.timezone==='Europe/Madrid'?'Habilitar horario de Halloween':'Activar Halloween y rotación'):'Deshabilitar evento'}</button>
   </form>
  </>:<p className="muted" role="status">{busy?'Consultando el estado del evento…':'Estado no disponible. Actualiza para comprobarlo.'}</p>}
 </section>;
}
