import { OfficialIncidentStatus } from './CaseControls.jsx';
import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowLeft, FileCheck2, Info, LockKeyhole, Plus } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Modal } from '../components/ui.jsx';
import { AuditList, Badge, Field, FormDialog, MatchLink, SelectMatch } from './ui.jsx';
import { dateTime, label } from './model.js';
import { IncidentInbox } from './IncidentInbox.jsx';
import { elapsedLabel, incidentNextAction } from './staffModel.js';
import { DecisionPanel } from './DecisionPanel.jsx';
import { TicketChat } from './TicketChat.jsx';
import { canManageRanked } from '../../../shared/access.js';
import { rankedIncidentPath } from '../navigation.js';
import { selectedCaseContext } from './caseSelection.js';

export function IncidentsPanel({ data, mutate, me, reload }) {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const selected = params.get('case');
  const [dialog, setDialog] = useState(null);
  const [dialogCase, setDialogCase] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  const incidents = data.incidents || [];
  const { incident, notes, audit } = selectedCaseContext(detail, incidents, selected);
  const openDialog = (type) => { setDialogCase(incident); setDialog(type); };
  const editing = dialogCase || incident;
  useEffect(() => {
    let active = true; setDetail(null); setError('');
    if (selected) api.get(`/operations/incidents/${encodeURIComponent(selected)}`).then((d) => { if (active) setDetail(d); }).catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [selected, data]);
  const choose = (id) => { const next = new URLSearchParams(params); id ? next.set('case', id) : next.delete('case'); setParams(next); };
  const update = (body, base = incident) => mutate('patch', `/incidents/${encodeURIComponent(base.id)}`, { expected_version: base.version, ...body });
  const closed = ['resolved', 'closed', 'closed_internal', 'rejected', 'resolution_pending'].includes(incident?.status);
  const rankedPath = canManageRanked(me) ? rankedIncidentPath(incident, location.pathname + location.search) : null;
  return <>
    <div className="op-section-title"><div><h2>Incidencias y arbitraje</h2><p>Un expediente por problema, con responsable, contexto y seguimiento.</p></div><button className="btn primary" onClick={() => setDialog('new')} disabled={!data.matches.length}><Plus size={16} /> Abrir expediente</button></div>
    {selected ? <>
      <button className="btn op-back" onClick={() => choose(null)}><ArrowLeft size={15} /> Todas las incidencias</button>
      {error && <p className="op-error" role="alert">{error}</p>}
      {incident && <section className="op-card op-case-focus"><div className="op-section-title"><div><div className="op-eyebrow">EXPEDIENTE · {incident.id.slice(0, 8)}</div><h2>{incident.title}</h2></div><div className="op-actions"><Badge value={incident.status} /><button className="btn ghost icon sm" aria-label="Información del expediente" title="Información del expediente" onClick={() => setInfoOpen(true)}><Info size={17} /></button></div></div>
        <p className="op-text op-case-reason">{incident.reason}</p>
        {rankedPath && <div className="op-case-actions"><Link className="btn primary" to={rankedPath}><FileCheck2 size={15} /> Abrir partida y resolver</Link><span className="muted">Revisa equipos, resultado y chat antes de elegir una decisión.</span></div>}
        <div className="op-case-essentials"><MatchLink id={incident.match_id} match={data.matches.find((m) => m.id === incident.match_id)} />{incident.reporter_name && <span>Creada por <strong>{incident.reporter_name}</strong></span>}<span>{incident.assigned_name || data.staff.find((s) => s.id === incident.assignee_id)?.name || 'Sin asignar'}</span>{incident.awaiting_staff && <strong className="op-urgent">Nuevo mensaje</strong>}{incident.priority === 'urgent' && <strong className="op-urgent">Urgente</strong>}</div>
        <div className="op-case-next"><strong>{incidentNextAction(incident)}</strong><span>Abierto hace {elapsedLabel(incident.created_at)}</span></div>
        {incident.status === 'resolution_pending' && <p className="op-notice">Resolución preparada. Falta la confirmación de CTP para cerrar el expediente oficial.</p>}
        {!closed && <div className="op-case-actions">{incident.assignee_id !== me.id && <ActionButton run={() => update({ status: 'investigating', assignee_id: me.id })}>Asumir caso</ActionButton>}<button className="btn primary" onClick={() => openDialog('resolve')}><FileCheck2 size={15} /> Preparar resolución</button><details className="op-case-more"><summary>Más acciones</summary><div><button className="btn" onClick={() => openDialog('manage')}>Cambiar seguimiento</button><button className="btn" onClick={() => openDialog('note')}><LockKeyhole size={14} /> Añadir nota</button></div></details></div>}
        <DecisionPanel data={data} reload={reload} resourceType="incident" resourceId={incident.id} />
        {incident.source === 'ctp' && incident.kind !== 'ranked' ? <TicketChat incident={incident} reload={reload} /> : <OfficialIncidentStatus incident={incident} data={data} reload={reload} mutate={mutate} />}
        {incident.resolution && <details className="op-case-panel"><summary>Resolución registrada</summary><blockquote className="op-quote">{incident.resolution}</blockquote></details>}
        {incident.source === 'ctp' && incident.kind === 'ranked' && <details className="op-case-panel"><summary>Conversación con jugadores</summary><CaseConversation key={incident.id} incident={incident} configured={data.connection?.configured} /></details>}
        <details className="op-case-panel"><summary>Notas del expediente · {notes.length}</summary>
          {notes.length ? <ol className="op-notes">{notes.map((n) => <li key={n.id}><div className="op-note-heading"><strong>{n.author_name || n.actor_name || 'Staff'}</strong><Badge value={n.visibility === 'internal' ? 'draft' : n.delivery_status || 'pending'}>{n.visibility === 'internal' ? 'Interna' : n.delivery_status === 'delivered' ? 'Enviada a CTP' : 'Respuesta a CTP · pendiente'}</Badge></div><p>{n.text}</p><small>{dateTime(n.created_at)}</small></li>)}</ol> : <p className="muted">Sin notas todavía.</p>}
        </details>
        {audit.length > 0 && <details className="op-case-panel"><summary>Historial del expediente · {audit.length}</summary><AuditList items={audit} /></details>}
      </section>}
      {incident && infoOpen && <Modal title="Información del expediente" onClose={() => setInfoOpen(false)}><div className="op-connection-detail"><p><strong>ID:</strong> {incident.id}</p><p><strong>Estado:</strong> {label(incident.status)}</p><p><strong>Responsable:</strong> {data.staff.find((s) => s.id === incident.assignee_id)?.name || 'Sin asignar'}</p><p><strong>Prioridad:</strong> {incident.priority === 'urgent' ? 'Urgente' : 'Normal'}</p><p><strong>Abierto:</strong> {dateTime(incident.created_at)}</p><p><strong>Origen:</strong> {incident.source === 'ctp' ? 'CTP' : 'Manager'}</p></div></Modal>}
      {!incident && !error && <p className="muted">Cargando expediente…</p>}
    </> : <>
      <IncidentInbox data={data} me={me} params={params} setParams={setParams} choose={choose} />
    </>}
    {dialog === 'new' && <FormDialog title="Abrir expediente interno" onClose={() => setDialog(null)} submit={async (body) => { const next = await mutate('post', '/incidents', body); choose(next.id); }} help="Queda vinculado al partido. Las notas internas no se envían a jugadores."><Field label="Partido"><SelectMatch matches={data.matches} /></Field><Field label="Asunto"><input name="title" required maxLength={160} /></Field><Field label="Qué ha ocurrido"><textarea name="reason" required maxLength={4000} rows={4} /></Field><Field label="Prioridad"><select name="priority"><option value="normal">Normal</option><option value="urgent">Urgente · impide continuar</option></select></Field></FormDialog>}
    {dialog === 'manage' && editing && <FormDialog title="Seguimiento del expediente" onClose={() => setDialog(null)} submit={(body) => update({ ...body, assignee_id: body.assignee_id ? Number(body.assignee_id) : null }, editing)}><Field label="Estado"><select name="status" defaultValue={editing.status}><option value="open">Abierta</option><option value="investigating">En investigación</option><option value="waiting">Esperando respuesta</option></select></Field><Field label="Responsable"><select name="assignee_id" defaultValue={editing.assignee_id || ''}><option value="">Sin asignar</option>{data.staff.filter((s) => s.is_admin || s.sections?.includes('arbitraje')).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field><Field label="Prioridad"><select name="priority" defaultValue={editing.priority}><option value="normal">Normal</option><option value="urgent">Urgente</option></select></Field></FormDialog>}
    {dialog === 'note' && editing && <FormDialog title="Nota de seguimiento" onClose={() => setDialog(null)} submit={(body) => mutate('post', `/incidents/${encodeURIComponent(editing.id)}/notes`, { ...body, expected_version: editing.version })} help="Las notas internas solo las ve arbitraje. Una respuesta enviada a CTP respeta los destinatarios del hilo original: autor y staff en tickets, participantes en ranked."><Field label="Visibilidad"><select name="visibility"><option value="internal">Solo arbitraje · interna</option>{editing.source !== 'manager' && <option value="participants">Preparar respuesta en CTP</option>}</select></Field><Field label="Nota"><textarea name="text" required maxLength={editing.kind === 'ranked' ? 800 : 2000} rows={5} /></Field></FormDialog>}
    {dialog === 'resolve' && editing && <ResolutionDialog incident={editing} match={data.matches.find((m) => m.id === editing.match_id)} mutate={mutate} onClose={() => setDialog(null)} />}
  </>;
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
  return <FormDialog title={local ? 'Cerrar expediente interno' : 'Preparar resolución'} submitLabel={local ? 'Cerrar expediente interno' : 'Guardar propuesta de resolución'} onClose={onClose} submit={submit} help={local ? 'Este expediente es interno del Manager. Su cierre no cambia resultados, puntos ni incidencias oficiales de CTP.' : 'CTP comprobará los permisos, la vinculación del árbitro y el estado actual antes de aplicar la decisión.'}>
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

