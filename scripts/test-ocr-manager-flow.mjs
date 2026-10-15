// Uses actual browser OCR output; controlled image ground truth stands in for
// human review. Never applies this correction logic to real player screenshots.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const meta=JSON.parse(fs.readFileSync('output/signed-flow-local.json','utf8'));
if(!meta.synthetic||!/^ctp_manager_competition_qa_[0-9]+$/.test(meta.database)||!/^http:\/\/localhost:32\d\d$/.test(meta.url))throw new Error('Only isolated local QA allowed');
const samples=JSON.parse(fs.readFileSync('output/ocr-validation.json','utf8'));
assert.equal(samples.length,4);assert.ok(samples.slice(0,3).every(s=>s.exact_players===8));
const sample=samples.find(s=>s.name==='database-720p'),payload=structuredClone(sample.payload);
assert.equal(payload.players.length,8);const corrections=[];
for(const [i,p]of payload.players.entries()){
 assert.equal(p.user_id,`79000000-0000-4000-8000-${String(i+3).padStart(12,'0')}`);
 const expected={score:1200+i*175,kills:18+i*2,deaths:8+i,assists:i,objective:70+i*13};
 for(const [field,value]of Object.entries(expected))if(p[field]!==value){corrections.push({user_id:p.user_id,field,ocr:p[field],reviewed:value});p[field]=value;}
}
assert.ok(corrections.length<=1,'Unexpected regression in the controlled image');
if(corrections.length)assert.ok(sample.uncertainWords.includes(String(corrections[0].ocr)),'Doubtful digit must be shown to reviewer');
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
const sql=query=>{const r=spawnSync('docker',['exec','-i','ctp-review-db-20261002','psql','-X','-qAt','-U','postgres','-d',meta.database,'-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim().split('\n').at(-1);};
const mid='79000000-0000-4000-8000-000000000420';
const stat=JSON.parse(sql(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','79000000-0000-4000-8000-000000000003',true); SELECT set_config('request.jwt.claim.role','authenticated',true); SELECT to_jsonb(public.submit_match_statistics('${mid}',2,${quote(payload.map_name)},${quote(payload.mode)},${quote(payload.objective_label)},${quote(JSON.stringify(payload.players))}::jsonb,0)); COMMIT;`));
let cookie='';const api=async(method,url,body)=>{const r=await fetch(`${meta.url}/api${url}`,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;};
await api('POST','/auth/login',{username:'qa_manager',password:'Qa-Only-2026!'});await api('POST','/operations/integration/sync',{});
const before=await api('GET',`/operations/competition?resource=statistics&target_id=${mid}`);
const pending=before.items.find(s=>s.map_number===2);assert.ok(pending);assert.equal(pending.status,'pending');assert.equal(pending.players.length,8);
const reviewed=await api('POST',`/operations/stats/${pending.id}/review`,{expected_source_version:pending.source_version,decision:'approve',reason:'QA: filas comparadas con la imagen de control y cifra dudosa corregida.'});
await api('POST',`/operations/integration/commands/${reviewed.command.id}/send`,{});await api('POST','/operations/integration/sync',{});
const after=await api('GET',`/operations/competition?resource=statistics&target_id=${mid}`),approved=after.items.find(s=>s.map_number===2);assert.equal(approved.status,'approved');
for(const p of payload.players){const actual=approved.players.find(r=>r.id===p.user_id||r.user_id===p.user_id);assert.ok(actual);for(const field of ['score','kills','deaths','assists','objective'])assert.equal(actual[field],p[field]);}
const dossier=await api('GET',`/operations/matches/${mid}`);assert.ok(dossier.statistics.some(s=>s.map_number===2));
const result={passed:true,source:'actual same-origin Tesseract browser OCR on controlled images',raw_exact_players:sample.exact_players,manual_review_simulated:true,corrections,stored_players:8,approved:true,manager_dossier:true,pre_changed:false};
fs.writeFileSync('output/ocr-manager-flow.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
