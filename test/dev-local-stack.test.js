import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validateSecrets,managerEnvironment,validateStackProof,validateRuntime,jsonRequest,recoverRefusedRuntime,PROJECT,ROOT,API,WEB,MANAGER,DATA} from '../scripts/dev-local-stack.mjs';
import {ctpAuthConfig} from '../server/ctp-auth.js';

const jwt=role=>`e30.${Buffer.from(JSON.stringify({role,exp:4102444800})).toString('base64url')}.fixture`;
const secrets=()=>({schemaVersion:1,projectId:PROJECT,apiUrl:API,webUrl:WEB,managerUrl:MANAGER,anonKey:jwt('anon'),serviceRoleKey:jwt('service_role'),
 managerToken:crypto.randomBytes(36).toString('base64url'),managerHmac:crypto.randomBytes(36).toString('base64url'),managerEncryptionKey:crypto.randomBytes(32).toString('base64url')});

test('DEV launcher rejects foreign project targets and malformed or reused credentials before starting anything',()=>{
 const value=secrets();assert.equal(validateSecrets(value),value);
 for(const patch of [
  {schemaVersion:2},{projectId:'ConnectToPlay'},{apiUrl:'https://pre.playctp.com'},{webUrl:'https://playctp.com'},
  {managerUrl:'https://manager.playctp.com'},{apiUrl:'http://localhost:58021'},{anonKey:jwt('service_role')},
  {anonKey:'not-a-jwt'},{serviceRoleKey:null},{managerToken:'short'},{managerHmac:value.managerToken},
  {managerToken:'x'.repeat(32)+'\n'},{managerEncryptionKey:'not-a-key'},
 ])assert.throws(()=>validateSecrets({...value,...patch}),error=>/^dev_manager_/.test(error.message));
});

test('DEV process inherits only OS settings and fixed local paths, never the service role or another app environment',()=>{
 const keys=secrets();
 const env=managerEnvironment({Path:'os-path',TEMP:'temp-dir',SYSTEMROOT:'system',
  NODE_OPTIONS:'--import untrusted',HTTP_PROXY:'http://remote.invalid',HTTPS_PROXY:'http://remote.invalid',
  SUPABASE_SERVICE_ROLE_KEY:'foreign-service-role',PGPASSWORD:'foreign-password',
  CTP_AUTH_URL:'https://playctp.com',CTP_SIGNING_SECRET:'foreign-signature',PUBLIC_ORIGIN:'https://manager.playctp.com',DATA_DIR:'foreign-data'},keys);
 assert.equal(env.Path,'os-path');assert.equal(env.TEMP,'temp-dir');assert.equal(env.DATA_DIR,DATA);assert.equal(env.PUBLIC_ORIGIN,'');
 assert.equal(env.PORT,'58090');assert.equal(env.CTP_AUTH_URL,WEB);assert.equal(env.CTP_WEB_ORIGIN,WEB);
 assert.equal(env.CTP_OPERATIONS_URL,WEB+'/functions/v1/manager-operations');
 assert.equal(env.CTP_ENABLE_WRITES,'true');assert.equal(env.CTP_ALLOW_LOCAL_WRITES,'true');assert.equal(env.CTP_SYNC_SECONDS,'0');assert.equal(env.OBS_ENABLE_CONTROL,'false');
 assert.equal(ctpAuthConfig(env).origin,WEB);
 assert.ok(env.DB_PATH.endsWith('manager-dev.sqlite'));
 for(const name of ['NODE_OPTIONS','HTTP_PROXY','HTTPS_PROXY','SUPABASE_SERVICE_ROLE_KEY','PGPASSWORD'])assert.equal(env[name],undefined);
 assert.equal(JSON.stringify(env).includes(keys.serviceRoleKey),false);
});

test('database proof must name this verified local project and have the reviewed PostgreSQL schema without jobs or Vault destinations',()=>{
 const proof={phase:'status',projectId:PROJECT,postgresMajor:17,migrations:217,users:10,cronJobs:0,vaultSecrets:0};
 assert.equal(validateStackProof(proof),proof);
 for(const patch of [{phase:'failed'},{projectId:'other'},{postgresMajor:18},{migrations:216},{migrations:'217'},{users:-1},{cronJobs:1},{vaultSecrets:1}]){
  assert.throws(()=>validateStackProof({...proof,...patch}),/dev_manager_database_proof_invalid/);
 }
});

test('private runtime references need one owned project, distinct process references and a local control capability',()=>{
 const value={schemaVersion:1,projectId:PROJECT,kind:'ctp-manager-dev-local',managerOrigin:MANAGER,sourceRoot:ROOT,launcherPid:100,apiPid:101,
  controlPort:51000,instanceId:crypto.randomBytes(16).toString('hex'),controlToken:crypto.randomBytes(32).toString('base64url'),startedAtUtc:new Date().toISOString()};
 assert.equal(validateRuntime(value),value);
 for(const patch of [{projectId:'other'},{kind:'other'},{managerOrigin:'https://manager.playctp.com'},{sourceRoot:null},{sourceRoot:path.resolve(ROOT,'..','other-worktree')},{launcherPid:0},{apiPid:'101'},{apiPid:100},{controlPort:0},{controlPort:65536},{instanceId:'x'},{controlToken:'x'},{startedAtUtc:null}]){
  assert.throws(()=>validateRuntime({...value,...patch}),/dev_manager_runtime_invalid/);
 }
});

const runtimeRecord=()=>({schemaVersion:1,projectId:PROJECT,kind:'ctp-manager-dev-local',managerOrigin:MANAGER,sourceRoot:ROOT,
 launcherPid:31001,apiPid:31002,controlPort:51000,instanceId:crypto.randomBytes(16).toString('hex'),
 controlToken:crypto.randomBytes(32).toString('base64url'),startedAtUtc:new Date().toISOString()});
const refusal=()=>Object.assign(new Error('dev_manager_http_unavailable'),{code:'ECONNREFUSED'});

async function withRuntime(check){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ctp-manager-stale-runtime-'));
 const runtimeFile=path.join(directory,'runtime.private.json'),record=runtimeRecord();
 await fs.writeFile(runtimeFile,JSON.stringify(record),{mode:0o600,flag:'wx'});
 try{await check({directory,runtimeFile,record});}
 finally{
  assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith('ctp-manager-stale-runtime-'));
  await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:50});
 }
}

test('start recovery archives only a refused owned runtime after the API port probe succeeds',async()=>{
 await withRuntime(async({directory,runtimeFile,record})=>{
  const steps=[];
  assert.equal(await recoverRefusedRuntime(record,{runtimeFile,
   requestControl:async()=>{steps.push('control-refused');throw refusal();},
   assertPortFree:async()=>{steps.push('api-port-probes');}}),true);
  assert.deepEqual(steps,['control-refused','api-port-probes']);
  await assert.rejects(()=>fs.readFile(runtimeFile),error=>error.code==='ENOENT');
  const files=await fs.readdir(directory);assert.equal(files.length,1);
  assert.match(files[0],/^runtime\.stale-[0-9TZ]+-[a-f0-9]{32}\.private\.json$/);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,files[0]),'utf8')),record);
 });
});

test('active control, occupied API ports, timeouts and identity errors preserve the runtime file',async()=>{
 for(const scenario of ['active','occupied','timeout','identity','generic-unavailable'])await withRuntime(async({directory,runtimeFile,record})=>{
  const original=await fs.readFile(runtimeFile,'utf8');let probes=0;
  const options={runtimeFile,requestControl:async()=>{
   if(scenario==='active')return {status:'ready'};
   if(scenario==='identity')throw new Error('dev_manager_runtime_identity_mismatch');
   if(scenario==='timeout')throw Object.assign(new Error('dev_manager_http_unavailable'),{code:'ETIMEDOUT'});
   if(scenario==='generic-unavailable')throw new Error('dev_manager_http_unavailable');
   throw refusal();
  },assertPortFree:async()=>{probes++;throw new Error('dev_manager_port_in_use');}};
  if(scenario==='active')assert.equal(await recoverRefusedRuntime(record,options),false);
  else await assert.rejects(()=>recoverRefusedRuntime(record,options),error=>/^dev_manager_/.test(error.message));
  assert.equal(probes,scenario==='occupied'?1:0);
  assert.equal(await fs.readFile(runtimeFile,'utf8'),original);
  assert.deepEqual(await fs.readdir(directory),['runtime.private.json']);
 });
});

test('recovery rejects foreign source ownership and refuses a runtime changed during the probes',async()=>{
 await withRuntime(async({directory,runtimeFile,record})=>{
  let called=false;
  await assert.rejects(()=>recoverRefusedRuntime({...record,sourceRoot:path.resolve(ROOT,'..','other-worktree')},{runtimeFile,
   requestControl:async()=>{called=true;throw refusal();},assertPortFree:async()=>{called=true;}}),/dev_manager_runtime_invalid/);
  assert.equal(called,false);
  const replacement={...record,instanceId:crypto.randomBytes(16).toString('hex')};
  await assert.rejects(()=>recoverRefusedRuntime(record,{runtimeFile,requestControl:async()=>{throw refusal();},
   assertPortFree:async()=>{await fs.writeFile(runtimeFile,JSON.stringify(replacement));}}),/dev_manager_stale_runtime_changed/);
  assert.deepEqual(JSON.parse(await fs.readFile(runtimeFile,'utf8')),replacement);
  assert.deepEqual(await fs.readdir(directory),['runtime.private.json']);
 });
});

test('HTTP control transport retains only a safe exact refusal code for stale recovery',async()=>{
 const server=http.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;await new Promise(resolve=>server.close(resolve));
 await assert.rejects(()=>jsonRequest(origin,'/status',{timeout:1000}),error=>{
  assert.equal(error.message,'dev_manager_http_unavailable');assert.equal(error.code,'ECONNREFUSED');
  assert.equal(error.cause,undefined);assert.equal(error.address,undefined);assert.equal(error.port,undefined);return true;
 });
});

test('launcher HTTP transport always connects to loopback, checks bounded JSON and does not follow redirects',async()=>{
 const seen=[];let redirected=0;
 const trap=http.createServer((req,res)=>{redirected++;res.writeHead(200,{'Content-Type':'application/json'});res.end('{}');});
 await new Promise(resolve=>trap.listen(0,'127.0.0.1',resolve));
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;seen.push({path:req.url,host:req.headers.host,authorization:req.headers.authorization,raw});
  if(req.url==='/redirect'){res.writeHead(307,{Location:`http://127.0.0.1:${trap.address().port}/receive`});res.end();return;}
  if(req.url==='/oversize'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({text:'x'.repeat(70000)}));return;}
  res.writeHead(200,{'Content-Type':req.url==='/html'?'text/html':'application/json'});res.end(req.url==='/invalid'?'{invalid':JSON.stringify({verified:true}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://localhost:${server.address().port}`;
 try{
  assert.deepEqual((await jsonRequest(origin,'/proof',{method:'POST',headers:{Authorization:'Bearer local-test-only'},body:{check:true}})).data,{verified:true});
  assert.equal(seen[0].host,new URL(origin).host);assert.equal(seen[0].authorization,'Bearer local-test-only');assert.deepEqual(JSON.parse(seen[0].raw),{check:true});
  await assert.rejects(()=>jsonRequest(origin,'/redirect'),/dev_manager_http_rejected/);assert.equal(redirected,0);
  await assert.rejects(()=>jsonRequest(origin,'/oversize'),/dev_manager_http_response_limit/);
  await assert.rejects(()=>jsonRequest(origin,'/invalid'),/dev_manager_http_json_invalid/);
  await assert.rejects(()=>jsonRequest(origin,'/html'),/dev_manager_http_json_required/);
  for(const remote of ['https://pre.playctp.com','http://192.168.1.1:58080','http://127.1:58080','http://localhost:58080/'])assert.throws(()=>jsonRequest(remote,'/proof'),/dev_manager_http_target_invalid/);
  assert.throws(()=>jsonRequest(origin,'//remote.invalid/proof'),/dev_manager_http_target_invalid/);
 }finally{for(const s of [server,trap]){s.closeAllConnections();await new Promise(resolve=>s.close(resolve));}}
});
