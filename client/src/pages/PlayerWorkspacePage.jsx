import {useEffect,useState} from 'react';
import {Link,Navigate,useLocation,useParams,useSearchParams} from 'react-router-dom';
import {ArrowLeft,ArrowUpRight,RefreshCw,Search,UserRound} from 'lucide-react';
import {api} from '../api.js';
import {useApp,useData} from '../context.jsx';
import {Spinner} from '../components/ui.jsx';
import {Badge,DataTable,Empty} from '../operations/ui.jsx';
import {dateTime} from '../operations/model.js';
import {canManageRanked} from '../../../shared/access.js';
import {managerUserId,operationReturnPath,playerWorkspacePath,userProfileEditPath} from '../navigation.js';
import {divisionLabel} from './rankedLabels.js';
import {ModeTag} from './RankedTags.jsx';
import {PLAYER_PAGE_SIZE,participationLabel,playerOffset,playerResult,playerTab,playerWaitSeconds} from './playerWorkspaceModel.js';
import '../operations/operations.css';
import './player-workspace.css';

const ROLES={admin:'Administrador',referee:'Árbitro',player:'Jugador'};
const n=value=>value.toLocaleString('es-ES');
const signed=value=>value>0?`+${n(value)}`:n(value);
const side=value=>value==='a'?'Equipo A':value==='b'?'Equipo B':'Sin equipo asignado';
const dateCell=value=>value?dateTime(value):'—';
const waitTime=seconds=>seconds<60?`${seconds} s`:`${n(Math.floor(seconds/60))} min ${seconds%60} s`;

export default function PlayerWorkspacePage(){
 const {me}=useApp(),allowed=canManageRanked(me),{userId}=useParams(),location=useLocation();
 const [params,setParams]=useSearchParams(),query=(params.get('q')||'').slice(0,120),offset=playerOffset(params.get('offset'));
 const id=managerUserId(userId)?.toLowerCase(),detail=Boolean(userId),tab=playerTab(params.get('tab'));
 const resultsOffset=playerOffset(params.get('results_offset')),ticketsOffset=playerOffset(params.get('tickets_offset')),sanctionsOffset=playerOffset(params.get('sanctions_offset'));
 const [search,setSearch]=useState(query);
 useEffect(()=>setSearch(query),[query]);
 const filters=new URLSearchParams({limit:String(PLAYER_PAGE_SIZE),...(detail?{results_offset:String(resultsOffset),tickets_offset:String(ticketsOffset),sanctions_offset:String(sanctionsOffset)}:{query,offset:String(offset)})});
 const requestKey=JSON.stringify([me?.id,me?.ctp_user_id,me?.ctp_role,Boolean(me?.is_admin),id||'search',filters.toString()]);
 const {data:loaded,loading,error,reload}=useData(async()=>{
  if(!allowed||detail&&!id)return null;
  const result=await api.get(detail?`/players/${id}?${filters}`:`/players?${filters}`);
  return {...result,request_key:requestKey};
 },[requestKey,allowed]);
 const data=loaded?.request_key===requestKey?loaded:null;
 const waiting=playerWaitSeconds(data?.participation,data?.observed_at);
 const change=(key,value)=>setParams(previous=>{const next=new URLSearchParams(previous);value?next.set(key,String(value)):next.delete(key);return next;});
 const submit=event=>{event.preventDefault();setParams(previous=>{const next=new URLSearchParams(previous);search.trim()?next.set('q',search.trim()):next.delete('q');next.delete('offset');return next;});};
 const currentPath=location.pathname+location.search;
 const returnTo=operationReturnPath(params.get('returnTo'),'/jugadores');
 if(!allowed)return <Navigate to="/operaciones/jornada" replace/>;
 return <div className="page wide op-page pw-page">
  <header className="op-heading"><div><div className="op-eyebrow"><UserRound size={15}/> JUGADORES CTP</div><h1>{detail?data?.user.username||'Ficha de jugador':'Jugadores'}</h1><p>{detail?'Cuenta, actividad Ranked y expedientes de esta persona.':'Busca una persona y abre su cuenta, partidas e incidencias.'}</p></div><button className="btn" disabled={loading||detail&&!id} onClick={reload}><RefreshCw size={16} className={loading?'spin':''}/> Actualizar</button></header>
  {detail&&<div className="op-actions"><Link className="btn" to={returnTo}><ArrowLeft size={15}/> Volver al contexto</Link>{returnTo!=='/jugadores'&&<Link className="btn" to="/jugadores">Buscar otro jugador</Link>}</div>}
  {error&&<div className="op-error" role="alert"><span>{error.message}{data?' Se conserva la última lectura correcta.':''}</span><button className="btn" disabled={loading} onClick={reload}>Reintentar</button></div>}
  {detail&&!id?<Empty title="Referencia de cuenta no válida">Abre la ficha desde un jugador identificado o busca su nombre en Jugadores.</Empty>:<>
   {data&&<p className="muted pw-observed" role="status">{error?'Última lectura conservada':'Datos de CTP'} · {dateTime(data.observed_at)} · Actualización manual</p>}
   {!detail&&<section className="op-card"><form className="op-filters pw-search" onSubmit={submit}><label className="sr-only" htmlFor="player-search">Buscar jugador</label><input id="player-search" placeholder="Nickname, gamertag, Activision ID o ID de cuenta…" value={search} onChange={event=>setSearch(event.target.value)} maxLength={120}/><button className="btn primary" disabled={loading}><Search size={16}/> Buscar</button>{query&&<button type="button" className="btn" onClick={()=>{setSearch('');setParams({});}}>Limpiar</button>}</form>
    {data&&<><p className="muted">{n(data.total)} cuentas encontradas</p><DataTable rows={data.items} empty="No hay coincidencias" emptyDetail="Prueba el nickname, gamertag, Activision ID o el ID exacto de la cuenta." columns={[
     {key:'username',title:'Jugador',render:row=><Link className="pw-name" to={playerWorkspacePath(row.id,currentPath)}><strong>{row.username}</strong><ArrowUpRight size={14}/></Link>},
     {key:'gamertag',title:'Gamertag'}, {key:'activision_id',title:'Activision ID'}, {key:'platform',title:'Plataforma'},
     {key:'role',title:'Rol',render:row=>ROLES[row.role]||row.role},{key:'created_at',title:'Alta',render:row=>dateTime(row.created_at)},
    ]}/><Pagination page={{available:true,offset:data.offset,limit:data.limit,total:data.total,has_more:data.total>data.offset+data.limit}} busy={loading} onPage={value=>change('offset',value)} label="cuentas"/></>}
   </section>}
   {loading&&!data&&<div className="op-loading" role="status"><Spinner/> Consultando {detail?'la ficha':'jugadores'}…</div>}
   {detail&&data&&<>
    <section className="op-card pw-identity"><div><h2>{data.user.username}</h2><div className="op-actions"><Badge value={data.user.closed?'closed':'active'}>{data.user.closed?'Cuenta cerrada':'Cuenta activa'}</Badge><span>{ROLES[data.user.role]} · {data.user.platform}</span>{data.user.login_banned_until&&<Badge value="blocked">Acceso bloqueado hasta {dateTime(data.user.login_banned_until)}</Badge>}</div><dl className="pw-fields"><div><dt>Gamertag</dt><dd>{data.user.gamertag||'—'}</dd></div><div><dt>Activision ID</dt><dd>{data.user.activision_id||'—'}</dd></div><div><dt>Alta</dt><dd>{dateTime(data.user.created_at)}</dd></div><div><dt>Confirmación de cuenta</dt><dd>{data.user.email_confirmed?'Confirmada':'Pendiente'}</dd></div><div className="pw-account-id"><dt>ID de cuenta</dt><dd>{data.user.id}</dd></div></dl>{data.clubs.length>0&&<p className="muted">Clubes actuales: {data.clubs.map(club=>club.name).join(' · ')}</p>}</div><div className="op-actions">{me.is_admin&&data.viewer.can_edit&&<Link className="btn" to={userProfileEditPath(data.user.id,currentPath)}>Editar datos de cuenta</Link>}</div></section>
    <nav className="op-tabs" aria-label="Ficha del jugador">{[['summary','Resumen'],['results','Partidas'],['tickets','Incidencias'],['sanctions','Sanciones']].map(([key,title])=><button key={key} className={tab===key?'active':''} aria-current={tab===key?'page':undefined} onClick={()=>change('tab',key==='summary'?'':key)}>{title}{key!=='summary'&&data[key].available?<span> {n(data[key].total)}</span>:null}</button>)}</nav>
    {tab==='summary'&&<div className="pw-grid"><section className="op-card"><h2>Ranked · temporada activa</h2>{data.rating?<><div className="op-metrics"><div className="op-metric"><span>División</span><strong>{divisionLabel(data.rating.division_id)||'—'}</strong><small>{n(data.rating.xp)} XP · máximo {n(data.rating.peak_xp)}</small></div><div className="op-metric"><span>Partidas valoradas</span><strong>{n(data.rating.games)}</strong><small>{n(data.rating.wins)} victorias · {n(data.rating.losses)} derrotas</small></div><div className="op-metric"><span>Racha de victorias</span><strong>{n(data.rating.win_streak)}</strong><small>Resultados confirmados</small></div></div><p className="muted">Valoración actualizada {dateTime(data.rating.updated_at)}</p></>:<Empty title="Sin valoración en la temporada activa">No hay una valoración Ranked registrada para esta cuenta en la temporada activa.</Empty>}</section><section className="op-card"><h2>Actividad actual</h2><p><Badge value={data.participation.state==='in_lobby'?'active':data.participation.state==='queued'?'pending':'closed'}>{participationLabel(data.participation.state)}</Badge></p>{data.participation.queue&&<p>{data.participation.queue.title}</p>}{waiting!==null&&<p className="pw-wait"><strong>{waitTime(waiting)}</strong><span>Espera en esta lectura</span></p>}{data.participation.joined_at&&<p className="muted">En esta cola desde {dateTime(data.participation.joined_at)}</p>}{data.participation.lobby&&<><p><Badge value={data.participation.lobby.status}/> · {side(data.participation.lobby.side)}</p><p>{data.participation.lobby.map_name||'Mapa por decidir'}</p><Link className="btn primary" to={`/ranked/partidas/${data.participation.lobby.id}?returnTo=${encodeURIComponent(currentPath)}`}>Abrir partida <ArrowUpRight size={14}/></Link></>}{data.participation.state==='queued'&&<Link className="btn" to={`/ranked/monitor?queue=${data.participation.queue.id}`}>Abrir cola <ArrowUpRight size={14}/></Link>}<p className="muted">La presencia de cola no indica si está conectado a Call of Duty. Esta lectura no renueva su presencia.</p></section></div>}
    {tab==='results'&&<section className="op-card"><h2>Partidas terminadas</h2><DataTable rows={data.results.items} empty="Sin partidas terminadas" emptyDetail="Esta cuenta todavía no tiene partidas cerradas o canceladas registradas." columns={[
     {key:'id',title:'Partida',render:row=><Link to={`/ranked/partidas/${row.id}?returnTo=${encodeURIComponent(currentPath)}`}>{row.id.slice(0,8)} ↗</Link>},
     {key:'closed_at',title:'Cierre',render:row=>dateCell(row.closed_at)},{key:'mode',title:'Modo',render:row=><ModeTag mode={row.mode}/>},{key:'map_name',title:'Mapa'},
     {key:'result',title:'Resultado',render:playerResult},{key:'xp_delta',title:'Cambio XP',render:row=>row.xp_delta===null?'—':signed(row.xp_delta)},{key:'new_xp',title:'XP tras partida',render:row=>row.new_xp===null?'—':n(row.new_xp)},
    ]}/><p className="muted">Los registros antiguos sin XP disponible se muestran con «—».</p><Pagination page={data.results} busy={loading} onPage={value=>change('results_offset',value)} label="partidas"/></section>}
    {tab==='tickets'&&<section className="op-card"><h2>Incidencias abiertas por esta persona</h2>{data.tickets.available?<><DataTable rows={data.tickets.items} empty="Sin incidencias registradas" emptyDetail="No hay tickets de esta cuenta en CTP." columns={[
     {key:'code',title:'Ticket',render:row=><Link to={`/operaciones/incidencias?case=${row.id}`}>{row.code} ↗</Link>},{key:'type',title:'Tipo',render:row=><Badge value={row.type}/>},{key:'status',title:'Estado',render:row=><Badge value={row.status}/>},{key:'priority',title:'Prioridad',render:row=><Badge value={row.priority}/>},{key:'updated_at',title:'Actualización',render:row=>dateTime(row.updated_at)},
    ]}/><Pagination page={data.tickets} busy={loading} onPage={value=>change('tickets_offset',value)} label="incidencias"/></>:<Empty title="Sin permiso de incidencias">Tu acceso Ranked no incluye la consulta de tickets. Un responsable puede revisar tus permisos de staff.</Empty>}</section>}
    {tab==='sanctions'&&<section className="op-card"><h2>Historial disciplinario</h2>{data.sanctions.available?<><p className="muted">Sanciones de esta cuenta y de sus clubes actuales, incluidos los bloqueos de Ranked.</p><DataTable rows={data.sanctions.items} empty="Sin sanciones registradas" emptyDetail="No hay sanciones de esta cuenta o de sus clubes actuales." columns={[
     {key:'source',title:'Ámbito',render:row=>row.source==='ranked_ban'?'Bloqueo Ranked':'Competición'},{key:'kind',title:'Restricción',render:row=><Badge value={row.kind}>{row.kind==='ranked_ban'?'Bloqueo Ranked':undefined}</Badge>},{key:'status',title:'Estado',render:row=><Badge value={row.status}/>},{key:'reason',title:'Motivo',render:row=><span className="pw-reason">{row.reason}</span>},{key:'starts_at',title:'Desde',render:row=>dateTime(row.starts_at)},{key:'ends_at',title:'Hasta',render:row=>dateTime(row.ends_at)},
    ]}/><Pagination page={data.sanctions} busy={loading} onPage={value=>change('sanctions_offset',value)} label="sanciones"/><Link className="btn" to="/operaciones/sanciones">Abrir centro disciplinario</Link></>:<Empty title="Sin permiso disciplinario">Tu acceso Ranked no incluye el historial de sanciones. Un responsable puede revisar tus permisos de staff.</Empty>}</section>}
   </>}
  </>}
 </div>;
}

function Pagination({page,busy,onPage,label}){
 if(!page.available||!page.total)return null;
 return <div className="op-actions pw-pagination"><button className="btn" disabled={busy||page.offset===0} onClick={()=>onPage(Math.max(0,page.offset-page.limit))}>Anterior</button><span>{page.items?.length===0||page.offset>=page.total?'Sin filas en esta página':`${n(page.offset+1)}–${n(Math.min(page.offset+page.limit,page.total))} de ${n(page.total)}`} {label}</span><button className="btn" disabled={busy||!page.has_more||page.offset+page.limit>999999} onClick={()=>onPage(page.offset+page.limit)}>Siguiente</button></div>;
}
