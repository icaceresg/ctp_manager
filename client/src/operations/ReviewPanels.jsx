import { OfficialIncidentStatus } from './CaseControls.jsx';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Copy, FileCheck2, Info, LockKeyhole } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Modal } from '../components/ui.jsx';
import { AuditList, Badge, Field, FormDialog, MatchLink } from './ui.jsx';
import { dateTime } from './model.js';
import { IncidentInbox } from './IncidentInbox.jsx';
import { elapsedLabel, incidentNextAction } from './staffModel.js';
import { DecisionPanel } from './DecisionPanel.jsx';
import { TicketChat } from './TicketChat.jsx';
import { canManageRanked } from '../../../shared/access.js';
import { rankedIncidentPath } from '../navigation.js';
import { selectedCaseContext } from './caseSelection.js';
import { caseAssigneeLabel, caseReference, caseTitle, shortCaseReference } from './casePresentation.js';
import './case-workspace.css';

export function IncidentsPanel({ data, mutate, me, reload }) {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const selected = params.get('case');
  const [dialog, setDialog] = useState(null);
  const [dialogCase, setDialogCase] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const copyScope = useRef(selected);
  copyScope.current = selected;
  const incidents = data.incidents || [];
  const { incident, notes, audit } = selectedCaseContext(detail, incidents, selected);
  const openDialog = (type) => { setDialogCase(incident); setDialog(type); };
  const editing = dialogCase || incident;
  useEffect(() => {
    let active = true; setDetail(null); setError('');
    if (selected) api.get(`/operations/incidents/${encodeURIComponent(selected)}`).then((d) => { if (active) setDetail(d); }).catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [selected, data]);
  useEffect(() => { setInfoOpen(false); setCopied(false); setCopyError(''); }, [selected]);
  const choose = (id) => { const next = new URLSearchParams(params); id ? next.set('case', id) : next.delete('case'); setParams(next); };
  const update = (body, base = incident) => mutate('patch', `/incidents/${encodeURIComponent(base.id)}`, { expected_version: base.version, ...body });
  const closed = ['resolved', 'closed', 'closed_internal', 'rejected', 'resolution_pending'].includes(incident?.status);
  const rankedPath = canManageRanked(me) ? rankedIncidentPath(incident, location.pathname + location.search) : null;
  const officialTicket = incident?.source === 'ctp' && incident.kind !== 'ranked';
  const rankedIncident = incident?.source === 'ctp' && incident.kind === 'ranked';
  const reference = incident ? caseReference(incident) : '';
  const copyReference = async () => {
    const owner = selected;
    setCopyError('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error();
      await navigator.clipboard.writeText(reference); if (copyScope.current === owner) setCopied(true);
    } catch { if (copyScope.current === owner) { setCopied(false); setInfoOpen(true); setCopyError('No se ha podido copiar. Puedes seleccionar el código completo aquí.'); } }
  };
  return <div className={`case-workspace ${selected ? 'case-workspace--detail' : ''}`}>
    {!selected && <div className="case-workspace__intro"><h2>Bandeja de tickets</h2><p>Localiza el caso, revisa las pruebas y responde al jugador.</p></div>}
    {selected ? <>
      <div className="case-workspace__navigation"><button className="btn ghost op-back" onClick={() => choose(null)}><ArrowLeft size={15} /> Todos los tickets</button><span>Atención al jugador</span></div>
      {error && <p className="op-error" role="alert">{error}</p>}
      {incident && <section className="case-workspace__case" aria-label="Detalle del ticket">
        <header className="case-workspace__heading">
          <div><div className="case-workspace__reference">{officialTicket ? 'TICKET' : rankedIncident ? 'INCIDENCIA DE RANKED' : 'EXPEDIENTE'}<span aria-hidden="true"> / </span><span title={reference}>{shortCaseReference(incident)}</span></div><h2>{caseTitle(incident)}</h2></div>
          <div className="case-workspace__tools">
            <button className="btn ghost sm" onClick={copyReference}><Copy size={14} />{copied ? 'Código copiado' : 'Copiar código'}</button>
            <button className="btn ghost sm" aria-label="Información del expediente" onClick={() => setInfoOpen(true)}><Info size={15} />Datos</button>
            {!closed && <details className="op-case-more case-workspace__menu"><summary>Otras gestiones</summary><div>
              <button className="btn" onClick={() => openDialog('note')}><LockKeyhole size={14} />Añadir nota interna</button>
              <button className="btn" onClick={() => openDialog('manage')}>{officialTicket ? 'Prioridad interna' : 'Cambiar seguimiento'}</button>
              {officialTicket && <button className="btn case-workspace__proposal" onClick={() => openDialog('resolve')}><span>Preparar resolución<small>Propuesta pendiente de envío a CTP</small></span></button>}
            </div></details>}
          </div>
        </header>
        <span className="case-workspace__copy-result" role="status">{copied ? 'Referencia completa copiada al portapapeles.' : ''}</span>
        {!officialTicket && <>
        <p className="op-text op-case-reason">{incident.reason}</p>
        {rankedPath && <div className="op-case-actions"><Link className="btn primary" to={rankedPath}><FileCheck2 size={15} /> Abrir partida y resolver</Link><span className="muted">Revisa equipos, resultado y chat antes de elegir una decisión.</span></div>}
        <div className="op-case-essentials"><Badge value={incident.status} />{incident.match_id && <MatchLink id={incident.match_id} match={data.matches.find((m) => m.id === incident.match_id)} />}{incident.reporter_name && <span>Creada por <strong>{incident.reporter_name}</strong></span>}<span>{caseAssigneeLabel(incident, data.staff)}</span>{incident.awaiting_staff && <strong className="op-urgent">Respuesta pendiente</strong>}{incident.priority === 'urgent' && <strong className="op-urgent">Urgente</strong>}</div>
        <div className="op-case-next"><strong>{incidentNextAction(incident)}</strong><span>Abierto hace {elapsedLabel(incident.created_at)}</span></div>
        </>}
        {officialTicket && incident.match_id && <div className="case-workspace__match"><span>Partido vinculado</span><MatchLink id={incident.match_id} match={data.matches.find((m) => m.id === incident.match_id)} /></div>}
        {incident.status === 'resolution_pending' && <p className="op-notice">Resolución preparada. Falta la confirmación de CTP para cerrar el expediente oficial.</p>}
        {!closed && !officialTicket && <div className="op-case-actions">{incident.assignee_id !== me.id && <ActionButton run={() => update({ status: 'investigating', assignee_id: me.id })}>Asumir caso</ActionButton>}{!rankedIncident && <button className="btn primary" onClick={() => openDialog('resolve')}><FileCheck2 size={15} /> Preparar resolución</button>}</div>}
        {incident.source === 'ctp' && incident.kind !== 'ranked' ? <TicketChat incident={incident} reload={reload} /> : <OfficialIncidentStatus incident={incident} data={data} reload={reload} mutate={mutate} />}
        <DecisionPanel data={data} reload={reload} resourceType="incident" resourceId={incident.id} />
        {incident.resolution && <details className="op-case-panel"><summary>Resolución registrada</summary><blockquote className="op-quote">{incident.resolution}</blockquote></details>}
        {incident.source === 'ctp' && incident.kind === 'ranked' && <details className="op-case-panel"><summary>Conversación con jugadores</summary><CaseConversation key={incident.id} incident={incident} configured={data.connection?.configured} /></details>}
        <details className="op-case-panel case-workspace__staff-notes"><summary><LockKeyhole size={14} />Seguimiento del equipo de arbitraje · {notes.length} {notes.length === 1 ? 'nota' : 'notas'}</summary>
          {notes.length ? <ol className="op-notes">{notes.map((n) => <li key={n.id}><div className="op-note-heading"><strong>{n.author_name || n.actor_name || 'Staff'}</strong><Badge value={n.visibility === 'internal' ? 'draft' : n.delivery_status || 'pending'}>{n.visibility === 'internal' ? 'Interna' : n.delivery_status === 'delivered' ? 'Enviada a CTP' : 'Respuesta a CTP · pendiente'}</Badge></div><p>{n.text}</p><small>{dateTime(n.created_at)}</small></li>)}</ol> : <p className="muted">Sin notas todavía.</p>}
        </details>
        {audit.length > 0 && <details className="op-case-panel"><summary>Historial del expediente · {audit.length}</summary><AuditList items={audit} /></details>}
      </section>}
      {incident && infoOpen && <Modal title="Datos del ticket" onClose={() => setInfoOpen(false)}><div className="op-connection-detail">
        {copyError && <p role="alert">{copyError}</p>}
        <label className="op-field">Código completo<input readOnly value={reference} onFocus={event => event.target.select()} /></label>
        <button className="btn" onClick={copyReference}><Copy size={14} />{copied ? 'Código copiado' : 'Copiar código'}</button>
        <p><strong>Prioridad interna:</strong> {incident.priority === 'urgent' ? 'Urgente' : 'Normal'}</p><p><strong>Abierto:</strong> {dateTime(incident.created_at)}</p><p><strong>Origen:</strong> {incident.source === 'ctp' ? 'CTP' : 'Manager'}</p>
        <details><summary>Identificador técnico</summary><code>{incident.id}</code></details>
      </div></Modal>}
      {!incident && !error && <p className="muted">Cargando expediente…</p>}
    </> : <>
      <IncidentInbox data={data} me={me} params={params} setParams={setParams} choose={choose} />
    </>}
    {dialog === 'manage' && editing && <FormDialog title={editing.source === 'ctp' && editing.kind !== 'ranked' ? 'Prioridad interna del expediente' : 'Seguimiento del expediente'} onClose={() => setDialog(null)} submit={(body) => update(editing.source === 'ctp' && editing.kind !== 'ranked' ? { priority: body.priority } : { ...body, assignee_id: body.assignee_id ? Number(body.assignee_id) : null }, editing)}>{!(editing.source === 'ctp' && editing.kind !== 'ranked') && <><Field label="Estado"><select name="status" defaultValue={editing.status}><option value="open">Abierta</option><option value="investigating">En investigación</option><option value="waiting">Esperando respuesta</option></select></Field><Field label="Responsable"><select name="assignee_id" defaultValue={editing.assignee_id || ''}><option value="">Sin asignar</option>{data.staff.filter((s) => s.is_admin || s.sections?.includes('arbitraje')).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field></>}<Field label="Prioridad"><select name="priority" defaultValue={editing.priority}><option value="normal">Normal</option><option value="urgent">Urgente</option></select></Field></FormDialog>}
    {dialog === 'note' && editing && <FormDialog title="Nota de seguimiento" onClose={() => setDialog(null)} submit={(body) => mutate('post', `/incidents/${encodeURIComponent(editing.id)}/notes`, { ...body, expected_version: editing.version })} help={editing.source === 'ctp' && editing.kind !== 'ranked' ? 'Estas notas son internas y solo las ve arbitraje. Para responder al jugador, usa el chat del ticket.' : 'Las notas internas solo las ve arbitraje. Una respuesta enviada a CTP respeta los destinatarios del hilo original: autor y staff en tickets, participantes en ranked.'}><Field label="Visibilidad"><select name="visibility"><option value="internal">Solo arbitraje · interna</option>{editing.source !== 'manager' && !(editing.source === 'ctp' && editing.kind !== 'ranked') && <option value="participants">Preparar respuesta en CTP</option>}</select></Field><Field label="Nota"><textarea name="text" required maxLength={editing.kind === 'ranked' ? 800 : 2000} rows={5} /></Field></FormDialog>}
    {dialog === 'resolve' && editing && <ResolutionDialog incident={editing} match={data.matches.find((m) => m.id === editing.match_id)} mutate={mutate} onClose={() => setDialog(null)} />}
  </div>;
}

function CaseConversation({ incident, configured }) {
  const [conversation, setConversation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = async (cursor) => {
    setLoading(true); setError('');
    try {
      const suffix = cursor ? `?cursor=${encodeURIComponent(typeof cursor === 'string' ? cursor : JSON.stringify(cursor))}` : '';
      const page = await api.get(`/operations/incidents/${encodeURIComponent(incident.id)}/context${suffix}`);
      setConversation((old) => ({ ...page, messages: cursor ? [...(old?.messages || []), ...page.messages] : page.messages }));
    } catch (err) { setError(err.message); if ([401, 403].includes(err.status)) setConversation(null); }
    finally { setLoading(false); }
  };
  return <div className="op-conversation"><div className="op-section-title"><h3>Conversación de CTP</h3><button className="btn" onClick={() => load()} disabled={loading || !configured}>{loading ? 'Consultando…' : conversation ? 'Actualizar conversación' : 'Cargar conversación'}</button></div>
    <p className="muted">Consulta bajo permiso del operador. Las notas internas del Manager permanecen separadas del hilo original.</p>
    {error && <p className="op-error" role="alert">{error}</p>}
    {conversation && (conversation.messages.length ? <ol className="op-notes">{conversation.messages.map((m) => <li key={`${m.source}:${m.id}`}><div className="op-note-heading"><strong>{m.author_name || 'Participante'}</strong><span>{dateTime(m.created_at)}</span></div><p>{m.text}</p></li>)}</ol> : <p className="muted">No hay mensajes en este hilo.</p>)}
    {conversation?.next_cursor && <button className="btn" disabled={loading} onClick={() => load(conversation.next_cursor)}>Cargar mensajes anteriores</button>}
  </div>;
}

function ResolutionDialog({ incident, match, mutate, onClose }) {
  const local = incident.source === 'manager';
  const competitive = !local && ['challenge', 'ranked', 'tournament'].includes(incident.kind);
  const ticketProposal = !local && !competitive;
  const [decision, setDecision] = useState(competitive ? 'award' : 'close');
  const submit = (body) => {
    const payload = { decision: body.decision, resolution: body.resolution, expected_version: incident.version };
    if (decision === 'award') {
      if (incident.kind === 'tournament') { payload.maps_a = Number(body.maps_a); payload.maps_b = Number(body.maps_b); }
      if (incident.kind === 'challenge') payload.winner_team_id = body.winner_team_id;
      if (incident.kind === 'ranked') payload.winner_side = body.winner_side;
    }
    return mutate('post', `/incidents/${encodeURIComponent(incident.id)}/resolve`, payload, local ? 'Expediente interno cerrado. El partido no se ha modificado.' : 'Resolución preparada. Pendiente de aplicar en CTP.');
  };
  return <FormDialog title={local ? 'Cerrar expediente interno' : 'Preparar resolución'} submitLabel={local ? 'Cerrar expediente interno' : 'Guardar propuesta de resolución'} onClose={onClose} submit={submit} help={local ? 'Este expediente es interno del Manager. Su cierre no cambia resultados, puntos ni incidencias oficiales de CTP.' : ticketProposal ? 'Esta opción guarda una propuesta de cierre con resolución. El ticket solo cambia cuando un administrador envía la propuesta y CTP confirma su aplicación. Para un cambio directo, utiliza Estado en la conversación.' : 'CTP comprobará los permisos, la vinculación del árbitro y el estado actual antes de aplicar la decisión.'}>
    <Field label="Decisión"><select name="decision" value={decision} onChange={(e) => setDecision(e.target.value)}>{!competitive && <option value="close">Cerrar expediente sin alterar resultado</option>}{competitive && <option value="award">Resolver resultado en disputa</option>}{competitive && incident.kind !== 'tournament' && <option value="cancel">Cancelar encuentro disputado</option>}</select></Field>
    {decision === 'award' && incident.kind === 'tournament' && <div className="op-form-grid"><Field label={`Mapas de ${match?.team_a?.name || 'equipo A'}`}><input name="maps_a" type="number" min={0} max={20} required /></Field><Field label={`Mapas de ${match?.team_b?.name || 'equipo B'}`}><input name="maps_b" type="number" min={0} max={20} required /></Field></div>}
    {decision === 'award' && incident.kind === 'challenge' && <Field label="Equipo ganador"><select name="winner_team_id" required><option value="">Seleccionar equipo</option>{[match?.team_a, match?.team_b].filter((t) => t?.id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>}
    {decision === 'award' && incident.kind === 'ranked' && <Field label="Equipo ganador"><select name="winner_side" required><option value="">Seleccionar equipo</option><option value="a">Equipo A</option><option value="b">Equipo B</option></select></Field>}
    <Field label="Motivo y decisión comunicable"><textarea name="resolution" required minLength={10} maxLength={2000} rows={5} /></Field>
  </FormDialog>;
}

export function ActionButton({ run, children, disabled, className = 'btn' }) {
  const [busy, setBusy] = useState(false);
  const { toast } = useApp();
  return <button className={className} disabled={busy || disabled} onClick={async () => { if (busy) return; setBusy(true); try { await run(); } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); } }}>{busy ? 'Guardando…' : children}</button>;
}

export { StatisticsReviewPanel as StatisticsPanel } from './StatisticsReviewPanel.jsx';

