import { ArrowRight, ArrowUpDown, Clock3, Inbox, MessageCircle, Search, UserRound } from 'lucide-react';
import { Badge } from './ui.jsx';
import { dateTime } from './model.js';
import { CLOSED_INCIDENTS, elapsedLabel, hasIncidentAssignee, incidentNextAction } from './staffModel.js';
import { caseAssigneeLabel, caseReference, caseTitle, inboxCounts, inboxResultLabel, shortCaseReference } from './casePresentation.js';
import { useWorkspaceSearch } from './useWorkspaceSearch.js';
import { workspaceFirstPageParams } from './workspaceQuery.js';
import './incident-inbox.css';

export function IncidentInbox({ data, me, params, setParams, choose }) {
  const state = ['active', 'resolved', 'all'].includes(params.get('state')) ? params.get('state') : 'active';
  const bucket = ['mine', 'unassigned', 'urgent'].includes(params.get('bucket')) ? params.get('bucket') : 'all';
  const order = ['oldest', 'newest', 'priority'].includes(params.get('order')) ? params.get('order') : 'priority';
  const query = params.get('q') || '';
  const [search, setSearch] = useWorkspaceSearch(params, setParams);
  const counts = inboxCounts(data, me.id), shown = data.incidents || [];
  const filters = [
    { id: 'all', title: 'Abiertos', count: counts.all_open },
    { id: 'mine', title: 'Mis tickets', count: counts.mine },
    { id: 'unassigned', title: 'Sin asignar', count: counts.unassigned },
    { id: 'urgent', title: 'Urgentes', count: counts.urgent },
  ];
  const setFilter = (key, value) => {
    const next = workspaceFirstPageParams(params);
    next.delete('case'); value ? next.set(key, value) : next.delete(key); setParams(next);
  };
  const selectBucket = value => {
    const next = workspaceFirstPageParams(params);
    next.delete('case'); next.set('bucket', value); next.set('state', 'active'); setParams(next);
  };
  const filtered = query || bucket !== 'all' || state !== 'active' || order !== 'priority';
  return <section className="case-inbox" aria-label="Bandeja de tickets">
    <div className="case-inbox-shortcuts">
      <nav className="case-inbox-buckets" aria-label="Bandejas de tickets abiertos">{filters.map(filter => <button key={filter.id} type="button"
        className={bucket === filter.id && state === 'active' ? 'is-selected' : ''} aria-pressed={bucket === filter.id && state === 'active'} onClick={() => selectBucket(filter.id)}>
        <span>{filter.title}</span><strong>{filter.count}</strong>
      </button>)}</nav>
      <span className="case-inbox-count-scope">{counts.scope === 'query' ? 'Totales de tickets abiertos' : 'Contadores de esta página'}</span>
    </div>

    <div className="case-inbox-toolbar">
      <label className="case-inbox-search"><Search size={17} aria-hidden="true" />
        <input type="search" aria-label="Buscar ticket" maxLength={120} placeholder="Buscar por jugador, código o responsable" value={search} onChange={event => setSearch(event.target.value)} />
      </label>
      <label className="case-inbox-select"><span>Estado</span><select aria-label="Estado de tickets" value={state} onChange={event => setFilter('state', event.target.value)}>
        <option value="active">Abiertos</option><option value="resolved">Finalizados</option><option value="all">Todos</option>
      </select></label>
      <label className="case-inbox-select"><span><ArrowUpDown size={12} aria-hidden="true" /> Orden</span><select aria-label="Orden de tickets" value={order} onChange={event => setFilter('order', event.target.value)}>
        <option value="priority">Urgencia y antigüedad</option><option value="oldest">Más antiguos</option><option value="newest">Más recientes</option>
      </select></label>
      {filtered && <button type="button" className="case-inbox-clear" onClick={() => setParams({})}>Restablecer</button>}
    </div>

    <div className="case-inbox-results" role="status"><span>{inboxResultLabel(data)}</span><span>{state === 'resolved' ? 'Finalizados' : state === 'all' ? 'Todos los estados' : 'Abiertos'}{bucket !== 'all' ? ` · ${filters.find(filter => filter.id === bucket).title}` : ''}</span></div>

    {shown.length ? <div className="case-inbox-collection">
      <div className="case-inbox-columns" aria-hidden="true"><span>Ticket</span><span>Jugador</span><span>Estado</span><span>Responsable</span><span>Antigüedad</span><span /></div>
      <ol className="case-inbox-list" aria-label="Tickets de esta página">{shown.map(incident => {
        const replyPending = incident.awaiting_staff && !CLOSED_INCIDENTS.includes(incident.status);
        const title = caseTitle(incident), reference = shortCaseReference(incident);
        return <li key={incident.id} className={`case-inbox-row${incident.priority === 'urgent' ? ' is-urgent' : ''}${replyPending ? ' needs-reply' : ''}`}>
          <button type="button" className="case-inbox-open" onClick={() => choose(incident.id)} aria-label={`Abrir ${title}, ${reference}${incident.reporter_name ? `, de ${incident.reporter_name}` : ''}`}>
            <span className="case-inbox-subject"><span className="case-inbox-subject-heading"><strong>{title}</strong>{incident.priority === 'urgent' && <span className="case-inbox-urgent">Urgente</span>}</span>
              <span className="case-inbox-reference" title={caseReference(incident)}>{reference}</span>
              <span className="case-inbox-next">{replyPending && <MessageCircle size={12} aria-hidden="true" />}{incidentNextAction(incident)}</span>
            </span>
            <span className="case-inbox-player"><UserRound size={14} aria-hidden="true" />{incident.reporter_name || 'Sin identificar'}</span>
            <span className="case-inbox-state"><Badge value={incident.status}>{incident.status === 'waiting' ? 'En espera' : undefined}</Badge>{replyPending && <span className="case-inbox-reply">Respuesta pendiente</span>}</span>
            <span className={`case-inbox-owner${hasIncidentAssignee(incident) ? '' : ' is-empty'}`}>{caseAssigneeLabel(incident, data.staff)}</span>
            <span className="case-inbox-age" title={`Creado: ${dateTime(incident.created_at)}`}><Clock3 size={13} aria-hidden="true" />{elapsedLabel(incident.created_at)}</span>
            <ArrowRight className="case-inbox-arrow" size={17} aria-hidden="true" />
          </button>
        </li>;
      })}</ol>
    </div> : <div className="case-inbox-empty"><Inbox size={28} strokeWidth={1.4} aria-hidden="true" /><h3>No hay tickets en esta vista</h3><p>Prueba otra bandeja o restablece los filtros.</p>{filtered && <button className="btn" type="button" onClick={() => setParams({})}>Restablecer filtros</button>}</div>}
  </section>;
}
