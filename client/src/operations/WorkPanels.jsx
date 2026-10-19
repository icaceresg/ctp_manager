import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, Check, Clapperboard, FilePlus2, Plus, RefreshCw, Send, ShieldCheck, Users } from 'lucide-react';
import { api } from '../api.js';
import { actionLabel } from './actionLabels.js';
import { useApp } from '../context.jsx';
import { Badge, DataTable, Empty, Field, FormDialog, MatchLink, SelectMatch } from './ui.jsx';
import { canSendCommand, dateTime, label, matchName, officialResult } from './model.js';
import { ActionButton } from './ReviewPanels.jsx';
import { ManualClubCreatePanel } from './ManualClubCreatePanel.jsx';
import { useWorkspaceSearch } from './useWorkspaceSearch.js';
import { ProViewPanel } from './ProViewPanel.jsx';

export { StaffPlanner as AssignmentsPanel } from './StaffPlanner.jsx';

export function ProductionPanel({ data, mutate, can, me }) {
  const [params, setParams] = useSearchParams();
  const selected = params.get('match') || '';
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState(null);
  const match = data.matches.find((m) => m.id === selected);
  const production = (data.production || []).find((p) => p.match_id === selected);
  const rundown = (data.rundowns || []).find((r) => r.id === production?.rundown_id);
  const assigned = (data.assignments || []).filter((a) => a.match_id === selected && !['cancelled', 'declined'].includes(a.status));
  const states = { preparation: 'En preparación', ready: 'Preparado', live: 'En seguimiento', paused: 'Seguimiento en pausa', finished: 'Cerrado' };
  const transitions = { preparation: ['preparation', 'ready'], ready: ['ready', 'preparation', 'live'], live: ['live', 'paused', 'finished'], paused: ['paused', 'live', 'finished'], finished: ['finished', 'preparation'] };
  return <><ProViewPanel data={data} me={me} /><div className="op-section-title"><div><h2>Preparación del directo</h2><p>Organiza la escaleta, el equipo y las notas del encuentro.</p></div>{can('escaleta') && <Link className="btn" to="/escaleta"><Clapperboard size={16} /> Escaletas</Link>}</div>
    <div className="op-inline-note"><Clapperboard size={18} /><p>La salida en directo se maneja desde CTP Panel, en el dock de OBS. Aquí queda preparada la información para el equipo.</p></div>
    <Field label="Partido"><SelectMatch matches={data.matches} value={selected} onChange={(e) => setParams(e.target.value ? { match: e.target.value } : {})} /></Field>
    {!match ? <Empty title={selected ? 'El encuentro no está en la consulta actual' : 'Selecciona el próximo encuentro'}>{selected ? 'Elige otro partido o actualiza los datos de CTP.' : 'Vincula su escaleta, consulta quién participa y deja las indicaciones del directo.'}</Empty> : <>
      <section className="op-production-stage"><div className="op-match-meta"><span>SEGUIMIENTO INTERNO</span><Badge value={production?.state || 'preparation'}>{states[production?.state || 'preparation']}</Badge></div><h2>{matchName(match)}</h2>
        <dl className="op-settings"><div><dt>Horario del encuentro</dt><dd>{dateTime(match.scheduled_at)}</dd></div><div><dt>Escaleta</dt><dd>{rundown?.title || (production?.rundown_id ? 'Escaleta vinculada' : 'Pendiente de vincular')}</dd></div><div><dt>Personal confirmado</dt><dd>{assigned.length ? `${assigned.filter((a) => a.status === 'confirmed').length} de ${assigned.length} personas asignadas` : 'Sin turnos asignados'}</dd></div></dl>
        <div><h3>Indicaciones para el equipo</h3><p className="op-text">{production?.note || 'Todavía no hay indicaciones guardadas.'}</p></div>
        <div className="op-actions"><button className="btn primary" onClick={() => { setEditing({ ...production, match_id: selected, version: production?.version || 0 }); setDialog(true); }}>Editar preparación</button>{can('escaleta') && production?.rundown_id && <Link className="btn" to={`/escaleta/${production.rundown_id}`}>Abrir escaleta <ArrowUpRight size={14} /></Link>}<MatchLink match={match} /></div>
      </section>
      <section className="op-card"><div className="op-section-title"><h3>Equipo del encuentro</h3>{can('operaciones') && <Link className="btn" to={`/operaciones/turnos?match=${encodeURIComponent(selected)}`}><Users size={15} /> Asignar turno</Link>}</div><DataTable rows={assigned} empty="Todavía no hay personal asignado" emptyDetail="Coordinación puede asignar los turnos desde Manager. Cada persona confirma su turno." columns={[
        { key: 'person', title: 'Persona', render: (a) => a.user_name || data.staff?.find((s) => s.id === a.user_id)?.name || 'Usuario' },
        { key: 'role', title: 'Función', render: (a) => label(a.role) },
        { key: 'starts_at', title: 'Inicio del turno', render: (a) => dateTime(a.starts_at) },
        { key: 'status', title: 'Confirmación', render: (a) => <Badge value={a.status} /> },
      ]} /></section>
    </>}
    {dialog && <FormDialog title="Preparación del encuentro" onClose={() => setDialog(false)} help="El seguimiento se actualiza a mano para coordinar al equipo. El estado de la emisión se consulta en CTP Panel." submit={(body) => mutate('put', `/matches/${encodeURIComponent(editing.match_id)}/production`, { ...body, rundown_id: body.rundown_id ? Number(body.rundown_id) : null, expected_version: editing.version }, 'Preparación guardada en Manager.')}><Field label="Seguimiento del equipo"><select name="state" defaultValue={editing?.state || 'preparation'}>{transitions[editing?.state || 'preparation'].map((s) => <option key={s} value={s}>{states[s]}</option>)}</select></Field><Field label="Escaleta"><select name="rundown_id" defaultValue={editing?.rundown_id || ''}><option value="">Sin escaleta vinculada</option>{data.rundowns.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</select></Field><Field label="Indicaciones para el equipo"><textarea name="note" defaultValue={editing?.note || ''} rows={4} maxLength={2000} /></Field></FormDialog>}
  </>;
}

export function ClubsPanel({ data, mutate, me, reload }) {
  const [params,setParams]=useSearchParams();
  const focusedClub=params.get('club');
  const openedClub=useRef(null);
  const [selected, setSelected] = useState(null);
  const [query,setQuery]=useWorkspaceSearch(params,setParams);
  useEffect(()=>{
    if(!focusedClub){openedClub.current=null;return;}
    const club=data.clubs.find(item=>item.id===focusedClub);
    if(club&&openedClub.current!==focusedClub){openedClub.current=focusedClub;setSelected(club);setQuery('');}
  },[focusedClub,data.clubs]);
  const rows = data.clubs;
  return <><ManualClubCreatePanel data={data} mutate={mutate} me={me} reload={reload} /><div className="op-section-title"><div><h2>Identidad y verificación</h2><p>Revisión CTP y acceso al circuito.</p></div><input aria-label="Buscar club" placeholder="Buscar club…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
    {focusedClub&&<div className="op-actions"><button className="btn" onClick={()=>{setSelected(null);setParams(previous=>{const next=new URLSearchParams(previous);next.delete('club');return next;},{replace:true});}}>Ver todos los clubes</button><Link className="btn" to="/administracion/clubes">Volver a administración de clubes</Link></div>}
    <div className="op-inline-note"><ShieldCheck size={18} /><p>Los pagos se gestionan fuera de la web. CTP revisa y aprueba manualmente los 16 clubes del circuito. Crear el club no concede acceso.</p></div>
    <DataTable rows={rows} empty="Sin clubes sincronizados" columns={[
      { key: 'name', title: 'Club' },
      { key: 'verified', title: 'Verificación CTP', render: (c) => <Badge value={c.verified ? 'approved' : 'pending'}>{c.verified ? 'Verificado por CTP' : 'Sin verificar'}</Badge> },
      { key: 'pass_active', title: 'Team Pass', render: (c) => <Badge value={c.pass_active ? 'active' : 'draft'}>{c.pass_active ? 'Activo' : 'Sin pase activo'}</Badge> },
      { key: 'actions', title: 'Revisión', render: (c) => <button className="btn" disabled={c.pending_command_id} onClick={() => setSelected(c)}>{c.pending_command_id ? 'Revisión pendiente de envío' : 'Revisar identidad'}</button> },
    ]} />
    {selected && <FormDialog title={`Revisar ${selected.name}`} onClose={() => setSelected(null)} submit={(body) => mutate('post', `/clubs/${encodeURIComponent(selected.id)}/review`, { ...body, expected_version: selected.version }, 'Revisión de identidad preparada para CTP.')} submitLabel="Preparar revisión"><Field label="Decisión"><select name="decision"><option value="verify">Aprobar verificación CTP</option><option value="reject">Rechazar / retirar verificación</option></select></Field><Field label="Motivo de la revisión"><textarea name="reason" required minLength={12} rows={4} maxLength={500} /></Field></FormDialog>}
  </>;
}

export function DiscordPanel({ data, mutate }) {
  return <><div className="op-section-title"><div><h2>Comunicaciones de Discord</h2><p>Estado de entrega de anuncios y actualizaciones procedentes de CTP.</p></div></div><div className="op-inline-note"><ArrowUpRight size={17} /><p>Los retos se aceptan desde la web. El anuncio de Discord dirige al partido y refleja su estado.</p></div><DataTable rows={data.deliveries} empty="No hay entregas sincronizadas" columns={[
    { key: 'kind', title: 'Comunicación', render: (d) => d.kind || 'Actualización de reto' },
    { key: 'match', title: 'Origen', render: (d) => d.match_id ? <MatchLink id={d.match_id} match={data.matches.find((m) => m.id === d.match_id)} /> : 'CTP' },
    { key: 'status', title: 'Estado', render: (d) => <Badge value={d.status} /> },
    { key: 'error', title: 'Último error', render: (d) => d.error || '—' },
    { key: 'actions', title: 'Acción', render: (d) => ['failed', 'error', 'dead'].includes(d.status) ? <ActionButton disabled={d.pending_command_id} run={() => mutate('post', `/deliveries/${encodeURIComponent(d.id)}/retry`, { expected_version: d.version }, 'Reintento preparado para el servicio de CTP.')}><RefreshCw size={14} /> Preparar reintento</ActionButton> : '—' },
  ]} /></>;
}

export function ContentPanel({ data, mutate, can }) {
  const { toast, openContent } = useApp();
  const rows = data.matches.filter((m) => m.confirmed);
  const create = async (m) => {
    const result = await mutate('post', `/matches/${encodeURIComponent(m.id)}/content`, {}, 'Contenido preparado para revisión editorial.');
    if (can('calendario')) {
      try { openContent({ content: await api.get(`/contents/${result.id}`) }); }
      catch (err) { toast(err.message, 'error'); }
    }
  };
  return <><div className="op-section-title"><div><h2>Del partido al contenido</h2><p>Prepara publicaciones a partir de resultados confirmados, sin copiar cifras a mano.</p></div>{can('calendario') && <Link className="btn" to="/calendario">Calendario editorial <ArrowUpRight size={14} /></Link>}</div><p className="op-notice">Se crea una tarjeta con recursos para revisión. No se publica automáticamente en redes.</p><DataTable rows={rows} empty="Sin resultados confirmados para preparar contenido" columns={[
    { key: 'title', title: 'Partido', render: (m) => <MatchLink match={m} /> },
    { key: 'score', title: 'Resultado oficial', render: (m) => officialResult(m) },
    { key: 'when', title: 'Fecha', render: (m) => dateTime(m.scheduled_at) },
    { key: 'create', title: 'Contenido', render: (m) => <ActionButton run={() => create(m)}><FilePlus2 size={15} /> Preparar / abrir tarjeta</ActionButton> },
  ]} /></>;
}

export function IntegrationPanel({ data, reload }) {
  const [connection, setConnection] = useState(null);
  const [error, setError] = useState('');
  const { toast } = useApp();
  useEffect(() => { let active = true; api.get('/operations/integration').then((c) => { if (active) setConnection(c); }).catch((e) => { if (active) setError(e.message); }); return () => { active = false; }; }, [data]);
  const status = connection || data.connection || {};
  const supported = (action) => Array.isArray(status.supported_actions) ? status.supported_actions.includes(action) : status.supported_actions?.[action] === true;
  return <><div className="op-section-title"><div><h2>Conexión con el ecosistema</h2><p>Estado del enlace privado y de las decisiones pendientes de aplicar.</p></div></div>{error && <p className="op-error" role="alert">{error}</p>}<section className="op-card"><dl className="op-settings"><div><dt>Feed privado CTP</dt><dd>{status.configured ? 'Configurado' : 'Pendiente de configurar en el servidor'}</dd></div><div><dt>Última sincronización</dt><dd>{status.last_sync_at ? dateTime(status.last_sync_at) : 'Aún no se han recibido datos'}</dd></div><div><dt>Escrituras oficiales</dt><dd>{status.write_enabled ? 'Habilitadas · envío manual' : 'Desactivadas'}</dd></div><div><dt>Último error</dt><dd>{status.last_error || 'Sin errores registrados'}</dd></div></dl></section>
    {status.configured && <section className="op-card"><h3>Transición de la gestión competitiva</h3><p>{status.competition_cutover_enabled === true ? 'Gestión exclusiva desde Manager activada en CTP.' : status.competition_cutover_enabled === false ? 'Transición pendiente: la gestión existente de la web CTP sigue disponible.' : 'El backend todavía no ha confirmado el estado de la transición.'}</p><p className="muted">El cierre de las rutas antiguas se coordina en el servidor una vez comprobados el dominio y los accesos del staff. Instalar el puente no lo activa por sí solo.</p></section>}
    {!status.configured && <section className="op-card"><h3>Preparar la conexión</h3><p className="muted">El despliegue necesita el endpoint privado de CTP, dos credenciales independientes en el servidor y la vinculación de cada operador autorizado. Los secretos no se introducen ni se muestran en esta pantalla.</p><p className="muted">Consulta <code>docs/DEPLOYMENT.md</code> y <code>docs/MANAGER_OPERATIONS_BRIDGE.md</code> en los repositorios.</p></section>}
    <section className="op-card"><h3>Operadores que vincular en CTP</h3><p className="muted">El administrador de CTP debe vincular esta identidad estable con la cuenta oficial y sus permisos. No uses el ID numérico local.</p><DataTable rows={(data.staff || []).filter((s) => s.integration_actor_id)} columns={[{key:'name',title:'Persona'},{key:'integration_actor_id',title:'Identidad de integración',render:(s)=><code>{s.integration_actor_id}</code>}]} empty="Sin operadores disponibles" /></section>
    <section className="op-card"><h3>Decisiones pendientes y entregas</h3><p className="muted">Cada envío conserva su identificador para evitar efectos duplicados. Una confirmación de CTP cierra la operación.</p><DataTable rows={data.commands || []} empty="No hay comandos preparados" columns={[
      { key: 'action', title: 'Operación', render: (c) => actionLabel(c.action || c.type) },
      { key: 'actor', title: 'Autor', render: (c) => c.actor_name || data.staff.find((s) => s.id === (c.actor_id || c.actor?.id))?.name || String(c.actor_id || 'Staff') },
      { key: 'status', title: 'Estado', render: (c) => <Badge value={c.status} /> },
      { key: 'error', title: 'Detalle', render: (c) => c.last_error || c.error || (!supported(c.action || c.type) ? 'Acción no habilitada en CTP' : '—') },
      { key: 'send', title: 'Entrega', render: (c) => <div className="op-actions"><ActionButton disabled={!canSendCommand(c, status.write_enabled, supported(c.action || c.type))} run={async () => { await api.post(`/operations/integration/commands/${encodeURIComponent(c.id)}/send`, {}); await reload(); toast('CTP ha confirmado la operación.'); }}><Send size={14} /> Enviar a CTP</ActionButton>{((c.status === 'pending' && c.attempts === 0) || (c.status === 'rejected' && c.attempts === 1 && c.result?.rejected_confirmed)) && <ActionButton run={async () => { await api.post(`/operations/commands/${encodeURIComponent(c.id)}/cancel`, { expected_updated_at: c.updated_at }); await reload(); toast('Solicitud descartada.'); }}>Descartar</ActionButton>}</div> },
    ]} /></section>
  </>;
}
