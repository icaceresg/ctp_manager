import { MatchConversation } from './CaseControls.jsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { Activity, ArrowLeft, ArrowUpRight, CheckCircle2, CircleAlert, Clock3, Info, Radio, RefreshCw, Settings2, ShieldCheck, Users } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Modal, Spinner } from '../components/ui.jsx';
import { OP_TABS, OP_TAB_ALIASES, dateTime, label, matchName, teamName, approvedMaps, playersForMap, rosterRows, officialResult, playerInsights } from './model.js';
import { AuditList, Badge, DataTable, Empty, Field, FormDialog, MatchLink, StatsTable, WebLink } from './ui.jsx';
import { IncidentsPanel, StatisticsPanel } from './ReviewPanels.jsx';
import { SanctionsPanel } from './SanctionsPanel.jsx';
import { AssignmentsPanel, ProductionPanel, ClubsPanel, DiscordPanel, ContentPanel, IntegrationPanel } from './WorkPanels.jsx';
import { StaffDesk } from './StaffDesk.jsx';
import { CLOSED_INCIDENTS } from './staffModel.js';
import { CompetitionPanel } from './CompetitionPanels.jsx';
import { HistoryPanel } from './HistoryPanel.jsx';
import { DecisionPanel } from './DecisionPanel.jsx';
import { GuardPanel } from './GuardPanel.jsx';
import { MatchControlPanel, RefereeMatchQueue } from './MatchControlPanel.jsx';
import { RankedSeasonPanel } from './RankedSeasonPanel.jsx';
import { matchReturnPath } from '../navigation.js';
import './operations.css';
import { workspaceRequest, workspacePageParams, workspaceFirstPageParams } from './workspaceQuery.js';
import { useWorkspaceSearch } from './useWorkspaceSearch.js';

function useOperations(url) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);
  const requestId = useRef(0);
  const viewKey=new URLSearchParams(url.split('?')[1]).get('view');
  const previousView=useRef(viewKey);
  const reload = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const next = await api.get(url);
      if (mounted.current && id === requestId.current) { setData(next); setError(''); }
    } catch (err) { if (mounted.current && id === requestId.current) { setError(err.message); if ([401, 403].includes(err.status)) setData(null); } }
    finally { if (mounted.current && id === requestId.current) setLoading(false); }
  }, [url]);
  useEffect(() => {
    mounted.current = true;
    if(previousView.current!==viewKey){previousView.current=viewKey;setLoading(true);setData(null);}
    setError('');
    // Search is sent to SQLite; debounce keystrokes before creating network work.
    const initial=setTimeout(reload,200);
    const interval = setInterval(() => { if (!document.hidden) reload(); }, 20000);
    return () => { mounted.current = false;requestId.current++;clearTimeout(initial); clearInterval(interval); };
  }, [reload]);
  return { data, error, loading, reload };
}

export function OperationsPage() {
  const { view = 'jornada', matchId } = useParams();
  const [params,setParams]=useSearchParams();
  const { can, me, toast } = useApp();
  const request=workspaceRequest(view,matchId,params);
  const filterKey=request.replace(/&(?:page|match_page|revision)=[^&]*/g,'');
  const previousFilter=useRef(filterKey);
  useEffect(()=>{if(previousFilter.current!==filterKey){previousFilter.current=filterKey;if(params.has('op_page')||params.has('op_match_page'))setParams(workspaceFirstPageParams,{replace:true});}},[filterKey,params,setParams]);
  const { data, error, loading, reload } = useOperations(request);
  const [busy, setBusy] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const tabs = OP_TABS.filter((t) => t.sections.some(can));
  const mutate = async (method, path, body, message = 'Guardado en Manager.') => {
    const result = await api[method](`/operations${path}`, body);
    await reload(); toast(message); return result;
  };
  const sync = async () => {
    if (busy) return;
    setBusy(true);
    try { await api.post('/operations/integration/sync', {}); await reload(); toast('Datos de CTP actualizados.'); }
    catch (err) { toast(err.message, 'error'); }
    finally { setBusy(false); }
  };
  if (!matchId && OP_TAB_ALIASES[view]) return <Navigate to={`/operaciones/${OP_TAB_ALIASES[view]}`} replace />;
  if (!matchId && view !== 'integracion' && !tabs.some((t) => t.id === view)) return <Navigate to={`/operaciones/${tabs[0]?.id || 'jornada'}`} replace />;
  if (view === 'integracion' && !me.is_admin) return <Navigate to="/operaciones/jornada" replace />;
  const connection = data?.connection || {};
  const lastSync = connection.last_sync_at || connection.last_success_at;
  const stale = !connection.configured || Boolean(connection.last_error) || !lastSync || Date.now() - new Date(lastSync).getTime() > 120000;
  const currentTitle = matchId ? 'Ficha de partido' : view === 'integracion' ? 'Conexión CTP' : view === 'jornada' ? 'Inicio' : tabs.find((tab) => tab.id === view)?.title || 'Mi jornada';
  const props = { data, mutate, reload, can, me };
  return <div className="page wide op-page">
    <header className="op-heading op-heading-compact">
      <div><div className="op-eyebrow"><Activity size={14} /> CTP / STAFF</div><h1>{currentTitle}</h1></div>
      <div className="op-header-actions">
        {connection.local_test_mode && <span className="op-env-badge" role="note">QA LOCAL · SIN PRE</span>}
        <button type="button" className={`op-status-button ${stale ? 'is-stale' : ''}`} onClick={() => setConnectionOpen(true)} aria-label="Ver estado de la conexión CTP">
          {stale ? <Clock3 size={15} /> : <CheckCircle2 size={15} />}<span>{stale ? 'Datos por actualizar' : 'CTP actualizado'}</span><Info size={14} />
        </button>
        {(me.is_admin || can('operaciones')) && <button className="btn" onClick={sync} disabled={busy || loading || !connection.configured}><RefreshCw size={16} className={busy ? 'spin' : ''} /> Actualizar</button>}
      </div>
    </header>
    {connectionOpen && <Modal title="Estado de CTP" onClose={() => setConnectionOpen(false)}><div className="op-connection-detail"><p><strong>Última lectura:</strong> {lastSync ? dateTime(lastSync) : 'Aún sin sincronizar'}</p><p><strong>Estado:</strong> {!connection.configured ? 'Conexión pendiente' : connection.last_error ? `Error: ${connection.last_error}` : stale ? 'Datos desactualizados' : 'Datos actualizados'}</p><p><strong>Cambios oficiales:</strong> {connection.write_enabled ? 'Envío manual habilitado' : 'Envío desactivado'}</p>{connection.local_test_mode && <p><strong>Entorno:</strong> QA local. Esta instancia no está conectada a Supabase PRE.</p>}{me.is_admin && <Link className="btn" onClick={() => setConnectionOpen(false)} to="/operaciones/integracion"><Settings2 size={16} /> Configurar conexión</Link>}</div></Modal>}
    {connection.possibly_truncated && <p className="op-notice">CTP ha devuelto una consulta parcial. Puede haber más registros fuera de esta selección; los totales corresponden solo a los datos recibidos.</p>}

    {error && <div className="op-error" role="alert"><CircleAlert size={18} /><span>{error}{data ? ' Se conserva la última consulta.' : ''}</span><button className="btn" onClick={()=>params.has('op_page')||params.has('op_match_page')?setParams(workspaceFirstPageParams,{replace:true}):reload()}>{params.has('op_page')||params.has('op_match_page')?'Volver a la primera página':'Reintentar'}</button></div>}
    {loading ? <div className="op-loading"><Spinner size={24} /> Cargando operaciones…</div> : !data ? <Empty title="No se han podido cargar las operaciones">Comprueba la conexión con el Manager y vuelve a intentarlo.</Empty> : matchId ? <MatchDossier key={matchId} id={matchId} {...props} /> : <>
      {view === 'jornada' && <StaffDesk {...props} />}
      {view === 'torneos' && <><CompetitionPanel {...props} /><RankedSeasonPanel {...props} /></>}
      {view === 'historico' && <HistoryPanel {...props} />}
      {view === 'decisiones' && <DecisionPanel {...props} />}
      {view === 'incidencias' && <IncidentsPanel {...props} />}
      {view === 'arbitraje' && <RefereeMatchQueue {...props} />}
      {view === 'turnos' && <AssignmentsPanel {...props} />}
      {view === 'casters' && <CasterIndex {...props} />}
      {view === 'realizacion' && <ProductionPanel {...props} />}
      {view === 'estadisticas' && <StatisticsPanel {...props} />}
      {view === 'clubes' && <ClubsPanel {...props} />}
      {view === 'discord' && <DiscordPanel {...props} />}
      {view === 'sanciones' && <SanctionsPanel {...props} />}
      {view === 'contenido' && <ContentPanel {...props} />}
      {view === 'integracion' && <IntegrationPanel {...props} />}
      {data.primary&&data.pages?.[data.primary]&&<WorkspacePagination data={data} setParams={setParams}/>}
      {view==='turnos'&&data.pages?.matches&&<WorkspacePagination data={data} setParams={setParams} resource="matches" title="Partidos de la semana"/>}
      {view==='jornada'&&<div className="op-actions">{[['incidents','incidencias','expedientes'],['stats','estadisticas','estadísticas'],['clubs','clubes','clubes'],['deliveries','discord','entregas'],['assignments','turnos','turnos']].filter(([key])=>data.pages?.[key]?.has_more).map(([key,path,title])=><Link key={key} className="btn" to={`/operaciones/${path}`}>Ver {title} ({data.pages[key].total}) <ArrowUpRight size={14}/></Link>)}</div>}
    </>}
  </div>;
}

function WorkspacePagination({data,setParams,resource=data.primary,title='Registros'}) {
  const page=data.pages[resource];
  if(page.total<=page.limit&&page.page===0)return null;
  const change=value=>setParams(previous=>workspacePageParams(previous,value,data.revision,resource==='matches'&&data.primary!=='matches'?'op_match_page':'op_page'),{replace:true});
  return <nav className="op-pagination op-card" aria-label={`Páginas de ${title.toLowerCase()}`}><span>{title}: {page.total} · página {page.page+1} de {Math.max(1,Math.ceil(page.total/page.limit))}</span><div className="op-actions"><button className="btn" disabled={page.page===0} onClick={()=>change(0)}>Primera</button><button className="btn" disabled={page.page===0} onClick={()=>change(page.page-1)}>Anterior</button><button className="btn" disabled={!page.has_more} onClick={()=>change(page.page+1)}>Siguiente</button></div></nav>;
}

function MatchCard({ match: m, data }) {
  const location = useLocation();
  const issues = (data.incidents || []).filter((i) => i.match_id === m.id && !CLOSED_INCIDENTS.includes(i.status));
  const assignedCount = data.coverage ? Object.values(data.coverage[m.id]||{}).reduce((total,role)=>total+role.confirmed,0) : (data.assignments || []).filter((a) => a.match_id === m.id && a.status === 'confirmed').length;
  return <Link state={{ returnTo: location.pathname + location.search }} to={`/operaciones/partidos/${encodeURIComponent(m.id)}`} className="op-match-card">
    <div className="op-match-meta"><span>{label(m.kind)}</span><Badge value={m.status} /></div>
    <div className="op-match-teams"><strong>{teamName(m.team_a)}</strong><div className="op-score">{m.confirmed ? officialResult(m) : 'VS'}</div><strong>{teamName(m.team_b)}</strong></div>
    <div className="op-match-time"><Clock3 size={14} />{dateTime(m.scheduled_at)}</div>
    <div className="op-match-bottom"><span>{issues.length ? `${issues.length} incidencia${issues.length > 1 ? 's' : ''}` : 'Sin incidencias visibles'}</span><span>{assignedCount} staff confirmado <ArrowUpRight size={14} /></span></div>
  </Link>;
}
function CasterIndex({ data }) {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const [search,setSearch]=useWorkspaceSearch(params,setParams);
  const [limit, setLimit] = useState(24);
  const matches = data.matches;
  return <><div className="op-section-title"><div><h2>Preparar la narración</h2><p>Roster, mapas y estadísticas aprobadas.</p></div><div className="op-filters"><input aria-label="Buscar dossier de partido" placeholder="Equipo o torneo…" value={search} onChange={event => { setSearch(event.target.value); setLimit(24); }} />{query && <button className="btn" onClick={() => setSearch('')}>Limpiar búsqueda</button>}</div></div><div className="op-match-grid">{matches.slice(0, limit).map(match => <MatchCard key={match.id} match={match} data={data} />)}</div>{matches.length > limit && <button className="btn" onClick={() => setLimit(value => value + 24)}>Ver más partidos</button>}{!matches.length && <Empty title={query ? 'No hay partidos con esa búsqueda' : 'Sin partidos sincronizados'}>{query ? 'Prueba otro equipo o borra la búsqueda.' : 'Cada partido tendrá aquí su dossier para casters.'}</Empty>}</>;
}
function MatchDossier({ id, data, mutate, can, reload }) {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const section = ['stats', 'maps', 'notes', ...(can('arbitraje') ? ['incidents'] : [])].includes(params.get('tab')) ? params.get('tab') : 'summary';
  const returnTo = matchReturnPath(location.state?.returnTo);
  const backLabel = returnTo.startsWith('/operaciones/jornada') ? 'Volver a la jornada' : 'Volver a la lista';
  const changeSection = value => setParams(previous => { const next = new URLSearchParams(previous); value === 'summary' ? next.delete('tab') : next.set('tab', value); return next; }, { replace: true, state: location.state });
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState(false);
  const missingId = useRef(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (missingId.current === id) return;
    let active = true;
    api.get(`/operations/matches/${encodeURIComponent(id)}`).then((d) => { if (active) { setDetail(d); setError(''); } }).catch((err) => { if (active) { if (err.status === 404) missingId.current = id; setError(err.message); } });
    return () => { active = false; };
  }, [id, data, retry]);
  if (error) return <section className="op-card"><Link to={returnTo}><ArrowLeft size={14} /> {backLabel}</Link><p className="op-error" role="alert">{error}</p><button className="btn" onClick={() => { missingId.current = null; setError(''); setRetry((value) => value + 1); }}>Reintentar</button></section>;
  if (!detail) return <Spinner size={24} />;
  const m = detail.match;
  const maps = approvedMaps(detail.statistics?.length ? detail.statistics : m.statistics);
  const insights = playerInsights([{...m,statistics:detail.statistics}], rosterRows(m.roster).map((p) => p.id || p.player_id || p.user_id));
  return <>
    <div className="op-section-title"><Link to={returnTo}><ArrowLeft size={15} /> {backLabel}</Link><div className="op-actions">{can('realizacion') && <Link className="btn" to={`/operaciones/realizacion?match=${encodeURIComponent(id)}`}>Preparar directo <ArrowUpRight size={14} /></Link>}<WebLink match={m} origin={data.connection?.web_origin} /></div></div>
    <section className="op-dossier-hero"><div className="op-match-meta"><span>{label(m.kind)} · {dateTime(m.scheduled_at)}</span><Badge value={m.status} /></div><h2>{matchName(m)}</h2><p>{m.confirmed ? `Resultado confirmado: ${officialResult(m)}` : 'Resultado oficial pendiente de confirmación'}</p><small>Actualizado: {dateTime(m.synced_at || m.updated_at || data.connection?.last_sync_at)}</small></section>
    <nav className="op-dossier-nav" aria-label="Información del partido">
      {[{ id: 'summary', title: 'Resumen' }, { id: 'stats', title: 'Estadísticas', count: maps.length }, { id: 'maps', title: 'Mapas' }, { id: 'notes', title: 'Notas', count: detail.notes?.length }, ...(can('arbitraje') ? [{ id: 'incidents', title: 'Incidencias', count: detail.incidents?.length }] : [])].map(tab => <button type="button" key={tab.id} className={section === tab.id ? 'is-active' : ''} aria-current={section === tab.id ? 'page' : undefined} onClick={() => changeSection(tab.id)}>{tab.title}{Boolean(tab.count) && <span>{tab.count}</span>}</button>)}
    </nav>
    {section === 'summary' && <>
    {can('arbitraje') && <div className="op-actions"><Link className="btn" to={`/operaciones/estadisticas?match=${encodeURIComponent(id)}`}>Revisar estadísticas de este partido <ArrowUpRight size={14} /></Link><button className="btn" onClick={() => changeSection('incidents')}>Ver incidencias{detail.incidents?.length ? ` · ${detail.incidents.length}` : ''}</button></div>}
    {can('arbitraje') && m.kind === 'tournament' && <GuardPanel key={id} id={id} />}
    {can('arbitraje') && m.kind === 'tournament' && <MatchControlPanel id={id} data={data} reload={reload} mutate={mutate} />}
    {can('arbitraje') && m.kind === 'challenge' && <MatchConversation kind={m.kind} id={id} data={data} reload={reload} mutate={mutate} />}
    <div className="op-two-columns"><section className="op-card"><details className="op-roster-details"><summary>Roster del encuentro · {rosterRows(m.roster).length} jugadores</summary><DataTable rows={rosterRows(m.roster)} columns={[{ key: 'name', title: 'Jugador', render: (p) => p.username || p.gamertag || p.name || 'Sin identificar' }, { key: 'side', title: 'Equipo', render: (p) => p.team_name || (['a', 'A', 'team_a'].includes(p.side) ? teamName(m.team_a) : ['b', 'B', 'team_b'].includes(p.side) ? teamName(m.team_b) : 'Sin asignar') }]} empty="Roster no disponible" /></details></section>
      <section className="op-card"><h2>Equipo asignado</h2><DataTable rows={detail.assignments || []} columns={[{ key: 'user_name', title: 'Persona', render: (a) => a.user_name || data.staff?.find((s) => s.id === a.user_id)?.name || 'Usuario' }, { key: 'role', title: 'Función', render: (a) => label(a.role) }, { key: 'status', title: 'Estado', render: (a) => <Badge value={a.status} /> }]} empty="Sin personal asignado" />{can('operaciones') && <Link className="btn" to={`/operaciones/turnos?match=${encodeURIComponent(id)}`}>Asignar equipo <ArrowUpRight size={14} /></Link>}</section></div>
    </>}
    {section === 'stats' && <>
    <section className="op-card"><div className="op-section-title"><div><h2>Estadísticas oficiales</h2><p>Solo mapas aprobados. «—» indica un dato no disponible.</p></div><span className="op-count">{maps.length} mapas</span></div>{maps.length ? maps.map((map) => <div className="op-stat-map" key={map.id || `${map.map_name}-${map.map_number}`}><div className="op-section-title"><h3>{map.map_name || `Mapa ${map.map_number || ''}`} · {map.mode || 'Modo sin indicar'}</h3><Badge value="approved" /></div><StatsTable players={playersForMap(map)} objectiveLabel={map.objective_label} /></div>) : <Empty title="Todavía no hay estadísticas aprobadas">Las cifras pendientes de revisión no se incluyen en la narración ni en las comparativas.</Empty>}</section>
    {insights.length > 0 && <section className="op-card"><div><h2>Comparativa del roster</h2><p className="muted">K/D de los mapas aprobados disponibles en la consulta. No representa toda la carrera del jugador.</p></div><div className="op-player-insights">{insights.map((r) => <div className="op-insight" key={r.id}><div><strong>{r.name}</strong><span>{r.kd === null ? '—' : r.kd.toFixed(2)} <small>K/D</small></span></div><div className="op-insight-bar" aria-hidden="true"><span style={{ width: `${r.kd === null ? 0 : Math.min(100, r.kd / Math.max(2, ...insights.map((x) => x.kd || 0)) * 100)}%` }} /></div><small>{r.complete_maps} de {r.maps} mapas con bajas y muertes completas · {r.modes.map((mode) => `${mode.name}: ${mode.maps}`).join(' · ')}</small></div>)}</div></section>}
    </>}
    {section === 'maps' && <>
    {m.maps?.length > 0 ? <section className="op-card"><h2>Mapas del encuentro</h2><DataTable rows={m.maps} columns={[{ key: 'map_number', title: 'Orden', render: (map) => map.map_number ?? '—' }, { key: 'map_name', title: 'Mapa', render: (map) => typeof map === 'string' ? map : map.map_name || map.name }, { key: 'mode', title: 'Modo' }]} /></section> : <Empty title="Mapas todavía no disponibles">Se mostrarán cuando CTP publique la serie del partido.</Empty>}
    </>}
    {section === 'notes' && <>
    <section className="op-card"><div className="op-section-title"><h2>Notas de narración</h2>{can('casters') && <button className="btn" onClick={() => setEditor(true)}>Añadir nota</button>}</div>{detail.notes?.length ? <ol className="op-notes">{detail.notes.map((n) => <li key={n.id}><p>{n.text}</p><small>{n.author_name || n.actor_name || 'Staff'} · {dateTime(n.created_at)}</small></li>)}</ol> : <p className="muted">Guarda aquí pronunciaciones, contexto y apuntes para la emisión.</p>}</section>
    </>}
    {section === 'incidents' && <>
    {can('arbitraje') && <section className="op-card"><h2>Incidencias vinculadas</h2><DataTable rows={detail.incidents || []} columns={[{ key: 'title', title: 'Expediente', render: (i) => <Link to={`/operaciones/incidencias?case=${encodeURIComponent(i.id)}`}>{i.title}</Link> }, { key: 'status', title: 'Estado', render: (i) => <Badge value={i.status} /> }]} empty="Sin incidencias vinculadas" /></section>}
    </>}
    {editor && <FormDialog title="Nota para casters" onClose={() => setEditor(false)} submit={(body) => mutate('post', `/matches/${encodeURIComponent(id)}/notes`, body)}><Field label="Nota editorial"><textarea name="text" maxLength={4000} rows={5} required /></Field></FormDialog>}
  </>;
}
