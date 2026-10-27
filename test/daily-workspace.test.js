import test, {after, before} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {createServer} from 'vite';
import {monitorFixture} from './fixtures/ranked-monitor.js';

let vite, summaryViews, StaffDesk;
before(async()=>{
  // Actual JSX, synthetic snapshots, SSR only: no effect, API request or real
  // user session is involved in this local UI acceptance evidence.
  vite=await createServer({server:{middlewareMode:true,watch:null,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
  summaryViews=await vite.ssrLoadModule('/src/operations/RankedWorkSummary.jsx');
  ({StaffDesk}=await vite.ssrLoadModule('/src/operations/StaffDesk.jsx'));
});
after(async()=>{await vite?.close();});
const render=(Component,props)=>renderToStaticMarkup(createElement(MemoryRouter,null,createElement(Component,props)));
const renderSummary=props=>render(summaryViews.RankedWorkSummaryView,{onReload:()=>{},...props});
const staffId='90000000-0000-4000-8000-000000000001';

test('daily summary uses full counters and a bounded set of actionable official disputes',()=>{
  const data=monitorFixture();
  data.summary={...data.summary,waiting_players:200,active_lobbies:40};
  data.lobby_statuses=[{status:'disputed',count:12},{status:'ready',count:28}];
  data.truncated.active_lobbies=true;
  data.active_lobbies=Array.from({length:8},(_,index)=>({...data.active_lobbies[0],id:`20000000-0000-4000-8000-00000000000${index+1}`,status:index===0?'ready':'disputed',open_disputes:1,queue_title:'Cola de prueba'}));
  const value=summaryViews.rankedWorkSummary(data);
  assert.equal(value.waiting,200);assert.equal(value.active,40);assert.equal(value.review,12);assert.equal(value.longest,70);assert.equal(value.partial,true);
  assert.equal(value.cases.length,8,'an open dispute remains actionable even before its lobby status changes');
  const html=renderSummary({data});
  assert.match(html,/200 buscando/);assert.match(html,/40 partidas activas/);assert.match(html,/12 en revisión/);
  assert.match(html,/Listado parcial/);assert.match(html,/contadores incluyen el conjunto completo/);
  assert.match(html,/href="\/ranked\/monitor\?tab=review"/);
  assert.equal((html.match(/Revisar partida /g)||[]).length,5);
  assert.match(html,/href="\/ranked\/partidas\/20000000-0000-4000-8000-000000000001\?focus=decision&amp;returnTo=%2Foperaciones%2Fjornada"/);
  assert.doesNotMatch(html,/Enviar decisión|Adjudicar|Cancelar partida/);
});

test('unavailable snapshots render no invented zero and failures keep an explicitly labelled previous reading',()=>{
  assert.equal(summaryViews.rankedWorkSummary(null),null);
  const unavailable=renderSummary({data:null,error:'Lectura no disponible'});
  assert.match(unavailable,/role="alert"/);assert.match(unavailable,/no está disponible/);
  assert.doesNotMatch(unavailable,/0 buscando|0 partidas|0 en revisión/);
  const pending=renderSummary({data:null,busy:true});assert.match(pending,/Consultando Ranked/);
  const cached=renderSummary({data:monitorFixture(),error:'No se pudo actualizar'});
  assert.match(cached,/Se conserva la última lectura/);assert.match(cached,/6 buscando/);
  const empty=monitorFixture();empty.summary.waiting_players=0;empty.queues[0].wait_max_seconds=999;
  assert.equal(summaryViews.rankedWorkSummary(empty).longest,null,'an old maximum cannot become a current queue wait after the last player leaves');
});

test('the daily desk shows Ranked only to current game staff and keeps non-game duties visible',()=>{
  const data={matches:[],incidents:[],stats:[],clubs:[],deliveries:[],assignments:[],sanctions:[],commands:[],audit:[]};
  const operators=[
    {id:1,is_admin:true,auth_mode:'ctp',ctp_role:'admin',ctp_user_id:staffId,sections:[]},
    {id:2,is_admin:false,auth_mode:'ctp',ctp_role:'referee',ctp_user_id:staffId,sections:['arbitraje']},
  ];
  for(const me of operators){
    const html=render(StaffDesk,{data,me,can:section=>me.is_admin||me.sections.includes(section)});
    assert.match(html,/Ranked ahora/);assert.match(html,/Abrir Ranked/);assert.match(html,/Qué hacer ahora/);
    assert.doesNotMatch(html,/0 buscando|0 partidas activas/);
  }
  for(const me of [
    {id:3,is_admin:false,auth_mode:'ctp',ctp_role:'staff',ctp_user_id:staffId,sections:['casters']},
    {id:4,is_admin:false,sections:['arbitraje']},
  ]){
    const html=render(StaffDesk,{data,me,can:section=>me.sections.includes(section)});
    assert.doesNotMatch(html,/Ranked ahora|Abrir Ranked|\/ranked\/monitor/);
    assert.match(html,/Qué hacer ahora/);assert.match(html,/Agenda de partidos/);
  }
});
