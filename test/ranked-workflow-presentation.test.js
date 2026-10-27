import test,{before,after}from'node:test';
import assert from'node:assert/strict';
import {createElement}from'react';
import {renderToStaticMarkup}from'react-dom/server';
import {MemoryRouter}from'react-router-dom';
import {createServer}from'vite';
import {safeRankedClipUrl,rankedPhaseLabel,rankedHistoryPath}from'../shared/ranked-lobby-presentation.js';

// Render actual JSX with explicit synthetic props. No app/CTP request is made.
let vite,lobbyViews,historyViews,administrationViews;
before(async()=>{
 vite=await createServer({server:{middlewareMode:true,watch:null,hmr:false,ws:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
 [lobbyViews,historyViews,administrationViews]=await Promise.all([
  vite.ssrLoadModule('/src/pages/RankedLobbyPage.jsx'),
  vite.ssrLoadModule('/src/operations/HistoryPanel.jsx'),
  vite.ssrLoadModule('/src/pages/AdministrationPage.jsx'),
 ]);
});
after(async()=>{await vite?.close();});
const id='10000000-0000-4000-8000-000000000001';
const render=(view,props)=>renderToStaticMarkup(createElement(MemoryRouter,null,createElement(view,props)));

test('phase copy distinguishes current mode/map voting and already assigned historical selections',()=>{
 assert.equal(rankedPhaseLabel({status:'voting',mode_pending:true,map_name:null}),'Votando modo');
 assert.equal(rankedPhaseLabel({status:'voting',mode_pending:false,map_name:null}),'Votando mapa');
 assert.equal(rankedPhaseLabel({status:'voting',map_name:'Cachette'}),'Selección de mapa');
 assert.equal(rankedPhaseLabel({status:'ready',mode_pending:false,map_name:'Coal'}),'Lista para jugar');
 assert.equal(rankedPhaseLabel({status:'closed',map_name:'Lithium'}),'Finalizada');
});

test('the map panel explains pending ballots and preserves old skipped-map evidence',()=>{
 const mode=render(lobbyViews.RankedMapHistory,{lobby:{status:'voting',mode_pending:true,map_name:null},draws:[]});
 assert.match(mode,/después de la votación de modo/);assert.doesNotMatch(mode,/se ha sorteado|Omitido/);
 const map=render(lobbyViews.RankedMapHistory,{lobby:{status:'voting',mode_pending:false,map_name:null},draws:[]});
 assert.match(map,/votación de mapa todavía no ha terminado/);
 const old=render(lobbyViews.RankedMapHistory,{lobby:{status:'ready',map_name:'Coal'},draws:[
  {revision:1,map_name:'Cachette',drawn_at:'2026-10-23T12:00:00Z',skipped_at:'2026-10-23T12:01:00Z'},
  {revision:2,map_name:'Coal',drawn_at:'2026-10-23T12:02:00Z',skipped_at:null},
 ]});
 assert.match(old,/Selección de mapa/);assert.match(old,/Cachette/);assert.match(old,/Omitido · sistema anterior/);assert.match(old,/Coal/);assert.match(old,/Asignado/);
});

test('a dispute displays a safe external clip without embedding or interpreting submitted content',()=>{
 const dispute={username:'<img src=x>',side:'a',reason:'<script>evidence</script>',created_at:'2026-10-26T12:00:00Z',resolved:false,clip_url:'https://video.example.invalid/clip?id=123'};
 const props={lobby:{id,status:'disputed'},disputes:[dispute],open:1,canDecide:true};
 const html=render(lobbyViews.RankedDisputes,props);
 assert.match(html,/href="https:\/\/video\.example\.invalid\/clip\?id=123"/);
 assert.match(html,/target="_blank" rel="noopener noreferrer"/);assert.match(html,/Ver clip de la disputa/);
 assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<iframe|<video|<script>|<img src=x/);
 const legacy=render(lobbyViews.RankedDisputes,{...props,disputes:[{...dispute,clip_url:null}]});
 assert.match(legacy,/no tiene un clip disponible/);assert.doesNotMatch(legacy,/video\.example/);
 for(const clip_url of ['javascript:alert(1)','https://user:secret@example.invalid/clip','https://example.invalid/clip\r\nnext']){
  const blocked=render(lobbyViews.RankedDisputes,{...props,disputes:[{...dispute,clip_url}]});
  assert.doesNotMatch(blocked,/href="(?:javascript:|https:\/\/user:)|secret|clip\r/);
 }
 assert.equal(safeRankedClipUrl('https://example.invalid/clip'),'https://example.invalid/clip');
});

test('a historical Ranked match opens its full Manager detail rather than tournament statistics',()=>{
 const item={id,kind:'match',detail:{id,competition_kind:'ranked'},web_path:'/8s?lobby='+id};
 assert.equal(rankedHistoryPath(item),'/ranked/partidas/'+id);
 const html=render(historyViews.HistoryDetails,{item,origin:'http://localhost:58080',review:true,ranked:true});
 assert.match(html,new RegExp(`href="/ranked/partidas/${id}"`));assert.match(html,/Ver partida Ranked/);
 assert.doesNotMatch(html,/operaciones\/estadisticas|Revisiones de estadísticas/);
 const noRanked=render(historyViews.HistoryDetails,{item,origin:'http://localhost:58080',review:true,ranked:false});
 assert.doesNotMatch(noRanked,/href="\/ranked\/partidas\//);assert.match(noRanked,/Consultar en CTP/);
 assert.equal(rankedHistoryPath({...item,id:'not-a-lobby'}),null);
});

test('tournament and statistics history keep their legitimate review links; challenges do not enter that workflow',()=>{
 const tournament=render(historyViews.HistoryDetails,{item:{id,kind:'match',detail:{tournament_id:'other-tournament'}},review:true});
 assert.match(tournament,new RegExp(`href="/operaciones/estadisticas\\?match=${id}"`));
 const statistics=render(historyViews.HistoryDetails,{item:{id:'revision',kind:'stats',detail:{match_id:id}},review:true});
 assert.match(statistics,new RegExp(`href="/operaciones/estadisticas\\?match=${id}"`));
 const challenge=render(historyViews.HistoryDetails,{item:{id,kind:'match',detail:{competition_kind:'challenge'}},review:true});
 assert.doesNotMatch(challenge,/Revisiones de estadísticas|ranked\/partidas/);
});

test('administrative Ranked lists link to full arbitration and never present an immediate winner/cancel form',()=>{
 for(const status of ['voting','ready','disputed','closed','cancelled']){
  const html=render(administrationViews.RankedAdministrationLink,{row:{id,status}});
  assert.match(html,new RegExp(`href="/ranked/partidas/${id}"`));
  assert.match(html,['closed','cancelled'].includes(status)?/Consultar partida/:/Abrir partida y resolver/);
  assert.doesNotMatch(html,/<button|<select|Registrar ganador|Cancelar partida/);
 }
});
