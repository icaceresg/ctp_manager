// Real HTTP + real PostgreSQL integration, restricted to the disposable local review container.
// Does not load remote secrets, call Supabase cloud, or touch the normal Manager DB.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ctp=path.resolve(root,'../worktrees/ConnectToPlay-pre-integration');
const container='ctp-review-db-20261002';
const database=process.env.QA_DATABASE||'ctp_manager_competition_preview';
if(!/^ctp_manager_competition_(?:preview|qa_[0-9]+)$/.test(database))throw new Error('Only a dedicated local QA database is allowed.');
const run=(args,input)=>{const r=spawnSync('docker',args,{input,encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true});if(r.status!==0)throw new Error(r.stderr||'Docker QA unavailable');return r.stdout;};
const info=JSON.parse(run(['inspect',container]))[0];
if(info.Config.Labels?.project!=='ctp-local-review'||info.HostConfig.NetworkMode!=='none'||!info.State.Running)throw new Error('QA requires the isolated review container.');
const sql=(query)=>run(['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],query);
if(sql("select to_regprocedure('public.manager_consume_request_nonce(uuid,bigint,text)')").trim()==='')throw new Error('Apply QA migrations and fixtures first.');
let previous=null;
if(process.env.QA_REUSE==='true'){
 previous=JSON.parse(fs.readFileSync(path.join(root,'output/signed-flow-local.json'),'utf8'));
 const relative=path.relative(os.tmpdir(),previous.directory);
 if(!previous.synthetic||previous.database!==database||!/^ctp-manager-signed-flow-[A-Za-z0-9]+$/.test(relative)||!fs.existsSync(path.join(previous.directory,'qa.sqlite')))throw new Error('Only the same disposable QA directory can be reused.');
}
const directory=previous?.directory||fs.mkdtempSync(path.join(os.tmpdir(),'ctp-manager-signed-flow-'));
const token=randomBytes(32).toString('hex'), secret=randomBytes(32).toString('hex');
Object.assign(process.env,{DATA_DIR:directory,DB_PATH:path.join(directory,'qa.sqlite'),PUBLIC_ORIGIN:'',CTP_OPERATIONS_URL:'',CTP_OPERATIONS_TOKEN:'',CTP_SIGNING_SECRET:'',CTP_ENABLE_WRITES:'false',OBS_ENABLE_CONTROL:'false'});
const {db}=await import('../server/db.js');
const {hashPassword}=await import('../server/auth.js');
const {getOperatorIdentity}=await import('../server/operations.js');
const now=Date.now();
const users=[['qa_manager','QA · Coordinación',true,null],['qa_referee','QA · Árbitro',false,'referee'],['qa_production','QA · Producción',false,'production'],['qa_player','QA · Sin acceso',false,null]];
for(const [username,name,isAdmin,kind]of users){
  if(db.prepare('SELECT id FROM users WHERE username=?').get(username))continue;
  const id=Number(db.prepare('INSERT INTO users(username,name,password_hash,is_admin,created_at) VALUES(?,?,?,?,?)').run(username,name,hashPassword('Qa-Only-2026!'),isAdmin?1:0,now).lastInsertRowid);
  if(kind){const role=db.prepare('SELECT id FROM roles WHERE staff_kind=?').get(kind);db.prepare('INSERT INTO user_roles(user_id,role_id) VALUES(?,?)').run(id,role.id);}
  if(isAdmin||kind==='referee'){
    const actor=getOperatorIdentity(id),template=isAdmin?'qa_admin':'qa_referee';
    sql(`INSERT INTO public.manager_operator_bindings(manager_user_id,ctp_user_id,scopes,enabled,configured_by) SELECT '${actor}',ctp_user_id,scopes,true,configured_by FROM public.manager_operator_bindings WHERE manager_user_id='${template}' ON CONFLICT(manager_user_id) DO NOTHING;`);
    if(isAdmin) sql(`UPDATE public.manager_operator_bindings SET scopes=(SELECT ARRAY(SELECT DISTINCT unnest(scopes||ARRAY['ranked.read','ranked.season.schedule']))) WHERE manager_user_id='${actor}';`);
  }
}
db.close();
// Exercise the final access boundary only in the fixed, disposable QA database.
// The PRE schema preview starts with legacy staff tools enabled by default.
const cutoverEnabled=process.env.QA_CUTOVER==='true';
if(cutoverEnabled){
  sql("BEGIN; SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claim.role','service_role',true); SELECT public.manager_set_competition_cutover(true,'Isolated QA: signed Manager flow with staff cutover enabled'); COMMIT;");
}
const methods=new Set(['manager_consume_request_nonce','manager_operations_snapshot','manager_operations_case_context','manager_operations_command','manager_competition_query','manager_competition_command','manager_competition_receipt','manager_guard_state','manager_guard_command','guard_claim_pair','guard_heartbeat','guard_close','manager_ranked_state','manager_ranked_command','manager_club_candidates','manager_club_create']);
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const databaseClient={rpc:async(name,params={})=>{
  if(!methods.has(name)||Object.keys(params).some(key=>!/^p_[a-z_]+$/.test(key)))return {error:{code:'42501'}};
  const args=Object.entries(params).map(([key,value])=>`${key} => ${value===null?'NULL':typeof value==='object'?quote(JSON.stringify(value))+'::jsonb':quote(value)}`).join(',');
  try{const out=sql(`BEGIN; SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claim.role','service_role',true); SELECT coalesce(to_jsonb(public.${name}(${args})),'null'::jsonb)::text; COMMIT;`).trim().split('\n');return {data:JSON.parse(out.at(-1)),error:null};}
  catch(error){const code=String(error.message).match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1]||'XX000';fs.appendFileSync(path.join(directory,'sql-errors.log'),`${name}: ${error.message}\n`);return {data:null,error:{code}};}
}};
const {createHandler}=await import(pathToFileURL(path.join(ctp,'supabase/functions/manager-operations/protocol.mjs')));
const {generateSchedule}=await import(pathToFileURL(path.join(ctp,'supabase/functions/manager-operations/schedule.ts')));
const handler=createHandler({database:databaseClient,integrationToken:token,signingSecret:secret,enabled:true,generateSchedule});
const {createHandler:createGuardHandler}=await import(pathToFileURL(path.join(ctp,'supabase/functions/ctp-guard/protocol.mjs')));
const guardHandler=createGuardHandler(databaseClient);
const bridge=http.createServer(async(req,res)=>{
  try{const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>16384){res.writeHead(413).end();return;}chunks.push(chunk);}
    const activeHandler=req.url==='/functions/v1/ctp-guard'?guardHandler:handler;
    const result=await activeHandler(new Request(`http://127.0.0.1${req.url}`,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})}));
    res.writeHead(result.status,Object.fromEntries(result.headers));res.end(await result.text());
  }catch{res.writeHead(500).end();}
});
await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve));
const port=Number(process.env.QA_PORT||3229);
const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning','server/index.js'],{cwd:root,env:{...process.env,PORT:String(port),OPEN_BROWSER:'0',CTP_OPERATIONS_URL:`http://127.0.0.1:${bridge.address().port}/functions/v1/manager-operations`,CTP_OPERATIONS_TOKEN:token,CTP_SIGNING_SECRET:secret,CTP_ENABLE_WRITES:'true',CTP_ALLOW_LOCAL_WRITES:'true',CTP_SYNC_SECONDS:'0'},stdio:['ignore','pipe','pipe'],windowsHide:true});
child.stdout.on('data',chunk=>process.stdout.write(chunk));child.stderr.on('data',chunk=>process.stderr.write(chunk));
const metadata={url:`http://localhost:${port}`,guardEndpoint:`http://127.0.0.1:${bridge.address().port}/functions/v1/ctp-guard`,database,directory,ctp,synthetic:true,cutoverEnabled};
fs.mkdirSync(path.join(root,'output'),{recursive:true});fs.writeFileSync(path.join(root,'output','signed-flow-local.json'),JSON.stringify(metadata,null,2));
console.log(JSON.stringify(metadata));
console.log('QA users: qa_manager, qa_referee, qa_production; password Qa-Only-2026! (synthetic only)');
let stopping=false;const stop=()=>{if(stopping)return;stopping=true;if(child.exitCode===null)child.kill();bridge.close();};
process.on('SIGINT',stop);process.on('SIGTERM',stop);child.on('exit',code=>{stop();process.exitCode=code||0;});
