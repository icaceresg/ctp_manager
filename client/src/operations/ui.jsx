import { useState } from 'react';
import { ArrowUpRight, Inbox, LoaderCircle } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { Modal } from '../components/ui.jsx';
import { label, dateTime, displayNumber, matchName, matchOption, safeWebUrl } from './model.js';
import { actionLabel } from './actionLabels.js';

export function Badge({ value, children }) {
  return <span className={`op-badge op-state-${String(value).replace(/[^a-z_]/g, '')}`}>{children || label(value)}</span>;
}
export function Empty({ title, children }) {
  return <div className="op-empty"><Inbox size={30} strokeWidth={1.3} /><h3>{title}</h3><p>{children}</p></div>;
}
export function Field({ label: name, children, hint }) {
  return <label className="op-field"><span>{name}</span>{children}{hint && <small>{hint}</small>}</label>;
}
export function FormDialog({ title, onClose, submit, children, submitLabel = 'Guardar', help, danger = false }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try { await submit(Object.fromEntries(new FormData(e.currentTarget))); onClose(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <Modal title={title} onClose={busy ? undefined : onClose}>
    <form className="op-form" onSubmit={onSubmit}>
      {help && <p className="op-help">{help}</p>}{children}
      {error && <p className="op-error" role="alert">{error}</p>}
      <div className="op-form-actions"><button type="button" className="btn" disabled={busy} onClick={onClose}>Cancelar</button><button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy}>{busy && <LoaderCircle size={16} className="spin" />}{submitLabel}</button></div>
    </form>
  </Modal>;
}
export function SelectMatch({ matches, value, name = 'match_id', onChange, required = true }) {
  return <select name={name} value={value} onChange={onChange} required={required}><option value="">Seleccionar partido</option>{matches.map((m) => <option key={m.id} value={m.id}>{matchOption(m)}</option>)}</select>;
}
export function MatchLink({ match, id }) {
  const location = useLocation();
  if (!match?.id && !id) return <span className="muted">Sin partido vinculado</span>;
  return <Link state={{ returnTo: location.pathname + location.search }} to={`/operaciones/partidos/${encodeURIComponent(match?.id || id)}`}>{match ? matchName(match) : 'Abrir partido'}<ArrowUpRight size={13} /></Link>;
}
export function WebLink({ match, origin }) {
  const href = safeWebUrl(origin, match?.web_path);
  return href ? <a href={href} className="btn" target="_blank" rel="noopener noreferrer">Abrir en CTP <ArrowUpRight size={14} /></a> : null;
}
export function DataTable({ rows, columns, empty = 'No hay registros en esta vista.', emptyDetail = 'Los datos aparecerán cuando se sincronicen o se registren desde CTP.' }) {
  if (!rows.length) return <Empty title={empty}>{emptyDetail}</Empty>;
  return <div className="op-table-wrap" role="region" aria-label="Tabla de datos · desliza para ver todas las columnas" tabIndex={0}><table className="op-table"><thead><tr>{columns.map((c) => <th key={c.key} scope="col">{c.title}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={r.id ?? i}>{columns.map((c) => <td key={c.key}>{c.render ? c.render(r) : r[c.key] ?? '—'}</td>)}</tr>)}</tbody></table></div>;
}
export function StatsTable({ players, objectiveLabel = 'Objetivo' }) {
  return <DataTable rows={players} columns={[
    { key: 'name', title: 'Jugador', render: (p) => p.username || p.gamertag || p.name || p.player_name || 'Sin identificar' },
    { key: 'kills', title: 'Bajas', render: (p) => displayNumber(p.kills) },
    { key: 'deaths', title: 'Muertes', render: (p) => displayNumber(p.deaths) },
    { key: 'assists', title: 'Asist.', render: (p) => displayNumber(p.assists) },
    { key: 'score', title: 'Puntos', render: (p) => displayNumber(p.score) },
    { key: 'objective', title: objectiveLabel || 'Objetivo', render: (p) => p.objective == null ? '—' : `${displayNumber(p.objective)}${p.objective_unit ? ` ${p.objective_unit}` : ''}` },
  ]} empty="No hay filas de jugadores disponibles" />;
}
export function AuditList({ items = [] }) {
  return items.length ? <ol className="op-timeline">{items.slice(0, 30).map((a) => <li key={a.id}><strong>{a.actor_name || a.actor?.name || 'CTP'} <span>{actionLabel(a.action)}</span></strong><small>{dateTime(a.created_at)}</small>{a.detail && typeof a.detail === 'string' && <p>{a.detail}</p>}</li>)}</ol> : <p className="muted">Todavía no hay actividad registrada.</p>;
}
