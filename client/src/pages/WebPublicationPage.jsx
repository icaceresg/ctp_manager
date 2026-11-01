import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, DoorOpen, Eye, EyeOff, Globe, Percent, RefreshCw, Save, Shield, ShoppingBag, Trophy, Undo2 } from 'lucide-react';
import { api } from '../api.js';
import { dateTime } from '../operations/model.js';
import {
  COUNTRY_LABELS, EMPTY_DRAFT, KIND_LABELS, STATUS_LABELS, bpsToPercent, canOpenRegistration, draftChanges, effective, euros, ossProgress,
  pendingCount, percentToBps, setClub, setEuRate, setSection, setTax, setTournament, tournamentToggleable,
} from './webPublicationModel.js';
import '../operations/operations.css';
import './web-publication.css';

const TABS = [
  { id: 'secciones', label: 'Secciones', icon: Globe },
  { id: 'equipos', label: 'Equipos del Team Pass', icon: Shield },
  { id: 'torneos', label: 'Torneos y calendario', icon: Trophy },
  { id: 'iva', label: 'Impuestos', icon: Percent },
];
const madrid = value => (value ? new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—');

function Toggle({ on, onChange, disabled, labelOn, labelOff, changed }) {
  return <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}
    className={`wp-toggle${on ? ' is-on' : ''}${changed ? ' is-changed' : ''}`}>
    {on ? <Eye size={15} aria-hidden /> : <EyeOff size={15} aria-hidden />}{on ? labelOn : labelOff}
  </button>;
}

function Sections({ snapshot, draft, setDraft }) {
  const rows = [
    { key: 'calendar', icon: CalendarDays, title: 'Calendario del circuito', text: 'Página /calendar. Muestra las fechas de los torneos publicados.' },
    { key: 'market', icon: ShoppingBag, title: 'Mercado de fichajes', text: 'Páginas /market y /market/fa (agentes libres).' },
  ];
  return <section className="op-card" aria-labelledby="wp-sections">
    <div className="op-section-title"><div><h2 id="wp-sections">Secciones de la web</h2><p>Lo que no está visible aparece en el menú como «Clasificado» y su URL lleva a la portada.</p></div></div>
    <ul className="wp-list">{rows.map(({ key, icon: Icon, title, text }) => {
      const on = effective.section(draft, snapshot, key);
      return <li key={key}><Icon size={20} aria-hidden /><div><strong>{title}</strong><small>{text}</small></div>
        <Toggle on={on} changed={key in draft.sections} labelOn="Visible" labelOff="Clasificado" onChange={value => setDraft(d => setSection(d, snapshot, key, value))} /></li>;
    })}</ul>
  </section>;
}

function Clubs({ snapshot, draft, setDraft }) {
  const hiddenCount = snapshot.clubs.filter(club => !effective.club(draft, club)).length;
  return <section className="op-card" aria-labelledby="wp-clubs">
    <div className="op-section-title"><div><h2 id="wp-clubs">Equipos del Team Pass</h2>
      <p>Un club oculto no aparece en /teams ni en su ficha, y los torneos que organiza se muestran con la imagen de CTP hasta anunciarlo. {hiddenCount} de {snapshot.clubs.length} ocultos.</p></div></div>
    {!snapshot.clubs.length ? <p className="muted">No hay clubes verificados del Team Pass en esta temporada.</p> :
      <ul className="wp-grid">{snapshot.clubs.map(club => {
        const on = effective.club(draft, club);
        return <li key={club.id} className={on ? '' : 'is-hidden'}>
          <div className="wp-club-name"><span className="wp-tag">{club.tag}</span><strong>{club.name}</strong></div>
          <small>{club.hosting.length ? `Anfitrión de ${club.hosting.map(h => h.name).join(', ')}` : 'Sin torneos como anfitrión'}</small>
          {club.announced_at && club.announced && <small>Anunciado el {madrid(club.announced_at)}</small>}
          <Toggle on={on} changed={club.id in draft.clubs} labelOn="Anunciado" labelOff="Oculto" onChange={value => setDraft(d => setClub(d, club, value))} />
        </li>;
      })}</ul>}
  </section>;
}

function Tournaments({ snapshot, draft, setDraft }) {
  const [scope, setScope] = useState('circuit');
  const list = snapshot.tournaments.filter(t => scope === 'all' || t.circuit_code);
  const openable = list.filter(t => effective.visible(draft, t) && canOpenRegistration(t) && !effective.openNow(draft, t));
  return <section className="op-card" aria-labelledby="wp-tournaments">
    <div className="op-section-title"><div><h2 id="wp-tournaments">Torneos y calendario</h2>
      <p>Un torneo publicado aparece en /tournaments y con su fecha en el calendario. Oculto vuelve a borrador: deja de verse, sin borrar inscripciones.</p></div>
      <div className="btn-row">
        <div className="wp-segmented" role="group" aria-label="Torneos a mostrar">
          <button type="button" aria-pressed={scope === 'circuit'} onClick={() => setScope('circuit')}>Circuito</button>
          <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>Todos</button>
        </div>
        <button type="button" className="btn" disabled={!openable.length} onClick={() => setDraft(d => openable.reduce((acc, t) => setTournament(acc, t, { registration_open_now: true }), d))}>
          <DoorOpen size={16} /> Abrir inscripción en todos los visibles ({openable.length})</button>
      </div>
    </div>
    <div className="table-card"><table className="data-table wp-table">
      <thead><tr><th>Torneo</th><th>Fecha (Madrid)</th><th>Anfitrión</th><th>Estado</th><th>Inscripción</th><th className="center">En la web</th></tr></thead>
      <tbody>{list.map(t => {
        const visible = effective.visible(draft, t), openNow = effective.openNow(draft, t), changed = !!draft.tournaments[t.id];
        return <tr key={t.id} className={`${visible ? '' : 'inactive'}${changed ? ' wp-row-changed' : ''}`}>
          <td><strong>{t.name}</strong><small className="wp-sub">{KIND_LABELS[t.kind] || t.kind}{t.season ? ` · Season ${t.season}` : ''}{t.circuit_code ? ` · ${t.circuit_code}` : ''}</small></td>
          <td>{madrid(t.start_at)}</td>
          <td>{t.host ? <span className={t.host.announced ? '' : 'wp-warn'} title={t.host.announced ? '' : 'El club aún no está anunciado: el torneo se ve con la imagen de CTP.'}>{t.host.name}{!t.host.announced && ' · oculto'}</span> : <span className="muted">CTP</span>}</td>
          <td>{STATUS_LABELS[t.status] || t.status}<small className="wp-sub">{t.entrants} inscritos</small></td>
          <td>{t.registration_open ? <span className="wp-ok">Abierta hasta {madrid(t.registration_close_at)}</span>
            : openNow ? <span className="wp-ok">Se abrirá al publicar</span>
            : canOpenRegistration(t) ? <span>Abre {madrid(t.registration_open_at)}{' '}
              <button type="button" className="btn sm" onClick={() => setDraft(d => setTournament(d, t, { registration_open_now: true }))}>Abrir ya</button></span>
            : <span className="muted">Cerrada</span>}
            {openNow && <button type="button" className="btn ghost sm" onClick={() => setDraft(d => setTournament(d, t, { registration_open_now: false }))}>Deshacer</button>}</td>
          <td className="center">{tournamentToggleable(t)
            ? <Toggle on={visible} changed={changed && 'visible' in (draft.tournaments[t.id] || {})} labelOn="Publicado" labelOff="Oculto" onChange={value => setDraft(d => setTournament(d, t, { visible: value }))} />
            : <span className="muted">{STATUS_LABELS[t.status]}</span>}</td>
        </tr>;
      })}</tbody>
    </table></div>
  </section>;
}

// Criterio de la asesoría (respuesta de dudas, punto 8). El precio final es el
// mismo para todos: cambia la base, no el total.
const TAX_RULES = [
  ['Particular o empresa de Península y Baleares', 'IVA español', 'Factura con IVA. Se pide el NIF.'],
  ['Particular de otro país de la UE', 'IVA español o, con OSS, el de su país', 'Con más de 10.000 € al año en ventas a particulares de la UE se activa OSS.'],
  ['Empresa o profesional de otro país de la UE', 'Sin IVA (inversión del sujeto pasivo)', 'Su NIF-IVA se comprueba en VIES antes del pago; si no es válido, no puede comprar como empresa.'],
  ['Particular o empresa de fuera de la UE', 'Sin IVA español', 'No sujeto. A las empresas se les pide su número fiscal como prueba.'],
  ['Canarias, Ceuta y Melilla', 'Sin IVA español', 'No forman parte del territorio del IVA.'],
];

function RateInput({ value, label, onCommit, max }) {
  const [text, setText] = useState(bpsToPercent(value));
  useEffect(() => { setText(bpsToPercent(value)); }, [value]);
  const parsed = percentToBps(text, max);
  return <input className="wp-rate" inputMode="decimal" aria-label={label} aria-invalid={parsed === null} value={text}
    onChange={event => setText(event.target.value)} onBlur={() => { if (parsed !== null) onCommit(parsed); else setText(bpsToPercent(value)); }} />;
}

function Taxes({ snapshot, draft, setDraft }) {
  const tax = snapshot.tax, oss = effective.tax(draft, snapshot, 'oss_active'), progress = ossProgress(tax);
  const feeOn = effective.tax(draft, snapshot, 'management_fee_active'), feeChanged = 'management_fee_active' in draft.tax || 'management_fee_cents' in draft.tax;
  return <>
    <section className="op-card" aria-labelledby="wp-fee">
      <div className="op-section-title"><div><h2 id="wp-fee">Gastos de gestión</h2>
        <p>Importe que se suma a cada compra online: torneo suelto, Season Pass y Circuit Pass. Lleva el mismo impuesto que el producto y sale como línea aparte en el pago y la factura. Se fija al crear el pedido.</p></div>
        <Toggle on={feeOn} changed={'management_fee_active' in draft.tax} labelOn="Activados" labelOff="Desactivados" onChange={value => setDraft(d => setTax(d, snapshot, 'management_fee_active', value))} /></div>
      <ul className="wp-list"><li className={feeChanged ? 'wp-row-changed' : ''}><ShoppingBag size={20} aria-hidden /><div><strong>Importe por compra</strong>
        <small>Publicado: {tax.management_fee_active ? euros(tax.management_fee_cents) : 'desactivado'} · máximo 20 €</small></div>
        <RateInput value={effective.tax(draft, snapshot, 'management_fee_cents')} max={20} label="Gastos de gestión en euros" onCommit={value => setDraft(d => setTax(d, snapshot, 'management_fee_cents', value))} /> €</li></ul>
    </section>
    <section className="op-card" aria-labelledby="wp-tax">
      <div className="op-section-title"><div><h2 id="wp-tax">Cómo se cobra el impuesto</h2>
        <p>Antes de pagar, el comprador indica si es particular o empresa, su nombre o razón social, dirección, país (y en España, territorio) y su NIF o NIF-IVA. Todos pagan el mismo precio final con impuestos incluidos.</p></div></div>
      <div className="table-card"><table className="data-table">
        <thead><tr><th>Cliente</th><th>Qué se cobra</th><th>Cómo</th></tr></thead>
        <tbody>{TAX_RULES.map(([who, what, how]) => <tr key={who}><td>{who}</td><td><strong>{what}</strong></td><td>{how}</td></tr>)}</tbody>
      </table></div>
    </section>
    <section className="op-card" aria-labelledby="wp-tax-es">
      <div className="op-section-title"><div><h2 id="wp-tax-es">IVA español</h2><p>Se aplica en Península y Baleares y a los particulares de la UE mientras OSS esté desactivado.</p></div></div>
      <ul className="wp-list"><li className={'spain_rate_bps' in draft.tax ? 'wp-row-changed' : ''}><Percent size={20} aria-hidden /><div><strong>Tipo general</strong><small>Publicado: {bpsToPercent(tax.spain_rate_bps)} %</small></div>
        <RateInput value={effective.tax(draft, snapshot, 'spain_rate_bps')} label="Tipo de IVA español" onCommit={value => setDraft(d => setTax(d, snapshot, 'spain_rate_bps', value))} /> %</li></ul>
    </section>
    <section className="op-card" aria-labelledby="wp-tax-oss">
      <div className="op-section-title"><div><h2 id="wp-tax-oss">Ventanilla única (OSS)</h2>
        <p>Ventas a particulares de otros países de la UE este año (base sin IVA): <strong>{euros(tax.eu_consumer_sales_cents)}</strong> de {euros(tax.oss_threshold_cents)}.
          Al superar el umbral, date de alta en OSS con la asesoría y actívalo aquí: desde entonces cada particular de la UE paga el IVA de su país.</p></div>
        <Toggle on={oss} changed={'oss_active' in draft.tax} labelOn="OSS activo" labelOff="OSS desactivado" onChange={value => setDraft(d => setTax(d, snapshot, 'oss_active', value))} /></div>
      <div className={`wp-meter is-${progress.level}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} aria-label="Umbral OSS"><span style={{ width: `${progress.percent}%` }} /></div>
      {progress.level !== 'ok' && !tax.oss_active && <p className="wp-warn">{progress.level === 'over' ? 'Se ha superado el umbral de 10.000 €: hay que activar OSS.' : 'Cerca del umbral de 10.000 €: avisa a la asesoría.'}</p>}
      <div className="table-card"><table className="data-table">
        <thead><tr><th>País</th><th>IVA general (%)</th></tr></thead>
        <tbody>{tax.eu_rates.map(rate => <tr key={rate.country} className={rate.country in draft.eu_rates ? 'wp-row-changed' : ''}>
          <td>{COUNTRY_LABELS[rate.country] || rate.country}</td>
          <td><RateInput value={effective.euRate(draft, rate)} label={`IVA de ${COUNTRY_LABELS[rate.country] || rate.country}`} onCommit={value => setDraft(d => setEuRate(d, rate, value))} /></td>
        </tr>)}</tbody>
      </table></div>
      <p className="muted">Tipos generales de cada país, a revisar con la asesoría antes de activar OSS.</p>
    </section>
  </>;
}

export default function WebPublicationPage() {
  const [tab, setTab] = useState('torneos');
  const [snapshot, setSnapshot] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef(null);

  const refresh = useCallback(async () => {
    setBusy(true); setError('');
    try { setSnapshot(await api.get('/administration/web-publication')); }
    catch (problem) { setError(problem.message); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const count = pendingCount(draft);
  const changes = useMemo(() => draftChanges(draft), [draft]);
  useEffect(() => {
    if (!count) return undefined;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [count]);

  async function publish(event) {
    event.preventDefault();
    if (busy || !snapshot || (!pending.current && (!changes || reason.trim().length < 12))) return;
    // Un reintento reutiliza la misma referencia para no aplicar el cambio dos veces.
    const payload = pending.current || { action: 'configure', expected_version: snapshot.revision, request_id: crypto.randomUUID(), reason: reason.trim(), changes };
    pending.current = payload; setBusy(true); setError(''); setNotice('');
    try {
      const result = await api.post('/administration/web-publication', payload);
      pending.current = null; setSnapshot(result); setDraft(EMPTY_DRAFT); setReason('');
      setNotice(`Publicado (revisión ${result.revision}). La web lo muestra al recargar; no hace falta desplegar.`);
    } catch (problem) {
      setError(problem.message);
      if ([400, 403, 409, 422].includes(problem.status)) pending.current = null;
      if (problem.status === 409) void refresh();
    } finally { setBusy(false); }
  }

  return <div className="wp-page stack">
    <div className="page-header"><div><h1>Publicación web</h1>
      <p>Decide qué muestra la web pública de CTP sin desplegar: secciones, equipos del Team Pass, torneos y fechas del calendario, e IVA de los pagos.</p></div>
      <button type="button" className="btn" disabled={busy} onClick={() => void refresh()}><RefreshCw size={16} /> Actualizar</button></div>
    {error && <p className="op-error" role="alert">{error}</p>}
    {notice && <p className="op-notice" role="status">{notice}</p>}
    {!snapshot ? <p className="muted" role="status">{busy ? 'Consultando la web…' : 'Estado no disponible. Actualiza para comprobarlo.'}</p> : <>
      <p className="muted wp-meta">Revisión {snapshot.revision} · actualizado {dateTime(snapshot.updated_at)}</p>
      <div className="tabs" role="tablist">{TABS.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={15} aria-hidden /> {label}</button>)}</div>
      {tab === 'secciones' && <Sections snapshot={snapshot} draft={draft} setDraft={setDraft} />}
      {tab === 'equipos' && <Clubs snapshot={snapshot} draft={draft} setDraft={setDraft} />}
      {tab === 'torneos' && <Tournaments snapshot={snapshot} draft={draft} setDraft={setDraft} />}
      {tab === 'iva' && <Taxes snapshot={snapshot} draft={draft} setDraft={setDraft} />}
      {(count > 0 || pending.current) && <form className="wp-publish" onSubmit={publish} aria-label="Publicar cambios">
        <strong>{count} {count === 1 ? 'cambio pendiente' : 'cambios pendientes'}</strong>
        <label className="op-field">Motivo (queda en la auditoría)<input required minLength={12} maxLength={500} value={reason} disabled={busy || !!pending.current} placeholder="Ej.: Anuncio de Blast y su Major del 20 de diciembre" onChange={event => setReason(event.target.value)} /></label>
        <div className="btn-row">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => { setDraft(EMPTY_DRAFT); pending.current = null; }}><Undo2 size={16} /> Descartar</button>
          <button type="submit" className="btn primary" disabled={busy || (!pending.current && reason.trim().length < 12)}><Save size={16} />{busy ? 'Publicando…' : pending.current ? 'Reintentar' : 'Publicar en la web'}</button>
        </div>
      </form>}
    </>}
  </div>;
}
