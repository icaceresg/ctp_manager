import {HttpError} from './auth.js';
import {paymentPricingPayload,paymentPricingResponse} from './payment-pricing.js';
import {readImageInfo} from '../shared/image-format.js';
import {requireTransparentLogoPng} from '../shared/transparent-logo.js';
// Publicación web: qué muestra la web pública de CTP (secciones, torneos con su
// anfitrión y fecha, clubes del Team Pass, Semi-Team Pass y Circuit Pass con su
// página) y los impuestos (IVA de España, OSS y tipos de la UE). CTP valida cada cambio.
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const only=(value,keys)=>object(value)&&Object.keys(value).every(key=>keys.includes(key));
export const EU_COUNTRIES=Object.freeze(['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','SE']);
const rate=value=>Number.isSafeInteger(value)&&value>=0&&value<=3000;
const color=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
const CLUB_KEYS=['id','announced','program','circuit_pass','primary_color','secondary_color','tagline','logo_path','cover_path'];
const imagePath=(value,team,ext)=>value===null||typeof value==='string'&&value.toLowerCase().startsWith(team+'/')
 &&new RegExp('^[a-f0-9-]{36}/[a-f0-9-]{36}\\.'+ext+'$','i').test(value);

export function webPublicationPayload(value){
 const invalid=(message='Revisa los cambios y escribe un motivo de 12 a 500 caracteres.')=>{throw new HttpError(400,message);};
 if(!object(value))invalid();
 if(value.action==='status'){if(!only(value,['action']))invalid();return{action:'status'};}
 if(value.action==='search'){
  if(!only(value,['action','query'])||typeof value.query!=='string'||value.query.trim().length<2||value.query.length>40)invalid('Escribe de 2 a 40 caracteres para buscar un club.');
  return{action:'search',query:value.query.trim()};
 }
 if(value.action==='upload'){
  const kind=value.kind,type=kind==='logo'?'image/png':'image/webp';
  if(!only(value,['action','team_id','kind','content_type','base64','request_id'])||!uuid(value.team_id)||!uuid(value.request_id)
   ||!['logo','cover'].includes(kind)||value.content_type!==type||typeof value.base64!=='string'||value.base64.length>2796204
   ||!/^[A-Za-z0-9+/]+={0,2}$/.test(value.base64))invalid('El escudo debe ser PNG transparente y el banner WebP. Máximo 2 MB.');
  const bytes=Buffer.from(value.base64,'base64');
  if(bytes.length>2*1024*1024||bytes.toString('base64')!==value.base64)invalid('Sube la imagen de nuevo.');
  try{const info=readImageInfo(bytes,type);if(info.animated||kind==='cover'&&(info.width>1600||info.height>600))invalid('Usa una imagen estática con las dimensiones admitidas.');}catch{invalid('La imagen no coincide con su formato.');}
  return{action:'upload',team_id:value.team_id.toLowerCase(),kind,content_type:type,base64:value.base64,request_id:value.request_id.toLowerCase()};
 }
 if(value.action!=='configure'||!only(value,['action','expected_version','request_id','reason','changes'])
  ||!Number.isSafeInteger(value.expected_version)||value.expected_version<1||!uuid(value.request_id)
  ||typeof value.reason!=='string'||value.reason.trim().length<12||value.reason.length>500||/[\u0000-\u001f\u007f]/.test(value.reason)
  ||!only(value.changes,['sections','tournaments','clubs','tax','pricing'])||!Object.keys(value.changes).length)invalid();
 const c=value.changes,changes={};
 if('sections' in c){
  if(!only(c.sections,['calendar','market'])||!Object.keys(c.sections).length||Object.values(c.sections).some(v=>typeof v!=='boolean'))invalid();
  changes.sections={...c.sections};
 }
 if('tournaments' in c){
  if(!Array.isArray(c.tournaments)||!c.tournaments.length||c.tournaments.length>100)invalid();
  changes.tournaments=c.tournaments.map(item=>{
   if(!only(item,['id','visible','registration_open_now','host_club_id','date_visible'])||!uuid(item.id)||('visible' in item&&typeof item.visible!=='boolean')
    ||('registration_open_now' in item&&typeof item.registration_open_now!=='boolean')||('date_visible' in item&&typeof item.date_visible!=='boolean')
    ||('host_club_id' in item&&item.host_club_id!==null&&!uuid(item.host_club_id))||Object.keys(item).length<2)invalid();
   return{...item,id:item.id.toLowerCase(),...(typeof item.host_club_id==='string'?{host_club_id:item.host_club_id.toLowerCase()}:{})};
  });
 }
 if('clubs' in c){
  if(!Array.isArray(c.clubs)||!c.clubs.length||c.clubs.length>100)invalid();
  changes.clubs=c.clubs.map(item=>{
   if(!only(item,CLUB_KEYS)||!uuid(item.id)||Object.keys(item).length<2)invalid();
   const id=item.id.toLowerCase();
   if(('announced' in item&&typeof item.announced!=='boolean')||('circuit_pass' in item&&typeof item.circuit_pass!=='boolean')
    ||('program' in item&&item.program!==null&&item.program!=='semi_team_pass'))invalid();
   if(('primary_color' in item&&!color(item.primary_color))||('secondary_color' in item&&!color(item.secondary_color)))invalid('Los colores deben ser hexadecimales, por ejemplo #D4A843.');
   if('tagline' in item&&(typeof item.tagline!=='string'||item.tagline.length>80||/[\u0000-\u001f\u007f]/.test(item.tagline)))invalid('El lema admite hasta 80 caracteres.');
   if(('logo_path' in item&&!imagePath(item.logo_path,id,'png'))||('cover_path' in item&&!imagePath(item.cover_path,id,'(?:jpg|webp)')))invalid('Sube la imagen de nuevo.');
   return{...item,id,...('primary_color' in item?{primary_color:item.primary_color.toUpperCase()}:{}),...('secondary_color' in item?{secondary_color:item.secondary_color.toUpperCase()}:{})};
  });
 }
 if('tax' in c){
  const t=c.tax,message='El IVA debe estar entre 0 % y 30 %.';
  if(!only(t,['spain_rate_bps','oss_active','eu_rates'])||!Object.keys(t).length)invalid(message);
  if('spain_rate_bps' in t&&!rate(t.spain_rate_bps))invalid(message);
  if('oss_active' in t&&typeof t.oss_active!=='boolean')invalid();
  if('eu_rates' in t&&(!Array.isArray(t.eu_rates)||!t.eu_rates.length||t.eu_rates.length>EU_COUNTRIES.length
   ||t.eu_rates.some(r=>!only(r,['country','rate_bps'])||!EU_COUNTRIES.includes(r.country)||!rate(r.rate_bps))))invalid(message);
  changes.tax={...t,...('eu_rates' in t?{eu_rates:t.eu_rates.map(r=>({country:r.country,rate_bps:r.rate_bps}))}:{})};
 }
 if('pricing' in c)changes.pricing=paymentPricingPayload(c.pricing,invalid);
 return{action:'configure',expected_version:value.expected_version,request_id:value.request_id.toLowerCase(),reason:value.reason.trim(),changes};
}

const PROGRAMS=['team_pass','semi_team_pass','circuit_pass'];
// CTP firma las vistas previas con su dirección interna: se sirven desde la URL pública de CTP.
const signed=value=>{
 if(typeof value!=='string')return null;
 try{
  const url=new URL(value);
  if(!/^\/storage\/v1\/object\/sign\/club-(branding|covers)\//.test(url.pathname)||!url.searchParams.get('token'))return null;
  return new URL(url.pathname+url.search,process.env.CTP_AUTH_URL||'https://playctp.com').href;
 }catch{return null;}
};
function branding(value){
 const b=object(value)?value:{};
 return{primary_color:color(b.primary_color)?b.primary_color.toUpperCase():'#D4A843',secondary_color:color(b.secondary_color)?b.secondary_color.toUpperCase():'#F5F1E8',
  tagline:typeof b.tagline==='string'?b.tagline:'',logo_path:typeof b.logo_path==='string'?b.logo_path:null,cover_path:typeof b.cover_path==='string'?b.cover_path:null,
  logo_url:signed(b.logo_url),cover_url:signed(b.cover_url)};
}
export function webPublicationSearchResponse(value){
 if(!object(value)||!Array.isArray(value.items))throw new HttpError(502,'No se ha podido buscar en CTP.');
 return{items:value.items.filter(i=>object(i)&&uuid(i.id)).slice(0,20).map(i=>({id:i.id,name:String(i.name??''),tag:String(i.tag??''),program:PROGRAMS.includes(i.program)?i.program:null}))};
}
export function webPublicationUploadResponse(value){
 if(!object(value)||!['logo','cover'].includes(value.kind)||typeof value.path!=='string')throw new HttpError(502,'No se ha podido subir la imagen.');
 return{kind:value.kind,path:value.path,url:signed(value.url)};
}

export function webPublicationResponse(value,payload){
 const fail=()=>{throw new HttpError(502,'No se ha podido verificar el estado de la web. Actualiza la consulta.');};
 if(!object(value)||value.schema_version!==1||!Number.isSafeInteger(value.revision)||value.revision<1
  ||!only(value.sections,['calendar','market'])||!Array.isArray(value.tournaments)||!Array.isArray(value.clubs)||!object(value.tax)||!Array.isArray(value.tax.eu_rates))fail();
 if(payload?.action==='configure'&&(!uuid(value.request_id)||value.request_id.toLowerCase()!==payload.request_id))fail();
 return{schema_version:1,revision:value.revision,server_time:value.server_time,updated_at:value.updated_at,
  sections:{calendar:value.sections.calendar===true,market:value.sections.market===true},
  pricing:paymentPricingResponse(value.pricing,fail),
  tournaments:value.tournaments.filter(t=>object(t)&&uuid(t.id)).map(t=>({id:t.id,name:String(t.name??''),kind:t.kind,circuit_code:t.circuit_code??null,
   season:t.season??null,status:t.status,start_at:t.start_at,registration_open_at:t.registration_open_at??null,registration_close_at:t.registration_close_at??null,
   visible:t.visible===true,registration_open:t.registration_open===true,entrants:Number(t.entrants)||0,date_visible:t.date_visible!==false,
   host:object(t.host)&&uuid(t.host.id)?{id:t.host.id,name:String(t.host.name??''),announced:t.host.announced===true}:null})),
  clubs:value.clubs.filter(c=>object(c)&&uuid(c.id)&&PROGRAMS.includes(c.program)).map(c=>({id:c.id,name:String(c.name??''),tag:String(c.tag??''),
   program:c.program,announced:c.announced===true,announced_at:c.announced_at??null,circuit_pass:c.circuit_pass===true,
   circuit_pass_manual:c.circuit_pass_manual===true,members:Number(c.members)||0,branding:branding(c.branding),
   hosting:Array.isArray(c.hosting)?c.hosting.filter(object).map(h=>({id:h.id,name:String(h.name??'')})):[]})),
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
  if(['configure','upload'].includes(payload.action)&&!writesEnabled())throw new HttpError(403,'Los cambios oficiales están desactivados.');
  if(payload.action==='upload'&&payload.kind==='logo'){
   try{await requireTransparentLogoPng(new Uint8Array(Buffer.from(payload.base64,'base64')));}
   catch{throw new HttpError(400,'El escudo debe ser un PNG válido con fondo transparente hasta el borde.');}
  }
  const actor_id=await actorFor(user);
  if(typeof actor_id!=='string'||!/^[A-Za-z0-9._:@-]{1,100}$/.test(actor_id))throw new HttpError(403,'No se ha podido verificar la identidad de administración.');
  let result;
  try{result=await request({action:'admin_service',actor_id,service:'web_publication',payload});}
  catch(error){
   if(error?.status===409)throw new HttpError(409,'La web ha cambiado mientras preparabas el cambio. Actualiza y vuelve a aplicarlo.');
   if([401,403].includes(error?.status))throw new HttpError(403,'CTP no permite este cambio con esta cuenta.');
   if([400,422].includes(error?.status))throw new HttpError(422,'CTP ha rechazado el cambio. Un torneo empezado o terminado no se puede ocultar, solo un club del Team Pass se anuncia o es anfitrión, un Circuit Pass pagado no se retira aquí y solo los clubes con página (Team Pass y Semi-Team Pass) cambian su imagen.');
   throw new HttpError(502,'No se ha podido confirmar el cambio. Reintenta la misma solicitud para evitar duplicados.');
  }
  if(payload.action==='search')return webPublicationSearchResponse(result);
  if(payload.action==='upload')return webPublicationUploadResponse(result);
  return webPublicationResponse(result,payload);
 };
}
