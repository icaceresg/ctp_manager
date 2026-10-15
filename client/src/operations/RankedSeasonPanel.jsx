import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, CalendarDays } from 'lucide-react';
import { api } from '../api.js';
import { Field, FormDialog } from './ui.jsx';
import { canSendCommand, dateTime } from './model.js';
const localDate = value => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';

export function RankedSeasonPanel({ data, me, reload }) {
  const [state, setState] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [open, setOpen] = useState(false);
  const serial = useRef(0);
  const configured = data.connection?.configured && data.connection?.supported_actions?.includes('ranked.season.schedule');
  const load = useCallback(async () => {
    if (!configured || !me.is_admin) return; const request = ++serial.current; setError(''); setBusy(true);
    try { const next = await api.get('/operations/ranked'); if (request === serial.current) setState(next); }
    catch (cause) { if (request === serial.current) { setError(cause.message); if ([401, 403].includes(cause.status)) setState(null); } }
    finally { if (request === serial.current) setBusy(false); }
  }, [configured, me.is_admin]);
  useEffect(() => { void load(); return () => { ++serial.current; }; }, [load]);
  if (!me.is_admin) return null;
  const command = state?.commands.find(item => ['pending', 'failed', 'sending', 'rejected'].includes(item.status));
  async function send() {
    setBusy(true); setError('');
    try { await api.post(`/operations/integration/commands/${command.id}/send`, {}); await reload(); await load(); }
    catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  async function discard() {
    setBusy(true); setError('');
    try { await api.post(`/operations/commands/${command.id}/cancel`, { expected_updated_at: command.updated_at }); await reload(); await load(); }
    catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  return <section className="op-card"><div className="op-section-title"><div><h2>Seasons de Ranked</h2><p>Cada SEASON baja dos divisiones, con Bronce como mínimo. El historial permanece.</p></div><button className="btn" onClick={() => void load()} disabled={busy || !configured}><RefreshCw size={15} /> Actualizar</button></div>
    {!configured && <p className="op-notice">La capacidad de seasons aún no está habilitada en el puente CTP.</p>}
    {error && <p className="op-error" role="alert">{error}</p>}
    {state && <><div className="op-section-title"><div><h3>{state.current.name}</h3><p>Finaliza: {state.current.ends_at ? dateTime(state.current.ends_at) : 'Sin fecha configurada'}</p><p>{state.active_matches} partidas en curso · {state.waiting_players} jugadores esperando</p></div><button className="btn gold" onClick={() => setOpen('ranked.season.schedule')} disabled={busy || !!state.scheduled || !!command}><CalendarDays size={15} /> Programar siguiente SEASON</button></div>
      {state.scheduled && <div className="op-notice"><p><strong>{state.scheduled.name}</strong>: {dateTime(state.scheduled.starts_at)} → {dateTime(state.scheduled.ends_at)}</p><div className="op-actions"><button className="btn" disabled={busy || !!command || Date.parse(state.scheduled.starts_at) <= Date.now() || !data.connection?.supported_actions?.includes('ranked.season.update')} onClick={() => setOpen('ranked.season.update')}>Corregir calendario</button><button className="btn" disabled={busy || !!command || Date.parse(state.scheduled.starts_at) <= Date.now() || !data.connection?.supported_actions?.includes('ranked.season.cancel')} onClick={() => setOpen('ranked.season.cancel')}>Cancelar calendario</button></div></div>}
      <p className="muted">Al finalizar se cierra la cola. Los partidos ya formados deben terminar antes del reinicio automático. Los resultados anteriores se conservan.</p>
      {command && <div className="op-notice"><strong>Propuesta pendiente: {command.type === 'ranked.season.cancel' ? 'Cancelar calendario' : command.payload.name}</strong>{command.payload.starts_at && <p>{dateTime(command.payload.starts_at)} → {dateTime(command.payload.ends_at)}</p>}<p>{command.payload.reason}</p><div className="op-actions"><button className="btn gold" disabled={busy || !canSendCommand(command, data.connection?.write_enabled, data.connection?.supported_actions?.includes(command.type))} onClick={() => void send()}>Enviar calendario a CTP</button>{(command.status === 'pending' && command.attempts === 0 || command.status === 'rejected' && command.attempts === 1 && command.result?.rejected_confirmed) && <button className="btn" disabled={busy} onClick={() => void discard()}>Descartar propuesta</button>}</div></div>}
    </>}
    {open && state && <FormDialog title={open === 'ranked.season.cancel' ? 'Cancelar calendario futuro' : open === 'ranked.season.update' ? 'Corregir calendario futuro' : 'Programar siguiente SEASON'} onClose={() => setOpen(false)} submitLabel="Preparar propuesta" help="La propuesta se guarda localmente. Después debes enviarla para que CTP confirme el calendario." submit={async input => {
      const target = open === 'ranked.season.schedule' ? state.current : state.scheduled;
      await api.post('/operations/ranked/commands', { type: open, target_id: target.id, expected_version: target.manager_version,
        payload: open === 'ranked.season.cancel' ? { reason: input.reason } : { name: input.name, starts_at: new Date(input.starts_at).toISOString(), ends_at: new Date(input.ends_at).toISOString(), reason: input.reason } });
      setOpen(false); await reload(); await load();
    }}>{open !== 'ranked.season.cancel' && <><Field label="Nombre"><input name="name" required maxLength={120} defaultValue={open === 'ranked.season.update' ? state.scheduled.name : `SEASON ${state.current.sequence + 1}`} /></Field><Field label="Inicio (hora local)"><input name="starts_at" type="datetime-local" required defaultValue={open === 'ranked.season.update' ? localDate(state.scheduled.starts_at) : ''} /></Field><Field label="Fin (hora local)"><input name="ends_at" type="datetime-local" required defaultValue={open === 'ranked.season.update' ? localDate(state.scheduled.ends_at) : ''} /></Field></>}<Field label="Motivo registrado"><textarea name="reason" minLength={12} maxLength={500} required rows={3} /></Field><p>{open === 'ranked.season.cancel' ? 'Se retira únicamente el calendario futuro. La season actual sigue abierta y el historial se conserva.' : 'Descenso confirmado: dos divisiones. No se cambian partidas activas.'}</p></FormDialog>}
  </section>;
}
