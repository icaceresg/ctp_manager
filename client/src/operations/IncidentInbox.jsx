import { ArrowUpRight, Clock3 } from 'lucide-react';
import { Badge, MatchLink } from './ui.jsx';
import { dateTime } from './model.js';
import { CLOSED_INCIDENTS, elapsedLabel, incidentNextAction, incidentRows } from './staffModel.js';

export function IncidentInbox({ data, me, params, setParams, choose }) {
  const state = ['active', 'resolved', 'all'].includes(params.get('state')) ? params.get('state') : 'active';
  const bucket = ['mine', 'unassigned', 'urgent'].includes(params.get('bucket')) ? params.get('bucket') : 'all';
  const order = ['oldest', 'newest', 'priority'].includes(params.get('order')) ? params.get('order') : 'priority';
  const query = params.get('q') || '';
  const setFilter = (key, value, replace = false) => { const next = new URLSearchParams(params); next.delete('case'); value ? next.set(key, value) : next.delete(key); setParams(next, { replace }); };
  const open = (data.incidents || []).filter((i) => !CLOSED_INCIDENTS.includes(i.status));
  const filters = [{ id: 'all', title: 'Todos los abiertos', count: open.length }, { id: 'mine', title: 'Mis expedientes', count: open.filter((i) => i.assignee_id === me.id).length }, { id: 'unassigned', title: 'Sin asignar', count: open.filter((i) => !i.assignee_id).length }, { id: 'urgent', title: 'Urgentes', count: open.filter((i) => i.priority === 'urgent').length }];
  const shown = incidentRows(data.incidents || [], { state, bucket, query, order, meId: me.id, staff: data.staff, matches: data.matches });
  return <>
    <div className="op-inbox-buckets" aria-label="Bandejas de arbitraje">{filters.map((f) => <button key={f.id} type="button" className={bucket === f.id ? 'is-selected' : ''} aria-pressed={bucket === f.id} onClick={() => { const next = new URLSearchParams(params); next.set('bucket', f.id); next.set('state', 'active'); setParams(next); }}><span>{f.title}</span><strong>{f.count}</strong></button>)}</div>
    <div className="op-inbox-toolbar"><input aria-label="Buscar expediente" placeholder="Buscar equipo, asunto o responsable…" value={query} onChange={(e) => setFilter('q', e.target.value, true)} /><details className="op-filter-details"><summary>Filtrar y ordenar</summary><div><label>Estado<select aria-label="Estado de incidencias" value={state} onChange={(e) => setFilter('state', e.target.value)}><option value="active">Abiertas</option><option value="resolved">Resueltas</option><option value="all">Todas</option></select></label><label>Orden<select aria-label="Orden de incidencias" value={order} onChange={(e) => setFilter('order', e.target.value)}><option value="priority">Urgencia y antigüedad</option><option value="oldest">Más antiguas primero</option><option value="newest">Más recientes primero</option></select></label></div></details><span className="op-count">{shown.length} expedientes</span>{(query || bucket !== 'all' || state !== 'active' || order !== 'priority') && <button className="btn sm" onClick={() => setParams({})}>Limpiar</button>}</div>
    {shown.length ? <ol className="op-case-list">{shown.map((i) => <li key={i.id} className={`op-case-row ${i.priority === 'urgent' ? 'is-urgent' : ''}`}><button type="button" className="op-case-row-primary" onClick={() => choose(i.id)}><span className="op-case-row-title"><strong>{i.title}</strong><ArrowUpRight size={17} /></span><span className="op-case-row-next">{incidentNextAction(i)}</span></button><div className="op-case-row-meta"><Badge value={i.status} />{i.priority === 'urgent' && <span className="op-urgent">Urgente</span>}<span>{data.staff.find((s) => s.id === i.assignee_id)?.name || 'Sin asignar'}</span><span title={dateTime(i.created_at)}><Clock3 size={13} /> {elapsedLabel(i.created_at)}</span><MatchLink id={i.match_id} match={data.matches.find((m) => m.id === i.match_id)} /></div></li>)}</ol> : <div className="op-empty"><h3>Sin expedientes con estos filtros</h3><p>Prueba otra bandeja o limpia los filtros.</p></div>}
  </>;
}
