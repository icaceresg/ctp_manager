import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Badge, DataTable, Empty, Field } from './ui.jsx';
import { dateTime, matchName, safeWebUrl, label } from './model.js';
import { actionLabel } from './actionLabels.js';

export function HistoryPanel({data,can}) {
  const [draft,setDraft]=useState({query:'',kind:'match',status:'',date_from:'',date_to:''});
  const [filters,setFilters]=useState(draft);
  const [cursor,setCursor]=useState(null);
  const [pages,setPages]=useState([]);
  const [result,setResult]=useState(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [nonce,setNonce]=useState(0);
  useEffect(()=>{
    let active=true;
    if(!data.connection?.configured){setResult(null);return;}
    setBusy(true);setError('');
    const query=new URLSearchParams(Object.entries({...filters,cursor,limit:50}).filter(([,value])=>value!==''&&value!=null));
    api.get(`/operations/history?${query}`).then(value=>{if(active)setResult(value);}).catch(err=>{if(active){setError(err.message);if([401,403].includes(err.status))setResult(null);}}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[filters,cursor,nonce,data.connection?.configured]);
  function change(name,value){setDraft(previous=>({...previous,[name]:value}));}
  return <><div className="op-section-title"><div><h2>Histórico oficial</h2><p>Consulta el backend CTP por fechas y recurso, incluidos registros fuera de la jornada actual.</p></div><button className="btn" disabled={busy||!data.connection?.configured} onClick={()=>setNonce(n=>n+1)}>Actualizar consulta</button></div>
    <form className="op-card op-form" onSubmit={event=>{event.preventDefault();if(draft.date_from&&draft.date_to&&draft.date_from>draft.date_to){setError('La fecha inicial no puede superar la final.');return;}setResult(null);setFilters({...draft});setCursor(null);setPages([]);}}><div className="op-form-grid"><Field label="Buscar"><input value={draft.query} maxLength={120} placeholder="Equipo, torneo o expediente" onChange={e=>change('query',e.target.value)}/></Field><Field label="Tipo"><select value={draft.kind} onChange={e=>change('kind',e.target.value)}><option value="match">Partidos</option>{can('arbitraje')&&<><option value="incident">Incidencias</option><option value="stats">Estadísticas</option></>}{can('operaciones')&&<option value="command">Decisiones oficiales</option>}</select></Field><Field label="Desde"><input type="date" value={draft.date_from} onChange={e=>change('date_from',e.target.value)}/></Field><Field label="Hasta"><input type="date" value={draft.date_to} onChange={e=>change('date_to',e.target.value)}/></Field></div><div className="op-actions"><button className="btn primary" disabled={busy||!data.connection?.configured}>Buscar en CTP</button></div></form>
    {!data.connection?.configured?<Empty title="CTP pendiente de conectar">El histórico necesita una conexión oficial y un operador autorizado.</Empty>:<>
      {error&&<p className="op-error" role="alert">{error}{result?' Se conserva la última consulta; puede estar desactualizada.':''}</p>}
      {busy&&<p role="status">Consultando histórico…</p>}
      {result&&<><DataTable rows={result.items||[]} empty="No hay registros con estos filtros" emptyDetail="Amplía las fechas o cambia la búsqueda." columns={[
        {key:'title',title:'Registro',render:item=><div className="op-stack"><strong>{item.kind==='command'?actionLabel(item.title||item.type||item.action):item.title||item.name||item.map_name||(item.team_a&&item.team_b?matchName(item):item.type||item.action||label(filters.kind))}</strong>{item.reason&&<small>{item.reason}</small>}</div>},
        {key:'status',title:'Estado',render:item=><Badge value={item.status||'confirmed'}/>},
        {key:'when',title:'Fecha',render:item=>dateTime(item.occurred_at||item.scheduled_at||item.created_at||item.updated_at)},
        {key:'version',title:'Versión',render:item=>item.manager_version??item.version??'—'},
        {key:'more',title:'Detalle',render:item=><HistoryDetails item={item} origin={data.connection?.web_origin} review={can('arbitraje')}/>},
      ]}/><div className="op-actions"><button className="btn" disabled={busy||!pages.length} onClick={()=>{setCursor(pages[pages.length-1]);setPages(p=>p.slice(0,-1));}}>Anterior</button><span>Página {pages.length+1} · {(result.items||[]).length} registros</span><button className="btn" disabled={busy||!result.next_cursor} onClick={()=>{setPages(p=>[...p,cursor]);setCursor(result.next_cursor);}}>Siguiente</button></div></>}
    </>}
  </>;
}
function HistoryDetails({item,origin,review}) {
  const detail=item.detail||item;
  const href=safeWebUrl(origin,item.web_path);
  return <details className="op-details"><summary>Consultar</summary><dl className="op-settings"><div><dt>Referencia</dt><dd style={{overflowWrap:'anywhere'}}>{item.id||item.target_id}</dd></div>{(detail.type||detail.command_type)&&<div><dt>Acción</dt><dd>{actionLabel(detail.type||detail.command_type)}</dd></div>}{detail.resolution&&<div><dt>Resolución</dt><dd>{detail.resolution}</dd></div>}{detail.review_note&&<div><dt>Revisión</dt><dd>{detail.review_note}</dd></div>}{detail.score_a!=null&&detail.score_b!=null&&<div><dt>Resultado</dt><dd>{detail.score_a} – {detail.score_b}</dd></div>}{detail.actor_name&&<div><dt>Responsable</dt><dd>{detail.actor_name}</dd></div>}</dl><div className="op-actions">{review&&['match','stats'].includes(item.kind)&&<Link className="btn" to={`/operaciones/estadisticas?match=${encodeURIComponent(item.kind==='match'?item.id:detail.match_id)}`}>Revisiones de estadísticas</Link>}{href&&<a className="btn" href={href} target="_blank" rel="noopener noreferrer">Consultar en CTP</a>}</div></details>;
}
