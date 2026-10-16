import { useCallback,useEffect,useRef,useState } from 'react';
import { api } from '../api.js';
import { DecisionPanel } from './DecisionPanel.jsx';
import { dateTime } from './model.js';

const statusLabels={abierto:'Abierto',en_revision:'En revisión',esperando_respuesta:'Esperando respuesta',resuelto:'Resuelto',rechazado:'Rechazado',cerrado:'Cerrado'};
const queryUrl=(resource,id,kind,cursor)=>`/operations/cases?${new URLSearchParams({resource,target_id:id,...(kind?{kind}:{}),...(cursor?{cursor}:{})})}`;
export function OfficialIncidentStatus({incident,data,reload,mutate}){
 const[official,setOfficial]=useState(null),[status,setStatus]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
 const serial=useRef(0),lock=useRef(null),scope=useRef(incident.id);scope.current=incident.id;
 const load=useCallback(async()=>{
  const request=++serial.current;setLoading(true);setError('');
  try{const result=await api.get(queryUrl('incident',incident.id));if(request!==serial.current)return;setOfficial(result.incident);setStatus(result.incident.status);}
  catch(problem){if(request===serial.current){setError(problem.message);if([401,403].includes(problem.status))setOfficial(null);}}
  finally{if(request===serial.current)setLoading(false);}
 },[incident.id]);
 useEffect(()=>{setOfficial(null);setReason('');setBusy(false);lock.current=null;if(incident.source!=='manager'&&incident.kind!=='ranked')load();return()=>{serial.current++;};},[load,incident.source,incident.kind]);
 if(incident.source==='manager'||incident.kind==='ranked')return null;
 const supported=data?.connection?.supported_actions?.includes('incident.status');
 async function submit(event){
  event.preventDefault();if(lock.current||!official)return;const token=Symbol(),activeScope=incident.id;lock.current=token;setBusy(true);setError('');
  try{await mutate('post','/cases/commands',{type:'incident.status',target_id:incident.id,expected_version:official.manager_version,payload:{status,reason}},'Cambio de estado preparado. Un administrador debe enviarlo a CTP.');if(scope.current!==activeScope)return;setReason('');await reload?.();}
  catch(problem){if(scope.current===activeScope)setError(problem.message);}finally{if(lock.current===token){lock.current=null;setBusy(false);}}
 }
 return <section className="op-case-panel"><h3>Estado oficial del expediente</h3><p className="muted">El seguimiento interno y el estado visible para los jugadores se gestionan por separado.</p>
  {error&&<p className="op-error" role="alert">{error}</p>}<div className="op-actions"><strong>{official?statusLabels[official.status]||official.status:'Consultando CTP…'}</strong><button className="btn sm" disabled={loading||busy} onClick={load}>Actualizar estado</button></div>
  {official?.status_editable&&<form onSubmit={submit} className="op-form-grid"><label className="op-field">Nuevo estado<select value={status} onChange={event=>setStatus(event.target.value)} disabled={busy||loading}>{Object.entries(statusLabels).map(([value,name])=><option key={value} value={value}>{name}</option>)}</select></label><label className="op-field">Motivo<textarea rows={3} value={reason} onChange={event=>setReason(event.target.value)} minLength={12} maxLength={2000} required disabled={busy||loading}/></label><button className="btn primary" disabled={busy||loading||!supported||reason.trim().length<12} type="submit">{busy?'Preparando…':'Preparar cambio oficial'}</button></form>}
  {official&&!official.status_editable&&<p className="muted">Esta cuenta no puede modificar el estado de este expediente.</p>}
  <DecisionPanel data={data||{}} resourceType="case_incident" resourceId={incident.id} reload={reload} onChanged={load}/>
 </section>;
}

export function MatchConversation({kind,id,data,reload,mutate}){
 const[state,setState]=useState(null),[messages,setMessages]=useState([]),[text,setText]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
 const serial=useRef(0),lock=useRef(null),scope=useRef(`${kind}:${id}`);scope.current=`${kind}:${id}`;
 const load=useCallback(async(cursor=null)=>{
  const request=++serial.current;setLoading(true);setError('');
  try{const result=await api.get(queryUrl('match_context',id,kind,cursor));if(request!==serial.current)return;setState(result);setMessages(previous=>cursor?[...new Map([...previous,...result.messages].map(message=>[message.id,message])).values()]:result.messages);}
  catch(problem){if(request===serial.current){setError(problem.message);if([401,403].includes(problem.status)){setState(null);setMessages([]);}}}
  finally{if(request===serial.current)setLoading(false);}
 },[kind,id]);
 useEffect(()=>{setState(null);setMessages([]);setText('');setNotice('');setBusy(false);lock.current=null;if(['tournament','challenge'].includes(kind))load();const timer=setInterval(()=>{if(document.visibilityState==='visible'&&!lock.current&&['tournament','challenge'].includes(kind))void load();},15000);return()=>{clearInterval(timer);serial.current++;};},[load,kind]);
 if(!['tournament','challenge'].includes(kind))return null;
 async function submit(event){
  event.preventDefault();if(lock.current||!state?.match||!text.trim())return;const activeScope=`${kind}:${id}`,token=Symbol();lock.current=token;setBusy(true);setError('');setNotice('');
  try{const body={type:'match.reply',target_id:id,expected_version:state.match.manager_version,payload:{kind,text}};
   if(mutate)await mutate('post','/cases/commands',body,'Respuesta preparada. Pendiente de envío por administración.');else await api.post('/operations/cases/commands',body);
   if(scope.current!==activeScope)return;setText('');setNotice('Respuesta preparada. Un administrador debe enviarla para publicarla en el chat.');await reload?.();
  }catch(problem){if(scope.current===activeScope)setError(problem.message);}finally{if(lock.current===token){lock.current=null;setBusy(false);}}
 }
 return <section className="op-card"><div className="op-section-title"><h3>Conversación del partido</h3><button className="btn sm" disabled={loading||busy} onClick={()=>load()}>Actualizar conversación</button></div><p className="muted">Mensajes del chat compartido con los jugadores. Las notas internas se conservan en su propio apartado.</p>
  {error&&<p className="op-error" role="alert">{error}</p>}{notice&&<p className="op-notice" role="status">{notice}</p>}{loading&&<p role="status">Consultando conversación…</p>}
  {state&&(messages.length?<ol className="op-notes">{[...messages].reverse().map(message=><li key={message.id}><div className="op-note-heading"><strong>{message.author_name||'Participante'}{message.is_staff?' · Staff':''}</strong><span>{dateTime(message.created_at)}</span></div><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{message.text}</p></li>)}</ol>:<p className="muted">No hay mensajes disponibles en esta conversación.</p>)}
  {state?.next_cursor&&<button className="btn" disabled={loading||busy} onClick={()=>load(state.next_cursor)}>Cargar mensajes anteriores</button>}
  {state?.can_write?<form onSubmit={submit}><label className="op-field">Respuesta a los jugadores<textarea value={text} onChange={event=>setText(event.target.value)} maxLength={state.text_limit} rows={3} required disabled={busy}/></label><p className="muted">{text.length}/{state.text_limit}</p><button className="btn primary" type="submit" disabled={busy||loading||!text.trim()||data?.connection?.supported_actions&&!data.connection.supported_actions.includes('match.reply')}>{busy?'Preparando…':'Preparar respuesta'}</button></form>:state&&<p className="op-notice">El chat es de solo lectura en este estado. En retos, espera a la revelación del rival y a que ambos equipos estén confirmados.</p>}
  {data&&<DecisionPanel data={data} resourceType="case_match" resourceId={id} reload={reload} onChanged={()=>load()}/>}
 </section>;
}
