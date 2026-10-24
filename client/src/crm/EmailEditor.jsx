import { useEffect, useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, Code2, Eye, Heading2, Heading3, ImagePlus, Italic, Link2, List, ListOrdered, Minus, MousePointerClick, Monitor, Pilcrow, Quote, Redo2, RemoveFormatting, Smartphone, Strikethrough, Underline, Undo2, Unlink, Type } from 'lucide-react';
import { api } from '../api.js';
import { Spinner } from '../components/ui.jsx';
import { previewDocument, safeUrl, sanitizeHtml } from './sanitize.js';

// Mismo botón que el marco oscuro de CTP.
const BUTTON_STYLE = 'display:inline-block;background-color:#FED602;color:#101114;padding:17px 30px;font-size:14px;line-height:20px;font-weight:800;letter-spacing:1px;text-transform:uppercase;text-decoration:none;border-radius:6px';

/**
 * Editor de correo con modo visual, código HTML y vista previa. Cualquier
 * HTML que entra (pegado, modo código, carga inicial) se sanea antes de
 * insertarse en el documento del Manager.
 */
export function EmailEditor({ value, onChange, mergeTags = [], preview, label = 'Contenido del correo', readOnly = false }) {
  const [mode, setMode] = useState(readOnly && preview ? 'preview' : 'visual');
  const [device, setDevice] = useState('desktop');
  const [source, setSource] = useState(value || '');
  const [dialog, setDialog] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const editor = useRef(null);
  const emitted = useRef(null);
  const selection = useRef(null);
  const fileInput = useRef(null);

  // Sincroniza el contenido externo (cambio de idioma/variante) sin mover el cursor al escribir.
  useEffect(() => {
    if (value === emitted.current) return;
    if (mode === 'visual' && editor.current) editor.current.innerHTML = sanitizeHtml(value || '');
    setSource(value || '');
  }, [value, mode]);
  useEffect(() => { if (mode === 'visual' && editor.current) editor.current.innerHTML = sanitizeHtml(source || ''); }, [mode]);

  const emit = html => { emitted.current = html; onChange(html); };
  const sync = () => { if (editor.current) emit(editor.current.innerHTML); };
  const remember = () => { const current = window.getSelection(); if (current?.rangeCount && editor.current?.contains(current.anchorNode)) selection.current = current.getRangeAt(0).cloneRange(); };
  const restore = () => { editor.current?.focus(); const current = window.getSelection(); if (selection.current && current) { current.removeAllRanges(); current.addRange(selection.current); } };
  const command = (name, argument = null) => { restore(); document.execCommand(name, false, argument); sync(); remember(); };
  const insert = html => { restore(); document.execCommand('insertHTML', false, sanitizeHtml(html)); sync(); };
  const switchMode = next => {
    if (next === mode) return;
    if (mode === 'html') { const clean = sanitizeHtml(source); setSource(clean); emit(clean); }
    if (mode === 'visual' && editor.current) { const html = editor.current.innerHTML; setSource(html); emit(html); }
    setMode(next);
  };
  const paste = event => {
    const html = event.clipboardData.getData('text/html'), text = event.clipboardData.getData('text/plain');
    event.preventDefault();
    if (html) document.execCommand('insertHTML', false, sanitizeHtml(html));
    else document.execCommand('insertText', false, text);
    sync();
  };
  const upload = async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setError('');
    if (file.size > 2 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setError('Usa una imagen PNG, JPG o WebP de hasta 2 MB.'); return; }
    setUploading(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('No se ha podido leer la imagen.')); reader.readAsDataURL(file); });
      const result = await api.post('/administration/images', { bucket: 'email-images', content_type: file.type, base64: String(dataUrl).split(',')[1], request_id: crypto.randomUUID() });
      const url = safeUrl(result.url);
      if (!url) throw new Error('CTP no ha confirmado la imagen.');
      setDialog({ type: 'image', url, alt: '', width: '' });
    } catch (failure) { setError(failure.message); } finally { setUploading(false); }
  };
  const apply = () => {
    const d = dialog; setDialog(null);
    if (d.type === 'link') { const url = safeUrl(d.url, { link: true }); if (!url) { setError('El enlace debe empezar por https:// o mailto:.'); return; } if (d.text) insert(`<a href="${url}" target="_blank">${escape(d.text)}</a>`); else command('createLink', url); }
    if (d.type === 'button') { const url = safeUrl(d.url, { link: true }); if (!url || !d.text) { setError('El botón necesita texto y un enlace https://.'); return; } insert(`<p style="text-align:${d.align || 'left'}"><a href="${url}" target="_blank" style="${BUTTON_STYLE}">${escape(d.text)}</a></p>`); }
    if (d.type === 'image') { const url = safeUrl(d.url); if (!url) { setError('La imagen necesita una URL https://.'); return; } const width = /^\d{1,4}$/.test(d.width || '') ? ` width="${d.width}"` : ''; const img = `<img src="${url}" alt="${escape(d.alt)}"${width} style="max-width:100%;height:auto;display:block;margin:0 auto">`; insert(d.href && safeUrl(d.href, { link: true }) ? `<a href="${safeUrl(d.href, { link: true })}" target="_blank">${img}</a>` : img); }
  };
  const tool = (title, Icon, run) => <button type="button" className="crm-tool" title={title} aria-label={title} onMouseDown={event => event.preventDefault()} onClick={run}><Icon size={15} /></button>;
  const frame = preview ? previewDocument({ ...preview, html: mode === 'html' ? source : value }) : null;

  return <div className="crm-editor">
    {!readOnly && <div className="crm-editor-modes" role="tablist" aria-label={label}>
      <button type="button" role="tab" aria-selected={mode === 'visual'} className={mode === 'visual' ? 'active' : ''} onClick={() => switchMode('visual')}><Type size={14} />Visual</button>
      <button type="button" role="tab" aria-selected={mode === 'html'} className={mode === 'html' ? 'active' : ''} onClick={() => switchMode('html')}><Code2 size={14} />HTML</button>
      {preview && <button type="button" role="tab" aria-selected={mode === 'preview'} className={mode === 'preview' ? 'active' : ''} onClick={() => switchMode('preview')}><Eye size={14} />Vista previa</button>}
    </div>}
    {mode === 'visual' && <>
      <div className="crm-toolbar" role="toolbar" aria-label="Formato">
        {tool('Deshacer', Undo2, () => command('undo'))}{tool('Rehacer', Redo2, () => command('redo'))}<span className="crm-sep" />
        {tool('Párrafo', Pilcrow, () => command('formatBlock', 'p'))}{tool('Título', Heading2, () => command('formatBlock', 'h2'))}{tool('Subtítulo', Heading3, () => command('formatBlock', 'h3'))}<span className="crm-sep" />
        {tool('Negrita', Bold, () => command('bold'))}{tool('Cursiva', Italic, () => command('italic'))}{tool('Subrayado', Underline, () => command('underline'))}{tool('Tachado', Strikethrough, () => command('strikeThrough'))}
        <label className="crm-tool crm-color" title="Color del texto"><input type="color" aria-label="Color del texto" defaultValue="#FFFFFF" onMouseDown={remember} onChange={event => command('foreColor', event.target.value)} /></label><span className="crm-sep" />
        {tool('Lista', List, () => command('insertUnorderedList'))}{tool('Lista numerada', ListOrdered, () => command('insertOrderedList'))}{tool('Cita', Quote, () => command('formatBlock', 'blockquote'))}<span className="crm-sep" />
        {tool('Alinear a la izquierda', AlignLeft, () => command('justifyLeft'))}{tool('Centrar', AlignCenter, () => command('justifyCenter'))}{tool('Alinear a la derecha', AlignRight, () => command('justifyRight'))}<span className="crm-sep" />
        {tool('Enlace', Link2, () => { remember(); setDialog({ type: 'link', url: 'https://', text: window.getSelection()?.toString() ? '' : '' }); })}{tool('Quitar enlace', Unlink, () => command('unlink'))}
        {tool('Botón', MousePointerClick, () => { remember(); setDialog({ type: 'button', url: 'https://', text: '', align: 'center' }); })}
        {tool('Imagen', ImagePlus, () => { remember(); setDialog({ type: 'image', url: '', alt: '', width: '' }); })}
        {tool('Separador', Minus, () => command('insertHorizontalRule'))}{tool('Quitar formato', RemoveFormatting, () => command('removeFormat'))}
        {mergeTags.length > 0 && <select className="crm-merge" aria-label="Insertar variable" value="" onMouseDown={remember} onChange={event => { if (event.target.value) { restore(); document.execCommand('insertText', false, `{{${event.target.value}}}`); sync(); } }}><option value="">Variable…</option>{mergeTags.map(tag => <option key={tag.tag} value={tag.tag}>{tag.label}</option>)}</select>}
      </div>
      {dialog && <div className="crm-inline-dialog" role="dialog" aria-label={dialog.type === 'image' ? 'Insertar imagen' : dialog.type === 'button' ? 'Insertar botón' : 'Insertar enlace'}>
        {dialog.type === 'image' && <div className="crm-row"><button type="button" className="btn sm" disabled={uploading} onClick={() => fileInput.current?.click()}>{uploading ? <Spinner size={14} /> : <ImagePlus size={14} />}Subir imagen</button><span className="muted">o pega una URL https://</span></div>}
        <div className="op-form-grid">
          <label className="op-field"><span>{dialog.type === 'image' ? 'URL de la imagen' : 'Enlace'}</span><input value={dialog.url} onChange={event => setDialog({ ...dialog, url: event.target.value })} placeholder="https://" /></label>
          {dialog.type === 'image' ? <label className="op-field"><span>Texto alternativo</span><input value={dialog.alt} maxLength={200} onChange={event => setDialog({ ...dialog, alt: event.target.value })} /></label>
            : <label className="op-field"><span>{dialog.type === 'button' ? 'Texto del botón' : 'Texto (opcional)'}</span><input value={dialog.text} maxLength={120} onChange={event => setDialog({ ...dialog, text: event.target.value })} /></label>}
          {dialog.type === 'image' && <><label className="op-field"><span>Ancho en px (opcional)</span><input value={dialog.width} inputMode="numeric" onChange={event => setDialog({ ...dialog, width: event.target.value })} /></label><label className="op-field"><span>Enlace al pulsar (opcional)</span><input value={dialog.href || ''} onChange={event => setDialog({ ...dialog, href: event.target.value })} placeholder="https://" /></label></>}
          {dialog.type === 'button' && <label className="op-field"><span>Alineación</span><select value={dialog.align} onChange={event => setDialog({ ...dialog, align: event.target.value })}><option value="left">Izquierda</option><option value="center">Centro</option><option value="right">Derecha</option></select></label>}
        </div>
        {dialog.type === 'image' && safeUrl(dialog.url) && <img className="crm-image-preview" src={safeUrl(dialog.url)} alt="" />}
        <div className="op-actions"><button type="button" className="btn primary sm" onClick={apply}>Insertar</button><button type="button" className="btn sm" onClick={() => setDialog(null)}>Cancelar</button></div>
      </div>}
      <input ref={fileInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={upload} />
      <div ref={editor} className="crm-canvas" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={label}
        onInput={sync} onBlur={() => { remember(); sync(); }} onKeyUp={remember} onMouseUp={remember} onPaste={paste} />
    </>}
    {mode === 'html' && <textarea className="crm-source" spellCheck={false} aria-label={`${label} en HTML`} value={source} onChange={event => { setSource(event.target.value); emit(event.target.value); }} />}
    {mode === 'html' && <p className="muted crm-hint">Se eliminan scripts, formularios, estilos externos y enlaces no seguros al volver al modo visual y al enviar.</p>}
    {mode === 'preview' && frame && <>
      <div className="crm-row"><button type="button" className={`btn sm ${device === 'desktop' ? 'primary' : ''}`} onClick={() => setDevice('desktop')}><Monitor size={14} />Escritorio</button><button type="button" className={`btn sm ${device === 'mobile' ? 'primary' : ''}`} onClick={() => setDevice('mobile')}><Smartphone size={14} />Móvil</button><span className="muted">Vista aproximada. Usa «Enviar prueba» para ver el correo real.</span></div>
      <iframe title="Vista previa del correo" className={`crm-preview ${device}`} sandbox="" srcDoc={frame} />
    </>}
    {error && <p className="op-error" role="alert">{error}</p>}
  </div>;
}
function escape(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char])); }
