import { useState } from 'react';
import { Lock } from 'lucide-react';
import { api } from '../api.js';
import { Spinner } from '../components/ui.jsx';

export function Login({ setup, onDone }) {
  const [form, setForm] = useState({ name: '', username: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (setup && form.password !== form.confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setBusy(true);
    try {
      if (setup) await api.post('/auth/setup', { name: form.name, username: form.username, password: form.password });
      else await api.post('/auth/login', { username: form.username, password: form.password });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen login-screen">
      <form className="card login-card" onSubmit={submit}>
        <img className="login-logo" src="/brand/logo-ctp.svg" alt="CTP" />
        <div className="stack" style={{ gap: 4 }}>
          <h1>CTP Manager</h1>
          <p>{setup ? 'Crea la cuenta de administrador para empezar.' : 'Intranet del equipo de CTP.'}</p>
        </div>
        {setup && (
          <div className="field">
            <label htmlFor="name">Nombre</label>
            <input id="name" className="input" autoComplete="name" value={form.name} onChange={set('name')} />
          </div>
        )}
        <div className="field">
          <label htmlFor="username">Usuario</label>
          <input
            id="username"
            className="input"
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={form.username}
            onChange={set('username')}
          />
        </div>
        <div className="field">
          <label htmlFor="pw">Contraseña</label>
          <input
            id="pw"
            className="input"
            type="password"
            autoComplete={setup ? 'new-password' : 'current-password'}
            value={form.password}
            onChange={set('password')}
          />
          {setup && <span className="hint">Mínimo 8 caracteres.</span>}
        </div>
        {setup && (
          <div className="field">
            <label htmlFor="pw2">Repite la contraseña</label>
            <input id="pw2" className="input" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
          </div>
        )}
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="btn primary block" disabled={busy || !form.username || !form.password}>
          {busy && <Spinner size={15} />} {setup ? 'Crear cuenta y entrar' : 'Entrar'}
        </button>
        <p className="login-foot">
          <Lock size={12} /> Acceso restringido. Las cuentas las crea un administrador.
        </p>
      </form>
    </div>
  );
}
