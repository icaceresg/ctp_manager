import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Info, Pause, Play, Radio, RefreshCw, Send, Settings2, Square } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Modal } from '../components/ui.jsx';
import { Badge, Field, FormDialog } from './ui.jsx';
import { canSendCommand, dateTime, safeWebUrl } from './model.js';
import './pro-view.css';

const statuses = { standby: 'Preparado', live: 'Publicado', paused: 'En pausa', ended: 'Finalizado' };
const settings = state => Object.fromEntries(['channel', 'delaySeconds', 'productionDelaySeconds', 'matchId', 'roomId', 'enabled', 'status'].map(key => [key, state[key]]));

export function ProViewPanel({ data, me }) {
  const { toast } = useApp();
  const [state, setState] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [dialog, setDialog] = useState(null), [info, setInfo] = useState(false);
  const serial = useRef(0), mounted = useRef(true);
  const configured = data.connection?.configured && data.connection?.supported_actions?.includes('pro_view.configure');
  const load = useCallback(async () => {
    if (!configured) return;
    const request = ++serial.current; setLoading(true);
    try { const next = await api.get('/operations/pro-view'); if (mounted.current && request === serial.current) { setState(next); setError(''); } }
    catch (cause) { if (mounted.current && request === serial.current) { setError(cause.message); if ([401, 403].includes(cause.status)) setState(null); } }
    finally { if (mounted.current && request === serial.current) setLoading(false); }
  }, [configured]);
  useEffect(() => {
    mounted.current = true; void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 15000);
    return () => { mounted.current = false; ++serial.current; clearInterval(timer); };
  }, [load]);
  const command = state?.commands?.find(item => ['pending', 'failed', 'sending', 'rejected'].includes(item.status));
  const own = command && (me.is_admin || command.actor_id === me.id);
  const ready = Boolean(configured && state && !busy && !command && data.connection?.write_enabled);
  const match = state?.matches.find(item => item.id === state.matchId);
  const viewerUrl = safeWebUrl(data.connection?.web_origin, '/live');
  async function prepare(payload, revision) {
    await api.post('/operations/pro-view/commands', { expected_version: revision, payload });
    await load(); toast('Propuesta preparada. Revisa y envía para que CTP la confirme.');
  }
  async function run(action) {
    if (busy) return; setBusy(true); setError('');
    try { await action(); await load(); }
    catch (cause) { if (mounted.current) setError(cause.message); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <section className="op-card op-pro-view" aria-labelledby="pro-view-heading">
    <div className="op-section-title"><div><div className="op-eyebrow"><Radio size={15} /> CTP PRO VIEW</div><h2 id="pro-view-heading">El partido que ve la comunidad</h2><p>Publica los datos del encuentro con el retraso del directo.</p></div><div className="op-actions"><button className="btn" type="button" aria-label="Cómo se sincroniza Pro View" onClick={() => setInfo(true)}><Info size={16} /></button><button className="btn" type="button" disabled={!configured || loading || busy} onClick={() => void load()}><RefreshCw size={15} className={loading ? 'spin' : ''} /> Actualizar</button></div></div>
    {!configured && <p className="op-notice">Pro View está pendiente de habilitar en el puente CTP. No se han cambiado los datos de la emisión.</p>}
    {error && <p className="op-error" role="alert">{error}{state && ' Se conserva la última lectura; actualiza antes de publicar.'}</p>}
    {state && <>
      <div className="op-pro-view-overview"><div><Badge value={state.status}>{statuses[state.status]}</Badge><h3>{match?.title || (state.matchId ? 'Partido seleccionado en CTP' : 'Sin partido seleccionado')}</h3><p>twitch.tv/{state.channel} · Configuración {state.revision}</p></div><div className="op-pro-view-delay"><strong>{state.delaySeconds}<small> s</small></strong><span>Retraso de los datos</span><small>{state.productionDelaySeconds} s en producción + {state.delaySeconds - state.productionDelaySeconds} s de margen</small></div></div>
      <div className="op-actions"><button className="btn primary" disabled={!ready || Boolean(error)} onClick={() => setDialog({ kind: 'edit', ...state })}><Settings2 size={15} /> Partido y sincronización</button><button className="btn gold" disabled={!ready || !state.matchId || state.status === 'live' || Boolean(error)} onClick={() => setDialog({ kind: 'live', ...state })}><Play size={15} /> Publicar</button><button className="btn" disabled={!ready || state.status !== 'live' || Boolean(error)} onClick={() => setDialog({ kind: 'paused', ...state })}><Pause size={15} /> Pausar</button><button className="btn" disabled={!ready || !['live', 'paused'].includes(state.status) || Boolean(error)} onClick={() => setDialog({ kind: 'ended', ...state })}><Square size={15} /> Finalizar</button>{viewerUrl && <a className="btn" target="_blank" rel="noopener noreferrer" href={viewerUrl}>Ver página pública <ArrowUpRight size={14} /></a>}</div>
      {!data.connection?.write_enabled && <p className="op-notice">La conexión está en lectura. Publicar requiere habilitar las escrituras oficiales en el servidor.</p>}
      <p className="muted">{state.publicPreview ? `Última entrega pública: versión ${state.publicPreview.revision} · ${dateTime(state.publicPreview.visibleAt)}. Origen: ${dateTime(state.publicPreview.sourceAt)}.` : 'Todavía no hay una entrega pública disponible. Los cambios esperan el retraso configurado.'}</p>
      {state.lastErrorCode && <p className="op-notice" role="status">CTP no ha podido actualizar la información del partido. Comprueba la sala y actualiza antes de continuar.</p>}
      {command && <div className="op-pro-view-pending"><div><strong>{own ? 'Propuesta pendiente de confirmación' : 'Otro operador tiene una propuesta pendiente'}</strong><p>{statuses[command.payload.status]} · twitch.tv/{command.payload.channel} · {command.payload.delaySeconds} s · configuración de origen {command.expected_version}</p>{command.last_error && <p className="op-error" role="alert">{command.last_error}</p>}<p className="muted">{command.status === 'sending' ? 'Se está esperando la confirmación de CTP.' : command.attempts > 0 && command.status !== 'rejected' ? 'El envío anterior no está confirmado. Reintentar conserva su identificador y evita duplicarlo.' : 'Guardar una propuesta todavía no modifica la página pública.'}</p></div><div className="op-actions"><button className="btn gold" disabled={!own || busy || !canSendCommand(command, data.connection?.write_enabled, configured)} onClick={() => void run(async () => { await api.post(`/operations/pro-view/commands/${encodeURIComponent(command.id)}/send`, {}); toast('CTP ha confirmado la configuración. Los datos públicos respetan el retraso programado.'); })}><Send size={15} /> {command.attempts ? 'Reintentar envío' : 'Enviar a CTP'}</button>{(command.status === 'pending' && command.attempts === 0 || command.status === 'rejected' && command.attempts === 1 && command.result?.rejected_confirmed) && <button className="btn" disabled={!own || busy} onClick={() => void run(() => api.post(`/operations/commands/${encodeURIComponent(command.id)}/cancel`, { expected_updated_at: command.updated_at }))}>Descartar</button>}</div></div>}
    </>}
    {dialog?.kind === 'edit' && <ProViewConfiguration state={dialog} onClose={() => setDialog(null)} submit={payload => prepare(payload, dialog.revision)} />}
    {dialog && dialog.kind !== 'edit' && <FormDialog title={dialog.kind === 'live' ? 'Publicar en Pro View' : dialog.kind === 'paused' ? 'Pausar Pro View' : 'Finalizar Pro View'} onClose={() => setDialog(null)} submitLabel="Preparar propuesta" submit={() => prepare({ ...settings(dialog), status: dialog.kind, enabled: dialog.kind !== 'ended' }, dialog.revision)}><p>{match?.title || 'Partido seleccionado'} · twitch.tv/{dialog.channel}</p><p>Los datos se publicarán con {dialog.delaySeconds} segundos de retraso total. CTP Panel conserva el control de OBS.</p></FormDialog>}
    {info && <Modal title="Sincronización con el directo" onClose={() => setInfo(false)}><div className="op-form"><p>El retraso total se mide desde el dato de origen hasta su entrega pública. Incluye el retraso configurado en OBS y un margen para el reproductor de Twitch.</p><p>CTP conserva versiones del partido y las libera desde el servidor. El navegador recibe la versión que corresponde; los cambios nuevos no adelantan resultados.</p><p>Después de seleccionar y publicar el encuentro, CTP actualiza los datos disponibles automáticamente. Las estadísticas de mapa aparecen cuando se aprueban; no son telemetría instantánea de bajas.</p><p>El retardo del reproductor de Twitch puede variar entre espectadores. Comprueba la emisión y ajusta el margen. Los cambios de configuración no eliminan el retraso de datos ya programados.</p><p>Este panel publica información para espectadores. Escenas, cámaras y overlays de OBS se controlan desde CTP Panel.</p></div></Modal>}
  </section>;
}

function ProViewConfiguration({ state, submit, onClose }) {
  const [matchId, setMatchId] = useState(state.matchId || '');
  const rooms = state.rooms.filter(room => room.matchId === matchId && (!room.expiresAt || Date.parse(room.expiresAt) > Date.now()));
  const [roomId, setRoomId] = useState(rooms.some(room => room.id === state.roomId) ? state.roomId : '');
  return <FormDialog title="Partido y sincronización" onClose={onClose} submitLabel="Preparar propuesta" help="La configuración se revisa antes de enviarla a CTP. No se cambia OBS desde Manager." submit={input => submit({ channel: input.channel, delaySeconds: Number(input.delaySeconds), productionDelaySeconds: Number(input.productionDelaySeconds), matchId: matchId || null, roomId: roomId || null, enabled: state.enabled, status: state.status })}>
    <Field label="Partido público"><select value={matchId} onChange={event => { setMatchId(event.target.value); setRoomId(''); }}><option value="">Sin partido</option>{state.matchId && !state.matches.some(match => match.id === state.matchId) && <option value={state.matchId}>Partido actualmente seleccionado</option>}{state.matches.map(match => <option key={match.id} value={match.id}>{match.title || match.id}</option>)}</select></Field>
    <Field label="Sala de emisión de CTP" hint="Opcional. Usa el marcador y el mapa provisionales de la sala; el acta mantiene el resultado oficial."><select value={roomId} onChange={event => setRoomId(event.target.value)} disabled={!matchId}><option value="">Solo datos oficiales del partido</option>{rooms.map(room => <option key={room.id} value={room.id}>{room.label || 'Sala del encuentro'}</option>)}</select></Field>
    <Field label="Canal de Twitch"><input name="channel" defaultValue={state.channel} required minLength={3} maxLength={25} pattern="[a-zA-Z0-9_]{3,25}" autoComplete="off" /></Field>
    <div className="op-form-grid"><Field label="Retraso total de los datos (s)" hint="OBS + margen del reproductor."><input name="delaySeconds" type="number" min={0} max={900} step={1} defaultValue={state.delaySeconds} required /></Field><Field label="Retraso de producción en OBS (s)" hint="Para medir el margen; no cambia OBS."><input name="productionDelaySeconds" type="number" min={0} max={900} step={1} defaultValue={state.productionDelaySeconds} required /></Field></div>
    <p className="muted">Configura los datos, envía la propuesta y pulsa Publicar cuando esté preparado. La revisión actual es {state.revision}.</p>
  </FormDialog>;
}
