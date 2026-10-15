import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { Badge, DataTable, Empty, Field, FormDialog } from './ui.jsx';
import { dateTime, teamName, label } from './model.js';
import { DecisionPanel } from './DecisionPanel.jsx';

const states={borrador:'Borrador',inscripcion_abierta:'Inscripción abierta',en_curso:'En curso',finalizado:'Finalizado',cancelado:'Cancelado'};
const localDate=value=>{if(!value)return '';const d=new Date(value);return Number.isFinite(d.getTime())?new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16):'';};
const participantName=participant=>participant.name||participant.entrant?.name||participant.team?.name||participant.username||participant.entrant_id||'Participante';
const matchTitle=match=>`${teamName(match.team_a_name||match.team_a||match.entrant_a||match.entrant_a_name||match.entrant_a_id)} · ${teamName(match.team_b_name||match.team_b||match.entrant_b||match.entrant_b_name||match.entrant_b_id)}`;
export function CompetitionPanel({data,reload,mutate}) {
  const [params,setParams]=useSearchParams();
  const target=params.get('tournament');
  const [result,setResult]=useState(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [query,setQuery]=useState('');
  const [filter,setFilter]=useState({query:'',status:''});
  const [status,setStatus]=useState('');
  const [cursor,setCursor]=useState(null);
  const [pages,setPages]=useState([]);
  const [dialog,setDialog]=useState(null);
  const requestId=useRef(0);
  const configured=data.connection?.configured;
  const supports=type=>data.connection?.supported_actions?.includes(type);
  const load=useCallback(async()=>{
    if(!configured)return;
    const request=++requestId.current;
    setBusy(true);setError('');
    try{
      const search=new URLSearchParams({resource:target?'tournament':'tournaments',...(target?{target_id:target}:{...filter,...(cursor?{cursor}:{}),limit:'40'})});
      const next=await api.get(`/operations/competition?${search}`);if(request===requestId.current)setResult(next);
    }catch(err){if(request===requestId.current){setError(err.message);if([401,403].includes(err.status))setResult(null);}}
    finally{if(request===requestId.current)setBusy(false);}
  },[configured,target,filter,cursor]);
  useEffect(()=>{setResult(null);load();return()=>{requestId.current++;};},[load]);
  const tournament=result?.tournament;
  const pending=(kind,id)=>data.commands?.some(c=>c.resource_type===kind&&c.resource_id===id&&!['acknowledged','cancelled'].includes(c.status));
  const structureLocked=tournament&&(!['borrador','inscripcion_abierta'].includes(tournament.status)||tournament.groups_published_at||tournament.bracket_published_at||result.matches?.length);
  const blocked=type=>!supports(type)||(type==='tournament.update'&&structureLocked)||Boolean(tournament&&pending('tournament',tournament.id));
  const prepare=async(type,row,payload)=>{
    await mutate('post','/competition/commands',{type,target_id:row?.id,expected_version:row?.manager_version??0,payload},'Propuesta preparada. Un administrador debe enviarla a CTP.');
  };
  return <><div className="op-section-title"><div><h2>{tournament?.name||'Torneos'}</h2><p>Inscripciones, formato y calendario validados por el backend compartido de CTP.</p></div><div className="op-actions">{target&&<button className="btn" onClick={()=>{setParams({});setCursor(null);setPages([]);}}>Todos los torneos</button>}<button className="btn" disabled={busy||!configured} onClick={load}>Actualizar</button>{!target&&<button className="btn primary" disabled={!supports('tournament.create')||!result?.games?.length} onClick={()=>setDialog({type:'tournament.create'})}>Crear torneo</button>}</div></div>
    {!configured?<Empty title="CTP pendiente de conectar">La gestión de torneos necesita un operador vinculado y las capacidades del backend CTP.</Empty>:<>
      {error&&<p className="op-error" role="alert">{error}{result?' Se conserva la última consulta; puede estar desactualizada.':''}</p>}
      {busy&&<p role="status">Consultando competición…</p>}
      {!target&&<><form className="op-filters" onSubmit={event=>{event.preventDefault();setCursor(null);setPages([]);setFilter({query,status});}}><input aria-label="Buscar torneo" placeholder="Buscar torneo…" value={query} maxLength={120} onChange={e=>setQuery(e.target.value)}/><select aria-label="Estado del torneo" value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todos los estados</option>{Object.entries(states).map(([value,name])=><option key={value} value={value}>{name}</option>)}</select><button className="btn" disabled={busy}>Buscar</button></form>{result&&<><DataTable rows={result.items||[]} empty="No hay torneos con estos filtros" columns={[
        {key:'name',title:'Torneo',render:t=><button className="op-text-button" onClick={()=>setParams({tournament:t.id})}>{t.name}</button>},
        {key:'status',title:'Estado',render:t=><Badge value={t.status}>{states[t.status]||t.status}</Badge>},
        {key:'start_at',title:'Inicio',render:t=>dateTime(t.start_at)},
        {key:'participants',title:'Plazas',render:t=>`${t.participant_count??t.participants_count??'—'} / ${t.max_participants??'—'}`},
      ]}/><div className="op-actions"><button className="btn" disabled={busy||!pages.length} onClick={()=>{setCursor(pages[pages.length-1]);setPages(p=>p.slice(0,-1));}}>Anterior</button><span>Página {pages.length+1}</span><button className="btn" disabled={busy||!result.next_cursor} onClick={()=>{setPages(p=>[...p,cursor]);setCursor(result.next_cursor);}}>Siguiente</button></div></>}
      <DecisionPanel data={data} resourceType="tournament" reload={reload} onChanged={load}/></>}
      {tournament&&<>
        <section className="op-card"><div className="op-section-title"><Badge value={tournament.status}>{states[tournament.status]||tournament.status}</Badge><div className="op-actions"><button className="btn" disabled={blocked('tournament.update')} onClick={()=>setDialog({type:'tournament.update',row:tournament})}>Editar torneo</button><button className="btn" disabled={blocked('tournament.status')} onClick={()=>setDialog({type:'tournament.status',row:tournament})}>Cambiar estado</button></div></div><dl className="op-settings"><div><dt>Inicio</dt><dd>{dateTime(tournament.start_at)}</dd></div><div><dt>Cierre de inscripción</dt><dd>{dateTime(tournament.registration_close_at)}</dd></div><div><dt>Formato</dt><dd>{tournament.has_group_stage?'Grupos y eliminatorias':'Eliminatorias directas'}</dd></div><div><dt>Plantilla</dt><dd>{tournament.roster_min}–{tournament.roster_max} jugadores</dd></div><div><dt>Participantes</dt><dd>{tournament.min_participants}–{tournament.max_participants}</dd></div><div><dt>Series</dt><dd>Grupos BO{tournament.best_of_groups??'—'} · Playoffs BO{tournament.best_of_playoffs??'—'} · Final BO{tournament.best_of_final??'—'}</dd></div></dl>{tournament.description&&<p>{tournament.description}</p>}<details><summary>Reglamento</summary><p style={{whiteSpace:'pre-wrap'}}>{tournament.rules||'Sin reglamento guardado.'}</p></details></section>
        <DecisionPanel data={data} resourceType="tournament" resourceId={tournament.id} reload={reload} onChanged={load}/>
        <section className="op-card"><h3>Inscripciones</h3><DataTable rows={result.participants||[]} empty="Todavía no hay inscripciones" columns={[
          {key:'name',title:'Participante',render:participantName},{key:'seed',title:'Seed'},{key:'season_points',title:'Puntos de temporada'},
          {key:'status',title:'Estado',render:p=><Badge value={p.review_status||p.status||p.registration_status||(p.approved===true?'approved':'pending')}/>},
          {key:'roster',title:'Plantilla',render:p=>(p.roster||[]).length?<ul>{p.roster.map(player=><li key={player.user_id}><strong>{player.username||player.gamertag||player.name||player.user_id}</strong><br/><small>{player.activision_id||'Sin Activision ID'} · {player.identity_ready?'Identidad completa':'Identidad pendiente'}</small></li>)}</ul>:'Sin roster recibido'},
          {key:'actions',title:'Revisión',render:p=><button className="btn" disabled={!supports('tournament.registration')||pending('registration',p.id)} onClick={()=>setDialog({type:'tournament.registration',row:p})}>Revisar inscripción</button>},
        ]}/>{(result.participants||[]).filter(p=>pending('registration',p.id)).map(p=><DecisionPanel key={p.id} data={data} resourceType="registration" resourceId={p.id} reload={reload} onChanged={load}/>)}</section>
        <section className="op-card"><div className="op-section-title"><div><h3>Fases y calendario</h3><p>Genera la fase, revisa los cruces y prepara su publicación.</p></div><div className="op-actions"><button className="btn" disabled={blocked('tournament.generate')} onClick={()=>setDialog({type:'tournament.generate',row:tournament})}>Generar fase</button><button className="btn" disabled={blocked('tournament.publish')} onClick={()=>setDialog({type:'tournament.publish',row:tournament})}>Publicar fase</button></div></div><p className="muted">Grupos: {tournament.groups_published_at?`publicados ${dateTime(tournament.groups_published_at)}`:'sin publicar'} · Eliminatorias: {tournament.bracket_published_at?`publicadas ${dateTime(tournament.bracket_published_at)}`:'sin publicar'}</p>
          <DataTable rows={result.matches||[]} empty="No hay cruces generados" columns={[
            {key:'round',title:'Ronda',render:m=>`${label(m.phase)||'Eliminatoria'} · ${m.round??'—'}`},{key:'match',title:'Encuentro',render:matchTitle},
            {key:'scheduled_at',title:'Horario',render:m=>dateTime(m.scheduled_at)},
            {key:'result',title:'Resultado',render:m=>m.score_a!=null&&m.score_b!=null?`${m.score_a} – ${m.score_b}`:'Pendiente'},
            {key:'actions',title:'Calendario',render:m=><button className="btn" disabled={!supports('tournament.schedule')||pending('fixture',m.id)} onClick={()=>setDialog({type:'tournament.schedule',row:m})}>Reprogramar</button>},
          ]}/>{(result.matches||[]).filter(m=>pending('fixture',m.id)).map(m=><DecisionPanel key={m.id} data={data} resourceType="fixture" resourceId={m.id} reload={reload} onChanged={load}/>)}</section>
      </>}
    </>}
    {dialog&&(['tournament.create','tournament.update'].includes(dialog.type)?<TournamentForm type={dialog.type} row={dialog.row} games={result?.games||[]} onClose={()=>setDialog(null)} prepare={prepare}/>:<TournamentActionDialog action={dialog} onClose={()=>setDialog(null)} prepare={prepare}/>)}
  </>;
}

function TournamentForm({type,row,games,onClose,prepare}) {
  const isNew=type==='tournament.create';
  const defaults={name:'',game_id:games[0]?.id||'',game_mode:'',participant_type:'equipo',kind:'personalizado',season:1,max_participants:16,min_participants:2,roster_min:4,roster_max:6,has_group_stage:false,group_count:4,best_of_groups:3,best_of_playoffs:5,best_of_final:7,has_third_place_match:false,...row};
  defaults.group_count??=4; defaults.best_of_groups??=3; defaults.best_of_playoffs??=5; defaults.best_of_final??=7;
  const [groups,setGroups]=useState(Boolean(defaults.has_group_stage));
  return <FormDialog title={isNew?'Crear torneo':'Editar torneo'} onClose={onClose} submitLabel="Preparar propuesta" help="CTP comprobará el formato, los permisos y las restricciones de los torneos ya iniciados antes de aplicar el cambio." submit={body=>{
    const payload={...body,has_group_stage:groups,has_third_place_match:body.has_third_place_match==='on',start_at:new Date(body.start_at).toISOString(),registration_close_at:new Date(body.registration_close_at).toISOString()};
    for(const key of ['max_participants','min_participants','roster_min','roster_max','group_count','best_of_groups','best_of_playoffs','best_of_final'])payload[key]=Number(body[key]);
    payload.season=body.season?Number(body.season):null; return prepare(type,row,payload);
  }}><Field label="Nombre"><input name="name" defaultValue={defaults.name} required minLength={3} maxLength={120}/></Field><div className="op-form-grid"><Field label="Juego"><select name="game_id" defaultValue={defaults.game_id} required>{games.map(game=><option key={game.id} value={game.id}>{game.name}</option>)}</select></Field><Field label="Modalidad"><input name="game_mode" defaultValue={defaults.game_mode} required maxLength={60}/></Field><Field label="Inicio (hora local)"><input name="start_at" type="datetime-local" defaultValue={localDate(defaults.start_at)} required/></Field><Field label="Cierre de inscripción (hora local)"><input name="registration_close_at" type="datetime-local" defaultValue={localDate(defaults.registration_close_at)} required/></Field><Field label="Participación"><select name="participant_type" defaultValue={defaults.participant_type}><option value="equipo">Equipos</option><option value="individual">Individual</option><option value="ambos">Ambos</option></select></Field><Field label="Tipo"><select name="kind" defaultValue={defaults.kind}><option value="cup">CUP</option><option value="major">MAJOR</option><option value="personalizado">Personalizado</option><option value="fuera_de_circuito">Fuera de circuito</option><option value="champ">CHAMP</option><option value="champs">CHAMPS</option></select></Field><Field label="Temporada"><input name="season" type="number" min="1" max="4" defaultValue={defaults.season??''}/></Field>
    {[['min_participants','Mínimo participantes',2,256],['max_participants','Máximo participantes',2,256],['roster_min','Mínimo jugadores',1,12],['roster_max','Máximo jugadores',1,12],['group_count','Número de grupos',1,64]].map(([key,title,min,max])=><Field key={key} label={title}><input name={key} type="number" min={min} max={max} defaultValue={defaults[key]} required/></Field>)}
    {[['best_of_groups','Series de grupos'],['best_of_playoffs','Series de playoffs'],['best_of_final','Serie de la final']].map(([key,title])=><Field key={key} label={title}><select name={key} defaultValue={defaults[key]}>{[1,3,5,7,9].map(value=><option key={value} value={value}>BO{value}</option>)}</select></Field>)}</div><label className="op-check"><input type="checkbox" checked={groups} onChange={e=>setGroups(e.target.checked)}/> Fase de grupos antes de eliminatorias</label><label className="op-check"><input name="has_third_place_match" type="checkbox" defaultChecked={Boolean(defaults.has_third_place_match)}/> Partido por el tercer puesto</label><Field label="Descripción"><textarea name="description" defaultValue={defaults.description||''} maxLength={5000} rows={3}/></Field><Field label="Reglamento"><textarea name="rules" defaultValue={defaults.rules||''} maxLength={10000} rows={5}/></Field></FormDialog>;
}
function TournamentActionDialog({action,onClose,prepare}) {
  const {type,row}=action;
  const titles={'tournament.status':'Cambiar estado','tournament.registration':'Revisar inscripción','tournament.generate':'Generar fase','tournament.publish':'Publicar fase','tournament.schedule':'Reprogramar encuentro'};
  return <FormDialog title={titles[type]} onClose={onClose} submitLabel="Preparar propuesta" help="La propuesta queda pendiente hasta que un administrador la envíe y CTP la confirme." submit={body=>prepare(type,row,{...body,...(body.approve!==undefined?{approve:body.approve==='true'}:{}),...(body.round_minutes?{round_minutes:Number(body.round_minutes)}:{}),...(body.scheduled_at?{scheduled_at:new Date(body.scheduled_at).toISOString()}: {})})}>
    {type==='tournament.status'&&<Field label="Estado"><select name="status" defaultValue={row.status}>{Object.entries(states).map(([value,name])=><option key={value} value={value}>{name}</option>)}</select></Field>}
    {type==='tournament.registration'&&<><p>{participantName(row)}</p><Field label="Decisión"><select name="approve"><option value="true">Aprobar inscripción</option><option value="false">Rechazar inscripción</option></select></Field></>}
    {type==='tournament.schedule'&&<><p>{matchTitle(row)}</p><Field label="Nuevo horario (hora local)"><input name="scheduled_at" type="datetime-local" defaultValue={localDate(row.scheduled_at)} required/></Field></>}
    {['tournament.generate','tournament.publish'].includes(type)&&<><Field label="Fase"><select name="phase">{row.has_group_stage&&<option value="groups">Grupos</option>}{type==='tournament.generate'&&!row.has_group_stage&&<option value="direct">Eliminatorias directas</option>}<option value="playoffs">Playoffs</option></select></Field>{type==='tournament.generate'&&<Field label="Duración prevista por ronda (minutos)"><input name="round_minutes" type="number" min="15" max="720" defaultValue="60" required/></Field>}{type==='tournament.publish'&&<p className="op-notice">La publicación hará visibles los cruces de la fase. Revisa equipos, horarios y clasificación antes de enviar.</p>}</>}
    {['tournament.status','tournament.registration','tournament.schedule'].includes(type)&&<Field label="Motivo"><textarea name="reason" minLength={12} maxLength={500} rows={3} required/></Field>}
  </FormDialog>;
}
