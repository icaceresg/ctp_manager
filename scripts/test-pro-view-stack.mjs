// Explicitly isolated Docker fixture only. Never targets a VPS or PRE.
// Create the named clone described in docs/PRO_VIEW.md before running.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const managerRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ctpRoot=process.argv[2]&&path.resolve(process.argv[2]);
assert.ok(ctpRoot,'Usage: node scripts/test-pro-view-stack.mjs <CTP-source-directory>');
const container='ctp-review-db-20261002',databaseName='ctp_pro_view_manager_e2e_20261019';
assert.equal(databaseName,'ctp_pro_view_manager_e2e_20261019');
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'ctp-manager-real-pro-view-'));
const token='local-real-sql-pro-view-test-token-0123456789',secret='local-real-sql-pro-view-test-signature-0123456789';
const matchId='7c000000-0000-4000-8000-000000000301',roomId='7c000000-0000-4000-8000-000000000900',adminCtpId='79000000-0000-4000-8000-000000000001';
const rpcCalls=[],mutations=[],events=[];
let bridge,manager,port,adminCookie,producerCookie,producerActor,loseAck=false;
function quote(value){assert.equal(typeof value,'string');assert.ok(!value.includes('\0'));return "'"+value.replaceAll("'","''")+"'";}
// The database is a fixed local fixture; SQL never comes from a browser string.
async function runSql(text){
 return new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',container,'psql','-XAt','-U','postgres','-d',databaseName,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',part=>{stdout+=part;if(stdout.length>8*1024*1024)child.kill();});child.stderr.on('data',part=>{stderr+=part;});
  child.once('error',reject);child.once('exit',code=>code===0?resolve(stdout):reject(Object.assign(new Error('SQL fixture call failed '+(stderr.match(/ERROR:\s+([A-Z0-9]{5})/)?.[1]||'')),{stderr,code:stderr.match(/ERROR:\s+([A-Z0-9]{5})/)?.[1]||'XX000'})));child.stdin.end(text);
 });
}
const resultSql=async(text,role='postgres')=>{
 const out=await runSql(`BEGIN; ${role==='postgres'?'':`SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claim.role',${quote(role)},true);`} SELECT 'CTP_RESULT:'||(${text})::text; COMMIT;`);
 const line=out.split(/\r?\n/).find(line=>line.startsWith('CTP_RESULT:'));assert.ok(line,'SQL JSON response missing');return JSON.parse(line.slice(11));
};
const rpcSignatures={
 manager_consume_request_nonce:a=>{assert.deepEqual(Object.keys(a).sort(),['p_nonce','p_origin','p_timestamp']);assert.match(a.p_nonce,/^[0-9a-f-]{36}$/i);assert.ok(Number.isSafeInteger(a.p_timestamp));return `public.manager_consume_request_nonce(${quote(a.p_nonce)},${a.p_timestamp},${quote(a.p_origin)})`;},
 manager_operations_snapshot:a=>{assert.deepEqual(a,{});return 'public.manager_operations_snapshot()';},
 manager_pro_view_query:a=>{assert.deepEqual(Object.keys(a),['p_actor_id']);return `public.manager_pro_view_query(${quote(a.p_actor_id)})`;},
 manager_pro_view_command:a=>{assert.deepEqual(Object.keys(a).sort(),['p_actor_id','p_command_id','p_expected_revision','p_settings']);assert.match(a.p_command_id,/^[0-9a-f-]{36}$/i);assert.ok(Number.isSafeInteger(a.p_expected_revision));return `public.manager_pro_view_command(${quote(a.p_actor_id)},${quote(a.p_command_id)}::uuid,${a.p_expected_revision}::bigint,${quote(JSON.stringify(a.p_settings))}::jsonb)`;},
};
const adapter={async rpc(name,args={}){assert.ok(Object.hasOwn(rpcSignatures,name),'RPC is not allowlisted');rpcCalls.push(name);try{return{data:await resultSql(rpcSignatures[name](args),'service_role'),error:null};}catch(cause){return{data:null,error:{code:cause.code||'XX000'}};}}};
async function api(method,route,body,cookie=adminCookie){const response=await fetch(`http://localhost:${port}/api${route}`,{method,headers:{Cookie:cookie||'','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
const {createHandler}=await import(pathToFileURL(ctpRoot+'/supabase/functions/manager-operations/protocol.mjs').href);
const {createPublicHandler}=await import(pathToFileURL(ctpRoot+'/supabase/functions/pro-view/protocol.mjs').href);
const publicHandler=createPublicHandler({read:extra=>{assert.ok(Number.isInteger(extra)&&extra>=0&&extra<=1800);return resultSql(`public.pro_view_public_state(${extra})`,'anon');}});
async function publicState(){const response=await publicHandler(new Request('http://localhost/functions/v1/pro-view'));const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;}
async function untilPublic(predicate,label,timeout=7000){const until=Date.now()+timeout;while(Date.now()<until){const data=await publicState();if(predicate(data.snapshot)){events.push({label,revision:data.snapshot?.revision,status:data.snapshot?.status});return data.snapshot;}await new Promise(resolve=>setTimeout(resolve,200));}throw new Error('Public condition timed out: '+label);}
async function configure(settings,{lostAck=false}={}){
 const state=await api('GET','/operations/pro-view',undefined,producerCookie);assert.equal(state.status,200,JSON.stringify(state.data));
 const prepared=await api('POST','/operations/pro-view/commands',{expected_version:state.data.revision,payload:settings},producerCookie);assert.equal(prepared.status,200,JSON.stringify(prepared.data));const command=prepared.data.command;
 const before=mutations.length;loseAck=lostAck;
 let response=await api('POST',`/operations/pro-view/commands/${command.id}/send`,{},producerCookie);
 if(lostAck){assert.equal(response.status,502);await api('GET','/operations/pro-view',undefined,producerCookie);loseAck=false;response=await api('POST',`/operations/pro-view/commands/${command.id}/send`,{},producerCookie);assert.equal(mutations.length,before+2);assert.equal(mutations.at(-1).commandId,mutations.at(-2).commandId);}
 assert.equal(response.status,200,JSON.stringify(response.data));assert.equal(response.data.confirmed,true);
 const next=await api('GET','/operations/pro-view',undefined,producerCookie);assert.equal(next.status,200,JSON.stringify(next.data));assert.equal(next.data.revision,state.data.revision+1);assert.equal(next.data.status,settings.status);
 return next.data;
}
let receipt;
try{
 const migration=await fs.readFile(ctpRoot+'/supabase/migrations/174_pro_view_delayed_publication.sql','utf8');
 const definitions=[...migration.matchAll(/^CREATE(?: OR REPLACE)? FUNCTION[\s\S]*?\$\$;/gm)].map(match=>match[0].replace(/^CREATE FUNCTION/,'CREATE OR REPLACE FUNCTION'));
 assert.ok(definitions.length>=10&&definitions.length<=15);await runSql('BEGIN;\n'+definitions.join('\n')+'\nCOMMIT;');
 const handler=createHandler({integrationToken:token,signingSecret:secret,database:adapter,enabled:true});
 bridge=http.createServer(async(request,response)=>{try{let raw='';for await(const chunk of request)raw+=chunk;const body=JSON.parse(raw);if(body.action==='pro_view_configure')mutations.push({commandId:body.commandId,actor:body.actor_id,settings:body.settings});const result=await handler(new Request('http://127.0.0.1/functions/v1/manager-operations',{method:'POST',headers:request.headers,body:raw}));if(loseAck&&body.action==='pro_view_configure'&&result.status===200){response.writeHead(503,{'Content-Type':'application/json'});response.end('{"ok":false}');return;}response.writeHead(result.status,Object.fromEntries(result.headers));response.end(Buffer.from(await result.arrayBuffer()));}catch{response.writeHead(500,{'Content-Type':'application/json'});response.end('{"ok":false}');}});
 await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve));const reserve=net.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
 manager=spawn(process.execPath,['--disable-warning=ExperimentalWarning','server/index.js'],{cwd:managerRoot,env:{...process.env,PORT:String(port),DATA_DIR:temporary,DB_PATH:'',PUBLIC_ORIGIN:'',OPEN_BROWSER:'0',CTP_AUTH_MODE:'local',CTP_WEB_ORIGIN:'http://localhost:5194',CTP_OPERATIONS_URL:`http://127.0.0.1:${bridge.address().port}/bridge`,CTP_OPERATIONS_TOKEN:token,CTP_SIGNING_SECRET:secret,CTP_ALLOW_LOCAL_WRITES:'true',CTP_ENABLE_WRITES:'true',CTP_SYNC_SECONDS:'0',OBS_ENABLE_CONTROL:'false'},windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';manager.stdout.on('data',part=>{output+=part;});manager.stderr.on('data',part=>{output+=part;});const limit=Date.now()+15000;while(!output.includes('funcionando')){if(manager.exitCode!==null||Date.now()>limit)throw new Error('Manager fixture startup failed');await new Promise(resolve=>setTimeout(resolve,30));}
 const admin=await api('POST','/auth/setup',{username:'pro-view-real-stack-admin',password:randomUUID()});assert.equal(admin.status,200);adminCookie=admin.cookie;
 const role=await api('POST','/roles',{name:'Pro View real SQL production',staff_kind:'production',sections:['realizacion']});assert.equal(role.status,201);
 const password=randomUUID();const user=await api('POST','/users',{username:'pro-view-real-stack-producer',password,role_ids:[role.data.id]});assert.equal(user.status,201);
 const login=await api('POST','/auth/login',{username:'pro-view-real-stack-producer',password},'');assert.equal(login.status,200);producerCookie=login.cookie;
 const bootstrap=await api('GET','/operations/bootstrap');producerActor=bootstrap.data.staff.find(item=>item.id===user.data.id).integration_actor_id;assert.match(producerActor,/^[0-9a-f-]{36}$/i);
 await runSql(`INSERT INTO public.manager_operator_bindings(manager_user_id,ctp_user_id,scopes,configured_by) VALUES(${quote(producerActor)},${quote(adminCtpId)}::uuid,ARRAY['broadcast.manage'],${quote(adminCtpId)}::uuid);`);
 const sync=await api('POST','/operations/integration/sync',{});assert.equal(sync.status,200,JSON.stringify(sync.data));assert.ok(sync.data.supported_actions.includes('pro_view.configure'));
 const initialProductionScore=await resultSql("(SELECT coalesce(live_score_a,0) FROM public.broadcast_rooms WHERE id='7c000000-0000-4000-8000-000000000900')");
 const nextProductionScore=initialProductionScore===0?1:0;
 const selected={channel:'playctp',delaySeconds:2,productionDelaySeconds:1,matchId,roomId,enabled:false,status:'standby'};
 await configure(selected);await untilPublic(snapshot=>snapshot?.status==='standby'&&snapshot.match===null,'configuration remains private in standby');
 await configure({...selected,enabled:true,status:'live'});
 const beforeLive=await publicState();assert.equal(beforeLive.snapshot.status,'standby','new live source cannot appear before server delay');
 const live=await untilPublic(snapshot=>snapshot?.status==='live'&&snapshot.match?.id===matchId,'published complete live programme');
 assert.equal(live.match.sideA.players.length+live.match.sideB.players.length,8);assert.equal(live.statistics.maps.length,2);assert.equal(live.statistics.players.length,8);assert.equal(live.competition.participants.length,17);assert.equal(live.competition.matches.length,43);assert.equal(new Set(live.competition.participants.map(item=>item.groupLabel)).size,4);assert.equal(live.production.liveScoreA,initialProductionScore);
 await configure({...selected,enabled:true,status:'paused'},{lostAck:true});const paused=await untilPublic(snapshot=>snapshot?.status==='paused','pause keeps coherent programme');
 const frozen=JSON.stringify({...paused,revision:0,sourceAt:'',visibleAt:'',status:''});
 const firstMap=paused.statistics.maps[0],firstPlayer=firstMap.players[0],participant=paused.competition.participants[0];
 await runSql(`BEGIN; SELECT set_config('ctp.manager_gateway','on',true); SELECT set_config('request.jwt.claim.sub',${quote(adminCtpId)},true); UPDATE public.broadcast_rooms SET live_score_a=${nextProductionScore} WHERE id=${quote(roomId)}::uuid; UPDATE public.tournaments SET name=name||' · resumed' WHERE id='7c000000-0000-4000-8000-000000000100'; UPDATE public.tournament_participants SET seed=coalesce(seed,0)+20 WHERE id=${quote(participant.id)}::uuid; UPDATE public.match_statistics SET players=jsonb_set(players,'{0,kills}',to_jsonb((players->0->>'kills')::int+4)) WHERE id=${quote(firstMap.id)}::uuid; COMMIT;`);
 const afterPause=await publicState();assert.equal(afterPause.snapshot.revision,paused.revision);assert.equal(JSON.stringify({...afterPause.snapshot,revision:0,sourceAt:'',visibleAt:'',status:''}),frozen,'every public panel remains frozen while private sources advance');
 await configure({...selected,enabled:true,status:'live'});const resumed=await untilPublic(snapshot=>snapshot?.status==='live'&&snapshot.production?.liveScoreA===nextProductionScore,'resume atomically refreshes all panels');
 assert.ok(resumed.match.tournamentName.endsWith(' · resumed'));assert.equal(resumed.statistics.maps.find(item=>item.id===firstMap.id).players.find(item=>item.user_id===firstPlayer.user_id).kills,firstPlayer.kills+4);assert.equal(resumed.competition.participants.find(item=>item.id===participant.id).seed,(participant.seed||0)+20);
 await configure({...selected,enabled:false,status:'ended'});await untilPublic(snapshot=>snapshot?.status==='ended'&&snapshot.match===null&&snapshot.statistics.maps.length===0&&snapshot.competition.matches.length===0,'end removes all public panels');
 const commands=await resultSql(`jsonb_build_object('commands',(SELECT count(*) FROM public.manager_operation_commands WHERE manager_user_id=${quote(producerActor)}),'nonces',(SELECT count(*) FROM public.manager_request_nonces))`);
 assert.equal(commands.commands,5,'lost ACK does not apply an extra configuration');
 receipt={ok:true,synthetic:true,remoteAccess:false,container,database:databaseName,managerMode:'local-isolated-staff',bridge:'real createHandler HMAC + real PostgreSQL nonce RPC',databaseAdapter:'explicit 4-RPC allowlist; role service_role; SQL literals escaped',publicEndpoint:'real createPublicHandler + SQL anon projection',migrationSha256:createHash('sha256').update(migration).digest('hex'),definitionsApplied:definitions.length,localStaffAccounts:2,rpcCalls:rpcCalls.length,nonceRpcCalls:rpcCalls.filter(name=>name==='manager_consume_request_nonce').length,configureRequests:mutations.length,appliedCommands:commands.commands,sourceDelaySeconds:2,events,coverage:{rosterPlayers:8,approvedMaps:2,playerStats:8,participants:17,competitionMatches:43,groups:4},latestSnapshot:await publicState()};
 await fs.mkdir(path.join(managerRoot,'output/pro-view-20261019'),{recursive:true});
 await fs.writeFile(path.join(managerRoot,'output/pro-view-20261019/manager-real-stack-receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({...receipt,latestSnapshot:undefined}));
} catch(cause){console.error(cause.stack);if(cause.stderr)console.error(cause.stderr);process.exitCode=1;}
finally{if(manager?.exitCode===null&&!manager.signalCode)await new Promise(resolve=>{manager.once('exit',resolve);manager.kill();});if(bridge?.listening)await new Promise(resolve=>bridge.close(resolve));assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
