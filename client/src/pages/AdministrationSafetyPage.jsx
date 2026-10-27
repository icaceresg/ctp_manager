import { useEffect,useRef,useState } from 'react';
import { Link,Navigate,useSearchParams } from 'react-router-dom';
import { ShieldCheck,RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Spinner } from '../components/ui.jsx';
import { dateTime } from '../operations/model.js';
import { DataTable } from '../operations/ui.jsx';
import { ERASURE_STATES,ERASURE_PHASES,UGC_REASONS,UGC_STATES,canProcessErasure,canInspectErasure,createModerationIntent } from './safetyModel.js';
import '../operations/operations.css';
import AvatarModerationPanel from './AvatarModerationPanel.jsx';
import {useSafetyResource} from './useSafetyResource.jsx';

const nav=[['resumen','Resumen'],['usuarios','Usuarios CTP'],['moderacion','Moderación'],['privacidad','Privacidad'],['auditoria','Auditoría']];
export default function AdministrationSafetyPage({section}) {
  const {me}=useApp();
  if (!me?.is_admin) return <Navigate to="/operaciones/jornada" replace/>;
  return <div className="page wide op-page"><header className="op-heading"><div><div className="op-eyebrow"><ShieldCheck size={15}/> ADMINISTRACIÓN CTP</div><h1>{section==='moderacion'?'Moderación de Ranked':'Solicitudes de privacidad'}</h1></div></header>
    <nav className="op-tabs" aria-label="Administración CTP">{nav.map(([id,label])=><Link key={id} to={`/administracion/${id}`} className={section===id?'active':''}>{label}</Link>)}</nav>
    {section==='moderacion'?<ModerationWorkspace/>:<ErasureWorkspace/>}
  </div>;
}
function ErrorBox({error,retry}) {return error?<div className="op-error" role="alert"><span>{error.message||error}</span>{retry&&<button className="btn" onClick={retry}>Actualizar estado</button>}</div>:null;}
function ModerationWorkspace() {
  const [params,setParams]=useSearchParams(), status=params.get('estado')||'pending', offset=Math.min(10000,Math.max(0,Number(params.get('offset'))||0));
  const selected=params.get('reporte'), key=JSON.stringify([status,offset]);
  const {data:list,loading,error,reload}=useSafetyResource(`moderation-list:${key}`,()=>api.get(`/administration/ugc?${new URLSearchParams({status,offset,limit:20})}`),value=>value);
  const choose=id=>setParams(previous=>{const next=new URLSearchParams(previous);id?next.set('reporte',id):next.delete('reporte');return next;});
  return <><p className="muted">Los reportes incluyen su ticket de soporte. Retirar oculta el mensaje en Ranked; archivar cierra la revisión del reporte sin restaurar contenido retirado.</p>
    <section className="op-card"><div className="op-actions"><label>Estado <select value={status} onChange={e=>setParams({estado:e.target.value})}>{['pending','hidden','dismissed','all'].map(s=><option key={s} value={s}>{UGC_STATES[s]||'Todos'}</option>)}</select></label><button className="btn" onClick={reload} disabled={loading}><RefreshCw size={15}/>Actualizar</button></div>
      <ErrorBox error={error} retry={reload}/>{loading?<Spinner/>:list&&<DataTable rows={list.items} columns={[{key:'ticket_code',title:'Ticket'},{key:'target_username',title:'Cuenta'},{key:'reason',title:'Motivo',render:r=>UGC_REASONS[r.reason]},{key:'status',title:'Revisión',render:r=>UGC_STATES[r.status]},{key:'open',title:'Revisar',render:r=><button className="btn" onClick={()=>choose(r.id)}>Abrir reporte</button>}]} empty="No hay reportes en esta vista"/>}
      <div className="op-actions"><button className="btn" disabled={loading||offset===0} onClick={()=>setParams({estado:status,offset:String(offset-20)})}>Anterior</button><span>{list?.total??'—'} reportes</span><button className="btn" disabled={loading||!list||offset+20>=list.total} onClick={()=>setParams({estado:status,offset:String(offset+20)})}>Siguiente</button></div>
    </section>{selected&&list&&!loading&&!error&&<ModerationDetail key={selected} id={selected} onChanged={reload}/>}</>;
}
function ModerationDetail({id,onChanged}) {
  const {data,scope,loading,error,reload,busy,needsRead,mutate}=useSafetyResource(`report:${id}`,()=>api.get(`/administration/ugc/${encodeURIComponent(id)}`),value=>{
    if(!value?.report)return null;if(value.report.id!==id)throw Error('CTP ha devuelto otra denuncia.');return value;
  });
  const report=data?.report,[reason,setReason]=useState(''),[locked,setLocked]=useState(false);
  const intent=useRef(null);if(!intent.current)intent.current=createModerationIntent();
  useEffect(()=>{intent.current.reset();setReason('');setLocked(false);},[scope]);
  useEffect(()=>{const pending=report?intent.current.reconcile(report):null;setReason(pending?.reason||'');setLocked(Boolean(pending));},[report]);
  async function act(action) {
    let body;
    await mutate(current=>{body=intent.current.begin(current.report,action,reason);return api.post(`/administration/ugc/${id}`,body);},result=>{intent.current.confirm(id,body,result);setReason('');onChanged();});
  }
  return <section className="op-card"><h2>Revisión del reporte</h2><ErrorBox error={error} retry={reload}/>{loading&&!report?<Spinner/>:report?<><ModerationReportView report={report} reason={reason} busy={busy||needsRead} locked={locked} onReason={setReason} onAction={act}/>{report.context==='user'&&!busy&&!needsRead&&<AvatarModerationPanel reportId={report.id} onReportChanged={()=>{void reload();onChanged();}}/>}</>:!loading&&<p>El reporte no está disponible. {error?'Consulta el estado antes de volver a actuar.':''}</p>}</section>;
}
export function ModerationReportView({report,reason,busy,locked,onReason,onAction}) {
  return <><p><strong>{report.target_username||'Cuenta eliminada'}</strong> · {UGC_STATES[report.status]} · {dateTime(report.created_at)}</p><p>{UGC_REASONS[report.reason]}</p>
    <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{report.details}</p>
    {report.meta?.content_omitted&&<p className="muted">Parte de la evidencia original se ha omitido por tamaño o formato. Puedes revisar y moderar la denuncia.</p>}
    {report.evidence.message&&<blockquote style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{report.evidence.message}</blockquote>}
    {report.evidence.redacted&&<p className="muted">Los datos personales de esta evidencia se han retirado.</p>}
    <div className="op-actions"><Link className="btn" to={`/operaciones/incidencias?case=${encodeURIComponent(report.ticket_id)}`}>Ticket {report.ticket_code}</Link>{report.lobby_id&&<Link className="btn" to={`/ranked/partidas/${encodeURIComponent(report.lobby_id)}`}>Contexto de la partida</Link>}</div>
    {report.review_note&&<p>Decisión: {report.review_note}</p>}
    {report.status==='pending'&&<><label className="op-field">Motivo de la decisión<textarea rows={3} maxLength={500} value={reason} disabled={busy||locked} onChange={e=>onReason(e.target.value)}/></label>
      <p className="muted">Explica entre 12 y 500 caracteres. Si falla la conexión, consulta el estado antes de reintentar la misma decisión.</p>
      <div className="op-actions">{report.context==='message'&&<button className="btn danger" disabled={busy||Array.from(reason.trim()).length<12} onClick={()=>onAction('hide')}>Retirar mensaje</button>}<button className="btn" disabled={busy||Array.from(reason.trim()).length<12} onClick={()=>onAction('dismiss')}>Archivar reporte</button></div></>}
  </>;
}
function ErasureWorkspace() {
  const [params,setParams]=useSearchParams(), selected=params.get('ticket'), offset=Math.min(10000,Math.max(0,Number(params.get('offset'))||0));
  const {data,loading,error,reload}=useSafetyResource(`erasure-list:${offset}`,()=>api.get(`/administration/erasure?offset=${offset}&limit=20`),value=>value);
  return <><p className="muted">Cada tramitación procede de una petición verificada de la propia cuenta. CTP conserva las claves y resultados competitivos. El proceso sólo termina cuando confirma los datos, archivos, Manager, la revisión de conservación y el envío final.</p>
    <section className="op-card"><div className="op-actions"><h2>Peticiones recibidas</h2><button className="btn" onClick={reload} disabled={loading}>Actualizar</button></div><ErrorBox error={error} retry={reload}/>
      {loading?<Spinner/>:data&&<DataTable rows={data.requests.map(row=>({...row,id:row.request.ticket_id}))} columns={[{key:'username',title:'Cuenta',render:r=>r.request.username},{key:'requested_at',title:'Solicitada',render:r=>dateTime(r.request.requested_at)},{key:'state',title:'Tramitación',render:r=>ERASURE_STATES[r.job?.state||'not_prepared']},{key:'open',title:'Revisar',render:r=><button className="btn" onClick={()=>setParams({ticket:r.request.ticket_id,offset:String(offset)})}>Abrir solicitud</button>}]} empty="No hay solicitudes de privacidad"/>}
      <div className="op-actions"><button className="btn" disabled={loading||offset===0} onClick={()=>setParams({offset:String(offset-20)})}>Anterior</button><button className="btn" disabled={loading||!data?.has_more} onClick={()=>setParams({offset:String(offset+20)})}>Siguiente</button></div>
    </section>{selected&&data&&!loading&&!error&&<ErasureDetail key={selected} id={selected} onChanged={reload}/>}</>;
}
function ErasureDetail({id,onChanged}) {
  const {data:job,loading,error,reload,busy,needsRead,mutate}=useSafetyResource(`erasure:${id}`,()=>api.get(`/administration/erasure/requests/${encodeURIComponent(id)}`),value=>{
    if(!value?.ticket_id)return null;if(value.ticket_id!==id)throw Error('CTP ha devuelto otra solicitud.');return value;
  });
  const [typed,setTyped]=useState('');
  useEffect(()=>{setTyped('');},[job]);
  async function act(action) {
    await mutate(current=>{
      const request=current.request;
      const body=action==='prepare'?{expected_request_version:request.request_version,expected_user_version:request.user_version,confirm_username:typed}:{expected_version:current.version};
      const url=action==='prepare'?`requests/${id}/prepare`:`jobs/${current.job_id}/${action}`;
      return api.post(`/administration/erasure/${url}`,body);
    },()=>{setTyped('');onChanged();});
  }
  return <section className="op-card"><div className="op-actions"><h2>Tramitar solicitud</h2><button className="btn" onClick={reload} disabled={busy||loading}>Actualizar estado</button></div><ErrorBox error={error}/>{loading&&!job?<Spinner/>:job?<ErasureJobView job={job} typed={typed} busy={busy||needsRead} onTyped={setTyped} onAction={act}/>:!loading&&<p>La solicitud no está disponible. {error?'Consulta el estado antes de volver a actuar.':''}</p>}</section>;
}
export function ErasureJobView({job,typed,busy,onTyped,onAction}) {
  const request=job.request;
  return <><h3>{ERASURE_STATES[job.state]}</h3>{request&&<p>{request.username} · petición {dateTime(request.requested_at)}</p>}<Link className="btn" to={`/operaciones/incidencias?case=${encodeURIComponent(job.ticket_id)}`}>Conversación de privacidad</Link>
    {job.state==='not_prepared'&&request&&<><p className="op-danger-zone">Preparar vincula las versiones actuales de la petición y la cuenta. El paso siguiente cierra el acceso y empieza a retirar datos personales; no se puede deshacer.</p><label className="op-field">Escribe «{request.username}» para preparar<input autoComplete="off" maxLength={100} value={typed} onChange={e=>onTyped(e.target.value)} disabled={busy}/></label><button className="btn danger" disabled={busy||typed!==request.username} onClick={()=>onAction('prepare')}>Preparar eliminación</button></>}
    {job.job_id&&<><p>Fase: {ERASURE_PHASES[job.phase]}</p><ul>{[['database_sanitized','Datos personales en CTP'],['auth_closed','Acceso y sesiones cerrados'],['storage_verified','Archivos verificados'],['external_verified','Manager y PC Check verificados']].map(([key,label])=><li key={key}>{job.progress[key]?'✓':'Pendiente:'} {label}</li>)}</ul>
      {job.blocked_reasons.length>0&&<p className="op-error" role="status">Pendiente de resolver: {job.blocked_reasons.join(' · ')}. Una evidencia conservada exige una decisión documentada; esta pantalla no permite saltarla.</p>}
      {canProcessErasure(job)&&<button className="btn danger" disabled={busy} onClick={()=>onAction('process')}>Procesar datos y archivos</button>}
      {canInspectErasure(job)&&<button className="btn" disabled={busy} onClick={()=>onAction('inspect')}>Comprobar Manager y PC Check</button>}
      {job.state==='awaiting_confirmation'&&<p role="status">La confirmación final sigue pendiente. Actualiza para comprobar el envío.</p>}
      {job.state==='completed'&&<p role="status">Completada el {dateTime(job.completed_at)}. CTP ha confirmado las fases y aceptado el envío final.</p>}
      {job.local_inspection&&<p>Inspección local: {ERASURE_STATES[job.local_inspection.status]||job.local_inspection.status} · recibo <code>{job.local_receipt_sha256}</code></p>}
    </>}
  </>;
}
