import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, History, RotateCcw, Save } from 'lucide-react';
import { useApp, useData } from '../context.jsx';
import { Spinner } from '../components/ui.jsx';
import { Badge, DataTable } from '../operations/ui.jsx';
import { dateTime } from '../operations/model.js';
import { EmailEditor } from './EmailEditor.jsx';
import { TestSend } from './TestSend.jsx';
import { htmlIsEmpty, textToHtml } from './sanitize.js';
import { LOCALES, crm, localeName, templateFamily, templateName, templateTags } from './model.js';

/** Todos los correos transaccionales que envía CTP hoy, con sus personalizaciones. */
export function TemplatesView() {
  const { data, loading, error } = useData(() => crm('templates'), []);
  const items = data?.items || [];
  const groups = [...new Set(items.map(item => templateFamily(item.key)))];
  return <section className="op-card">
    <div className="op-section-title"><div><h2>Correos transaccionales</h2><p>{items.length} correos. Los avisos se envían por el worker de CTP; los de cuenta, por Supabase Auth.</p></div></div>
    {!data?.defaults_synced_at && data && <p className="op-notice">El worker de correo aún no ha publicado los textos por defecto. Se publican en su primera ejecución con el correo activado; mientras tanto puedes crear personalizaciones desde cero.</p>}
    {error && <p className="op-error" role="alert">{error.message}</p>}
    {loading && !data ? <Spinner /> : groups.map(group => <div key={group} className="crm-stack">
      <h3>{group}</h3>
      <DataTable rows={items.filter(item => templateFamily(item.key) === group).map(item => ({ ...item, id: item.key }))} columns={[
        { key: 'name', title: 'Correo', render: row => <Link to={`/crm/transaccionales/${encodeURIComponent(row.key)}`}><strong>{templateName(row.key)}</strong></Link> },
        { key: 'key', title: 'Identificador', render: row => <code>{row.key}</code> },
        { key: 'customized', title: 'Personalizado', render: row => row.customized?.length ? <div className="crm-tags">{row.customized.map(locale => <span key={locale} className="crm-tag active">{localeName(locale)}</span>)}</div> : <span className="muted">Texto por defecto</span> },
        { key: 'updated_at', title: 'Última edición', render: row => row.updated_at ? dateTime(row.updated_at) : '—' },
        { key: 'actions', title: '', render: row => <Link className="btn sm" to={`/crm/transaccionales/${encodeURIComponent(row.key)}`}>Editar</Link> },
      ]} />
    </div>)}
  </section>;
}

const initial = (override, def, key) => override ? { subject: override.subject, title: override.title, preheader: override.preheader, html: override.html, action_label: override.action_label, customized: true }
  : { subject: def?.subject || '', title: def?.title || '', preheader: '', html: textToHtml([def?.body, def?.security].filter(Boolean).join('\n\n')), action_label: def?.action || '', customized: false, fromDefault: Boolean(def), key };

export function TemplateEditor({ templateKey }) {
  const { toast } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [locale, setLocale] = useState('es');
  const [forms, setForms] = useState({});
  const [busy, setBusy] = useState(false);
  const auth = templateKey.startsWith('auth.');
  const load = async () => {
    try { const value = await crm('template', { key: templateKey }); setData(value); setForms(Object.fromEntries(LOCALES.map(([id]) => [id, initial(value.overrides[id], value.defaults[id], templateKey)]))); }
    catch (failure) { setError(failure.message); }
  };
  useEffect(() => { load(); }, [templateKey]);
  if (error) return <section className="op-card"><p className="op-error" role="alert">{error}</p><Link className="btn" to="/crm/transaccionales">Volver</Link></section>;
  if (!data) return <div className="op-loading"><Spinner />Cargando correo…</div>;
  const form = forms[locale];
  const def = data.defaults[locale];
  const set = patch => setForms(current => ({ ...current, [locale]: { ...current[locale], ...patch, dirty: true } }));
  const subject = auth ? (form.subject || def?.subject || templateName(templateKey)) : form.subject;
  const save = async () => {
    if (htmlIsEmpty(form.html) || !subject.trim()) { toast('El asunto y el contenido son obligatorios.', 'error'); return; }
    if (templateKey === 'auth.reauth' && (form.html.match(/\{\{\s*codigo\s*\}\}/g) || []).length !== 1) { toast('Incluye exactamente una vez la variable {{codigo}}.', 'error'); return; }
    setBusy(true);
    try { await crm('template.save', { key: templateKey, locale, content: { subject, title: form.title, preheader: form.preheader, html: form.html, action_label: form.action_label } }); toast(`Correo guardado en ${localeName(locale)}.`); await load(); }
    catch (failure) { toast(failure.message, 'error'); } finally { setBusy(false); }
  };
  const reset = async () => {
    if (!window.confirm(`¿Volver al texto por defecto en ${localeName(locale)}?`)) return;
    setBusy(true);
    try { await crm('template.reset', { key: templateKey, locale }); toast('Restablecido el texto por defecto.'); await load(); }
    catch (failure) { toast(failure.message, 'error'); } finally { setBusy(false); }
  };
  const revisions = (data.revisions || []).filter(item => item.locale === locale);
  return <div className="crm-stack">
    <header className="crm-row crm-head"><Link className="btn sm" to="/crm/transaccionales"><ArrowLeft size={14} />Transaccionales</Link><h2>{templateName(templateKey)}</h2><code>{templateKey}</code></header>
    {auth && <p className="op-notice">Supabase Auth envía este correo y conserva el enlace o código de seguridad original. Los cambios se aplican cuando Auth carga las plantillas dinámicas de CTP (<code>/api/communications/auth-templates/…</code>), y pueden tardar unos minutos en verse. El asunto se configura en Supabase Auth y aquí no se puede cambiar.</p>}
    <section className="op-card">
      <div className="crm-pills" role="tablist" aria-label="Idioma">{LOCALES.map(([id, title]) => <button key={id} type="button" role="tab" aria-selected={locale === id} className={locale === id ? 'active' : ''} onClick={() => setLocale(id)}>{title}{data.overrides[id] && <CheckCircle2 size={12} />}</button>)}</div>
      <div className="crm-row">{form.customized ? <Badge value="active">Personalizado · {dateTime(data.overrides[locale]?.updated_at)}{data.overrides[locale]?.updated_by_name ? ` · ${data.overrides[locale].updated_by_name}` : ''}</Badge> : <Badge value="pending">Texto por defecto</Badge>}{form.dirty && <span className="muted">Cambios sin guardar</span>}</div>
      {!def && !form.customized && <p className="op-notice">El texto por defecto todavía no está disponible. Escribe el contenido completo para personalizar este correo.</p>}
      <div className="op-form-grid">
        <label className="op-field"><span>Asunto</span><input value={form.subject} maxLength={200} disabled={auth} onChange={event => set({ subject: event.target.value })} /></label>
        <label className="op-field"><span>Texto de vista previa (preheader)</span><input value={form.preheader} maxLength={250} onChange={event => set({ preheader: event.target.value })} /></label>
        <label className="op-field"><span>Titular</span><input value={form.title} maxLength={200} onChange={event => set({ title: event.target.value })} /></label>
        {templateKey !== 'auth.reauth' && <label className="op-field"><span>Texto del botón</span><input value={form.action_label} maxLength={80} onChange={event => set({ action_label: event.target.value })} /><small>El destino lo pone CTP según el aviso o el enlace seguro de Auth.</small></label>}
      </div>
      <EmailEditor key={`${templateKey}:${locale}:${data.overrides[locale]?.updated_at || 'default'}`} value={form.html} onChange={html => set({ html })} mergeTags={templateTags(templateKey)}
        preview={{ subject: form.subject, title: form.title, preheader: form.preheader, action: templateKey === 'auth.reauth' ? '' : form.action_label, footer: def?.reason || 'Recibes este aviso por la actividad de tu cuenta en CTP.' }} />
      {templateKey === 'auth.reauth' && <p className="muted crm-hint">Inserta la variable {'{{codigo}}'} donde deba aparecer el código de verificación.</p>}
      <div className="op-actions"><button className="btn primary" disabled={busy} onClick={save}>{busy ? <Spinner size={14} /> : <Save size={16} />}Guardar en {localeName(locale)}</button>{form.customized && <button className="btn" disabled={busy} onClick={reset}><RotateCcw size={14} />Volver al texto por defecto</button>}</div>
      <TestSend kind="template" templateKey={templateKey} locale={locale} content={() => ({ subject: subject || templateName(templateKey), title: form.title, preheader: form.preheader, html: form.html, action_label: form.action_label })}
        note={auth ? 'La prueba usa un enlace de ejemplo y el código 123456; no concede acceso.' : 'La prueba usa tus datos de usuario para las variables.'} />
    </section>
    {revisions.length > 0 && <section className="op-card"><h3><History size={16} /> Historial en {localeName(locale)}</h3><ol className="op-timeline">{revisions.map(item => <li key={item.id}><strong>{item.actor_name || 'CTP'} <span>{item.operation === 'reset' ? 'restableció el texto por defecto' : 'guardó cambios'}</span></strong><small>{dateTime(item.created_at)}</small>{item.content && <button type="button" className="btn sm" onClick={() => set({ subject: item.content.subject, title: item.content.title, preheader: item.content.preheader, html: item.content.html, action_label: item.content.action_label })}>Cargar esta versión</button>}</li>)}</ol></section>}
  </div>;
}
