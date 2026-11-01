import {HttpError} from './auth.js';
// Publicación web: qué muestra la web pública de CTP (secciones, torneos, clubes
// del Team Pass) y los impuestos (IVA de España, OSS y tipos de la UE). CTP valida cada cambio.
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const only=(value,keys)=>object(value)&&Object.keys(value).every(key=>keys.includes(key));
export const EU_COUNTRIES=Object.freeze(['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','SE']);
const rate=value=>Number.isSafeInteger(value)&&value>=0&&value<=3000;

export function webPublicationPayload(value){
 const invalid=(message='Revisa los cambios y escribe un motivo de 12 a 500 caracteres.')=>{throw new HttpError(400,message);};
 if(!object(value))invalid();
 if(value.action==='status'){if(!only(value,['action']))invalid();return{action:'status'};}
 if(value.action!=='configure'||!only(value,['action','expected_version','request_id','reason','changes'])
  ||!Number.isSafeInteger(value.expected_version)||value.expected_version<1||!uuid(value.request_id)
  ||typeof value.reason!=='string'||value.reason.trim().length<12||value.reason.length>500||/[\u0000-\u001f\u007f]/.test(value.reason)
  ||!only(value.changes,['sections','tournaments','clubs','tax'])||!Object.keys(value.changes).length)invalid();
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
 if('tax' in c){
  const t=c.tax,message='El IVA debe estar entre 0 % y 30 %.';
  if(!only(t,['spain_rate_bps','oss_active','eu_rates','management_fee_active','management_fee_cents'])||!Object.keys(t).length)invalid(message);
  if('management_fee_active' in t&&typeof t.management_fee_active!=='boolean')invalid();
  if('management_fee_cents' in t&&!(Number.isSafeInteger(t.management_fee_cents)&&t.management_fee_cents>=0&&t.management_fee_cents<=2000))invalid('Los gastos de gestión deben estar entre 0 y 20 €.');
  if('spain_rate_bps' in t&&!rate(t.spain_rate_bps))invalid(message);
  if('oss_active' in t&&typeof t.oss_active!=='boolean')invalid();
  if('eu_rates' in t&&(!Array.isArray(t.eu_rates)||!t.eu_rates.length||t.eu_rates.length>EU_COUNTRIES.length
   ||t.eu_rates.some(r=>!only(r,['country','rate_bps'])||!EU_COUNTRIES.includes(r.country)||!rate(r.rate_bps))))invalid(message);
  changes.tax={...t,...('eu_rates' in t?{eu_rates:t.eu_rates.map(r=>({country:r.country,rate_bps:r.rate_bps}))}:{})};
 }
 return{action:'configure',expected_version:value.expected_version,request_id:value.request_id.toLowerCase(),reason:value.reason.trim(),changes};
}

export function webPublicationResponse(value,payload){
 const fail=()=>{throw new HttpError(502,'No se ha podido verificar el estado de la web. Actualiza la consulta.');};
 if(!object(value)||value.schema_version!==1||!Number.isSafeInteger(value.revision)||value.revision<1
  ||!only(value.sections,['calendar','market'])||!Array.isArray(value.tournaments)||!Array.isArray(value.clubs)||!object(value.tax)||!Array.isArray(value.tax.eu_rates))fail();
 if(payload?.action==='configure'&&(!uuid(value.request_id)||value.request_id.toLowerCase()!==payload.request_id))fail();
 return{schema_version:1,revision:value.revision,server_time:value.server_time,updated_at:value.updated_at,
  sections:{calendar:value.sections.calendar===true,market:value.sections.market===true},
  tournaments:value.tournaments.filter(t=>object(t)&&uuid(t.id)).map(t=>({id:t.id,name:String(t.name??''),kind:t.kind,circuit_code:t.circuit_code??null,
   season:t.season??null,status:t.status,start_at:t.start_at,registration_open_at:t.registration_open_at??null,registration_close_at:t.registration_close_at??null,
   visible:t.visible===true,registration_open:t.registration_open===true,entrants:Number(t.entrants)||0,
   host:object(t.host)&&uuid(t.host.id)?{id:t.host.id,name:String(t.host.name??''),announced:t.host.announced===true}:null})),
  clubs:value.clubs.filter(c=>object(c)&&uuid(c.id)).map(c=>({id:c.id,name:String(c.name??''),tag:String(c.tag??''),announced:c.announced===true,
   announced_at:c.announced_at??null,hosting:Array.isArray(c.hosting)?c.hosting.filter(object).map(h=>({id:h.id,name:String(h.name??'')})):[]})),
  tax:{spain_rate_bps:Number(value.tax.spain_rate_bps)||0,oss_active:value.tax.oss_active===true,
   oss_threshold_cents:Number(value.tax.oss_threshold_cents)||1000000,
   management_fee_active:value.tax.management_fee_active===true,management_fee_cents:Number(value.tax.management_fee_cents)||0,eu_consumer_sales_cents:Number(value.tax.eu_consumer_sales_cents)||0,
   eu_rates:value.tax.eu_rates.filter(r=>object(r)&&EU_COUNTRIES.includes(r.country)).map(r=>({country:r.country,rate_bps:Number(r.rate_bps)||0}))},
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
