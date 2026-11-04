import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { teamAdminError,teamAdministratorIntent,teamAccessLabel,teamRegistrationStatus } from '../client/src/operations/teamAdministrators.js';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-team-admin-contract-'));
process.env.DATA_DIR=temporary;process.env.DB_PATH=path.join(temporary,'contract.db');
const {teamAdministratorPayload:payload,teamAdministratorResponse:response,teamAdministratorProblem}=await import('../server/team-administrator-contract.js');
const {db}=await import('../server/db.js');
after(()=>{db.close();assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5});});
const team='10000000-0000-4000-8000-000000000001',person='20000000-0000-4000-8000-000000000001',request='30000000-0000-4000-8000-000000000001';
const change={user_id:person,enabled:true,expected_version:0,request_id:request,reason:'Responsable de principal, academy y femenino'};

test('administrative assignment supports version zero with strict independent role input',()=>{
 assert.deepEqual(payload('set',team,change),{action:'set',team_id:team,...change});
 for(const patch of [{role:'admin'},{team_members:[person]},{enabled:'true'},{expected_version:-1},{expected_version:1.5},{request_id:'bad'},{user_id:'bad'},{reason:'short'},{captain_id:person}])assert.throws(()=>payload('set',team,{...change,...patch}),{status:400});
 assert.throws(()=>payload('set','arbitrary',change),{status:400});
 assert.deepEqual(payload('candidates',null,{query:'  qa manager  '}),{action:'candidates',query:'qa manager'});
 for(const body of [{query:'ab'},{query:'abc',email:true},{query:'x'.repeat(41)},{query:'abc\n'}])assert.throws(()=>payload('candidates',null,body),{status:400});
 assert.deepEqual(payload('overview',person),{action:'overview',user_id:person});
 assert.throws(()=>payload('get',team,{is_admin:true}),{status:400});
});
test('explicit conversion requires a version and request and cannot smuggle roster writes',()=>{
 const convert={...change,captain_id:null};delete convert.enabled;
 assert.deepEqual(payload('convert',team,convert),{action:'convert',team_id:team,...convert});
 assert.equal(payload('convert',team,{...convert,captain_id:request}).captain_id,request);
 for(const patch of [{captain_id:'invalid'},{enabled:true},{members:[]},{expected_version:undefined}])assert.throws(()=>payload('convert',team,{...convert,...patch}),{status:400});
});
test('all response DTOs remove private and unrecognized fields and reject unbound receipts',()=>{
 const personRow={user_id:person,username:'QA Manager',email:'hidden@example.invalid',token:'private'};
 assert.deepEqual(response({items:[personRow],secret:'private'},payload('candidates',null,{query:'manager'})),{items:[{user_id:person,username:'QA Manager'}]});
 const snapshot={team_id:team,version:0,items:[{...personRow,created_at:'2026-11-04T10:00:00Z'}],competitive_members:[{...personRow,role:'lider'}],env:'private'};
 assert.deepEqual(response(snapshot,payload('get',team)),{team_id:team,version:0,items:[{user_id:person,username:'QA Manager',created_at:'2026-11-04T10:00:00Z'}],competitive_members:[{user_id:person,username:'QA Manager',role:'lider'}]});
 const set=payload('set',team,change);
 assert.equal(response({...snapshot,request_id:request,changed:false},set).changed,false);
 for(const patch of [{team_id:person},{version:-1},{request_id:person},{changed:undefined},{items:[{...personRow,created_at:'bad'}]}])assert.throws(()=>response({...snapshot,request_id:request,changed:true,...patch},set),{status:502});
 const overview=response({user_id:person,username:'QA Manager',teams:[{team_id:team,name:'QA Principal',tag:'QAP',member_count:4,email:'hidden',entitlements:[{kind:'team_pass',season:1,receipt:'hidden'}],registrations:[{tournament_id:request,name:'QA inaugural',status:'inscripcion_abierta',roster_count:4,payment:'hidden'}]}]},payload('overview',person));
 assert.doesNotMatch(JSON.stringify(overview),/hidden|email|token|payment|receipt/);
 assert.equal(overview.teams[0].entitlements[0].kind,'team_pass');
 assert.throws(()=>response({user_id:team,username:'Wrong',teams:[]},payload('overview',person)),{status:502});
});
test('finite errors, all six languages and status labels never relay provider text',()=>{
 assert.equal(teamAdministratorProblem('teams.administration.conflict'),'manager.teamAdmins.conflict');
 assert.equal(teamAdministratorProblem('raw SQL private'),null);
 const source=fs.readFileSync(new URL('../client/src/operations/TeamAdministratorsPanel.jsx',import.meta.url),'utf8')+fs.readFileSync(new URL('../client/src/operations/ManualClubCreatePanel.jsx',import.meta.url),'utf8');
 const keys=[...source.matchAll(/['"](manager\.teamAdmins\.[\w.]+)['"]/g)].map(m=>m[1]);
 for(const lang of ['es','en','fr','de','it','pt']){
  const catalogue=JSON.parse(fs.readFileSync(new URL(`../client/src/i18n/locales/${lang}.json`,import.meta.url),'utf8'));
  for(const key of keys)assert.equal(typeof catalogue[key],'string',`${lang}:${key}`);
 }
 assert.match(teamAdminError({message:'manager.teamAdmins.captainRequired'}),/capitán/);
 assert.doesNotMatch(teamAdminError({message:'private upstream SQL and token'}),/private|SQL|token/);
 assert.match(teamAccessLabel({kind:'season_pass',season:2}),/temporada 2/);
 assert.match(teamRegistrationStatus('inscripcion_abierta'),/abierta/);
 assert.doesNotMatch(teamRegistrationStatus('private-status-token'),/private/);
 assert.equal(teamAdministratorIntent(0,person,true,change.reason,request).expected_version,0);
 assert.throws(()=>teamAdministratorIntent(0,person,true,'short',request),/reasonRequired/);
});
