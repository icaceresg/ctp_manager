// Canonical HTML can expand entities beyond the source editor's input limit.
const MAX_HTML = 65536;
/** Match public visibility: empty formatting is not a communication. */
export function hasMeaningfulCanonicalHtml(html) {
  return /<img\s[^>]*\bsrc=/i.test(html) || !!String(html || '').replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#(?:160|x0*a0);/gi, '').replace(/[\s\u200b\u200c\u200d\u2060\ufeff]/g, '');
}
export function siteNoticeState(value) {
  if (!value || value.schema_version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1
    || typeof value.enabled !== 'boolean' || typeof value.title !== 'string' || value.title.length > 120
    || typeof value.html !== 'string' || value.html.length > MAX_HTML) throw new Error('CTP no ha confirmado el aviso.');
  return { schema_version: 1, revision: value.revision, enabled: value.enabled, title: value.title, html: value.html };
}
export const noticeDraft = state => ({ enabled: state.enabled, title: state.title, html: state.html });
export const sameNoticeDraft = (a, b) => !!a && !!b && a.enabled === b.enabled && a.title === b.title && a.html === b.html;
export function siteNoticeAttempt(pending, snapshot, draft, uuid = () => crypto.randomUUID()) {
  siteNoticeState({ ...snapshot, ...draft });
  if (pending) {
    if (pending.expected_revision !== snapshot.revision || !sameNoticeDraft(pending, draft)) throw new Error('Primero confirma el intento pendiente.');
    return pending;
  }
  return { action: 'save', expected_revision: snapshot.revision, request_id: uuid(), ...noticeDraft(draft) };
}
export function siteNoticeError(error) {
  if (error?.status === 409) return 'Otra persona ha actualizado este aviso. Actualiza y revisa los cambios antes de guardar.';
  if (error?.status === 401 || error?.status === 403) return 'Necesitas una sesión de administración vigente para editar este aviso.';
  if (error?.status === 400 || error?.status === 422) return 'Revisa el HTML y los límites del aviso. Sólo se admiten formato, enlaces seguros e imágenes de CTP.';
  return 'No se ha podido confirmar la operación. Puedes reintentar sin duplicar el cambio.';
}
