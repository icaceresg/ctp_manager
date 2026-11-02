import {HttpError} from './auth.js';
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,allowed)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key));
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export function siteNoticePayload(input){
 const fail=()=>{throw new HttpError(400,'El aviso no tiene un formato válido.');};
 if(!object(input))fail();
 if(input.action==='status'){if(!keys(input,['action']))fail();return{action:'status'};}
 if(!['preview','save'].includes(input.action)
  ||!keys(input,input.action==='save'?['action','title','html','enabled','expected_revision','request_id']:['action','title','html','enabled'])
  ||typeof input.title!=='string'||input.title.length>120||/[\u0000-\u001f\u007f]/.test(input.title)
  ||typeof input.html!=='string'||input.html.length>32768||typeof input.enabled!=='boolean'
  ||input.action==='save'&&(!Number.isSafeInteger(input.expected_revision)||input.expected_revision<1||!uuid(input.request_id)))fail();
 return{...input,title:input.title.trim()};
}
export function siteNoticeResponse(value,payload){
 if(!keys(value,payload.action==='save'?['schema_version','revision','enabled','title','html','request_id']:['schema_version','revision','enabled','title','html'])
  ||value.schema_version!==1||!Number.isSafeInteger(value.revision)||value.revision<1
  ||typeof value.enabled!=='boolean'||typeof value.title!=='string'||value.title.length>120
  ||typeof value.html!=='string'||value.html.length>65536
  ||payload.action==='save'&&value.request_id!==payload.request_id)throw new HttpError(502,'No se ha podido verificar el aviso devuelto por CTP.');
 return value;
}
export function createSiteNoticeClient({request,actorFor,writesEnabled}){
 return async(user,input)=>{
  if(!user?.id)throw new HttpError(401,'Necesitas iniciar sesión.');
  if(!user.is_admin||(user.auth_mode==='ctp'&&user.ctp_role!=='admin'))throw new HttpError(403,'Solo administración de CTP puede publicar avisos.');
  const payload=siteNoticePayload(input);
  if(payload.action==='save'&&!writesEnabled())throw new HttpError(403,'Los cambios oficiales están desactivados.');
  const actor_id=await actorFor(user);
  if(typeof actor_id!=='string'||!/^[A-Za-z0-9._:@-]{1,100}$/.test(actor_id))throw new HttpError(403,'No se ha podido verificar la identidad de administración.');
  let result;try{result=await request({action:'admin_service',actor_id,service:'site_notice',payload});}
  catch(error){
   if(error?.status===409)throw new HttpError(409,'El aviso ha cambiado. Actualiza antes de guardar tus cambios.');
   if([401,403].includes(error?.status))throw new HttpError(403,'CTP no permite publicar avisos con esta cuenta.');
   if([400,422].includes(error?.status))throw new HttpError(422,'CTP ha rechazado el formato del aviso. Revisa su contenido.');
   throw new HttpError(502,'No se ha podido confirmar el aviso. Reintenta la misma solicitud para evitar duplicados.');
  }
  return siteNoticeResponse(result,payload);
 };
}
