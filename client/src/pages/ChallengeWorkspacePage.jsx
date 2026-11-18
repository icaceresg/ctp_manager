import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, LoaderCircle, RefreshCw } from 'lucide-react';
import { CHALLENGE_LIST_STATUSES } from '../../../shared/challenges.js';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { getIntlLocale, translate } from '../i18n/runtime.js';
import { managerUserId } from '../navigation.js';
import { competitionDateTime } from '../operations/competitionTime.js';
import { Badge, DataTable, Field } from '../operations/ui.jsx';
import '../operations/operations.css';

const tabs = [
  { view: undefined, resource: 'matches', path: '/retos' },
  { view: 'tickets', resource: 'tickets', path: '/retos/tickets' },
  { view: 'estadisticas', resource: 'statistics', path: '/retos/estadisticas' },
];
const badgeTone = {
  abierto: 'active', aceptado: 'confirmed', pendiente_resultado: 'pending', en_disputa: 'disputed',
  finalizado: 'finished', cancelado: 'cancelled', en_revision: 'pending', esperando_respuesta: 'waiting',
  resuelto: 'resolved', rechazado: 'rejected', cerrado: 'closed',
};
const label = (name, values) => translate(`manager.challenges.${name}`, values);
const statusLabel = (resource, status) => label(`${resource}.status.${status}`);
const number = value => new Intl.NumberFormat(getIntlLocale()).format(value);
const teamName = team => team?.name || label(team ? 'unknownClub' : 'missingOpponent');

function matchReference(id) {
  return label('matchReference', { id: id.slice(0, 8) });
}

function challengeLink(path, filters) {
  const params = new URLSearchParams(filters);
  return params.size ? `${path}?${params}` : path;
}

function fixture(row) {
  return label('fixture', { home: teamName(row.poster_team), away: teamName(row.accepter_team) });
}

function winningClub(row) {
  if (!row.winner_team_id) return '—';
  const winner = [row.poster_team, row.accepter_team].find(team => team?.id === row.winner_team_id);
  return winner?.name || label('unknownClub');
}

function MatchTicketsLink({ row, className }) {
  const count = number(row.ticket_count);
  return <Link className={className} to={challengeLink('/retos/tickets', { challenge_id: row.id })}
    aria-label={label('matchTicketsLink', { id: row.id.slice(0, 8), count })}>
    {className ? label('ticketsWithCount', { count }) : count} <ArrowRight size={14} aria-hidden="true" />
  </Link>;
}

function MatchDetail({ row }) {
  return <>
    <div className="op-section-title"><div><h2>{fixture(row)}</h2><p>{row.id}</p></div>
      <MatchTicketsLink row={row} className="btn" />
    </div>
    <div className="op-metrics">
      <div className="op-metric"><span>{label('status')}</span><div><Badge value={badgeTone[row.status]}>{statusLabel('matches', row.status)}</Badge></div></div>
      <div className="op-metric"><span>{label('scheduled')}</span><b>{competitionDateTime(row.scheduled_slot)}</b></div>
      <div className="op-metric"><span>{label('season')}</span><b>{number(row.season)}</b></div>
      <div className="op-metric"><span>{label('winner')}</span><b>{winningClub(row)}</b></div>
    </div>
  </>;
}

function MatchTable({ rows }) {
  return <DataTable rows={rows} empty={label('matches.empty')} emptyDetail="" regionLabel={label('matches')}
    columns={[
      { key: 'teams', title: label('clubs'), render: row => <>
        <Link to={challengeLink('/retos', { challenge_id: row.id })}><strong>{fixture(row)}</strong></Link>
        <br /><small title={row.id}>{matchReference(row.id)}</small>
      </> },
      { key: 'scheduled_slot', title: label('scheduled'), render: row => competitionDateTime(row.scheduled_slot) },
      { key: 'season', title: label('season'), render: row => number(row.season) },
      { key: 'status', title: label('status'), render: row => <Badge value={badgeTone[row.status]}>{statusLabel('matches', row.status)}</Badge> },
      { key: 'winner', title: label('winner'), render: winningClub },
      { key: 'tickets', title: label('tickets'), render: row => <MatchTicketsLink row={row} /> },
    ]} />;
}

function TicketTable({ rows }) {
  return <DataTable rows={rows} empty={label('tickets.empty')} emptyDetail="" regionLabel={label('tickets')}
    columns={[
      { key: 'code', title: label('ticket'), render: row => <Link to={challengeLink('/operaciones/incidencias', { case: row.id, state: 'all' })}>
        {row.code} <ArrowRight size={14} aria-hidden="true" />
      </Link> },
      { key: 'challenge_id', title: label('match'), render: row => <Link to={challengeLink('/retos', { challenge_id: row.challenge_id })}>
        {matchReference(row.challenge_id)}
      </Link> },
      { key: 'type', title: label('type'), render: row => label(`tickets.type.${row.type}`) },
      { key: 'status', title: label('status'), render: row => <Badge value={badgeTone[row.status]}>{statusLabel('tickets', row.status)}</Badge> },
      { key: 'priority', title: label('priority'), render: row => <Badge value={row.priority === 'alta' ? 'disputed' : undefined}>{label(`tickets.priority.${row.priority}`)}</Badge> },
      { key: 'author_name', title: label('author'), render: row => row.author_name || '—' },
      { key: 'assigned_name', title: label('assignee'), render: row => row.assigned_name || label('unassigned') },
      { key: 'created_at', title: label('created'), render: row => competitionDateTime(row.created_at) },
    ]} />;
}

function ChallengeStatistics({ data }) {
  const metricKeys = ['total_matches', 'total_tickets', 'active_teams'];
  const statusTables = [
    { resource: 'matches', counts: data.matches_by_status },
    { resource: 'tickets', counts: data.tickets_by_status },
  ];
  return <>
    <div className="op-section-title"><div><h3>{label('periodTitle')}</h3>
      <p>{label('period', { start: competitionDateTime(data.window_started_at), end: competitionDateTime(data.observed_at) })}</p>
    </div></div>
    <div className="op-metrics">
      {metricKeys.map(key => <div className="op-metric" key={key}>
        <span>{label(`metrics.${key}`)}</span><strong>{number(data[key])}</strong>
      </div>)}
    </div>
    <div className="op-two-columns">
      {statusTables.map(({ resource, counts }) => <section key={resource} className="op-card">
        <h2>{label(`${resource}.byStatus`)}</h2>
        <DataTable rows={CHALLENGE_LIST_STATUSES[resource].map(status => ({ id: status, count: counts[status] }))}
          regionLabel={label(`${resource}.byStatus`)} columns={[
            { key: 'status', title: label('status'), render: row => <Badge value={badgeTone[row.id]}>{statusLabel(resource, row.id)}</Badge> },
            { key: 'count', title: label('count'), render: row => number(row.count) },
          ]} />
      </section>)}
    </div>
  </>;
}

function ChallengeData({ tab, query, status, challengeId, cursor, onStatus, onPage }) {
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState({ attempt: -1, data: null, error: null });
  const { resource } = tab;
  const busy = read.attempt !== attempt;
  useEffect(() => {
    const controller = new AbortController();
    const url = `/operations/challenges/${resource}${query ? `?${query}` : ''}`;
    api.get(url, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setRead({ attempt, data, error: null });
    }).catch(error => {
      if (!controller.signal.aborted) setRead({ attempt, data: null, error });
    });
    return () => controller.abort();
  }, [attempt, query, resource]);

  const exactMatch = resource === 'matches' && challengeId;
  const statuses = exactMatch ? null : CHALLENGE_LIST_STATUSES[resource];
  const { data, error } = read;
  return <section className="op-card" aria-busy={busy}>
    <div className="op-section-title">
      <div>
        <h2>{exactMatch ? matchReference(challengeId) : label(resource)}</h2>
        {challengeId && !exactMatch && <p>{matchReference(challengeId)}</p>}
      </div>
      <div className="op-actions">
        {challengeId && <Link className="btn" to={tab.path}>{label(exactMatch ? 'allMatches' : 'clearMatchFilter')}</Link>}
        {statuses && <Field label={label('status')}>
          <select value={status} onChange={event => onStatus(event.target.value)}>
            <option value="">{label('allStatuses')}</option>
            {statuses.map(value => <option key={value} value={value}>{statusLabel(resource, value)}</option>)}
          </select>
        </Field>}
        <button className="btn" type="button" disabled={busy} onClick={() => setAttempt(value => value + 1)}>
          <RefreshCw size={16} aria-hidden="true" /> {label('refresh')}
        </button>
      </div>
    </div>
    {busy ? <div className="op-loading" role="status"><LoaderCircle className="spin" aria-hidden="true" />{label('loading')}</div>
      : error ? <p className="op-error" role="alert">{label(error.status === 403 ? 'forbidden' : 'loadError')}</p>
      : resource === 'statistics' ? <ChallengeStatistics data={data} />
      : <>
        {resource === 'matches' && (exactMatch && data.rows.length ? <MatchDetail row={data.rows[0]} /> : <MatchTable rows={data.rows} />)}
        {resource === 'tickets' && <TicketTable rows={data.rows} />}
        {(cursor || data.next_cursor) && <nav className="op-actions" aria-label={label('pagination')}>
          {cursor && <button type="button" className="btn" onClick={() => onPage('')}>{label('firstPage')}</button>}
          {data.next_cursor && <button type="button" className="btn" onClick={() => onPage(data.next_cursor)}>{label('nextPage')}</button>}
        </nav>}
      </>}
  </section>;
}

export default function ChallengeWorkspacePage() {
  const { view } = useParams();
  const { me } = useApp();
  const [params, setParams] = useSearchParams();
  const tab = tabs.find(item => item.view === view);
  if (!tab) return <Navigate to="/retos" replace />;

  const statuses = CHALLENGE_LIST_STATUSES[tab.resource];
  const challengeId = statuses ? managerUserId(params.get('challenge_id')) : null;
  const exactMatch = tab.resource === 'matches' && challengeId;
  const status = !exactMatch && statuses?.includes(params.get('status')) ? params.get('status') : '';
  const cursor = !exactMatch && statuses ? params.get('cursor') || '' : '';
  const filters = new URLSearchParams();
  if (status) filters.set('status', status);
  if (challengeId) filters.set('challenge_id', challengeId);
  if (cursor) filters.set('cursor', cursor);
  const query = filters.toString();

  function onStatus(value) {
    filters.delete('cursor');
    if (value) filters.set('status', value);
    else filters.delete('status');
    setParams(filters);
  }

  function onPage(value) {
    if (value) filters.set('cursor', value);
    else filters.delete('cursor');
    setParams(filters);
  }

  return <div className="page wide op-page">
    <header className="op-heading"><div><h1>{label('title')}</h1><p>{label('description')}</p></div></header>
    <nav className="op-tabs" aria-label={label('views')}>
      {tabs.map(item => <NavLink key={item.resource} to={item.path} end>{label(item.resource)}</NavLink>)}
    </nav>
    <ChallengeData key={JSON.stringify([me.id, me.ctp_user_id, me.ctp_role, tab.resource, query])}
      tab={tab} query={query} status={status} challengeId={challengeId} cursor={cursor} onStatus={onStatus} onPage={onPage} />
  </div>;
}
