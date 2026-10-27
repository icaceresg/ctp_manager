import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {createServer} from 'vite';
import {createGlobalSearch,globalSearchContext,globalSearchInitial,globalSearchKey,globalSearchPlan,globalSearchProjection} from '../client/src/globalSearch.js';

const id='abcdefab-cdef-4abc-8def-abcdefabcdef';
const otherId='abcdefab-cdef-4abc-8def-abcdefabcdea';
const referee={id:1,auth_mode:'ctp',ctp_user_id:id,ctp_role:'referee',is_admin:false};
const context=globalSearchContext(referee,section=>section==='arbitraje');
const people=query=>({operation:'search',query,items:[{id,username:'Jugador fixture',gamertag:null,activision_id:'Fixture#1'}]});
const tickets={incidents:[{id:'case-fixture',title:'Ticket fixture',status:'open',source:'ctp'}]};
const pending=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};

test('global search calls no remote source for a short query or grants inferred from a local section alone',async()=>{
  const calls=[];const engine=createGlobalSearch(async url=>{calls.push(url);return{};});
  await engine.run(context,'a',()=>{}).done;assert.equal(calls.length,0);
  const localStaff=globalSearchContext({id:2,sections:['arbitraje']},()=>true);
  assert.equal(localStaff.players,false);assert.equal(localStaff.tickets,true);
  assert.deepEqual(globalSearchPlan(localStaff,'player').sources.map(source=>source.kind),['tickets']);
  const none=globalSearchContext({id:3,auth_mode:'ctp',ctp_role:'player'},()=>false);
  await engine.run(none,'player',()=>{}).done;assert.equal(calls.length,0);
  const state=globalSearchInitial(none,'player');assert.equal(state.players.status,'forbidden');assert.equal(state.tickets.status,'forbidden');
});

test('only an exact Ranked UUID triggers a confirmed lobby read; names and injected query text stay encoded',()=>{
  const query='A&B?limit=100 <script>';
  const plan=globalSearchPlan(context,query);
  assert.deepEqual(plan.sources.map(source=>source.kind),['players','tickets']);
  for(const source of plan.sources){
    const url=new URL(source.url,'http://dev.invalid');
    assert.equal(url.origin,'http://dev.invalid');assert.equal(url.searchParams.get('limit'),'5');
    assert.equal(url.searchParams.get(source.kind==='players'?'query':'q'),query);
  }
  const lookup=globalSearchPlan(context,id.toUpperCase());
  assert.equal(lookup.sources.at(-1).url,'/operations/ranked/lobbies/'+id);
  assert.equal(globalSearchPlan(context,id+'/extra').sources.some(source=>source.kind==='lobby'),false);
  assert.equal(globalSearchPlan(context,'x'.repeat(121)).sources.length,0);
  assert.match(globalSearchInitial(context,'bad\nquery').error,/sin controles/);
});

test('only known result fields become labels and all operational destinations are canonical internal links',()=>{
  const players=globalSearchProjection('players',{...people('fixture'),items:[{id:id.toUpperCase(),username:'<script>alert(1)</script>',gamertag:'Fixture',activision_id:null,href:'javascript:evil',email:'should-not-cross'}]},'fixture');
  assert.equal(players[0].to,'/jugadores/'+id);assert.equal(players[0].href,undefined);assert.equal(JSON.stringify(players).includes('should-not-cross'),false);
  const ticket=globalSearchProjection('tickets',{incidents:[{id:'//evil.invalid/?x=1&case=other',title:'Imported fixture',status:'open',source:'ctp',href:'https://evil.invalid'}]},'fixture')[0];
  assert.equal(ticket.type,'Ticket CTP · copia sincronizada');
  const url=new URL(ticket.to,'http://dev.invalid');assert.equal(url.origin,'http://dev.invalid');assert.equal(url.pathname,'/operaciones/incidencias');assert.equal(url.searchParams.get('case'),'//evil.invalid/?x=1&case=other');
  const lobby=globalSearchProjection('lobby',{lobby:{id,status:'voting',mode_pending:true,map_name:null},href:'https://evil.invalid'},id)[0];
  assert.equal(lobby.to,'/ranked/partidas/'+id);assert.equal(lobby.detail,'Votando modo');
  assert.throws(()=>globalSearchProjection('lobby',{lobby:{id:otherId,status:'ready',map_name:'Coal'}},id));
  assert.throws(()=>globalSearchProjection('players',people('another-query'),'fixture'));
  assert.throws(()=>globalSearchProjection('players',{operation:'search',query:'fixture',items:Array(6).fill(people('fixture').items[0])},'fixture'));
});

test('empty results, permission errors and an unavailable source remain different states',async()=>{
  let state;
  const engine=createGlobalSearch(async url=>{
    if(url.startsWith('/players'))return {operation:'search',query:'fixture',items:[]};
    throw Object.assign(new Error('raw private upstream details'),{status:403});
  });
  await engine.run(context,'fixture',next=>state=next).done;
  assert.equal(state.players.status,'ready');assert.deepEqual(state.players.items,[]);assert.equal(state.tickets.status,'forbidden');
  const failing=createGlobalSearch(async url=>url.startsWith('/players')?people('fixture'):Promise.reject(new Error('raw private upstream details')));
  await failing.run(context,'fixture',next=>state=next).done;
  assert.equal(state.players.items.length,1);assert.equal(state.tickets.status,'error');assert.equal(JSON.stringify(state).includes('raw private'),false);
  const notFound=createGlobalSearch(async url=>{if(url.startsWith('/operations/ranked/lobbies/'))throw Object.assign(new Error('missing'),{status:404});return url.startsWith('/players')?{operation:'search',query:id,items:[]}:tickets;});
  await notFound.run(context,id,next=>state=next).done;assert.equal(state.lobby.status,'ready');assert.deepEqual(state.lobby.items,[]);
});

test('actor changes and later queries abort old transport and ignore responses even if abort is disregarded',async()=>{
  const calls=[],states=[],engine=createGlobalSearch((url,options)=>{const d=pending();calls.push({url,...options,...d});return d.promise;});
  const first=engine.run(context,'old',next=>states.push(next));
  const changed=globalSearchContext({...referee,id:2,ctp_user_id:otherId},section=>section==='arbitraje');
  const second=engine.run(changed,'new',next=>states.push(next));
  assert.equal(calls[0].signal.aborted,true);assert.notEqual(globalSearchKey(context,'old'),globalSearchKey(changed,'new'));
  calls[2].resolve(people('new'));calls[3].resolve(tickets);await second.done;
  const count=states.length;
  calls[0].resolve(people('old'));calls[1].reject(new Error('stale failure'));await first.done;
  assert.equal(states.length,count);assert.equal(states.at(-1).query,'new');assert.equal(states.at(-1).players.items.length,1);
  const third=engine.run(changed,'latest',next=>states.push(next));third.cancel();
  assert.equal(calls[4].signal.aborted,true);const cancelledCount=states.length;
  calls[4].resolve(people('latest'));calls[5].resolve(tickets);await third.done;assert.equal(states.length,cancelledCount);
});

let vite,views;
before(async()=>{
  // Actual JSX with synthetic projected results; SSR runs no effects or HTTP.
  vite=await createServer({server:{middlewareMode:true,watch:null,hmr:false,ws:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
  views=await vite.ssrLoadModule('/src/components/QuickNavigation.jsx');
});
after(async()=>{await vite?.close();});
const render=state=>renderToStaticMarkup(createElement(MemoryRouter,null,createElement(views.QuickSearchGroup,{title:'Jugadores',state})));

test('search result JSX escapes supplied text and visually distinguishes empty, error and restricted states',()=>{
  const items=globalSearchProjection('players',{operation:'search',query:'fixture',items:[{id,username:'<img src=x onerror=evil>',gamertag:null,activision_id:null}]},'fixture');
  const html=render({status:'ready',items});assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|onerror="evil"/);assert.match(html,new RegExp('href="/jugadores/'+id+'"'));
  assert.match(render({status:'ready',items:[]}),/Sin coincidencias/);
  assert.match(render({status:'error',items:[]}),/role="alert"/);assert.doesNotMatch(render({status:'error',items:[]}),/Sin coincidencias/);
  assert.match(render({status:'forbidden',items:[]}),/no tiene permiso/);assert.doesNotMatch(render({status:'forbidden',items:[]}),/Sin coincidencias/);
});
