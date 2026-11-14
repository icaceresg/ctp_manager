import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
let vite,Panel,Provider;
const originalDocument=globalThis.document;
const now=Date.parse('2026-11-14T13:00:00Z'),at=new Date(now).toISOString();
const fixture=()=>({enabled:true,ready:true,started_at:null,match_version:1,tournament_version:1,match_id:'79000000-0000-4000-8000-000000000420',tournament_id:'79000000-0000-4000-8000-000000000400',observed_at:at,lineup_pending:false,commands:[],events:[],
 players:Array.from({length:8},(_,index)=>({user_id:String(index),side:index<4?'a':'b',username:`Synthetic player ${index+1}`,state:'ready',last_seen_at:at}))});
before(async()=>{
 vite=await createServer({plugins:[{name:'synthetic-guard-state-only',enforce:'pre',resolveId(source){if(source==='./useGuardTournamentRead.js')return '\0guard-tournament-unit-state';},load(id){if(id==='\0guard-tournament-unit-state')return 'export const useGuardTournamentRead=()=>globalThis.__guardTournamentSyntheticRead;';}}],
  server:{middlewareMode:true,watch:null,hmr:false,ws:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
 ({GuardPanel:Panel}=await vite.ssrLoadModule('/src/operations/GuardPanel.jsx'));
 ({AppProvider:Provider}=await vite.ssrLoadModule('/src/context.jsx'));
});
after(async()=>{delete globalThis.__guardTournamentSyntheticRead;if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;await vite?.close();});
function render(state,locale='es',receivedAt=now){
 globalThis.document={documentElement:{lang:locale}};
 globalThis.__guardTournamentSyntheticRead={data:state,error:null,receivedAt,now,loading:false,refresh(){throw Error('SSR must never make a request');}};
 return renderToStaticMarkup(createElement(Provider,{me:{id:1,is_admin:true,sections:['arbitraje']}},createElement(Panel,{id:state.match_id})));
}
test('Guard tournament: the real panel renders readiness, next steps and no raw details in all six languages',()=>{
 for(const locale of ['es','en','it','fr','pt','de']){
  const dictionary=JSON.parse(fs.readFileSync(new URL(`../client/src/i18n/locales/${locale}.json`,import.meta.url),'utf8'));
  const html=render(fixture(),locale);
  assert(html.includes(dictionary['manager.guardTournament.title']));assert.match(html,/Synthetic player 8/);
  assert.doesNotMatch(html,/Unknown translation|undefined|NaN|Sin horario|RPC|include_events|secret|process_path/);
  assert.match(html,/<details class="op-guard-events">/);
 }
});
test('Guard tournament: stale source clears every green readiness state and blocks start in the actual rendered panel',()=>{
 const state=fixture();state.observed_at=new Date(now-20000).toISOString();
 const html=render(state);
 assert.match(html,/No se puede confirmar el estado actual/);
 assert.doesNotMatch(html,/class="op-guard-state ready"/);
 assert.match(html,/<button[^>]*disabled=""[^>]*>Autorizar inicio<\/button>/);
 const missing=fixture();missing.players[0].last_seen_at=new Date(now-20000).toISOString();
 assert.match(render(missing),/Señal perdida/);
});
test('Guard tournament: real UI shows reviewable reports without a clean-PC verdict or a fabricated zero',()=>{
 const state=fixture();Object.assign(state.players[0],{monitoring_current:true,review_required:true,observation:{process_inventory:'available',process_count:52,network_metadata:'unavailable',connection_count:null,rule_matches:1},security_observation:{release_integrity:'mismatch',process_file_identity:'partial',files_checked:4,rule_matches:1}});
 for(const locale of ['es','en','it','fr','pt','de']){
  const html=render(state,locale);assert.doesNotMatch(html,/Unknown translation|undefined|NaN|PRIVATE|fingerprint|detector_catalog/);
 }
 const html=render(state);assert.match(html,/Aviso para revisar/);assert.match(html,/Procesos: 52/);assert.match(html,/Conexiones: —/);assert.doesNotMatch(html,/PC limpio|Sin trampas|Conexiones: 0/);
 state.players[0].last_seen_at=new Date(now-15000).toISOString();const old=render(state);assert.match(old,/Informe anterior con aviso/);assert.doesNotMatch(old,/Procesos: 52/);
});
