import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, Send } from 'lucide-react';
import { Spinner } from '../components/ui.jsx';
import { crm, localeName } from './model.js';

const STORAGE = 'ctp-manager:crm-test-email';
const readEmail = () => { try { return localStorage.getItem(STORAGE) || ''; } catch { return ''; } };

/** Envío de prueba del contenido actual (aunque no esté guardado) a una dirección. */
export function TestSend({ kind, templateKey, locale, content, link, disabled, note }) {
  const [email, setEmail] = useState(readEmail);
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const poll = (id, attempt = 0) => {
    timer.current = setTimeout(async () => {
      try {
        const result = await crm('test.status', { id });
        if (['sent', 'failed'].includes(result.state) || attempt > 40) { setState(result.state === 'sent' ? 'sent' : 'failed'); return; }
        poll(id, attempt + 1);
      } catch { setState('unknown'); }
    }, 3000);
  };
  const send = async event => {
    event.preventDefault();
    setError(''); clearTimeout(timer.current);
    const data = content();
    if (!data.subject?.trim() || !data.html?.trim()) { setError('Completa el asunto y el contenido antes de enviar la prueba.'); return; }
    setState('sending');
    try {
      try { localStorage.setItem(STORAGE, email); } catch { /* preferencia opcional */ }
      const result = await crm('test.send', { kind, email: email.trim(), locale, content: data, ...(templateKey ? { template_key: templateKey } : {}), ...(link ? { link } : {}) });
      setState('pending'); poll(result.id);
    } catch (failure) { setState(null); setError(failure.message); }
  };
  const busy = ['sending', 'pending'].includes(state);
  return <form className="crm-test" onSubmit={send}>
    <label className="op-field crm-grow"><span>Enviar prueba ({localeName(locale)})</span><input type="email" required maxLength={254} value={email} placeholder="tu@correo.com" onChange={event => setEmail(event.target.value)} /></label>
    <button className="btn" disabled={disabled || busy}>{busy ? <Spinner size={14} /> : <Send size={14} />}Enviar prueba</button>
    <div className="crm-test-state" role="status">
      {state === 'pending' && <span className="muted">En cola. El worker la envía en su siguiente ejecución (normalmente en menos de un minuto).</span>}
      {state === 'sent' && <span className="crm-ok"><CheckCircle2 size={14} />Prueba enviada. Revisa la bandeja de entrada y el correo no deseado.</span>}
      {state === 'failed' && <span className="op-error"><CircleAlert size={14} />El servidor de correo no aceptó la prueba.</span>}
      {state === 'unknown' && <span className="muted">No se pudo consultar el estado de la prueba.</span>}
      {error && <span className="op-error" role="alert">{error}</span>}
      {note && <small className="muted">{note}</small>}
    </div>
  </form>;
}
