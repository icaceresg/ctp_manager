import { useEffect, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Field, FormDialog } from './ui.jsx';
import { canSendCommand } from './model.js';

/** Administración → Clubes: an administrator creates a club in CTP and chooses its manager. */
export function ManualClubCreatePanel({ data, me, reload, mutate }) {
  const { toast } = useApp();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!me?.is_admin) return null;
  const supported = data.connection?.supported_actions?.includes('club.create');
  const commands = (data.commands || []).filter(command => command.type === 'club.create' && ['pending', 'failed', 'rejected', 'sending'].includes(command.status));
  async function send(command) {
    setBusy(true); setError('');
    try { await api.post(`/operations/integration/commands/${command.id}/send`, {}); toast('Club creado en CTP.'); await reload(); }
    catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  // One step for the administrator: prepare the proposal and send it at once.
  // If CTP does not confirm, the proposal stays below so it can be retried.
  async function create(payload) {
    const { command } = await api.post('/operations/clubs/create', { type: 'club.create', payload });
    setError('');
    try { await api.post(`/operations/integration/commands/${command.id}/send`, {}); toast(`Club ${payload.name} creado en CTP.`); }
    catch (cause) { setError(`El alta de ${payload.name} no se ha confirmado en CTP: ${cause.message}`); }
    await reload();
  }
  return <section className="op-card"><div className="op-section-title"><div><h2>Crear club</h2><p>Elige quién será el manager: un jugador registrado que no esté en otro club. El acceso al circuito y la verificación se revisan después.</p></div><button className="btn primary" disabled={busy || !supported} onClick={() => setOpen(true)}><Plus size={15} /> Crear club</button></div>
    {!supported && <p className="muted">El puente CTP todavía no admite altas manuales.</p>}
    {error && <p className="op-error" role="alert">{error}</p>}
    {commands.map(command => <div className="op-notice" key={command.id}><strong>Alta pendiente: {command.payload.name} · {command.payload.tag}</strong><p>{command.payload.reason}</p>{command.last_error && <p>{command.last_error}</p>}<div className="op-actions"><button className="btn gold" disabled={busy || !canSendCommand(command, data.connection?.write_enabled, supported)} onClick={() => void send(command)}>Crear en CTP</button>{(command.status === 'pending' && command.attempts === 0 || command.status === 'rejected' && command.attempts === 1 && command.result?.rejected_confirmed) && <button className="btn" disabled={busy} onClick={() => void mutate('post', `/commands/${command.id}/cancel`, { expected_updated_at: command.updated_at }, 'Propuesta descartada.')}>Descartar</button>}</div></div>)}
    {open && <CreateClubForm onClose={() => setOpen(false)} submit={create} />}
  </section>;
}
function CreateClubForm({ onClose, submit }) {
  const [query, setQuery] = useState(''), [manager, setManager] = useState(null), [candidates, setCandidates] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const serial = useRef(0);
  useEffect(() => {
    const request = ++serial.current; setCandidates([]); setError('');
    if (query.trim().length < 3 || manager) { setBusy(false); return; }
    setBusy(true); const timer = setTimeout(() => {
      void api.get(`/operations/clubs/candidates?query=${encodeURIComponent(query.trim())}`).then(rows => { if (request === serial.current) setCandidates(rows); }).catch(cause => { if (request === serial.current) setError(cause.message); }).finally(() => { if (request === serial.current) setBusy(false); });
    }, 300);
    return () => { ++serial.current; clearTimeout(timer); };
  }, [query, manager]);
  return <FormDialog title="Crear club" onClose={onClose} submitLabel="Crear club en CTP" help="El club se crea en CTP al momento con ese manager. No concede acceso al circuito ni verifica el club." submit={async input => {
    if (!manager) throw new Error('Selecciona quién será el manager del club.');
    await submit({ name: input.name.trim(), tag: input.tag.trim().toUpperCase(), leader_id: manager.id, reason: input.reason });
  }}><Field label="Nombre del club"><input name="name" required minLength={3} maxLength={24} /></Field><Field label="Tag" hint="De 2 a 8 letras o números."><input name="tag" required minLength={2} maxLength={8} pattern="[A-Za-z0-9]{2,8}" /></Field>
    <Field label="Manager del club"><div className="op-actions"><Search size={15} /><input aria-label="Buscar manager del club" value={query} maxLength={40} onChange={event => { setQuery(event.target.value); setManager(null); }} placeholder="Busca su nombre de jugador" /></div></Field>
    {busy && <p role="status">Buscando jugadores…</p>}{error && <p className="op-error" role="alert">{error}</p>}
    {manager ? <p className="op-notice">Manager: <strong>{manager.username}</strong></p> : <div className="op-actions">{candidates.map(candidate => <button type="button" className="btn" key={candidate.id} onClick={() => { setManager(candidate); setQuery(candidate.username); }}>{candidate.username}</button>)}</div>}
    {!busy && !manager && query.trim().length >= 3 && !candidates.length && !error && <p className="muted">No hay jugadores disponibles con ese nombre. El manager debe estar registrado y no pertenecer a otro club.</p>}
    <Field label="Motivo del alta"><textarea name="reason" required minLength={12} maxLength={500} rows={3} /></Field>
  </FormDialog>;
}
