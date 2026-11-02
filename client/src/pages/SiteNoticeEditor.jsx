import { useCallback, useEffect, useRef, useState } from 'react';
import { Code2, Eye, EyeOff, Megaphone, Monitor, RefreshCw, Save, Smartphone } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { noticeDraft, sameNoticeDraft, siteNoticeAttempt, siteNoticeError, siteNoticeState } from './siteNoticeModel.js';
import { noticePreviewOrigin, siteNoticeDocument } from './siteNoticeDocument.js';
import './site-notice.css';

export function SiteNoticePreview({ notice, mobile, origin }) {
  if (!notice) return <p className="muted sn-preview-empty">Pulsa «Vista previa» para revisar el HTML saneado que mostrará CTP.</p>;
  if (!notice.html.trim()) return <p className="muted sn-preview-empty">El contenido está vacío: el aviso permanecerá oculto.</p>;
  return <div className={`sn-preview-stage${mobile ? ' is-mobile' : ''}`}>
    <div className="sn-preview-card"><div className="sn-preview-heading"><h3>{notice.title || 'Novedades de CTP'}</h3><span aria-hidden>×</span></div>
      <p className="sn-preview-label"><Megaphone size={14} />Comunidad · Competición</p>
      <iframe title="Vista previa del aviso emergente" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={siteNoticeDocument(notice.html, origin)} />
      <div className="sn-preview-footer"><span>Entendido</span></div>
    </div>
    {!notice.enabled && <p className="muted">Vista previa: el aviso está desactivado y no se mostrará en la web.</p>}
  </div>;
}

/** No editor, preview or API request is mounted for a non-admin actor. */
export default function SiteNoticeEditor() {
  const { me } = useApp();
  return me?.is_admin ? <SiteNoticeEditorBody key={me.id} /> : null;
}
export function SiteNoticeEditorBody({ client = api, origin }) {
  const [snapshot, setSnapshot] = useState(null), [draft, setDraft] = useState(null);
  const [preview, setPreview] = useState(null), [mobile, setMobile] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [uncertain, setUncertain] = useState(false), [needsRefresh, setNeedsRefresh] = useState(false);
  const pending = useRef(null), lock = useRef(false), mounted = useRef(false), serial = useRef(0);
  const refresh = useCallback(async () => {
    if (lock.current || pending.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = siteNoticeState(await client.get('/administration/site-notice'));
      if (!mounted.current) return;
      setSnapshot(result); setDraft(noticeDraft(result)); setPreview(null); setNeedsRefresh(false);
    } catch (problem) { if (mounted.current) { setSnapshot(null); setDraft(null); setError(siteNoticeError(problem)); } }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }, [client]);
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; serial.current++; }; }, [refresh]);
  const change = patch => { serial.current++; setDraft(value => ({ ...value, ...patch })); setPreview(null); setNotice(''); };
  const showPreview = async () => {
    if (lock.current || !draft || uncertain || needsRefresh) return;
    lock.current = true; setBusy(true); setError(''); const id = ++serial.current;
    try {
      const result = siteNoticeState(await client.post('/administration/site-notice', { action: 'preview', ...noticeDraft(draft) }));
      if (mounted.current && serial.current === id) setPreview(result);
    } catch (problem) { if (mounted.current && serial.current === id) setError(siteNoticeError(problem)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const save = async event => {
    event.preventDefault();
    if (lock.current || !snapshot || !draft || needsRefresh) return;
    let payload;
    try { payload = siteNoticeAttempt(pending.current, snapshot, draft); }
    catch { setError('Primero confirma el intento pendiente.'); return; }
    lock.current = true; pending.current = payload; setBusy(true); setError(''); setNotice('');
    try {
      const raw = await client.post('/administration/site-notice', payload), result = siteNoticeState(raw);
      if (!mounted.current) return;
      if (raw.request_id !== payload.request_id) throw new Error('Unconfirmed response');
      pending.current = null; setUncertain(false); setSnapshot(result); setDraft(noticeDraft(result)); setPreview(result);
      setNotice(result.enabled && result.html.trim() ? 'Aviso guardado y activado.' : 'Aviso guardado. Permanece oculto en CTP.');
    } catch (problem) {
      if (!mounted.current) return;
      setError(siteNoticeError(problem));
      if ([400, 401, 403, 409, 422].includes(problem.status)) { pending.current = null; setUncertain(false); setNeedsRefresh(true); }
      else setUncertain(true);
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const editable = !!draft && !busy && !uncertain && !needsRefresh;
  const changed = !!draft && !sameNoticeDraft(snapshot, draft);
  const assetOrigin = origin || (typeof window === 'undefined' ? 'https://playctp.com' : noticePreviewOrigin(window.location));
  return <section className="op-card sn-editor" aria-labelledby="sn-title">
    <header className="op-section-title"><div><h2 id="sn-title"><Megaphone size={20} /> Aviso emergente</h2><p>Comunica novedades o torneos dentro de CTP. Se puede cerrar y no aparece durante una partida.</p></div>
      <button type="button" className="btn" disabled={busy || uncertain} onClick={() => void refresh()}><RefreshCw size={15} />Actualizar aviso</button></header>
    {error && <p className="op-error" role="alert">{error}</p>}{notice && <p className="op-notice" role="status">{notice}</p>}
    {!snapshot || !draft ? <p className="muted" role="status">{busy ? 'Cargando aviso…' : 'Aviso no disponible. Actualiza para consultarlo.'}</p> : <form onSubmit={save}>
      <div className="sn-editor-status"><button type="button" className={`wp-toggle${draft.enabled ? ' is-on' : ''}`} role="switch" aria-checked={draft.enabled} disabled={!editable} onClick={() => change({ enabled: !draft.enabled })}>
        {draft.enabled ? <Eye size={15} /> : <EyeOff size={15} />}{draft.enabled ? 'Activado' : 'Desactivado'}</button><small className="muted">Revisión {snapshot.revision} · vacío o desactivado: oculto</small></div>
      <div className="sn-columns"><div className="sn-source">
        <label className="op-field"><span>Título (opcional)</span><input value={draft.title} maxLength={120} disabled={!editable} onChange={event => change({ title: event.target.value })} placeholder="Novedades de CTP" /></label>
        <label className="op-field"><span><Code2 size={14} />Contenido HTML</span><textarea value={draft.html} maxLength={65536} rows={16} spellCheck={false} disabled={!editable} onChange={event => change({ html: event.target.value })} placeholder="<h2>Próxima competición</h2><p>Consulta todos los detalles.</p>" /></label>
        <p className="muted sn-hint">Admite títulos, texto, listas, enlaces seguros e imágenes de CTP. Se eliminan scripts, estilos y contenido interactivo.</p>
        <button type="button" className="btn" disabled={!editable} onClick={() => void showPreview()}><Eye size={15} />Vista previa</button>
      </div><div className="sn-preview"><div className="sn-device-controls" role="group" aria-label="Tamaño de la vista previa"><button type="button" className={`btn sm${!mobile ? ' primary' : ''}`} aria-pressed={!mobile} onClick={() => setMobile(false)}><Monitor size={14} />Escritorio</button><button type="button" className={`btn sm${mobile ? ' primary' : ''}`} aria-pressed={mobile} onClick={() => setMobile(true)}><Smartphone size={14} />Móvil</button></div>
        <SiteNoticePreview notice={preview} mobile={mobile} origin={assetOrigin} />
      </div></div>
      {uncertain && <p className="wp-warn">El guardado no está confirmado. Reintenta la misma operación antes de editar.</p>}
      <div className="sn-save"><button type="submit" className="btn primary" disabled={busy || needsRefresh || !changed && !uncertain}><Save size={15} />{busy ? 'Consultando…' : uncertain ? 'Reintentar guardado' : 'Guardar aviso'}</button><span className="muted">Desactivarlo conserva el contenido para otra ocasión.</span></div>
    </form>}
  </section>;
}
