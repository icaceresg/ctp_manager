import { useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { api } from '../api.js';
import { Spinner } from '../components/ui.jsx';
import { CAPTCHA_MESSAGES, captchaCanSubmit, mountLoginCaptcha } from '../../auth-captcha.js';
import '../../auth-captcha.css';

export function Login({ setup, provider, onDone }) {
  const ctp = provider === 'ctp';
  const [form, setForm] = useState({ name: '', username: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState(null);
  const captchaElement = useRef(null);
  const captchaController = useRef(null);
  const inFlight = useRef(false);
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  useEffect(() => {
    if (!ctp || setup) return;
    setCaptcha(null);
    const controller = mountLoginCaptcha(captchaElement.current, setCaptcha);
    captchaController.current = controller;
    return () => {
      controller.destroy();
      captchaController.current = null;
    };
  }, [ctp, setup]);

  async function submit(e) {
    e.preventDefault();
    if (inFlight.current) return;
    setError('');
    if (setup && form.password !== form.confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    if (ctp && !setup && !captchaCanSubmit(captcha)) {
      setError(captcha?.error || CAPTCHA_MESSAGES.required);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      if (setup) await api.post('/auth/setup', { name: form.name, username: form.username, password: form.password });
      else {
        const captchaToken = ctp ? captchaController.current.consume() : '';
        await api.post('/auth/login', { ...(ctp ? { email: form.username } : { username: form.username }), password: form.password, ...(captchaToken ? { captchaToken } : {}) });
      }
      onDone();
    } catch (err) {
      setError(err.message);
      captchaController.current?.reset();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="center-screen login-screen">
      <form className="card login-card" onSubmit={submit}>
        <img className="login-logo" src="/brand/logo-ctp.svg" alt="CTP" />
        <div className="stack" style={{ gap: 4 }}>
          <h1>CTP Manager</h1>
          <p>{ctp ? 'Misma cuenta y contraseña de CTP.' : setup ? 'Crea la cuenta de administrador para empezar.' : 'Intranet del equipo de CTP.'}</p>
        </div>
        {setup && (
          <div className="field">
            <label htmlFor="name">Nombre</label>
            <input id="name" className="input" autoComplete="name" value={form.name} onChange={set('name')} />
          </div>
        )}
        <div className="field">
          <label htmlFor="username">{ctp ? 'Correo CTP' : 'Usuario'}</label>
          <input
            id="username"
            className="input"
            type={ctp ? 'email' : 'text'}
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
        {ctp && !setup && <div ref={captchaElement} />}
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="btn primary block" disabled={busy || !form.username || !form.password || (ctp && !setup && !captchaCanSubmit(captcha))}>
          {busy && <Spinner size={15} />} {setup ? 'Crear cuenta y entrar' : 'Entrar'}
        </button>
        <p className="login-foot">
          <Lock size={12} /> {ctp ? 'Acceso restringido al staff de CTP. No necesitas otra cuenta.' : 'Acceso restringido. Las cuentas las crea un administrador.'}
        </p>
      </form>
    </div>
  );
}
