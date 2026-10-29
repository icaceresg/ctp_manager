import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { playerWorkspacePath } from '../navigation.js';
import { canManageRanked } from '../../../shared/access.js';
import { ticketProofUrl } from '../../../shared/ticket-proof.js';
import { dateTime } from './model.js';
import { createTicketActionState } from './ticketActionState.js';
import { ArrowUpRight, Check, Link2, MessageSquare, RefreshCw, Send, ShieldCheck, UserRound } from 'lucide-react';
import './ticket-chat.css';

const STATUS = { abierto: 'Abierto', en_revision: 'En revisión', esperando_respuesta: 'Esperando respuesta', resuelto: 'Resuelto', rechazado: 'Rechazado', cerrado: 'Cerrado' };
const CLOSED = ['resuelto', 'rechazado', 'cerrado'];

/** Direct CTP ticket chat: messages, assignment and status apply at once and notify the player. */
export function TicketChat({ incident, reload }) {
  const { me } = useApp(), location = useLocation();
  const [thread, setThread] = useState(null), [threadScope, setThreadScope] = useState(null), [text, setText] = useState(''), [error, setError] = useState(''), [readError, setReadError] = useState(''), [busy, setBusy] = useState(false);
  const requestScope = JSON.stringify([me?.id, me?.ctp_user_id, me?.auth_mode, me?.ctp_role, me?.is_admin, incident.id]);
  const lock = useRef(null), scope = useRef(requestScope), reads = useRef(0), actions = useRef(null);
  scope.current = requestScope;
  if (actions.current?.scope !== requestScope) actions.current = createTicketActionState(requestScope);
  const url = `/operations/tickets/${encodeURIComponent(incident.id)}`;
  const load = useCallback(async () => {
    const active = requestScope, read = ++reads.current;
    try { const next = await api.get(url); if (scope.current === active && read === reads.current) { setThread(next); setThreadScope(active); setReadError(''); } }
    catch (problem) { if (scope.current === active && read === reads.current) { setReadError(problem.message); if ([401,403,404].includes(problem.status)) { setThread(null); setThreadScope(null); setText(''); actions.current = createTicketActionState(active); } } }
  }, [requestScope, url]);
  useEffect(() => {
    scope.current = requestScope;
    setThread(null); setThreadScope(null); setText(''); setError(''); setReadError(''); setBusy(false); lock.current = null; void load();
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
      ++reads.current; setThread(next); setThreadScope(active); setReadError('');
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
  if (!thread || threadScope !== requestScope || thread.ticket.id !== incident.id) return <section className="ticket-thread-loading"><h3>Chat con el jugador</h3>{readError || error ? <><p className="op-error" role="alert">{readError || error}</p><button className="btn sm" type="button" onClick={load}><RefreshCw size={14} aria-hidden="true" /> Reintentar lectura</button></> : <p className="muted" role="status">Cargando conversación…</p>}</section>;
  return <TicketThreadView thread={thread} me={me} returnTo={location.pathname + location.search} busy={busy} error={error} readError={readError} text={text} onReload={load} onAction={act} onSend={send} onTextChange={setText}/>;
}

const URL_TOKEN = /https?:\/\/[^\s<>"']+/giu;
const messageTime = (value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }).format(parsed) : 'Hora no disponible';
};
const messageDay = (value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'long', year: 'numeric' }).format(parsed) : 'Fecha no disponible';
};
const initial = (name) => (Array.from(String(name || '').trim())[0] || '?').toLocaleUpperCase('es');
const hostLabel = (url) => new URL(url).hostname.replace(/^www\./i, '');
export function ticketLinkPath(url) {
  const parsed = new URL(url), path = parsed.pathname + parsed.search + parsed.hash;
  return path.length > 88 ? path.slice(0, 62) + '…' + path.slice(-20) : path;
}

/** Split plain text into safe, explicit links; never interpret HTML or load media. */
export function ticketMessageParts(body) {
  const text = typeof body === 'string' ? body : '';
  const result = []; let end = 0;
  for (const match of text.matchAll(URL_TOKEN)) {
    const url = ticketProofUrl(match[0]);
    if (!url) continue;
    if (match.index > end) result.push({ text: text.slice(end, match.index) });
    result.push({ text: match[0], url }); end = match.index + match[0].length;
  }
  if (end < text.length || !result.length) result.push({ text: text.slice(end) });
  return result;
}

/** References remain user-submitted evidence, never an inferred match relation. */
export function ticketReferences(thread) {
  const entries = new Map(); let truncated = false;
  const add = (raw, source, createdAt) => {
    const url = ticketProofUrl(raw);
    if (!url || entries.has(url)) return;
    if (entries.size >= 50) { truncated = true; return; }
    entries.set(url, { url, source, createdAt });
  };
  add(thread.ticket.proof_url, 'Prueba del ticket', null);
  for (const part of ticketMessageParts(thread.ticket.description)) if (part.url) add(part.url, 'Descripción original', null);
  for (const message of thread.messages) for (const part of ticketMessageParts(message.body)) if (part.url) add(part.url, message.author_name ? `Mensaje de ${message.author_name}` : 'Mensaje de un participante', message.created_at);
  return { entries: [...entries.values()], truncated };
}

/** Only nearby messages from the same known author can share a visual group. */
export function consecutiveTicketMessages(previous, current) {
  if (!previous || !current || previous.is_staff !== current.is_staff) return false;
  const sameAuthor = Boolean(previous.author_id && current.author_id && previous.author_id === current.author_id);
  const gap = Date.parse(current.created_at) - Date.parse(previous.created_at);
  return Boolean(sameAuthor && Number.isFinite(gap) && gap >= 0 && gap <= 5 * 60_000 && messageDay(previous.created_at) === messageDay(current.created_at));
}

function TicketMessageBody({ body }) {
  return <p className="ticket-message-body">{ticketMessageParts(body).map((part, index) => part.url
    ? <a key={index} className="ticket-message-link" href={part.url} target="_blank" rel="noopener noreferrer nofollow ugc" title={part.url} aria-label={`Abrir enlace compartido: ${part.url}`}><Link2 size={13} aria-hidden="true" /><span className="ticket-message-link-label"><strong>{hostLabel(part.url)}</strong><small className="ticket-link-path">{ticketLinkPath(part.url)}</small></span><ArrowUpRight size={12} aria-hidden="true" /></a>
    : <span key={index}>{part.text}</span>)}</p>;
}

/** Typed thread presentation; no requests or remote content are loaded here. */
export function TicketThreadView({thread,me,returnTo,busy,error,readError = '',text,onReload,onAction,onSend,onTextChange}) {
  const { ticket, messages, events } = thread;
  const [pendingStatus, setPendingStatus] = useState(ticket.status);
  useEffect(() => { setPendingStatus(ticket.status); }, [ticket.id, ticket.status]);
  const profilePath = canManageRanked(me) ? playerWorkspacePath(ticket.author.id, returnTo) : null;
  const timeline = [...messages.map((m) => ({ at: m.created_at, m })), ...events.map((e) => ({ at: e.created_at, e }))].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const latestMessage = timeline.filter((item) => item.m).at(-1)?.m;
  const references = ticketReferences(thread);
  const closed = CLOSED.includes(ticket.status);
  const mine = Boolean(thread.viewer_id && ticket.assigned?.id === thread.viewer_id);
  const createdAt = typeof ticket.created_at === 'string' && Number.isFinite(Date.parse(ticket.created_at)) ? ticket.created_at : null;
  return <div className="ticket-workspace">
    <section className="ticket-conversation" aria-labelledby="ticket-chat-heading">
      <header className="ticket-conversation-heading"><div><span className="ticket-section-kicker"><MessageSquare size={13} aria-hidden="true" /> Conversación</span><h3 id="ticket-chat-heading">Chat con el jugador</h3><p>Compartido con {ticket.author.username}.</p></div><button className="btn sm ticket-refresh" type="button" disabled={busy} onClick={onReload}><RefreshCw size={14} aria-hidden="true" /><span>Actualizar</span></button></header>
      <div className="ticket-conversation-meta"><span>{messages.length} {messages.length === 1 ? 'mensaje' : 'mensajes'}</span><span>{latestMessage ? latestMessage.is_staff ? 'Última respuesta del staff' : 'Último mensaje del jugador' : 'Sin mensajes todavía'}</span></div>
      <details className="ticket-original-request" open><summary><span>Solicitud inicial</span>{createdAt && <time dateTime={createdAt}>{dateTime(createdAt)}</time>}</summary><div className="ticket-original-body" tabIndex={0} role="region" aria-label="Descripción original del ticket">{ticket.description ? <TicketMessageBody body={ticket.description} /> : <p className="ticket-original-empty">No se añadió una descripción.</p>}</div></details>
      <ol className="ticket-message-list" aria-label="Mensajes y cambios del ticket">
        {timeline.map((item, index) => {
          const previous = timeline[index - 1];
          const beginsDay = !previous || messageDay(previous.at) !== messageDay(item.at);
          const grouped = !beginsDay && item.m && consecutiveTicketMessages(previous?.m, item.m);
          return <li key={`${item.e ? 'event' : 'message'}:${item.e?.id || item.m.id}`} className={item.e ? 'ticket-timeline-item is-event' : `ticket-timeline-item${item.m.is_staff ? ' is-staff' : ' is-player'}${grouped ? ' is-grouped' : ''}`}>
            {beginsDay && <div className="ticket-day-separator"><span>{messageDay(item.at)}</span></div>}
            {item.e ? <div className="ticket-event"><span className="ticket-event-dot" aria-hidden="true" /><span>{item.e.kind === 'assigned' ? `Asignado a ${item.e.value}.` : `Estado cambiado a «${STATUS[item.e.value] || 'Estado no disponible'}».`}</span><time dateTime={item.e.created_at} title={dateTime(item.e.created_at)}>{messageTime(item.e.created_at)}</time></div>
              : <article className="ticket-message"><div className={`ticket-message-avatar${grouped ? ' is-muted' : ''}`} aria-hidden="true">{item.m.is_staff ? <ShieldCheck size={14} /> : initial(item.m.author_name)}</div><div className="ticket-message-content"><div className="ticket-message-heading"><strong className={grouped ? 'ticket-sr-only' : ''}>{item.m.author_name || 'Participante'}{item.m.is_staff && <span className="ticket-author-role">Staff</span>}</strong><time dateTime={item.m.created_at} title={dateTime(item.m.created_at)}>{messageTime(item.m.created_at)}</time></div><TicketMessageBody body={item.m.body} /></div></article>}
          </li>;
        })}
        {!timeline.length && <li className="ticket-chat-empty"><MessageSquare size={24} aria-hidden="true" /><strong>Inicia la conversación</strong><p>Las respuestas con el jugador aparecerán aquí.</p></li>}
      </ol>
      {readError && <div className="ticket-read-error" role="alert"><div><strong>No se ha podido actualizar la conversación</strong><p>{readError}</p><small>Se conserva la última consulta disponible.</small></div><button className="btn sm" type="button" disabled={busy} onClick={onReload}><RefreshCw size={13} aria-hidden="true" /> Reintentar lectura</button></div>}
      {error && <div className="ticket-action-error" role="alert"><strong>No se ha confirmado la acción</strong><p>{error}</p><small>Repite la misma acción para comprobarla sin duplicarla.</small></div>}
      {closed ? <div className="ticket-composer-closed"><Check size={17} aria-hidden="true" /><p>{thread.can_change_status ? 'Este ticket está cerrado. Reábrelo desde Estado para responder.' : 'Este ticket está cerrado. Puedes consultar la conversación.'}</p></div>
        : <form className="ticket-composer" onSubmit={onSend}><label className="ticket-composer-label" htmlFor="ticket-player-reply">Responder al jugador</label><textarea id="ticket-player-reply" value={text} onChange={(event) => onTextChange(event.target.value)} placeholder={`Escribe tu respuesta para ${ticket.author.username}…`} maxLength={5000} rows={3} required disabled={busy} /><div className="ticket-composer-actions"><span>Visible para el jugador <span aria-hidden="true">·</span> {text.length}/5000</span><button className="btn primary" type="submit" disabled={busy || !text.trim()}><Send size={14} aria-hidden="true" />{busy ? 'Guardando…' : 'Enviar respuesta'}</button></div></form>}
    </section>
    <aside className="ticket-context" aria-label="Gestión y contexto del ticket">
      <section className="ticket-context-card ticket-management"><div className="ticket-context-title"><h3>Gestionar ticket</h3><span className={`ticket-status ticket-status-${ticket.status}`}>{STATUS[ticket.status] || 'Estado no disponible'}</span></div><div className="ticket-assignee"><span className="ticket-person-avatar" aria-hidden="true"><ShieldCheck size={16} /></span><div><span className="ticket-detail-label">Responsable</span><strong>{ticket.assigned?.username || 'Sin asignar'}</strong>{mine && <small>Asignado a ti</small>}</div></div>{(!thread.viewer_id || ticket.assigned?.id !== thread.viewer_id) && <button className="btn ticket-assign-button" type="button" disabled={busy} onClick={() => onAction('assign')}>Hacerme cargo</button>}
        {thread.can_change_status ? <div className="ticket-status-control"><label className="op-field">Estado<select value={pendingStatus} disabled={busy} onChange={(event) => setPendingStatus(event.target.value)}>{Object.entries(STATUS).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label><button className="btn" type="button" disabled={busy || pendingStatus === ticket.status} onClick={() => onAction('status', pendingStatus)}>Aplicar estado</button><small>El cambio se aplica al pulsar el botón. Enviar una respuesta no cambia el estado.</small></div> : <p className="ticket-restricted-status">CTP no permite cambiar el estado desde este ticket.</p>}
      </section>
      <section className="ticket-context-card"><div className="ticket-context-title"><h3>Jugador</h3><UserRound size={15} aria-hidden="true" /></div><div className="ticket-author"><span className="ticket-person-avatar" aria-hidden="true">{initial(ticket.author.username)}</span><strong>{ticket.author.username}</strong></div>{profilePath && <Link className="ticket-profile-link" to={profilePath}>Ver ficha de {ticket.author.username}<ArrowUpRight size={13} aria-hidden="true" /></Link>}{(ticket.author.activision_id || ticket.author.gamertag || ticket.author.email) && <details className="ticket-contact-details"><summary>Datos del jugador</summary><dl>{ticket.author.activision_id && <div><dt>Activision ID</dt><dd>{ticket.author.activision_id}</dd></div>}{ticket.author.gamertag && <div><dt>Gamertag</dt><dd>{ticket.author.gamertag}</dd></div>}{ticket.author.email && <div><dt>Correo</dt><dd>{ticket.author.email}</dd></div>}</dl></details>}</section>
      <section className="ticket-context-card ticket-references"><div className="ticket-context-title"><h3>Enlaces compartidos</h3><span className="ticket-reference-count">{references.entries.length}{references.truncated ? '+' : ''}</span></div><p>Referencias del ticket y sus mensajes. Se abren fuera del Manager.</p>{references.entries.length ? <ol>{references.entries.map((reference, index) => <li key={reference.url}><a href={reference.url} target="_blank" rel="noopener noreferrer nofollow ugc" title={reference.url} aria-label={`Enlace ${index + 1}. ${reference.source === 'Prueba del ticket' ? 'Ver prueba adjunta' : 'Abrir enlace compartido'}: ${reference.url}`}><span className="ticket-reference-index" aria-hidden="true">{index + 1}</span><span className="ticket-reference-content"><strong>{hostLabel(reference.url)}</strong><small className="ticket-link-path">{ticketLinkPath(reference.url)}</small><small>{reference.source}</small></span><ArrowUpRight size={13} aria-hidden="true" /></a></li>)}</ol> : <div className="ticket-references-empty"><Link2 size={18} aria-hidden="true" /><span>No se han compartido enlaces.</span></div>}{references.truncated && <small>El resto de enlaces sigue disponible en la conversación.</small>}</section>
    </aside>
  </div>;
}
