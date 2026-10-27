import {useEffect,useRef,useState} from 'react';
import {api} from '../api.js';
import {useData} from '../context.jsx';
import {Spinner} from '../components/ui.jsx';
import UserProfileDialog from './UserProfileDialog.jsx';
import {createAvatarRemovalIntent} from './safetyModel.js';

/** A profile report is read separately: neither its historical avatar nor a
 * current profile field authorizes a URL fetch or a blind destructive write. */
export default function AvatarModerationPanel({reportId,onReportChanged}) {
  const {data,loading,error,reload}=useData(()=>api.get(`/administration/ugc/${reportId}/avatar`),[reportId]);
  const [value,setValue]=useState(null),[reason,setReason]=useState(''),[problem,setProblem]=useState(''),[busy,setBusy]=useState(false),[needsRead,setNeedsRead]=useState(false),[editing,setEditing]=useState(false);
  const lock=useRef(false),intent=useRef(null);if(!intent.current)intent.current=createAvatarRemovalIntent();
  useEffect(()=>{if(data?.report?.id===reportId){setValue(data);intent.current.reset();setNeedsRead(false);setProblem('');setReason('');}},[data,reportId]);
  async function act(action){
    if(lock.current||!value||needsRead)return;lock.current=true;setBusy(true);setProblem('');
    try{
      const body=action==='remove'?intent.current.begin(value,reason):{expected_version:value.job.version};
      const path=action==='remove'?`${reportId}/avatar/remove`:`avatar-jobs/${value.job.job_id}/retry`;
      const result=await api.post(`/administration/ugc/${path}`,body);
      if(action==='remove')intent.current.confirm(reportId,body,result);
      setValue(result);onReportChanged?.(result.report);
    }catch(e){setProblem(e.message);if(action==='retry')setNeedsRead(true);}
    finally{lock.current=false;setBusy(false);}
  }
  return <section className="op-case-panel"><div className="op-section-title"><h3>Perfil y avatar denunciados</h3><button className="btn" disabled={busy||loading} onClick={reload}>Actualizar perfil y retirada</button></div>
    {(error||problem)&&<p className="op-error" role="alert">{error?.message||problem} {needsRead?'Consulta el estado antes de reintentar.':''}</p>}
    {loading&&!value?<Spinner/>:value&&<AvatarModerationView value={value} reason={reason} busy={busy||needsRead} locked={Boolean(intent.current.pending)} onReason={setReason} onRemove={()=>act('remove')} onRetry={()=>act('retry')} onEdit={()=>setEditing(true)}/>}
    {editing&&value&&<UserProfileDialog id={value.user.id} onClose={()=>setEditing(false)} onSaved={()=>{setEditing(false);void reload();}}/>}
  </section>;
}
export function AvatarModerationView({value,reason,busy,locked,onReason,onRemove,onRetry,onEdit}) {
  const {report,user,preview,job}=value;
  return <><div className="op-form-grid">{[['Avatar en la denuncia',preview.reported_avatar_url],['Avatar actual',preview.current_avatar_url]].map(([label,url])=><div key={label}><strong>{label}</strong><div>{url?<img src={url} alt={label} width={96} height={96} referrerPolicy="no-referrer" style={{objectFit:'cover',borderRadius:8}}/>:<p className="muted">Sin vista previa segura. No se carga una imagen externa.</p>}</div></div>)}</div>
    <p><strong>Nombre actual:</strong> {user.username}</p><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}><strong>Biografía actual:</strong> {user.bio||'Sin biografía'}</p>
    <button className="btn" disabled={busy||locked} onClick={onEdit}>Corregir nombre o biografía del perfil actual</button>
    {!job&&report.status==='pending'&&<><label className="op-field">Motivo de la retirada del avatar<textarea value={reason} onChange={e=>onReason(e.target.value)} maxLength={500} rows={3} disabled={busy||locked}/></label><p className="muted">Se comprueban las versiones de la denuncia y del perfil actual. La retirada de la imagen y su archivo se confirman por separado.</p><button className="btn danger" disabled={busy||Array.from(reason.trim()).length<12} onClick={onRemove}>{locked?'Reintentar la misma retirada':'Retirar avatar actual'}</button></>}
    {job&&<><p role="status">{job.state==='completed'?(job.kind==='owned'?'Avatar retirado y archivo propio eliminado con confirmación de Storage.':'Avatar retirado del perfil. No se ha eliminado ningún archivo externo.'):'El perfil ya no muestra el avatar. La comprobación del archivo sigue pendiente.'}</p>
      {job.error_code&&<p className="op-error">CTP no ha completado la comprobación: {job.error_code}. Actualiza o reintenta el mismo trabajo.</p>}
      {job.state!=='completed'&&<button className="btn" disabled={busy} onClick={onRetry}>Reintentar comprobación del archivo</button>}
    </>}
  </>;
}
