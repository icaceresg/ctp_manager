import {useEffect,useRef,useState} from 'react';
import {api} from '../api.js';
import {Spinner} from '../components/ui.jsx';
import UserProfileDialog from './UserProfileDialog.jsx';
import {createAvatarRemovalIntent,canRemoveReportedAvatar} from './safetyModel.js';
import {useSafetyResource} from './useSafetyResource.jsx';

/** A profile report is read separately: neither its historical avatar nor a
 * current profile field authorizes a URL fetch or a blind destructive write. */
export default function AvatarModerationPanel({reportId,onReportChanged}) {
  const {data:value,scope,loading,error,reload,busy,needsRead,mutate}=useSafetyResource(`avatar:${reportId}`,()=>api.get(`/administration/ugc/${reportId}/avatar`),data=>{
    if(!data?.report)return null;if(data.report.id!==reportId)throw Error('CTP ha devuelto otra denuncia.');return data;
  });
  const [reason,setReason]=useState(''),[editing,setEditing]=useState(false),[locked,setLocked]=useState(false);
  const intent=useRef(null);if(!intent.current)intent.current=createAvatarRemovalIntent();
  useEffect(()=>{intent.current.reset();setReason('');setEditing(false);setLocked(false);},[scope]);
  useEffect(()=>{const pending=value?intent.current.reconcile(value):null;setEditing(false);setReason(pending?.reason||'');setLocked(Boolean(pending));},[value]);
  async function act(action){
    let body;
    await mutate(current=>{
      if(action==='remove'&&!canRemoveReportedAvatar(current)||action==='retry'&&(!current.job||current.job.state==='completed'))throw Error('Actualiza el estado antes de continuar.');
      body=action==='remove'?intent.current.begin(current,reason):{expected_version:current.job.version};
      const path=action==='remove'?`${reportId}/avatar/remove`:`avatar-jobs/${current.job.job_id}/retry`;
      return api.post(`/administration/ugc/${path}`,body);
    },result=>{if(action==='remove')intent.current.confirm(reportId,body,result);onReportChanged?.(result.report);});
  }
  return <section className="op-case-panel"><div className="op-section-title"><h3>Perfil y avatar denunciados</h3><button className="btn" disabled={busy||loading} onClick={reload}>Actualizar perfil y retirada</button></div>
    {error&&<p className="op-error" role="alert">{error.message} Consulta el estado antes de reintentar.</p>}
    {loading&&!value?<Spinner/>:value&&<AvatarModerationView value={value} reason={reason} busy={busy||needsRead} locked={locked} onReason={setReason} onRemove={()=>act('remove')} onRetry={()=>act('retry')} onEdit={()=>setEditing(true)}/>}
    {!loading&&!value&&!error&&<p>El perfil y la denuncia no están disponibles.</p>}
    {editing&&value?.user&&<UserProfileDialog id={value.user.id} onClose={()=>setEditing(false)} onSaved={()=>{setEditing(false);void reload();}}/>}
  </section>;
}
export function AvatarModerationView({value,reason,busy,locked,onReason,onRemove,onRetry,onEdit}) {
  const {report,user,preview,job}=value;
  if(!user)return <p className="muted">La cuenta denunciada ya no está disponible. El reporte se conserva para su revisión; no permite editar el perfil ni retirar otro avatar.</p>;
  return <><div className="op-form-grid">{[['Avatar en la denuncia',preview.reported_avatar_url],['Avatar actual',preview.current_avatar_url]].map(([label,url])=><div key={label}><strong>{label}</strong><div>{url?<img src={url} alt={label} width={96} height={96} referrerPolicy="no-referrer" style={{objectFit:'cover',borderRadius:8}}/>:<p className="muted">Sin vista previa segura. No se carga una imagen externa.</p>}</div></div>)}</div>
    <p><strong>Nombre actual:</strong> {user.username}</p><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}><strong>Biografía actual:</strong> {user.bio||'Sin biografía'}</p>
    {(report.meta?.content_omitted||user.meta?.content_omitted||report.meta?.avatar_preview_omitted||user.meta?.avatar_preview_omitted)&&<p className="muted">{report.meta?.avatar_preview_omitted||user.meta?.avatar_preview_omitted?'Avatar original omitido por tamaño o formato, sin vista previa.':'Parte del contenido original se ha omitido por tamaño o formato.'} La denuncia y la corrección del perfil siguen disponibles.</p>}
    <button className="btn" disabled={busy||locked} onClick={onEdit}>Corregir nombre o biografía del perfil actual</button>
    {!job&&report.status==='pending'&&(canRemoveReportedAvatar(value)?<><label className="op-field">Motivo de la retirada del avatar<textarea value={reason} onChange={e=>onReason(e.target.value)} maxLength={500} rows={3} disabled={busy||locked}/></label><p className="muted">Se comprueban las versiones de la denuncia y del perfil actual. La retirada de la imagen y su archivo se confirman por separado.</p><button className="btn danger" disabled={busy||Array.from(reason.trim()).length<12} onClick={onRemove}>{locked?'Reintentar la misma retirada':'Retirar avatar actual'}</button></>:<p className="muted">{value.eligibility?.matches_reported_avatar===false&&value.eligibility?.avatar_present===true&&value.eligibility?.can_remove===false?'El avatar actual ha cambiado desde esta denuncia. Actualiza o revisa el perfil; esta denuncia no permite retirar la nueva imagen.':'CTP no autoriza retirar el avatar actual con esta denuncia. Actualiza el estado para comprobar el perfil.'}</p>)}
    {job&&<><p role="status">{job.state==='completed'?(job.kind==='owned'?'Avatar retirado y archivo propio eliminado con confirmación de Storage.':'Avatar retirado del perfil. No se ha eliminado ningún archivo externo.'):'El perfil ya no muestra el avatar. La comprobación del archivo sigue pendiente.'}</p>
      {job.error_code&&<p className="op-error">CTP no ha completado la comprobación: {job.error_code}. Actualiza o reintenta el mismo trabajo.</p>}
      {job.state!=='completed'&&<button className="btn" disabled={busy} onClick={onRetry}>Reintentar comprobación del archivo</button>}
    </>}
  </>;
}
