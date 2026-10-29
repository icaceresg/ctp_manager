import { matchName } from './model.js';

export const ACTIVE_ASSIGNMENTS = ['pending', 'assigned', 'confirmed'];
export const CLOSED_INCIDENTS = ['resolved', 'closed', 'closed_internal', 'rejected'];
export const ROLE_SECTIONS = { referee: 'arbitraje', caster: 'casters', producer: 'realizacion' };
export const madridDay = (value = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
export function shiftDay(day, amount) { return new Date(Date.parse(`${day}T12:00:00Z`) + amount * 86400000).toISOString().slice(0, 10); }
export function weekDays(day = madridDay()) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const monday = shiftDay(day, -(weekday === 0 ? 6 : weekday - 1));
  return Array.from({ length: 7 }, (_, i) => shiftDay(monday, i));
}
export function validTime(value) { const n = value == null ? NaN : new Date(value).getTime(); return Number.isFinite(n) ? n : null; }
export function elapsedLabel(value, now = Date.now()) {
  const time = validTime(value);
  if (time === null) return 'Sin fecha disponible';
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / 1440)} d`;
}
// Official assignment may not have a matching local Manager account.
export function hasIncidentAssignee(incident) {
  return Boolean(incident?.assignee_id || incident?.assignee_ctp_id || (typeof incident?.assigned_name === 'string' && incident.assigned_name.trim()));
}
export function incidentNextAction(incident) {
  if (CLOSED_INCIDENTS.includes(incident.status)) return 'Consultar resolución';
  if (incident.status === 'resolution_pending') return 'Comprobar entrega a CTP';
  const ticket = incident.source === 'ctp' && incident.kind !== 'ranked';
  // This flag describes who wrote last, not whether somebody read the thread.
  if (incident.awaiting_staff) return ticket ? 'Responder al jugador' : 'Revisar conversación';
  if (!hasIncidentAssignee(incident)) return ticket ? 'Asignar responsable' : 'Asignar un árbitro';
  // Waiting is manually selected; the DTO does not say which party must reply.
  if (incident.status === 'waiting') return 'Revisar seguimiento';
  if (incident.status === 'investigating') return 'Valorar pruebas y resolver';
  return 'Iniciar revisión';
}
export function incidentRows(incidents, { state = 'active', bucket = 'all', query = '', order = 'priority', meId, matches = [], staff = [] } = {}) {
  const text = query.trim().toLocaleLowerCase('es');
  return incidents.filter((i) => {
    const closed = CLOSED_INCIDENTS.includes(i.status);
    if (state !== 'all' && (state === 'resolved' ? !closed : closed)) return false;
    if (bucket === 'mine' && i.assignee_id !== meId) return false;
    if (bucket === 'unassigned' && hasIncidentAssignee(i)) return false;
    if (bucket === 'urgent' && i.priority !== 'urgent') return false;
    if (!text) return true;
    const match = matches.find((m) => m.id === i.match_id);
    const person = staff.find((s) => s.id === i.assignee_id);
    return [i.id, i.title, i.reason, match ? matchName(match) : '', person?.name].filter(Boolean).join(' ').toLocaleLowerCase('es').includes(text);
  }).sort((a, b) => {
    if (order === 'priority' && a.priority !== b.priority) return a.priority === 'urgent' ? -1 : b.priority === 'urgent' ? 1 : 0;
    const age = (validTime(a.created_at) ?? Number.MAX_SAFE_INTEGER) - (validTime(b.created_at) ?? Number.MAX_SAFE_INTEGER);
    return order === 'newest' ? -age : age;
  });
}
export function assignmentCandidates(staff, assignments, { role, starts_at, ends_at, excludeId } = {}) {
  const start = validTime(starts_at), end = validTime(ends_at);
  const validRange = start !== null && end !== null && end - start >= 60000 && end - start <= 86400000;
  return staff.filter((s) => s.is_admin || s.sections?.includes(ROLE_SECTIONS[role])).map((s) => {
    let reason = '';
    if (!validRange) reason = 'Indica un horario entre un minuto y 24 horas';
    else {
      const first = madridDay(start), last = madridDay(end - 1);
      for (let day = first; day <= last; day = shiftDay(day, 1)) {
        if (!s.availability?.some((a) => a.date === day && a.status === 'disponible')) { reason = `Sin disponibilidad confirmada el ${day}`; break; }
      }
      if (!reason && assignments.some((a) => a.id !== excludeId && a.user_id === s.id && ACTIVE_ASSIGNMENTS.includes(a.status) && validTime(a.starts_at) < end && validTime(a.ends_at) > start)) reason = 'Coincide con otro turno';
    }
    return { ...s, eligible: !reason, unavailableReason: reason };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || (a.name || '').localeCompare(b.name || '', 'es'));
}
export function matchCoverage(matchId, assignments, coverage) {
  if(coverage)return Object.fromEntries(Object.keys(ROLE_SECTIONS).map(role=>[role,coverage[matchId]?.[role]||{assigned:0,confirmed:0}]));
  const rows = assignments.filter((a) => a.match_id === matchId && ACTIVE_ASSIGNMENTS.includes(a.status));
  return Object.fromEntries(Object.keys(ROLE_SECTIONS).map((role) => {
    const assigned = rows.filter((a) => a.role === role);
    return [role, { assigned: assigned.length, confirmed: assigned.filter((a) => a.status === 'confirmed').length }];
  }));
}
export function personalTasks(data, me, can, now = Date.now()) {
  const tasks = [];
  const matchById = (id) => data.matches?.find((m) => m.id === id)||data.context_matches?.find((m)=>m.id===id);
  for (const a of data.assignments || []) if (a.user_id === me.id && ['pending', 'assigned'].includes(a.status) && (validTime(a.ends_at) ?? 0) > now) tasks.push({ id: `assignment:${a.id}`, title: 'Confirmar tu turno', detail: `${matchName(matchById(a.match_id))}`, to: `/operaciones/turnos?match=${encodeURIComponent(a.match_id)}`, priority: 1, when: a.starts_at });
  if (can('arbitraje')) for (const i of data.incidents || []) if (!CLOSED_INCIDENTS.includes(i.status) && (i.assignee_id === me.id || !i.assignee_id)) tasks.push({ id: `incident:${i.id}`, title: incidentNextAction(i), detail: i.title, to: `/operaciones/incidencias?case=${encodeURIComponent(i.id)}`, priority: i.priority === 'urgent' ? 0 : i.assignee_id === me.id ? 1 : 2, when: i.created_at });
  if(can('operaciones')){const pending=(data.commands||[]).filter(command=>!['acknowledged','cancelled'].includes(command.status));if(pending.length)tasks.push({id:'decisions',title:'Revisar decisiones pendientes',detail:`${pending.length} propuestas en esta consulta`,to:'/operaciones/decisiones',priority:1});}
  if (can('arbitraje')) { const pending = data.pages?.stats?.total??(data.stats || []).filter((s) => s.status === 'pending' && !s.pending_command_id).length; if (pending) tasks.push({ id: 'stats', title: 'Revisar estadísticas', detail: `${pending} ${pending === 1 ? 'mapa pendiente' : 'mapas pendientes'}`, to: '/operaciones/estadisticas', priority: 2 }); }
  if (can('clubes')) { const pending = data.pages?.clubs?.total??(data.clubs || []).filter((c) => !c.verified && !c.pending_command_id).length; if (pending) tasks.push({ id: 'clubs', title: 'Revisar identidades de clubes', detail: `${pending} clubes sin verificar`, to: '/operaciones/clubes', priority: 3 }); }
  if (can('comunicaciones')) { const failed = data.pages?.deliveries?.total??(data.deliveries || []).filter((d) => ['error', 'failed', 'dead'].includes(d.status)).length; if (failed) tasks.push({ id: 'discord', title: 'Revisar avisos de Discord', detail: `${failed} entregas con errores`, to: '/operaciones/discord', priority: 2 }); }
  if (can('realizacion') || can('casters')) {
    const assigned = new Set((data.assignments || []).filter((a) => a.user_id === me.id && ACTIVE_ASSIGNMENTS.includes(a.status) && ['caster', 'producer'].includes(a.role) && (validTime(a.ends_at) ?? 0) > now).map((a) => a.match_id));
    for (const id of assigned) { const match = matchById(id); if (!match) continue; const production = data.production?.find((p) => p.match_id === id); if (can('realizacion') && (!production?.rundown_id || !production.note)) tasks.push({ id: `production:${id}`, title: 'Preparar el directo asignado', detail: matchName(match), to: `/operaciones/realizacion?match=${encodeURIComponent(id)}`, priority: 2, when: match.scheduled_at }); else if (can('casters')) tasks.push({ id: `dossier:${id}`, title: 'Revisar el dossier asignado', detail: matchName(match), to: `/operaciones/partidos/${encodeURIComponent(id)}`, priority: 3, when: match.scheduled_at }); }
  }
  return tasks.sort((a, b) => a.priority - b.priority || (validTime(a.when) ?? Number.MAX_SAFE_INTEGER) - (validTime(b.when) ?? Number.MAX_SAFE_INTEGER));
}
