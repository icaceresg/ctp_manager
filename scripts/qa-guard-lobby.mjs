// Additional untouched lobby for browser checks, in the isolated local fixture only.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const meta=JSON.parse(fs.readFileSync('output/signed-flow-local.json','utf8'));
if(!meta.synthetic||!/^ctp_manager_competition_qa_[0-9]+$/.test(meta.database))throw new Error('Local QA only');
const query=`BEGIN;
SELECT set_config('ctp.manager_gateway','on',true);
SELECT set_config('request.jwt.claim.sub','79000000-0000-4000-8000-000000000001',true);
INSERT INTO public.tournaments(id,name,game_mode,start_at,registration_close_at,participant_type,roster_min,roster_max,season,kind,status,has_group_stage,has_third_place_match)
 VALUES('79000000-0000-4000-8000-000000000500','QA · Lobby Guard para pruebas','4vs4',now()+interval '1 day',now()-interval '1 hour','equipo',4,4,1,'personalizado','en_curso',false,false) ON CONFLICT(id) DO NOTHING;
INSERT INTO public.tournament_participants(id,tournament_id,entrant_kind,entrant_id) VALUES
 ('79000000-0000-4000-8000-000000000511','79000000-0000-4000-8000-000000000500','team','79000000-0000-4000-8000-000000000401'),
 ('79000000-0000-4000-8000-000000000512','79000000-0000-4000-8000-000000000500','team','79000000-0000-4000-8000-000000000402') ON CONFLICT(id) DO NOTHING;
INSERT INTO public.tournament_roster(tournament_id,participant_id,user_id) SELECT
 '79000000-0000-4000-8000-000000000500',CASE WHEN i<7 THEN '79000000-0000-4000-8000-000000000511'::uuid ELSE '79000000-0000-4000-8000-000000000512'::uuid END,
 ('79000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid FROM generate_series(3,10)i ON CONFLICT DO NOTHING;
INSERT INTO public.tournament_matches(id,tournament_id,phase,round,position,best_of,entrant_a_kind,entrant_a_id,entrant_b_kind,entrant_b_id,scheduled_at)
 VALUES('79000000-0000-4000-8000-000000000520','79000000-0000-4000-8000-000000000500','eliminacion',1,1,3,'team','79000000-0000-4000-8000-000000000401','team','79000000-0000-4000-8000-000000000402',now()+interval '1 day') ON CONFLICT(id) DO NOTHING;
COMMIT;`;
const r=spawnSync('docker',['exec','-i','ctp-review-db-20261002','psql','-X','-U','postgres','-d',meta.database,'-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',windowsHide:true});if(r.status!==0)throw new Error(r.stderr);console.log('QA lobby ready; sync Manager before opening.');
if(!/^http:\/\/localhost:32\d\d$/.test(meta.url))throw new Error('Local Manager only');
const login=await fetch(`${meta.url}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'qa_manager',password:'Qa-Only-2026!'})});
if(!login.ok)throw new Error('QA login failed');
const sync=await fetch(`${meta.url}/api/operations/integration/sync`,{method:'POST',headers:{Cookie:login.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'},body:'{}'});
if(!sync.ok)throw new Error('QA sync failed');
