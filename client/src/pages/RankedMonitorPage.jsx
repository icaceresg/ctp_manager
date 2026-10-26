import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { Activity, CircleAlert, Clock3, Pause, Play, RefreshCw, Users } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Spinner } from '../components/ui.jsx';
import { Badge, DataTable, Empty } from '../operations/ui.jsx';
import { dateTime } from '../operations/model.js';
import { canManageRanked } from '../../../shared/access.js';
import { playerWorkspacePath } from '../navigation.js';
import { rankedModeKey, rankedModeLabel } from './rankedLabels.js';
import {rankedPhaseLabel} from '../../../shared/ranked-lobby-presentation.js';
import { ModeTag } from './RankedTags.jsx';
import '../operations/operations.css';
import './ranked-monitor.css';

const STATUS = {voting:'Selección de mapa', drafting:'Formando equipos', ready:'Lista para jugar', reported:'Confirmando resultado', disputed:'En revisión'};
const number = value => new Intl.NumberFormat('es-ES', {maximumFractionDigits: 1}).format(value);
const duration = value => value == null ? '—' : value < 60 ? `${Math.round(value)} s` : value < 3600 ? `${Math.floor(value / 60)} min ${Math.floor(value % 60)} s` : `${Math.floor(value / 3600)} h ${Math.floor(value % 3600 / 60)} min`;

export function RankedQueuePlayers({data, queue = '', me, returnTo='/ranked/monitor'}) {
  const players = data.queue_players?.filter(row => !queue || row.queue_id === queue)
    .sort((a,b)=>(b.wait_seconds??-1)-(a.wait_seconds??-1)||a.joined_at.localeCompare(b.joined_at));
  const longWaits=players?.filter(row=>row.wait_seconds>=180).length||0;
  const parties = new Map();
  for (const player of players || []) if (player.party_id && !parties.has(player.party_id)) parties.set(player.party_id, parties.size + 1);
  const canView = canManageRanked(me);
  return <section className="op-card" aria-labelledby="ranked-queue-players"><div className="op-section-title"><div><h2 id="ranked-queue-players">Personas en cola</h2><p>La misma cola seleccionada arriba · sólo búsquedas con presencia vigente en esta lectura.</p></div>{players && <Badge value="active">{number(players.length)} {players.length===1?'persona mostrada':'personas mostradas'}</Badge>}</div>
    {players === undefined || players === null ? <p className="op-notice">CTP todavía no ofrece el detalle de personas en esta lectura. El contador de búsqueda no permite identificar a los jugadores.</p> : <>
      {longWaits>0&&<p className="op-notice" role="status"><Clock3 size={16}/> {number(longWaits)} {longWaits===1?'persona mostrada lleva':'personas mostradas llevan'} 3 minutos o más buscando. Revisa la cola y los tamaños de grupo; esta espera por sí sola no demuestra una avería.</p>}
      <DataTable rows={players} empty="No hay personas buscando en esta cola" emptyDetail="Aparecerán cuando estén buscando y su presencia siga vigente." columns={[
        {key:'username',title:'Persona',render:row => <span className="rm-queue-person"><strong>{row.username}</strong>{row.gamertag && row.gamertag !== row.username && <small className="muted">{row.gamertag}</small>}</span>},
        {key:'activision_id',title:'Activision ID'}, {key:'queue_title',title:'Cola'},
        {key:'party_id',title:'Grupo',render:row => row.party_id ? <span title="Miembros del mismo grupo buscando juntos">Grupo {parties.get(row.party_id)} · {row.party_size} personas</span> : 'Solo'},
        {key:'wait_seconds',title:'Espera',render:row => row.wait_seconds>=180?<strong className="rm-long-wait" title="Espera prolongada en esta lectura">{duration(row.wait_seconds)}</strong>:duration(row.wait_seconds)},
        {key:'joined_at',title:'Busca desde',render:row => dateTime(row.joined_at)},
        ...(canView ? [{key:'profile',title:'Jugador',render:row => <Link className="btn" to={playerWorkspacePath(row.user_id,returnTo)} aria-label={`Ver la ficha de ${row.username}`}>Ver ficha ↗</Link>}] : []),
      ]}/>
      <p className="muted rm-definition">Ordenadas por mayor espera en esta lectura, desde la entrada original a la cola. Los números de grupo sólo identifican a sus integrantes en esta vista; no son el tamaño del club. Esta consulta no renueva la presencia ni forma partidas.</p>
      {data.truncated.queue_players && <p className="op-notice">Se muestran hasta 200 personas, conservando los grupos completos. Los contadores superiores incluyen toda la cola.</p>}
    </>}
  </section>;
}

export function RankedMapPlays({data, me}) {
  return <section className="op-card" aria-labelledby="ranked-map-plays"><div className="op-section-title"><div><h2 id="ranked-map-plays">Mapas jugados</h2><p>Una partida por resultado confirmado y mapa seleccionado. Todas las colas y todo el historial disponible.</p></div>{me?.is_admin && <Link className="btn" to="/administracion/ranked">Administrar Ranked</Link>}</div>
    {data.map_plays === null || data.map_plays === undefined ? <p className="op-notice">El recuento de partidas por mapa no está disponible en esta versión de CTP. Los sorteos y los saltos antiguos no permiten deducir cuántas veces se jugó cada mapa.</p> : <>
      <DataTable rows={data.map_plays} empty="Todavía no hay mapas ni resultados confirmados" emptyDetail="El recuento aparecerá cuando CTP tenga mapas o resultados disponibles." columns={[
        {key:'map_name',title:'Mapa',render:row => <strong>{row.map_name}</strong>},
        {key:'mode',title:'Modo',render:row => rankedModeLabel(row.mode)},
        {key:'active_in_pool',title:'Rotación actual',render:row => <Badge value={row.active_in_pool?'active':'paused'}>{row.active_in_pool?'En rotación':'Histórico'}</Badge>},
        {key:'played_matches',title:'Partidas confirmadas',render:row => number(row.played_matches)},
        {key:'played_matches_24h',title:'Últimas 24 horas',render:row => number(row.played_matches_24h)},
        {key:'last_played_at',title:'Última confirmación',render:row => row.last_played_at ? dateTime(row.last_played_at) : '—'},
      ]}/>
      <p className="muted rm-definition">No cuenta votos, candidatos de la votación, selecciones sin resultado ni partidas canceladas. Cada encuentro confirmado cuenta una vez. Se conservan los mapas históricos aunque ya no estén en la rotación.</p>
      {data.truncated.map_plays && <p className="op-notice">Se muestran hasta 64 referencias de mapa. El listado puede estar incompleto.</p>}
    </>}
  </section>;
}

export default function RankedMonitorPage() {
  const {me} = useApp();
  const allowed=canManageRanked(me),actorKey=`${me?.id}:${me?.ctp_user_id||''}:${me?.ctp_role||''}`;
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [automatic,setAutomatic]=useState(true);
  const [params,setParams]=useSearchParams(),location=useLocation();
  const queue=params.get('queue')||'',status=params.get('status')||'',mode=params.get('mode')||'';
  const tab=['live','review','reports'].includes(params.get('tab'))?params.get('tab'):'live';
  const filter=(key,value)=>setParams(previous=>{const next=new URLSearchParams(previous);value?next.set(key,value):next.delete(key);return next;},{replace:true});
  const setQueue=value=>filter('queue',value),setStatus=value=>filter('status',value),setMode=value=>filter('mode',value);
  const returnTo=location.pathname+location.search;
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
  const lobbies = data?.active_lobbies.filter(row => (!queue || row.queue_id === queue) && (!status || row.status === status) && (tab!=='review'||row.status==='disputed'||row.open_disputes>0)
    && (!mode || (mode === 'pending' ? row.mode_pending : !row.mode_pending && rankedModeKey(row.mode) === mode))) || [];
  const queues = data?.queues.filter(row => !queue || row.id === queue) || [];
  const metrics = data ? [
    ['Colas simultáneas', data.summary.active_queues, `${number(data.summary.open_queues)} abiertas`, Activity],
    ['Jugadores buscando', data.summary.waiting_players, `${number(data.summary.solo_players)} solos · ${number(data.summary.waiting_parties)} grupos`, Users],
    ['Partidas activas', data.summary.active_lobbies, `${number(data.summary.players_in_lobbies)} jugadores en partida`, Activity],
    ['Espera más larga', duration(data.summary.waiting_players?data.queues.reduce((max,row) => Math.max(max,row.wait_max_seconds || 0),0):null), 'Colas consultadas, con presencia vigente', Clock3],
  ] : [];
  return <div className="page wide op-page rm-page">
    <header className="op-heading"><div><div className="op-eyebrow"><Activity size={15}/> COMPETICIÓN EN DIRECTO</div><h1>Ranked</h1><p>Colas simultáneas, partidas y resultados de la plataforma.</p></div><div className="op-actions"><button className="btn" aria-pressed={!automatic} onClick={() => setAutomatic(value => !value)}>{automatic ? <Pause size={16}/> : <Play size={16}/>} {automatic ? 'Pausar' : 'Activar'} actualización</button><button className="btn primary" disabled={busy} onClick={() => void load()}><RefreshCw size={16} className={busy?'spin':''}/> Actualizar</button></div></header>
    <div className={`op-connection ${stale||error?'is-stale':''}`} role="status"><span className={`rm-dot ${stale||error?'is-stale':''}`}/><span>{data ? `${stale||error?'Última lectura conservada':'Datos de CTP'} · ${dateTime(data.observed_at)}` : 'Conectando con CTP…'}</span><span className="op-connection-mode">{automatic?'Cada 15 s mientras esta pestaña está visible':'Actualización pausada'}</span></div>
    {error && <div className="op-error" role="alert"><CircleAlert size={18}/><span>{error}{data?' Los datos mostrados corresponden a la última lectura correcta.':''}</span><button className="btn" onClick={() => void load()} disabled={busy}>Reintentar</button></div>}
    {stale && !error && <p className="op-notice">Esta lectura tiene más de 45 segundos. Actualiza para comprobar el estado actual.</p>}
    <nav className="op-actions rm-tabs" aria-label="Vistas de Ranked">{[['live','En directo'],['review','En revisión'],['reports','Estadísticas']].map(([key,title])=><button className={`btn ${tab===key?'primary':''}`} aria-current={tab===key?'page':undefined} key={key} onClick={()=>filter('tab',key)}>{title}</button>)}<Link className="btn" to="/operaciones/historico">Historial</Link>{me.is_admin&&<Link className="btn" to="/administracion/ranked">Configuración</Link>}</nav>
    {!data ? busy ? <div className="op-loading"><Spinner/>Consultando Ranked…</div> : !error && <Empty title="Sin lectura disponible">Pulsa Actualizar para consultar CTP.</Empty> : <>
      <div className="op-metrics">{metrics.map(([title,value,detail,Icon]) => <div className="op-metric" key={title}><span><Icon size={16}/>{title}</span><strong>{typeof value === 'number'?number(value):value}</strong><small className="muted">{detail}</small></div>)}</div>
      <p className="muted rm-definition">Una cola simultánea tiene jugadores buscando o partidas activas. Los grupos y las esperas excluyen presencias caducadas. Los contadores superiores corresponden a todas las colas.</p>
      {tab==='live'&&<><section className="op-card"><div className="op-section-title"><div><h2>Colas de búsqueda</h2><p>Jugadores y grupos que buscan a la vez, con su espera actual.</p></div><label className="rm-filter">Cola<select value={queue} onChange={event => setQueue(event.target.value)}><option value="">Todas las colas</option>{data.queues.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select></label></div>
        <DataTable rows={queues} empty="No hay colas configuradas" emptyDetail="Las colas aparecerán cuando estén disponibles en CTP." columns={[
          {key:'title',title:'Cola',render:row => <strong>{row.title}</strong>}, {key:'is_open',title:'Búsqueda',render:row => <Badge value={row.is_open?'active':'paused'}>{row.is_open?'Abierta':'Cerrada'}</Badge>},
          {key:'waiting_players',title:'Buscando'}, {key:'solo_players',title:'Solos'}, {key:'waiting_parties',title:'Grupos'}, {key:'wait_avg_seconds',title:'Espera media',render:row => duration(row.wait_avg_seconds)}, {key:'wait_max_seconds',title:'Máxima',render:row => duration(row.wait_max_seconds)}, {key:'active_lobbies',title:'Partidas'}, {key:'map_count',title:'Mapas'}, {key:'presence_expired_players',title:'Presencia caducada'},
        ]}/>{data.truncated.queues && <p className="op-notice">Se muestran las primeras 50 colas. Los contadores globales incluyen todas.</p>}
      </section>
      <RankedQueuePlayers data={data} queue={queue} me={me} returnTo={returnTo}/></>}
      {tab!=='reports'&&<section className="op-card"><div className="op-section-title"><div><h2>{tab==='review'?'Partidas en revisión':'Partidas activas'}</h2><p>Desde la selección de mapa hasta la confirmación o revisión del resultado.</p></div><div className="rm-filters"><label className="rm-filter">Modo<select value={mode} onChange={event => setMode(event.target.value)}><option value="">Todos los modos</option><option value="hp">Punto caliente</option><option value="snd">BYD</option><option value="pending">Votando modo</option></select></label><label className="rm-filter">Estado<select value={status} onChange={event => setStatus(event.target.value)}><option value="">Todos los estados</option>{Object.entries(STATUS).map(([key,title]) => <option key={key} value={key}>{title}</option>)}</select></label></div></div>
        <div className="rm-statuses">{data.lobby_statuses.map(row => <span key={row.status}><span className="muted">{STATUS[row.status]}</span><strong>{number(row.count)}</strong></span>)}</div>
        <DataTable rows={lobbies} empty="Sin partidas en esta vista" emptyDetail="Cuando se forme una partida aparecerá aquí con su estado real." columns={[
          {key:'id',title:'Partida',render:row => <Link to={`/ranked/partidas/${encodeURIComponent(row.id)}?returnTo=${encodeURIComponent(returnTo)}`} title="Abrir equipos, chat y resultado" className="rm-id">{row.id.slice(0,8)} ↗</Link>}, {key:'queue_title',title:'Cola'}, {key:'mode',title:'Modo',render:row => <ModeTag mode={row.mode} pending={row.mode_pending}/>}, {key:'status',title:'Estado',render:row => <Badge value={row.status}>{rankedPhaseLabel(row)}</Badge>}, {key:'map_name',title:'Mapa',render:row => row.map_name || 'Por decidir'}, {key:'players',title:'Jugadores',render:row => `${row.players} · ${row.side_a}/${row.side_b}`}, {key:'age_seconds',title:'Desde formación',render:row => duration(row.age_seconds)}, {key:'result_votes',title:'Votos resultado'}, {key:'open_disputes',title:'Disputas'}, {key:'deadline_at',title:'Plazo',render:row => row.deadline_at?dateTime(row.deadline_at):'—'},
        ]}/>{data.truncated.active_lobbies && <p className="op-notice">Se muestran hasta 50 partidas. Los contadores incluyen todas las partidas activas.</p>}
      </section>}
      {tab==='reports'&&<><section className="op-card"><div className="op-section-title"><div><h2>Actividad de las últimas 24 horas</h2><p>{dateTime(data.window_started_at)} → {dateTime(data.observed_at)} · Todas las colas</p></div></div>
        <div className="rm-history">{[['Formadas','created_matches'],['Resultados cerrados','completed_matches'],['Canceladas','cancelled_matches'],['Disputas abiertas','disputes_opened']].map(([title,key]) => <div key={key}><span className="muted">{title}</span><strong>{number(data.activity_24h[key])}</strong></div>)}<div><span className="muted">Tiempo medio hasta resolución</span><strong>{duration(data.activity_24h.duration_avg_seconds)}</strong></div></div>
        <p className="muted rm-definition">Resultados y cancelaciones cerrados en este intervalo. El tiempo hasta resolución incluye preparación y confirmación; no mide el tiempo de juego dentro de Call of Duty.</p>
      </section>
      <RankedMapPlays data={data} me={me}/></>}
    </>}
  </div>;
}
