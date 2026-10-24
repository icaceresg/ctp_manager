import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, CheckCircle2, CircleAlert, Plus, RefreshCw, Settings2, ShieldCheck } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useData } from '../context.jsx';
import { Spinner } from '../components/ui.jsx';
import { Badge, DataTable, Empty, Field, FormDialog } from '../operations/ui.jsx';
import { DecisionPanel } from '../operations/DecisionPanel.jsx';
import { dateTime } from '../operations/model.js';
import AdministrationIntegrations from './AdministrationIntegrations.jsx';
import '../operations/operations.css';

const SECTIONS=[['resumen','Resumen','summary'],['usuarios','Usuarios CTP','users'],['clubes','Clubes','teams'],['accesos','Accesos al circuito','entitlements'],['mapas','Mapas y modos','maps'],['campanas','Campañas','campaigns'],['ranked','Ranked','ranked_queues'],['integraciones','Integraciones','features'],['auditoria','Auditoría','audit']];
const ROLE={admin:'Administrador',referee:'Árbitro',player:'Jugador'};
const ACCESS={circuit_pass:'Circuit Pass · cuatro seasons',team_pass:'Team Pass',season_pass:'Pase de season',tournament_ticket:'Entrada de torneo'};
const LOCALES=[['es','Español'],['en','Inglés'],['it','Italiano'],['fr','Francés'],['pt','Portugués'],['de','Alemán']];
const createActions=new Set(['admin.entitlement.grant','admin.mode.create','admin.map.create','admin.campaign.create']);
const name=row=>row.name||row.username||row.title||row.content?.es?.title||row.id;
const target=row=>row.manager_target_id||row.id;
const state=row=>row.status||row.state||(row.is_open!==undefined?row.is_open?'active':'paused':row.active===undefined?null:row.active?'active':'paused');

export default function AdministrationPage(){
  const {section='resumen'}=useParams();
  const {me,toast}=useApp();
  const [params,setParams]=useSearchParams();
  const definition=SECTIONS.find(item=>item[0]===section);
  const [search,setSearch]=useState(params.get('q')||'');
  const [dialog,setDialog]=useState(null);
  const [editing,setEditing]=useState(null);
  const variant=params.get('view');
  const resource=section==='mapas'&&variant==='modes'?'modes':section==='ranked'&&variant==='lobbies'?'ranked_lobbies':definition?.[2]||'summary';
  const page=Math.max(0,Number(params.get('page'))||0);
  const query=params.get('q')||'';
  const gameId=params.get('game')||'';
  const requestKey=JSON.stringify([resource,page,query,gameId]);
  const {data:loaded,loading,error,reload}=useData(async()=>{
    const filters=new URLSearchParams({resource,page:String(page),limit:'20',...(query?{query}:{}),...(gameId?{game_id:gameId}:{})});
    const [result,operations]=await Promise.all([api.get(`/administration?${filters}`),api.get('/operations/bootstrap?view=administration')]);
    return {...result,operations,request_key:requestKey};
  },[resource,page,query,gameId]);
  const data=loaded?.request_key===requestKey?loaded:null;
  useEffect(()=>{setSearch(query);setDialog(null);setEditing(null);},[section,query,variant]);
  const change=(key,value)=>setParams(previous=>{const next=new URLSearchParams(previous);value?next.set(key,String(value)):next.delete(key);if(key!=='page')next.delete('page');return next;},{replace:true});
  if(!me?.is_admin)return <Navigate to="/operaciones/jornada" replace/>;
  if(!definition)return <Navigate to="/administracion/resumen" replace/>;
  const rows=data?.items||[];
  const prepare=async(type,row,payload)=>{
    if(loading||error)throw new Error('Actualiza la consulta antes de preparar una decisión.');
    const result=await api.post('/administration/commands',{type,target_id:createActions.has(type)?crypto.randomUUID():target(row),expected_version:createActions.has(type)?0:row.manager_version,payload});
    await reload();toast('Propuesta preparada. Revisa y envía la decisión para aplicarla en CTP.');return result;
  };
  const propose=(type,row,extra={})=>setDialog({type,row,extra});
  const actionButton=(title,type,row,extra={})=><button type="button" className="btn" disabled={loading||Boolean(error)||!Number.isInteger(row.manager_version)||(type==='admin.ranked.queue.open'&&!(row.map_count>0))} title={type==='admin.ranked.queue.open'&&!(row.map_count>0)?'Añade al menos un mapa activo de Hardpoint antes de abrir la cola.':undefined} onClick={()=>propose(type,row,extra)}>{title}</button>;
  const columns={
    users:[{key:'username',title:'Cuenta',render:r=><div><strong>{r.username}</strong>{r.email&&<><br/><small>{r.email}</small></>}<br/><small>{[r.gamertag,r.platform||'Sin plataforma'].filter(Boolean).join(' · ')}</small></div>},{key:'role',title:'Rol',render:r=>ROLE[r.role]||r.role},{key:'points',title:'Puntos'},{key:'record',title:'V / D',render:r=>`${r.wins??0} / ${r.losses??0}`},{key:'actions',title:'Gestión',render:r=><div className="op-actions"><button type="button" className="btn" onClick={()=>setEditing(r.id)}>Editar datos</button>{r.role==='admin'?<Badge value="active">Administrador CTP</Badge>:<Link className="btn" to={`/usuarios?q=${encodeURIComponent(r.username)}`}>Asignar función de staff</Link>}</div>}],
    teams:[{key:'name',title:'Club',render:r=><div style={{display:'flex',alignItems:'center',gap:10}}>{safeImage(r.logo)&&<img alt="" src={r.logo} width="36" height="36" style={{objectFit:'contain'}}/>}<div><strong>{r.name}</strong><br/><small>{r.tag}</small></div></div>},{key:'leader',title:'Responsable',render:r=>r.leader_name||r.leader_username||'Sin identificar'},{key:'points',title:'Puntos'},{key:'verified',title:'Verificación',render:r=><Badge value={r.verified||r.is_verified?'approved':'pending'}/>},{key:'actions',title:'Gestión',render:r=><div className="op-actions"><Link className="btn" to={`/operaciones/clubes?club=${encodeURIComponent(r.id)}`}>Identidad y revisión</Link><button className="btn" onClick={()=>propose('admin.entitlement.grant',null,{team:r})}>Conceder acceso</button></div>}],
    entitlements:[{key:'team',title:'Club',render:r=>r.team_name||r.club_name||r.team_id},{key:'kind',title:'Acceso',render:r=>ACCESS[r.kind]||r.kind},{key:'season',title:'Season',render:r=>r.season||r.season_label||'Circuito'},{key:'status',title:'Estado',render:r=><Badge value={r.revoked_at||r.status==='revoked'?'revoked':'active'}/>},{key:'created_at',title:'Concedido',render:r=>dateTime(r.created_at)},{key:'actions',title:'Acciones',render:r=>!r.revoked_at&&r.status!=='revoked'&&actionButton('Retirar acceso','admin.entitlement.revoke',r)}],
    modes:[{key:'name',title:'Modo',render:r=><strong>{r.name}</strong>},{key:'game',title:'Juego',render:r=>gameName(data,r.game_id)},{key:'status',title:'Estado',render:r=><Badge value={r.active?'active':'paused'}/>},{key:'sort_order',title:'Orden'},{key:'actions',title:'Acciones',render:r=><div className="op-actions">{actionButton('Editar','admin.mode.update',r)}<button className="btn" aria-label={`Subir ${r.name}`} onClick={()=>propose('admin.mode.update',r,{move:-1})}><ArrowUp size={15}/></button><button className="btn" aria-label={`Bajar ${r.name}`} onClick={()=>propose('admin.mode.update',r,{move:1})}><ArrowDown size={15}/></button>{actionButton('Eliminar','admin.mode.delete',r)}</div>}],
    maps:[{key:'name',title:'Mapa',render:r=><div style={{display:'flex',alignItems:'center',gap:12}}>{safeImage(r.image_url)&&<img alt="" src={r.image_url} width="96" height="54" style={{objectFit:'cover',borderRadius:4}}/>}<strong>{r.name}</strong></div>},{key:'mode',title:'Modo'},{key:'game',title:'Juego',render:r=>gameName(data,r.game_id)},{key:'status',title:'Estado',render:r=><Badge value={r.active?'active':'paused'}/>},{key:'actions',title:'Acciones',render:r=><div className="op-actions">{actionButton('Editar','admin.map.update',r)}{actionButton('Eliminar','admin.map.delete',r)}</div>}],
    campaigns:[{key:'name',title:'Campaña',render:r=><strong>{name(r)}</strong>},{key:'state',title:'Estado',render:r=><Badge value={r.state}/>},{key:'created_at',title:'Creada',render:r=>dateTime(r.created_at)},{key:'actions',title:'Acciones',render:r=><div className="op-actions">{r.state==='draft'&&actionButton('Revisar envío','admin.campaign.queue',r)}{r.state!=='cancelled'&&actionButton('Cancelar','admin.campaign.cancel',r)}</div>}],
    features:[{key:'key',title:'Función',render:r=>r.key==='ranked'?'Ranked':r.key},{key:'enabled',title:'Visibilidad',render:r=><Badge value={r.enabled?'active':'paused'}>{r.enabled?'Visible':'Oculta'}</Badge>},{key:'actions',title:'Cambiar',render:r=>actionButton(r.enabled?'Ocultar Ranked':'Publicar Ranked','admin.feature.set',r,{key:r.key,enabled:!r.enabled})}],
    audit:[{key:'created_at',title:'Fecha',render:r=>dateTime(r.created_at)},{key:'actor',title:'Responsable',render:r=>r.actor_name||r.actor_username||'Sistema CTP'},{key:'action',title:'Acción'},{key:'detail',title:'Detalle',render:r=><span style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{typeof r.detail==='string'?r.detail:'Cambio registrado en CTP'}</span>}],
    ranked_queues:[{key:'name',title:'Cola',render:r=>r.title||r.name||gameName(data,r.game_id)||'Ranked'},{key:'status',title:'Estado',render:r=><Badge value={state(r)}/>},{key:'waiting',title:'Esperando',render:r=>r.waiting_players??r.waiting_count??r.players_count??'—'},{key:'actions',title:'Operación',render:r=><div className="op-actions">{!r.is_open&&actionButton('Abrir cola','admin.ranked.queue.open',r)}{r.is_open&&actionButton('Pausar','admin.ranked.queue.pause',r)}</div>}],
    ranked_lobbies:[{key:'name',title:'Partida',render:r=>r.name||`Ranked · ${r.id.slice(0,8)}`},{key:'status',title:'Estado',render:r=><Badge value={state(r)}/>},{key:'created_at',title:'Creada',render:r=>dateTime(r.created_at)},{key:'actions',title:'Arbitraje',render:r=><div className="op-actions">{actionButton('Registrar ganador','admin.ranked.lobby.resolve',r)}{actionButton('Cancelar partida','admin.ranked.lobby.cancel',r)}</div>}],
  }[resource]||[];
  const createType=resource==='entitlements'?'admin.entitlement.grant':resource==='maps'?'admin.map.create':resource==='modes'?'admin.mode.create':resource==='campaigns'?'admin.campaign.create':null;
  const commands=(data?.operations?.commands||[]).filter(command=>(command.type||command.action||'').startsWith('admin.'));
  return <div className="page wide op-page">
    <header className="op-heading"><div><div className="op-eyebrow"><ShieldCheck size={15}/> ADMINISTRACIÓN CTP</div><h1>{definition[1]}</h1></div><button className="btn" disabled={loading} onClick={reload}><RefreshCw size={16} className={loading?'spin':''}/>Actualizar</button></header>
    <nav className="op-tabs" aria-label="Administración CTP">{SECTIONS.map(([id,title])=><Link key={id} className={section===id?'active':''} aria-current={section===id?'page':undefined} to={`/administracion/${id}`}>{title}</Link>)}</nav>
    <p className="muted">Los cambios oficiales se preparan, se revisan y se envían a CTP. Las decisiones sin confirmación permanecen pendientes.</p>
    {error&&<div className="op-error" role="alert"><CircleAlert size={18}/><span>{error.message}{data?' Se conserva la última lectura.':''}</span><button className="btn" onClick={reload}>Reintentar</button></div>}
    {loading&&!data?<div className="op-loading"><Spinner/>Cargando administración…</div>:data?<>
      {resource==='summary'?<Summary data={data}/>:<>
        <section className="op-card"><div className="op-section-title"><div><h2>{resource==='modes'?'Modos de juego':resource==='ranked_lobbies'?'Partidas Ranked':definition[1]}</h2><p>{data.total??rows.length} registros · página {page+1}</p></div><div className="op-actions">{section==='mapas'&&<><button className="btn" disabled={resource==='maps'} onClick={()=>change('view','')}>Mapas</button><button className="btn" disabled={resource==='modes'} onClick={()=>change('view','modes')}>Modos</button></>}{section==='ranked'&&<><button className="btn" disabled={resource==='ranked_queues'} onClick={()=>change('view','')}>Colas</button><button className="btn" disabled={resource==='ranked_lobbies'} onClick={()=>change('view','lobbies')}>Partidas</button>{data.sync_target_id&&<button className="btn" onClick={()=>propose('admin.ranked.queue.sync',{id:data.sync_target_id,manager_version:data.sync_version})}>Sincronizar Discord</button>}</>}{createType&&<button className="btn primary" onClick={()=>propose(createType,null)}><Plus size={16}/>{resource==='entitlements'?'Conceder acceso':resource==='maps'?'Nuevo mapa':resource==='modes'?'Nuevo modo':'Nueva campaña'}</button>}</div></div>
          <form className="op-filters" onSubmit={event=>{event.preventDefault();change('q',search);}}><input aria-label="Buscar en administración" placeholder={resource==='users'?'Buscar por nombre o correo…':'Buscar por nombre…'} value={search} onChange={event=>setSearch(event.target.value)} maxLength={120}/><button className="btn" disabled={loading}>Buscar</button>{query&&<button className="btn" type="button" onClick={()=>change('q','')}>Limpiar</button>}{['maps','modes','ranked_queues'].includes(resource)&&data.games?.length>0&&<select aria-label="Filtrar por juego" value={gameId} onChange={event=>change('game',event.target.value)}><option value="">Todos los juegos</option>{data.games.map(game=><option key={game.id} value={game.id}>{game.name}</option>)}</select>}</form>
          <DataTable rows={rows} columns={columns} empty="No hay registros en esta vista" emptyDetail="Prueba otra búsqueda o crea un registro desde las acciones disponibles."/>
          <div className="op-actions"><button className="btn" disabled={loading||page===0} onClick={()=>change('page',page-1)}>Anterior</button><span>Página {page+1}</span><button className="btn" disabled={loading||!(data.has_more??data.total>(page+1)*20)} onClick={()=>change('page',page+1)}>Siguiente</button></div>
        </section>
        {section==='clubes'&&<div className="op-actions"><Link className="btn primary" to="/operaciones/clubes">Crear club y revisar identidad</Link></div>}
        {section==='ranked'&&<Link className="btn" to="/operaciones/torneos">Programar season y reinicio de divisiones</Link>}
        {section==='integraciones'&&<AdministrationIntegrations/>}
      </>}
      {commands.length>0&&<DecisionPanel data={{...data.operations,commands}} reload={reload} onChanged={reload}/>}
    </>:!error&&<Empty title="Sin datos disponibles">Actualiza para volver a consultar CTP.</Empty>}
    {dialog&&<AdministrationDialog key={`${dialog.type}:${dialog.row?.id||'new'}`} action={dialog} data={data} onClose={()=>setDialog(null)} prepare={prepare}/>}
    {editing&&<UserProfileDialog key={editing} id={editing} onClose={()=>setEditing(null)} onSaved={()=>{toast('Datos de la cuenta actualizados en CTP.');reload();}}/>}
  </div>;
}

const PLATFORMS=[['PC','PC'],['PlayStation','PlayStation'],['Xbox','Xbox'],['Switch','Switch'],['Movil','Móvil'],['Otra','Otra']];
const PROFILE_FIELDS=['username','email','gamertag','activision_id','platform','discord','twitter','bio','birthdate'];
/** Direct, versioned correction of a CTP account; CTP validates and audits each change. */
function UserProfileDialog({id,onClose,onSaved}){
  const {data:profile,loading,error,reload}=useData(()=>api.get(`/administration/users/${id}`),[id]);
  if(!profile)return <FormDialog title="Editar datos de la cuenta" onClose={onClose} submitLabel="Guardar cambios" submit={()=>{throw new Error(error?'Vuelve a cargar la cuenta.':'Espera a que se cargue la cuenta.');}}>
    {loading?<p role="status"><Spinner/> Cargando cuenta…</p>:<p className="op-error" role="alert">{error?.message||'No se ha podido cargar la cuenta.'}<button className="btn" type="button" onClick={reload}>Reintentar</button></p>}
  </FormDialog>;
  return <FormDialog title="Editar datos de la cuenta" onClose={onClose} submitLabel="Guardar cambios" help="Los cambios se aplican en CTP al guardar y quedan registrados en la auditoría. El rol se gestiona desde la asignación de staff." submit={async body=>{
    const changes={};
    for(const field of PROFILE_FIELDS){const value=(body[field]??'').trim();if(value!==(profile[field]??''))changes[field]=value;}
    if(!Object.keys(changes).length)throw new Error('No hay cambios que guardar.');
    if(changes.email&&body.confirm_email!=='on')throw new Error('Confirma el cambio de correo de acceso.');
    await api.patch(`/administration/users/${id}`,{expected_version:profile.manager_version,changes});
    onSaved();
  }}>
    <p><strong>{profile.username}</strong> · {ROLE[profile.role]||profile.role} · alta {dateTime(profile.created_at)}</p>
    <div className="op-form-grid">
      <Field label="Nombre de usuario" hint="Entre 3 y 20 caracteres. También sirve para iniciar sesión."><input name="username" required minLength={3} maxLength={20} defaultValue={profile.username}/></Field>
      <Field label="Correo de acceso" hint={profile.email_confirmed?'Correo verificado.':'Correo sin verificar.'}><input name="email" type="email" required maxLength={254} defaultValue={profile.email||''}/></Field>
      <Field label="Gamertag"><input name="gamertag" required maxLength={50} defaultValue={profile.gamertag}/></Field>
      <Field label="ActivisionID" hint="De 2 a 16 caracteres, con #número opcional (Nombre#1234567). Déjalo vacío para quitarlo."><input name="activision_id" maxLength={40} pattern="[\p{L}\p{N}\p{M} _.\-]{2,16}(?:#[0-9]+)?" defaultValue={profile.activision_id||''}/></Field>
      <Field label="Plataforma"><select name="platform" defaultValue={profile.platform}>{PLATFORMS.map(([value,title])=><option key={value} value={value}>{title}</option>)}</select></Field>
      <Field label="Fecha de nacimiento"><input name="birthdate" type="date" min="1900-01-01" defaultValue={profile.birthdate||''}/></Field>
      <Field label="Discord"><input name="discord" maxLength={100} defaultValue={profile.discord||''}/></Field>
      <Field label="X (Twitter)" hint="Sin @."><input name="twitter" maxLength={50} defaultValue={profile.twitter||''}/></Field>
    </div>
    <Field label="Biografía"><textarea name="bio" rows={3} maxLength={500} defaultValue={profile.bio||''}/></Field>
    <label className="op-check"><input type="checkbox" name="confirm_email"/> Si cambio el correo, el jugador pasará a iniciar sesión con el nuevo inmediatamente.</label>
  </FormDialog>;
}

function safeImage(value){if(typeof value!=='string')return false;try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}}
function gameName(data,id){return data?.games?.find(game=>game.id===id)?.name||id||'Sin juego';}
function Summary({data}){
  const source=data.summary||data.counts||data.items?.[0]||{};
  const metrics=[['users','Usuarios','usuarios'],['teams','Clubes','clubes'],['tournaments','Torneos',null],['open_cases','Expedientes abiertos',null],['pending_statistics','Estadísticas por revisar',null],['active_ranked_lobbies','Partidas Ranked','ranked']];
  return <><div className="op-metrics">{metrics.map(([key,title,section])=>{const content=<><span>{title}</span><strong>{source[key]??'—'}</strong></>;return section?<Link className="op-metric" key={key} to={`/administracion/${section}`}>{content}</Link>:<div className="op-metric" key={key}>{content}</div>;})}</div><section className="op-card"><h2>Acciones de trabajo</h2><div className="op-actions"><Link className="btn primary" to="/operaciones/torneos">Gestionar torneo</Link><Link className="btn" to="/operaciones/incidencias">Atender arbitraje</Link><Link className="btn" to="/administracion/accesos">Conceder acceso</Link><Link className="btn" to="/administracion/mapas">Preparar mapas</Link><Link className="btn" to="/operaciones/decisiones">Revisar decisiones</Link></div></section></>;
}

function AdministrationDialog({action,data,onClose,prepare}){
  const {type,row,extra={}}=action;
  const [content,setContent]=useState(Object.fromEntries(LOCALES.map(([locale])=>[locale,{title:'',body:''}])));
  const [locale,setLocale]=useState('es');
  const [kind,setKind]=useState('circuit_pass');
  const [chosenGame,setChosenGame]=useState(row?.game_id||data.games?.[0]?.id||'');
  const modeQuery=useData(()=>type==='admin.map.create'&&chosenGame?api.get(`/administration?${new URLSearchParams({resource:'modes',game_id:chosenGame,limit:'100'})}`):Promise.resolve({items:[]}),[type,chosenGame]);
  const modeOptions=(modeQuery.data?.items||[]).filter(mode=>mode.game_id===chosenGame);
  const [image,setImage]=useState(row?.image_url||'');
  const [uploading,setUploading]=useState(false);
  const [uploadError,setUploadError]=useState('');
  const imageRequest=useRef(null);
  const titles={'admin.user.role':'Cambiar rol de CTP','admin.entitlement.grant':'Conceder acceso al club','admin.entitlement.revoke':'Retirar acceso','admin.mode.create':'Crear modo de juego','admin.mode.update':'Editar modo','admin.mode.delete':'Eliminar modo','admin.map.create':'Crear mapa','admin.map.update':'Editar mapa','admin.map.delete':'Eliminar mapa','admin.campaign.create':'Preparar campaña','admin.campaign.queue':'Revisar envío de campaña','admin.campaign.cancel':'Cancelar campaña','admin.feature.set':'Cambiar visibilidad de Ranked','admin.ranked.queue.open':'Abrir cola Ranked','admin.ranked.queue.pause':'Pausar cola Ranked','admin.ranked.queue.sync':'Sincronizar colas con Discord','admin.ranked.lobby.resolve':'Resolver partida Ranked','admin.ranked.lobby.cancel':'Cancelar partida Ranked'};
  const simple=type==='admin.user.role'||type==='admin.feature.set'||type.endsWith('.delete')||type==='admin.entitlement.revoke'||type==='admin.campaign.queue'||type==='admin.campaign.cancel'||type.startsWith('admin.ranked.')||extra.move!==undefined;
  const confirmRequired=type.endsWith('.delete')||['admin.campaign.queue','admin.entitlement.revoke','admin.ranked.lobby.cancel'].includes(type);
  const reasonRequired=type==='admin.entitlement.revoke'||type.startsWith('admin.ranked.');
  const upload=async event=>{
    const file=event.target.files?.[0];if(!file)return;
    setUploading(true);setUploadError('');
    try{
      if(file.size>2*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Usa una imagen PNG, JPG o WebP de hasta 2 MB.');
      const fileKey=`${file.name}:${file.size}:${file.lastModified}`;
      if(imageRequest.current?.key!==fileKey)imageRequest.current={key:fileKey,id:crypto.randomUUID()};
      const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('No se ha podido leer la imagen.'));reader.readAsDataURL(file);});
      const result=await api.post('/administration/images',{bucket:'game-maps',content_type:file.type,base64:String(dataUrl).split(',')[1],request_id:imageRequest.current.id});
      const url=result.url||result.public_url;if(!safeImage(url))throw new Error('CTP no ha confirmado una imagen válida.');setImage(url);
    }
    catch(error){setUploadError(error.message);}finally{setUploading(false);}
  };
  return <FormDialog title={titles[type]||'Preparar cambio'} onClose={onClose} submitLabel="Preparar propuesta" help="El cambio quedará pendiente. Solo se aplicará cuando un administrador lo envíe y CTP confirme el resultado." submit={body=>{
    if(uploading)throw new Error('Espera a que termine la carga de la imagen.');
    if(type==='admin.map.create'&&(modeQuery.loading||modeQuery.error))throw new Error('Espera a que se carguen los modos del juego o vuelve a consultar.');
    if(confirmRequired&&body.confirm!=='on')throw new Error('Confirma la acción antes de preparar la propuesta.');
    const payload={...(body.reason?.trim()?{reason:body.reason.trim()}:{}),...extra};delete payload.team;
    if(type==='admin.user.role')payload.role=extra.role;
    else if(type==='admin.entitlement.grant'){
      Object.assign(payload,{team_id:body.team_id,kind});if(body.season_label)payload.season_label=body.season_label;if(kind==='season_pass')payload.season=Number(body.season);if(kind==='tournament_ticket')payload.tournament_id=body.tournament_id;if(body.payment_ref)payload.payment_ref=body.payment_ref;if(body.amount)payload.amount_cents=Math.round(Number(body.amount.replace(',','.'))*100);
    } else if((type.startsWith('admin.mode.')||type.startsWith('admin.map.'))&&!simple){
      Object.assign(payload,{name:body.name,active:body.active==='on'});if(type.endsWith('.create'))payload.game_id=body.game_id;if(type==='admin.map.create')payload.mode=body.mode;if(type.startsWith('admin.map.'))payload.image_url=image;if(body.sort_order!=='')payload.sort_order=Number(body.sort_order);
    } else if(type==='admin.campaign.create'){
      const incomplete=LOCALES.filter(([id])=>!content[id].title.trim()||!content[id].body.trim()).map(([,title])=>title);
      if(incomplete.length)throw new Error(`Completa el asunto y el mensaje en: ${incomplete.join(', ')}.`);
      Object.assign(payload,{content,link:body.link});
    }
    else if(type==='admin.campaign.queue')payload.confirm_id=target(row);
    else if(type==='admin.ranked.lobby.resolve')payload.side=body.side;
    return prepare(type,row,payload);
  }}>
    {row&&<p><strong>{name(row)}</strong></p>}
    {type==='admin.user.role'&&<p>Rol que tendrá la cuenta: <strong>{ROLE[extra.role]}</strong>. Los administradores no se crean ni se degradan desde este formulario.</p>}
    {type==='admin.feature.set'&&<p>Ranked quedará <strong>{extra.enabled?'visible para los jugadores':'oculta para los jugadores'}</strong>. La cola y las partidas se gestionan por separado.</p>}
    {type==='admin.entitlement.grant'&&<>
      <EntityLookup label="Club" name="team_id" resource="teams" initial={extra.team}/>
      <Field label="Tipo de acceso"><select value={kind} onChange={event=>setKind(event.target.value)}>{Object.entries(ACCESS).map(([id,title])=><option key={id} value={id}>{title}</option>)}</select></Field>
      {kind==='team_pass'&&<p className="op-notice">CTP comprobará el cupo de 16 clubes. La revisión de la identidad sigue siendo una decisión separada.</p>}
      {kind==='season_pass'&&<Field label="Season"><select name="season">{[1,2,3,4].map(value=><option key={value} value={value}>Season {value}</option>)}</select></Field>}
      {kind==='tournament_ticket'&&<EntityLookup label="Torneo" name="tournament_id" resource="tournaments"/>}
      <Field label="Temporada del circuito" hint="Déjalo vacío para utilizar la temporada configurada por CTP."><input name="season_label" maxLength={100}/></Field>
      <div className="op-form-grid"><Field label="Referencia de gestión (opcional)"><input name="payment_ref" maxLength={200}/></Field><Field label="Importe registrado, € (opcional)"><input name="amount" inputMode="decimal" type="number" min="0" max="1000000" step="0.01"/></Field></div>
    </>}
    {(type.startsWith('admin.mode.')||type.startsWith('admin.map.'))&&!simple&&<>
      {type.endsWith('.create')&&<Field label="Juego"><select name="game_id" required value={chosenGame} onChange={event=>setChosenGame(event.target.value)}><option value="">Seleccionar juego</option>{(data.games||[]).map(game=><option key={game.id} value={game.id}>{game.name}</option>)}</select></Field>}
      {type==='admin.map.create'&&<><Field label="Modo"><select key={chosenGame} name="mode" required disabled={modeQuery.loading||Boolean(modeQuery.error)}><option value="">Seleccionar modo</option>{modeOptions.map(mode=><option key={mode.id} value={mode.name}>{mode.name}</option>)}</select></Field>{modeQuery.loading&&<p role="status">Consultando modos del juego…</p>}{modeQuery.error&&<p className="op-error" role="alert">{modeQuery.error.message}<button className="btn" type="button" onClick={modeQuery.reload}>Reintentar modos</button></p>}{!modeQuery.loading&&!modeQuery.error&&!modeOptions.length&&<p className="op-notice">Este juego no tiene modos configurados. Crea un modo en la pestaña «Modos» antes de añadir mapas.</p>}</>}
      <Field label="Nombre"><input name="name" required maxLength={120} defaultValue={row?.name||''}/></Field>
      <Field label="Orden"><input name="sort_order" type="number" min="0" max="10000" defaultValue={row?.sort_order??0}/></Field>
      <label className="op-check"><input name="active" type="checkbox" defaultChecked={row?.active!==false}/> Disponible para competición</label>
      {type.startsWith('admin.map.')&&<><Field label="Imagen del mapa"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} disabled={uploading}/></Field>{uploading&&<p role="status">Subiendo imagen…</p>}{uploadError&&<p className="op-error" role="alert">{uploadError}</p>}{safeImage(image)&&<img alt="Imagen del mapa" src={image} style={{width:'100%',maxHeight:220,objectFit:'contain'}}/>}<Field label="URL de imagen HTTPS (opcional)"><input value={image} onChange={event=>setImage(event.target.value)} type="url" maxLength={2000}/></Field></>}
    </>}
    {type==='admin.campaign.create'&&<>
      <div className="tabs" aria-label="Idioma de la campaña">{LOCALES.map(([id,title])=><button key={id} type="button" className={locale===id?'active':''} onClick={()=>setLocale(id)}>{title}{content[id].title&&content[id].body&&<CheckCircle2 size={12}/>}</button>)}</div>
      <p className="muted">Completa los seis idiomas antes de preparar la campaña.</p>
      <Field label={`Asunto · ${LOCALES.find(([id])=>id===locale)[1]}`}><input value={content[locale].title} maxLength={150} onChange={event=>setContent(current=>({...current,[locale]:{...current[locale],title:event.target.value}}))}/></Field>
      <Field label="Mensaje"><textarea rows={7} value={content[locale].body} maxLength={3000} onChange={event=>setContent(current=>({...current,[locale]:{...current[locale],body:event.target.value}}))}/></Field>
      <Field label="Destino dentro de CTP"><input name="link" required maxLength={512} defaultValue="/tournaments"/></Field>
    </>}
    {type==='admin.campaign.queue'&&<><p className="op-notice">Esta acción prepara el envío comercial a las personas que hayan dado su consentimiento. El envío efectivo requiere la confirmación posterior de la propuesta.</p>{LOCALES.map(([locale,title])=><details key={locale}><summary>{title}</summary><h3>{row.content?.[locale]?.title||'Sin asunto'}</h3><p style={{whiteSpace:'pre-wrap'}}>{row.content?.[locale]?.body||'Sin mensaje'}</p></details>)}</>}
    {type==='admin.ranked.lobby.resolve'&&<Field label="Equipo ganador"><select name="side"><option value="a">Equipo A</option><option value="b">Equipo B</option></select></Field>}
    {type==='admin.ranked.queue.pause'&&<p className="op-notice">La cola dejará de admitir jugadores y se retirará a quienes estén esperando. Las partidas ya creadas se gestionan desde «Partidas».</p>}
    {type.endsWith('.delete')&&<p className="op-notice">CTP bloqueará la eliminación si el registro ya está en uso o tiene dependencias.</p>}
    {extra.move!==undefined&&<p>El modo se moverá una posición <strong>{extra.move<0?'arriba':'abajo'}</strong>.</p>}
    <Field label={`Motivo${reasonRequired?'':' (opcional)'}`}><textarea name="reason" minLength={12} maxLength={500} rows={3} required={reasonRequired}/></Field>
    {confirmRequired&&<label className="op-check"><input type="checkbox" name="confirm" required/> He revisado el registro y confirmo que quiero preparar esta acción.</label>}
  </FormDialog>;
}

function EntityLookup({label,name:fieldName,resource,initial}){
  const [query,setQuery]=useState('');
  const [selected,setSelected]=useState(initial?.id||'');
  const [options,setOptions]=useState(initial?[initial]:[]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const request=useRef(0);
  useEffect(()=>{
    const sequence=++request.current;setBusy(true);setError('');
    const timer=setTimeout(async()=>{try{
      const params=new URLSearchParams({resource,query,limit:'20'});
      const result=await api.get(resource==='tournaments'?`/operations/competition?${params}`:`/administration?${params}`);
      if(sequence===request.current)setOptions([...new Map([...(initial?[initial]:[]),...(result.items||[])].map(item=>[item.id,item])).values()]);
    }catch(error){if(sequence===request.current)setError(error.message);}finally{if(sequence===request.current)setBusy(false);}},250);
    return()=>{clearTimeout(timer);request.current++;};
  },[query,resource,initial]);
  return <div className="op-field"><span>{label}</span><input aria-label={`Buscar ${label.toLocaleLowerCase('es')}`} placeholder={`Buscar ${label.toLocaleLowerCase('es')}…`} value={query} onChange={event=>setQuery(event.target.value)} maxLength={120}/><select aria-label={label} name={fieldName} value={selected} required onChange={event=>setSelected(event.target.value)}><option value="">Seleccionar {label.toLocaleLowerCase('es')}</option>{options.map(item=><option key={item.id} value={item.id}>{name(item)}</option>)}</select>{busy&&<small role="status">Buscando…</small>}{error&&<small className="op-error" role="alert">{error}</small>}</div>;
}
