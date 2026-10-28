import {HttpError} from './auth.js';
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const stamp=value=>typeof value==='string'&&value.length<=40&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
const fixedMaps=['Mumbai','Munition','Reactor U92','Rooftops','Silkworm'];
const rotatingMaps=['Sentry','Lithium'];
const sameNames=(value,expected)=>Array.isArray(value)&&value.length===expected.length&&new Set(value).size===expected.length&&expected.every(name=>value.includes(name));
function rotationResponse(value,event,fail){
 if(!object(value)||value.schema_version!==1||value.event_id!=='hw-2026'||typeof value.enabled!=='boolean'
  ||value.enabled!==event.enabled||value.interval_seconds!==1200||value.frozen!==false||!stamp(value.observed_at)
  ||Date.parse(value.observed_at)!==Date.parse(event.server_time)||!sameNames(value.fixed_maps,fixedMaps))fail();
 if(value.enabled){
  if(!rotatingMaps.includes(value.active_map)||!rotatingMaps.includes(value.next_map)||value.active_map===value.next_map
   ||!stamp(value.slot_starts_at)||!stamp(value.next_rotation_at)||Date.parse(value.next_rotation_at)-Date.parse(value.slot_starts_at)!==1200000
   ||Date.parse(value.observed_at)<Date.parse(value.slot_starts_at)||Date.parse(value.observed_at)>=Date.parse(value.next_rotation_at)
   ||!sameNames(value.active_pool,[...fixedMaps,value.active_map]))fail();
 }else if(value.active_map!==null||value.next_map!==null||value.slot_starts_at!==null||value.next_rotation_at!==null
  ||!sameNames(value.active_pool,['Coal','Lotus',...fixedMaps]))fail();
 return{schema_version:1,event_id:'hw-2026',enabled:value.enabled,interval_seconds:1200,frozen:false,
  active_map:value.active_map,next_map:value.next_map,slot_starts_at:value.slot_starts_at,next_rotation_at:value.next_rotation_at,
  observed_at:value.observed_at,fixed_maps:[...value.fixed_maps],active_pool:[...value.active_pool]};
}
export function rankedEventPayload(value){
 const invalid=()=>{throw new HttpError(400,'Revisa el estado, la referencia y un motivo de 12 a 500 caracteres.');};
 if(!object(value))invalid();
 if(value.action==='status'){
  if(Object.keys(value).some(key=>key!=='action'))invalid();return{action:'status'};
 }
 if(value.action!=='configure'||Object.keys(value).some(key=>!['action','expected_version','request_id','reason','enabled'].includes(key))
  ||!Number.isSafeInteger(value.expected_version)||value.expected_version<1||value.expected_version>999999999999999||!uuid(value.request_id)
  ||typeof value.enabled!=='boolean'||typeof value.reason!=='string'||value.reason.trim().length<12||value.reason.length>500
  ||/[\u0000-\u001f\u007f]/.test(value.reason))invalid();
 return{action:'configure',expected_version:value.expected_version,request_id:value.request_id.toLowerCase(),reason:value.reason.trim(),enabled:value.enabled};
}
export function rankedEventResponse(value,payload){
 const fail=()=>{throw new HttpError(502,'No se ha podido verificar el estado completo del evento. Actualiza la consulta.');};
 if(!object(value)||value.schema_version!==1||value.event_id!=='hw-2026'||value.theme!=='halloween'||typeof value.enabled!=='boolean'
  ||value.xp_multiplier!==1||value.streak_bonus!==0.5||value.starts_at!==null||value.ends_at!==null
  ||!Number.isSafeInteger(value.revision)||value.revision<1||value.revision>999999999999999
  ||!stamp(value.server_time))fail();
 if(payload?.action==='configure'&&(!uuid(value.request_id)||value.request_id.toLowerCase()!==payload.request_id
  ||value.enabled!==payload.enabled||value.revision<payload.expected_version+1))fail();
 const rotation=value.map_rotation===undefined?undefined:rotationResponse(value.map_rotation,value,fail);
 return{schema_version:1,event_id:'hw-2026',enabled:value.enabled,theme:'halloween',xp_multiplier:1,streak_bonus:0.5,
  starts_at:null,ends_at:null,revision:value.revision,server_time:value.server_time,
  ...(rotation?{map_rotation:rotation}:{}),
  ...(payload?.action==='configure'?{request_id:payload.request_id}:{})};
}
export function createRankedEventClient({request,actorFor,writesEnabled}){
 return async(user,input)=>{
  if(!user?.id)throw new HttpError(401,'Necesitas iniciar sesión.');
  if(!user.is_admin||(user.auth_mode==='ctp'&&user.ctp_role!=='admin'))throw new HttpError(403,'Solo administración de CTP puede cambiar el evento Ranked.');
  const payload=rankedEventPayload(input);
  if(payload.action==='configure'&&!writesEnabled())throw new HttpError(403,'Los cambios oficiales están desactivados.');
  const actor_id=await actorFor(user);
  if(typeof actor_id!=='string'||!/^[A-Za-z0-9._:@-]{1,100}$/.test(actor_id))throw new HttpError(403,'No se ha podido verificar la identidad de administración.');
  let result;
  try{result=await request({action:'admin_service',actor_id,service:'ranked_event',payload});}
  catch(error){
   if(error?.status===409)throw new HttpError(409,'El evento ha cambiado. Actualiza el estado antes de preparar otro cambio.');
   if([401,403].includes(error?.status))throw new HttpError(403,'CTP no permite cambiar el evento con esta cuenta.');
   if([400,422].includes(error?.status))throw new HttpError(422,'CTP ha rechazado el cambio del evento. Actualiza el estado.');
   throw new HttpError(502,'No se ha podido confirmar el cambio. Reintenta la misma solicitud para evitar duplicados.');
  }
  return rankedEventResponse(result,payload);
 };
}
