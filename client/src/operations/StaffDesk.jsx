import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, CalendarDays, CheckCircle2, Clock3, ListChecks, Users } from 'lucide-react';
import { Badge, Empty, AuditList } from './ui.jsx';
import { dateTime, label, matchName, officialResult } from './model.js';
import { ACTIVE_ASSIGNMENTS, madridDay, matchCoverage, personalTasks, validTime } from './staffModel.js';

export function StaffDesk({ data, me, can }) {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const defaultScope = can('operaciones') ? 'team' : 'mine';
  const scope = ['mine', 'team'].includes(params.get('scope')) ? params.get('scope') : defaultScope;
  const period = ['upcoming', 'today', 'all'].includes(params.get('period')) ? params.get('period') : 'upcoming';
  const setFilter = (key, value) => setParams(previous => { const next = new URLSearchParams(previous); value ? next.set(key, value) : next.delete(key); return next; }, { replace: true });
  const setQuery = value => setFilter('q', value);
  const setScope = value => setFilter('scope', value);
  const setPeriod = value => setFilter('period', value);
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [showAllMatches, setShowAllMatches] = useState(false);
  const seesMatches = ['operaciones', 'arbitraje', 'casters', 'realizacion', 'comunicaciones'].some(can);
  const seesAssignments = ['operaciones', 'arbitraje', 'casters', 'realizacion'].some(can);
  const today = madridDay();
  const mine = (data.assignments || []).filter((a) => a.user_id === me.id && ACTIVE_ASSIGNMENTS.includes(a.status));
  const assignedIds = new Set(mine.map((a) => a.match_id));
  const tasks = personalTasks(data, me, can);
  const pending = mine.filter((a) => ['pending', 'assigned'].includes(a.status) && (validTime(a.ends_at) ?? 0) > Date.now());
  const rows = (data.matches || []).filter((m) => {
    if (scope === 'mine' && !assignedIds.has(m.id)) return false;
    if (period === 'today' && (!m.scheduled_at || madridDay(m.scheduled_at) !== today)) return false;
    if (period === 'upcoming' && (m.confirmed || ['cancelled', 'cancelado', 'closed', 'finished', 'completed', 'finalizado', 'jugado'].includes(m.status))) return false;
    return [matchName(m), m.title, m.tournament_name].filter(Boolean).join(' ').toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es'));
  }).sort((a, b) => (validTime(a.scheduled_at) ?? Number.MAX_SAFE_INTEGER) - (validTime(b.scheduled_at) ?? Number.MAX_SAFE_INTEGER));
  const gaps = (data.matches || []).filter((m) => !m.confirmed && !['cancelled', 'cancelado', 'finished', 'completed', 'finalizado', 'jugado', 'closed'].includes(m.status) && matchCoverage(m.id, data.assignments || []).referee.confirmed === 0);
  const firstPending = [...pending].sort((a, b) => validTime(a.starts_at) - validTime(b.starts_at))[0];
  const firstGap = gaps.filter((m) => validTime(m.scheduled_at) !== null).sort((a, b) => validTime(a.scheduled_at) - validTime(b.scheduled_at))[0];
  return <>
    <section className="op-card"><div className="op-section-title"><div><h2>Qué hacer ahora</h2><p>Abre una tarea para trabajar directamente en ella.</p></div><div className="op-actions"><span className="op-count">{tasks.length} {tasks.length === 1 ? 'pendiente' : 'pendientes'}</span>{can('disponibilidad') && <Link className="btn sm" to="/disponibilidad"><CalendarDays size={15} /> Disponibilidad</Link>}</div></div>{tasks.length ? <><ol className="op-task-list">{(showAllTasks ? tasks : tasks.slice(0, 6)).map((task) => <li key={task.id}><Link to={task.to}><span className={`op-task-marker ${task.priority === 0 ? 'is-urgent' : ''}`}><ListChecks size={16} /></span><span><strong>{task.title}</strong><small>{task.detail}{task.when ? ` · ${dateTime(task.when)}` : ''}</small></span><ArrowUpRight size={17} /></Link></li>)}</ol>{tasks.length > 6 && <button className="btn" onClick={() => setShowAllTasks(!showAllTasks)}>{showAllTasks ? 'Mostrar menos' : `Ver ${tasks.length - 6} tareas más`}</button>}</> : <div className="op-caught-up"><CheckCircle2 size={22} /><div><strong>No tienes tareas pendientes en esta consulta</strong><p>Consulta la agenda o actualiza tus días disponibles.</p></div></div>}</section>
    {((seesAssignments && pending.length > 0) || (can('operaciones') && gaps.length > 0)) && <div className="op-quick-strip">
      {seesAssignments && pending.length > 0 && <Link to={`/operaciones/turnos?person=me${firstPending ? `&week=${madridDay(firstPending.starts_at)}` : ''}`}><Clock3 size={18} /><span><strong>{pending.length} turno{pending.length === 1 ? '' : 's'} por confirmar</strong><small>Confirmar mis turnos</small></span><ArrowUpRight size={16} /></Link>}
      {can('operaciones') && gaps.length > 0 && <Link to={`/operaciones/turnos?coverage=missing${firstGap ? `&week=${madridDay(firstGap.scheduled_at)}` : ''}`}><Users size={18} /><span><strong>{gaps.length} partido{gaps.length === 1 ? '' : 's'} sin árbitro</strong><small>Abrir planificador</small></span><ArrowUpRight size={16} /></Link>}
    </div>}
    {seesMatches && <><div className="op-section-title"><div><h2>Agenda de partidos</h2><p>Horarios en tu zona local. Abre el dossier para consultar el encuentro.</p></div><div className="op-filters"><input aria-label="Buscar partido de la jornada" placeholder="Equipo, partido o torneo…" value={query} onChange={(e) => setQuery(e.target.value)} /><select aria-label="Alcance de agenda" value={scope} onChange={(e) => setScope(e.target.value)}><option value="mine">Mis partidos</option><option value="team">Toda la jornada</option></select><select aria-label="Periodo de la jornada" value={period} onChange={(e) => setPeriod(e.target.value)}><option value="upcoming">Abiertos y próximos</option><option value="today">Hoy · Madrid</option><option value="all">Todos los recibidos</option></select>{(query || scope !== defaultScope || period !== 'upcoming') && <button className="btn" onClick={() => { setParams({}, { replace: true }); setShowAllMatches(false); }}>Limpiar filtros</button>}</div></div>
    {rows.length ? <><div className="op-match-grid">{(showAllMatches || query ? rows : rows.slice(0, 8)).map((m) => { const own = mine.filter((a) => a.match_id === m.id); const coverage = matchCoverage(m.id, data.assignments || []); return <Link state={{ returnTo: location.pathname + location.search }} to={`/operaciones/partidos/${encodeURIComponent(m.id)}`} className="op-match-card" key={m.id}><div className="op-match-meta"><span>{m.title || label(m.kind)}</span><Badge value={m.status} /></div><h3 className="op-agenda-match">{matchName(m)}</h3><div className="op-agenda-time"><Clock3 size={15} /><span>{dateTime(m.scheduled_at)}</span></div>{m.confirmed && <strong className="op-count">{officialResult(m)}</strong>}<div className="op-match-bottom"><span>{own.length ? own.map((a) => `${label(a.role)} · ${label(a.status)}`).join(' / ') : coverage.referee.confirmed ? 'Árbitro confirmado' : 'Árbitro por confirmar'}</span><ArrowUpRight size={15} /></div></Link>; })}</div>{rows.length > 8 && !query && <button className="btn" onClick={() => setShowAllMatches(!showAllMatches)}>{showAllMatches ? 'Mostrar menos partidos' : `Ver ${rows.length - 8} partidos más`}</button>}</> : <Empty title={scope === 'mine' ? 'No tienes partidos en esta selección' : 'No hay partidos en esta selección'}>Puedes cambiar el periodo o consultar toda la jornada. Solo se muestran los partidos recibidos de CTP.</Empty>}
    </>}{can('operaciones') && <details className="op-case-panel"><summary>Actividad reciente del equipo</summary><AuditList items={data.audit} /></details>}
  </>;
}
