/** Persistent Manager DEV launcher. Targets are fixed loopback services only. */
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ctpAuthConfig} from '../server/ctp-auth.js';

export const PROJECT='ctp-dev-20261026';
export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const CTP_ROOT='D:/CTP/worktrees/ConnectToPlay-dev-local-20261026';
export const SECRETS='D:/CTP/dev/ctp/secrets.private.json';
export const DATA='D:/CTP/dev/manager';
export const API='http://127.0.0.1:58021';
export const WEB='http://localhost:58080';
export const MANAGER='http://localhost:58090';
const RUNTIME=path.join(DATA,'runtime.private.json');
const OWNER=path.join(DATA,'owner.json');
const REASON=/^dev_manager_[a-z0-9_]{1,80}$/;
const fail=reason=>{throw new Error(reason);};
const equalPath=(a,b)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);

function jwt(value,role){
 if(typeof value!=='string'||value.length<20||value.length>16384)return false;
 try{const payload=JSON.parse(Buffer.from(value.split('.')[1],'base64url'));return payload.role===role&&Number.isFinite(payload.exp)&&payload.exp*1000>Date.now();}catch{return false;}
}
export function validateSecrets(value){
 if(!value||value.schemaVersion!==1||value.projectId!==PROJECT||value.apiUrl!==API||value.webUrl!==WEB||value.managerUrl!==MANAGER)fail('dev_manager_secrets_target_invalid');
 if(!jwt(value.anonKey,'anon')||typeof value.serviceRoleKey!=='string'||value.serviceRoleKey.length<20||value.serviceRoleKey.length>16384)fail('dev_manager_secrets_invalid');
 for(const name of ['managerToken','managerHmac'])if(typeof value[name]!=='string'||value[name].length<32||value[name].length>256||/\s/.test(value[name]))fail('dev_manager_secrets_invalid');
 if(new Set([value.managerToken,value.managerHmac,value.managerEncryptionKey]).size!==3)fail('dev_manager_secrets_not_independent');
 try{ctpAuthConfig(managerEnvironment({},value));}catch{fail('dev_manager_auth_configuration_invalid');}
 return value;
}

export function osEnvironment(source){
 const allowed=new Set(['PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMFILES','PROGRAMFILES(X86)','COMMONPROGRAMFILES','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE']);
 return Object.fromEntries(Object.entries(source).filter(([key])=>allowed.has(key.toUpperCase())));
}
export function managerEnvironment(source,secrets){
 return {...osEnvironment(source),PORT:'58090',DEV_WEB_PORT:'58091',DATA_DIR:DATA,DB_PATH:path.join(DATA,'manager-dev.sqlite'),
  PUBLIC_ORIGIN:'',RULETA_ORIGIN:'',OPEN_BROWSER:'0',NODE_ENV:'development',
  CTP_AUTH_MODE:'ctp',CTP_DEV_LOCAL_AUTH:'true',CTP_AUTH_URL:WEB,CTP_WEB_ORIGIN:WEB,
  CTP_AUTH_ANON_KEY:secrets.anonKey,CTP_AUTH_TOKEN_KEY:secrets.managerEncryptionKey,
  CTP_AUTH_CAPTCHA_REQUIRED:'false',CTP_AUTH_CAPTCHA_SITE_KEY:'',
  CTP_OPERATIONS_URL:WEB+'/functions/v1/manager-operations',CTP_OPERATIONS_TOKEN:secrets.managerToken,CTP_SIGNING_SECRET:secrets.managerHmac,
  CTP_ENABLE_WRITES:'true',CTP_ALLOW_LOCAL_WRITES:'true',CTP_SYNC_SECONDS:'0',OBS_ENABLE_CONTROL:'false'};
}

export function validateStackProof(value){
 if(!value||value.phase!=='status'||value.projectId!==PROJECT||value.postgresMajor!==17
  ||!Number.isSafeInteger(value.migrations)||value.migrations<217||!Number.isSafeInteger(value.users)||value.users<0
  ||value.cronJobs!==0||value.vaultSecrets!==0)fail('dev_manager_database_proof_invalid');
 return value;
}

/** Native HTTP avoids inherited proxy configuration and never follows redirects. */
export function jsonRequest(origin,route,{method='GET',headers={},body,timeout=8000}={}){
 let target;try{target=new URL(origin);}catch{fail('dev_manager_http_target_invalid');}
 if(!/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):[1-9][0-9]{0,4}$/.test(origin)||!target.port||target.origin!==origin
  ||typeof route!=='string'||!route.startsWith('/')||route.startsWith('//')||/[\r\n\\]/.test(route))fail('dev_manager_http_target_invalid');
 return new Promise((resolve,reject)=>{
  const request=http.request({hostname:'127.0.0.1',port:Number(target.port),path:route,method,
   headers:{Host:target.host,Connection:'close',...headers,...(body===undefined?{}:{'Content-Type':'application/json'})}},response=>{
   let raw='',bytes=0;response.on('data',chunk=>{bytes+=chunk.length;if(bytes>65536){response.destroy();reject(new Error('dev_manager_http_response_limit'));return;}raw+=chunk;});
   response.on('error',()=>reject(new Error('dev_manager_http_unavailable')));
   response.on('end',()=>{
    if(response.statusCode<200||response.statusCode>=300){reject(new Error('dev_manager_http_rejected'));return;}
    if(!/^application\/json\b/i.test(response.headers['content-type']||'')){reject(new Error('dev_manager_http_json_required'));return;}
    try{resolve({data:JSON.parse(raw),headers:response.headers});}catch{reject(new Error('dev_manager_http_json_invalid'));}
   });
  });
  request.setTimeout(timeout,()=>request.destroy());request.on('error',()=>reject(new Error('dev_manager_http_unavailable')));
  request.end(body===undefined?undefined:JSON.stringify(body));
 });
}

async function readSecrets(){
 let info;try{info=await fs.lstat(SECRETS);}catch{fail('dev_manager_secrets_missing');}
 if(!info.isFile()||info.isSymbolicLink()||info.size>65536||!equalPath(await fs.realpath(SECRETS),SECRETS))fail('dev_manager_secrets_file_invalid');
 let value;try{value=JSON.parse(await fs.readFile(SECRETS,'utf8'));}catch{fail('dev_manager_secrets_invalid');}
 return validateSecrets(value);
}
async function noWorktreeEnv(){
 try{await fs.lstat(path.join(ROOT,'.env'));fail('dev_manager_worktree_env_forbidden');}catch(error){if(error.code!=='ENOENT')throw error;}
}
async function preflight(){
 await noWorktreeEnv();const secrets=await readSecrets();
 const proof=spawnSync('python',['-B',path.join(CTP_ROOT,'infra/dev/stack.py'),'status'],{
  cwd:CTP_ROOT,env:osEnvironment(process.env),encoding:'utf8',windowsHide:true,timeout:45000,maxBuffer:65536,
 });
 if(proof.status!==0)fail('dev_manager_database_not_ready');
 let database;try{database=JSON.parse(proof.stdout.trim());}catch{fail('dev_manager_database_proof_invalid');}
 validateStackProof(database);
 await jsonRequest(API,'/auth/v1/health',{headers:{apikey:secrets.anonKey}});
 const rest=await jsonRequest(WEB,'/rest/v1/rpc/get_release_access',{method:'POST',
  headers:{apikey:secrets.anonKey,Authorization:'Bearer '+secrets.anonKey},body:{}});
 if(rest.headers['x-ctp-environment']!=='dev-local'||!['legacy','ranked_only'].includes(rest.data?.mode))fail('dev_manager_web_proxy_not_ready');
 return secrets;
}

const ownerRecord={schemaVersion:1,projectId:PROJECT,kind:'ctp-manager-dev-local',dataRoot:DATA};
async function prepareData(){
 if(!equalPath(await fs.realpath(path.dirname(DATA)),path.dirname(DATA)))fail('dev_manager_data_parent_changed');
 try{await fs.mkdir(DATA);}catch(error){if(error.code!=='EEXIST')throw error;}
 const stat=await fs.lstat(DATA);if(!stat.isDirectory()||stat.isSymbolicLink()||!equalPath(await fs.realpath(DATA),DATA))fail('dev_manager_data_path_changed');
 const entries=await fs.readdir(DATA);
 if(!entries.length){await fs.writeFile(OWNER,JSON.stringify(ownerRecord)+'\n',{mode:0o600,flag:'wx'});return;}
 let record;try{record=JSON.parse(await fs.readFile(OWNER,'utf8'));}catch{fail('dev_manager_data_owner_required');}
 if(JSON.stringify(record)!==JSON.stringify(ownerRecord))fail('dev_manager_data_owner_mismatch');
}

export function validateRuntime(value){
 if(!value||value.schemaVersion!==1||value.projectId!==PROJECT||value.kind!==ownerRecord.kind||value.managerOrigin!==MANAGER
  ||!Number.isSafeInteger(value.launcherPid)||value.launcherPid<1||!Number.isSafeInteger(value.apiPid)||value.apiPid<1||value.apiPid===value.launcherPid
  ||!Number.isSafeInteger(value.controlPort)||value.controlPort<1||value.controlPort>65535
  ||!/^[a-f0-9]{32}$/.test(value.instanceId||'')||!/^[A-Za-z0-9_-]{43}$/.test(value.controlToken||'')
  ||typeof value.startedAtUtc!=='string'||value.startedAtUtc.length>40||!Number.isFinite(Date.parse(value.startedAtUtc)))fail('dev_manager_runtime_invalid');
 return value;
}
async function readRuntime(){
 try{const info=await fs.lstat(RUNTIME);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)fail('dev_manager_runtime_invalid');
  return validateRuntime(JSON.parse(await fs.readFile(RUNTIME,'utf8')));
 }catch(error){if(error.code==='ENOENT')return null;if(REASON.test(error.message))throw error;fail('dev_manager_runtime_invalid');}
}
async function control(runtime,stop=false){
 const response=await jsonRequest(`http://127.0.0.1:${runtime.controlPort}`,stop?'/stop':'/status',{
  method:stop?'POST':'GET',headers:{Authorization:'Bearer '+runtime.controlToken},...(stop?{body:{instanceId:runtime.instanceId}}:{}),timeout:3000});
 const dto=response.data;if(dto.projectId!==PROJECT||dto.instanceId!==runtime.instanceId||dto.apiPid!==runtime.apiPid)fail('dev_manager_runtime_identity_mismatch');
 return dto;
}
function publicStatus(runtime,status){return {status,projectId:PROJECT,managerOrigin:MANAGER,ctpOrigin:WEB,
 realLocalStackVerified:true,stackVerifiedAtUtc:runtime.startedAtUtc,persistentData:true,hostedAccess:false,launcherPid:runtime.launcherPid,apiPid:runtime.apiPid};}

async function ensureFreePort(){
 const probes=[];try{
  for(const host of ['127.0.0.1','::1']){const server=net.createServer();probes.push(server);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(58090,host,resolve);});}
 }catch{fail('dev_manager_port_in_use');}
 finally{for(const server of probes)if(server.listening)await new Promise(resolve=>server.close(resolve));}
}
function sameToken(received,expected){if(typeof received!=='string')return false;const a=Buffer.from(received),b=Buffer.from(expected);return a.length===b.length&&crypto.timingSafeEqual(a,b);}

async function start(){
 const secrets=await preflight();await prepareData();
 const previous=await readRuntime();if(previous){await control(previous);console.log(JSON.stringify(publicStatus(previous,'already_running')));return;}
 try{const built=await fs.lstat(path.join(ROOT,'dist/index.html'));if(!built.isFile()||built.isSymbolicLink())fail('dev_manager_build_required');}catch{fail('dev_manager_build_required');}
 await ensureFreePort();
 let child,server,runtime,closing=false;
 const stopChild=async()=>{
  if(child?.pid&&child.exitCode===null&&!child.signalCode)await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
 };
 const finish=async()=>{
  if(closing)return;closing=true;await stopChild();
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  const stored=await readRuntime();if(stored?.instanceId===runtime?.instanceId)await fs.unlink(RUNTIME);
 };
 try{
  server=http.createServer(async(req,res)=>{
   const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Connection':'close'});res.end(JSON.stringify(value));};
   if(!runtime||!sameToken(req.headers.authorization,'Bearer '+runtime.controlToken))return json(403,{error:'local_control_denied'});
   const dto={projectId:PROJECT,instanceId:runtime.instanceId,apiPid:runtime.apiPid,status:closing?'stopping':'ready'};
   if(req.method==='GET'&&req.url==='/status')return json(200,dto);
   if(req.method!=='POST'||req.url!=='/stop')return json(404,{});
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>512)return json(413,{});}
   let body;try{body=JSON.parse(raw);}catch{return json(400,{});}
   if(body.instanceId!==runtime.instanceId)return json(403,{});
   json(200,{...dto,status:'stopping'});void finish().catch(()=>{process.exitCode=1;});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  child=spawn(process.execPath,['--disable-warning=ExperimentalWarning','server/index.js'],{
   cwd:ROOT,env:managerEnvironment(process.env,secrets),windowsHide:true,stdio:['ignore','pipe','pipe'],
  });
  let spawnError=false;child.once('error',()=>{spawnError=true;});child.stdout.on('data',()=>{});child.stderr.on('data',()=>{});
  const deadline=Date.now()+15000;let ready=false;
  while(Date.now()<deadline&&!spawnError&&child.exitCode===null){
   try{const status=await jsonRequest(MANAGER,'/api/auth/status',{timeout:1000});
    if(status.data.provider==='ctp'&&status.data.setup===true&&status.data.web_origin===WEB){ready=true;break;}
   }catch{}
   await new Promise(resolve=>setTimeout(resolve,150));
  }
  if(!ready||spawnError||child.exitCode!==null)fail('dev_manager_api_not_ready');
  runtime={schemaVersion:1,projectId:PROJECT,kind:ownerRecord.kind,managerOrigin:MANAGER,sourceRoot:ROOT,
   launcherPid:process.pid,apiPid:child.pid,controlPort:server.address().port,instanceId:crypto.randomBytes(16).toString('hex'),
   controlToken:crypto.randomBytes(32).toString('base64url'),startedAtUtc:new Date().toISOString()};
  await fs.writeFile(RUNTIME,JSON.stringify(runtime,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify(publicStatus(runtime,'ready')));
  const shutdown=()=>void finish().catch(()=>{process.exitCode=1;console.log(JSON.stringify({status:'failed',reason:'dev_manager_cleanup_failed',projectId:PROJECT,hostedAccess:false}));});
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
  if(child.exitCode===null&&!child.signalCode)await new Promise(resolve=>child.once('exit',resolve));await finish();
 }catch(error){await finish();throw error;}
}

export async function main(args=process.argv.slice(2)){
 if(args.length>1||args[0]&&!['start','check','status','stop'].includes(args[0]))fail('dev_manager_arguments_invalid');
 const mode=args[0]||'start';
 if(mode==='check'){await preflight();console.log(JSON.stringify({status:'checked',projectId:PROJECT,managerOrigin:MANAGER,ctpOrigin:WEB,realLocalStackVerified:true,hostedAccess:false}));return;}
 if(mode==='start'){await start();return;}
 const runtime=await readRuntime();if(!runtime){console.log(JSON.stringify({status:'stopped',projectId:PROJECT,hostedAccess:false}));return;}
 await control(runtime,mode==='stop');console.log(JSON.stringify(publicStatus(runtime,mode==='stop'?'stopping':'ready')));
}
if(process.argv[1]&&equalPath(process.argv[1],fileURLToPath(import.meta.url)))main().catch(error=>{
 console.log(JSON.stringify({status:'failed',reason:REASON.test(error.message||'')?error.message:'dev_manager_start_failed',projectId:PROJECT,hostedAccess:false}));process.exitCode=1;
});
