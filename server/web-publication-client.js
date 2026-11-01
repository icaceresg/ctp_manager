import {HttpError} from './auth.js';
// Publicación web: qué muestra la web pública de CTP (secciones, torneos, clubes
// del Team Pass) y el IVA por zona de facturación. CTP valida cada cambio.
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const only=(value,keys)=>object(value)&&Object.keys(value).every(key=>keys.includes(key));
export const TAX_ZONES=Object.freeze(['ES','ES-CN','ES-CE','ES-ML','EU','NON_EU']);

export function webPublicationPayload(value){
 const invalid=(message='Revisa los cambios y escribe un motivo de 12 a 500 caracteres.')=>{throw new HttpError(400,message);};
 if(!object(value))invalid();
 if(value.action==='status'){if(!only(value,['action']))invalid();return{action:'status'};}
 if(value.action!=='configure'||!only(value,['action','expected_version','request_id','reason','changes'])
  ||!Number.isSafeInteger(value.expected_version)||value.expected_version<1||!uuid(value.request_id)
  ||typeof value.reason!=='string'||value.reason.trim().length<12||value.reason.length>500||/[\u0000-\u001f\u007f]/.test(value.reason)
  ||!only(value.changes,['sections','tournaments','clubs','tax_zones'])||!Object.keys(value.changes).length)invalid();
 const c=value.changes,changes={};
 if('sections' in c){
  if(!only(c.sections,['calendar','market'])||!Object.keys(c.sections).length||Object.values(c.sections).some(v=>typeof v!=='boolean'))invalid();
  changes.sections={...c.sections};
 }
 if('tournaments' in c){
  if(!Array.isArray(c.tournaments)||!c.tournaments.length||c.tournaments.length>100)invalid();
  changes.tournaments=c.tournaments.map(item=>{
   if(!only(item,['id','visible','registration_open_now'])||!uuid(item.id)||('visible' in item&&typeof item.visible!=='boolean')
    ||('registration_open_now' in item&&item.registration_open_now!==true)||Object.keys(item).length<2)invalid();
   return{...item,id:item.id.toLowerCase()};
  });
 }
 if('clubs' in c){
  if(!Array.isArray(c.clubs)||!c.clubs.length||c.clubs.length>100)invalid();
  changes.clubs=c.clubs.map(item=>{if(!only(item,['id','announced'])||!uuid(item.id)||typeof item.announced!=='boolean')invalid();return{id:item.id.toLowerCase(),announced:item.announced};});
 }
 if('tax_zones' in c){
  if(!Array.isArray(c.tax_zones)||!c.tax_zones.length||c.tax_zones.length>TAX_ZONES.length)invalid();
  changes.tax_zones=c.tax_zones.map(item=>{
   if(!only(item,['code','rate_bps','active'])||!TAX_ZONES.includes(item.code)||Object.keys(item).length<2
    ||('rate_bps' in item&&(!Number.isSafeInteger(item.rate_bps)||item.rate_bps<0||item.rate_bps>3000))
    ||('active' in item&&typeof item.active!=='boolean'))invalid('El IVA debe estar entre 0 % y 30 %.');
   return{...item};
  });
 }
 return{action:'configure',expected_version:value.expected_version,request_id:value.request_id.toLowerCase(),reason:value.reason.trim(),changes};
}

export function webPublicationResponse(value,payload){
 const fail=()=>{throw new HttpError(502,'No se ha podido verificar el estado de la web. Actualiza la consulta.');};
 if(!object(value)||value.schema_version!==1||!Number.isSafeInteger(value.revision)||value.revision<1
  ||!only(value.sections,['calendar','market'])||!Array.isArray(value.tournaments)||!Array.isArray(value.clubs)||!Array.isArray(value.tax_zones))fail();
 if(payload?.action==='configure'&&(!uuid(value.request_id)||value.request_id.toLowerCase()!==payload.request_id))fail();
 return{schema_version:1,revision:value.revision,server_time:value.server_time,updated_at:value.updated_at,
  sections:{calendar:value.sections.calendar===true,market:value.sections.market===true},
  tournaments:value.tournaments.filter(t=>object(t)&&uuid(t.id)).map(t=>({id:t.id,name:String(t.name??''),kind:t.kind,circuit_code:t.circuit_code??null,
   season:t.season??null,status:t.status,start_at:t.start_at,registration_open_at:t.registration_open_at??null,registration_close_at:t.registration_close_at??null,
   visible:t.visible===true,registration_open:t.registration_open===true,entrants:Number(t.entrants)||0,
   host:object(t.host)&&uuid(t.host.id)?{id:t.host.id,name:String(t.host.name??''),announced:t.host.announced===true}:null})),
  clubs:value.clubs.filter(c=>object(c)&&uuid(c.id)).map(c=>({id:c.id,name:String(c.name??''),tag:String(c.tag??''),announced:c.announced===true,
   announced_at:c.announced_at??null,hosting:Array.isArray(c.hosting)?c.hosting.filter(object).map(h=>({id:h.id,name:String(h.name??'')})):[]})),
  tax_zones:value.tax_zones.filter(z=>object(z)&&TAX_ZONES.includes(z.code)).map(z=>({code:z.code,tax_name:z.tax_name,rate_bps:Number(z.rate_bps)||0,active:z.active===true})),
  ...(payload?.action==='configure'?{request_id:value.request_id}:{})};
}

export function createWebPublicationClient({request,actorFor,writesEnabled}){
 return async(user,input)=>{
  if(!user?.id)throw new HttpError(401,'Necesitas iniciar sesión.');
  if(!user.is_admin||(user.auth_mode==='ctp'&&user.ctp_role!=='admin'))throw new HttpError(403,'Solo administración de CTP puede cambiar lo que muestra la web.');
  const payload=webPublicationPayload(input);
  if(payload.action==='configure'&&!writesEnabled())throw new HttpError(403,'Los cambios oficiales están desactivados.');
  const actor_id=await actorFor(user);
  if(typeof actor_id!=='string'||!/^[A-Za-z0-9._:@-]{1,100}$/.test(actor_id))throw new HttpError(403,'No se ha podido verificar la identidad de administración.');
  let result;
  try{result=await request({action:'admin_service',actor_id,service:'web_publication',payload});}
  catch(error){
   if(error?.status===409)throw new HttpError(409,'La web ha cambiado mientras preparabas el cambio. Actualiza y vuelve a aplicarlo.');
   if([401,403].includes(error?.status))throw new HttpError(403,'CTP no permite este cambio con esta cuenta.');
   if([400,422].includes(error?.status))throw new HttpError(422,'CTP ha rechazado el cambio. Un torneo ya empezado o terminado no se puede ocultar, y solo se anuncian clubes verificados.');
   throw new HttpError(502,'No se ha podido confirmar el cambio. Reintenta la misma solicitud para evitar duplicados.');
  }
  return webPublicationResponse(result,payload);
 };
}
