import { useEffect, useId, useRef, useState } from 'react';
import { History, RefreshCw, ShieldAlert } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Spinner } from '../components/ui.jsx';
import { dateTime } from './model.js';
import { KIND_LABELS, SCOPE_LABELS, periodLabel, remainingLabel } from './sanctionsModel.js';
import { buildSanctionHistory, createSanctionHistoryReader, historySubjectKey, SANCTION_HISTORY_LIMIT } from './sanctionHistoryModel.js';
import './sanctions.css';

function HistoryRecord({ item }) {
  const label = item.period === 'lifted' ? 'Levantado' : periodLabel(item.period);
  const duration = item.kind === 'ranked_ban' && item.minutes > 0 ? item.minutes * 60_000 : Date.parse(item.ends_at) - Date.parse(item.starts_at);
  const longReason = item.reason.length > 180;
  return <li className={`sx-history-record is-${item.period}`}>
    <div className="sx-history-record-head"><strong>{KIND_LABELS[item.kind]}</strong><span>{label}</span></div>
    <p className="sx-history-record-reason">{longReason ? `${item.reason.slice(0, 180)}…` : item.reason}</p>
    {longReason && <details><summary>Ver motivo completo</summary><p className="sx-history-record-reason">{item.reason}</p></details>}
    <p className="sx-history-record-meta"><time dateTime={item.starts_at}>{dateTime(item.starts_at)}</time> · {duration > 0 ? remainingLabel(duration) : 'Duración no disponible'}
      {item.scopes.length > 0 && <> · {item.scopes.map(scope => SCOPE_LABELS[scope]).join(' · ')}</>}</p>
    <p className="sx-history-record-meta">Hasta <time dateTime={item.ends_at}>{dateTime(item.ends_at)}</time>{item.issued_by_name && <> · {item.issued_by_name}</>}</p>
    {item.period === 'revoked' && <p className="sx-history-record-note">Revocada: no cuenta como medida previa.{item.revoke_reason ? ` ${item.revoke_reason}` : ''}</p>}
    {item.period === 'lifted' && <p className="sx-history-record-note">Levantado antes de tiempo; no está activo.</p>}
    {item.subject_type === 'club' && <p className="sx-history-record-note">Club: {item.subject_name || 'Club vinculado'}. No es una sanción personal.</p>}
  </li>;
}

/** Long histories are counted in full, but mounted only after an explicit click. */
function MoreHistory({ items, title, listLabel, offset = 0, children }) {
  const [open, setOpen] = useState(false), [page, setPage] = useState(0);
  const list = useRef(null), contentId = useId();
  const pageCount = Math.ceil(items.length / 20), current = Math.min(page, pageCount - 1);
  const start = current * 20, shown = items.slice(start, start + 20);
  const move = next => { setPage(next); if (list.current) list.current.scrollTop = 0; };
  return <div className="sx-history-more">
    <button type="button" className="sx-history-toggle" aria-expanded={open} aria-controls={contentId}
      onClick={() => { setOpen(value => !value); setPage(0); }}>{open ? 'Ocultar · ' : ''}{title}</button>
    <div id={contentId} hidden={!open}>{open && <>
      {children}
      <ol ref={list} className="sx-history-compact-list sx-history-scroll" tabIndex={0} aria-label={listLabel}>
        {shown.map(item => <HistoryRecord key={`${item.source}:${item.id}`} item={item} />)}
      </ol>
      {pageCount > 1 && <nav className="sx-history-pagination" aria-label={`Páginas de ${listLabel.toLowerCase()}`}>
        <button type="button" className="btn sm" disabled={current === 0} onClick={() => move(current - 1)}>Anterior</button>
        <span role="status">{offset + start + 1}–{offset + start + shown.length} de {offset + items.length}</span>
        <button type="button" className="btn sm" disabled={current + 1 >= pageCount} onClick={() => move(current + 1)}>Siguiente</button>
      </nav>}
    </>}</div>
  </div>;
}

/** Shared presenter for real modal usage and clearly synthetic DEV fixtures. */
export function SanctionHistoryView({ state, onRetry, now = Date.now() }) {
  const history = state.status === 'ready' ? buildSanctionHistory({ user: state.history.user, clubs: state.history.clubs,
    items: [...state.history.personal, ...state.history.clubItems] }, state.history.user.id, now) : null;
  return <section className="sx-action-history" aria-label="Historial de sanciones del jugador" aria-busy={state.status === 'loading'}>
    <header className="sx-action-history-title"><h3><History size={16} aria-hidden="true" /> Historial del jugador</h3>
      {state.status === 'ready' && <button type="button" className="btn ghost sm" onClick={onRetry} aria-label="Actualizar historial del jugador"><RefreshCw size={14} aria-hidden="true" /></button>}</header>
    {state.status === 'loading' ? <p className="sx-history-feedback" role="status"><Spinner size={16} /> Consultando antecedentes en CTP…</p>
      : state.status === 'error' ? <div className="sx-history-feedback is-error" role="alert"><p>{state.message}</p><button type="button" className="btn sm" onClick={onRetry}>Reintentar historial</button></div>
        : history && <HistoryBody key={history.user.id} history={history} />}
  </section>;
}

function HistoryBody({ history }) {
  const { user, personal, clubItems, counts, total, maybeIncomplete } = history;
  return <>
    <p className="sx-history-identity"><strong>{user.username}</strong>{user.gamertag && <span>{user.gamertag}</span>}{user.platform && <span>{user.platform}</span>}</p>
    <dl className="sx-history-counts">
      <div><dt>Activas</dt><dd>{counts.active}</dd></div>
      <div><dt>Previas</dt><dd>{counts.previous}</dd></div>
      <div><dt>Amonestaciones</dt><dd>{counts.warnings}</dd></div>
    </dl>
    <p className="sx-history-caption">Recuento de medidas personales consultadas; amonestaciones aparte. Las revocadas no se suman a las previas.</p>
    {(counts.revoked > 0 || counts.scheduled > 0) && <p className="sx-history-caption">{counts.revoked > 0 && `${counts.revoked} ${counts.revoked === 1 ? 'revocada' : 'revocadas'}`}{counts.revoked > 0 && counts.scheduled > 0 && ' · '}{counts.scheduled > 0 && `${counts.scheduled} ${counts.scheduled === 1 ? 'programada' : 'programadas'}`}</p>}
    {maybeIncomplete && <p className="sx-history-coverage" role="status"><ShieldAlert size={15} aria-hidden="true" /> Se muestran hasta {SANCTION_HISTORY_LIMIT} registros recientes. Puede haber antecedentes anteriores; estos recuentos son parciales.</p>}
    {personal.length > 0 ? <>
      <ol className="sx-history-compact-list sx-history-scroll" tabIndex={0} aria-label="Últimos antecedentes personales">{personal.slice(0, 3).map(item => <HistoryRecord key={`${item.source}:${item.id}`} item={item} />)}</ol>
      {personal.length > 3 && <MoreHistory items={personal.slice(3)} title={`Ver otros ${personal.length - 3} registros personales`} listLabel="Más antecedentes personales" offset={3} />}
    </> : <p className="sx-history-caption">No constan medidas personales en esta consulta de CTP.</p>}
    {clubItems.length > 0 && <MoreHistory items={clubItems} title={`Medidas de clubes vinculados (${clubItems.length})`} listLabel="Medidas de clubes vinculados">
      <p className="sx-history-caption">Se muestran como contexto; no se suman a los antecedentes personales.</p>
    </MoreHistory>}
    {total === 0 && <p className="sx-history-caption">Historial consultado para esta cuenta; ninguna sanción nueva se aplica automáticamente.</p>}
  </>;
}

export default function PlayerSanctionHistory({ userId, context, now }) {
  const { me } = useApp();
  const actorScope = JSON.stringify([me?.id, me?.ctp_user_id, me?.auth_mode, me?.ctp_role, me?.is_admin, me?.sections]);
  const [retry, setRetry] = useState(0), [loaded, setLoaded] = useState(null);
  const subjectKey = historySubjectKey({ userId, context });
  const reader = useRef(null);
  if (!reader.current) reader.current = createSanctionHistoryReader();
  useEffect(() => {
    void reader.current.read({ userId, context, fetchHistory: (target, options) => api.get(context
      ? `/operations/ranked/lobbies/${encodeURIComponent(target.lobbyId)}/players/${target.slot}/discipline?${new URLSearchParams({ username: target.username })}`
      : `/operations/discipline/users/${encodeURIComponent(target)}`, options),
      onChange: state => setLoaded({ ...state, actorScope }) });
    return () => reader.current.cancel();
  }, [subjectKey, actorScope, retry]);
  const state = loaded?.subjectKey === subjectKey && loaded?.actorScope === actorScope ? loaded : { status: 'loading', userId };
  return <SanctionHistoryView state={state} now={now} onRetry={() => setRetry(value => value + 1)} />;
}
