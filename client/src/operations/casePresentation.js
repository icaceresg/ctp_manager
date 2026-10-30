import { hasIncidentAssignee } from './staffModel.js';

// Display labels only. Persisted ticket types, codes and IDs remain untouched.
const TYPES = Object.freeze({
  consulta: 'Consulta', disputa_resultado: 'Disputa de resultado', resultado_incorrecto: 'Resultado incorrecto',
  no_show: 'Ausencia en la partida', trampa: 'Posibles trampas', toxicidad: 'Conducta inapropiada',
  tecnico: 'Problema técnico', problema_tecnico: 'Problema técnico', error_tecnico: 'Problema técnico', bug: 'Error de la plataforma',
  cuenta: 'Ayuda con la cuenta', cambio_activision: 'Cambio de Activision ID', otro: 'Otra consulta',
});
const clean = value => typeof value === 'string' ? value.trim() : '';
const codedTitle = record => /^(CTP-[A-Z0-9-]+)\s*[·:]\s*(.+)$/i.exec(clean(record?.title));
const typeKeys = record => [record?.type, record?.ticket_type, codedTitle(record)?.[2]].map(clean);

export function caseTypeLabel(record) {
  const known = typeKeys(record).find(key => Object.hasOwn(TYPES, key));
  return known ? TYPES[known] : 'Ticket';
}
export function caseTitle(record) {
  const title = clean(record?.title), parts = codedTitle(record);
  const content = parts ? parts[2].trim() : title;
  if (Object.hasOwn(TYPES, content)) return caseTypeLabel(record);
  if (content && !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(content) && (!parts || !/^[a-z][a-z0-9_]*$/.test(content))) return content;
  const type = caseTypeLabel(record);
  return type === 'Ticket' ? 'Solicitud de soporte' : type;
}
export function caseReference(record) {
  return clean(record?.code) || clean(record?.ticket_code) || codedTitle(record)?.[1] || clean(record?.id);
}
export function shortCaseReference(record) {
  const full = caseReference(record);
  if (/^CTP-/i.test(full)) return full.length > 14 ? `${full.slice(0, 4)}…${full.slice(-6)}` : full;
  return full.length > 8 ? full.slice(0, 8) : full || 'Sin referencia';
}
export function caseAssigneeLabel(record, staff = []) {
  return clean(record?.assigned_name) || clean(staff.find(person => person.id === record?.assignee_id)?.name)
    || (hasIncidentAssignee(record) ? 'Responsable asignado' : 'Sin asignar');
}

// Without aggregates, fallback counts explicitly cover only the loaded page.
export function inboxCounts(data, meId) {
  const open = (data.incidents || []).filter(item => !['resolved', 'closed', 'closed_internal', 'rejected'].includes(item.status));
  const server = data.incident_counts;
  const fallback = { all_open: open.length, mine: open.filter(item => item.assignee_id === meId).length,
    unassigned: open.filter(item => !hasIncidentAssignee(item)).length, urgent: open.filter(item => item.priority === 'urgent').length };
  const keys = ['all_open', 'mine', 'unassigned', 'urgent'];
  const complete = keys.every(key => Number.isSafeInteger(server?.[key]) && server[key] >= 0);
  return { ...Object.fromEntries(keys.map(key => [key, Number.isSafeInteger(server?.[key]) && server[key] >= 0 ? server[key] : fallback[key]])), scope: complete ? 'query' : 'page' };
}
export function inboxResultLabel(data) {
  const shown = data.incidents?.length || 0, page = data.pages?.incidents;
  if (Number.isSafeInteger(page?.total) && page.total >= shown && Number.isSafeInteger(page.page) && page.page >= 0
    && Number.isSafeInteger(page.limit) && page.limit > 0) {
    if (!shown) return `0 de ${page.total} tickets`;
    const first = page.page * page.limit + 1, last = first + shown - 1;
    if (last <= page.total) return `${first}–${last} de ${page.total} tickets`;
  }
  return `${shown} ${shown === 1 ? 'ticket en esta página' : 'tickets en esta página'}`;
}
