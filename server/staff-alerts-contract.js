import {HttpError} from './auth.js';

export const STAFF_ALERT_PROVIDERS=Object.freeze(['discord','telegram']);
export const STAFF_ALERT_STATUSES=Object.freeze(['pending','claimed','dispatching','sent','uncertain','failed','cancelled']);
export const STAFF_ALERT_EVENTS=Object.freeze(['ticket.opened','ticket.awaiting_staff','ranked.dispute_opened','ranked.player_reported']);
export const STAFF_ALERT_ERRORS=Object.freeze(['rate_limited','provider_unavailable','provider_rejected','configuration_invalid','delivery_uncertain','lease_expired','disabled','max_attempts','event_expired']);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const invalid=()=>{throw new HttpError(400,'La configuración de avisos de staff no es válida. Usa ambos servicios y un motivo de 12 a 500 caracteres.');};
const incomplete=()=>{throw new HttpError(502,'No se ha podido verificar el estado completo de los avisos de staff. Actualiza la consulta.');};
const integer=(value,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&value>=min&&value<=max?value:incomplete();
const id=value=>typeof value==='string'&&UUID.test(value)?value.toLowerCase():incomplete();
const choice=(value,values)=>values.includes(value)?value:incomplete();
const date=value=>typeof value==='string'&&value.length<=40&&/^\d{4}-\d\d-\d\dT/.test(value)&&Number.isFinite(Date.parse(value))?value:incomplete();
function providers(value,fail){
 if(!Array.isArray(value)||value.length!==2||value.some(row=>!object(row)||!STAFF_ALERT_PROVIDERS.includes(row.provider)||typeof row.enabled!=='boolean')||new Set(value.map(row=>row.provider)).size!==2)fail();
 return STAFF_ALERT_PROVIDERS.map(provider=>({provider,enabled:value.find(row=>row.provider===provider).enabled}));
}

/** Only configuration is accepted: no credentials, destinations, sends or retry actions. */
export function staffAlertsPayload(value){
 if(!object(value))invalid();
 if(value.action==='status'){
  if(Object.keys(value).some(key=>key!=='action'))invalid();
  return{action:'status'};
 }
 if(value.action!=='configure'||Object.keys(value).some(key=>!['action','expected_version','request_id','reason','providers'].includes(key))
  ||!Number.isSafeInteger(value.expected_version)||value.expected_version<1||typeof value.request_id!=='string'||!UUID.test(value.request_id)
  ||typeof value.reason!=='string'||value.reason.trim().length<12||value.reason.trim().length>500||/[\u0000-\u001f\u007f]/.test(value.reason))invalid();
 const selected=providers(value.providers,invalid);
 if(value.providers.some(row=>Object.keys(row).some(key=>!['provider','enabled'].includes(key))))invalid();
 return{action:'configure',expected_version:value.expected_version,request_id:value.request_id.toLowerCase(),reason:value.reason.trim(),providers:selected};
}

/** Project only agreed aggregates and safe references; partial data is never converted to zero. */
export function staffAlertsResponse(value,payload={action:'status'}){
 if(!object(value)||value.available!==true||!object(value.counts)||!Array.isArray(value.recent)||value.recent.length>30)incomplete();
 const selected=providers(value.providers,incomplete),counts=Object.fromEntries(STAFF_ALERT_STATUSES.map(status=>[status,integer(value.counts[status])]));
 const recent=value.recent.map(row=>{
  if(!object(row))incomplete();
  const event_kind=choice(row.event_kind,STAFF_ALERT_EVENTS),resource_kind=choice(row.resource_kind,['ticket','ranked_dispute','ranked_report']);
  if((event_kind.startsWith('ticket.')&&resource_kind!=='ticket')||(event_kind==='ranked.dispute_opened'&&resource_kind!=='ranked_dispute')||(event_kind==='ranked.player_reported'&&resource_kind!=='ranked_report'))incomplete();
  return{id:id(row.id),event_kind,resource_kind,resource_id:id(row.resource_id),link_id:id(row.link_id),created_at:date(row.created_at),
   provider:choice(row.provider,STAFF_ALERT_PROVIDERS),status:choice(row.status,STAFF_ALERT_STATUSES),attempts:integer(row.attempts,0,5),error_code:row.error_code===null?null:choice(row.error_code,STAFF_ALERT_ERRORS)};
 });
 if(new Set(recent.map(row=>row.id)).size!==recent.length)incomplete();
 const version=integer(value.version,1),receipt={};
 if(payload.action==='configure'){
  if(id(value.request_id)!==payload.request_id||version<payload.expected_version||JSON.stringify(selected)!==JSON.stringify(payload.providers))incomplete();
  receipt.request_id=payload.request_id;
 }
 return{available:true,observed_at:date(value.observed_at),version,providers:selected,counts,recent,...receipt};
}
