import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, DoorOpen, Eye, EyeOff, Globe, Percent, RefreshCw, Save, Shield, ShoppingBag, Trophy, Undo2 } from 'lucide-react';
import { api } from '../api.js';
import { dateTime } from '../operations/model.js';
import {
  EMPTY_DRAFT, KIND_LABELS, STATUS_LABELS, ZONE_LABELS, bpsToPercent, canOpenRegistration, draftChanges, effective, pendingCount,
  percentToBps, setClub, setSection, setTaxZone, setTournament, tournamentToggleable,
} from './webPublicationModel.js';
import '../operations/operations.css';
import './web-publication.css';

const TABS = [
  { id: 'secciones', label: 'Secciones', icon: Globe },
  { id: 'equipos', label: 'Equipos del Team Pass', icon: Shield },
  { id: 'torneos', label: 'Torneos y calendario', icon: Trophy },
  { id: 'iva', label: 'IVA por zona', icon: Percent },
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

function TaxZones({ snapshot, draft, setDraft }) {
  return <section className="op-card" aria-labelledby="wp-tax">
    <div className="op-section-title"><div><h2 id="wp-tax">IVA por zona de facturación</h2>
      <p>Antes de pagar, el jugador elige país y zona. El precio ya incluye el impuesto; aquí se fija el tipo de cada zona. Confirma los tipos con la gestoría antes de activar pagos reales.</p></div></div>
    <div className="table-card"><table className="data-table">
      <thead><tr><th>Zona</th><th>Impuesto</th><th>Tipo (%)</th><th className="center">Disponible</th></tr></thead>
      <tbody>{snapshot.tax_zones.map(zone => <TaxRow key={zone.code} zone={zone} draft={draft} setDraft={setDraft} />)}</tbody>
    </table></div>
  </section>;
}
function TaxRow({ zone, draft, setDraft }) {
  const rate = effective.rate(draft, zone);
  const [text, setText] = useState(bpsToPercent(rate));
  useEffect(() => { setText(bpsToPercent(rate)); }, [rate]);
  const parsed = percentToBps(text);
  return <tr className={draft.tax_zones[zone.code] ? 'wp-row-changed' : ''}>
    <td>{ZONE_LABELS[zone.code]}</td><td>{zone.tax_name === 'NONE' ? 'Sin impuesto' : zone.tax_name}</td>
    <td><input className="wp-rate" inputMode="decimal" aria-label={`Tipo de ${ZONE_LABELS[zone.code]}`} aria-invalid={parsed === null} value={text}
      onChange={event => setText(event.target.value)} onBlur={() => { if (parsed !== null) setDraft(d => setTaxZone(d, zone, { rate_bps: parsed })); else setText(bpsToPercent(rate)); }} /></td>
    <td className="center"><Toggle on={effective.active(draft, zone)} changed={'active' in (draft.tax_zones[zone.code] || {})} labelOn="Sí" labelOff="No" onChange={value => setDraft(d => setTaxZone(d, zone, { active: value }))} /></td>
  </tr>;
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
      {tab === 'iva' && <TaxZones snapshot={snapshot} draft={draft} setDraft={setDraft} />}
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
