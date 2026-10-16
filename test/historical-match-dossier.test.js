import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-historical-dossier-'));
const matchId=randomUUID(),localId=randomUUID(),playerId=randomUUID();
const token='isolated-historical-token-0123456789',secret='isolated-historical-signature-0123456789';
let server,manager,port,adminCookie,refereeCookie,casterCookie,version=4,malformed=false,queries=0;
const snapshot={matches:[{id:localId,kind:'tournament',title:'Current match',version:1}],incidents:[],stats:[],clubs:[],deliveries:[],supported_actions:{'veto.staff_gate':true}};
async function api(method,route,body,cookie=adminCookie){
 const response=await fetch(`http://localhost:${port}/api${route}`,{method,headers:{Cookie:cookie||'','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
before(async()=>{
 server=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
  assert.equal(req.headers.authorization,`Bearer ${token}`);assert.ok(req.headers['x-ctp-signature']);
  let data=snapshot;
  if(body.action==='competition'){
   queries++;assert.equal(body.resource,'match');assert.equal(body.target_id,matchId);assert.ok(body.actor_id);
   data={match:{id:matchId,manager_version:version,result_status:'pending',tournament_id:randomUUID()},steps:[],pool:[],messages:[],reports:[],
    dossier:{id:malformed?localId:matchId,version,kind:'tournament',title:'Historical final',status:'pending',confirmed:false,
     team_a:{id:randomUUID(),name:'Club A'},team_b:{id:randomUUID(),name:'Club B'},
     roster:[{id:playerId,username:'Historical player',side:'a',email:'must-not-escape@example.invalid'}],statistics:[],maps:[],web_path:'/tournaments/history'}};
  }
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,data}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const reserved=net.createServer();await new Promise(resolve=>reserved.listen(0,'127.0.0.1',resolve));port=reserved.address().port;await new Promise(resolve=>reserved.close(resolve));
 manager=spawn(process.execPath,['--disable-warning=ExperimentalWarning','server/index.js'],{cwd:root,env:{...process.env,PORT:String(port),DATA_DIR:temporary,DB_PATH:'',PUBLIC_ORIGIN:'',OPEN_BROWSER:'0',CTP_AUTH_MODE:'local',CTP_OPERATIONS_URL:`http://127.0.0.1:${server.address().port}/bridge`,CTP_OPERATIONS_TOKEN:token,CTP_SIGNING_SECRET:secret,CTP_ENABLE_WRITES:'true',CTP_ALLOW_LOCAL_WRITES:'true',CTP_SYNC_SECONDS:'0',OBS_ENABLE_CONTROL:'false'},stdio:['ignore','pipe','pipe']});
 let output='';manager.stdout.on('data',chunk=>{output+=chunk;});manager.stderr.on('data',chunk=>{output+=chunk;});
 const until=Date.now()+10_000;while(!output.includes('funcionando')){if(manager.exitCode!==null||Date.now()>until)throw new Error(output||'Manager startup failed');await new Promise(resolve=>setTimeout(resolve,40));}
 const setup=await api('POST','/auth/setup',{username:'historical-admin',password:randomUUID()});assert.equal(setup.status,200);adminCookie=setup.cookie;
 for(const[name,staff_kind,section]of[['historical-referee','referee','arbitraje'],['historical-caster','caster','casters']]){
  const role=await api('POST','/roles',{name,staff_kind,sections:[section]});assert.equal(role.status,201,JSON.stringify(role.data));
  const password=randomUUID();assert.equal((await api('POST','/users',{username:name,password,role_ids:[role.data.id]})).status,201);
  const login=await api('POST','/auth/login',{username:name,password},'');assert.equal(login.status,200);
  if(staff_kind==='referee')refereeCookie=login.cookie;else casterCookie=login.cookie;
 }
 assert.equal((await api('POST','/operations/integration/sync',{})).status,200);
});
after(async()=>{
 if(manager?.exitCode===null&&!manager.signalCode)await new Promise(resolve=>{manager.once('exit',resolve);manager.kill();});
 if(server?.listening)await new Promise(resolve=>server.close(resolve));
 assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:100});
});

test('historic dossiers are referee-only, stay outside feed, preserve commands and reject invalid or stale replies',async()=>{
 assert.equal((await api('GET',`/operations/matches/${localId}`,undefined,casterCookie)).status,200,'casters retain current-feed access');
 assert.equal((await api('GET',`/operations/matches/${matchId}`,undefined,casterCookie)).status,404);
 assert.equal(queries,0,'caster lookup must not consult private historical data');
 const detail=await api('GET',`/operations/matches/${matchId}`,undefined,refereeCookie);
 assert.equal(detail.status,200,JSON.stringify(detail.data));assert.equal(detail.data.match.title,'Historical final');
 assert.equal(detail.data.match.roster[0].email,undefined,'public roster projection strips private fields');
 assert.equal(detail.data.match.in_feed,false);assert.equal(detail.data.match.source_version,4);
 const prepared=await api('POST','/operations/competition/commands',{type:'veto.staff_gate',target_id:matchId,expected_version:4,payload:{enabled:true,reason:'Historical match requires referee supervision'}},refereeCookie);
 assert.equal(prepared.status,200,JSON.stringify(prepared.data));const command=prepared.data.command;
 assert.equal((await api('GET',`/operations/matches/${matchId}`,undefined,refereeCookie)).status,200);
 let bootstrap=(await api('GET','/operations/bootstrap')).data;
 assert.ok(!bootstrap.matches.some(match=>match.id===matchId),'historical fetch must not widen agenda or caster feed');
 assert.equal(bootstrap.commands.find(row=>row.id===command.id).status,'pending');
 const count=queries;assert.equal((await api('GET',`/operations/matches/${matchId}`,undefined,casterCookie)).status,404);assert.equal(queries,count,'cached historical data must not open caster access');
 malformed=true;assert.equal((await api('GET',`/operations/matches/${matchId}`,undefined,refereeCookie)).status,502);malformed=false;
 version=3;assert.equal((await api('GET',`/operations/matches/${matchId}`,undefined,refereeCookie)).status,409,'stale official response must not overwrite newer cache');version=4;
 bootstrap=(await api('GET','/operations/bootstrap')).data;assert.equal(bootstrap.commands.find(row=>row.id===command.id).status,'pending');
 const conflict=await api('POST','/operations/competition/commands',{type:'veto.staff_gate',target_id:matchId,expected_version:4,payload:{enabled:false,reason:'A different conflicting request must remain blocked'}},refereeCookie);
 assert.equal(conflict.status,409,'dossier refresh must retain the per-resource pending-command lock');
 assert.equal((await api('GET',`/operations/matches/${matchId}`,undefined,refereeCookie)).status,200);
});
