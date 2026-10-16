import { HttpError } from './auth.js';

export const ADMIN_RESOURCES = Object.freeze(['summary','users','user','teams','team','entitlements','access','maps','modes','campaigns','features','audit','ranked_queues','ranked_lobbies']);
export const ADMIN_ACTIONS = Object.freeze(['admin.user.role','admin.entitlement.grant','admin.entitlement.revoke','admin.mode.create','admin.mode.update','admin.mode.delete','admin.map.create','admin.map.update','admin.map.delete','admin.campaign.create','admin.campaign.queue','admin.campaign.cancel','admin.feature.set','admin.ranked.queue.open','admin.ranked.queue.pause','admin.ranked.queue.sync','admin.ranked.lobby.resolve','admin.ranked.lobby.cancel']);
export const ADMIN_CREATE_ACTIONS = Object.freeze(['admin.entitlement.grant','admin.mode.create','admin.map.create','admin.campaign.create']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = message => { throw new HttpError(400,message); };
const text = (value,name,max,min=1) => { if(typeof value!=='string'||value.trim().length<min||value.length>max)fail(`${name} no válido.`);return value.trim(); };
const uuid = (value,name) => { if(typeof value!=='string'||!UUID.test(value))fail(`${name} no válido.`);return value; };
const number = (value,min,max,name) => { if(!Number.isSafeInteger(value)||value<min||value>max)fail(`${name} no válido.`);return value; };
const keys = (value,allowed) => {if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))fail('La solicitud contiene campos no admitidos.');};
const boolean = (value,name) => {if(typeof value!=='boolean')fail(`${name} no válido.`);return value;};
const token = (value,name) => text(value,name,100);

/** Browser parameters become a bounded, explicit query; no arbitrary table/RPC proxy. */
export function administrationQuery(query={}) {
  keys(query,['resource','target_id','query','page','limit','game_id','team_id','status']);
  const resource=query.resource||'summary';
  if(!ADMIN_RESOURCES.includes(resource))fail('Consulta administrativa no admitida.');
  const target_id=query.target_id?uuid(query.target_id,'Identificador'):null;
  if(['user','team'].includes(resource)&&!target_id)fail('Selecciona un registro.');
  const filters={page:0,limit:20};
  for(const key of ['page','limit'])if(query[key]!==undefined){
    if(typeof query[key]!=='number'&&(typeof query[key]!=='string'||!/^\d+$/.test(query[key])))fail('Paginación no válida.');
    filters[key]=number(Number(query[key]),key==='page'?0:1,key==='page'?100000:100,'Paginación');
  }
  for(const key of ['query','game_id','status'])if(query[key]!==undefined&&query[key]!=='')filters[key]=text(query[key],key,key==='query'?120:key==='status'?60:100);
  if(filters.game_id&&!/^[A-Za-z0-9_-]+$/.test(filters.game_id))fail('Juego no válido.');
  if(query.team_id)filters.team_id=uuid(query.team_id,'Club');
  return {action:'admin_query',resource,target_id,filters};
}

/** Keep operational secrets, roles of administrator and unrecognised fields off the wire. */
export function administrationPayload(type,input={}) {
  if(!ADMIN_ACTIONS.includes(type))fail('Acción administrativa no admitida.');
  const fields={
    'admin.user.role':['role'],
    'admin.entitlement.grant':['team_id','kind','season_label','season','tournament_id','payment_ref','amount_cents'],
    'admin.entitlement.revoke':[],
    'admin.mode.create':['game_id','name','active','sort_order'],
    'admin.mode.update':['name','active','sort_order','move'], 'admin.mode.delete':[],
    'admin.map.create':['game_id','mode','name','image_url','active','sort_order'],
    'admin.map.update':['name','image_url','active','sort_order'], 'admin.map.delete':[],
    'admin.campaign.create':['content','link'], 'admin.campaign.queue':['confirm_id'],'admin.campaign.cancel':[],
    'admin.feature.set':['key','enabled'],
    'admin.ranked.queue.open':[],'admin.ranked.queue.pause':[],'admin.ranked.queue.sync':[],
    'admin.ranked.lobby.resolve':['side'],'admin.ranked.lobby.cancel':[],
  }[type];
  keys(input,[...fields,'reason']);
  const out={};
  if(input.reason!==undefined)out.reason=text(input.reason,'Motivo',500,12);
  if(type==='admin.entitlement.revoke'||type.startsWith('admin.ranked.'))if(!out.reason)fail('Explica el motivo con al menos 12 caracteres.');
  if(type==='admin.user.role'){
    if(!['player','referee'].includes(input.role))fail('Solo se puede conceder o retirar el rol de árbitro.');
    out.role=input.role;
  } else if(type==='admin.entitlement.grant'){
    out.team_id=uuid(input.team_id,'Club');
    if(!['team_pass','season_pass','tournament_ticket'].includes(input.kind))fail('Tipo de acceso no válido.');
    out.kind=input.kind;
    if(input.season_label!==undefined)out.season_label=text(input.season_label,'Temporada del circuito',100);
    if(input.season!==undefined)out.season=number(input.season,1,4,'Season');
    if(input.tournament_id!==undefined)out.tournament_id=uuid(input.tournament_id,'Torneo');
    if(input.kind==='season_pass'&&!out.season)fail('El pase de season necesita una season.');
    if(input.kind==='tournament_ticket'&&!out.tournament_id)fail('La entrada necesita un torneo.');
    if(input.kind==='team_pass'&&(out.season!==undefined||out.tournament_id!==undefined)||input.kind==='season_pass'&&out.tournament_id!==undefined||input.kind==='tournament_ticket'&&out.season!==undefined)fail('El alcance no coincide con el tipo de acceso.');
    if(input.payment_ref!==undefined)out.payment_ref=text(input.payment_ref,'Referencia',200);
    if(input.amount_cents!==undefined)out.amount_cents=number(input.amount_cents,0,100000000,'Importe en céntimos');
  } else if(type.startsWith('admin.mode.')||type.startsWith('admin.map.')){
    if(type.endsWith('.create')){out.game_id=token(input.game_id,'Juego');if(!/^[A-Za-z0-9_-]+$/.test(out.game_id))fail('Juego no válido.');out.name=text(input.name,'Nombre',120);if(type==='admin.map.create')out.mode=text(input.mode,'Modo',120);}
    else if(input.name!==undefined)out.name=text(input.name,'Nombre',120);
    if(input.active!==undefined)out.active=boolean(input.active,'Activo');
    if(input.sort_order!==undefined)out.sort_order=number(input.sort_order,0,10000,'Orden');
    if(input.move!==undefined){if(![-1,1].includes(input.move))fail('Movimiento no válido.');out.move=input.move;}
    if(input.image_url!==undefined){
      if(input.image_url==='')out.image_url='';
      else {let url;try{url=new URL(input.image_url);}catch{fail('Imagen no válida.');}if(url.protocol!=='https:'||url.username||url.password||input.image_url.length>2000)fail('La imagen necesita una URL HTTPS pública.');out.image_url=url.href;}
    }
    if(type.endsWith('.update')&&!Object.keys(out).some(key=>key!=='reason'))fail('No hay cambios que guardar.');
    if(out.move!==undefined&&Object.keys(out).some(key=>!['move','reason'].includes(key)))fail('El movimiento no admite otros cambios simultáneos.');
  } else if(type==='admin.campaign.create'){
    keys(input.content,['es','en','it','fr','pt','de']);
    out.content={};
    for(const locale of ['es','en','it','fr','pt','de']){keys(input.content[locale],['title','body']);out.content[locale]={title:text(input.content[locale].title,'Asunto',150),body:text(input.content[locale].body,'Mensaje',3000)};}
    out.link=text(input.link,'Destino',512);
    if(!/^\/[A-Za-z0-9_/-]*$/.test(out.link)||out.link.startsWith('//'))fail('Usa una ruta interna de CTP para el destino.');
  } else if(type==='admin.campaign.queue')out.confirm_id=uuid(input.confirm_id,'Confirmación');
  else if(type==='admin.feature.set'){
    if(input.key!=='ranked')fail('Función no admitida.');out.key='ranked';out.enabled=boolean(input.enabled,'Visibilidad');
  } else if(type==='admin.ranked.lobby.resolve'){
    if(!['a','b'].includes(input.side))fail('Selecciona el equipo ganador.');out.side=input.side;
  }
  if(Buffer.byteLength(JSON.stringify(out),'utf8')>98304)fail('La propuesta supera el tamaño permitido.');
  return out;
}
