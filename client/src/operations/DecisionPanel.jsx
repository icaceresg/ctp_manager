import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Badge, Empty } from './ui.jsx';
import { canSendCommand, dateTime, label } from './model.js';
import { actionLabel } from './actionLabels.js';

export function DecisionPanel({data,resourceType,resourceId,reload,onChanged}) {
  const [params,setParams]=useSearchParams();
  const {me,toast}=useApp();
  const [busy,setBusy]=useState(null);
  const [error,setError]=useState('');
  const [limit,setLimit]=useState(30);
  const showAll=Boolean(resourceId)||params.get('include_closed')==='1';
  const setShowAll=value=>setParams(previous=>{const next=new URLSearchParams(previous);value?next.set('include_closed','1'):next.delete('include_closed');next.delete('op_page');next.delete('op_revision');return next;},{replace:true});
  const commands=(data.commands||[]).filter(c=>(!resourceType||c.resource_type===resourceType)&&(!resourceId||c.resource_id===resourceId));
  const visible=commands.filter(command=>showAll||!['acknowledged','cancelled'].includes(command.status));
  const connection=data.connection||{};
  const supported=type=>Array.isArray(connection.supported_actions)?connection.supported_actions.includes(type):connection.supported_actions?.[type]===true;
  async function act(command,action){
    if(busy)return;
    setBusy(command.id);setError('');
    try{
      const result=await api.post(action==='send'?`/operations/integration/commands/${encodeURIComponent(command.id)}/send`:`/operations/commands/${encodeURIComponent(command.id)}/cancel`,action==='send'?{}:{expected_updated_at:command.updated_at});
      await reload?.();await onChanged?.(command,action);
      toast(action==='send'?'CTP ha confirmado la decisión.':'Propuesta descartada.');
      if(result.sync_pending)setError('CTP ha confirmado la decisión. La lectura de la nueva revisión está pendiente; sincroniza para actualizar las cifras.');
    }catch(err){setError(err.message);}finally{setBusy(null);}
  }
  if(!commands.length)return resourceId?null:<Empty title="No hay decisiones preparadas">Las propuestas de arbitraje y competición aparecerán aquí antes de su entrega a CTP.</Empty>;
  return <section className="op-card op-decisions"><h3>Decisiones y entrega a CTP</h3><p className="muted">Una propuesta solo cambia el dato oficial cuando CTP confirma su aplicación.</p>
    <label className="op-check"><input type="checkbox" checked={showAll} onChange={event=>{setShowAll(event.target.checked);setLimit(30);}}/> Incluir aplicadas y descartadas</label><p className="muted">{visible.length} decisiones en esta vista.</p>
    {error&&<p className="op-error" role="alert">{error}</p>}
    {!visible.length&&<p>No hay decisiones pendientes.</p>}
    {visible.slice(0,limit).map(command=>{
      const type=command.action||command.type;
      const pending=!['acknowledged','cancelled'].includes(command.status);
      const canCancel=(me.is_admin||command.actor_id===me.id)&&((command.status==='pending'&&command.attempts===0)||(command.status==='rejected'&&command.attempts===1&&command.result?.rejected_confirmed));
      const payload=command.payload||{};
      return <article key={command.id} className="op-decision"><div className="op-section-title"><strong>{actionLabel(type)}</strong><Badge value={command.status}>{command.status==='cancelled'?'Descartada':undefined}</Badge></div>
        <p>{payload.reason||payload.resolution||payload.name||'Cambio de competición preparado.'}</p>
        <div className="op-case-meta"><span>Autor: {data.staff?.find(s=>s.id===command.actor_id)?.name||`Staff #${command.actor_id||'—'}`}</span><span>{dateTime(command.created_at)}</span><span>Versión oficial {command.expected_version??'—'}</span></div>
        {(payload.decision||payload.status||payload.phase)&&<p className="muted">Decisión: {label(payload.decision||payload.status||payload.phase)}</p>}
        {payload.players&&<p className="muted">{payload.players.length} fila(s) con cifras propuestas para una nueva revisión.</p>}{command.result?.revision_id&&<p className="op-notice">CTP ha creado una nueva revisión. Las cifras de la revisión original se conservan en el historial.</p>}
        {command.last_error&&<p className="op-error">{command.last_error}</p>}
        {pending&&<div className="op-actions">{me.is_admin?<button className="btn primary" disabled={Boolean(busy)||!canSendCommand(command,connection.write_enabled,supported(type))} onClick={()=>act(command,'send')}>{busy===command.id?'Procesando…':'Enviar decisión a CTP'}</button>:<span className="muted">Un administrador autorizado debe enviar esta propuesta.</span>}{canCancel&&<button className="btn" disabled={Boolean(busy)} onClick={()=>act(command,'cancel')}>Descartar propuesta</button>}</div>}
        {pending&&(!connection.write_enabled||!supported(type))&&<p className="op-notice">{!connection.write_enabled?'El envío oficial está desactivado en esta instalación.':'CTP todavía no anuncia esta acción.'}</p>}
        <details className="op-details"><summary>Detalle de la propuesta · {command.id.slice(0,8)}</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(payload,null,2)}</pre><small>{command.attempts} intento(s). Se conserva el mismo identificador en los reintentos.</small></details>
      </article>;
    })}{visible.length>limit&&<button className="btn" onClick={()=>setLimit(value=>value+30)}>Mostrar más decisiones</button>}{resourceId&&data.pages?.commands?.has_more&&<Link className="btn" to={`/operaciones/decisiones?${new URLSearchParams({resource_type:resourceType,resource_id:resourceId,include_closed:'1'})}`}>Consultar todas las decisiones de este registro</Link>}
  </section>;
}
