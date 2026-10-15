import { useEffect, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { api } from '../api.js';
import { Field, FormDialog } from './ui.jsx';
import { canSendCommand } from './model.js';

export function ManualClubCreatePanel({ data, me, reload, mutate }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!me?.is_admin) return null;
  const supported = data.connection?.supported_actions?.includes('club.create');
  const commands = (data.commands || []).filter(command => command.type === 'club.create' && ['pending', 'failed', 'rejected', 'sending'].includes(command.status));
  async function send(command) {
    setBusy(true); setError('');
    try { await api.post(`/operations/integration/commands/${command.id}/send`, {}); await reload(); }
    catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  return <section className="op-card"><div className="op-section-title"><div><h3>Alta manual de club</h3><p>Primero crea el club con un líder registrado. Después revisa y aprueba su acceso al circuito.</p></div><button className="btn" disabled={busy || !supported} onClick={() => setOpen(true)}><Plus size={15} /> Crear club</button></div>
    {!supported && <p className="muted">El puente CTP todavía no admite altas manuales.</p>}
    {error && <p className="op-error" role="alert">{error}</p>}
    {commands.map(command => <div className="op-notice" key={command.id}><strong>{command.payload.name} · {command.payload.tag}</strong><p>{command.payload.reason}</p>{command.last_error && <p>{command.last_error}</p>}<div className="op-actions"><button className="btn gold" disabled={busy || !canSendCommand(command, data.connection?.write_enabled, supported)} onClick={() => void send(command)}>Crear en CTP</button>{(command.status === 'pending' && command.attempts === 0 || command.status === 'rejected' && command.attempts === 1 && command.result?.rejected_confirmed) && <button className="btn" disabled={busy} onClick={() => void mutate('post', `/commands/${command.id}/cancel`, { expected_updated_at: command.updated_at }, 'Propuesta descartada.')}>Descartar</button>}</div></div>)}
    {open && <CreateClubForm onClose={() => setOpen(false)} submit={async payload => { await api.post('/operations/clubs/create', { type: 'club.create', payload }); setOpen(false); await reload(); }} />}
  </section>;
}
function CreateClubForm({ onClose, submit }) {
  const [query, setQuery] = useState(''), [leader, setLeader] = useState(null), [candidates, setCandidates] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const serial = useRef(0);
  useEffect(() => {
    const request = ++serial.current; setCandidates([]); setError('');
    if (query.trim().length < 3 || leader) { setBusy(false); return; }
    setBusy(true); const timer = setTimeout(() => {
      void api.get(`/operations/clubs/candidates?query=${encodeURIComponent(query.trim())}`).then(rows => { if (request === serial.current) setCandidates(rows); }).catch(cause => { if (request === serial.current) setError(cause.message); }).finally(() => { if (request === serial.current) setBusy(false); });
    }, 300);
    return () => { ++serial.current; clearTimeout(timer); };
  }, [query, leader]);
  return <FormDialog title="Crear club manualmente" onClose={onClose} submitLabel="Preparar alta" help="La propuesta no concede acceso ni verifica el club. Un administrador debe enviarla y revisar después su verificación." submit={async input => {
    if (!leader) throw new Error('Selecciona un líder existente de CTP.');
    await submit({ name: input.name, tag: input.tag.toUpperCase(), leader_id: leader.id, reason: input.reason });
  }}><Field label="Nombre del club"><input name="name" required minLength={3} maxLength={24} /></Field><Field label="Tag"><input name="tag" required minLength={2} maxLength={8} pattern="[A-Za-z0-9]{2,8}" /></Field>
    <Field label="Líder registrado"><div className="op-actions"><Search size={15} /><input aria-label="Buscar líder de CTP" value={query} maxLength={40} onChange={event => { setQuery(event.target.value); setLeader(null); }} placeholder="Busca su nombre de jugador" /></div></Field>
    {busy && <p role="status">Buscando jugadores…</p>}{error && <p className="op-error" role="alert">{error}</p>}
    {leader ? <p className="op-notice">Líder seleccionado: <strong>{leader.username}</strong></p> : <div className="op-actions">{candidates.map(candidate => <button type="button" className="btn" key={candidate.id} onClick={() => { setLeader(candidate); setQuery(candidate.username); }}>{candidate.username}</button>)}</div>}
    {!busy && !leader && query.trim().length >= 3 && !candidates.length && !error && <p className="muted">No hay jugadores disponibles con ese nombre. El líder debe estar registrado y no pertenecer a otro club.</p>}
    <Field label="Motivo del alta"><textarea name="reason" required minLength={12} maxLength={500} rows={3} /></Field>
  </FormDialog>;
}
