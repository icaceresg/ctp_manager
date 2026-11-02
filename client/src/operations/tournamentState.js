/** Shared with publication: a public tournament can still have a closed window. */
export function tournamentState(t, now = Date.now()) {
  if (t.status === 'borrador' || t.visible === false) return { key: 'hidden', label: 'Oculto' };
  if (t.status !== 'inscripcion_abierta') return { key: t.status, label: ({ en_curso: 'En curso', finalizado: 'Finalizado', cancelado: 'Cancelado' })[t.status] || t.status };
  const closes = Date.parse(t.registration_close_at);
  const opens = t.registration_open_at ? Date.parse(t.registration_open_at) : -Infinity;
  const open = now < closes && now >= opens;
  return open ? { key: 'open', label: 'Publicado · inscripción abierta' }
    : { key: 'published', label: 'Publicado · inscripción cerrada' };
}
