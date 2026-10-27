export const STAFF_ALERT_PROVIDER_LABELS={discord:'Discord',telegram:'Telegram'};
export const STAFF_ALERT_STATUS_LABELS={pending:'Pendientes',claimed:'Reservadas',dispatching:'En envío',sent:'Enviadas',uncertain:'Inciertas',failed:'Fallidas',cancelled:'Canceladas'};
export const STAFF_ALERT_EVENT_LABELS={'ticket.opened':'Ticket abierto','ticket.awaiting_staff':'Ticket pendiente del staff','ranked.dispute_opened':'Disputa Ranked','ranked.player_reported':'Reporte de jugador Ranked','staff.canary':'PRE · prueba automática de avisos'};
export const STAFF_ALERT_ERROR_LABELS={rate_limited:'Límite temporal del servicio',provider_unavailable:'Servicio no disponible',provider_rejected:'Servicio rechazó la entrega',configuration_invalid:'Configuración pendiente de revisión',delivery_uncertain:'Entrega sin confirmar',lease_expired:'Reserva caducada',disabled:'Servicio desactivado',max_attempts:'Límite de intentos alcanzado',event_expired:'Aviso caducado'};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const providers=['discord','telegram'];
export const staffAlertProvider=provider=>STAFF_ALERT_PROVIDER_LABELS[provider]||'Servicio no disponible';
export const staffAlertStatus=status=>STAFF_ALERT_STATUS_LABELS[status]||'Sin estado verificado';
export const staffAlertError=code=>code===null?'':STAFF_ALERT_ERROR_LABELS[code]||'Motivo no disponible';
export function staffAlertPath(row){
 if(typeof row?.link_id!=='string'||!UUID.test(row.link_id))return null;
 if(row.event_kind==='staff.canary'||row.resource_kind==='canary')return row.event_kind==='staff.canary'&&row.resource_kind==='canary'&&row.resource_id===row.link_id?'/administracion/integraciones':null;
 if(row.resource_kind==='ticket')return '/operaciones/incidencias?'+new URLSearchParams({case:row.link_id.toLowerCase(),state:'all'});
 if(['ranked_dispute','ranked_report'].includes(row.resource_kind))return `/ranked/partidas/${row.link_id.toLowerCase()}`;
 return null;
}
export function staffAlertsAttempt(pending,{version,enabled,reason},newId=()=>crypto.randomUUID()){
 const body={action:'configure',expected_version:version,reason:typeof reason==='string'?reason.trim():'',providers:providers.map(provider=>({provider,enabled:enabled?.[provider]}))};
 if(!Number.isSafeInteger(version)||version<1||body.reason.length<12||body.reason.length>500||/[\u0000-\u001f\u007f]/.test(body.reason)||body.providers.some(row=>typeof row.enabled!=='boolean'))throw new Error('Selecciona ambos servicios y escribe un motivo de 12 a 500 caracteres.');
 if(pending){
  const {request_id,...original}=pending;
  if(JSON.stringify(original)!==JSON.stringify(body))throw new Error('Hay una configuración pendiente de confirmar. Reintenta la misma solicitud antes de cambiarla.');
  return pending;
 }
 const request_id=newId();
 if(typeof request_id!=='string'||!UUID.test(request_id))throw new Error('No se ha podido crear una referencia segura. Actualiza la página.');
 return{...body,request_id:request_id.toLowerCase()};
}
