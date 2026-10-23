import { useEffect, useState } from 'react';
import { Pencil, RefreshCw, Users } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp, useData } from '../context.jsx';
import { EmptyState, Modal, Spinner } from '../components/ui.jsx';
import { STAFF_KINDS } from '../../../shared/access.js';

const currentKind = row => row.role === 'referee' ? 'referee' : row.staff_enabled ? row.staff_kind || '' : '';
const label = kind => STAFF_KINDS.find(item => item.id === kind)?.label || 'Sin acceso a Manager';

function StaffAccessModal({ account, close, saved }) {
  const { me, toast, onMeChange } = useApp();
  const [kind, setKind] = useState(currentKind(account));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api.patch(`/staff-access/${encodeURIComponent(account.id)}`, { staff_kind: kind || null, enabled: Boolean(kind) });
      toast('Acceso de staff actualizado en CTP.');
      if (account.id === me.ctp_user_id) await onMeChange();
      await saved(); close();
    } catch (problem) { setError(problem.message); setBusy(false); }
  };
  return <Modal title={`Acceso de ${account.username}`} onClose={() => !busy && close()}><form onSubmit={submit}>
    <div className="modal-body stack">
      <div className="field"><label htmlFor="staff-kind">Función en CTP</label><select id="staff-kind" className="input" value={kind} onChange={event => setKind(event.target.value)} disabled={busy}>
        <option value="">Sin acceso a Manager</option>{STAFF_KINDS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></div>
      <p className="muted">Usará su cuenta y contraseña habituales de CTP. La función limita sus herramientas; no concede administración.</p>
      {account.role === 'referee' && kind !== 'referee' && <p className="muted">También se retirará su autoridad arbitral en CTP.</p>}
      {kind === 'referee' && account.role !== 'referee' && <p className="muted">Arbitraje permite gestionar resultados, incidencias y estadísticas oficiales de CTP.</p>}
      {!account.email_confirmed && <p className="muted">La cuenta todavía debe confirmar su correo para iniciar sesión.</p>}
      {error && <p role="alert" className="error">{error}</p>}
    </div>
    <div className="modal-footer"><button type="button" className="btn" disabled={busy} onClick={close}>Cancelar</button><button className="btn primary" disabled={busy || kind === currentKind(account)}>{busy && <Spinner size={15}/>}Guardar acceso</button></div>
  </form></Modal>;
}

export function StaffAccessPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const page = Math.max(0, Number(params.get('page')) || 0);
  const [search, setSearch] = useState(query);
  const [editing, setEditing] = useState(null);
  const requestKey = JSON.stringify([query, page]);
  const { data: loaded, loading, error, reload } = useData(async () => ({
    ...await api.get(`/staff-access?${new URLSearchParams({ query, offset: String(page * 25), limit: '25' })}`), requestKey,
  }), [query, page]);
  const data = loaded?.requestKey === requestKey ? loaded : null;
  useEffect(() => { setSearch(query); setEditing(null); }, [query, page]);
  const change = (key, value) => setParams(previous => { const next = new URLSearchParams(previous); value ? next.set(key, value) : next.delete(key); if (key !== 'page') next.delete('page'); return next; }, { replace: true });
  return <div className="page" style={{ maxWidth: 1100 }}>
    <header className="page-header"><div><h1>Usuarios y funciones</h1><p>Asigna herramientas al staff con su misma cuenta CTP. Los administradores están protegidos.</p></div><button className="btn" disabled={loading} onClick={reload}><RefreshCw size={16}/>Actualizar</button></header>
    <form className="input-group" onSubmit={event => { event.preventDefault(); change('q', search.trim()); }} style={{ maxWidth: 600, marginBottom: 20 }}>
      <input className="input" aria-label="Buscar cuentas CTP" placeholder="Buscar usuario, gamertag o correo completo…" maxLength={120} value={search} onChange={event => setSearch(event.target.value)}/><button className="btn" disabled={loading}>Buscar</button>
    </form>
    {error && <p role="alert" className="muted">{error.message} <button className="btn" onClick={reload}>Reintentar</button></p>}
    {loading && !data ? <Spinner/> : data ? <>
      <p className="muted">{data.total} cuentas · página {page + 1}</p>
      <div className="card table-card"><table className="data-table"><thead><tr><th>Cuenta CTP</th><th>Función</th><th>Acceso</th><th aria-label="Acciones"/></tr></thead><tbody>
        {data.items.map(account => <tr key={account.id}><td><strong>{account.username}</strong>{!account.email_confirmed && <div className="muted small">Correo pendiente de confirmar</div>}</td>
          <td>{account.role === 'admin' ? 'Administrador CTP' : label(currentKind(account))}</td><td>{account.role === 'admin' || currentKind(account) ? 'Habilitado' : 'Sin acceso'}</td>
          <td style={{ textAlign: 'right' }}>{account.role === 'admin' ? <span className="muted">Cuenta protegida</span> : <button className="btn ghost sm" disabled={loading || Boolean(error)} onClick={() => setEditing(account)}><Pencil size={14}/>Cambiar función</button>}</td></tr>)}
      </tbody></table>{!data.items.length && <EmptyState icon={Users} title="No hay cuentas que coincidan"/>}</div>
      <div className="row" style={{ marginTop: 18 }}><button className="btn" disabled={loading || page === 0} onClick={() => change('page', String(page - 1))}>Anterior</button><button className="btn" disabled={loading || (page + 1) * 25 >= data.total} onClick={() => change('page', String(page + 1))}>Siguiente</button></div>
    </> : !loading && !error && <EmptyState icon={Users} title="No se ha podido cargar el directorio"/>}
    {editing && <StaffAccessModal account={editing} close={() => setEditing(null)} saved={reload}/>}
  </div>;
}
