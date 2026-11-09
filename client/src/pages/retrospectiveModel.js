const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
const text = value => typeof value === 'string' ? value : '';

export function retrospectiveDateKey(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : '';
  }
  if (value === null || value === undefined || value === '') return '';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : '';
}

export function formatRetrospectiveDate(value) {
  const day = retrospectiveDateKey(value);
  return day ? new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Madrid' }).format(new Date(`${day}T12:00:00Z`)) : 'Sin fecha';
}

export function safeRetrospectiveLink(value) {
  if (typeof value !== 'string' || value.length > 1000 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function retrospectiveItemAuthor(item) {
  return item?.anonymous ? 'Anónimo' : text(item?.author?.name) || 'Miembro del staff';
}

export function filterRetrospectiveItems(items, { query = '', area = '', severity = '', includeArchived = false, mine = false, mineIds = [] } = {}, viewerId) {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const claims = new Set(mineIds.map(String));
  return (Array.isArray(items) ? items : []).filter(item =>
    (includeArchived || !item.archived) && (!area || item.area === area) && (!severity || item.severity === severity)
    && (!mine || claims.has(String(item.id)) || !item.anonymous && String(item.author?.id) === String(viewerId))
    && terms.every(term => normalize(`${item.title} ${item.description} ${item.proposal} ${item.area}`).includes(term)),
  ).sort((a, b) => Number(b.votes || 0) - Number(a.votes || 0) || text(a.title).localeCompare(text(b.title), 'es'));
}

export function retrospectiveActionOverdue(action, today = new Date().toISOString().slice(0, 10)) {
  const day = retrospectiveDateKey(action?.dueDate);
  return Boolean(day && day < today && action?.status !== 'done');
}

const idPart = value => /^[A-Za-z0-9_-]{1,128}$/.test(String(value ?? '')) ? String(value) : null;
const editKeyValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(value);

export function retrospectiveOwnershipKey(userId, retrospectiveId, itemId) {
  const parts = [userId, retrospectiveId, itemId].map(idPart);
  return parts.every(Boolean) ? `ctp-retro-edit:v1:${parts.join(':')}` : null;
}

export function readRetrospectiveEditKey(storage, userId, retrospectiveId, itemId) {
  try {
    const key = retrospectiveOwnershipKey(userId, retrospectiveId, itemId);
    const value = key ? storage?.getItem(key) : null;
    return editKeyValid(value) ? value : null;
  } catch { return null; }
}

export function storeRetrospectiveEditKey(storage, userId, retrospectiveId, itemId, value) {
  try {
    const key = retrospectiveOwnershipKey(userId, retrospectiveId, itemId);
    if (!key || !editKeyValid(value) || !storage) return false;
    storage.setItem(key, value);
    return true;
  } catch { return false; }
}

/** A closed, portable export: ownership claims and private actor/voter fields never leave the browser. */
export function retrospectiveExportDocument(detail) {
  const session = detail?.retrospective || {};
  const author = value => value?.anonymous ? null : text(value?.author?.name) || null;
  const date = value => value?.anonymous ? retrospectiveDateKey(value.createdAt) : value?.createdAt ?? null;
  return {
    schemaVersion: 1,
    retrospective: {
      title: text(session.title), eventName: text(session.eventName), eventDate: retrospectiveDateKey(session.eventDate),
      description: text(session.description), phase: text(session.phase), summary: text(session.summary),
    },
    items: (detail?.items || []).filter(item => !item.archived).map(item => ({
      kind: text(item.kind), area: text(item.area), severity: text(item.severity), title: text(item.title),
      description: text(item.description), proposal: text(item.proposal), evidenceUrl: safeRetrospectiveLink(item.evidenceUrl),
      anonymous: Boolean(item.anonymous), author: author(item), createdAt: date(item), votes: Number(item.votes || 0),
      archived: Boolean(item.archived), comments: (item.comments || []).map(comment => ({
        text: text(comment.text), anonymous: Boolean(comment.anonymous), author: author(comment), createdAt: date(comment),
      })),
    })),
    actions: (detail?.actions || []).map(action => ({
      title: text(action.title), description: text(action.description), owner: text(action.owner?.name) || null,
      dueDate: retrospectiveDateKey(action.dueDate), status: text(action.status), priority: text(action.priority),
    })),
  };
}

export function retrospectiveExportName(title) {
  const slug = normalize(title).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72);
  return `retrospectiva-${slug || 'ctp'}.json`;
}
