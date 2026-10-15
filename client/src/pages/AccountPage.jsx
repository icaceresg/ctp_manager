import { useState } from 'react';
import { Info } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Spinner } from '../components/ui.jsx';
import { SECTIONS } from '../../../shared/access.js';

export function AccountPage() {
  const { me, toast } = useApp();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/me/password', { current, next });
      setCurrent('');
      setNext('');
      toast('Contraseña cambiada. Se han cerrado tus otras sesiones.');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const sections = SECTIONS.filter((s) => me.sections.includes(s.id));

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="page-header">
        <div>
          <h1>Mi cuenta</h1>
          <p>
            {me.name} · <span className="code">{me.username}</span>
          </p>
        </div>
      </div>

      <section className="card">
        <div className="card-header">
          <h2>Tu acceso</h2>
        </div>
        <div className="card-body stack">
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {me.is_admin && <span className="role-chip admin">Administrador</span>}
            {me.roles.map((r) => (
              <span key={r.id} className="role-chip">
                {r.name}
              </span>
            ))}
            {!me.is_admin && !me.roles.length && <span className="muted">Sin roles asignados</span>}
          </div>
          <p className="muted small">
            {me.is_admin
              ? 'Como administrador ves todas las secciones y gestionas usuarios y roles.'
              : sections.length
                ? `Puedes entrar en: ${sections.map((s) => s.label).join(', ')}.`
                : 'Todavía no tienes acceso a ninguna sección.'}
          </p>
        </div>
      </section>

      {me.auth_mode === 'ctp' ? <section className="card">
        <div className="card-header"><h2>Cuenta CTP</h2></div>
        <div className="card-body stack"><p>Tu identidad y contraseña se gestionan desde tu cuenta CTP.</p><div><a className="btn" href={me.account_url}>Gestionar mi cuenta CTP</a></div></div>
      </section> : <section className="card">
        <div className="card-header">
          <h2>Cambiar contraseña</h2>
        </div>
        <form className="card-body stack" onSubmit={save}>
          <div className="field">
            <label htmlFor="pw-current">Contraseña actual</label>
            <input id="pw-current" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pw-next">Nueva contraseña</label>
            <input id="pw-next" className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            <span className="hint">Mínimo 8 caracteres.</span>
          </div>
          <div>
            <button className="btn" disabled={busy || !current || !next}>
              {busy && <Spinner size={15} />} Cambiar contraseña
            </button>
          </div>
        </form>
      </section>}

      {me.is_admin && me.auth_mode !== 'ctp' && (
        <div className="callout info">
          <Info size={18} />
          <span>
            Todo se guarda en la carpeta <code className="code">data</code> del proyecto, en este ordenador. Para hacer
            una copia de seguridad, copia esa carpeta.
          </span>
        </div>
      )}
    </div>
  );
}
