import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, DoorOpen, Eye, EyeOff, Globe, Image as ImageIcon, Percent, RefreshCw, Save, Search, Shield, ShoppingBag, Trophy, Undo2, Upload, X } from 'lucide-react';
import { api } from '../api.js';
import { dateTime } from '../operations/model.js';
import {
  COUNTRY_LABELS, EMPTY_DRAFT, KIND_LABELS, PROGRAM_LABELS, STATUS_LABELS, bpsToPercent, canOpenRegistration, draftChanges, effective, euros, ossProgress,
  pendingCount, percentToBps, setClub, setEuRate, setSection, setTax, setTournament, tournamentToggleable,
} from './webPublicationModel.js';
import '../operations/operations.css';
import './web-publication.css';

const TABS = [
  { id: 'secciones', label: 'Secciones', icon: Globe },
  { id: 'equipos', label: 'Clubes y pases', icon: Shield },
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

const IMAGE_SPECS = {
  logo: { label: 'Escudo', type: 'image/png', width: 512, height: 512, fit: 'contain', hint: 'PNG cuadrado, se reduce a 512 px.' },
  cover: { label: 'Banner', type: 'image/jpeg', width: 1600, height: 600, fit: 'cover', hint: 'JPEG 1600 × 600, se recorta al centro.' },
};

/** Convierte cualquier imagen al formato que acepta CTP (PNG para el escudo, JPEG para el banner). */
async function prepareImage(file, spec) {
  const bitmap = await createImageBitmap(file);
  const scale = spec.fit === 'cover' ? Math.max(spec.width / bitmap.width, spec.height / bitmap.height) : Math.min(1, spec.width / bitmap.width, spec.height / bitmap.height);
  const width = spec.fit === 'cover' ? spec.width : Math.round(bitmap.width * scale), height = spec.fit === 'cover' ? spec.height : Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (spec.type === 'image/jpeg') { context.fillStyle = '#000'; context.fillRect(0, 0, width, height); }
  context.drawImage(bitmap, (width - bitmap.width * scale) / 2, (height - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
  bitmap.close?.();
  for (const quality of [0.88, 0.78, 0.65]) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, spec.type, quality));
    if (blob && blob.size <= 2 * 1024 * 1024) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    }
  }
  throw new Error('La imagen ocupa demasiado incluso comprimida. Prueba con otra más pequeña.');
}

function ImageField({ club, kind, draft, setDraft, previews, setPreviews }) {
  const spec = IMAGE_SPECS[kind], key = kind === 'logo' ? 'logo_path' : 'cover_path';
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const path = effective.club(draft, club, key), changed = !!draft.clubs[club.id] && key in draft.clubs[club.id];
  const url = previews[path] || (path && path === club.branding?.[key] ? club.branding?.[kind === 'logo' ? 'logo_url' : 'cover_url'] : null);
  async function pick(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setBusy(true); setError('');
    try {
      const base64 = await prepareImage(file, spec);
      const result = await api.post('/administration/web-publication/upload', { team_id: club.id, kind, content_type: spec.type, base64, request_id: crypto.randomUUID() });
      setPreviews(p => ({ ...p, [result.path]: result.url || URL.createObjectURL(file) }));
      setDraft(d => setClub(d, club, { [key]: result.path }));
    } catch (problem) { setError(problem.message); } finally { setBusy(false); }
  }
  return <div className={`wp-image is-${kind}${changed ? ' is-changed' : ''}`}>
    <div className="wp-image-frame">{url ? <img src={url} alt={`${spec.label} de ${club.name}`} /> : <span className="muted">{path ? 'Imagen guardada' : `Sin ${spec.label.toLowerCase()}`}</span>}</div>
    <div className="wp-image-actions"><strong>{spec.label}</strong><small>{spec.hint}</small>
      <div className="btn-row"><label className="btn sm"><Upload size={14} aria-hidden /> {busy ? 'Subiendo…' : 'Cambiar'}
        <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy} onChange={pick} /></label>
      {path && <button type="button" className="btn ghost sm" onClick={() => setDraft(d => setClub(d, club, { [key]: null }))}>Quitar</button>}</div>
      {error && <small className="wp-warn" role="alert">{error}</small>}</div>
  </div>;
}

function ClubPage({ club, draft, setDraft, previews, setPreviews, onClose }) {
  const value = key => effective.club(draft, club, key), set = change => setDraft(d => setClub(d, club, change));
  return <section className="op-card wp-editor" aria-label={`Página de ${club.name}`}>
    <div className="op-section-title"><div><h2>Página de {club.name}</h2><p>Escudo, banner, colores y lema de su ficha en /teams. Se publican con el resto de cambios.</p></div>
      <button type="button" className="btn ghost sm" onClick={onClose}><X size={14} /> Cerrar</button></div>
    <div className="wp-editor-images">
      <ImageField club={club} kind="logo" draft={draft} setDraft={setDraft} previews={previews} setPreviews={setPreviews} />
      <ImageField club={club} kind="cover" draft={draft} setDraft={setDraft} previews={previews} setPreviews={setPreviews} />
    </div>
    <div className="wp-editor-fields">
      {[['primary_color', 'Color principal'], ['secondary_color', 'Color secundario']].map(([key, label]) => <label key={key} className="op-field">{label}
        <span className="wp-color"><input type="color" value={value(key) || '#D4A843'} onChange={event => set({ [key]: event.target.value.toUpperCase() })} /><code>{value(key)}</code></span></label>)}
      <label className="op-field wp-tagline">Lema (máx. 80 caracteres)<input maxLength={80} value={value('tagline')} onChange={event => set({ tagline: event.target.value })} /></label>
    </div>
  </section>;
}

function ClubSearch({ onPick, exclude, label }) {
  const [query, setQuery] = useState(''), [items, setItems] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function search(event) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setBusy(true); setError('');
    try { setItems((await api.post('/administration/web-publication/search', { query: query.trim() })).items); }
    catch (problem) { setError(problem.message); } finally { setBusy(false); }
  }
  return <form className="wp-search" onSubmit={search} role="search" aria-label={label}>
    <div className="btn-row"><input value={query} maxLength={40} placeholder="Nombre o etiqueta del club" aria-label={label} onChange={event => setQuery(event.target.value)} />
      <button type="submit" className="btn sm" disabled={busy || query.trim().length < 2}><Search size={14} /> Buscar</button></div>
    {error && <small className="wp-warn" role="alert">{error}</small>}
    {items && <ul className="wp-results">{!items.length ? <li className="muted">Sin resultados.</li> : items.map(item => <li key={item.id}>
      <span><span className="wp-tag">{item.tag}</span> {item.name}{item.program && <small> · {PROGRAM_LABELS[item.program]}</small>}</span>
      <button type="button" className="btn sm" disabled={!!item.program || exclude.has(item.id)} onClick={() => { onPick({ ...item, found: true, announced: false }); setItems(null); setQuery(''); }}>Añadir</button>
    </li>)}</ul>}
  </form>;
}

function Clubs({ snapshot, draft, setDraft }) {
  const [editing, setEditing] = useState(null), [previews, setPreviews] = useState({});
  const found = Object.entries(draft.found).map(([id, label]) => ({ id, ...label, program: null, announced: false, found: true, hosting: [], members: 0 }));
  const all = [...snapshot.clubs, ...found];
  const program = club => (club.program === 'team_pass' ? 'team_pass' : effective.club(draft, club, 'program') === 'semi_team_pass' ? 'semi_team_pass' : effective.club(draft, club, 'circuit_pass') ? 'circuit_pass' : null);
  const group = name => all.filter(club => program(club) === name);
  const teamPass = group('team_pass'), semi = group('semi_team_pass'), circuit = group('circuit_pass');
  const removed = all.filter(club => !program(club) && club.id in draft.clubs);
  const ids = new Set(all.filter(program).map(club => club.id));
  const editingClub = all.find(club => club.id === editing && ['team_pass', 'semi_team_pass'].includes(program(club)));
  const card = (club, extra) => <li key={club.id} className={`${program(club) === 'team_pass' && !effective.club(draft, club) ? 'is-hidden' : ''}${club.id in draft.clubs ? ' wp-card-changed' : ''}`}>
    <div className="wp-club-name">{club.branding?.logo_url && <img className="wp-logo" src={club.branding.logo_url} alt="" />}<span className="wp-tag">{club.tag}</span><strong>{club.name}</strong></div>
    {extra}
    {['team_pass', 'semi_team_pass'].includes(program(club)) && !club.found && <button type="button" className="btn sm wp-page-button" aria-pressed={editing === club.id}
      onClick={() => setEditing(editing === club.id ? null : club.id)}><ImageIcon size={14} /> Página del club</button>}
  </li>;
  return <>
    <section className="op-card" aria-labelledby="wp-clubs">
      <div className="op-section-title"><div><h2 id="wp-clubs">Team Pass</h2>
        <p>Los 16 anfitriones. En /teams aparecen con su torneo como «Próximamente» hasta anunciarlos; al anunciarlos se ve su ficha y su imagen en el torneo. {teamPass.filter(club => !effective.club(draft, club)).length} de {teamPass.length} por anunciar.</p></div></div>
      {!teamPass.length ? <p className="muted">No hay clubes del Team Pass en esta temporada.</p> : <ul className="wp-grid">{teamPass.map(club => card(club, <>
        <small>{club.hosting.length ? `Anfitrión de ${club.hosting.map(h => h.name).join(', ')}` : 'Sin torneo asignado'} · {club.members} miembros</small>
        {club.announced_at && club.announced && <small>Anunciado el {madrid(club.announced_at)}</small>}
        <Toggle on={effective.club(draft, club)} changed={'announced' in (draft.clubs[club.id] || {})} labelOn="Anunciado" labelOff="Próximamente" onChange={value => setDraft(d => setClub(d, club, { announced: value }))} />
      </>))}</ul>}
    </section>
    {editingClub && <ClubPage club={editingClub} draft={draft} setDraft={setDraft} previews={previews} setPreviews={setPreviews} onClose={() => setEditing(null)} />}
    <section className="op-card" aria-labelledby="wp-semi">
      <div className="op-section-title"><div><h2 id="wp-semi">Semi-Team Pass</h2>
        <p>Clubes con página propia y distintivo dorado, sin torneo como anfitrión.</p></div>
        <ClubSearch label="Añadir club al Semi-Team Pass" exclude={ids} onPick={club => setDraft(d => setClub(d, club, { program: 'semi_team_pass' }))} /></div>
      {!semi.length ? <p className="muted">Ningún club en el Semi-Team Pass.</p> : <ul className="wp-grid">{semi.map(club => card(club, <>
        <small>{club.found ? 'Se añadirá al publicar' : `${club.members} miembros`}</small>
        <button type="button" className="btn ghost sm" onClick={() => setDraft(d => setClub(d, club, { program: null }))}>Quitar del Semi-Team Pass</button>
      </>))}</ul>}
    </section>
    <section className="op-card" aria-labelledby="wp-circuit">
      <div className="op-section-title"><div><h2 id="wp-circuit">Circuit Pass</h2>
        <p>Clubes con el pase de la temporada: tick y nombre dorados. Los pagados llegan solos; aquí se dan a mano y solo se retiran los dados a mano.</p></div>
        <ClubSearch label="Dar Circuit Pass a un club" exclude={ids} onPick={club => setDraft(d => setClub(d, club, { circuit_pass: true }))} /></div>
      {!circuit.length ? <p className="muted">Ningún club con Circuit Pass esta temporada.</p> : <ul className="wp-grid">{circuit.map(club => card(club, <>
        <small>{club.found ? 'Se dará al publicar' : club.circuit_pass_manual ? 'Dado a mano' : 'Pagado'}</small>
        {(club.found || club.circuit_pass_manual) && <button type="button" className="btn ghost sm" onClick={() => setDraft(d => setClub(d, club, { circuit_pass: false }))}>Retirar</button>}
      </>))}</ul>}
      {removed.length > 0 && <p className="wp-warn">Se retirará al publicar: {removed.map(club => club.name).join(', ')}.{' '}
        <button type="button" className="btn ghost sm" onClick={() => setDraft(d => removed.reduce((acc, club) => setClub(acc, club, { program: club.program === 'semi_team_pass' ? 'semi_team_pass' : null, circuit_pass: club.circuit_pass === true }), d))}>Deshacer</button></p>}
    </section>
  </>;
}

function Tournaments({ snapshot, draft, setDraft }) {
  const [scope, setScope] = useState('circuit');
  const list = snapshot.tournaments.filter(t => scope === 'all' || t.circuit_code);
  const hosts = snapshot.clubs.filter(club => club.program === 'team_pass').sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const openable = list.filter(t => effective.visible(draft, t) && canOpenRegistration(t) && !effective.openNow(draft, t));
  return <section className="op-card" aria-labelledby="wp-tournaments">
    <div className="op-section-title"><div><h2 id="wp-tournaments">Torneos y calendario</h2>
      <p>Un torneo publicado aparece en /tournaments y en el calendario. Oculto vuelve a borrador: deja de verse, sin borrar inscripciones. Con la fecha oculta, la web muestra «Fecha por anunciar» en el calendario y en su página. Solo un club del Team Pass puede ser anfitrión.</p></div>
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
        const dateOn = effective.dateVisible(draft, t), host = effective.host(draft, t), hostClub = hosts.find(club => club.id === host);
        return <tr key={t.id} className={`${visible ? '' : 'inactive'}${changed ? ' wp-row-changed' : ''}`}>
          <td><strong>{t.name}</strong><small className="wp-sub">{KIND_LABELS[t.kind] || t.kind}{t.season ? ` · Season ${t.season}` : ''}{t.circuit_code ? ` · ${t.circuit_code}` : ''}</small></td>
          <td className={dateOn ? '' : 'wp-dim'}>{madrid(t.start_at)}<div><Toggle on={dateOn} changed={changed && 'date_visible' in draft.tournaments[t.id]} labelOn="Fecha visible" labelOff="Por anunciar" onChange={value => setDraft(d => setTournament(d, t, { date_visible: value }))} /></div></td>
          <td>{['cup', 'major'].includes(t.kind) ? <select className={changed && 'host_club_id' in draft.tournaments[t.id] ? 'wp-select is-changed' : 'wp-select'} aria-label={`Anfitrión de ${t.name}`} value={host ?? ''}
            onChange={event => setDraft(d => setTournament(d, t, { host_club_id: event.target.value || null }))}>
            <option value="">Sin anfitrión (CTP)</option>{hosts.map(club => <option key={club.id} value={club.id}>{club.name}{club.announced ? '' : ' · próximamente'}</option>)}</select>
            : t.host ? t.host.name : <span className="muted">CTP</span>}
          {hostClub && !effective.club(draft, hostClub) && <small className="wp-sub wp-warn">Se ve con la imagen de CTP hasta anunciar el club.</small>}</td>
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
