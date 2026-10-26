import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { playerWorkspacePath } from '../navigation.js';
import { canManageRanked } from '../../../shared/access.js';
import { ticketProofUrl } from '../../../shared/ticket-proof.js';
import { dateTime } from './model.js';
import { createTicketActionState } from './ticketActionState.js';

const STATUS = { abierto: 'Abierto', en_revision: 'En revisión', esperando_respuesta: 'Esperando respuesta', resuelto: 'Resuelto', rechazado: 'Rechazado', cerrado: 'Cerrado' };
const CLOSED = ['resuelto', 'rechazado', 'cerrado'];

/** Direct CTP ticket chat: messages, assignment and status apply at once and notify the player. */
export function TicketChat({ incident, reload }) {
  const { me } = useApp(), location = useLocation();
  const [thread, setThread] = useState(null), [threadScope, setThreadScope] = useState(null), [text, setText] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const requestScope = JSON.stringify([me?.id, me?.ctp_user_id, me?.auth_mode, me?.ctp_role, me?.is_admin, incident.id]);
  const lock = useRef(null), scope = useRef(requestScope), reads = useRef(0), actions = useRef(null);
  scope.current = requestScope;
  if (actions.current?.scope !== requestScope) actions.current = createTicketActionState(requestScope);
  const url = `/operations/tickets/${encodeURIComponent(incident.id)}`;
  const load = useCallback(async () => {
    const active = requestScope, read = ++reads.current;
    try { const next = await api.get(url); if (scope.current === active && read === reads.current) { setThread(next); setThreadScope(active); setError(''); } }
    catch (problem) { if (scope.current === active && read === reads.current) { setError(problem.message); if ([401,403,404].includes(problem.status)) { setThread(null); setThreadScope(null); setText(''); actions.current = createTicketActionState(active); } } }
  }, [requestScope, url]);
  useEffect(() => {
    scope.current = requestScope;
    setThread(null); setThreadScope(null); setText(''); setError(''); setBusy(false); lock.current = null; void load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible' && !lock.current) void load(); }, 10000);
    return () => { clearInterval(timer); ++reads.current; scope.current = null; };
  }, [load]);
  async function act(action, value) {
    if (lock.current) return false;
    const active = requestScope, pending = actions.current, token = Symbol();
    const input = pending.begin(action, value);
    const viewer = me?.ctp_user_id || thread?.viewer_id;
    lock.current = token; setBusy(true); setError('');
    try {
      const next = await api.post(`${url}/actions`, input);
      if (scope.current !== active) return false;
      pending.confirm(input, next, incident.id, viewer);
      ++reads.current; setThread(next); setThreadScope(active);
      void reload?.();
      return true;
    } catch (problem) {
      if (scope.current === active) {
        setError(problem.message || 'CTP no ha confirmado esta acción. Reintenta para comprobarla sin duplicarla.');
        if ([401,403,404].includes(problem.status)) { setThread(null); setThreadScope(null); setText(''); actions.current = createTicketActionState(active); }
      }
      return false;
    }
    finally { if (lock.current === token) { lock.current = null; setBusy(false); } }
  }
  async function send(event) { event.preventDefault(); if (text.trim() && await act('message', text.trim())) setText(''); }
  if (!thread || threadScope !== requestScope || thread.ticket.id !== incident.id) return <section className="op-case-panel"><h3>Chat con el jugador</h3>{error ? <p className="op-error" role="alert">{error}</p> : <p className="muted">Cargando conversación…</p>}</section>;
  return <TicketThreadView thread={thread} me={me} returnTo={location.pathname + location.search} busy={busy} error={error} text={text} onReload={load} onAction={act} onSend={send} onTextChange={setText}/>;
}

/** Typed thread presentation; no requests or remote content are loaded here. */
export function TicketThreadView({thread,me,returnTo,busy,error,text,onReload,onAction,onSend,onTextChange}) {
  const { ticket, messages, events } = thread;
  const profilePath = canManageRanked(me) ? playerWorkspacePath(ticket.author.id, returnTo) : null;
  const proof = ticketProofUrl(ticket.proof_url);
  const timeline = [...messages.map((m) => ({ at: m.created_at, m })), ...events.map((e) => ({ at: e.created_at, e }))].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const closed = CLOSED.includes(ticket.status);
  return <section className="op-case-panel">
    <div className="op-section-title"><h3>Chat con el jugador</h3><button className="btn sm" disabled={busy} onClick={onReload}>Actualizar</button></div>
    <div className="op-case-essentials">
      <span><strong>Autor:</strong> {ticket.author.username}{ticket.author.activision_id ? ` · ${ticket.author.activision_id}` : ''}{ticket.author.email ? ` · ${ticket.author.email}` : ''}</span>
      {profilePath && <Link className="btn sm" to={profilePath}>Ver ficha de {ticket.author.username}</Link>}
      <span><strong>Responsable:</strong> {ticket.assigned?.username || 'Sin asignar'}</span>
      {(!thread.viewer_id || ticket.assigned?.id !== thread.viewer_id) && <button className="btn sm" disabled={busy} onClick={() => onAction('assign')}>Hacerme cargo</button>}
      {thread.can_change_status && <label className="op-field">Estado<select value={ticket.status} disabled={busy} onChange={(event) => onAction('status', event.target.value)}>{Object.entries(STATUS).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>}
    </div>
    {profilePath && <p className="muted">La ficha corresponde al autor de este ticket y permite volver al caso. Consultarla no responde ni cierra la incidencia.</p>}
    {proof && <p><a className="btn sm" href={proof} target="_blank" rel="noopener noreferrer">Ver prueba adjunta ↗</a></p>}
    {error && <p className="op-error" role="alert">{error} Si no se ha confirmado, reintenta la misma acción para comprobarla sin duplicarla.</p>}
    <ol className="op-notes">{timeline.map((item) => item.e
      ? <li key={item.e.id} className="muted" style={{ textAlign: 'center' }}>{item.e.kind === 'assigned' ? `El caso se ha asignado a ${item.e.value}.` : `La incidencia ha cambiado a «${STATUS[item.e.value] || item.e.value}».`} · {dateTime(item.e.created_at)}</li>
      : <li key={item.m.id}><div className="op-note-heading"><strong>{item.m.author_name || 'Participante'}{item.m.is_staff ? ' · Staff' : ''}</strong><span>{dateTime(item.m.created_at)}</span></div><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.m.body}</p></li>)}
      {!timeline.length && <li className="muted">Todavía no hay mensajes.</li>}</ol>
    {closed ? <p className="muted">La incidencia está cerrada. Cambia su estado para reabrirla y responder.</p>
      : <form onSubmit={onSend}><label className="op-field">Mensaje al jugador<textarea value={text} onChange={(event) => onTextChange(event.target.value)} maxLength={5000} rows={3} required disabled={busy} /></label><button className="btn primary" type="submit" disabled={busy || !text.trim()}>{busy ? 'Enviando…' : 'Enviar'}</button></form>}
  </section>;
}
