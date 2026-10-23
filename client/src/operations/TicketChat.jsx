import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { dateTime } from './model.js';

const STATUS = { abierto: 'Abierto', en_revision: 'En revisión', esperando_respuesta: 'Esperando respuesta', resuelto: 'Resuelto', rechazado: 'Rechazado', cerrado: 'Cerrado' };
const CLOSED = ['resuelto', 'rechazado', 'cerrado'];

/** Direct CTP ticket chat: messages, assignment and status apply at once and notify the player. */
export function TicketChat({ incident, reload }) {
  const [thread, setThread] = useState(null), [text, setText] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const lock = useRef(false), scope = useRef(incident.id); scope.current = incident.id;
  const url = `/operations/tickets/${encodeURIComponent(incident.id)}`;
  const load = useCallback(async () => {
    const active = incident.id;
    try { const next = await api.get(url); if (scope.current === active) { setThread(next); setError(''); } }
    catch (problem) { if (scope.current === active) setError(problem.message); }
  }, [incident.id, url]);
  useEffect(() => {
    setThread(null); setText(''); setError(''); void load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible' && !lock.current) void load(); }, 10000);
    return () => clearInterval(timer);
  }, [load]);
  async function act(action, value) {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError('');
    try {
      const next = await api.post(`${url}/actions`, { action, ...(value === undefined ? {} : { value }), request_id: crypto.randomUUID() });
      if (scope.current === incident.id) setThread(next);
      void reload?.();
      return true;
    } catch (problem) { setError(problem.message); return false; }
    finally { lock.current = false; setBusy(false); }
  }
  async function send(event) { event.preventDefault(); if (text.trim() && await act('message', text.trim())) setText(''); }
  if (!thread) return <section className="op-case-panel"><h3>Chat con el jugador</h3>{error ? <p className="op-error" role="alert">{error}</p> : <p className="muted">Cargando conversación…</p>}</section>;
  const { ticket, messages, events } = thread;
  const timeline = [...messages.map((m) => ({ at: m.created_at, m })), ...events.map((e) => ({ at: e.created_at, e }))].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const closed = CLOSED.includes(ticket.status);
  return <section className="op-case-panel">
    <div className="op-section-title"><h3>Chat con el jugador</h3><button className="btn sm" disabled={busy} onClick={() => load()}>Actualizar</button></div>
    <div className="op-case-essentials">
      <span><strong>Autor:</strong> {ticket.author.username}{ticket.author.activision_id ? ` · ${ticket.author.activision_id}` : ''}{ticket.author.email ? ` · ${ticket.author.email}` : ''}</span>
      <span><strong>Responsable:</strong> {ticket.assigned?.username || 'Sin asignar'}</span>
      {(!thread.viewer_id || ticket.assigned?.id !== thread.viewer_id) && <button className="btn sm" disabled={busy} onClick={() => act('assign')}>Hacerme cargo</button>}
      {thread.can_change_status && <label className="op-field">Estado<select value={ticket.status} disabled={busy} onChange={(event) => act('status', event.target.value)}>{Object.entries(STATUS).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>}
    </div>
    {error && <p className="op-error" role="alert">{error}</p>}
    <ol className="op-notes">{timeline.map((item) => item.e
      ? <li key={item.e.id} className="muted" style={{ textAlign: 'center' }}>{item.e.kind === 'assigned' ? `El caso se ha asignado a ${item.e.value}.` : `La incidencia ha cambiado a «${STATUS[item.e.value] || item.e.value}».`} · {dateTime(item.e.created_at)}</li>
      : <li key={item.m.id}><div className="op-note-heading"><strong>{item.m.author_name || 'Participante'}{item.m.is_staff ? ' · Staff' : ''}</strong><span>{dateTime(item.m.created_at)}</span></div><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.m.body}</p></li>)}
      {!timeline.length && <li className="muted">Todavía no hay mensajes.</li>}</ol>
    {closed ? <p className="muted">La incidencia está cerrada. Cambia su estado para reabrirla y responder.</p>
      : <form onSubmit={send}><label className="op-field">Mensaje al jugador<textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={5000} rows={3} required disabled={busy} /></label><button className="btn primary" type="submit" disabled={busy || !text.trim()}>{busy ? 'Enviando…' : 'Enviar'}</button></form>}
  </section>;
}
