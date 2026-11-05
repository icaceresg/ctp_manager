import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-single-club-contract-'));
process.env.DATA_DIR=temporary;process.env.DB_PATH=path.join(temporary,'contract.db');
const {manualClubPayload}=await import('../server/manual-club-contract.js');
const {officialPayload}=await import('../server/integration.js');
const {canSendCommand}=await import('../client/src/operations/model.js');
const {db}=await import('../server/db.js');
after(()=>{db.close();assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5});});
const leader='20000000-0000-4000-8000-000000000001';
const valid={name:'QA Single Club',tag:'QAS',leader_id:leader,reason:'Alta revisada con una cuenta y un club'};

test('both preparation and official transport require a single competitive leader',()=>{
 assert.deepEqual(manualClubPayload('club.create',valid),valid);
 assert.deepEqual(officialPayload('club.create',valid),valid);
 for(const patch of [{leader_id:null},{leader_id:undefined},{administrator_id:leader},{administrator_id:null},{administrator_id:undefined},{members:[leader]},{role:'admin'}]){
  assert.throws(()=>manualClubPayload('club.create',{...valid,...patch}),{status:400});
  assert.throws(()=>officialPayload('club.create',{...valid,...patch}),{status:400});
  if (patch.leader_id === null || Object.hasOwn(patch,'leader_id') || Object.hasOwn(patch,'administrator_id')) assert.equal(canSendCommand({type:'club.create',status:'pending',payload:{...valid,...patch}},true,true),false);
 }
 assert.equal(canSendCommand({type:'club.create',status:'pending',payload:valid},true,true),true);
});

test('retired panels and directory are absent while normal creation remains translated',()=>{
 const page=fs.readFileSync(new URL('../client/src/pages/AdministrationPage.jsx',import.meta.url),'utf8');
 const form=fs.readFileSync(new URL('../client/src/operations/ManualClubCreatePanel.jsx',import.meta.url),'utf8');
 assert.doesNotMatch(page,/TeamAdministratorsDialog|TeamAdministratorDirectory|administeringClub/);
 assert.doesNotMatch(form,/\/administration\/team-administrators|setMode|administrativeMode|administrator_id:manager/);
 assert.match(form,/\/operations\/clubs\/candidates/);assert.match(form,/leader_id:manager.id/);
 const keys=[...new Set([...page.matchAll(/['"](manager\.clubCreate\.[\w.]+)['"]/g),...form.matchAll(/['"](manager\.clubCreate\.[\w.]+)['"]/g)].map(m=>m[1]))];
 const placeholders=text=>[...text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(m=>m[1]).sort();
 const en=JSON.parse(fs.readFileSync(new URL('../client/src/i18n/locales/en.json',import.meta.url),'utf8'));
 for(const lang of ['es','en','fr','de','it','pt']){
  const catalogue=JSON.parse(fs.readFileSync(new URL(`../client/src/i18n/locales/${lang}.json`,import.meta.url),'utf8'));
  for(const key of keys){assert.equal(typeof catalogue[key],'string',`${lang}:${key}`);assert.deepEqual(placeholders(catalogue[key]),placeholders(en[key]));}
  assert.equal(Object.keys(catalogue).some(k=>k.startsWith('manager.teamAdmins.')),false);
 }
});
