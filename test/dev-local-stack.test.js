import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import {validateSecrets,managerEnvironment,validateStackProof,validateRuntime,jsonRequest,PROJECT,API,WEB,MANAGER,DATA} from '../scripts/dev-local-stack.mjs';
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
 const value={schemaVersion:1,projectId:PROJECT,kind:'ctp-manager-dev-local',managerOrigin:MANAGER,launcherPid:100,apiPid:101,
  controlPort:51000,instanceId:crypto.randomBytes(16).toString('hex'),controlToken:crypto.randomBytes(32).toString('base64url'),startedAtUtc:new Date().toISOString()};
 assert.equal(validateRuntime(value),value);
 for(const patch of [{projectId:'other'},{kind:'other'},{managerOrigin:'https://manager.playctp.com'},{launcherPid:0},{apiPid:'101'},{apiPid:100},{controlPort:0},{controlPort:65536},{instanceId:'x'},{controlToken:'x'},{startedAtUtc:null}]){
  assert.throws(()=>validateRuntime({...value,...patch}),/dev_manager_runtime_invalid/);
 }
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
