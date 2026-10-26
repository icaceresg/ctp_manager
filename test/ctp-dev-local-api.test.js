import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Real TCP Auth/Express/cookie flow against a fresh Manager SQLite database.
// Auth data is synthetic; the child may fetch only the already-bound loopback
// origin below. No hosted CTP service or persistent account is used.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-dev-auth-http-'));
const anon=`e30.${Buffer.from('{"role":"anon","exp":4102444800}').toString('base64url')}.fixture`;
const admin='10000000-0000-4000-8000-000000000001';
const referee='10000000-0000-4000-8000-000000000002';
const player='10000000-0000-4000-8000-000000000003';
const observed=[], sessions=new Map();
let provider, redirectTarget, child, managerPort, authOrigin, redirectVisits=0;

function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Connection':'close'});res.end(JSON.stringify(data));}
async function listen(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return server.address().port;}
function request(method,route,body,cookie=''){
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port:managerPort,path:route,method,
   headers:{Host:`localhost:${managerPort}`,Origin:`http://localhost:${managerPort}`,
    'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})}},res=>{
    let raw='';res.on('data',part=>raw+=part);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,data:JSON.parse(raw)}));
   });
  req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
 });
}

before(async()=>{
 assert.equal(fs.existsSync(path.join(root,'.env')),false,'the isolated test must not inherit a worktree .env');
 redirectTarget=http.createServer((req,res)=>{redirectVisits++;send(res,200,{error:'redirect fixture reached'});});
 const redirectPort=await listen(redirectTarget);
 provider=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>65536)return send(res,413,{});}
  const body=JSON.parse(raw||'{}');
  observed.push({method:req.method,path:req.url,host:req.headers.host,apiKey:req.headers.apikey,authorization:req.headers.authorization,body});
  if(req.method==='POST'&&req.url==='/auth/v1/token?grant_type=password'){
   if(body.email==='redirect@example.invalid'){res.writeHead(307,{Location:`http://127.0.0.1:${redirectPort}/collect`,'Connection':'close'});res.end();return;}
   if(body.password!=='synthetic-dev-password')return send(res,401,{});
   const subject=body.email==='admin@example.invalid'?admin:body.email==='referee@example.invalid'?referee:player;
   const access='fixture-access-'+crypto.randomUUID();sessions.set(access,subject);
   return send(res,200,{user:{id:subject},access_token:access,refresh_token:'fixture-refresh-'+subject,expires_in:3600});
  }
  if(req.method==='POST'&&req.url==='/rest/v1/rpc/manager_link_own_identity'){
   const subject=sessions.get(req.headers.authorization?.replace('Bearer ',''));
   if(!subject||subject===player)return send(res,403,{});
   return send(res,200,{ctp_user_id:subject,username:subject===admin?'DEV Admin':'DEV Referee',
    role:subject===admin?'admin':'referee',actor_id:`ctp:${subject}`,scopes:subject===admin?['admin.console','ranked.read']:['ranked.read']});
  }
  send(res,404,{});
 });
 const authPort=await listen(provider);authOrigin=`http://127.0.0.1:${authPort}`;
 const probe=net.createServer();managerPort=await listen(probe);await new Promise(resolve=>probe.close(resolve));
 const preload=`const nativeFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{if(new URL(String(input)).origin!==${JSON.stringify(authOrigin)})throw new Error('non-fixture network destination blocked');return nativeFetch(input,init);};`;
 child=spawn(process.execPath,['--disable-warning=ExperimentalWarning','--import','data:text/javascript;base64,'+Buffer.from(preload).toString('base64'),'server/index.js'],{
  cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,
   PORT:String(managerPort),DEV_WEB_PORT:String(managerPort),DATA_DIR:directory,DB_PATH:path.join(directory,'dev-only.sqlite'),
   PUBLIC_ORIGIN:'',RULETA_ORIGIN:'',OPEN_BROWSER:'0',CTP_AUTH_MODE:'ctp',CTP_DEV_LOCAL_AUTH:'true',
   CTP_AUTH_URL:authOrigin,CTP_WEB_ORIGIN:authOrigin,CTP_OPERATIONS_URL:authOrigin+'/functions/v1/manager-operations',
   CTP_AUTH_ANON_KEY:anon,CTP_AUTH_TOKEN_KEY:crypto.randomBytes(32).toString('base64url'),
   CTP_AUTH_CAPTCHA_REQUIRED:'false',CTP_AUTH_CAPTCHA_SITE_KEY:'',
   CTP_OPERATIONS_TOKEN:crypto.randomBytes(32).toString('hex'),CTP_SIGNING_SECRET:crypto.randomBytes(32).toString('hex'),
   CTP_ALLOW_LOCAL_WRITES:'false',CTP_ENABLE_WRITES:'false',CTP_SYNC_SECONDS:'0',OBS_ENABLE_CONTROL:'false',
  }});
 let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
 const deadline=Date.now()+15000;
 while(!output.includes('funcionando')){
  if(child.exitCode!==null||Date.now()>deadline)throw new Error('DEV local Manager fixture startup failed');
  await new Promise(resolve=>setTimeout(resolve,40));
 }
});

after(async()=>{
 if(child&&child.exitCode===null&&!child.signalCode)await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
 for(const server of [provider,redirectTarget])if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('ctp-dev-auth-http-'));
 fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});
});

test('DEV shared login uses actual loopback HTTP and the linked staff identity, with an opaque Manager cookie',async()=>{
 const login=await request('POST','/api/auth/login',{email:'ADMIN@example.invalid',password:'synthetic-dev-password'});
 assert.equal(login.status,200);assert.equal(login.data.user.ctp_user_id,admin);assert.equal(login.data.user.ctp_role,'admin');assert.equal(login.data.user.auth_mode,'ctp');
 const cookie=login.headers['set-cookie'][0];assert.match(cookie,/^mrm_session=/);assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Lax/);assert.doesNotMatch(cookie,/; Secure/);
 assert.doesNotMatch(JSON.stringify(login.data),/fixture-access-|fixture-refresh-|synthetic-dev-password/);
 const current=await request('GET','/api/me',undefined,cookie.split(';',1)[0]);assert.equal(current.status,200);assert.equal(current.data.is_admin,true);assert.equal(current.data.ctp_user_id,admin);
 assert.equal((await request('POST','/api/auth/setup',{username:'independent-admin',password:'synthetic-dev-password'})).status,403);
 assert.deepEqual(observed.slice(0,2).map(row=>row.path),['/auth/v1/token?grant_type=password','/rest/v1/rpc/manager_link_own_identity']);
 assert.equal(observed[0].body.email,'admin@example.invalid');assert.equal(observed[1].body&&Object.keys(observed[1].body).length,0);
 assert.ok(observed[1].authorization.startsWith('Bearer fixture-access-'));
 assert.ok(observed.every(row=>row.method==='POST'&&row.host===new URL(authOrigin).host&&row.apiKey===anon));
});

test('local shared login still refuses players and preserves referee rather than granting admin',async()=>{
 const denied=await request('POST','/api/auth/login',{email:'player@example.invalid',password:'synthetic-dev-password'});
 assert.equal(denied.status,403);assert.equal(denied.headers['set-cookie'],undefined);
 const login=await request('POST','/api/auth/login',{email:'referee@example.invalid',password:'synthetic-dev-password'});
 assert.equal(login.status,200);assert.equal(login.data.user.ctp_user_id,referee);assert.equal(login.data.user.is_admin,false);assert.equal(login.data.user.ctp_role,'referee');
 const cookie=login.headers['set-cookie'][0].split(';',1)[0];
 assert.equal((await request('GET','/api/administration/users/'+player,undefined,cookie)).status,403);
});

test('provider redirects are never followed and rejected credentials never create a Manager session',async()=>{
 const redirected=await request('POST','/api/auth/login',{email:'redirect@example.invalid',password:'synthetic-dev-password'});
 assert.equal(redirected.status,503);assert.equal(redirected.headers['set-cookie'],undefined);assert.equal(redirectVisits,0);
 const denied=await request('POST','/api/auth/login',{email:'admin@example.invalid',password:'wrong-synthetic-password'});
 assert.equal(denied.status,401);assert.equal(denied.headers['set-cookie'],undefined);
 assert.ok(observed.every(row=>['/auth/v1/token?grant_type=password','/rest/v1/rpc/manager_link_own_identity'].includes(row.path)));
});
