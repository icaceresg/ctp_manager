import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// The entire bridge is a fixture: no real CTP club or remote service is used.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-club-route-'));
const origin = 'https://pre.manager.playctp.com';
const admin = '10000000-0000-4000-8000-000000000021';
const referee = '10000000-0000-4000-8000-000000000022';
const clubId = '20000000-0000-4000-8000-000000000001';
Object.assign(process.env, { DATA_DIR:temp, DB_PATH:path.join(temp,'club.db'), PUBLIC_ORIGIN:origin,
  CTP_AUTH_MODE:'ctp', CTP_AUTH_URL:'https://pre.playctp.com', CTP_WEB_ORIGIN:'https://pre.playctp.com',
  CTP_AUTH_TOKEN_KEY:crypto.randomBytes(32).toString('base64url'),
  CTP_AUTH_ANON_KEY:`e30.${Buffer.from('{"role":"anon","exp":4102444800}').toString('base64url')}.fixture`,
  CTP_OPERATIONS_URL:'https://pre.playctp.com/functions/v1/manager-operations',
  CTP_OPERATIONS_TOKEN:'club-route-fixture-transport-0123456789',
  CTP_SIGNING_SECRET:'club-route-independent-signature-0123456789', CTP_ENABLE_WRITES:'true', CTP_SYNC_SECONDS:'0' });
const originalFetch = globalThis.fetch, sessions = new Map(), observed = [];
let club = { id:clubId, name:'Alpha', tag:'ALP', logo:'/logo-ctp.svg', points:0, created_at:'2026-10-01T00:00:00Z', manager_version:3, member_count:2,
  members:[{ user_id:admin, username:'Manager', role:'lider' }, { user_id:referee, username:'Jugador', role:'jugador' }] };
globalThis.fetch = async (url,init) => {
  const body = JSON.parse(init.body);
  if (url.includes('grant_type=password')) {
    const id = body.email.startsWith('admin') ? admin : referee, token = crypto.randomUUID(); sessions.set(token,id);
    return Response.json({user:{id},access_token:token,refresh_token:`fixture:${id}`,expires_in:3600});
  }
  if (url.endsWith('/manager-operations')) {
    observed.push(body);
    assert.equal(body.actor_id,`ctp:${admin}`);
    if (body.action==='admin_query') return Response.json({ok:true,data:{resource:'team',items:[club],total:1,has_more:false,page:0,limit:20}});
    assert.equal(body.action,'admin_service'); assert.equal(body.service,'clubs'); assert.equal(body.payload.team_id,clubId);
    // CTP raises these as 22023, so the bridge answers 422 with the machine code.
    if (body.payload.expected_version!==club.manager_version) return Response.json({ok:false,code:'invalid_request',profile_error:'club_profile_conflict'},{status:422});
    if (body.payload.changes.name==='Beta') return Response.json({ok:false,code:'invalid_request',profile_error:'club_profile_name_taken'},{status:422});
    club={...club,...body.payload.changes,manager_version:club.manager_version+1};
    return Response.json({ok:true,data:{id:club.id,name:club.name,tag:club.tag,logo:club.logo,created_at:club.created_at,manager_version:club.manager_version,changed:Object.keys(body.payload.changes)}});
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
const route=`/administration/clubs/${clubId}`;

test('an administrator reads a club with its manager and saves name and tag with the read version',async()=>{
  const cookie=await signIn('admin@example.invalid');
  const read=await api('GET',`/administration?resource=team&target_id=${clubId}`,undefined,cookie);
  assert.equal(read.status,200);
  const current=read.data.items[0];
  assert.equal(current.manager_version,3); assert.deepEqual(current.members.filter(m=>m.role==='lider').map(m=>m.username),['Manager']);
  const saved=await api('PATCH',route,{expected_version:current.manager_version,changes:{name:'  Alpha Prime ',tag:'ap1'}},cookie);
  assert.equal(saved.status,200);
  assert.deepEqual(saved.data,{id:clubId,name:'Alpha Prime',tag:'AP1',manager_version:4,changed:['name','tag']});
  assert.deepEqual(observed.at(-1).payload,{action:'update',team_id:clubId,expected_version:3,changes:{name:'Alpha Prime',tag:'AP1'}});
});

test('stale versions, taken names, bad input and non-admins never change the club',async()=>{
  const adminCookie=await signIn('admin@example.invalid'),refCookie=await signIn('referee@example.invalid');
  const before={...club};
  const stale=await api('PATCH',route,{expected_version:1,changes:{name:'Otro'}},adminCookie);
  assert.equal(stale.status,409); assert.match(stale.data.error,/ha cambiado/);
  const taken=await api('PATCH',route,{expected_version:club.manager_version,changes:{name:'Beta'}},adminCookie);
  assert.equal(taken.status,422); assert.match(taken.data.error,/otro club con ese nombre/);
  const count=observed.length;
  for (const body of [{expected_version:club.manager_version,changes:{name:'ab'}},{expected_version:club.manager_version,changes:{tag:'a b'}},
    {expected_version:club.manager_version,changes:{logo:'x'}},{expected_version:club.manager_version,changes:{}},{changes:{name:'Valid name'}},
    {expected_version:club.manager_version,changes:{name:'Valid name'},leader_id:referee}]) {
    assert.equal((await api('PATCH',route,body,adminCookie)).status,400,JSON.stringify(body));
  }
  assert.equal((await api('PATCH','/administration/clubs/not-a-club',{expected_version:1,changes:{name:'Valid name'}},adminCookie)).status,400);
  assert.equal((await api('PATCH',route,{expected_version:club.manager_version,changes:{name:'Hack'}},refCookie)).status,403);
  assert.equal((await api('PATCH',route,{expected_version:club.manager_version,changes:{name:'Hack'}})).status,401);
  assert.equal(observed.length,count);
  assert.deepEqual({name:club.name,tag:club.tag,manager_version:club.manager_version},{name:before.name,tag:before.tag,manager_version:before.manager_version});
});
