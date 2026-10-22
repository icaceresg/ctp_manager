import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarClock, CheckCircle2, Copy, Save, Send, Trash2 } from 'lucide-react';
import { useApp } from '../context.jsx';
import { Spinner } from '../components/ui.jsx';
import { Badge } from '../operations/ui.jsx';
import { dateTime } from '../operations/model.js';
import { AudienceFilters } from './AudienceFilters.jsx';
import { useDebounced } from './ContactsView.jsx';
import { EmailEditor } from './EmailEditor.jsx';
import { TestSend } from './TestSend.jsx';
import { CampaignReport } from './CampaignReport.jsx';
import { htmlIsEmpty } from './sanitize.js';
import { AB_MODES, CAMPAIGN_STATES, CAMPAIGN_TAGS, EMPTY_FILTERS, LOCALES, blankContent, compactFilters, crm, localeName } from './model.js';

const filled = content => Boolean(content && (content.subject?.trim() || !htmlIsEmpty(content.html)));
function fromCampaign(campaign) {
  return { name: campaign.name, link: campaign.link || '', default_locale: campaign.default_locale, ab_mode: campaign.ab_mode, ab_test_percent: campaign.ab_test_percent,
    filters: { ...EMPTY_FILTERS, ...campaign.filters }, variants: { A: { ...(campaign.variants?.A || {}) }, B: { ...(campaign.variants?.B || {}) } } };
}
const NEW = { name: '', link: '', default_locale: 'es', ab_mode: 'none', ab_test_percent: 20, filters: { ...EMPTY_FILTERS, consent: 'opted_in' }, variants: { A: {}, B: {} } };
const localInput = date => { const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };

export function CampaignEditor({ id }) {
  const isNew = id === 'nueva';
  const { toast } = useApp();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState(null);
  const [draft, setDraft] = useState(isNew ? NEW : null);
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [variant, setVariant] = useState('A');
  const [locale, setLocale] = useState('es');
  const [saving, setSaving] = useState(false);
  const [segments, setSegments] = useState([]);
  const [audience, setAudience] = useState(null);
  const [when, setWhen] = useState('now');
  const [scheduledAt, setScheduledAt] = useState(() => localInput(new Date(Date.now() + 3600000)));
  const [confirmed, setConfirmed] = useState(false);
  const [scheduling, setScheduling] = useState(false);

  const load = async () => {
    if (isNew) return;
    try { const value = await crm('campaign', { id }); setCampaign(value); setDraft(fromCampaign(value)); setLocale(value.default_locale); setDirty(false); }
    catch (failure) { setLoadError(failure.message); }
  };
  useEffect(() => { load(); crm('segments').then(value => setSegments(value.items || [])).catch(() => {}); }, [id]);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const filtersKey = JSON.stringify(compactFilters(useDebounced(draft?.filters || {})));
  useEffect(() => {
    if (!draft) return;
    let current = true;
    crm('audience', { filters: JSON.parse(filtersKey) }).then(value => { if (current) setAudience(value); }).catch(() => { if (current) setAudience(null); });
    return () => { current = false; };
  }, [filtersKey, Boolean(draft)]);

  const variants = draft?.ab_mode === 'none' ? ['A'] : ['A', 'B'];
  const content = draft?.variants?.[variant]?.[locale] || blankContent();
  const update = patch => { setDraft(current => ({ ...current, ...patch })); setDirty(true); };
  const updateContent = patch => { setDraft(current => ({ ...current, variants: { ...current.variants, [variant]: { ...current.variants[variant], [locale]: { ...blankContent(), ...current.variants[variant]?.[locale], ...patch } } } })); setDirty(true); };
  const removeLocale = () => { setDraft(current => { const next = { ...current.variants[variant] }; delete next[locale]; return { ...current, variants: { ...current.variants, [variant]: next } }; }); setDirty(true); };
  const copyFrom = (fromVariant, fromLocale) => { const source = draft.variants[fromVariant]?.[fromLocale]; if (source) updateContent({ ...source }); };
  const readOnly = Boolean(campaign && campaign.state !== 'draft');
  const missing = useMemo(() => draft ? variants.filter(v => !filled(draft.variants[v]?.[draft.default_locale])) : [], [draft, variants.join()]);

  const payload = () => {
    const out = {};
    for (const v of variants) out[v] = Object.fromEntries(Object.entries(draft.variants[v] || {}).filter(([, value]) => filled(value)).map(([key, value]) => [key, { subject: value.subject || '', title: value.title || '', preheader: value.preheader || '', html: value.html || '' }]));
    return { ...(campaign ? { id: campaign.id, expected_version: campaign.version } : {}), name: draft.name.trim(), link: draft.link.trim() || null, default_locale: draft.default_locale,
      ab_mode: draft.ab_mode, ab_test_percent: Number(draft.ab_test_percent), filters: compactFilters({ ...draft.filters, consent: 'any' }), variants: out };
  };
  const save = async () => {
    if (!draft.name.trim()) { toast('Pon un nombre a la campaña.', 'error'); return; }
    if (missing.length) { toast(`Completa el idioma por defecto (${localeName(draft.default_locale)}) en la variante ${missing.join(' y ')}.`, 'error'); return; }
    setSaving(true);
    try {
      const value = await crm('campaign.save', payload());
      setCampaign(value); setDraft(fromCampaign(value)); setDirty(false); toast('Campaña guardada.');
      if (isNew) navigate(`/crm/campanas/${value.id}`, { replace: true });
    } catch (failure) { toast(failure.message, 'error'); } finally { setSaving(false); }
  };
  const schedule = async () => {
    if (!campaign || dirty || !confirmed) return;
    const at = when === 'later' ? new Date(scheduledAt) : null;
    if (at && (!Number.isFinite(at.getTime()) || at.getTime() < Date.now() - 60000)) { toast('Elige una fecha y hora futuras.', 'error'); return; }
    setScheduling(true);
    try {
      const value = await crm('campaign.schedule', { id: campaign.id, confirm_id: campaign.id, expected_version: campaign.version, scheduled_at: at ? at.toISOString() : null });
      toast(at ? `Campaña programada para ${dateTime(value.scheduled_at)}.` : `Campaña en marcha: ${value.queued ?? 0} correos en cola.`);
      setConfirmed(false); await load();
    } catch (failure) { toast(failure.message, 'error'); } finally { setScheduling(false); }
  };

  if (loadError) return <section className="op-card"><p className="op-error" role="alert">{loadError}</p><Link className="btn" to="/crm/campanas">Volver a campañas</Link></section>;
  if (!draft) return <div className="op-loading"><Spinner />Cargando campaña…</div>;
  const reachable = audience?.reachable;
  return <div className="crm-stack">
    <header className="crm-row crm-head"><Link className="btn sm" to="/crm/campanas"><ArrowLeft size={14} />Campañas</Link><h2>{isNew ? 'Nueva campaña' : draft.name || 'Campaña'}</h2>{campaign && <Badge value={campaign.state === 'draft' ? 'pending' : campaign.state === 'sent' ? 'approved' : 'in_progress'}>{CAMPAIGN_STATES[campaign.state]}</Badge>}{dirty && <span className="muted">Cambios sin guardar</span>}</header>
    {readOnly && <CampaignReport campaign={campaign} onChanged={load} />}
    <section className="op-card">
      <h3>1 · Datos y audiencia</h3>
      <fieldset disabled={readOnly} className="crm-fieldset">
        <div className="op-form-grid">
          <label className="op-field"><span>Nombre interno</span><input value={draft.name} maxLength={150} onChange={event => update({ name: event.target.value })} placeholder="Ej.: Lanzamiento Season 2" /></label>
          <label className="op-field"><span>Botón principal hacia CTP (opcional)</span><input value={draft.link} maxLength={512} onChange={event => update({ link: event.target.value })} placeholder="/tournaments" /><small>Ruta interna de CTP; se abre en el idioma de cada persona. Vacío: sin botón.</small></label>
        </div>
        {segments.length > 0 && <label className="op-field"><span>Partir de un segmento</span><select value="" onChange={event => { const segment = segments.find(item => item.id === event.target.value); if (segment) update({ filters: { ...EMPTY_FILTERS, ...segment.filters, consent: 'opted_in' } }); }}><option value="">Seleccionar segmento…</option>{segments.map(segment => <option key={segment.id} value={segment.id}>{segment.name}</option>)}</select></label>}
        <AudienceFilters value={draft.filters} onChange={filters => update({ filters })} lockConsent compact />
      </fieldset>
      <div className="crm-audience" role="status">{audience ? <><strong>{reachable}</strong> personas recibirán la campaña{audience.by_locale && Object.keys(audience.by_locale).length > 0 && <span className="muted"> · {Object.entries(audience.by_locale).map(([key, value]) => `${localeName(key)}: ${value}`).join(' · ')}</span>}</> : <span className="muted">Calculando audiencia…</span>}</div>
    </section>
    <section className="op-card">
      <h3>2 · Idiomas y prueba A/B</h3>
      <fieldset disabled={readOnly} className="crm-fieldset">
        <div className="op-form-grid">
          <label className="op-field"><span>Idioma por defecto</span><select value={draft.default_locale} onChange={event => update({ default_locale: event.target.value })}>{LOCALES.map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select><small>Cada persona recibe su idioma; si falta esa traducción, recibe el idioma por defecto.</small></label>
          <label className="op-field"><span>Prueba A/B</span><select value={draft.ab_mode} onChange={event => { update({ ab_mode: event.target.value }); if (event.target.value === 'none') setVariant('A'); }}>{Object.entries(AB_MODES).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>
        </div>
        {draft.ab_mode === 'winner' && <label className="op-field"><span>Grupo de prueba: {draft.ab_test_percent} % de la audiencia (mitad A, mitad B)</span><input type="range" min="2" max="90" value={draft.ab_test_percent} onChange={event => update({ ab_test_percent: Number(event.target.value) })} /><small>Tras revisar aperturas y clics, eliges la ganadora y se envía al resto.</small></label>}
      </fieldset>
    </section>
    <section className="op-card">
      <h3>3 · Contenido</h3>
      {variants.length > 1 && <div className="crm-pills" role="tablist" aria-label="Variante">{variants.map(v => <button key={v} type="button" role="tab" aria-selected={variant === v} className={variant === v ? 'active' : ''} onClick={() => setVariant(v)}>Variante {v}{filled(draft.variants[v]?.[draft.default_locale]) && <CheckCircle2 size={12} />}</button>)}</div>}
      <div className="crm-pills" role="tablist" aria-label="Idioma">{LOCALES.map(([key, title]) => <button key={key} type="button" role="tab" aria-selected={locale === key} className={locale === key ? 'active' : ''} onClick={() => setLocale(key)}>{title}{key === draft.default_locale && ' ★'}{filled(draft.variants[variant]?.[key]) && <CheckCircle2 size={12} />}</button>)}</div>
      {!filled(content) && locale !== draft.default_locale && <p className="op-notice">Sin traducción para {localeName(locale)}: estas personas recibirán la versión en {localeName(draft.default_locale)}.</p>}
      <fieldset disabled={readOnly} className="crm-fieldset">
        <div className="crm-row">
          {locale !== draft.default_locale && filled(draft.variants[variant]?.[draft.default_locale]) && <button type="button" className="btn sm" onClick={() => copyFrom(variant, draft.default_locale)}><Copy size={14} />Copiar desde {localeName(draft.default_locale)}</button>}
          {variant === 'B' && filled(draft.variants.A?.[locale]) && <button type="button" className="btn sm" onClick={() => copyFrom('A', locale)}><Copy size={14} />Copiar desde la variante A</button>}
          {filled(content) && locale !== draft.default_locale && <button type="button" className="btn sm danger" onClick={removeLocale}><Trash2 size={14} />Quitar este idioma</button>}
        </div>
        <div className="op-form-grid">
          <label className="op-field"><span>Asunto</span><input value={content.subject} maxLength={200} onChange={event => updateContent({ subject: event.target.value })} placeholder="Puedes usar {{username}}" /></label>
          <label className="op-field"><span>Texto de vista previa (preheader)</span><input value={content.preheader} maxLength={250} onChange={event => updateContent({ preheader: event.target.value })} /></label>
        </div>
        <label className="op-field"><span>Titular del correo (opcional)</span><input value={content.title} maxLength={200} onChange={event => updateContent({ title: event.target.value })} /></label>
      </fieldset>
      <EmailEditor key={`${variant}:${locale}:${readOnly}`} readOnly={readOnly} value={content.html} onChange={html => !readOnly && updateContent({ html })} mergeTags={CAMPAIGN_TAGS}
        preview={{ subject: content.subject, title: content.title, preheader: content.preheader, action: draft.link ? 'Ver en CTP' : '', footer: 'Recibes novedades de CTP porque has aceptado nuestras comunicaciones comerciales.', unsubscribe: true }} />
      <TestSend kind="campaign" locale={locale} link={draft.link.trim() || null} content={() => ({ subject: content.subject, title: content.title, preheader: content.preheader, html: content.html })}
        note={`Se envía la variante ${variant} en ${localeName(locale)} tal como está ahora, sin guardar ni seguimiento.`} />
    </section>
    {!readOnly && <section className="op-card">
      <h3>4 · Guardar y enviar</h3>
      <div className="op-actions"><button className="btn primary" disabled={saving} onClick={save}>{saving ? <Spinner size={14} /> : <Save size={16} />}Guardar borrador</button></div>
      {campaign && <div className="crm-send">
        <div className="crm-row" role="radiogroup" aria-label="Momento del envío">
          <label className="op-check"><input type="radio" name="when" checked={when === 'now'} onChange={() => setWhen('now')} />Enviar ahora</label>
          <label className="op-check"><input type="radio" name="when" checked={when === 'later'} onChange={() => setWhen('later')} />Programar</label>
          {when === 'later' && <input type="datetime-local" aria-label="Fecha y hora de envío" value={scheduledAt} min={localInput(new Date())} onChange={event => setScheduledAt(event.target.value)} />}
        </div>
        {dirty && <p className="op-notice">Guarda los cambios antes de enviar o programar.</p>}
        <label className="op-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />He revisado el contenido y las pruebas, y confirmo el envío a {reachable ?? '…'} personas con correos promocionales aceptados{draft.ab_mode === 'winner' ? ' (primero al grupo de prueba)' : ''}.</label>
        <button className="btn primary" disabled={!confirmed || dirty || scheduling || !reachable} onClick={schedule}>{scheduling ? <Spinner size={14} /> : when === 'later' ? <CalendarClock size={16} /> : <Send size={16} />}{when === 'later' ? 'Programar envío' : 'Enviar campaña'}</button>
      </div>}
      {!campaign && <p className="muted">Guarda el borrador para poder enviarlo o programarlo.</p>}
    </section>}
  </div>;
}
