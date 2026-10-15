import test from 'node:test';
import assert from 'node:assert/strict';
import {guardPayload,guardState} from '../server/guard-contract.js';
const mid='79000000-0000-4000-8000-000000000420',tid='79000000-0000-4000-8000-000000000400';
const valid=()=>({enabled:true,match_id:mid,tournament_id:tid,match_version:1,tournament_version:1,observed_at:new Date().toISOString(),ready:true,
 players:Array.from({length:8},(_,i)=>({user_id:`79000000-0000-4000-8000-${String(i+3).padStart(12,'0')}`,side:i<4?'a':'b',state:'ready',username:`QA${i}`,secret_hash:'never-expose'}))});
test('Guard ignores client readiness and requires eight unique players, four on each side',()=>{
 assert.equal(guardState(valid(),mid).ready,true);
 for(const adjust of [v=>v.players.pop(),v=>v.players[0].side='b',v=>v.players[2].state='signal_lost',v=>v.enabled=false]){const v=valid();adjust(v);assert.equal(guardState(v,mid).ready,false);}
 const duplicate=valid();duplicate.players[1].user_id=duplicate.players[0].user_id;assert.throws(()=>guardState(duplicate,mid));
 assert.equal(JSON.stringify(guardState(valid(),mid)).includes('secret_hash'),false);
});
test('Guard disallows arbitrary claims, camera enablement, foreign fields and missing audit reasons',()=>{
 assert.deepEqual(guardPayload('guard.start',{}),{});
 for(const p of [{ready:true},{actor_id:'admin'},{camera_required:true}])assert.throws(()=>guardPayload('guard.start',p));
 assert.throws(()=>guardPayload('guard.configure',{enabled:true,controller_required:true,capture_required:true,camera_required:true,reason:'Motivo suficientemente detallado'}));
 for(const reason of ['', 'short', 'x'.repeat(161)])assert.throws(()=>guardPayload('guard.exempt',{user_id:mid,approve:true,reason}));
 assert.throws(()=>guardPayload('guard.exempt',{user_id:'outside',approve:true,reason:'Consola comprobada por el árbitro'}));
 assert.throws(()=>guardState({...valid(),match_id:tid},mid));
});
