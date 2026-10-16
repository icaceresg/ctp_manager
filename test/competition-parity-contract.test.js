import test,{after}from'node:test';
import assert from'node:assert/strict';
import fs from'node:fs';import os from'node:os';import path from'node:path';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-parity-contract-'));
process.env.DATA_DIR=temporary;process.env.DB_PATH=path.join(temporary,'contract.db');process.env.CTP_AUTH_MODE='local';
const{competitionPayload,COMPETITION_ACTIONS}=await import('../server/competition-contract.js');
const{db}=await import('../server/db.js');
const{tournamentPresentationPayload,shouldLeaveDeletedTournament}=await import('../client/src/operations/competitionForm.js');
after(()=>{db.close();assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5});});
const reason='Revisión independiente de competición';
test('all competition and referee commands have typed payloads and strip injected fields',()=>{
 const cases={
  'tournament.delete':{reason,confirm_name:'Copa CTP'},'tournament.unpublish':{reason,phase:'groups'},
  'tournament.withdraw':{reason},'tournament.points':{reason},'tournament.notify':{reason,text:'Nuevos horarios'},
  'tournament.schedule_rounds':{reason,first_match_at:'2027-01-12T17:00:00Z',minutes_per_round:60},
  'match.resolve':{reason,maps_a:3,maps_b:1},'match.revert':{reason},'veto.prepare':{reason},'veto.reset':{reason},'veto.start':{reason},'veto.staff_gate':{reason,enabled:true},
 };
 for(const[type,payload]of Object.entries(cases)){
  assert.ok(COMPETITION_ACTIONS.includes(type));const normalized=competitionPayload(type,{...payload,actor_id:'forged',secret:'private'});
  assert.equal(normalized.secret,undefined);assert.equal(normalized.actor_id,undefined);assert.equal(normalized.reason,reason);
  assert.throws(()=>competitionPayload(type,{...payload,reason:'short'}),{status:400});
 }
 assert.throws(()=>competitionPayload('match.resolve',{reason,maps_a:-1,maps_b:0}),{status:400});
 assert.throws(()=>competitionPayload('veto.staff_gate',{reason,enabled:'true'}),{status:400});
 assert.throws(()=>competitionPayload('tournament.schedule_rounds',{reason,first_match_at:'tomorrow',minutes_per_round:60}),{status:400});
});
test('extended tournament identity, translations, platforms, points and veto validate before transport',()=>{
 const input={banner:'CTP',image_url:'https://pre.playctp.com/cup.png',host_club_id:'12000000-0000-4000-8000-000000000001',description_i18n:{en:'Tournament',es:'Torneo'},registration_open_at:null,
  platforms:['PC','PlayStation'],region:'España',format:'eliminacion_simple',rules_pdf_url:'/rules/tournament.pdf',stream_url:null,contact_info:'Contacta con CTP',points_per_position:[{position:1,points:500,label:'Campeón'}],pick_ban_mode_rotation:['Hardpoint','Control','Hardpoint'],pick_ban_turn_seconds:20};
 const value=competitionPayload('tournament.update',input);assert.deepEqual(value,input);
 for(const field of['image_url','rules_pdf_url','stream_url'])for(const url of['javascript:alert(1)','https://user:pass@ctp.invalid/file','//other.example/file','/\\other.example/file'])assert.throws(()=>competitionPayload('tournament.update',{[field]:url}),{status:400});
 for(const invalid of[{host_club_id:'forged'},{description_i18n:{en:{html:'bad'}}},{platforms:['PC','PC']},{pick_ban_turn_seconds:4},{points_per_position:[{position:1,points:-5,label:'Bad'}]},{format:'unimplemented'}])assert.throws(()=>competitionPayload('tournament.update',invalid),{status:400});
});
test('live tournament edits contain presentation fields only and preserve all six translations',()=>{
 const input={name:'New display name',description:'Public description',rules:'Updated contact rules',image_url:'https://pre.playctp.com/new.png',host_club_id:'',contact_info:'Staff desk',description_es:'Español',description_en:'English',description_it:'Italiano',description_fr:'Français',description_pt:'Português',description_de:'Deutsch',
  start_at:'2027-01-01T00:00:00Z',max_participants:1,best_of_final:99,pick_ban_mode_rotation:['Forged'],points_per_position:[{position:1,points:999999,label:'Injected'}],platforms:['PC']};
 const payload=tournamentPresentationPayload(input);
 assert.deepEqual(Object.keys(payload.description_i18n),['es','en','it','fr','pt','de']);
 for(const field of['start_at','max_participants','best_of_final','pick_ban_mode_rotation','points_per_position','platforms'])assert.equal(payload[field],undefined);
 assert.equal(payload.host_club_id,null);assert.equal(payload.contact_info,'Staff desk');
 const validated=competitionPayload('tournament.update',payload);assert.equal(validated.name,input.name);
});
test('only a successfully sent deletion returns the currently selected tournament to the list',()=>{
 const command={type:'tournament.delete',target_id:'tournament-1'};
 assert.equal(shouldLeaveDeletedTournament(command,'send','tournament-1'),true);
 assert.equal(shouldLeaveDeletedTournament(command,'cancel','tournament-1'),false);
 assert.equal(shouldLeaveDeletedTournament(command,'send','tournament-2'),false);
 assert.equal(shouldLeaveDeletedTournament({...command,type:'tournament.update'},'send','tournament-1'),false);
});
