import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { playerWorkspacePath } from '../navigation.js';
import { api } from '../api.js';
import { dateTime } from './model.js';
import { Empty } from './ui.jsx';
import './pc-check.css';

const PLAYER_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function pcCheckPlayerFilter(search) {
  const values=search.getAll('user_id');
  if(!values.length&&!search.has('user_id[]'))return {userId:null,error:null};
  return values.length===1&&!search.has('user_id[]')&&PLAYER_ID.test(values[0])
    ? {userId:values[0].toLowerCase(),error:null}
    : {userId:null,error:'El filtro de jugador no es un UUID CTP válido. No se han consultado otros expedientes.'};
}

const SCOPES = [[1,'Inventario de hardware'],[2,'Configuración de seguridad'],[4,'Persistencia y tareas'],[8,'Procesos y módulos elegidos'],[16,'Metadatos de red'],[32,'Eventos de seguridad'],[64,'Metadatos de memoria del juego'],[128,'Identificadores completos de hardware'],[256,'Direcciones completas de red']];
const STATUS = { complete:'Recogido', partial:'Parcial', unavailable:'No disponible', cancelled:'Cancelado', failed:'Fallido' };
const COLLECTOR_LABEL = {hardware:'Hardware y PCI',security:'Seguridad de Windows',persistence:'Registro, arranque y tareas',processes:'Procesos y módulos',network:'Conexiones de red',events:'Eventos de Windows',memory:'Metadatos de memoria del juego'};
const FINDING_LABEL = {
  HARDWARE_DRIVER_SIGNATURE_REVIEW:'Estado de firma de un controlador que requiere revisión.',
  HARDWARE_VULNERABLE_DRIVER_REVIEW:'Hash declarado que coincide con una muestra de controlador vulnerable. Puede proceder de software legítimo; no demuestra uso de cheats.',
  PROCESS_MODULE_SIGNATURE_REVIEW:'Estado de firma de un módulo que requiere contexto. No demuestra una inyección.',
  SECURITY_EVENT_METADATA_REVIEW:'Eventos de seguridad seleccionados para revisión; no identifican por sí solos un cheat.',
  PRIVATE_EXECUTABLE_METADATA_REVIEW:'Memoria privada ejecutable: también puede proceder de JIT, runtimes y aplicaciones legítimas.'
};
const DISTRIBUTIONS = {'steam':'Steam','battle-net':'Battle.net','xbox-pc':'Xbox en PC / Microsoft Store','unspecified':'No especificada'};
const quantity=(count,singular,plural)=>`${count} ${count===1?singular:plural}`;
function GameContext({ value }) {
  return <div className="pc-check-context"><h4>Contexto del juego</h4>{value?.title ? <>
    <p><strong>{value.title}</strong> · {DISTRIBUTIONS[value.distribution] || 'Distribución desconocida'}</p>
    {value.buildLabel&&<p>Versión anotada: {value.buildLabel}</p>}
    <p>Declarado por el operador. Manager no ha atestado la instalación, la versión ni el resultado privado de RICOCHET.</p>
  </> : <p>Este informe anterior no registró el contexto del juego. No se presupone que corresponda a MW4 ni a una distribución concreta.</p>}</div>;
}
function ExtraCoverage({ collector }) {
  const identity=collector.fileIdentitySummary,budget=collector.fileIdentityCoverage,catalogue=collector.driverCatalogue,events=collector.gameEventLinkSummary;
  return <>
    {identity&&<div className="pc-check-evidence-facts"><h5>Identidad de archivos</h5><p>{quantity(identity.recordCount,'registro','registros')}: {quantity(identity.completeFiles,'completo','completos')}, {quantity(identity.partialFiles,'parcial','parciales')}, {quantity(identity.unavailableFiles,'no disponible','no disponibles')} y {identity.notCollectedFiles} sin recoger.</p><p>Son metadatos aportados por el colector. La versión y empresa del recurso PE son autodeclaradas; una firma válida no prueba que el archivo sea seguro.</p></div>}
    {budget&&<p className="pc-check-budget">Presupuesto SHA-256: {budget.attemptedFiles}/{budget.maximumFiles} archivos intentados; {(budget.bytesRead/1048576).toFixed(1)}/{budget.maximumBytes/1048576} MiB leídos. Tiempo observado: {budget.elapsedSeconds.toFixed(2)} s.{budget.limitReached?' Se alcanzó un límite.':''} El presupuesto de bytes sólo mide el flujo SHA; no mide las lecturas internas de firma o versión.</p>}
    {catalogue&&<div className="pc-check-evidence-facts"><h5>Catálogo de componentes vulnerables</h5><p>{quantity(catalogue.matchCount,'coincidencia exacta','coincidencias exactas')} de SHA-256 entre los hashes declarados de archivos completos y {catalogue.entryCount} muestras revisadas. Categoría: controlador vulnerable; no equivale a componente malicioso ni a culpabilidad del jugador.</p><p>Revisión <code>{catalogue.revision}</code> · {catalogue.license}. Comparación recalculada por Manager; los binarios no se han enviado para verificar su contenido.</p>{catalogue.matches.slice(0,20).map(match=><article key={match.driverIndex}><strong>{match.family}</strong> · fila de controlador {match.driverIndex}<small>SHA-256 <code>{match.sha256}</code></small><a href={match.sourceUrl} target="_blank" rel="noreferrer">Registro original de esta revisión</a></article>)}{catalogue.matches.length>20&&<p>Se muestran 20 de {catalogue.matches.length}; consulta el JSON filtrado para revisar el resto.</p>}</div>}
    {events&&<div className="pc-check-evidence-facts"><h5>Eventos relacionados con los PID elegidos</h5><p>{quantity(events.returnedLinks,'enlace devuelto','enlaces devueltos')} de {quantity(events.examinedSysmonRecords,'registro Sysmon examinado','registros Sysmon examinados')}; cobertura {STATUS[events.status]||({'available':'disponible','not-selected':'sin PID elegido','unavailable':'no disponible'}[events.status])||events.status}.</p><ul><li>Carga de imagen (ID 7): {events.relationCounts['image-load']}</li><li>Hilo remoto dirigido al juego (ID 8): {events.relationCounts['remote-thread-target']}</li><li>Acceso a proceso dirigido al juego (ID 10): {events.relationCounts['process-access-target']}</li><li>Alteración de imagen notificada (ID 25): {events.relationCounts['image-tampering']}</li></ul><p>Vinculados por PID y ventana desde la creación observada del proceso. No atestan su identidad histórica ni demuestran una inyección; cargas y accesos pueden ser legítimos. Sólo se guarda una proyección de campos permitidos, sin XML, mensaje completo, usuario, argumentos ni CallTrace.</p></div>}
  </>;
}
function limitationLabel(code){
  if(code==='process_selected_modules_access_denied_or_exited')return 'No se pudieron consultar los módulos del proceso: acceso denegado o proceso terminado.';
  if(code==='process_no_explicit_game_pid_modules_not_collected')return 'No se seleccionó un PID de juego; no se recogieron sus módulos.';
  if(code==='memory_metadata_only_not_injection_detection')return 'Sólo se consultaron metadatos de regiones; no constituye detección concluyente de inyección.';
  if(code==='memory_private_executable_can_be_legitimate_jit_or_runtime')return 'JIT y runtimes legítimos también pueden crear memoria privada ejecutable.';
  if(code==='memory_live_process_snapshot_can_change')return 'El proceso puede cambiar durante la inspección; la evidencia es una instantánea.';
  if(code==='collection.cancelled')return 'El operador canceló la recogida.';
  if(code==='collection.notStarted')return 'La consulta no llegó a iniciarse.';
  if(code.includes('budget')||code.includes('limit'))return 'Se alcanzó un límite de tiempo, filas o tamaño. Revisa el código para conocer la fuente.';
  if(code.includes('unavailable')||code.includes('denied')||code.includes('inaccessible'))return 'La fuente no pudo consultarse o no fue accesible; no equivale a un resultado limpio.';
  return 'Condición de cobertura registrada por el colector. Consulta el código y los datos filtrados.';
}
const PREVIEW_FILES=new Set(['hardware.json','security.json','persistence.json','processes.json','network.json','events.json','memory.json']);
function preview(file) {
  if(!file)return '';
  const maximum=256*1024,prefix=file.base64.slice(0,Math.ceil(maximum/3)*4);
  const bytes=Uint8Array.from(atob(prefix),c=>c.charCodeAt(0)).slice(0,maximum);
  const text=new TextDecoder().decode(bytes),truncated=prefix.length<file.base64.length;
  return `${text}${truncated?'\n\n[VISTA TRUNCADA A 256 KiB; el original íntegro se conserva en la descarga de evidencia.]':''}`;
}
function download(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function PcCheckPanel({ can, me }) {
  const [search,setSearch]=useSearchParams();
  const {userId,error:filterError}=pcCheckPlayerFilter(search);
  const [cases,setCases]=useState([]),[detail,setDetail]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[scopes,setScopes]=useState(63),[loaded,setLoaded]=useState(false),[reviewers,setReviewers]=useState([]);
  const [evidence,setEvidence]=useState(null),[selectedFile,setSelectedFile]=useState('');
  const detailRequest=useRef(0);
  const listRequest=useRef(0);
  const permitted=Boolean(me?.is_admin||can('arbitraje'));
  const reload=useCallback(async()=>{
    const request=++listRequest.current;
    if(!permitted||filterError){setCases([]);setLoaded(true);setError(filterError||'');return;}
    try{const data=await api.get(`/pc-check/cases${userId?'?user_id='+encodeURIComponent(userId):''}`);if(request===listRequest.current){setCases(data.cases);setError('');}}
    catch(e){if(request===listRequest.current){setCases([]);if([401,403,410].includes(e.status)){detailRequest.current++;setDetail(null);setEvidence(null);setSelectedFile('');}setError(e.message);}}
    finally{if(request===listRequest.current)setLoaded(true);}
  },[userId,filterError,permitted]);
  useEffect(()=>{setLoaded(false);setCases([]);setDetail(null);setEvidence(null);setSelectedFile('');reload();return()=>{listRequest.current++;detailRequest.current++;};},[reload]);
  useEffect(()=>{if(!permitted)return;let active=true;api.get('/pc-check/reviewers').then(x=>{if(active)setReviewers(x.reviewers);}).catch(()=>{});return()=>{active=false;};},[permitted]);
  if (!permitted) return null;
  const open=async id=>{const request=++detailRequest.current;setDetail(null);setEvidence(null);setSelectedFile('');try{const next=await api.get(`/pc-check/cases/${id}`);if(request===detailRequest.current){setDetail(next);setError('');}}catch(e){if(request===detailRequest.current){setDetail(null);setEvidence(null);setError(e.message);}}};
  const act=async fn=>{setBusy(true);try{await fn();setError('');}catch(e){if([401,403,410].includes(e.status)){detailRequest.current++;setDetail(null);setEvidence(null);setSelectedFile('');}setError(e.message);}finally{setBusy(false);}};
  const create=event=>{event.preventDefault();const form=new FormData(event.currentTarget);act(async()=>{const item=await api.post('/pc-check/cases',{playerId:form.get('playerId'),playerAlias:form.get('playerAlias'),purpose:form.get('purpose'),retentionDays:Number(form.get('retentionDays')),allowedScopes:scopes});await reload();await open(item.id);});};
  const issue=id=>act(async()=>{const assignment=await api.post(`/pc-check/cases/${id}/assignment`,{});download(assignment,`ctp-pc-check-${id}.json`);await open(id);});
  const note=event=>{event.preventDefault();const form=event.currentTarget;act(async()=>{await api.post(`/pc-check/cases/${detail.case.id}/review`,{text:new FormData(form).get('text')});form.reset();await open(detail.case.id);});};
  const assign=event=>{event.preventDefault();const reviewerId=Number(new FormData(event.currentTarget).get('reviewerId'));act(async()=>{await api.post(`/pc-check/cases/${detail.case.id}/reviewers`,{reviewerId});await open(detail.case.id);});};
  const revoke=reviewerId=>act(async()=>{await api.post(`/pc-check/cases/${detail.case.id}/reviewers`,{reviewerId,enabled:false});await open(detail.case.id);});
  const inspect=()=>{const id=detail.case.id,request=detailRequest.current;act(async()=>{try{const next=await api.get(`/pc-check/cases/${id}/evidence`);if(request!==detailRequest.current)return;const files=next.evidence.artifacts.filter(x=>PREVIEW_FILES.has(x.name));setEvidence({caseId:id,files});setSelectedFile(files[0]?.name||'');}catch(e){if(request===detailRequest.current){setEvidence(null);if([401,403,410].includes(e.status))setDetail(null);}throw e;}});};
  const visibleCases=userId?cases.filter(item=>item.playerId===userId):cases;
  return <section className="op-card pc-check-panel">
    <div className="op-section-title"><div><h2>PC Check · Modern Warfare 4</h2><p>Expedientes privados, recepción de evidencias y revisión posterior del árbitro.</p></div><button className="btn" disabled={busy} onClick={reload}>Actualizar expedientes</button></div>
    {userId&&<p className="op-notice">Expedientes del jugador <code>{userId}</code>. Se mantiene el acceso del creador, revisores autorizados y administradores. <Link to={playerWorkspacePath(userId)}>Volver a la ficha del jugador</Link> · <button className="btn sm" type="button" onClick={()=>setSearch(current=>{const next=new URLSearchParams(current);next.delete('user_id');return next;})}>Ver mis expedientes</button></p>}
    <p className="op-notice">El ID y alias los asigna el staff; esto no verifica un inicio de sesión del jugador. La app necesita consentimiento específico. Los hallazgos requieren revisión humana y no aplican sanciones.</p>
    {(filterError||error)&&<p className="op-error" role="alert">{filterError||error}</p>}
    {!filterError&&<details><summary>Crear expediente y asignación</summary><form key={userId||'all'} onSubmit={create} className="pc-check-form">
      <label>ID CTP del jugador (UUID)<input name="playerId" required maxLength={36} pattern="[0-9a-fA-F-]{36}" autoComplete="off" defaultValue={userId||''} readOnly={Boolean(userId)} /></label>
      <label>Alias del jugador<input name="playerAlias" required maxLength={80} autoComplete="off" /></label>
      <label>Finalidad del check<textarea name="purpose" required minLength={10} maxLength={500} rows={2}/></label>
      <label>Plazo de acceso en Manager (días; purga manual pendiente)<input name="retentionDays" type="number" min={1} max={30} defaultValue={7} required /></label>
      <fieldset><legend>Alcances máximos autorizables</legend>{SCOPES.map(([bit,name])=><label key={bit}><input type="checkbox" checked={Boolean(scopes&bit)} onChange={e=>setScopes(e.target.checked?scopes|bit:scopes&~bit)} /> {name}</label>)}</fieldset>
      <p>El operador será {me.name||me.username}. El archivo de asignación contiene una capacidad temporal privada: compártelo sólo con la sesión del check.</p>
      <button className="btn primary" disabled={busy||!scopes}>Crear expediente</button>
    </form></details>}
    {!filterError&&(!loaded?<p>Cargando expedientes…</p>:!visibleCases.length?<Empty title="Sin expedientes disponibles">{userId?'No hay expedientes vigentes de este jugador a los que tengas acceso.':'Aparecerán aquí los tuyos; un administrador puede consultar todos los vigentes.'}</Empty>:<div className="pc-check-list">{visibleCases.map(item=><button key={item.id} type="button" className="btn" onClick={()=>open(item.id)}>{item.playerAlias} · {item.summary?STATUS[item.summary.state]||item.summary.state:'Pendiente de evidencia'} · {dateTime(item.createdAtUtc)}</button>)}</div>)}
    {!filterError&&detail&&(!userId||detail.case.playerId===userId)&&<div className="pc-check-detail"><h3>{detail.case.playerAlias}</h3><p>ID CTP: <code>{detail.case.playerId}</code> · Árbitro: {detail.case.operatorAlias}</p><p>{detail.case.purpose}</p><p>Acceso hasta: {dateTime(detail.case.expiresAtUtc)} · Asignación: {detail.case.assignmentExpiresAtUtc?dateTime(detail.case.assignmentExpiresAtUtc):'Aún sin emitir'}</p><p>El vencimiento bloquea la consulta; la purga física de SQLite y copias de seguridad aún requiere un procedimiento manual autorizado.</p>
      <h4>Revisores autorizados</h4><p>El creador y administradores tienen acceso. Otro árbitro sólo puede leer y anotar tras asignación explícita.</p>{detail.reviewers.map(r=><p key={r.id}>{r.name} {detail.canAssignReviewers&&<button className="btn" disabled={busy} onClick={()=>revoke(r.id)}>Retirar acceso</button>}</p>)}
      {detail.canAssignReviewers&&<form onSubmit={assign}><label>Asignar otro árbitro<select name="reviewerId" required defaultValue=""><option value="" disabled>Seleccionar staff de arbitraje</option>{reviewers.filter(r=>r.id!==detail.case.assignedOperatorId&&!detail.reviewers.some(a=>a.id===r.id)).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label><button className="btn" disabled={busy}>Autorizar revisión posterior</button></form>}
      {!detail.case.receiptId?(detail.canAssignReviewers&&<button className="btn" disabled={busy} onClick={()=>issue(detail.case.id)}>Descargar / reemitir asignación privada</button>):<>
        <p>Recibido: {dateTime(detail.case.receivedAtUtc)} · Recibo: <code>{detail.case.receiptId}</code></p>
        <GameContext value={detail.case.summary.gameContext}/>
        <p className="op-notice">Estado {STATUS[detail.case.summary.state]||detail.case.summary.state}. {detail.case.summary.reviewFlagCount} {detail.case.summary.reviewFlagCount===1?'señal':'señales'} para revisar; no constituyen un veredicto de culpabilidad.{detail.case.summary.syntheticFixture?' Evidencia sintética de validación.':''}</p>
        {detail.case.summary.collectors.map(c=><div className="pc-check-collector" key={c.id}><strong>{COLLECTOR_LABEL[c.id]||c.id} · {STATUS[c.status]||c.status}{c.truncated?' · truncado':''}</strong><ul>{c.limitations.map((l,i)=><li key={`${l}-${i}`}>{limitationLabel(l)} <small><code>{l}</code></small></li>)}</ul>{c.findings.map((f,i)=><p key={`${f.code}-${i}`}>{FINDING_LABEL[f.code]||'Señal registrada para revisión humana.'}{f.count?` · ${quantity(f.count,'observación','observaciones')}`:''}<br/><small><code>{f.code}</code></small></p>)}<ExtraCoverage collector={c}/></div>)}
        <button className="btn" disabled={busy} onClick={inspect}>Consultar evidencia filtrada (acceso auditado)</button>
        {evidence?.caseId===detail.case.id&&<div><label>Collector JSON<select value={selectedFile} onChange={event=>setSelectedFile(event.target.value)}>{evidence.files.map(file=><option key={file.name}>{file.name}</option>)}</select></label><p>Vista de texto, máximo 256 KiB. No se ejecuta HTML ni se consultan enlaces del contenido.</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:520,overflow:'auto'}}>{preview(evidence.files.find(file=>file.name===selectedFile))}</pre></div>}
        <button className="btn" disabled={busy} onClick={()=>act(async()=>download(await api.get(`/pc-check/cases/${detail.case.id}/evidence`),`ctp-pc-check-evidence-${detail.case.id}.json`))}>Descargar JSON de evidencia (acceso auditado)</button>
        <h4>Notas de revisión</h4>{detail.reviews.map(n=><article key={n.id}><p>{n.text}</p><small>{n.authorAlias} · {dateTime(n.createdAtUtc)}</small></article>)}<form onSubmit={note}><label>Nota del árbitro<textarea name="text" maxLength={4000} required rows={3}/></label><button className="btn" disabled={busy}>Añadir nota con autor y fecha</button></form>
      </>}
    </div>}
  </section>;
}
