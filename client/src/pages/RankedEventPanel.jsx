import {useEffect,useRef,useState} from 'react';
import {Flame,RefreshCw,Save} from 'lucide-react';
import {api} from '../api.js';
import {dateTime} from '../operations/model.js';
import './ranked-event.css';

export default function RankedEventPanel({user}){
 const [snapshot,setSnapshot]=useState(null),[enabled,setEnabled]=useState(false),[reason,setReason]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[uncertain,setUncertain]=useState(false),[stale,setStale]=useState(false);
 const owner=useRef(user?.id),mounted=useRef(true),lock=useRef(false),pending=useRef(null);owner.current=user?.id;
 async function refresh(){
  if(lock.current)return;lock.current=true;setBusy(true);const actor=owner.current;
  try{
   const result=await api.get('/administration/ranked-event');
   if(!mounted.current||owner.current!==actor)return;
   setSnapshot(result);setStale(false);setError('');if(!pending.current)setEnabled(result.enabled);
  }catch(problem){if(mounted.current&&owner.current===actor){setError(problem.message);setStale(true);}}
  finally{lock.current=false;if(mounted.current&&owner.current===actor)setBusy(false);}
 }
 useEffect(()=>{mounted.current=true;void refresh();return()=>{mounted.current=false;};},[]);
 if(!user?.is_admin)return null;
 async function save(event){
  event.preventDefault();if(lock.current||!snapshot||stale)return;
  if(!pending.current&&(reason.trim().length<12||reason.length>500))return;
  const payload=pending.current||{action:'configure',expected_version:snapshot.revision,request_id:crypto.randomUUID(),reason:reason.trim(),enabled};
  const retried=Boolean(pending.current),actor=owner.current;pending.current=payload;
  lock.current=true;setBusy(true);setError('');setNotice('');
  try{
   const result=await api.post('/administration/ranked-event',payload);
   if(!mounted.current||owner.current!==actor)return;
   setSnapshot(result);setEnabled(result.enabled);setReason('');setUncertain(false);pending.current=null;
   setNotice(result.enabled?'Halloween activado. Las partidas nuevas reciben la política del evento.':'Halloween desactivado. Las partidas en curso conservan su política.');
   // A retried acknowledgement may describe an older, successfully applied
   // revision. Always read current policy before offering another switch.
   try{
    const observed=await api.get('/administration/ranked-event');
    if(!mounted.current||owner.current!==actor)return;
    if(observed.revision<result.revision)throw new Error('No se ha podido confirmar la revisión actual del evento.');
    setSnapshot(observed);setEnabled(observed.enabled);
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
  <div className="op-section-title"><h2><Flame size={22}/> Halloween · Ranked</h2><button type="button" className="btn" disabled={busy} onClick={()=>void refresh()}><RefreshCw size={16}/> Actualizar evento</button></div>
  <p>Temática, mapas, rachas, sonidos, música de búsqueda y overlay. Se cambia desde aquí sin desplegar la web.</p>
  {error&&<p className="op-error" role="alert">{error}</p>}{notice&&<p className="op-notice" role="status">{notice}</p>}
  {snapshot?<>
   <div className="ranked-event-state"><strong className={snapshot.enabled?'event-on':''}>{snapshot.enabled?'Evento ACTIVO':'Evento DESACTIVADO'}</strong><span>Revisión {snapshot.revision} · {dateTime(snapshot.server_time)}</span></div>
   {stale&&<p className="op-notice">Esta lectura puede estar desactualizada. Actualiza antes de preparar otro cambio.</p>}
   <dl className="ranked-event-rewards"><div><dt>XP ganada</dt><dd>×2</dd></div><div><dt>Desde 5 victorias</dt><dd>racha ×2 · total ×4</dd></div><div><dt>Desde 10 victorias</dt><dd>racha ×2,5 · total ×5</dd></div></dl>
   <p className="muted">Solo victorias. La XP perdida y el MMR mantienen sus reglas. Por ejemplo, una victoria de base 50 XP da 100 XP; con cinco victorias consecutivas da 200 XP y con diez da 250 XP.</p>
   <p className="muted">Cada partida guarda la política al formarse. Activar o desactivar afecta a partidas nuevas; no recalcula resultados. La apariencia se actualiza en hasta 30 segundos. El audio necesita consentimiento del jugador.</p>
   <form onSubmit={save} className="stack">
    <label className="op-check"><input type="checkbox" checked={enabled} disabled={busy||stale||uncertain} onChange={event=>setEnabled(event.target.checked)}/> Activar Halloween para las partidas nuevas</label>
    <label className="op-field">Motivo del cambio<input required minLength={12} maxLength={500} value={reason} disabled={busy||stale||uncertain} onChange={event=>setReason(event.target.value)}/></label>
    {uncertain&&<p className="op-notice" role="status">Confirmación pendiente. Conservamos la misma referencia para reintentar sin duplicar el cambio.</p>}
    <button type="submit" className="btn primary" disabled={busy||stale||!uncertain&&(enabled===snapshot.enabled||reason.trim().length<12)}><Save size={16}/>{busy?'Confirmando…':uncertain?'Reintentar el mismo cambio':enabled?'Activar evento':'Desactivar evento'}</button>
   </form>
  </>:<p className="muted" role="status">{busy?'Consultando el estado del evento…':'Estado no disponible. Actualiza para comprobarlo.'}</p>}
 </section>;
}
