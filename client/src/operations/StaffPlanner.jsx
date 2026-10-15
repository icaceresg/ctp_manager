import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Check, Plus, Users } from 'lucide-react';
import { Badge, DataTable, Empty, Field, FormDialog, MatchLink } from './ui.jsx';
import { ActionButton } from './ReviewPanels.jsx';
import { dateTime, label, matchName, matchOption } from './model.js';
import { ACTIVE_ASSIGNMENTS, ROLE_SECTIONS, assignmentCandidates, madridDay, matchCoverage, shiftDay, validTime, weekDays } from './staffModel.js';

function localInput(value) { const d = new Date(value); if (!Number.isFinite(d.getTime())) return ''; return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function spanIntersects(a, days) { if (!validTime(a.starts_at) || !validTime(a.ends_at)) return false; return madridDay(a.starts_at) <= days[6] && madridDay(new Date(validTime(a.ends_at) - 1)) >= days[0]; }
const dayTitle = (day) => new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));

export function StaffPlanner({ data, mutate, me, can }) {
  const [params, setParams] = useSearchParams();
  const matchFilter = params.get('match') || '';
  const [dialog, setDialog] = useState(null);
  const initialMatch = data.matches.find((m) => m.id === matchFilter);
  const linkedWeek = params.get('week');
  const validLinkedWeek = /^\d{4}-\d{2}-\d{2}$/.test(linkedWeek || '') && validTime(`${linkedWeek}T12:00:00Z`) !== null;
  const [week, setWeek] = useState(() => weekDays(initialMatch?.scheduled_at ? madridDay(initialMatch.scheduled_at) : validLinkedWeek ? linkedWeek : madridDay())[0]);
  useEffect(() => { const selected = data.matches.find((m) => m.id === matchFilter); if (selected?.scheduled_at) setWeek(weekDays(madridDay(selected.scheduled_at))[0]); }, [matchFilter]);
  const [role, setRole] = useState('all');
  const [showClosed, setShowClosed] = useState(false);
  const person = params.get('person') || 'all';
  const days = weekDays(week);
  const assignments = data.assignments || [];
  const missing = params.get('coverage') === 'missing';
  const selectParam = (key, value) => { const next = new URLSearchParams(params); value && value !== 'all' ? next.set(key, value) : next.delete(key); setParams(next); };
  const filtered = assignments.filter((a) => (showClosed || ACTIVE_ASSIGNMENTS.includes(a.status)) && (!matchFilter || a.match_id === matchFilter) && (role === 'all' || a.role === role) && (person === 'all' || a.user_id === (person === 'me' ? me.id : Number(person))) && spanIntersects(a, days));
  const weekMatches = data.matches.filter((m) => m.scheduled_at && madridDay(m.scheduled_at) >= days[0] && madridDay(m.scheduled_at) <= days[6] && (!matchFilter || m.id === matchFilter) && (!missing || !matchCoverage(m.id, assignments).referee.confirmed)).sort((a, b) => validTime(a.scheduled_at) - validTime(b.scheduled_at));
  const availableStaff = data.staff || [];
  const openCreate = (matchId) => setDialog({ type: 'create', matchId: matchId || matchFilter });
  return <>
    <div className="op-section-title"><div><h2>Planificador del equipo</h2><p>Cobertura semanal, disponibilidad y confirmación de turnos.</p></div>{can('operaciones') && <button className="btn primary" disabled={!data.matches.length} onClick={() => openCreate()}><Plus size={16} /> Asignar turno</button>}</div>
    <div className="op-inline-note"><Users size={17} /><p>Los turnos requieren disponibilidad marcada. Sustituir a alguien o cambiar su horario pide una nueva confirmación.</p>{can('disponibilidad') && <Link to="/disponibilidad">Mi disponibilidad <ArrowUpRight size={13} /></Link>}</div>
    <div className="op-section-title"><div className="op-week-switch"><button className="btn icon" aria-label="Semana anterior" onClick={() => setWeek(shiftDay(week, -7))}><ArrowLeft size={17} /></button><strong>{dayTitle(days[0])} — {dayTitle(days[6])}</strong><button className="btn icon" aria-label="Semana siguiente" onClick={() => setWeek(shiftDay(week, 7))}><ArrowRight size={17} /></button><button className="btn" onClick={() => setWeek(weekDays()[0])}>Esta semana</button></div><span className="muted">Semana y disponibilidad · Europe/Madrid</span></div>
    <div className="op-filters"><select aria-label="Filtrar turnos por persona" value={person} onChange={(e) => selectParam('person', e.target.value)}><option value="all">Todo el equipo</option><option value="me">Mis turnos</option>{availableStaff.filter((s) => s.id !== me.id).map((s) => <option value={s.id} key={s.id}>{s.name}</option>)}</select><select aria-label="Filtrar turnos por función" value={role} onChange={(e) => setRole(e.target.value)}><option value="all">Todas las funciones</option><option value="referee">Arbitraje</option><option value="caster">Casters</option><option value="producer">Realización</option></select><select aria-label="Filtrar equipo por partido" value={matchFilter} onChange={(e) => { selectParam('match', e.target.value); const selected = data.matches.find((m) => m.id === e.target.value); if (selected?.scheduled_at) setWeek(weekDays(madridDay(selected.scheduled_at))[0]); }}><option value="">Todos los partidos</option>{data.matches.map((m) => <option key={m.id} value={m.id}>{matchOption(m)}</option>)}</select><label className="op-check"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Ver cancelados y rechazados</label></div>
    <div className="op-week-grid">{days.map((day) => { const rows = filtered.filter((a) => madridDay(a.starts_at) <= day && madridDay(new Date(validTime(a.ends_at) - 1)) >= day); const ready = availableStaff.filter((s) => (role === 'all' || s.is_admin || s.sections?.includes(ROLE_SECTIONS[role])) && (person === 'all' || s.id === (person === 'me' ? me.id : Number(person))) && s.availability?.some((a) => a.date === day && a.status === 'disponible')); return <section className={`op-week-day ${day === madridDay() ? 'is-today' : ''}`} key={day}><header><strong>{dayTitle(day)}</strong>{can('operaciones') && <small>{ready.length} disponibles</small>}</header><div className="op-week-items">{rows.length ? rows.map((a) => <Link key={a.id} to={`/operaciones/partidos/${encodeURIComponent(a.match_id)}`} className={`op-week-assignment op-role-${a.role}`}><span>{new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date(a.starts_at))} · {label(a.role)}</span><strong>{a.user_name || availableStaff.find((s) => s.id === a.user_id)?.name || 'Staff'}</strong><small>{matchName(data.matches.find((m) => m.id === a.match_id))}</small><Badge value={a.status} /></Link>) : <span className="op-week-empty">Sin turnos</span>}</div>{can('operaciones') && ready.length > 0 && <details><summary>Disponibles</summary><ul>{ready.map((s) => <li key={s.id}>{s.name}</li>)}</ul></details>}</section>; })}</div>
    {can('operaciones') && <section className="op-card"><div className="op-section-title"><div><h2>Cobertura de los partidos</h2><p>Arbitraje pendiente de confirmar. Casters y realización según la emisión prevista.</p></div><label className="op-check"><input type="checkbox" checked={missing} onChange={(e) => selectParam('coverage', e.target.checked ? 'missing' : '')} /> Solo sin árbitro confirmado</label></div><DataTable rows={weekMatches} empty="No hay partidos con esos filtros esta semana" emptyDetail="Cambia de semana o el filtro de partido para planificar otra jornada." columns={[
      { key: 'match', title: 'Partido', render: (m) => <div className="op-stack"><MatchLink match={m} /><small>{dateTime(m.scheduled_at)}</small></div> },
      ...['referee', 'caster', 'producer'].map((r) => ({ key: r, title: label(r), render: (m) => { const c = matchCoverage(m.id, assignments)[r]; return <span className={r === 'referee' && !c.confirmed ? 'op-urgent' : ''}>{c.confirmed ? `${c.confirmed} confirmado${c.confirmed > 1 ? 's' : ''}` : c.assigned ? `${c.assigned} por confirmar` : 'Sin asignar'}</span>; } })),
      { key: 'action', title: 'Equipo', render: (m) => <button className="btn sm" onClick={() => openCreate(m.id)}>Asignar</button> },
    ]} /></section>}
    <div className="op-section-title"><h2>Seguimiento de turnos</h2><span className="op-count">{filtered.length} turnos en esta selección</span></div>
    <DataTable rows={filtered} empty="No hay turnos en esta selección" emptyDetail="Elige otra semana o cambia los filtros. Coordinación puede asignar turnos con disponibilidad confirmada." columns={[
      { key: 'match', title: 'Partido', render: (a) => <MatchLink id={a.match_id} match={data.matches.find((m) => m.id === a.match_id)} /> },
      { key: 'user', title: 'Persona', render: (a) => a.user_name || availableStaff.find((s) => s.id === a.user_id)?.name || 'Staff' },
      { key: 'role', title: 'Función', render: (a) => label(a.role) },
      { key: 'dates', title: 'Turno · hora local', render: (a) => <span>{dateTime(a.starts_at)}<br /><small>Hasta {dateTime(a.ends_at)}</small></span> },
      { key: 'status', title: 'Estado', render: (a) => <Badge value={a.status} /> },
      { key: 'actions', title: 'Acción', render: (a) => <div className="op-actions">{a.user_id === me.id && ['assigned', 'pending'].includes(a.status) && <><ActionButton run={() => mutate('patch', `/assignments/${a.id}`, { expected_version: a.version, status: 'confirmed' })}><Check size={14} /> Confirmar</ActionButton><ActionButton run={() => mutate('patch', `/assignments/${a.id}`, { expected_version: a.version, status: 'declined' })}>No puedo</ActionButton></>}{can('operaciones') && ACTIVE_ASSIGNMENTS.includes(a.status) && <><button className="btn sm" onClick={() => setDialog({ type: 'edit', assignment: a })}>Reprogramar / sustituir</button><button className="btn sm" onClick={() => setDialog({ type: 'cancel', assignment: a })}>Cancelar turno</button></>}</div> },
    ]} />
    {dialog && dialog.type !== 'cancel' && <AssignmentEditor data={data} mutate={mutate} dialog={dialog} onClose={() => setDialog(null)} />}
    {dialog?.type === 'cancel' && <FormDialog title="Cancelar turno" onClose={() => setDialog(null)} submitLabel="Cancelar este turno" help={`Se retirará el turno de ${dialog.assignment.user_name || 'la persona asignada'}. Tendrás que cubrirlo con otra asignación si el partido sigue en pie.`} submit={() => mutate('patch', `/assignments/${dialog.assignment.id}`, { expected_version: dialog.assignment.version, status: 'cancelled' })}><p>{matchName(data.matches.find((m) => m.id === dialog.assignment.match_id))} · {dateTime(dialog.assignment.starts_at)}</p></FormDialog>}
  </>;
}
function AssignmentEditor({ data, mutate, dialog, onClose }) {
  const editing = dialog.assignment;
  const [matchId, setMatchId] = useState(editing?.match_id || dialog.matchId || '');
  const match = data.matches.find((m) => m.id === matchId);
  const [role, setRole] = useState(editing?.role || 'referee');
  const [start, setStart] = useState(localInput(editing?.starts_at || (match?.scheduled_at ? validTime(match.scheduled_at) - 30 * 60000 : NaN)));
  const [end, setEnd] = useState(localInput(editing?.ends_at || (match?.scheduled_at ? validTime(match.scheduled_at) + 2 * 3600000 : NaN)));
  const [person, setPerson] = useState(String(editing?.user_id || ''));
  const candidates = assignmentCandidates(data.staff || [], data.assignments || [], { role, starts_at: start, ends_at: end, excludeId: editing?.id });
  const updateMatch = (id) => { setMatchId(id); const next = data.matches.find((m) => m.id === id); if (next?.scheduled_at) { setStart(localInput(validTime(next.scheduled_at) - 30 * 60000)); setEnd(localInput(validTime(next.scheduled_at) + 2 * 3600000)); } };
  return <FormDialog title={editing ? 'Reprogramar o sustituir turno' : 'Asignar turno'} onClose={onClose} help="Los candidatos se comprueban con su disponibilidad diaria en Madrid y los turnos actuales. El servidor vuelve a validar al guardar." submit={async (body) => {
    if (!candidates.some((s) => s.id === Number(person) && s.eligible)) throw new Error('Elige una persona disponible, con permisos y sin otro turno en ese horario.');
    const payload = { user_id: Number(person), starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString() };
    if (editing) return mutate('patch', `/assignments/${editing.id}`, { ...payload, expected_version: editing.version, reason: body.reason }, 'Turno actualizado. La persona debe volver a confirmarlo.');
    return mutate('post', '/assignments', { ...payload, match_id: matchId, role }, 'Turno asignado, pendiente de confirmación.');
  }}>
    <Field label="Partido"><select name="match_id" value={matchId} onChange={(e) => updateMatch(e.target.value)} disabled={Boolean(editing)} required><option value="">Seleccionar partido</option>{data.matches.map((m) => <option key={m.id} value={m.id}>{matchOption(m)}</option>)}</select></Field>
    <Field label="Función"><select name="role" value={role} disabled={Boolean(editing)} onChange={(e) => { setRole(e.target.value); setPerson(''); }}><option value="referee">Árbitro</option><option value="caster">Caster</option><option value="producer">Realizador</option></select></Field>
    <div className="op-form-grid"><Field label="Inicio · hora local del navegador"><input name="starts_at" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required /></Field><Field label="Fin · hora local del navegador"><input name="ends_at" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required /></Field></div>
    <Field label="Persona disponible"><select name="user_id" value={person} onChange={(e) => setPerson(e.target.value)} required><option value="">Seleccionar persona</option>{candidates.map((s) => <option key={s.id} value={s.id} disabled={!s.eligible}>{s.name}{s.eligible ? ' · Disponible' : ` · ${s.unavailableReason}`}</option>)}</select></Field>
    <div className="op-candidate-summary" role="status"><strong>{candidates.filter((s) => s.eligible).length} personas disponibles</strong>{!candidates.length && <p>Nadie tiene permisos para esta función. Revisa los roles del staff.</p>}{candidates.some((s) => !s.eligible) && <details><summary>Por qué otras personas no están disponibles</summary><ul>{candidates.filter((s) => !s.eligible).map((s) => <li key={s.id}><strong>{s.name}:</strong> {s.unavailableReason}</li>)}</ul></details>}</div>
    {editing && <Field label="Motivo de la sustitución o cambio"><textarea name="reason" rows={3} required minLength={8} maxLength={1000} /></Field>}
  </FormDialog>;
}
