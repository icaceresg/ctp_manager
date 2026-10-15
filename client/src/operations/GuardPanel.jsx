import { useEffect, useRef, useState } from 'react';
import { Info, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../api.js';
import { Modal } from '../components/ui.jsx';
import { DataTable, Field, FormDialog } from './ui.jsx';
import { dateTime } from './model.js';
import { actionLabel } from './actionLabels.js';
const status={ready:'Conectado',console_verified:'Consola verificada',guard_not_connected:'Sin Guard',signal_lost:'Señal perdida',controller_missing:'Mando desconectado',camera_missing:'Cámara no disponible',capture_missing:'Captura no disponible'};
const events={paired:'Guard vinculado',connected:'Conectado',reconnected:'Reconectado',signal_changed:'Cambio de señal',closed:'Sesión cerrada',match_started:'Inicio autorizado',console_exempted:'Consola verificada',console_revoked:'Verificación revocada',tournament_enabled:'Guard habilitado',tournament_disabled:'Guard deshabilitado',lineup_selected:'Titulares seleccionados'};
export function GuardPanel({id}){
 const [state,setState]=useState(null),[error,setError]=useState(''),[dialog,setDialog]=useState(null),[info,setInfo]=useState(false),[busy,setBusy]=useState(false),[,setTick]=useState(0);
 const [receivedAt,setReceivedAt]=useState(0);
 const epoch=useRef(0),alive=useRef(true),loading=useRef(false);
 async function refresh(){
  if(loading.current)return;loading.current=true;const generation=epoch.current;
  try{const next=await api.get(`/operations/matches/${encodeURIComponent(id)}/guard`);if(alive.current&&epoch.current===generation){setState(next);setReceivedAt(Date.now());setError('');}}
  catch(e){if(alive.current&&epoch.current===generation)setError(e.message);}
  finally{loading.current=false;}
 }
 useEffect(()=>{alive.current=true;epoch.current++;setState(null);setError('');refresh();
  const poll=setInterval(()=>{setTick(v=>v+1);if(!document.hidden)refresh();},5000);
  const visible=()=>{if(!document.hidden)refresh();};document.addEventListener('visibilitychange',visible);
  return()=>{alive.current=false;epoch.current++;clearInterval(poll);document.removeEventListener('visibilitychange',visible);};
 },[id]);
 const connected=state?.players.filter(p=>['ready','console_verified'].includes(p.state)).length??0;
 const fresh=!error&&state&&Date.now()-receivedAt<10000;
 const pending=state?.commands.find(c=>['pending','failed','sending','rejected'].includes(c.status));
 async function send(command){setBusy(true);setError('');try{await api.post(`/operations/guard/commands/${command.id}/send`,{});await refresh();}catch(e){await refresh();setError(e.message);throw e;}finally{setBusy(false);}}
 async function submit(body){
  const payload=dialog.type==='guard.start'?{}:dialog.type==='guard.exempt'?{user_id:dialog.player.user_id,approve:dialog.player.state!=='console_verified',reason:body.reason}
   :{enabled:body.enabled==='true',controller_required:body.controller_required==='true',capture_required:body.capture_required==='true',reason:body.reason};
  const prepared=await api.post(`/operations/matches/${id}/guard/commands`,{type:dialog.type,target_id:dialog.target,expected_version:dialog.version,payload});
  await send(prepared.command);
 }
 const open=(type,player)=>setDialog({type,player,version:type==='guard.configure'?state.tournament_version:state.match_version,target:type==='guard.configure'?state.tournament_id:id});
 return <section className="op-card op-guard" aria-label="CTP Guard">
  <div className="op-section-title"><div><h2><ShieldCheck size={19}/> Lobby · CTP Guard</h2><p>{state?.started_at?`Inicio autorizado · ${dateTime(state.started_at)}`:state?.enabled?`${connected}/8 jugadores listos`:state?'Guard no exigido en este torneo':'Consultando el estado de Guard…'}</p></div>
   <div className="op-actions"><button className="btn" onClick={()=>setInfo(true)} aria-label="Información sobre Guard"><Info size={16}/></button><button className="btn" onClick={refresh} disabled={busy} aria-label="Actualizar Guard"><RefreshCw size={16}/></button>
    {state&&!state.started_at&&<button className="btn" onClick={()=>open('guard.configure')} disabled={busy||!!pending}>Configurar torneo</button>}
    {state?.enabled&&!state.started_at&&<button className="btn primary" disabled={!state.ready||!fresh||busy||!!pending} onClick={()=>open('guard.start')}>Autorizar inicio</button>}
   </div></div>
  {error&&<p className="op-error" role="alert">{error}</p>}
  {state?.enabled&&<><div className="op-guard-meter" aria-hidden="true"><span style={{width:`${connected/8*100}%`}}/></div>
   {state.lineup_pending&&<p className="op-error">Los líderes deben seleccionar cuatro titulares por equipo en CTP.</p>}
   {!fresh&&<p className="muted">Estado pendiente de actualizar. El inicio permanece bloqueado.</p>}
   <div className="op-guard-desktop"><DataTable rows={state.players} columns={[{key:'username',title:'Jugador'},{key:'side',title:'Lado',render:p=>p.side.toUpperCase()},{key:'state',title:'Estado',render:p=><span className={`op-guard-state ${['ready','console_verified'].includes(p.state)?'ready':''}`}>{status[p.state]}</span>},{key:'last_seen_at',title:'Última señal',render:p=>dateTime(p.last_seen_at)},
    {key:'action',title:'Consola',render:p=>!state.started_at&&<button className="btn" disabled={busy||!!pending} onClick={()=>open('guard.exempt',p)}>{p.state==='console_verified'?'Revocar':'Verificar'}</button>}]}/></div>
   <ul className="op-guard-players" aria-label="Jugadores Guard">{state.players.map(p=><li key={p.user_id}>
    <div><strong>{p.username}</strong><small>Lado {p.side.toUpperCase()}</small></div>
    <p className={`op-guard-state ${['ready','console_verified'].includes(p.state)?'ready':''}`}>{status[p.state]}</p>
    <div><small>Señal: {dateTime(p.last_seen_at)}</small>{!state.started_at&&<button className="btn" disabled={busy||!!pending} onClick={()=>open('guard.exempt',p)}>{p.state==='console_verified'?'Revocar':'Verificar consola'}</button>}</div>
   </li>)}</ul>
   <details className="op-guard-events"><summary>Actividad reciente · {state.events.length}</summary><ol>{state.events.map(e=><li key={e.id}><strong>{events[e.kind]||'Cambio de Guard'}</strong> · {state.players.find(p=>p.user_id===e.user_id)?.username||'Staff'} · {dateTime(e.created_at)}{e.detail&&<p>{e.detail}</p>}</li>)}</ol></details>
  </>}
  {pending&&<div className="op-guard-pending"><p>{actionLabel(pending.type)} · {pending.status==='rejected'?'Rechazada':pending.status==='sending'?'Enviando':'Pendiente de confirmar'}</p>{pending.last_error&&<p className="op-error">{pending.last_error}</p>}
   {['pending','failed','sending'].includes(pending.status)&&<button className="btn" disabled={busy||(pending.status==='sending'&&Date.now()-pending.updated_at<30000)} onClick={()=>send(pending).catch(()=>{})}>Reintentar misma solicitud</button>}
   {(pending.status==='pending'&&pending.attempts===0||pending.status==='rejected')&&<button className="btn" disabled={busy} onClick={async()=>{try{await api.post(`/operations/commands/${pending.id}/cancel`,{expected_updated_at:pending.updated_at});await refresh();}catch(e){setError(e.message);}}}>Descartar solicitud</button>}
  </div>}
  {dialog&&<FormDialog title={dialog.type==='guard.start'?'Autorizar el inicio del partido':dialog.type==='guard.exempt'?`${dialog.player.state==='console_verified'?'Revocar verificación':'Verificar consola'} · ${dialog.player.username}`:'Requisitos Guard del torneo'} onClose={()=>setDialog(null)} submit={submit} submitLabel="Confirmar y enviar a CTP">
   {dialog.type==='guard.start'?<p>El servidor comprobará de nuevo las ocho conexiones o verificaciones de consola. Esta acción registra la autorización de inicio.</p>:<>
    {dialog.type==='guard.configure'&&<><Field label="Guard en este torneo"><select name="enabled" defaultValue={String(state.enabled)}><option value="true">Exigido</option><option value="false">Desactivado</option></select></Field><Field label="Mando conectado"><select name="controller_required" defaultValue={String(state.enabled?state.controller_required:true)}><option value="true">Obligatorio</option><option value="false">No exigido</option></select></Field><Field label="Captura preparada"><select name="capture_required" defaultValue={String(state.capture_required)}><option value="true">Obligatoria</option><option value="false">No exigida</option></select></Field></>}
    <Field label="Motivo registrado"><textarea name="reason" minLength={12} maxLength={160} required rows={3}/></Field></>}
  </FormDialog>}
  {info&&<Modal title="Qué comprueba CTP Guard" onClose={()=>setInfo(false)}><p>Guard envía una señal cada cinco segundos. Tras quince segundos sin señal, el jugador deja de estar listo. Se comprueban los cuatro titulares de cada club.</p><p>El árbitro verifica las consolas con un motivo y puede revocarlo antes del inicio. Este estado comprueba presencia y señales; no certifica que un PC esté libre de trampas. La cámara todavía no está habilitada.</p></Modal>}
 </section>;
}
