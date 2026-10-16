import { MatchConversation } from './CaseControls.jsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Badge, DataTable, Empty, Field, FormDialog } from './ui.jsx';
import { dateTime } from './model.js';
import { DecisionPanel } from './DecisionPanel.jsx';

const titleOf=match=>`${match.team_a_name||'Rival pendiente'} · ${match.team_b_name||'Rival pendiente'}`;
const titles={'match.resolve':'Registrar o rectificar resultado','match.revert':'Anular resultado','veto.prepare':'Preparar pick & ban','veto.reset':'Reiniciar pick & ban','veto.start':'Abrir pick & ban','veto.staff_gate':'Proteger apertura del veto'};

export function MatchControlPanel({id,data,reload,mutate}){
  const {me}=useApp();
  const[context,setContext]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[dialog,setDialog]=useState(null);
  const epoch=useRef(0),configured=Boolean(data.connection?.configured);
  const supported=type=>data.connection?.supported_actions?.includes(type);
  const load=useCallback(async()=>{
    if(!id||!configured)return;
    const current=++epoch.current;setBusy(true);setError('');
    try{const next=await api.get(`/operations/competition?resource=match&target_id=${encodeURIComponent(id)}`);if(current===epoch.current)setContext(next);}
    catch(err){if(current===epoch.current){setError(err.message);if([401,403,404].includes(err.status))setContext(null);}}
    finally{if(current===epoch.current)setBusy(false);}
  },[id,configured]);
  useEffect(()=>{setContext(null);load();return()=>{epoch.current++;};},[load]);
  if(!configured)return <Empty title="CTP pendiente de conectar">El acta y el veto se consultan en el backend oficial de PRE.</Empty>;
  if(!supported('match.resolve'))return <Empty title="Control de partidos pendiente de activar">El servidor CTP aún no anuncia los nuevos comandos de arbitraje.</Empty>;
  const match=context?.match;
  const pending=data.commands?.some(command=>command.resource_type==='fixture'&&command.resource_id===id&&!['acknowledged','cancelled'].includes(command.status));
  const blocked=type=>busy||pending||!supported(type);
  return <section className="op-card"><div className="op-section-title"><div><h3>Acta y pick & ban</h3>{match&&<p>{titleOf(match)} · {context.tournament?.name}</p>}</div><button className="btn" disabled={busy} onClick={load}>Actualizar partido</button></div>
    {error&&<p role="alert" className="op-error">{error}{context?' Se conserva la última consulta; actualiza antes de decidir.':''}</p>}{busy&&<p role="status">Consultando el partido…</p>}
    {match&&<><div className="op-case-meta"><Badge value={match.result_status}/><span>BO{match.best_of}</span><span>{dateTime(match.scheduled_at)}</span><span>Versión {match.manager_version}</span></div>
      <p className="op-score">{match.score_a!=null&&match.score_b!=null?`${match.score_a} – ${match.score_b}`:'Sin resultado oficial'}</p>
      <div className="op-actions"><button className="btn primary" disabled={blocked('match.resolve')||!match.entrant_a_id||!match.entrant_b_id} onClick={()=>setDialog('match.resolve')}>{match.result_status==='confirmed'?'Rectificar resultado':'Registrar resultado'}</button>{me.is_admin&&<button className="btn" disabled={blocked('match.revert')||match.result_status!=='confirmed'} onClick={()=>setDialog('match.revert')}>Anular resultado</button>}</div>
      <details className="op-details"><summary>Actas comunicadas por los equipos · {context.reports?.length||0}</summary><DataTable rows={context.reports||[]} empty="Ningún equipo ha comunicado un acta" columns={[{key:'side',title:'Equipo'},{key:'maps_a',title:'Mapas A'},{key:'maps_b',title:'Mapas B'},{key:'note',title:'Nota'},{key:'created_at',title:'Enviado',render:row=>dateTime(row.created_at)}]}/></details>
      <div className="op-section-title"><h4>Pick & ban · {match.pick_ban_status||'none'}</h4><span>{match.pick_ban_staff_gate?'Apertura protegida por staff':'Apertura automática habilitada'}</span></div>
      <div className="op-actions"><button className="btn" disabled={blocked('veto.prepare')||!['none','ready'].includes(match.pick_ban_status)||match.result_status!=='none'} onClick={()=>setDialog('veto.prepare')}>Preparar</button><button className="btn" disabled={blocked('veto.start')||match.pick_ban_status!=='ready'||match.result_status!=='none'} onClick={()=>setDialog('veto.start')}>Abrir ahora</button><button className="btn" disabled={blocked('veto.staff_gate')||!['none','ready'].includes(match.pick_ban_status)} onClick={()=>setDialog('veto.staff_gate')}>{match.pick_ban_staff_gate?'Permitir apertura automática':'Proteger apertura'}</button><button className="btn" disabled={blocked('veto.reset')||match.result_status!=='none'||(!me.is_admin&&['running','done'].includes(match.pick_ban_status))} onClick={()=>setDialog('veto.reset')}>Reiniciar veto</button></div>
      <details className="op-details"><summary>Secuencia y mapas · {context.steps?.length||0} turnos</summary><DataTable rows={context.steps||[]} empty="Veto sin preparar" columns={[{key:'step_index',title:'Turno'},{key:'mode',title:'Modo'},{key:'action',title:'Acción'},{key:'actor_side',title:'Equipo'},{key:'map_name',title:'Selección'},{key:'deadline_at',title:'Plazo',render:row=>dateTime(row.deadline_at)}]}/><p>{context.pool?.length||0} mapas disponibles en el pool congelado de este partido.</p></details>
      <details className="op-details"><summary>Últimos mensajes del partido · {context.messages?.length||0}</summary>{(context.messages||[]).map(message=><article className="op-decision" key={message.id}><strong>{message.system?'Sistema':message.author_name||'Jugador'}</strong><small> · {dateTime(message.created_at)}</small><p style={{whiteSpace:'pre-wrap'}}>{message.body}</p></article>)}</details>
      <DecisionPanel data={data} resourceType="fixture" resourceId={id} reload={reload} onChanged={load}/>
      <MatchConversation kind="tournament" id={id} data={data} reload={reload} mutate={mutate}/>
      {dialog&&<FormDialog title={titles[dialog]} submitLabel="Preparar propuesta" onClose={()=>setDialog(null)} help={dialog==='match.revert'?'Anular también retira los avances que dependan de este resultado y recalcula los puntos. Revisa las rondas posteriores antes de confirmar.':dialog==='veto.reset'?'Se sustituirá la secuencia de veto. Un veto en marcha solo puede reiniciarlo administración antes de comenzar el partido.':'CTP comprobará la versión, los permisos y que el operador sea ajeno a los equipos. La propuesta requiere envío de administración.'} submit={body=>mutate('post','/competition/commands',{type:dialog,target_id:id,expected_version:match.manager_version,payload:{reason:body.reason,...(dialog==='match.resolve'?{maps_a:Number(body.maps_a),maps_b:Number(body.maps_b)}:{}),...(dialog==='veto.staff_gate'?{enabled:!match.pick_ban_staff_gate}:{})}},'Propuesta de arbitraje preparada.')}>
        {dialog==='match.resolve'&&<div className="op-form-grid"><Field label={`Mapas · ${match.team_a_name||'Equipo A'}`}><input name="maps_a" type="number" min="0" max={Math.ceil(match.best_of/2)} defaultValue={match.result_score_a??match.score_a??0} required/></Field><Field label={`Mapas · ${match.team_b_name||'Equipo B'}`}><input name="maps_b" type="number" min="0" max={Math.ceil(match.best_of/2)} defaultValue={match.result_score_b??match.score_b??0} required/></Field><p>El ganador debe alcanzar {Math.ceil(match.best_of/2)} mapas.</p></div>}
        <Field label="Motivo de la decisión"><textarea name="reason" rows={3} minLength={12} maxLength={500} required/></Field>
      </FormDialog>}
    </>}
  </section>;
}

export function RefereeMatchQueue({data,reload,mutate}){
 const[params,setParams]=useSearchParams(),[result,setResult]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[cursor,setCursor]=useState(null),[pages,setPages]=useState([]),[query,setQuery]=useState('');
 const epoch=useRef(0),state=params.get('state')||'',selected=params.get('match')||'';
 const load=useCallback(async()=>{if(!data.connection?.configured)return;const current=++epoch.current;setBusy(true);setError('');try{const search=new URLSearchParams({resource:'referee_queue',query,status:state,limit:'30',...(cursor?{cursor}:{})});const next=await api.get(`/operations/competition?${search}`);if(current===epoch.current)setResult(next);}catch(err){if(current===epoch.current){setError(err.message);if([401,403].includes(err.status))setResult(null);}}finally{if(current===epoch.current)setBusy(false);}},[data.connection?.configured,state,query,cursor]);
 useEffect(()=>{setResult(null);load();return()=>{epoch.current++;};},[load]);
 return <><div className="op-section-title"><div><h2>Arbitraje de partidos</h2><p>Actas pendientes, disputas, resultados y veto sin necesidad de abrir un ticket.</p></div><button className="btn" disabled={busy} onClick={load}>Actualizar</button></div><div className="op-filters"><input aria-label="Buscar partido para arbitrar" placeholder="Torneo o equipo…" value={query} maxLength={120} onChange={event=>{setQuery(event.target.value);setCursor(null);setPages([]);}}/><select aria-label="Estado del acta" value={state} onChange={event=>{const next=new URLSearchParams(params);event.target.value?next.set('state',event.target.value):next.delete('state');setParams(next);setCursor(null);setPages([]);}}><option value="">Pendientes</option><option value="disputed">En disputa</option><option value="pending">Actas comunicadas</option><option value="none">Sin acta</option><option value="confirmed">Confirmados</option><option value="all">Todos</option></select></div>
 {error&&<p role="alert" className="op-error">{error}</p>}{busy&&<p role="status">Consultando partidos…</p>}{result&&<><DataTable rows={result.items||[]} empty="No hay partidos con estos filtros" columns={[{key:'title',title:'Partido',render:row=><button className="op-text-button" onClick={()=>{const next=new URLSearchParams(params);next.set('match',row.id);setParams(next);}}>{titleOf(row)}<small> · {row.tournament_name}</small></button>},{key:'result_status',title:'Acta',render:row=><Badge value={row.result_status}/>},{key:'scheduled_at',title:'Horario',render:row=>dateTime(row.scheduled_at)},{key:'score',title:'Resultado',render:row=>row.score_a==null?'—':`${row.score_a} – ${row.score_b}`} ]}/><div className="op-actions"><button className="btn" disabled={busy||!pages.length} onClick={()=>{setCursor(pages.at(-1));setPages(current=>current.slice(0,-1));}}>Anterior</button><span>Página {pages.length+1}</span><button className="btn" disabled={busy||!result.next_cursor} onClick={()=>{setPages(current=>[...current,cursor]);setCursor(result.next_cursor);}}>Siguiente</button></div></>}
 {selected&&<MatchControlPanel key={selected} id={selected} data={data} reload={reload} mutate={mutate}/>}
 </>;
}
