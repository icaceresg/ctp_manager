import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Info } from 'lucide-react';
import { Modal } from '../components/ui.jsx';
import { api } from '../api.js';
import { Badge, Empty, Field, FormDialog, MatchLink, StatsTable } from './ui.jsx';
import { dateTime, matchName } from './model.js';
import { DecisionPanel } from './DecisionPanel.jsx';
import { actionLabel } from './actionLabels.js';

const fields=[['kills','Bajas'],['deaths','Muertes'],['assists','Asist.'],['score','Puntos'],['objective','Objetivo']];
export function StatisticsReviewPanel({data,mutate,reload}) {
  const [params,setParams]=useSearchParams();
  const [selected,setSelected]=useState(null);
  const filter = ['pending', 'rejected', 'approved', 'all'].includes(params.get('state')) ? params.get('state') : params.get('match') ? 'all' : 'pending';
  const setFilter = value => setParams(previous => { const next = new URLSearchParams(previous); next.set('state', value); next.delete('review'); return next; }, { replace: true });
  const toggleReview = id => setParams(previous => { const next = new URLSearchParams(previous); next.get('review') === id ? next.delete('review') : next.set('review', id); return next; }, { replace: true });
  const [historyId,setHistoryId]=useState(null);
  const [detail,setDetail]=useState(null);
  const [error,setError]=useState('');
  const [helpOpen,setHelpOpen]=useState(false);
  const matchId=params.get('match')||'';
  const [remoteStats,setRemoteStats]=useState(null);
  const [remoteError,setRemoteError]=useState('');
  const [reading,setReading]=useState(false);
  const [expanded,setExpanded]=useState(null);
  const [expansionError,setExpansionError]=useState('');
  const [expandRetry,setExpandRetry]=useState(0);
  const reviewId=params.get('review');
  const pending=['pending','review','pending_review','submitted'];
  const rows=(matchId?(remoteStats||[]):data.stats).filter(s=>filter==='all'||(filter==='pending'?pending.includes(s.status):s.status===filter));
  const corrections=data.connection?.supported_actions?.includes('stats.correct');
  useEffect(()=>{
    let active=true;setExpanded(null);setExpansionError('');
    if(reviewId&&!remoteStats?.find(row=>row.id===reviewId)?.players)api.get(`/operations/stats/${encodeURIComponent(reviewId)}`).then(value=>{if(active)setExpanded(value.statistic);}).catch(error=>{if(active)setExpansionError(error.message);});
    return()=>{active=false;};
  },[reviewId,data,remoteStats,expandRetry]);
  useEffect(()=>{
    let active=true;
    if(!matchId){setRemoteStats(null);setRemoteError('');return;}
    setReading(true);setRemoteError('');
    api.get(`/operations/competition?resource=statistics&target_id=${encodeURIComponent(matchId)}`).then(result=>{if(active)setRemoteStats(result.items);}).catch(err=>{if(active){setRemoteError(err.message);if([401,403].includes(err.status))setRemoteStats(null);}}).finally(()=>{if(active)setReading(false);});
    return()=>{active=false;};
  },[matchId,data]);
  useEffect(()=>{
    let active=true;setDetail(null);setError('');
    if(historyId)api.get(`/operations/stats/${encodeURIComponent(historyId)}`).then(value=>{if(active)setDetail(value);}).catch(err=>{if(active)setError(err.message);});
    return()=>{active=false;};
  },[historyId,data]);
  return <><div className="op-section-title"><div><h2>Revisión de estadísticas</h2><p>Elige un mapa para comprobar sus ocho jugadores.</p></div><div className="op-filters"><select aria-label="Filtrar estadísticas" value={filter} onChange={e=>setFilter(e.target.value)}><option value="pending">Pendientes</option><option value="rejected">Rechazadas</option><option value="approved">Aprobadas</option><option value="all">Todas las recibidas</option></select><button type="button" className="btn" aria-label="Cómo revisar estadísticas" onClick={() => setHelpOpen(true)}><Info size={16} /></button></div></div>
    {helpOpen && <Modal title="Cómo revisar estadísticas" onClose={() => setHelpOpen(false)}><div className="op-connection-detail"><p>Abre «Ver cifras y revisar» y comprueba los ocho jugadores antes de preparar una aprobación o pedir una corrección.</p><p>Corregir cifras crea otra revisión pendiente y conserva las anteriores. Otro miembro del staff debe aprobar la revisión corregida.</p><p>Una propuesta cambia los datos oficiales cuando CTP confirma su aplicación. Puedes seguir su envío en «Decisiones pendientes».</p></div></Modal>}
    <Field label="Consulta por partido"><select value={matchId} disabled={!data.connection?.configured} onChange={event=>{setRemoteStats(null);setParams(event.target.value?{match:event.target.value}:{});setHistoryId(null);}}><option value="">Bandeja pendiente de la jornada</option>{matchId&&!data.matches.some(match=>match.id===matchId)&&<option value={matchId}>Partido del histórico · {matchId.slice(0,8)}</option>}{data.matches.filter(match=>match.kind==='tournament').map(match=><option key={match.id} value={match.id}>{matchName(match)} · {dateTime(match.scheduled_at)}</option>)}</select></Field>
    {reading&&<p role="status">Consultando revisiones oficiales…</p>}{remoteError&&<p className="op-error" role="alert">{remoteError}{remoteStats?' Se conserva la última consulta; puede estar desactualizada.':''}</p>}
    {!reading&&!rows.length&&<Empty title="Sin estadísticas en esta vista">Las estadísticas recibidas de CTP aparecerán con su estado y procedencia.</Empty>}
    {rows.map(summary=>{const row=summary.id===expanded?.id?expanded:summary;return <section className="op-card" key={row.id}><div className="op-section-title"><div><h3>{row.map_name||'Mapa por identificar'} · {row.mode||'Modo sin indicar'}{row.revision?` · revisión ${row.revision}`:''}</h3>{data.matches.some(m=>m.id===row.match_id)?<MatchLink id={row.match_id} match={data.matches.find(m=>m.id===row.match_id)}/>:<span className="muted">Partido del histórico · {row.match_id.slice(0,8)}</span>}</div><Badge value={row.status}/></div>
      <div className="op-actions"><button type="button" className="btn" aria-expanded={params.get('review') === row.id} aria-controls={`stats-review-${row.id}`} onClick={() => toggleReview(row.id)}>{params.get('review') === row.id ? 'Cerrar cifras' : 'Ver cifras y revisar'}</button><small className="muted">{row.player_count??(row.players || []).length} jugadores · {dateTime(row.created_at)}</small></div>
      {params.get('review') === row.id&&!row.players&&<div role={expansionError?'alert':'status'} className={expansionError?'op-error':'muted'}>{expansionError||'Consultando las cifras de este mapa…'}{expansionError&&<button className="btn" onClick={()=>setExpandRetry(value=>value+1)}>Reintentar cifras</button>}</div>}
      {params.get('review') === row.id&&row.players && <div className="op-review-detail" id={`stats-review-${row.id}`}>
      {row.correction_reason&&<p><strong>Corrección:</strong> {row.correction_reason}</p>}{row.review_note&&<p><strong>Revisión:</strong> {row.review_note}</p>}{row.reviewed_at&&<p className="muted">Revisada: {dateTime(row.reviewed_at)}</p>}{row.correction_revision_id&&<p className="op-notice">CTP ha creado otra revisión a partir de esta. Consulta la nueva versión antes de continuar.</p>}
      <StatsTable players={row.players||[]} objectiveLabel={row.objective_label}/>
      <div className="op-actions">{pending.includes(row.status)&&<><button className="btn primary" disabled={Boolean(row.pending_command_id||row.correction_revision_id)} onClick={()=>setSelected({row,decision:'approve'})}>Preparar aprobación</button><button className="btn" disabled={Boolean(row.pending_command_id||row.correction_revision_id)} onClick={()=>setSelected({row,decision:'reject'})}>Pedir corrección / rechazar</button></>}{[...pending,'rejected','approved'].includes(row.status)&&<button className="btn" disabled={!corrections||Boolean(row.pending_command_id||row.correction_revision_id)} onClick={()=>setSelected({row,decision:'correct'})}>Corregir cifras</button>}<button className="btn" onClick={()=>setHistoryId(historyId===row.id?null:row.id)}>{historyId===row.id?'Cerrar historial':'Historial de revisión'}</button></div>
      {!corrections&&[...pending,'rejected','approved'].includes(row.status)&&<p className="muted">La corrección estará disponible cuando CTP anuncie esta capacidad.</p>}
      {historyId===row.id&&<div className="op-details"><h4>Historial de trabajo en Manager</h4>{error?<p className="op-error">{error}</p>:!detail?<p>Cargando historial…</p>:detail.audit?.length?<ol className="op-timeline">{detail.audit.map(event=><li key={event.id}><strong>{event.actor_name||'CTP'} · {actionLabel(event.action)}</strong><small>{dateTime(event.created_at)}</small>{event.details?.reason&&<p>{event.details.reason}</p>}{event.details?.corrections&&<details><summary>Cifras anteriores y corrección propuesta</summary><StatsTable players={event.details.before||[]}/><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(event.details.corrections,null,2)}</pre></details>}</li>)}</ol>:<p className="muted">Todavía no hay revisiones registradas en Manager para este envío.</p>}</div>}
      <DecisionPanel data={data} resourceType="stat" resourceId={row.id} reload={reload}/>
      </div>}
    </section>;})}
    {selected?.decision==='correct'?<CorrectionDialog row={selected.row} onClose={()=>setSelected(null)} mutate={mutate}/>:selected&&<FormDialog title={selected.decision==='approve'?'Aprobar estadísticas':'Rechazar estadísticas'} onClose={()=>setSelected(null)} submit={body=>mutate('post',`/stats/${encodeURIComponent(selected.row.id)}/review`,{...body,decision:selected.decision,expected_version:selected.row.version,...(Number.isInteger(selected.row.source_version)?{expected_source_version:selected.row.source_version}:{})},'Revisión preparada para CTP.')} submitLabel="Preparar revisión" help="CTP valida la versión y que el revisor no sea el autor del envío."><Field label="Motivo de la revisión"><textarea name="reason" required minLength={12} maxLength={500} rows={4}/></Field></FormDialog>}
  </>;
}
function CorrectionDialog({row,onClose,mutate}) {
  const [players,setPlayers]=useState((row.players||[]).map(p=>({user_id:p.id,name:p.username||p.gamertag||p.id,...Object.fromEntries(fields.map(([field])=>[field,p[field]??'']))})));
  function update(index,field,value){setPlayers(previous=>previous.map((p,i)=>i===index?{...p,[field]:value}:p));}
  return <FormDialog title={`Corregir cifras · ${row.map_name||'Mapa'}`} onClose={onClose} submitLabel="Preparar nueva revisión" help="Las cifras oficiales se conservan hasta la confirmación de CTP. Otro miembro de staff debe aprobar la revisión corregida." submit={body=>{
    let changed=false;
    const changes=players.map((player,index)=>{
      const change={user_id:player.user_id};
      for(const [field]of fields){const value=player[field]===''?null:Number(player[field]);change[field]=value;if(value!==(row.players[index][field]??null))changed=true;}
      return change;
    });
    if(!changed)throw new Error('Modifica al menos una cifra antes de preparar la corrección.');
    if(changes.length!==8)throw new Error('CTP requiere los ocho jugadores inscritos para corregir un mapa.');
    return mutate('post',`/stats/${encodeURIComponent(row.id)}/correct`,{expected_version:row.version,...(Number.isInteger(row.source_version)?{expected_source_version:row.source_version}:{}),reason:body.reason,players:changes},'Corrección preparada. CTP deberá confirmarla y otro revisor aprobarla.');
  }}><div className="op-table-wrap"><table className="op-table"><thead><tr><th>Jugador</th>{fields.map(([key,title])=><th key={key}>{title}</th>)}</tr></thead><tbody>{players.map((p,index)=><tr key={p.user_id}><td>{p.name}</td>{fields.map(([field,title])=><td key={field}><input aria-label={`${title} de ${p.name}`} type="number" min="0" max={field==='score'?1000000:field==='objective'?86400:1000} step="1" value={p[field]} style={{width:84}} onChange={e=>update(index,field,e.target.value)}/></td>)}</tr>)}</tbody></table></div><Field label="Motivo de la corrección"><textarea name="reason" required minLength={12} maxLength={500} rows={3}/></Field></FormDialog>;
}
