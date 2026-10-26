import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { userProfileEditPath } from '../client/src/navigation.js';
import { profileChanges } from '../client/src/pages/userProfileModel.js';

// The entire bridge is a fixture: no real CTP account or remote service is used.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-profile-route-'));
const origin = 'https://pre.manager.playctp.com';
const admin = '10000000-0000-4000-8000-000000000011';
const referee = '10000000-0000-4000-8000-000000000012';
const author = '10000000-0000-4000-8000-000000000013';
const lastMessageAuthor = '10000000-0000-4000-8000-000000000014';
Object.assign(process.env, { DATA_DIR:temp, DB_PATH:path.join(temp,'profile.db'), PUBLIC_ORIGIN:origin,
  CTP_AUTH_MODE:'ctp', CTP_AUTH_URL:'https://pre.playctp.com', CTP_WEB_ORIGIN:'https://pre.playctp.com',
  CTP_AUTH_TOKEN_KEY:crypto.randomBytes(32).toString('base64url'),
  CTP_AUTH_ANON_KEY:`e30.${Buffer.from('{"role":"anon","exp":4102444800}').toString('base64url')}.fixture`,
  CTP_OPERATIONS_URL:'https://pre.playctp.com/functions/v1/manager-operations',
  CTP_OPERATIONS_TOKEN:'profile-route-fixture-transport-0123456789',
  CTP_SIGNING_SECRET:'profile-route-independent-signature-0123456789', CTP_ENABLE_WRITES:'true', CTP_SYNC_SECONDS:'0' });
const originalFetch = globalThis.fetch, sessions = new Map(), observed = [];
let account = { id:author, username:'Jugador',email:'fixture@example.invalid',email_confirmed:true,
  gamertag:'José Pérez',activision_id:'Nombre#123',platform:'PC',discord:null,twitter:null,bio:null,birthdate:null,
  role:'player',avatar:'',created_at:'2026-10-01T00:00:00Z',manager_version:3 };
globalThis.fetch = async (url,init) => {
  const body = JSON.parse(init.body);
  if (url.includes('grant_type=password')) {
    const id = body.email.startsWith('admin') ? admin : referee, token = crypto.randomUUID(); sessions.set(token,id);
    return Response.json({user:{id},access_token:token,refresh_token:`fixture:${id}`,expires_in:3600});
  }
  if (url.endsWith('/manager-operations')) {
    observed.push(body);
    assert.equal(body.action,'admin_service'); assert.equal(body.service,'users');
    assert.equal(body.actor_id,`ctp:${admin}`); assert.equal(body.payload.user_id,author);
    if (body.payload.action==='get') return Response.json({ok:true,data:account});
    assert.equal(body.payload.action,'update');
    if (body.payload.expected_version!==account.manager_version) return Response.json({profile_error:'user_profile_conflict'},{status:409});
    account={...account,...body.payload.changes,manager_version:account.manager_version+1};
    return Response.json({ok:true,data:{...account,changed:Object.keys(body.payload.changes)}});
  }
  const id = sessions.get(init.headers.Authorization?.replace('Bearer ',''));
  if (!id) return Response.json({},{status:403});
  return Response.json({ctp_user_id:id,username:'Fixture',role:id===admin?'admin':'referee',actor_id:`ctp:${id}`,scopes:['ranked.read','ranked.chat']});
};
const auth = await import('../server/auth.js');
const { db } = await import('../server/db.js');
const { requestBoundary } = await import('../server/config.js');
const { administrationRouter } = await import('../server/routes/administration.js');
const app = express();
app.use((req,res,next)=>{const error=requestBoundary(req);return error?res.status(403).json({error}):next();});
app.use(express.json()); app.use('/api',administrationRouter);
app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.status?error.message:'Error interno.'}));
const server = http.createServer(app); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
after(async()=>{await new Promise(resolve=>server.close(resolve));globalThis.fetch=originalFetch;db.close();fs.rmSync(temp,{recursive:true,force:true,maxRetries:5});});
async function signIn(email) {
  let cookie; await auth.loginCtp(email,'fixture-password',{cookie(name,value){cookie=`${name}=${value}`;}}); return cookie;
}
function api(method,route,body,cookie='') {
  return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:`/api${route}`,method,
    headers:{Host:'pre.manager.playctp.com',Origin:origin,'Sec-Fetch-Site':'same-origin',Cookie:cookie,'Content-Type':'application/json'}},res=>{
    let text='';res.on('data',part=>text+=part);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(text)}));});
    req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));});
}
test('opening a ticket-author shortcut reads only, then a chosen ID correction uses the current version',async()=>{
  const cookie=await signIn('admin@example.invalid');
  const ticket={author:{id:author},messages:[{author_id:lastMessageAuthor,body:'Edit another account'}]};
  const link=new URL(userProfileEditPath(ticket.author.id,'/operaciones/incidencias?case=fixture'),'https://manager.example');
  const route=`/administration/users/${link.searchParams.get('edit')}`;
  let read=await api('GET',route,undefined,cookie);assert.equal(read.status,200);
  assert.deepEqual(observed.map(call=>call.payload.action),['get']);
  assert.equal(read.data.id,author);
  for (const activision_id of ['José Pérez','José Pérez#12345']) {
    const body={expected_version:read.data.manager_version,changes:profileChanges(read.data,{...read.data,activision_id})};
    const reply=await api('PATCH',route,body,cookie);assert.equal(reply.status,200);assert.equal(reply.data.activision_id,activision_id);
    assert.deepEqual(observed.at(-1).payload,{action:'update',user_id:author,expected_version:read.data.manager_version,changes:{activision_id}});
    read=reply;
  }
  assert.equal(observed.some(call=>call.service!=='users'),false);
  assert.equal(observed.some(call=>call.payload.action==='message'),false);
});
test('a stale edit conflicts and non-admins cannot read or change a ticket author',async()=>{
  const adminCookie=await signIn('admin@example.invalid'),refCookie=await signIn('referee@example.invalid');
  const route=`/administration/users/${author}`, before=account.activision_id;
  const stale=await api('PATCH',route,{expected_version:1,changes:{activision_id:'Changed'}},adminCookie);
  assert.equal(stale.status,409);assert.match(stale.data.error,/ha cambiado/);assert.equal(account.activision_id,before);
  const count=observed.length;
  assert.equal((await api('GET',route,undefined,refCookie)).status,403);
  assert.equal((await api('PATCH',route,{expected_version:account.manager_version,changes:{activision_id:'Changed'}},refCookie)).status,403);
  assert.equal((await api('GET',route)).status,401);
  assert.equal(observed.length,count);
});
