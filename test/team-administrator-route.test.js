import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-retired-team-administrator-route-'));
const origin='https://pre.manager.playctp.com',admin='10000000-0000-4000-8000-000000000001',referee='10000000-0000-4000-8000-000000000002',person='20000000-0000-4000-8000-000000000001',team='30000000-0000-4000-8000-000000000001';
Object.assign(process.env,{DATA_DIR:temporary,DB_PATH:path.join(temporary,'qa.db'),PUBLIC_ORIGIN:origin,
 CTP_AUTH_MODE:'ctp',CTP_AUTH_URL:'https://pre.playctp.com',CTP_WEB_ORIGIN:'https://pre.playctp.com',CTP_AUTH_TOKEN_KEY:crypto.randomBytes(32).toString('base64url'),CTP_AUTH_ANON_KEY:`e30.${Buffer.from('{"role":"anon","exp":4102444800}').toString('base64url')}.fixture`,
 CTP_OPERATIONS_URL:'https://pre.playctp.com/functions/v1/manager-operations',CTP_OPERATIONS_TOKEN:'retired-team-admin-fixture-0123456789',CTP_SIGNING_SECRET:'retired-team-admin-signature-0123456789',CTP_ENABLE_WRITES:'true',CTP_SYNC_SECONDS:'0'});
const originalFetch=globalThis.fetch,sessions=new Map(),requests=[];
globalThis.fetch=async(url,init)=>{
 const body=JSON.parse(init.body);
 if(url.includes('grant_type=password')){const id=body.email.startsWith('admin')?admin:referee,token=crypto.randomUUID();sessions.set(token,id);return Response.json({user:{id},access_token:token,refresh_token:`fixture:${id}`,expires_in:3600});}
 if(url.endsWith('/manager-operations')){requests.push(body);throw new Error('Retired route must not reach CTP');}
 const id=sessions.get(init.headers.Authorization?.replace('Bearer ',''));
 if(!id)return Response.json({},{status:403});
 return Response.json({ctp_user_id:id,username:'Fixture',role:id===admin?'admin':'referee',actor_id:`ctp:${id}`,scopes:['ranked.read','ranked.chat']});
};
const auth=await import('../server/auth.js');
const {db}=await import('../server/db.js');
const {requestBoundary}=await import('../server/config.js');
const integration=await import('../server/integration.js');
const {setIntegrationStatus,prepareManualClubCommand}=await import('../server/operations.js');
const {administrationRouter}=await import('../server/routes/administration.js');
const app=express();
app.use((req,res,next)=>{const error=requestBoundary(req);return error?res.status(403).json({error}):next();});
app.use(express.json());app.use('/api',administrationRouter);
app.use((req,res)=>res.status(404).json({error:'Not found'}));
app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.status?error.message:'Internal error'}));
const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
after(async()=>{await new Promise(resolve=>server.close(resolve));globalThis.fetch=originalFetch;db.close();assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5});});
async function signIn(name){let cookie;const user=await auth.loginCtp(`${name}@example.invalid`,'fixture-password',{cookie(key,value){cookie=`${key}=${value}`;}});return {cookie,user};}
function api(method,route,body,cookie=''){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:`/api${route}`,method,headers:{Host:'pre.manager.playctp.com',Origin:origin,'Sec-Fetch-Site':'same-origin',Cookie:cookie,'Content-Type':'application/json'}},res=>{let text='';res.on('data',part=>text+=part);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(text)}));});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));});}

test('retired multi-team routes deny even staff without making a bridge request',async()=>{
 const {cookie}=await signIn('admin'),ref=await signIn('referee');
 const cases=[['GET',`/administration/clubs/${team}/managers`],['POST',`/administration/clubs/${team}/managers`,{user_id:person,enabled:true}],['POST',`/administration/clubs/${team}/managers/convert`,{user_id:person}],['GET','/administration/team-administrators/candidates?query=Coordinator'],['GET',`/administration/team-administrators/${person}`]];
 for(const [method,url,body]of cases){assert.equal((await api(method,url,body,cookie)).status,404);assert.equal((await api(method,url,body,ref.cookie)).status,403);assert.equal((await api(method,url,body)).status,401);}
 assert.equal(integration.teamAdministratorService,undefined);assert.equal(requests.length,0);
});

test('a historical administrative proposal remains recorded and cannot be replayed to CTP',async()=>{
 await signIn('admin');setIntegrationStatus({supported_actions:['club.create']});
 const actor=auth.describeUser(db.prepare('SELECT * FROM users WHERE ctp_user_id=?').get(admin));
 const command=prepareManualClubCommand(actor,{type:'club.create',payload:{name:'QA Retired',tag:'QAR',leader_id:person,reason:'Propuesta anterior de gestion multiple'}}).command;
 db.prepare('UPDATE operation_commands SET payload=? WHERE id=?').run(JSON.stringify({name:'QA Retired',tag:'QAR',leader_id:null,administrator_id:person,reason:'Propuesta anterior de gestion multiple'}),command.id);
 await assert.rejects(()=>integration.sendOperationCommand(command.id),{status:400});
 const row=db.prepare('SELECT status,attempts FROM operation_commands WHERE id=?').get(command.id);assert.equal(row.status,'pending');assert.equal(row.attempts,0);assert.equal(requests.length,0);
});
