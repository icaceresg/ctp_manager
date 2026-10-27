import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {BellRing,RefreshCw,Save} from 'lucide-react';
import {api} from '../api.js';
import {dateTime} from '../operations/model.js';
import {STAFF_ALERT_PROVIDER_LABELS,STAFF_ALERT_STATUS_LABELS,STAFF_ALERT_EVENT_LABELS,staffAlertProvider,staffAlertStatus,staffAlertError,staffAlertPath,staffAlertsAttempt} from './staffAlertsModel.js';
import './staff-alerts.css';

/** Safe status and bounded history; no delivery, destination or retry controls. */
export function StaffAlertsStatus({snapshot}){
 if(snapshot===undefined)return <p className="muted" role="status">Consultando avisos de staff…</p>;
 if(snapshot?.available!==true)return <p className="op-notice" role="status">No se puede verificar el estado de los avisos de staff. Los servicios y sus contadores están sin lectura; actualiza para consultarlos.</p>;
 return <>
  <p className="muted">Lectura de CTP · {dateTime(snapshot.observed_at)}. Se actualiza al abrir esta sección o pulsar Actualizar.</p>
  <div className="staff-alert-provider-state">{snapshot.providers.map(row=><span key={row.provider}><strong>{staffAlertProvider(row.provider)}</strong><span className={row.enabled?'staff-alert-on':'muted'}>{row.enabled?'Habilitado':'Desactivado'}</span></span>)}</div>
  <p className="muted">La habilitación refleja la configuración guardada; las entregas confirmadas aparecen como enviadas.</p>
  <dl className="staff-alert-counts">{Object.entries(STAFF_ALERT_STATUS_LABELS).map(([status,label])=><div key={status} className={status==='uncertain'&&snapshot.counts[status]>0?'has-warning':''}><dt>{label}</dt><dd>{snapshot.counts[status].toLocaleString('es-ES')}</dd></div>)}</dl>
  {snapshot.counts.uncertain>0&&<p className="op-notice" role="status">Hay entregas inciertas. Comprueba Discord o Telegram antes de actuar: no se reenvían automáticamente.</p>}
  <div><h3>Actividad reciente</h3><p className="muted">Hasta 30 entregas. Los contadores pueden incluir otras entregas del historial.</p>
   {snapshot.recent.length?<ol className="staff-alert-events">{snapshot.recent.map(row=>{const to=staffAlertPath(row);return <li key={row.id}>
    <div className="staff-alert-event-heading"><strong>{STAFF_ALERT_EVENT_LABELS[row.event_kind]||'Aviso de staff'}</strong><span>{staffAlertProvider(row.provider)}</span><span className={row.status==='uncertain'?'staff-alert-uncertain':''}>{staffAlertStatus(row.status)}</span></div>
    <div className="staff-alert-event-meta"><time dateTime={row.created_at}>{dateTime(row.created_at)}</time><span>{row.attempts} {row.attempts===1?'intento':'intentos'}</span>{row.error_code!==null&&<span>{staffAlertError(row.error_code)}</span>}{to&&<Link to={to}>{row.resource_kind==='ticket'?'Abrir ticket':'Abrir partida'}</Link>}</div>
   </li>;})}</ol>:<p className="muted">No hay entregas recientes en esta lectura.</p>}
  </div>
 </>;
}

export default function StaffAlertsPanel({user,snapshot,onSnapshot}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reason,setReason]=useState(''),[enabled,setEnabled]=useState({discord:false,telegram:false}),[needsRefresh,setNeedsRefresh]=useState(false),[unconfirmed,setUnconfirmed]=useState(false);
 const pending=useRef(null),lock=useRef(false),mounted=useRef(true),actor=useRef(user?.id);actor.current=user?.id;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{
  if(snapshot?.available===true&&!pending.current)setEnabled(Object.fromEntries(snapshot.providers.map(row=>[row.provider,row.enabled])));
 },[snapshot]);
 if(!user?.is_admin)return null;
 const available=snapshot?.available===true,canChange=available&&!busy&&!needsRefresh&&!unconfirmed;
 async function refresh(){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');const owner=actor.current;
  try{const result=await api.get('/administration/integrations/staff-alerts');if(!mounted.current||actor.current!==owner)return;onSnapshot(result);setNeedsRefresh(false);if(!pending.current){setReason('');setEnabled(Object.fromEntries(result.providers.map(row=>[row.provider,row.enabled])));}}
  catch(problem){if(mounted.current&&actor.current===owner){setError(problem.message);setNeedsRefresh(true);}}
  finally{lock.current=false;if(mounted.current&&actor.current===owner)setBusy(false);}
 }
 async function configure(event){
  event.preventDefault();if(lock.current||!available||needsRefresh)return;const owner=actor.current;
  let payload;
  try{payload=pending.current||staffAlertsAttempt(null,{version:snapshot.version,enabled,reason});}
  catch(problem){setError(problem.message);return;}
  const previouslyUnconfirmed=Boolean(pending.current);
  pending.current=payload;lock.current=true;setBusy(true);setError('');setNotice('');
  try{
   const result=await api.post('/administration/integrations/staff-alerts',payload);
   if(!mounted.current||actor.current!==owner)return;
   onSnapshot(result);pending.current=null;setUnconfirmed(false);setReason('');setNotice('Configuración confirmada en CTP.');
   setEnabled(Object.fromEntries(result.providers.map(row=>[row.provider,row.enabled])));
  }catch(problem){
   if(!mounted.current||actor.current!==owner)return;
   setError(problem.message);
   if([400,401,403,409,422].includes(problem.status)&&!previouslyUnconfirmed){pending.current=null;setUnconfirmed(false);setNeedsRefresh(true);}
   else{setUnconfirmed(true);if([401,403,409].includes(problem.status))setNeedsRefresh(true);}
  }finally{lock.current=false;if(mounted.current&&actor.current===owner)setBusy(false);}
 }
 return <section className="op-card stack staff-alerts-panel" aria-label="Avisos de staff">
  <div className="op-section-title"><h2><BellRing size={20}/> Avisos de staff · Discord y Telegram</h2><button type="button" className="btn" disabled={busy} onClick={()=>void refresh()}><RefreshCw size={16}/> Actualizar avisos</button></div>
  <p>Avisos de tickets pendientes, disputas y reportes de Ranked. Los dos servicios parten desactivados y se habilitan por separado. Las credenciales y los destinos se configuran en el servidor.</p>
  {error&&<p className="op-error" role="alert">{error}</p>}{notice&&<p className="op-notice" role="status">{notice}</p>}
  {error&&available&&<p className="muted">Se conserva la última lectura verificada; puede estar desactualizada.</p>}
  <StaffAlertsStatus snapshot={snapshot}/>
  {available&&<form onSubmit={configure} className="staff-alert-config">
   <fieldset disabled={!canChange}><legend>Servicios habilitados</legend><div className="staff-alert-toggles">{Object.entries(STAFF_ALERT_PROVIDER_LABELS).map(([provider,label])=><label key={provider}><input type="checkbox" checked={enabled[provider]} onChange={event=>setEnabled(current=>({...current,[provider]:event.target.checked}))}/><span>{label}</span></label>)}</div></fieldset>
   <label className="op-field">Motivo del cambio<input value={reason} onChange={event=>setReason(event.target.value)} minLength={12} maxLength={500} disabled={!canChange} required/></label>
   <p className="muted">El cambio queda asociado a tu cuenta de administración. Guardar no envía un aviso de prueba.</p>
   {unconfirmed&&<p className="op-notice" role="status">La confirmación está pendiente. Se conserva la misma referencia y configuración para reintentarlas sin duplicar el cambio.</p>}
   {needsRefresh&&<p className="op-notice" role="status">Actualiza los avisos antes de preparar otra configuración.</p>}
   <button type="submit" className="btn primary" disabled={busy||needsRefresh||!unconfirmed&&(reason.trim().length<12||reason.trim().length>500)}><Save size={16}/>{busy?'Consultando…':unconfirmed?'Reintentar la misma configuración':'Guardar configuración'}</button>
  </form>}
 </section>;
}
