import {HttpError} from './auth.js';
import {staffAlertsPayload,staffAlertsResponse} from './staff-alerts-contract.js';

/** Uses only the existing signed Manager transport and the current administrator identity. */
export function createStaffAlertsClient({request,actorFor,writesEnabled}){
 if(typeof request!=='function'||typeof actorFor!=='function'||typeof writesEnabled!=='function')throw new TypeError('Staff alerts require the existing private bridge.');
 return async function staffAlertsService(user,input){
  if(!user?.id)throw new HttpError(401,'Necesitas iniciar sesión.');
  if(!user.is_admin||(user.auth_mode==='ctp'&&user.ctp_role!=='admin'))throw new HttpError(403,'Solo administración de CTP puede gestionar los avisos de staff.');
  const payload=staffAlertsPayload(input);
  if(payload.action==='configure'&&!writesEnabled())throw new HttpError(403,'Los cambios oficiales están desactivados.');
  const actor_id=await actorFor(user);
  if(typeof actor_id!=='string'||!/^[A-Za-z0-9._:@-]{1,100}$/.test(actor_id))throw new HttpError(403,'No se ha podido verificar la identidad del administrador de CTP.');
  let result;
  try{result=await request({action:'admin_service',actor_id,service:'staff_alerts',payload});}
  catch(error){
   if(error?.status===409)throw new HttpError(409,'La configuración ha cambiado. Actualiza el estado y revisa los servicios antes de guardar.');
   if([401,403].includes(error?.status))throw new HttpError(403,'CTP no permite gestionar los avisos de staff con esta cuenta.');
   if([400,422].includes(error?.status))throw new HttpError(422,'CTP ha rechazado esta configuración. Actualiza el estado y revisa el motivo.');
   throw new HttpError(502,'No se ha podido confirmar la consulta o el cambio de avisos de staff. Puedes reintentar la misma solicitud sin duplicarla.');
  }
  return staffAlertsResponse(result,payload);
 };
}
