import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { guardTournamentView, guardTournamentReport, guardTournamentError, createGuardTournamentReader } from '../client/src/operations/guardTournamentModel.js';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-guard-tournament-unit-'));
process.env.DATA_DIR = directory; process.env.DB_PATH = path.join(directory, 'manager.db');
const { guardReadOptions,guardState } = await import('../server/guard-contract.js');
const operations = await import('../server/operations.js');
const { db } = await import('../server/db.js');
after(() => { db.close(); assert(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5 }); });
const matchId='79000000-0000-4000-8000-000000000420',tournamentId='79000000-0000-4000-8000-000000000400';
const now=Date.parse('2026-11-14T13:00:00Z'),at=new Date(now).toISOString();
const fixture = () => ({ enabled: true, ready: true, match_id:matchId, tournament_id:tournamentId, match_version:1,tournament_version:1,observed_at:at,started_at:null,
 players:Array.from({length:8},(_,index)=>({user_id:`79000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,side:index<4?'a':'b',username:`Synthetic ${index}`,state:'ready',last_seen_at:at})), events:[{id:'1',kind:'connected',created_at:at}] });
const settle = async () => { for(let index=0;index<8;index++)await Promise.resolve(); };
function fakeClock() {
 let value=100000,nextId=0; const timers=new Map();
 return { now:()=>value,schedule:(run,delay)=>{const id=++nextId;timers.set(id,{run,at:value+delay});return id;},cancel:id=>timers.delete(id),
  async advance(delta){const end=value+delta;for(;;){const item=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];if(!item||item[1].at>end)break;value=item[1].at;timers.delete(item[0]);item[1].run();await settle();}value=end;await settle();},
 };
}
function loopHarness(read) {
 const clock=fakeClock(),updates=[];let visible=true;
 const reader=createGuardTournamentReader({...clock,read,publish:value=>updates.push(value),visible:()=>visible});
 return{clock,reader,updates,hide(){visible=false;reader.visibilityChanged();},show(){visible=true;reader.visibilityChanged();}};
}

test('Guard tournament: source timestamps prevent old heartbeats from becoming ready after a new response',()=>{
 assert.equal(guardTournamentView(fixture(),now,now).canStart,true);
 for(const change of [s=>s.observed_at=new Date(now-15000).toISOString(),s=>s.observed_at=new Date(now+5001).toISOString(),s=>s.players[0].last_seen_at=null,s=>s.players[0].last_seen_at=new Date(now-15000).toISOString(),s=>s.players[0].last_seen_at=new Date(now+5001).toISOString(),s=>s.players[0].side='b',s=>s.players.pop()]){
  const state=fixture();change(state);assert.equal(guardTournamentView(state,now,now).canStart,false);
 }
 const old=fixture();old.players[0].last_seen_at=new Date(now-20000).toISOString();
 assert.equal(guardTournamentView(old,now,now).players[0].displayState,'signal_lost');
 assert.equal(guardTournamentView(fixture(),now-15000,now).fresh,false);
 assert.equal(guardTournamentView(fixture(),now,now,true).players.some(player=>player.ready),false);
 const consoleState=fixture();consoleState.players[0].state='console_verified';consoleState.players[0].last_seen_at=null;
 assert.equal(guardTournamentView(consoleState,now,now).canStart,true);
});

test('Guard tournament: compact reads are an exact optional query; commands keep their existing contract',()=>{
 assert.deepEqual(guardReadOptions({}),{includeEvents:true});assert.deepEqual(guardReadOptions({include_events:'false'}),{includeEvents:false});assert.deepEqual(guardReadOptions({include_events:'true'}),{includeEvents:true});
 for(const query of [{include_events:false},{include_events:['false']},{include_events:'0'},{rpc:'anything'},{include_events:'false',actor_id:'forged'}])assert.throws(()=>guardReadOptions(query),{status:400});
 assert.equal(guardTournamentError({status:403}),'forbidden');assert.equal(guardTournamentError({status:409}),'changed');assert.equal(guardTournamentError({code:'guard_timeout'}),'timeout');assert.equal(guardTournamentError(Error('PRIVATE SQL')),'unavailable');
});

test('Guard tournament: 160 PC players do not fan out Manager reads; only one selected match is queried',async()=>{
 let calls=0; const h=loopHarness(async()=>{calls++;return fixture();});h.reader.start();await h.clock.advance(0);
 const allPlayers=Array.from({length:20},fixture);assert.equal(allPlayers.reduce((sum,match)=>sum+match.players.length,0),160);
 for(const match of allPlayers)guardTournamentView(match,now,now);
 for(let index=0;index<20;index++)await h.reader.refresh();
 assert.equal(calls,1);await h.clock.advance(60000);assert.equal(calls,7);h.reader.stop();
});

test('Guard tournament: hidden views abort their request, reject late data, and make no background requests',async()=>{
 let resolve,signal,calls=0;const h=loopHarness(incoming=>{signal=incoming;calls++;return new Promise(done=>{resolve=done;});});
 h.reader.start();await h.clock.advance(0);assert.equal(calls,1);h.hide();assert.equal(signal.aborted,true);resolve({privateOldMatch:true});await settle();
 assert.equal(h.updates.some(update=>update.data),false);await h.clock.advance(120000);assert.equal(calls,1);
 h.show();await settle();assert.equal(calls,2);h.reader.stop();assert.equal(signal.aborted,true);
});

test('Guard tournament: request deadlines release the read loop even if a transport ignores cancellation',async()=>{
 const signals=[];const h=loopHarness(signal=>{signals.push(signal);return new Promise(()=>{});});
 h.reader.start();await h.clock.advance(12000);assert.equal(signals[0].aborted,true);assert(h.updates.some(update=>update.error?.code==='guard_timeout'));
 await h.clock.advance(10000);assert.equal(signals.length,2);h.reader.stop();
});

test('Guard tournament: a deliberate command refresh queues one follow-up without overlapping reads',async()=>{
 const resolvers=[];let calls=0;const h=loopHarness(()=>{calls++;return new Promise(done=>resolvers.push(done));});
 h.reader.start();await h.clock.advance(0);void h.reader.refresh(true);void h.reader.refresh(true);assert.equal(calls,1);
 resolvers.shift()(fixture());await settle();assert.equal(calls,2);h.reader.stop();resolvers.shift()(fixture());await settle();
 assert.equal(h.updates.filter(update=>update.data).length,1);
});

test('Guard tournament: unchanged reads write zero SQLite rows, keep CAS and omit sent-command history in compact responses',()=>{
 const state=fixture();operations.rememberGuardState(state);
 const records=()=>db.prepare("SELECT kind,version,data FROM operation_records WHERE kind IN ('guard_match','guard_tournament') ORDER BY kind").all();
 const before=records(),changes=db.prepare('SELECT total_changes() n').get().n;
 for(let index=0;index<100;index++)assert.deepEqual(operations.rememberGuardState({...state,observed_at:new Date(now+index).toISOString()},{compact:true}).events,[]);
 assert.equal(db.prepare('SELECT total_changes() n').get().n,changes);assert.deepEqual(records(),before);
 operations.rememberGuardState({...state,match_version:2});assert.equal(JSON.parse(records().find(row=>row.kind==='guard_match').data).source_version,2);
 assert.throws(()=>operations.rememberGuardState(state),{status:409});
 const userId=Number(db.prepare("INSERT INTO users(username,name,password_hash,is_admin,created_at) VALUES('guard-unit-admin','Synthetic admin','unused',1,?)").run(now).lastInsertRowid);
 const user={id:userId,is_admin:true,sections:['arbitraje']};operations.setIntegrationStatus({supported_actions:['guard.configure','guard.exempt','guard.start']});
 const current={...state,match_version:2};const command=operations.prepareGuardCommand(user,{type:'guard.start',target_id:matchId,expected_version:2,payload:{}},current).command;
 assert.equal(operations.rememberGuardState(current,{compact:true}).commands[0].id,command.id);
 assert.deepEqual(operations.rememberGuardState(current,{compact:true}).commands[0],operations.getCommand(command.id));
 db.prepare("UPDATE operation_commands SET status='acknowledged' WHERE id=?").run(command.id);
 assert.equal(operations.rememberGuardState(current,{compact:true}).commands.length,0);assert.equal(operations.rememberGuardState(current).commands.length,1);
 assert.throws(()=>operations.prepareGuardCommand(user,{type:'guard.start',target_id:matchId,expected_version:1,payload:{}},current),{status:409});
 assert.throws(()=>operations.prepareGuardCommand({id:userId,is_admin:false,sections:['casters']},{type:'guard.start',target_id:matchId,expected_version:2,payload:{}},current),{status:403});
});

test('Guard tournament: six catalogues have matching semantic keys, placeholders and clear text',()=>{
 const locales=['es','en','it','fr','pt','de'].map(locale=>JSON.parse(fs.readFileSync(new URL(`../client/src/i18n/locales/${locale}.json`,import.meta.url),'utf8')));
 const keys=Object.keys(locales[0]).filter(key=>key.startsWith('manager.guardTournament.'));assert.equal(keys.length,115);
 for(const locale of locales){assert.deepEqual(Object.keys(locale).filter(key=>key.startsWith('manager.guardTournament.')).sort(),[...keys].sort());for(const key of keys){assert.equal(typeof locale[key],'string');assert.doesNotMatch(locale[key],/\uFFFD|Ã.|Â./);assert.deepEqual(locale[key].match(/\{\w+\}/g)??[],locales[0][key].match(/\{\w+\}/g)??[]);}}
 const source=fs.readFileSync(new URL('../client/src/operations/GuardPanel.jsx',import.meta.url),'utf8');
 assert.doesNotMatch(source,/pending\.last_error|event\.detail|setInterval.*loadHistory|setInterval.*api\.get/);
});

test('Guard tournament: formal PC reports preserve unknowns, expire at source time and never expose device/process identities',()=>{
 const state=fixture();Object.assign(state.players[0],{monitoring_current:true,review_required:true,
  observation:{process_inventory:'available',network_metadata:'unavailable',integrity:'self_reported',process_count:52,connection_count:0,rule_matches:1,controller_source:'gameinput',pid:42,path:'PRIVATE_PATH'},
  security_observation:{release_integrity:'mismatch',process_file_identity:'partial',files_checked:4,rule_matches:1,detector_catalog_sha256:'PRIVATE_HASH',rule_ids:['PRIVATE_RULE'],hardware_fingerprint:'PRIVATE_HW',hardware_groups:['PRIVATE_GROUP']}});
 state.events.push({id:'2',kind:'signal_changed',detail:'PRIVATE_EVENT',created_at:at});
 const result=guardState(state,matchId),player=result.players[0];
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE|fingerprint|detector_catalog|controller_source|\bpid\b|\bpath\b|rule_ids|hardware/);
 const report=guardTournamentReport(player,true,now);assert.equal(report.processes,52);assert.equal(report.connections,null);assert.equal(report.review,true);assert.equal(report.integrity,'mismatch');
 for(const altered of [{...player,last_seen_at:new Date(now-15000).toISOString()},{...player,monitoring_current:false}]){
  const old=guardTournamentReport(altered,true,now);assert.equal(old.current,false);assert.equal(old.processes,null);assert.equal(old.review,null);assert.equal(old.priorReview,true);
 }
 state.players[0].observation.process_count=513;state.players[0].security_observation.files_checked=-1;
 const unknown=guardState(state,matchId);assert.equal(unknown.ready,true);assert.equal(unknown.players[0].observation.process_count,null);assert.equal(unknown.players[0].security_observation.files_checked,null);
});

test('Guard tournament: PRE Manager cannot point its signed operations bridge at PROD or a lookalike URL',async()=>{
 const {integrationConfig}=await import('../server/integration.js');
 const env={PUBLIC_ORIGIN:'https://pre.manager.playctp.com',CTP_OPERATIONS_URL:'https://pre.playctp.com/functions/v1/manager-operations',CTP_OPERATIONS_TOKEN:'synthetic-token-independent-01234567890123456789',CTP_SIGNING_SECRET:'synthetic-hmac-different-01234567890123456789'};
 assert.equal(integrationConfig(env).configured,true);
 for(const destination of ['https://playctp.com/functions/v1/manager-operations','https://pre.playctp.com.evil.example/functions/v1/manager-operations','https://pre.playctp.com/functions/v1/ctp-guard','http://localhost:58080/functions/v1/manager-operations','https://pre.playctp.com/functions/v1/manager-operations/'])assert.throws(()=>integrationConfig({...env,CTP_OPERATIONS_URL:destination}));
});
