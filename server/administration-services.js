import crypto from 'node:crypto';
import { db } from './db.js';
import { HttpError, readSessionToken } from './auth.js';
import { getAdministrationService } from './integration.js';

const callback='https://manager.playctp.com/administracion/integraciones?twitch_admin=1';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
export function createOwnerStateStore(database,now=Date.now) {
  database.exec('CREATE TABLE IF NOT EXISTS administration_oauth_states(state_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL,session_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0)');
  return {
    begin(state,user,session){
      if(!/^[a-f0-9]{64}$/.test(state)||!session)throw new HttpError(400,'No se pudo iniciar la autorización.');
      database.prepare('DELETE FROM administration_oauth_states WHERE expires_at<=? OR (user_id=? AND session_hash=?)').run(now(),user,hash(session));
      database.prepare('INSERT INTO administration_oauth_states(state_hash,user_id,session_hash,expires_at) VALUES(?,?,?,?)').run(hash(state),user,hash(session),now()+600000);
    },
    consume(state,user,session){
      if(typeof state!=='string'||!/^[a-f0-9]{64}$/.test(state)||!session)throw new HttpError(400,'La autorización no pertenece a esta sesión. Vuelve a conectar Twitch.');
      const row=database.prepare('UPDATE administration_oauth_states SET used=1 WHERE state_hash=? AND user_id=? AND session_hash=? AND expires_at>? AND used=0 RETURNING state_hash').get(hash(state),user,hash(session),now());
      if(!row)throw new HttpError(400,'La autorización ha caducado o ya se ha usado. Vuelve a conectar Twitch.');
    },
  };
}
const states=createOwnerStateStore(db);
export function safeOwnerUrl(value) {
  try {
    const url=new URL(value);
    if(url.origin!=='https://id.twitch.tv'||url.pathname!=='/oauth2/authorize'||url.username||url.password||url.hash
      ||url.searchParams.get('redirect_uri')!==callback||url.searchParams.get('response_type')!=='code'
      ||url.searchParams.get('scope')!=='channel:read:subscriptions'||!/^[a-f0-9]{64}$/.test(url.searchParams.get('state')||'')
      ||[...url.searchParams.keys()].some(key=>url.searchParams.getAll(key).length!==1))return null;
    return url;
  } catch {return null;}
}
export async function integrationServicesStatus(user) {
  const services=await Promise.allSettled([getAdministrationService(user,'twitch',{action:'status'}),getAdministrationService(user,'push',{action:'status'})]);
  return {callback,twitch:services[0].status==='fulfilled'?services[0].value:{available:false,error:'No se puede consultar Twitch.'},push:services[1].status==='fulfilled'?services[1].value:{available:false,error:'No se puede consultar push.'}};
}
export async function ownerAction(req) {
  const input=req.body||{},action=input.action;
  if(Object.keys(input).some(key=>!['action','state','code'].includes(key))||!['status','start','complete','cancel','unlink'].includes(action))throw new HttpError(400,'Acción de Twitch no admitida.');
  const payload={action};
  if(['complete','cancel'].includes(action)){
    if(action==='complete'&&(typeof input.code!=='string'||!input.code||input.code.length>2048))throw new HttpError(400,'Respuesta de Twitch no válida.');
    states.consume(input.state,req.user.id,readSessionToken(req));payload.state=input.state;
    if(action==='complete')payload.code=input.code;
  }else if(input.state!==undefined||input.code!==undefined)throw new HttpError(400,'La solicitud contiene campos no admitidos.');
  const result=await getAdministrationService(req.user,'twitch',payload);
  if(action==='start'){
    const url=safeOwnerUrl(result.url);if(!url)throw new HttpError(502,'La dirección de autorización de Twitch no es válida.');
    states.begin(url.searchParams.get('state'),req.user.id,readSessionToken(req));
    return {url:url.href};
  }
  return result;
}
export async function uploadAdministrationImage(user,input) {
  if(!input||Object.keys(input).some(key=>!['bucket','content_type','base64','request_id'].includes(key))
    ||!['game-maps','tournament-images','email-images'].includes(input.bucket)||!['image/png','image/jpeg','image/webp'].includes(input.content_type)
    ||typeof input.base64!=='string'||input.base64.length<16||input.base64.length>2796204||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64)
    ||typeof input.request_id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.request_id))throw new HttpError(400,'Selecciona una imagen PNG, JPG o WebP de hasta 2 MB.');
  const result=await getAdministrationService(user,'image',input);
  let url;try{url=new URL(result.url);}catch{throw new HttpError(502,'No se ha confirmado la imagen.');}
  if(!['https://pre.playctp.com','https://playctp.com'].includes(url.origin)||!url.pathname.startsWith(`/storage/v1/object/public/${input.bucket}/manager/`)||url.username||url.password||url.search||url.hash)throw new HttpError(502,'La imagen no pertenece al almacenamiento de CTP.');
  return {url:url.href,bucket:input.bucket};
}
