import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Activity, CircleAlert, Clock3, Pause, Play, RefreshCw, Users } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Spinner } from '../components/ui.jsx';
import { Badge, DataTable, Empty } from '../operations/ui.jsx';
import { dateTime } from '../operations/model.js';
import { canManageRanked } from '../../../shared/access.js';
import { rankedModeKey, rankedModeLabel } from './rankedLabels.js';
import { ModeTag } from './RankedTags.jsx';
import '../operations/operations.css';
import './ranked-monitor.css';

const STATUS = {voting:'Sorteo de mapa', drafting:'Formando equipos', ready:'Lista para jugar', reported:'Confirmando resultado', disputed:'En revisión'};
const number = value => new Intl.NumberFormat('es-ES', {maximumFractionDigits: 1}).format(value);
const duration = value => value == null ? '—' : value < 60 ? `${Math.round(value)} s` : value < 3600 ? `${Math.floor(value / 60)} min ${Math.floor(value % 60)} s` : `${Math.floor(value / 3600)} h ${Math.floor(value % 3600 / 60)} min`;

export default function RankedMonitorPage() {
  const {me} = useApp();
  const allowed=canManageRanked(me),actorKey=`${me?.id}:${me?.ctp_user_id||''}:${me?.ctp_role||''}`;
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [automatic, setAutomatic] = useState(true), [queue, setQueue] = useState(''), [status, setStatus] = useState(''), [mode, setMode] = useState('');
  const [clock, setClock] = useState(Date.now());
  const request = useRef(0), inFlight = useRef(false);
  const load = useCallback(async () => {
    if (!allowed || inFlight.current) return;
    inFlight.current = true;
    const serial = ++request.current;
    setBusy(true);
    try {
      const next = await api.get('/operations/ranked/monitor');
      if (request.current === serial) { setData(next); setError(''); setClock(Date.now()); }
    } catch (cause) {
      if (request.current === serial) { setError(cause.message); if ([401,403].includes(cause.status)) setData(null); }
    } finally {
      if (request.current === serial) { inFlight.current = false; setBusy(false); }
    }
  }, [allowed,actorKey]);
  useEffect(() => { setData(null);setError('');void load(); return () => { ++request.current; inFlight.current = false; }; }, [load]);
  useEffect(() => {
    const timer = setInterval(() => {setClock(Date.now()); if (automatic && !document.hidden) void load();}, 15000);
    const visible = () => {if (automatic && !document.hidden) void load();};
    document.addEventListener('visibilitychange', visible);
    return () => {clearInterval(timer); document.removeEventListener('visibilitychange', visible);};
  }, [automatic, load]);
  if (!allowed) return <Navigate to="/operaciones/jornada" replace/>;
  const stale = data && clock - Date.parse(data.observed_at) > 45000;
  const lobbies = data?.active_lobbies.filter(row => (!queue || row.queue_id === queue) && (!status || row.status === status)
    && (!mode || (mode === 'pending' ? row.mode_pending : !row.mode_pending && rankedModeKey(row.mode) === mode))) || [];
  const queues = data?.queues.filter(row => !queue || row.id === queue) || [];
  const metrics = data ? [
    ['Colas simultáneas', data.summary.active_queues, `${number(data.summary.open_queues)} abiertas`, Activity],
    ['Jugadores buscando', data.summary.waiting_players, `${number(data.summary.solo_players)} solos · ${number(data.summary.waiting_parties)} grupos`, Users],
    ['Partidas activas', data.summary.active_lobbies, `${number(data.summary.players_in_lobbies)} jugadores en partida`, Activity],
    ['Espera más larga', duration(data.summary.waiting_players?data.queues.reduce((max,row) => Math.max(max,row.wait_max_seconds || 0),0):null), 'De las colas mostradas, con presencia vigente', Clock3],
  ] : [];
  return <div className="page wide op-page rm-page">
    <header className="op-heading"><div><div className="op-eyebrow"><Activity size={15}/> COMPETICIÓN EN DIRECTO</div><h1>Monitor de Ranked · 8s</h1><p>Colas simultáneas, partidas y resultados de la plataforma.</p></div><div className="op-actions"><button className="btn" aria-pressed={!automatic} onClick={() => setAutomatic(value => !value)}>{automatic ? <Pause size={16}/> : <Play size={16}/>} {automatic ? 'Pausar' : 'Activar'} actualización</button><button className="btn primary" disabled={busy} onClick={() => void load()}><RefreshCw size={16} className={busy?'spin':''}/> Actualizar</button></div></header>
    <div className={`op-connection ${stale||error?'is-stale':''}`} role="status"><span className={`rm-dot ${stale||error?'is-stale':''}`}/><span>{data ? `${stale||error?'Última lectura conservada':'Datos de CTP'} · ${dateTime(data.observed_at)}` : 'Conectando con CTP…'}</span><span className="op-connection-mode">{automatic?'Cada 15 s mientras esta pestaña está visible':'Actualización pausada'}</span></div>
    {error && <div className="op-error" role="alert"><CircleAlert size={18}/><span>{error}{data?' Los datos mostrados corresponden a la última lectura correcta.':''}</span><button className="btn" onClick={() => void load()} disabled={busy}>Reintentar</button></div>}
    {stale && !error && <p className="op-notice">Esta lectura tiene más de 45 segundos. Actualiza para comprobar el estado actual.</p>}
    {!data ? busy ? <div className="op-loading"><Spinner/>Consultando Ranked…</div> : !error && <Empty title="Sin lectura disponible">Pulsa Actualizar para consultar CTP.</Empty> : <>
      <div className="op-metrics">{metrics.map(([title,value,detail,Icon]) => <div className="op-metric" key={title}><span><Icon size={16}/>{title}</span><strong>{typeof value === 'number'?number(value):value}</strong><small className="muted">{detail}</small></div>)}</div>
      <p className="muted rm-definition">Una cola simultánea tiene jugadores buscando o partidas activas. Los grupos y las esperas excluyen presencias caducadas. Los contadores superiores corresponden a todas las colas.</p>
      <section className="op-card"><div className="op-section-title"><div><h2>Colas de búsqueda</h2><p>Jugadores y grupos que buscan a la vez, con su espera actual.</p></div><label className="rm-filter">Cola<select value={queue} onChange={event => setQueue(event.target.value)}><option value="">Todas las colas</option>{data.queues.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select></label></div>
        <DataTable rows={queues} empty="No hay colas configuradas" emptyDetail="Las colas aparecerán cuando estén disponibles en CTP." columns={[
          {key:'title',title:'Cola',render:row => <strong>{row.title}</strong>}, {key:'is_open',title:'Búsqueda',render:row => <Badge value={row.is_open?'active':'paused'}>{row.is_open?'Abierta':'Cerrada'}</Badge>},
          {key:'waiting_players',title:'Buscando'}, {key:'solo_players',title:'Solos'}, {key:'waiting_parties',title:'Grupos'}, {key:'wait_avg_seconds',title:'Espera media',render:row => duration(row.wait_avg_seconds)}, {key:'wait_max_seconds',title:'Máxima',render:row => duration(row.wait_max_seconds)}, {key:'active_lobbies',title:'Partidas'}, {key:'map_count',title:'Mapas'}, {key:'presence_expired_players',title:'Presencia caducada'},
        ]}/>{data.truncated.queues && <p className="op-notice">Se muestran las primeras 50 colas. Los contadores globales incluyen todas.</p>}
      </section>
      <section className="op-card"><div className="op-section-title"><div><h2>Partidas activas</h2><p>Desde el sorteo hasta la confirmación o revisión del resultado.</p></div><div className="rm-filters"><label className="rm-filter">Modo<select value={mode} onChange={event => setMode(event.target.value)}><option value="">Todos los modos</option><option value="hp">Punto caliente</option><option value="snd">BYD</option><option value="pending">Votando modo</option></select></label><label className="rm-filter">Estado<select value={status} onChange={event => setStatus(event.target.value)}><option value="">Todos los estados</option>{Object.entries(STATUS).map(([key,title]) => <option key={key} value={key}>{title}</option>)}</select></label></div></div>
        <div className="rm-statuses">{data.lobby_statuses.map(row => <span key={row.status}><span className="muted">{STATUS[row.status]}</span><strong>{number(row.count)}</strong></span>)}</div>
        <DataTable rows={lobbies} empty="Sin partidas en esta vista" emptyDetail="Cuando se forme una partida aparecerá aquí con su estado real." columns={[
          {key:'id',title:'Partida',render:row => <Link to={`/ranked/partidas/${encodeURIComponent(row.id)}`} title="Abrir equipos, chat y resultado" className="rm-id">{row.id.slice(0,8)} ↗</Link>}, {key:'queue_title',title:'Cola'}, {key:'mode',title:'Modo',render:row => <ModeTag mode={row.mode} pending={row.mode_pending}/>}, {key:'status',title:'Estado',render:row => <Badge value={row.status}>{STATUS[row.status]}</Badge>}, {key:'map_name',title:'Mapa',render:row => row.map_name || 'Sorteando'}, {key:'players',title:'Jugadores',render:row => `${row.players} · ${row.side_a}/${row.side_b}`}, {key:'age_seconds',title:'Desde formación',render:row => duration(row.age_seconds)}, {key:'result_votes',title:'Votos resultado'}, {key:'open_disputes',title:'Disputas'}, {key:'deadline_at',title:'Plazo',render:row => row.deadline_at?dateTime(row.deadline_at):'—'},
        ]}/>{data.truncated.active_lobbies && <p className="op-notice">Se muestran hasta 50 partidas. Los contadores incluyen todas las partidas activas.</p>}
      </section>
      <section className="op-card"><div className="op-section-title"><div><h2>Actividad de las últimas 24 horas</h2><p>{dateTime(data.window_started_at)} → {dateTime(data.observed_at)} · Todas las colas</p></div></div>
        <div className="rm-history">{[['Formadas','created_matches'],['Resultados cerrados','completed_matches'],['Canceladas','cancelled_matches'],['Disputas abiertas','disputes_opened'],['Sorteos de mapa','map_draws'],['Mapas omitidos','map_skips']].map(([title,key]) => <div key={key}><span className="muted">{title}</span><strong>{number(data.activity_24h[key])}</strong></div>)}<div><span className="muted">Tiempo medio hasta resolución</span><strong>{duration(data.activity_24h.duration_avg_seconds)}</strong></div></div>
        <p className="muted rm-definition">Resultados y cancelaciones cerrados en este intervalo. El tiempo hasta resolución incluye preparación y confirmación; no mide el tiempo de juego dentro de Call of Duty.</p>
      </section>
      <section className="op-card"><div className="op-section-title"><div><h2>Rotación y saltos de mapa</h2><p>Saltos sobre los sorteos de las últimas 24 horas. El historial incluye mapas retirados.</p></div><Link className="btn" to="/administracion/ranked">Administrar Ranked</Link></div>
        <DataTable rows={data.map_activity} empty="Todavía no hay mapas ni sorteos" emptyDetail="Las métricas aparecerán con la actividad de las partidas." columns={[
          {key:'map_name',title:'Mapa'}, {key:'mode',title:'Modo',render:row => rankedModeLabel(row.mode)}, {key:'active_in_pool',title:'Pool actual',render:row => <Badge value={row.active_in_pool?'active':'paused'}>{row.active_in_pool?'En rotación':'Histórico'}</Badge>}, {key:'draws_24h',title:'Sorteado'}, {key:'skips_24h',title:'Omitido'}, {key:'ratio',title:'Tasa de salto',render:row => row.draws_24h?`${number(row.skips_24h/row.draws_24h*100)} %`:'—'},
        ]}/>{data.truncated.map_activity && <p className="op-notice">Se muestran hasta 64 referencias de mapa.</p>}
      </section>
    </>}
  </div>;
}
