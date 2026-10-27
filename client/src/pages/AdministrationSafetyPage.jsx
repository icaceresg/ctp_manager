import { useEffect,useRef,useState } from 'react';
import { Link,Navigate,useSearchParams } from 'react-router-dom';
import { ShieldCheck,RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { useApp,useData } from '../context.jsx';
import { Spinner } from '../components/ui.jsx';
import { dateTime } from '../operations/model.js';
import { DataTable } from '../operations/ui.jsx';
import { ERASURE_STATES,ERASURE_PHASES,UGC_REASONS,UGC_STATES,canProcessErasure,canInspectErasure,createModerationIntent } from './safetyModel.js';
import '../operations/operations.css';

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
  const {data,loading,error,reload}=useData(async()=>({...await api.get(`/administration/ugc?${new URLSearchParams({status,offset,limit:20})}`),key}),[key]);
  const list=data?.key===key?data:null;
  const choose=id=>setParams(previous=>{const next=new URLSearchParams(previous);id?next.set('reporte',id):next.delete('reporte');return next;});
  return <><p className="muted">Los reportes incluyen su ticket de soporte. Retirar oculta el mensaje en Ranked; archivar cierra la revisión del reporte sin restaurar contenido retirado.</p>
    <section className="op-card"><div className="op-actions"><label>Estado <select value={status} onChange={e=>setParams({estado:e.target.value})}>{['pending','hidden','dismissed','all'].map(s=><option key={s} value={s}>{UGC_STATES[s]||'Todos'}</option>)}</select></label><button className="btn" onClick={reload} disabled={loading}><RefreshCw size={15}/>Actualizar</button></div>
      <ErrorBox error={error} retry={reload}/>{loading&&!list?<Spinner/>:<DataTable rows={list?.items||[]} columns={[{key:'ticket_code',title:'Ticket'},{key:'target_username',title:'Cuenta'},{key:'reason',title:'Motivo',render:r=>UGC_REASONS[r.reason]},{key:'status',title:'Revisión',render:r=>UGC_STATES[r.status]},{key:'open',title:'Revisar',render:r=><button className="btn" onClick={()=>choose(r.id)}>Abrir reporte</button>}]} empty="No hay reportes en esta vista"/>}
      <div className="op-actions"><button className="btn" disabled={loading||offset===0} onClick={()=>setParams({estado:status,offset:String(offset-20)})}>Anterior</button><span>{list?.total??'—'} reportes</span><button className="btn" disabled={loading||!list||offset+20>=list.total} onClick={()=>setParams({estado:status,offset:String(offset+20)})}>Siguiente</button></div>
    </section>{selected&&<ModerationDetail key={selected} id={selected} onChanged={reload}/>}</>;
}
function ModerationDetail({id,onChanged}) {
  const {data,loading,error,reload}=useData(()=>api.get(`/administration/ugc/${encodeURIComponent(id)}`),[id]);
  const [report,setReport]=useState(null),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[problem,setProblem]=useState('');
  const intent=useRef(null),lock=useRef(false);if(!intent.current)intent.current=createModerationIntent();
  useEffect(()=>{if(data?.report?.id===id){setReport(data.report);intent.current.reset();}},[data,id]);
  async function act(action) {
    if(lock.current||!report)return; lock.current=true;setBusy(true);setProblem('');
    try {const body=intent.current.begin(report,action,reason), result=await api.post(`/administration/ugc/${id}`,body);intent.current.confirm(id,body,result);setReport(result.report);setReason('');onChanged();}
    catch(e){setProblem(e.message);}finally{lock.current=false;setBusy(false);}
  }
  return <section className="op-card"><h2>Revisión del reporte</h2><ErrorBox error={error||problem} retry={reload}/>{loading&&!report?<Spinner/>:report?<ModerationReportView report={report} reason={reason} busy={busy} locked={Boolean(intent.current.pending)} onReason={setReason} onAction={act}/>:!loading&&<p>El reporte no está disponible.</p>}</section>;
}
export function ModerationReportView({report,reason,busy,locked,onReason,onAction}) {
  return <><p><strong>{report.target_username||'Cuenta eliminada'}</strong> · {UGC_STATES[report.status]} · {dateTime(report.created_at)}</p><p>{UGC_REASONS[report.reason]}</p>
    <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{report.details}</p>
    {report.evidence.message&&<blockquote style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{report.evidence.message}</blockquote>}
    {report.evidence.redacted&&<p className="muted">Los datos personales de esta evidencia se han retirado.</p>}
    <div className="op-actions"><Link className="btn" to={`/operaciones/incidencias?case=${encodeURIComponent(report.ticket_id)}`}>Ticket {report.ticket_code}</Link>{report.lobby_id&&<Link className="btn" to={`/ranked/partidas/${encodeURIComponent(report.lobby_id)}`}>Contexto de la partida</Link>}</div>
    {report.review_note&&<p>Decisión: {report.review_note}</p>}
    {report.status==='pending'&&<><label className="op-field">Motivo de la decisión<textarea rows={3} maxLength={500} value={reason} disabled={busy||locked} onChange={e=>onReason(e.target.value)}/></label>
      <p className="muted">Explica entre 12 y 500 caracteres. Si falla la conexión, se reintenta la misma decisión sin duplicarla.</p>
      <div className="op-actions">{report.context==='message'&&<button className="btn danger" disabled={busy||Array.from(reason.trim()).length<12} onClick={()=>onAction('hide')}>Retirar mensaje</button>}<button className="btn" disabled={busy||Array.from(reason.trim()).length<12} onClick={()=>onAction('dismiss')}>Archivar reporte</button></div></>}
  </>;
}
function ErasureWorkspace() {
  const [params,setParams]=useSearchParams(), selected=params.get('ticket'), offset=Math.min(10000,Math.max(0,Number(params.get('offset'))||0));
  const {data,loading,error,reload}=useData(()=>api.get(`/administration/erasure?offset=${offset}&limit=20`),[offset]);
  return <><p className="muted">Cada tramitación procede de una petición verificada de la propia cuenta. CTP conserva las claves y resultados competitivos. El proceso sólo termina cuando confirma los datos, archivos, Manager, la revisión de conservación y el envío final.</p>
    <section className="op-card"><div className="op-actions"><h2>Peticiones recibidas</h2><button className="btn" onClick={reload} disabled={loading}>Actualizar</button></div><ErrorBox error={error} retry={reload}/>
      {loading&&!data?<Spinner/>:<DataTable rows={(data?.requests||[]).map(row=>({...row,id:row.request.ticket_id}))} columns={[{key:'username',title:'Cuenta',render:r=>r.request.username},{key:'requested_at',title:'Solicitada',render:r=>dateTime(r.request.requested_at)},{key:'state',title:'Tramitación',render:r=>ERASURE_STATES[r.job?.state||'not_prepared']},{key:'open',title:'Revisar',render:r=><button className="btn" onClick={()=>setParams({ticket:r.request.ticket_id,offset:String(offset)})}>Abrir solicitud</button>}]} empty="No hay solicitudes de privacidad"/>}
      <div className="op-actions"><button className="btn" disabled={loading||offset===0} onClick={()=>setParams({offset:String(offset-20)})}>Anterior</button><button className="btn" disabled={loading||!data?.has_more} onClick={()=>setParams({offset:String(offset+20)})}>Siguiente</button></div>
    </section>{selected&&<ErasureDetail key={selected} id={selected} onChanged={reload}/>}</>;
}
function ErasureDetail({id,onChanged}) {
  const {data,loading,error,reload}=useData(()=>api.get(`/administration/erasure/requests/${encodeURIComponent(id)}`),[id]);
  const [job,setJob]=useState(null),[typed,setTyped]=useState(''),[busy,setBusy]=useState(false),[problem,setProblem]=useState(''),[needsRead,setNeedsRead]=useState(false);
  const lock=useRef(false);
  useEffect(()=>{if(data?.ticket_id===id){setJob(data);setNeedsRead(false);setTyped('');}},[data,id]);
  async function act(action) {
    if(lock.current||!job||needsRead)return;lock.current=true;setBusy(true);setProblem('');
    try {
      const request=job.request;
      const body=action==='prepare'?{expected_request_version:request.request_version,expected_user_version:request.user_version,confirm_username:typed}:{expected_version:job.version};
      const url=action==='prepare'?`requests/${id}/prepare`:`jobs/${job.job_id}/${action}`;
      const result=await api.post(`/administration/erasure/${url}`,body);setJob(result);setTyped('');onChanged();
    } catch(e){setProblem(`${e.message} Actualiza el estado antes de volver a actuar.`);setNeedsRead(true);}finally{lock.current=false;setBusy(false);}
  }
  return <section className="op-card"><div className="op-actions"><h2>Tramitar solicitud</h2><button className="btn" onClick={reload} disabled={busy||loading}>Actualizar estado</button></div><ErrorBox error={error||problem}/>{loading&&!job?<Spinner/>:job&&<ErasureJobView job={job} typed={typed} busy={busy||needsRead} onTyped={setTyped} onAction={act}/>}</section>;
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
