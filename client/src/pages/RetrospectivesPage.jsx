import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Archive, ArrowUpRight, CalendarDays, Check, CircleAlert, CircleCheck, ClipboardList, Download,
  EyeOff, Flag, Lightbulb, ListChecks, MessageSquare, Pencil, Plus, Search, Send, Settings2,
  ShieldCheck, Target, ThumbsUp, UsersRound,
} from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { EmptyState, LoadError, Modal, Spinner } from '../components/ui.jsx';
import {
  RETRO_ACTION_PRIORITIES, RETRO_ACTION_STATUSES, RETRO_AREAS, RETRO_KINDS, RETRO_PHASES, RETRO_SEVERITIES,
} from '../../../shared/retrospectives.js';
import {
  filterRetrospectiveItems, formatRetrospectiveDate, readRetrospectiveEditKey, retrospectiveActionOverdue,
  retrospectiveExportDocument, retrospectiveExportName, retrospectiveItemAuthor, safeRetrospectiveLink,
  storeRetrospectiveEditKey,
} from './retrospectiveModel.js';
import './retrospectives.css';

const TYPE_ICONS = { keep: CircleCheck, improve: CircleAlert, idea: Lightbulb };
const TYPE_HELP = { keep: 'Lo que merece repetirse', improve: 'Lo que debemos resolver', idea: 'Lo que podemos hacer mejor' };
const label = (catalogue, id) => catalogue.find(value => value.id === id)?.label || id || 'Sin definir';
const initialSession = { title: 'Retrospectiva · Torneo Inaugural', eventName: 'Torneo Inaugural CTP', eventDate: '2026-11-08', description: 'Aprendizajes compartidos y mejoras para la próxima competición.' };
const initialItem = { kind: 'improve', area: 'organization', severity: 'medium', title: '', description: '', proposal: '', evidenceUrl: '', anonymous: false };
const initialAction = { title: '', description: '', ownerId: '', dueDate: '', status: 'todo', priority: 'normal', itemId: null };
const baseUrl = id => `/retrospectives/${encodeURIComponent(id)}`;
const itemUrl = (id, itemId) => `${baseUrl(id)}/items/${encodeURIComponent(itemId)}`;
const storage = () => { try { return window.sessionStorage; } catch { return null; } };

function Field({ label: title, hint, children, className = '' }) {
  return <label className={`retro-field ${className}`}><span>{title}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function SelectOptions({ values }) {
  return values.map(value => <option key={value.id} value={value.id}>{value.label}</option>);
}

function AnonymousChoice({ checked, onChange, disabled = false, comment = false }) {
  return <div className={`retro-anonymous-choice ${checked ? 'is-anonymous' : ''}`}>
    <label className="retro-anonymous-toggle"><input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} /><EyeOff size={17} /><span>Publicar {comment ? 'comentario' : 'aportación'} de forma anónima</span></label>
    <p>{checked ? 'Tu nombre no se guarda con este contenido. Revisa que el texto y los enlaces no te identifiquen.' : 'El resto del staff verá tu nombre junto al contenido.'}</p>
  </div>;
}

function SessionForm({ current, busy, onSubmit, onClose }) {
  const id = useId();
  const [form, setForm] = useState(current ? { title: current.title, eventName: current.eventName, eventDate: current.eventDate || '', description: current.description || '' } : initialSession);
  const field = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  return <Modal title={current ? 'Editar retrospectiva' : 'Preparar retrospectiva'} onClose={busy ? undefined : onClose} size="md">
    <form id={id} className="modal-body retro-form" onSubmit={event => { event.preventDefault(); onSubmit(form); }}>
      <p className="retro-form-intro">Un espacio del staff para revisar lo ocurrido y convertir los aprendizajes en decisiones concretas.</p>
      <Field label="Título"><input className="input" required maxLength={160} value={form.title} onChange={event => field('title', event.target.value)} /></Field>
      <div className="retro-form-grid"><Field label="Evento"><input className="input" required maxLength={160} value={form.eventName} onChange={event => field('eventName', event.target.value)} /></Field><Field label="Fecha del evento"><input className="input" type="date" required value={form.eventDate} onChange={event => field('eventDate', event.target.value)} /></Field></div>
      <Field label="Objetivo"><textarea className="input" rows={3} maxLength={3000} value={form.description} onChange={event => field('description', event.target.value)} /></Field>
      <div className="retro-form-actions"><button type="button" className="btn" disabled={busy} onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy}>{busy ? <Spinner /> : <Plus size={16} />}{current ? 'Guardar cambios' : 'Crear retrospectiva'}</button></div>
    </form>
  </Modal>;
}

function ContributionForm({ current, kind, busy, onSubmit, onClose }) {
  const [form, setForm] = useState(current ? { kind: current.kind, area: current.area, severity: current.severity, title: current.title, description: current.description || '', proposal: current.proposal || '', evidenceUrl: current.evidenceUrl || '', anonymous: Boolean(current.anonymous) } : { ...initialItem, kind: kind || initialItem.kind });
  const field = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  return <Modal title={current ? 'Editar aportación' : 'Nueva aportación'} onClose={busy ? undefined : onClose} size="lg">
    <form className="modal-body retro-form" onSubmit={event => { event.preventDefault(); const body = { ...form }; if (current) delete body.anonymous; onSubmit(body); }}>
      <div className="retro-form-grid"><Field label="Tipo"><select className="input" value={form.kind} onChange={event => field('kind', event.target.value)}><SelectOptions values={RETRO_KINDS} /></select></Field><Field label="Área"><select className="input" value={form.area} onChange={event => field('area', event.target.value)}><SelectOptions values={RETRO_AREAS} /></select></Field></div>
      <Field label="Título" hint="Resume una sola observación para que pueda debatirse y resolverse."><input className="input" required maxLength={160} placeholder="¿Qué deberíamos mantener, corregir o proponer?" value={form.title} onChange={event => field('title', event.target.value)} /></Field>
      <Field label="Qué ocurrió y qué impacto tuvo"><textarea className="input" required rows={4} maxLength={6000} placeholder="Explica el contexto, los hechos y su efecto en la competición o el equipo." value={form.description} onChange={event => field('description', event.target.value)} /></Field>
      <Field label="Propuesta de mejora" hint="Opcional. Ayuda a que la conversación termine en una acción."><textarea className="input" rows={3} maxLength={3000} placeholder="¿Qué cambiarías para el próximo torneo?" value={form.proposal} onChange={event => field('proposal', event.target.value)} /></Field>
      <div className="retro-form-grid"><Field label="Impacto"><select className="input" value={form.severity} onChange={event => field('severity', event.target.value)}><SelectOptions values={RETRO_SEVERITIES} /></select></Field><Field label="Referencia o evidencia" hint="Opcional. Enlace a un documento, vídeo o incidencia."><input className="input" type="url" maxLength={1000} placeholder="https://…" value={form.evidenceUrl} onChange={event => field('evidenceUrl', event.target.value)} /></Field></div>
      {current ? <div className="retro-author-notice"><ShieldCheck size={17} /><span>{current.anonymous ? 'Esta aportación permanece anónima.' : 'Esta aportación conserva su autoría.'}</span></div> : <AnonymousChoice checked={form.anonymous} onChange={value => field('anonymous', value)} />}
      <div className="retro-form-actions"><button type="button" className="btn" disabled={busy} onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy}>{busy ? <Spinner /> : <Send size={16} />}{current ? 'Guardar cambios' : 'Publicar aportación'}</button></div>
    </form>
  </Modal>;
}

function ActionForm({ current, sourceItem, people, busy, onSubmit, onClose }) {
  const [form, setForm] = useState(current ? { title: current.title, description: current.description || '', ownerId: current.owner?.id ?? '', dueDate: current.dueDate || '', status: current.status, priority: current.priority, itemId: current.itemId || null } : { ...initialAction, title: sourceItem?.proposal ? sourceItem.proposal.slice(0, 160) : sourceItem?.title || '', itemId: sourceItem?.id || null });
  const field = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  return <Modal title={current ? 'Editar acción' : 'Convertir un aprendizaje en acción'} onClose={busy ? undefined : onClose} size="md">
    <form className="modal-body retro-form" onSubmit={event => { event.preventDefault(); onSubmit({ ...form, ownerId: form.ownerId === '' ? null : Number(form.ownerId), dueDate: form.dueDate || null }); }}>
      {sourceItem && <div className="retro-source-item"><Flag size={15} /><span>{sourceItem.title}</span></div>}
      <Field label="Acción concreta"><input className="input" required maxLength={160} placeholder="¿Qué haremos?" value={form.title} onChange={event => field('title', event.target.value)} /></Field>
      <Field label="Criterio de cierre" hint="Explica qué tendrá que estar resuelto para darla por completada."><textarea className="input" rows={3} maxLength={6000} value={form.description} onChange={event => field('description', event.target.value)} /></Field>
      <div className="retro-form-grid"><Field label="Responsable"><select className="input" value={form.ownerId} onChange={event => field('ownerId', event.target.value)}><option value="">Sin asignar</option>{people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field><Field label="Fecha objetivo"><input className="input" type="date" value={form.dueDate} onChange={event => field('dueDate', event.target.value)} /></Field></div>
      <div className="retro-form-grid"><Field label="Prioridad"><select className="input" value={form.priority} onChange={event => field('priority', event.target.value)}><SelectOptions values={RETRO_ACTION_PRIORITIES} /></select></Field><Field label="Estado"><select className="input" value={form.status} onChange={event => field('status', event.target.value)}><SelectOptions values={RETRO_ACTION_STATUSES} /></select></Field></div>
      <div className="retro-form-actions"><button type="button" className="btn" disabled={busy} onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy}>{busy ? <Spinner /> : <ListChecks size={16} />}{current ? 'Guardar acción' : 'Crear acción'}</button></div>
    </form>
  </Modal>;
}

function ItemCard({ item, onOpen, onVote, votingDisabled }) {
  const Icon = TYPE_ICONS[item.kind] || ClipboardList;
  return <article className={`retro-item ${item.archived ? 'is-archived' : ''}`}>
    <div className="retro-item-meta"><span className="retro-area">{label(RETRO_AREAS, item.area)}</span><span className={`retro-impact severity-${item.severity}`}><i />{label(RETRO_SEVERITIES, item.severity)}</span></div>
    <button type="button" className="retro-item-open" onClick={onOpen}><h3>{item.title}</h3><p>{item.description}</p></button>
    {item.proposal && <div className="retro-item-proposal"><Icon size={14} /><span>{item.proposal}</span></div>}
    {item.archived && <span className="retro-archive-label"><Archive size={12} />Retirada del panel</span>}
    <div className="retro-item-footer"><span className="retro-person">{item.anonymous ? <EyeOff size={13} /> : <span className="retro-avatar">{retrospectiveItemAuthor(item).slice(0, 1)}</span>}{retrospectiveItemAuthor(item)}</span><div className="retro-item-signals"><button type="button" className={`retro-vote ${item.viewerVoted ? 'is-voted' : ''}`} onClick={onVote} disabled={votingDisabled || item.archived} aria-pressed={Boolean(item.viewerVoted)} aria-label={`${item.viewerVoted ? 'Retirar voto de prioridad de' : 'Priorizar'} ${item.title}`}><ThumbsUp size={14} /><b>{item.votes || 0}</b></button><button type="button" className="retro-comment-count" onClick={onOpen} aria-label={`Ver ${item.comments?.length || 0} comentarios de ${item.title}`}><MessageSquare size={14} />{item.comments?.length || 0}</button></div></div>
  </article>;
}

function ItemDetail({ item, canEdit, canArchive, manage, phase, busy, onVote, onEdit, onWithdraw, onAction, onComment, onClose }) {
  const [comment, setComment] = useState('');
  const [anonymous, setAnonymous] = useState(Boolean(item.anonymous));
  const reference = safeRetrospectiveLink(item.evidenceUrl);
  const writable = phase !== 'closed' && !item.archived;
  async function send(event) { event.preventDefault(); if (await onComment({ text: comment, anonymous })) setComment(''); }
  return <Modal title="Aportación del staff" onClose={busy ? undefined : onClose} size="lg retro-drawer">
    <div className="modal-body retro-detail">
      <div className="retro-detail-meta"><span className={`retro-kind kind-${item.kind}`}>{label(RETRO_KINDS, item.kind)}</span><span className="retro-area">{label(RETRO_AREAS, item.area)}</span><span className={`retro-impact severity-${item.severity}`}><i />Impacto {label(RETRO_SEVERITIES, item.severity).toLocaleLowerCase('es')}</span></div>
      <h2 className="retro-detail-title">{item.title}</h2>
      <div className="retro-detail-byline"><span>{item.anonymous ? <EyeOff size={14} /> : <UsersRound size={14} />}{retrospectiveItemAuthor(item)}</span><span>{formatRetrospectiveDate(item.createdAt)}</span></div>
      <section className="retro-detail-section"><h3>Observación e impacto</h3><p>{item.description}</p></section>
      {item.proposal && <section className="retro-detail-section retro-proposal-section"><h3><Lightbulb size={16} />Propuesta</h3><p>{item.proposal}</p></section>}
      {reference && <a className="retro-evidence" href={reference} target="_blank" rel="noopener noreferrer"><ArrowUpRight size={16} />Abrir referencia</a>}
      <div className="retro-detail-actions"><button type="button" className={`btn ${item.viewerVoted ? 'retro-voted-button' : ''}`} disabled={busy || !writable} onClick={onVote}><ThumbsUp size={15} />{item.viewerVoted ? 'Prioridad apoyada' : 'Apoyar prioridad'}<b>{item.votes || 0}</b></button>{manage && !item.archived && <button type="button" className="btn primary" disabled={busy} onClick={onAction}><Plus size={15} />Crear acción</button>}{canEdit && phase === 'collecting' && !item.archived && <button type="button" className="btn ghost" disabled={busy} onClick={onEdit}><Pencil size={14} />Editar</button>}{canArchive && writable && <button type="button" className="btn ghost" disabled={busy} onClick={onWithdraw}><Archive size={14} />Retirar</button>}</div>
      {item.anonymous && <p className="retro-privacy-line"><ShieldCheck size={14} />Esta aportación no guarda el nombre de su autor.</p>}
      <section className="retro-detail-section"><h3><MessageSquare size={16} />Conversación<span className="retro-count">{item.comments?.length || 0}</span></h3>
        <div className="retro-comments">{(item.comments || []).map(entry => <article className="retro-comment" key={entry.id}><div><b>{entry.anonymous ? <EyeOff size={12} /> : null}{retrospectiveItemAuthor(entry)}</b><small>{formatRetrospectiveDate(entry.createdAt)}</small></div><p>{entry.text}</p></article>)}{!item.comments?.length && <p className="retro-inline-empty">Todavía no hay comentarios. Añade contexto o una propuesta para avanzar.</p>}</div>
        {writable ? <form className="retro-comment-form" onSubmit={send}><label className="retro-field"><span>Añadir comentario</span><textarea className="input" rows={3} maxLength={3000} required value={comment} onChange={event => setComment(event.target.value)} placeholder="Aporta contexto o ayuda a concretar la solución." /></label><AnonymousChoice comment checked={anonymous} disabled={busy} onChange={setAnonymous} /><div className="retro-form-actions"><button className="btn primary" disabled={busy || !comment.trim()}>{busy ? <Spinner /> : <Send size={14} />}Enviar comentario</button></div></form> : <div className="retro-readonly"><ShieldCheck size={16} />{item.archived ? 'Esta aportación se ha retirado. Se conserva para la revisión interna.' : 'La retrospectiva está cerrada. Las aportaciones se conservan para consulta.'}</div>}
      </section>
    </div>
  </Modal>;
}

function Conclusions({ session, manage, actions, busy, onSave }) {
  const [draft, setDraft] = useState(session.summary || '');
  const lastSource = useRef(session.summary || '');
  useEffect(() => { const previousSource = lastSource.current; setDraft(previous => previous === previousSource ? session.summary || '' : previous); lastSource.current = session.summary || ''; }, [session.summary]);
  const completed = actions.filter(action => action.status === 'done').length;
  return <div className="retro-conclusions"><section className="retro-summary-card"><div className="retro-section-heading"><div><span className="retro-eyebrow">CIERRE DE LA REVISIÓN</span><h2>Lo que nos llevamos</h2><p>Deja por escrito los acuerdos y el criterio que guiará la próxima competición.</p></div><ClipboardList size={25} /></div>{manage ? <form onSubmit={event => { event.preventDefault(); onSave(draft); }}><label className="retro-field"><span>Conclusiones y acuerdos</span><textarea className="input retro-summary-input" rows={13} maxLength={12000} value={draft} onChange={event => setDraft(event.target.value)} placeholder={'Qué debemos repetir\n\nQué cambiaremos para el próximo torneo\n\nDecisiones y próximos pasos'} /></label><div className="retro-summary-save"><span>{draft === (session.summary || '') ? 'Cambios guardados' : 'Hay cambios sin guardar'}</span><button className="btn primary" disabled={busy || draft === (session.summary || '')}>{busy ? <Spinner /> : <Check size={15} />}Guardar conclusiones</button></div></form> : session.summary ? <div className="retro-summary-text">{session.summary}</div> : <div className="retro-inline-empty">Coordinación publicará aquí las conclusiones de la revisión.</div>}</section><aside className="retro-followup"><div className="retro-followup-icon"><Target size={26} /></div><h3>Una revisión que se convierte en cambios</h3><p>Cada acuerdo puede tener un responsable, una fecha y un criterio de cierre en el plan de acción.</p><div className="retro-progress-label"><strong>{completed} de {actions.length}</strong><span>acciones completadas</span></div><div className="retro-progress"><span style={{ width: `${actions.length ? completed / actions.length * 100 : 0}%` }} /></div><p className="retro-followup-note">Cerrar la recogida de aportaciones no impide dar seguimiento a las acciones.</p></aside></div>;
}

export default function RetrospectivesPage() {
  const { me, toast } = useApp();
  const navigate = useNavigate();
  const { retrospectiveId } = useParams();
  const [index, setIndex] = useState(null), [loadedDetail, setDetail] = useState(null);
  const [indexLoading, setIndexLoading] = useState(true), [loading, setLoading] = useState(false), [indexError, setIndexError] = useState(null), [error, setError] = useState(null);
  const [revision, setRevision] = useState(0), [tab, setTab] = useState('board'), [busy, setBusy] = useState('');
  const [query, setQuery] = useState(''), [area, setArea] = useState(''), [severity, setSeverity] = useState(''), [mine, setMine] = useState(false), [includeArchived, setIncludeArchived] = useState(false);
  const [sessionForm, setSessionForm] = useState(null), [itemForm, setItemForm] = useState(null), [actionForm, setActionForm] = useState(null), [selectedItemId, setSelectedItemId] = useState(null), [withdrawItem, setWithdrawItem] = useState(null), [phaseChange, setPhaseChange] = useState(null);
  const [claims, setClaims] = useState(() => ({ userId: String(me.id), items: {} }));
  const activeId = retrospectiveId || '';
  const detail = String(loadedDetail?.retrospective?.id) === activeId ? loadedDetail : null;
  const sessions = index?.retrospectives || [];
  const session = detail?.retrospective;
  const permissions = detail?.permissions || index?.permissions || {};
  const manage = Boolean(permissions.manage), participate = Boolean(permissions.participate);
  const collecting = session?.phase === 'collecting';

  useEffect(() => { setClaims({ userId: String(me.id), items: {} }); }, [me.id]);
  useEffect(() => {
    const controller = new AbortController(); setIndexLoading(true); setIndexError(null);
    api.get('/retrospectives', { signal: controller.signal }).then(setIndex).catch(failure => { if (failure.name !== 'AbortError') { setIndexError(failure); if ([401, 403].includes(failure.status)) setIndex(null); } }).finally(() => { if (!controller.signal.aborted) setIndexLoading(false); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (!activeId && sessions.length) navigate(`/retrospectivas/${encodeURIComponent(sessions[0].id)}`, { replace: true });
  }, [activeId, sessions, navigate]);
  useEffect(() => {
    if (!activeId) { setDetail(null); return; }
    const controller = new AbortController(); setLoading(true); setError(null);
    setDetail(previous => String(previous?.retrospective?.id) === activeId ? previous : null);
    api.get(baseUrl(activeId), { signal: controller.signal }).then(setDetail).catch(failure => { if (failure.name !== 'AbortError') { setError(failure); if ([401, 403, 404].includes(failure.status)) setDetail(null); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [activeId, revision]);
  useEffect(() => { setSelectedItemId(null); setTab('board'); setQuery(''); setMine(false); }, [activeId]);

  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const editKeyFor = useCallback(item => (claims.userId === String(me.id) ? claims.items[item.id] : null) || readRetrospectiveEditKey(storage(), me.id, activeId, item.id), [claims, me.id, activeId]);
  const mineIds = useMemo(() => (detail?.items || []).filter(item => item.anonymous && editKeyFor(item)).map(item => item.id), [detail?.items, editKeyFor]);
  const items = useMemo(() => filterRetrospectiveItems(detail?.items, { query, area, severity, includeArchived, mine, mineIds }, me.id), [detail?.items, query, area, severity, includeArchived, mine, mineIds, me.id]);
  const selectedItem = detail?.items?.find(item => item.id === selectedItemId);
  const actions = detail?.actions || [];
  const counts = session?.counts || {};

  async function run(key, action, success, message) {
    if (busy) return false;
    setBusy(key);
    try { const value = await action(); await success?.(value); refresh(); if (message) toast(message); return true; }
    catch (failure) { toast(failure.message, 'error'); return false; }
    finally { setBusy(''); }
  }
  function remember(value) {
    if (!value?.editKey || !value?.item?.id) return;
    setClaims(previous => ({ userId: String(me.id), items: { ...(previous.userId === String(me.id) ? previous.items : {}), [value.item.id]: value.editKey } }));
    if (!storeRetrospectiveEditKey(storage(), me.id, activeId, value.item.id, value.editKey)) toast('Aportación guardada. No se ha podido conservar la clave de edición en esta pestaña.', 'error');
  }
  function vote(item) { return run(`vote:${item.id}`, () => api.post(`${itemUrl(activeId, item.id)}/vote`, { voted: !item.viewerVoted })); }
  function saveContribution(body) {
    const current = itemForm?.current;
    const claim = current?.anonymous ? editKeyFor(current) : null;
    return run('item', () => current ? api.patch(itemUrl(activeId, current.id), { ...body, ...(claim ? { editKey: claim } : {}) }) : api.post(`${baseUrl(activeId)}/items`, body), value => { remember(value); setItemForm(null); }, current ? 'Aportación actualizada.' : 'Aportación publicada.');
  }
  function saveSession(body) {
    const current = sessionForm?.current;
    return run('session', () => current ? api.patch(baseUrl(current.id), body) : api.post('/retrospectives', body), value => { setSessionForm(null); const created = value?.retrospective || value; if (!current && created.id) navigate(`/retrospectivas/${encodeURIComponent(created.id)}`); }, current ? 'Retrospectiva actualizada.' : 'Retrospectiva preparada para el staff.');
  }
  function saveAction(body) {
    const current = actionForm?.current;
    const update = { ...body }; delete update.itemId;
    return run('action', () => current ? api.patch(`${baseUrl(activeId)}/actions/${encodeURIComponent(current.id)}`, update) : api.post(`${baseUrl(activeId)}/actions`, body), () => setActionForm(null), current ? 'Acción actualizada.' : 'Acción creada.');
  }
  async function exportReview() {
    return run('export', async () => {
      const current = await api.get(`${baseUrl(activeId)}/export`);
      const document = retrospectiveExportDocument(current?.retrospective ? current : detail);
      const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json;charset=utf-8' }));
      const anchor = window.document.createElement('a'); anchor.href = url; anchor.download = retrospectiveExportName(session.title); anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  return <div className="page retrospective-page">
    <header className="retro-page-heading"><div><div className="retro-eyebrow"><ClipboardList size={14} />MEJORA CONTINUA · STAFF CTP</div><h1>Retrospectivas</h1><p>Aprender del torneo. Acordar lo siguiente. Hacer seguimiento.</p></div><div className="retro-heading-actions"><button type="button" className="btn" disabled={indexLoading || loading || Boolean(busy)} onClick={refresh}>{indexLoading || loading ? <Spinner /> : <Settings2 size={15} />}Actualizar</button>{manage && <button type="button" className="btn primary" disabled={Boolean(busy)} onClick={() => setSessionForm({})}><Plus size={16} />Nueva retrospectiva</button>}</div></header>
    <LoadError error={indexError} onRetry={refresh} busy={indexLoading} hasData={Boolean(index)} />
    {indexLoading && !index ? <div className="retro-loading" role="status"><Spinner size={24} /><p>Cargando retrospectivas del equipo…</p></div> : !sessions.length && !activeId && !indexError ? <div className="retro-welcome"><div className="retro-welcome-icon"><ClipboardList size={36} /></div><span className="retro-eyebrow">DESPUÉS DEL INAUGURAL</span><h2>El siguiente torneo empieza con lo que aprendimos.</h2><p>Reúne lo que funcionó, los fallos y las propuestas del staff. Las prioridades se convierten en acciones con responsable y fecha.</p><div className="retro-welcome-points"><span><UsersRound size={16} />Todo el staff participa</span><span><EyeOff size={16} />Anonimato opcional</span><span><ListChecks size={16} />Seguimiento de mejoras</span></div>{manage ? <button type="button" className="btn primary" onClick={() => setSessionForm({})}><Plus size={16} />Preparar retrospectiva del Inaugural</button> : <p className="retro-welcome-note">Coordinación habilitará aquí la retrospectiva para que puedas participar.</p>}</div> : <>
      <div className="retro-session-picker"><Field label="Retrospectiva"><select className="input" aria-label="Elegir retrospectiva" value={activeId} disabled={Boolean(busy)} onChange={event => { if (event.target.value) navigate(`/retrospectivas/${encodeURIComponent(event.target.value)}`); }}><option value="" disabled>Seleccionar</option>{activeId && !sessions.some(value => String(value.id) === activeId) && <option value={activeId}>Retrospectiva seleccionada</option>}{sessions.map(value => <option key={value.id} value={value.id}>{value.title}</option>)}</select></Field><div className="retro-private-note"><ShieldCheck size={16} /><span>Espacio interno del staff autorizado</span></div></div>
      <LoadError error={error} onRetry={refresh} busy={loading} hasData={Boolean(detail)} />
      {loading && !detail ? <div className="retro-loading" role="status"><Spinner size={24} /><p>Preparando el panel de revisión…</p></div> : session && <>
        <section className="retro-event-header"><div className="retro-event-copy"><span className={`retro-phase phase-${session.phase}`}><i />{label(RETRO_PHASES, session.phase)}</span><h2>{session.title}</h2><div className="retro-event-date"><CalendarDays size={15} />{formatRetrospectiveDate(session.eventDate)}<span>·</span><span>{session.eventName}</span></div>{session.description && <p>{session.description}</p>}</div><div className="retro-event-tools">{manage && <button type="button" className="btn sm" disabled={Boolean(busy)} onClick={() => setSessionForm({ current: session })}><Pencil size={14} />Editar</button>}<button type="button" className="btn sm" disabled={Boolean(busy)} onClick={exportReview}><Download size={14} />Exportar</button>{manage && <Field label="Fase de la revisión"><select className="input" aria-label="Cambiar fase de la retrospectiva" value={session.phase} disabled={Boolean(busy)} onChange={event => setPhaseChange(event.target.value)}><SelectOptions values={RETRO_PHASES} /></select></Field>}</div></section>
        <section className="retro-stats" aria-label="Resumen de la retrospectiva">{[{ title: 'Aportaciones', count: counts.total ?? detail.items?.filter(item => !item.archived).length ?? 0, icon: MessageSquare, note: 'del equipo' }, { title: 'Votos de prioridad', count: counts.votes ?? 0, icon: ThumbsUp, note: 'para enfocar la revisión' }, { title: 'Acciones abiertas', count: counts.openActions ?? actions.filter(action => action.status !== 'done').length, icon: Target, note: 'con seguimiento' }, { title: 'Completadas', count: counts.doneActions ?? actions.filter(action => action.status === 'done').length, icon: CircleCheck, note: 'mejoras cerradas' }].map(({ title, count, icon: Icon, note }) => <div className="retro-stat" key={title}><div><span>{title}</span><Icon size={17} /></div><strong>{count}</strong><small>{note}</small></div>)}</section>
        <div className="retro-tab-bar"><div className="retro-tabs" role="tablist" aria-label="Vistas de la retrospectiva">{[{ id: 'board', label: 'Aportaciones', icon: MessageSquare }, { id: 'actions', label: 'Plan de acción', icon: ListChecks }, { id: 'summary', label: 'Conclusiones', icon: ClipboardList }].map(({ id, label: title, icon: Icon }) => <button type="button" role="tab" id={`retro-tab-${id}`} aria-selected={tab === id} aria-controls={`retro-view-${id}`} className={tab === id ? 'is-active' : ''} key={id} onClick={() => setTab(id)}><Icon size={16} />{title}{id === 'actions' && <span>{actions.length}</span>}</button>)}</div>{tab === 'board' && <button type="button" className="btn primary" disabled={!participate || !collecting || Boolean(busy)} onClick={() => setItemForm({})}><Plus size={15} />Añadir aportación</button>}{tab === 'actions' && manage && <button type="button" className="btn primary" disabled={Boolean(busy)} onClick={() => setActionForm({})}><Plus size={15} />Nueva acción</button>}</div>
        {tab === 'board' && <div role="tabpanel" aria-labelledby="retro-tab-board" id="retro-view-board">
          <div className="retro-board-intro"><span><EyeOff size={15} />Puedes compartir una crítica de forma anónima.</span><span>Describe hechos y propuestas para que podamos mejorarlos.</span></div>
          {!collecting && <div className="retro-readonly"><ShieldCheck size={16} />{session.phase === 'closed' ? 'La revisión está cerrada. Puedes consultar los aprendizajes y seguir las acciones.' : 'Estamos priorizando las aportaciones. Puedes apoyar prioridades y añadir contexto en los comentarios.'}</div>}
          <div className="retro-filters"><label className="retro-search"><Search size={16} /><input aria-label="Buscar aportaciones" placeholder="Buscar en las aportaciones…" value={query} onChange={event => setQuery(event.target.value)} /></label><select className="input" aria-label="Filtrar por área" value={area} onChange={event => setArea(event.target.value)}><option value="">Todas las áreas</option><SelectOptions values={RETRO_AREAS} /></select><select className="input" aria-label="Filtrar por impacto" value={severity} onChange={event => setSeverity(event.target.value)}><option value="">Todo el impacto</option><SelectOptions values={RETRO_SEVERITIES} /></select><label className="retro-filter-check"><input type="checkbox" checked={mine} onChange={event => setMine(event.target.checked)} />Mis aportaciones</label>{manage && <label className="retro-filter-check"><input type="checkbox" checked={includeArchived} onChange={event => setIncludeArchived(event.target.checked)} />Retiradas</label>}</div>
          <div className="retro-board">{RETRO_KINDS.map(kind => { const column = items.filter(item => item.kind === kind.id); const Icon = TYPE_ICONS[kind.id]; return <section className={`retro-column column-${kind.id}`} key={kind.id}><div className="retro-column-heading"><div className="retro-column-icon"><Icon size={18} /></div><div><h3>{kind.label}</h3><p>{TYPE_HELP[kind.id]}</p></div><span className="retro-count">{column.length}</span></div><div className="retro-column-items">{column.map(item => <ItemCard item={item} key={item.id} onOpen={() => setSelectedItemId(item.id)} onVote={() => vote(item)} votingDisabled={Boolean(busy) || session.phase === 'closed'} />)}{!column.length && <div className="retro-column-empty"><Icon size={23} /><strong>{query || area || severity || mine ? 'Sin coincidencias' : 'La primera aportación empieza aquí'}</strong><p>{query || area || severity || mine ? 'Prueba con otros filtros.' : TYPE_HELP[kind.id]}</p></div>}</div>{collecting && participate && <button type="button" className="retro-column-add" disabled={Boolean(busy)} onClick={() => setItemForm({ kind: kind.id })}><Plus size={15} />Añadir a {kind.label.toLocaleLowerCase('es')}</button>}</section>; })}</div>
        </div>}
        {tab === 'actions' && <div role="tabpanel" aria-labelledby="retro-tab-actions" id="retro-view-actions" className="retro-action-view"><div className="retro-action-intro"><h3>Acuerdos que tienen siguiente paso</h3><p>Coordinación asigna las acciones. Cada responsable puede actualizar su avance.</p></div>{!actions.length ? <div className="retro-action-empty"><EmptyState icon={ListChecks} title="Todavía no hay acciones acordadas">Abre una aportación y conviértela en una acción con responsable y fecha.</EmptyState></div> : <div className="retro-actions-list">{actions.map(action => { const source = detail.items?.find(item => item.id === action.itemId); const owns = String(action.owner?.id) === String(me.id); return <article key={action.id} className={`retro-action-card ${action.status === 'done' ? 'is-done' : ''}`}><span className={`retro-action-state action-${action.status}`}>{action.status === 'done' ? <Check size={18} /> : <Target size={18} />}</span><div className="retro-action-content"><div className="retro-action-title"><h3>{action.title}</h3><span className={`retro-priority priority-${action.priority}`}>Prioridad {label(RETRO_ACTION_PRIORITIES, action.priority).toLocaleLowerCase('es')}</span></div>{action.description && <p>{action.description}</p>}{source && <button type="button" className="retro-action-origin" onClick={() => setSelectedItemId(source.id)}><MessageSquare size={12} />{source.title}<ArrowUpRight size={12} /></button>}<div className="retro-action-meta"><span><UsersRound size={14} />{action.owner?.name || 'Sin responsable'}</span><span className={retrospectiveActionOverdue(action) ? 'is-overdue' : ''}><CalendarDays size={14} />{action.dueDate ? formatRetrospectiveDate(action.dueDate) : 'Sin fecha objetivo'}{retrospectiveActionOverdue(action) && ' · Vencida'}</span></div></div><div className="retro-action-controls">{manage || owns ? <select className="input" aria-label={`Estado de ${action.title}`} value={action.status} disabled={Boolean(busy)} onChange={event => run(`action:${action.id}`, () => api.patch(`${baseUrl(activeId)}/actions/${encodeURIComponent(action.id)}`, { status: event.target.value }), undefined, 'Avance actualizado.')}><SelectOptions values={RETRO_ACTION_STATUSES} /></select> : <span className={`retro-status status-${action.status}`}>{label(RETRO_ACTION_STATUSES, action.status)}</span>}{manage && <button type="button" className="btn ghost icon sm" aria-label={`Editar acción ${action.title}`} disabled={Boolean(busy)} onClick={() => setActionForm({ current: action })}><Pencil size={15} /></button>}</div></article>; })}</div>}</div>}
        {tab === 'summary' && <div role="tabpanel" aria-labelledby="retro-tab-summary" id="retro-view-summary"><Conclusions key={session.id} session={session} manage={manage} actions={actions} busy={Boolean(busy)} onSave={summary => run('summary', () => api.patch(baseUrl(activeId), { summary }), undefined, 'Conclusiones guardadas.')} /></div>}
      </>}
    </>}
    {sessionForm && <SessionForm current={sessionForm.current} busy={Boolean(busy)} onClose={() => setSessionForm(null)} onSubmit={saveSession} />}
    {itemForm && <ContributionForm current={itemForm.current} kind={itemForm.kind} busy={Boolean(busy)} onClose={() => setItemForm(null)} onSubmit={saveContribution} />}
    {actionForm && <ActionForm current={actionForm.current} sourceItem={actionForm.sourceItem} people={detail?.people || []} busy={Boolean(busy)} onClose={() => setActionForm(null)} onSubmit={saveAction} />}
    {selectedItem && !itemForm && !actionForm && !withdrawItem && <ItemDetail key={selectedItem.id} item={selectedItem} manage={manage} phase={session.phase} busy={Boolean(busy)} canEdit={Boolean(selectedItem.canEdit || selectedItem.anonymous && editKeyFor(selectedItem))} canArchive={Boolean(selectedItem.canArchive || selectedItem.anonymous && editKeyFor(selectedItem))} onClose={() => setSelectedItemId(null)} onVote={() => vote(selectedItem)} onEdit={() => setItemForm({ current: selectedItem })} onWithdraw={() => setWithdrawItem(selectedItem)} onAction={() => setActionForm({ sourceItem: selectedItem })} onComment={body => run('comment', () => api.post(`${itemUrl(activeId, selectedItem.id)}/comments`, body), undefined, 'Comentario publicado.')} />}
    {withdrawItem && <Modal title="Retirar aportación" onClose={busy ? undefined : () => setWithdrawItem(null)} size="sm"><div className="modal-body retro-form"><p>«{withdrawItem.title}» dejará de aparecer en el panel principal. El contenido se conserva para la revisión interna.</p><div className="retro-form-actions"><button type="button" className="btn" disabled={Boolean(busy)} onClick={() => setWithdrawItem(null)}>Cancelar</button><button type="button" className="btn danger" disabled={Boolean(busy)} onClick={() => { const claim = withdrawItem.anonymous ? editKeyFor(withdrawItem) : null; run('withdraw', () => api.del(itemUrl(activeId, withdrawItem.id), claim ? { editKey: claim } : undefined), () => { setWithdrawItem(null); setSelectedItemId(null); }, 'Aportación retirada del panel.'); }}>{busy ? <Spinner /> : <Archive size={15} />}Retirar aportación</button></div></div></Modal>}
    {phaseChange && <Modal title="Cambiar fase de la revisión" onClose={busy ? undefined : () => setPhaseChange(null)} size="sm"><div className="modal-body retro-form"><p>La retrospectiva pasará a <strong>{label(RETRO_PHASES, phaseChange).toLocaleLowerCase('es')}</strong>.</p><p className="muted">{phaseChange === 'collecting' ? 'El staff podrá volver a añadir y editar sus aportaciones.' : phaseChange === 'reviewing' ? 'Se cierra la entrada de nuevas aportaciones. El staff podrá priorizar y comentar las existentes.' : 'Las aportaciones, votos y comentarios quedarán en consulta. El plan de acción seguirá disponible para actualizar el avance.'}</p><div className="retro-form-actions"><button type="button" className="btn" disabled={Boolean(busy)} onClick={() => setPhaseChange(null)}>Cancelar</button><button type="button" className="btn primary" disabled={Boolean(busy)} onClick={() => run('phase', () => api.patch(baseUrl(activeId), { phase: phaseChange }), () => setPhaseChange(null), 'Fase de revisión actualizada.')}>{busy ? <Spinner /> : <Check size={15} />}Confirmar cambio</button></div></div></Modal>}
  </div>;
}
