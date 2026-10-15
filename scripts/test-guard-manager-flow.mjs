// Real HTTP protocols -> isolated PostgreSQL. Synthetic players, not physical devices.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const meta=JSON.parse(fs.readFileSync('output/signed-flow-local.json','utf8'));
if(!meta.synthetic||!/^ctp_manager_competition_qa_[0-9]+$/.test(meta.database)||!/^http:\/\/127\.0\.0\.1:\d+\/functions\/v1\/ctp-guard$/.test(meta.guardEndpoint))throw new Error('Only isolated local QA allowed');
const sql=query=>{const r=spawnSync('docker',['exec','-i','ctp-review-db-20261002','psql','-X','-qAt','-U','postgres','-d',meta.database,'-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim().split('\n').at(-1);};
const mid='79000000-0000-4000-8000-000000000420',tid='79000000-0000-4000-8000-000000000400',uid=i=>`79000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
const api=()=>{let cookie='';return async(method,url,body)=>{const r=await fetch(`${meta.url}/api${url}`,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return{status:r.status,data:await r.json()};};};
const admin=api(),referee=api(),production=api(),anon=api();const checks=[];
const pass=name=>{checks.push(name);console.log(`PASS ${name}`);};
const ok=async(p,status=200)=>{const r=await p;assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
const state=(who=referee)=>ok(who('GET',`/operations/matches/${mid}/guard`));
const prepare=async(type,payload={},who=referee)=>{const s=await state(who);return ok(who('POST',`/operations/matches/${mid}/guard/commands`,{type,target_id:type==='guard.configure'?tid:mid,expected_version:type==='guard.configure'?s.tournament_version:s.match_version,payload}));};
const send=(c,who=referee)=>ok(who('POST',`/operations/guard/commands/${c.id}/send`,{}));
const native=async(body,headers={})=>{const r=await fetch(meta.guardEndpoint,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});return{status:r.status,data:await r.json()};};
try{
 for(const [who,username]of [[admin,'qa_manager'],[referee,'qa_referee'],[production,'qa_production']])await ok(who('POST','/auth/login',{username,password:'Qa-Only-2026!'}));
 await ok(admin('POST','/operations/integration/sync',{}));
 await ok(anon('GET',`/operations/matches/${mid}/guard`),401);
 await ok(production('GET',`/operations/matches/${mid}/guard`),403);
 let s=await state();assert.equal(s.enabled,false);
 const actor=(await ok(admin('GET','/operations/bootstrap'))).staff.find(p=>p.username==='qa_referee').integration_actor_id;
 sql(`UPDATE public.manager_operator_bindings SET enabled=false WHERE manager_user_id='${actor}';`);
 await ok(referee('GET',`/operations/matches/${mid}/guard`),502);
 sql(`UPDATE public.manager_operator_bindings SET enabled=true WHERE manager_user_id='${actor}';`);
 pass('sesión, rol y vínculo CTP activo son obligatorios');
 const config=await prepare('guard.configure',{enabled:true,controller_required:true,capture_required:true,reason:'QA: mandos y capturas obligatorios para todos los PC.'});
 await ok(production('POST',`/operations/guard/commands/${config.command.id}/send`,{}),403);
 await send(config.command);s=await state();assert.equal(s.enabled,true);assert.equal(s.players.length,8);assert.equal(s.ready,false);
 await ok(referee('POST',`/operations/matches/${mid}/guard/commands`,{type:'guard.start',target_id:mid,expected_version:s.match_version,payload:{}}),409);
 pass('árbitro configura Guard; ocho PC ausentes impiden iniciar');
 const sessions=[];
 for(let i=3;i<=10;i++){
  const pair=JSON.parse(sql(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${uid(i)}',true); SELECT set_config('request.jwt.claim.role','authenticated',true); SELECT public.guard_issue_pair('${mid}'); COMMIT;`));
  const secret=randomBytes(32).toString('hex');const claim={action:'claim',code:pair.code,secret,installationId:randomUUID(),clientVersion:'qa-1.0'};
  await ok(native(claim,{Origin:'http://localhost:3229'}),403);
  const result=await ok(native(claim));assert.equal(result.matchId,mid);
  await ok(native(claim),409);
  sessions.push({user_id:uid(i),sessionId:result.sessionId,secret,sequence:0});
 }
 const pulse=(x,flags={})=>native({action:'heartbeat',sessionId:x.sessionId,secret:x.secret,sequence:++x.sequence,controllerConnected:true,cameraReady:false,captureReady:true,...flags});
 const pulseAll=async()=>{for(const x of sessions)await ok(pulse(x));};
 await pulseAll();s=await state();assert.equal(s.ready,true);
 assert.equal(JSON.stringify(s).includes(sessions[0].secret),false);
 await ok(native({action:'heartbeat',sessionId:sessions[0].sessionId,secret:randomBytes(32).toString('hex'),sequence:100,controllerConnected:true,cameraReady:false,captureReady:true}),409);
 await ok(native({action:'heartbeat',sessionId:sessions[0].sessionId,secret:sessions[0].secret,sequence:sessions[0].sequence,controllerConnected:true,cameraReady:false,captureReady:true}),409);
 pass('ocho códigos de un uso, secretos privados y secuencia anti-repetición');
 sql(`UPDATE public.guard_sessions SET last_seen_at=now()-interval '16 seconds' WHERE id='${sessions[0].sessionId}';`);
 s=await state();assert.equal(s.ready,false);assert.equal(s.players.find(p=>p.user_id===sessions[0].user_id).state,'signal_lost');
 await pulseAll();await ok(pulse(sessions[0],{controllerConnected:false,reason:'controller_disconnected'}));
 s=await state();assert.equal(s.ready,false);assert.equal(s.players.find(p=>p.user_id===sessions[0].user_id).reason,'controller_disconnected');
 await ok(pulse(sessions[0],{captureReady:false,reason:'capture_unavailable'}));assert.equal((await state()).ready,false);
 await pulseAll();assert.equal((await state()).ready,true);
 pass('caducidad, pérdida de mando y captura bloquean; reconexión recupera');
 const exempt=await prepare('guard.exempt',{user_id:sessions[0].user_id,approve:true,reason:'QA: plataforma consola verificada por el árbitro.'});await send(exempt.command);
 s=await state();assert.equal(s.players.find(p=>p.user_id===sessions[0].user_id).state,'console_verified');
 const revoke=await prepare('guard.exempt',{user_id:sessions[0].user_id,approve:false,reason:'QA: se corrige la plataforma y se exige Guard.'});await send(revoke.command);
 await pulseAll();assert.equal((await state()).players.find(p=>p.user_id===sessions[0].user_id).state,'ready');
 pass('consolas verificadas y revocadas con rastro de auditoría');
 let start=await prepare('guard.start');await ok(pulse(sessions[0],{controllerConnected:false,reason:'controller_disconnected'}));
 const denied=await referee('POST',`/operations/guard/commands/${start.command.id}/send`,{});assert.equal(denied.status,502);
 assert.equal(sql(`SELECT count(*) FROM public.guard_match_starts WHERE match_id='${mid}';`),'0');
 // A certified first-attempt denial cannot be replayed as a different decision.
 // Recover through the same explicit discard and fresh proposal shown in the UI.
 const rejected=(await state()).commands.find(command=>command.id===start.command.id);
 assert.equal(rejected.status,'rejected');assert.equal(rejected.result.rejected_confirmed,true);
 await ok(referee('POST',`/operations/guard/commands/${start.command.id}/send`,{}),409);
 await ok(referee('POST',`/operations/commands/${rejected.id}/cancel`,{expected_updated_at:rejected.updated_at}));
 await pulseAll();start=await prepare('guard.start');await pulseAll();await send(start.command);s=await state();assert.ok(s.started_at);
 await ok(referee('POST',`/operations/guard/commands/${start.command.id}/send`,{}),409);
 assert.equal(sql(`SELECT count(*) FROM public.guard_match_starts WHERE match_id='${mid}';`),'1');
 // The durable receipt survives a lost Manager ACK, even after the official version advanced.
 const replay=JSON.parse(sql(`BEGIN; SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claim.role','service_role',true); SELECT public.manager_guard_command('${actor}','${start.command.id}','guard.start','${mid}',${start.command.expected_version},'{}'); COMMIT;`));assert.equal(replay.command_id,start.command.id);
 pass('desconexión bloquea en servidor; rechazo descartado explícitamente y propuesta nueva registran un solo inicio idempotente');
 await ok(referee('POST',`/operations/matches/${mid}/guard/commands`,{type:'guard.exempt',target_id:mid,expected_version:s.match_version,payload:{user_id:sessions[1].user_id,approve:true,reason:'QA cambio posterior al inicio prohibido.'}}),409);
 pass('no se alteran exenciones después de empezar');
 const result={date:new Date().toISOString(),database:meta.database,checks,passed:true,physical_device_tested:false,pre_changed:false};fs.writeFileSync('output/guard-manager-flow.json',JSON.stringify(result,null,2));
}catch(e){fs.writeFileSync('output/guard-manager-flow.json',JSON.stringify({date:new Date().toISOString(),database:meta.database,checks,passed:false,error:e.message,physical_device_tested:false,pre_changed:false},null,2));console.error(e);process.exitCode=1;}
