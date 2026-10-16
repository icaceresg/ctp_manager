import { HttpError } from './auth.js';
export const CASE_ACTIONS=Object.freeze(['incident.status','match.reply']);
export const CASE_RESOURCE_TYPES=Object.freeze({'incident.status':'case_incident','match.reply':'case_match'});
export const OFFICIAL_CASE_STATUSES=Object.freeze(['abierto','en_revision','esperando_respuesta','resuelto','rechazado','cerrado']);
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const fail=message=>{throw new HttpError(400,message);};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
export function casePayload(type,input={}){
 if(!CASE_ACTIONS.includes(type)||!object(input))fail('Acción de expediente no válida.');
 const keys=type==='incident.status'?['status','reason']:['kind','text'];
 if(Object.keys(input).some(key=>!keys.includes(key)))fail('El formulario contiene campos no admitidos.');
 if(type==='incident.status'){
  if(!OFFICIAL_CASE_STATUSES.includes(input.status)||typeof input.reason!=='string'||input.reason.trim().length<12||input.reason.length>2000)fail('Selecciona el estado y explica el motivo entre 12 y 2000 caracteres.');
  return{status:input.status,reason:input.reason.trim()};
 }
 if(!['tournament','challenge'].includes(input.kind)||typeof input.text!=='string'||!input.text.trim()||input.text.length>(input.kind==='challenge'?300:5000))fail('El mensaje no es válido para esta conversación.');
 return{kind:input.kind,text:input.text.trim()};
}
export function caseQueryParameters(query={}){
 if(!object(query)||Object.keys(query).some(key=>!['resource','target_id','kind','cursor'].includes(key))||!['incident','match_context'].includes(query.resource)||!uuid(query.target_id))fail('Consulta de expediente no válida.');
 const filters={};
 if(query.kind!==undefined){if(!['tournament','challenge'].includes(query.kind))fail('Tipo de partido no válido.');filters.kind=query.kind;}
 if(query.resource==='match_context'&&!filters.kind)fail('Selecciona el tipo de partido.');
 if(query.cursor!==undefined){if(typeof query.cursor!=='string'||query.cursor.length>160||!/^\d{4}-\d{2}-\d{2}T[^|]{8,40}\|(?:[0-9a-f-]{36}|[0-9]{1,19})$/i.test(query.cursor)||!Number.isFinite(Date.parse(query.cursor.split('|')[0]))||query.resource==='match_context'&&!uuid(query.cursor.split('|')[1]))fail('Cursor de conversación no válido.');filters.cursor=query.cursor;}
 return{resource:query.resource,target_id:query.target_id,filters};
}
