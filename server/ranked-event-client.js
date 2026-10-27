import {HttpError} from './auth.js';
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
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
  ||value.xp_multiplier!==2||value.streak_bonus!==0.5||value.starts_at!==null||value.ends_at!==null
  ||!Number.isSafeInteger(value.revision)||value.revision<1||value.revision>999999999999999
  ||typeof value.server_time!=='string'||value.server_time.length>40||!Number.isFinite(Date.parse(value.server_time)))fail();
 if(payload?.action==='configure'&&(!uuid(value.request_id)||value.request_id.toLowerCase()!==payload.request_id
  ||value.enabled!==payload.enabled||value.revision<payload.expected_version+1))fail();
 return{schema_version:1,event_id:'hw-2026',enabled:value.enabled,theme:'halloween',xp_multiplier:2,streak_bonus:0.5,
  starts_at:null,ends_at:null,revision:value.revision,server_time:value.server_time,
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
