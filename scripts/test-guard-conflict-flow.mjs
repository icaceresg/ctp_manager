import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const meta=JSON.parse(fs.readFileSync('output/signed-flow-local.json','utf8'));
if(!meta.synthetic||!/^ctp_manager_competition_qa_[0-9]+$/.test(meta.database)||!/^http:\/\/localhost:32\d\d$/.test(meta.url))throw new Error('Local QA only');
let cookie='';const api=async(method,path,body)=>{const r=await fetch(meta.url+'/api'+path,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return{status:r.status,data:await r.json()};};
const mid='79000000-0000-4000-8000-000000000520',path=`/operations/matches/${mid}/guard`;
assert.equal((await api('POST','/auth/login',{username:'qa_referee',password:'Qa-Only-2026!'})).status,200);
let s=(await api('GET',path)).data;
if(!s.enabled){
 const config=await api('POST',path+'/commands',{type:'guard.configure',target_id:s.tournament_id,expected_version:s.tournament_version,payload:{enabled:true,controller_required:true,capture_required:true,reason:'QA: activar Guard antes de probar decisiones concurrentes.'}});
 assert.equal(config.status,200,JSON.stringify(config.data));
 assert.equal((await api('POST',`/operations/guard/commands/${config.data.command.id}/send`,{})).status,200);
 s=(await api('GET',path)).data;
}
const prepared=await api('POST',path+'/commands',{type:'guard.exempt',target_id:mid,expected_version:s.match_version,payload:{user_id:'79000000-0000-4000-8000-000000000004',approve:true,reason:'QA: versión concurrente se debe rechazar sin aplicar la exención.'}});assert.equal(prepared.status,200);
const r=spawnSync('docker',['exec','-i','ctp-review-db-20261002','psql','-X','-U','postgres','-d',meta.database,'-v','ON_ERROR_STOP=1'],{input:`UPDATE public.tournament_matches SET guard_version=guard_version+1 WHERE id='${mid}';`,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);
assert.equal((await api('POST',`/operations/guard/commands/${prepared.data.command.id}/send`,{})).status,409);
s=(await api('GET',path)).data;const rejected=s.commands.find(c=>c.id===prepared.data.command.id);assert.equal(rejected.status,'rejected');assert.equal(rejected.result.rejected_confirmed,true);assert.equal(s.players.find(p=>p.user_id==='79000000-0000-4000-8000-000000000004').state,'guard_not_connected');
assert.equal((await api('POST',`/operations/commands/${rejected.id}/cancel`,{expected_updated_at:rejected.updated_at})).status,200);
const result={passed:true,stale_command_rejected:true,exemption_not_applied:true,explicit_discard:true,pre_changed:false};fs.writeFileSync('output/guard-conflict-flow.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
