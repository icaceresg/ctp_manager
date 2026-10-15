import test from 'node:test';
import assert from 'node:assert/strict';
import { rankedPayload, rankedState } from '../server/ranked-contract.js';
import { manualClubPayload } from '../server/manual-club-contract.js';
const id='e1240000-0000-4000-8000-000000000001';
const season={name:'SEASON 2',starts_at:'2026-12-01T10:00:00Z',ends_at:'2027-01-01T10:00:00Z',reason:'Siguiente season oficial del circuito'};
test('Ranked schedule keeps the fixed soft-reset policy server-owned',()=>{
 assert.equal(rankedPayload('ranked.season.schedule',season).starts_at,'2026-12-01T10:00:00.000Z');
 for(const payload of [{...season,reset_divisions:0},{...season,actor:'admin'},{...season,ends_at:season.starts_at},{...season,reason:'short'},{...season,name:''}])assert.throws(()=>rankedPayload('ranked.season.schedule',payload));
 const view=rankedState({current:{id,name:'SEASON 1',manager_version:1,starts_at:season.starts_at,secret:'not-for-browser'},scheduled:null,active_matches:2,waiting_players:4,reset_divisions:2,observed_at:season.starts_at});
 assert.equal('secret'in view.current,false);assert.equal(view.reset_divisions,2);
 assert.throws(()=>rankedState({...view,reset_divisions:0}));
 assert.deepEqual(rankedPayload('ranked.season.cancel',{reason:season.reason}),{reason:season.reason});
 assert.throws(()=>rankedPayload('ranked.season.cancel',{reason:season.reason,name:'Not allowed'}));
 assert.equal(rankedPayload('ranked.season.update',season).name,'SEASON 2');
});
test('manual club creation permits no entitlement, money, verification or new account payload',()=>{
 const payload={name:'QA Club',tag:'QAC',leader_id:id,reason:'Alta externa revisada por administración'};
 assert.deepEqual(manualClubPayload('club.create',payload),payload);
 for(const change of [{verified:true},{pass_active:true},{email:'create@invalid.test'},{points:100},{name:'x'.repeat(25)},{tag:'bad tag'},{leader_id:'arbitrary'},{reason:'short'}])assert.throws(()=>manualClubPayload('club.create',{...payload,...change}));
});
