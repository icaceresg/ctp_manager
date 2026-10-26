import test, {after, before} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {createServer} from 'vite';
import {monitorFixture, monitorPeopleAndMapsFixture} from './fixtures/ranked-monitor.js';

let vite, views;
before(async()=>{
  // Compile the real JSX and render its table components. No browser, API or CTP
  // connection is created: all records are the local fixture above.
  vite=await createServer({server:{middlewareMode:true,watch:null,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
  views=await vite.ssrLoadModule('/src/pages/RankedMonitorPage.jsx');
});
after(async()=>{await vite?.close();});
const render=(view,props)=>renderToStaticMarkup(createElement(MemoryRouter,null,createElement(views[view],props)));
const bodyRows=html=>(html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1].match(/<tr/g)||[]).length;

test('played-map table renders confirmed matches and the historic pool, replacing skip percentages',()=>{
  const html=render('RankedMapPlays',{data:monitorPeopleAndMapsFixture(),me:{is_admin:true}});
  assert.equal(bodyRows(html),3);assert.match(html,/Mapas jugados/);assert.match(html,/Partidas confirmadas/);assert.match(html,/Últimas 24 horas/);
  assert.match(html,/<strong>Coal<\/strong>/);assert.match(html,/<td>10<\/td>/);assert.match(html,/Cachette/);assert.match(html,/Histórico/);
  assert.match(html,/No cuenta votos/);assert.doesNotMatch(html,/Tasa de salto|Mapas omitidos|Sorteado/);
});
test('an older CTP snapshot renders unavailable explanations, never a false empty queue or played-map zero',()=>{
  const data=monitorFixture(),maps=render('RankedMapPlays',{data}),players=render('RankedQueuePlayers',{data});
  assert.match(maps,/no está disponible/);assert.equal(bodyRows(maps),0);
  assert.match(players,/todavía no ofrece el detalle/);assert.doesNotMatch(players,/No hay personas buscando/);
});
test('queue table renders exact accounts, original waits, whole groups and safe player workspace links',()=>{
  const data=monitorPeopleAndMapsFixture(),html=render('RankedQueuePlayers',{data,me:{is_admin:true,auth_mode:'ctp',ctp_role:'admin',ctp_user_id:'90000000-0000-4000-8000-000000000001'}});
  assert.equal(bodyRows(html),3);assert.match(html,/SinNumeros/);assert.match(html,/50 s/);
  assert.equal((html.match(/Grupo 1 · 2 personas/g)||[]).length,2);
  assert.match(html,/\/jugadores\/30000000-0000-4000-8000-000000000001\?returnTo=%2Franked%2Fmonitor/);
  assert.equal((html.match(/Ver ficha ↗/g)||[]).length,3);
  assert.doesNotMatch(html,/administracion\/usuarios|Editar persona/);
});
test('queue selection filters rows without losing groups and referees keep a filtered return path without an account editor',()=>{
  const data=monitorPeopleAndMapsFixture(),queue2='10000000-0000-4000-8000-000000000002';
  data.queue_players[0].queue_id=queue2;data.queue_players[0].queue_title='Otra cola';
  const returnTo=`/ranked/monitor?tab=live&queue=${data.queues[0].id}&status=ready&mode=hp`;
  const html=render('RankedQueuePlayers',{data,queue:data.queues[0].id,returnTo,me:{is_admin:false,auth_mode:'ctp',ctp_role:'referee',ctp_user_id:'90000000-0000-4000-8000-000000000001'}});
  assert.equal(bodyRows(html),2);assert.doesNotMatch(html,/SinNumeros|Editar persona|administracion\/usuarios/);
  assert.equal((html.match(/Grupo 1 · 2 personas/g)||[]).length,2);
  assert.equal((html.match(/Ver ficha ↗/g)||[]).length,2);
  assert.match(html,new RegExp(`returnTo=${encodeURIComponent(returnTo)}`));
  const empty=render('RankedQueuePlayers',{data,queue:'no-selected-rows'});assert.match(empty,/No hay personas buscando/);
});

test('local arbitration sections or unrelated CTP staff never grant player workspace shortcuts',()=>{
  const data=monitorPeopleAndMapsFixture();
  for(const me of [{is_admin:false,sections:['arbitraje']},{is_admin:false,auth_mode:'ctp',ctp_role:'staff',ctp_user_id:'90000000-0000-4000-8000-000000000001',sections:['arbitraje']},{is_admin:true,auth_mode:'ctp',ctp_role:'admin'}]) {
    const html=render('RankedQueuePlayers',{data,me});
    assert.doesNotMatch(html,/Ver ficha|\/jugadores\/|administracion\/usuarios/);
  }
});
test('player and map names are escaped as content instead of interpreted as markup',()=>{
  const data=monitorPeopleAndMapsFixture();data.queue_players[0].username='<img src=x onerror=alert(1)>';data.map_plays[0].map_name='<script>bad()</script>';
  assert.doesNotMatch(render('RankedQueuePlayers',{data}),/<img src=x/);
  assert.match(render('RankedQueuePlayers',{data}),/&lt;img/);
  assert.doesNotMatch(render('RankedMapPlays',{data}),/<script>/);
});

test('long waiting players appear first and a partial list is not described as a broken queue',()=>{
  const data=monitorPeopleAndMapsFixture();
  data.queue_players[0].wait_seconds=12;data.queue_players[0].username='Recien llegado';
  data.queue_players[1].wait_seconds=180;data.queue_players[1].username='Espera antigua';
  data.queue_players[2].wait_seconds=420;data.queue_players[2].username='Mayor espera';
  const html=render('RankedQueuePlayers',{data});
  assert.ok(html.indexOf('Mayor espera')<html.indexOf('Espera antigua'));
  assert.ok(html.indexOf('Espera antigua')<html.indexOf('Recien llegado'));
  assert.match(html,/2 personas mostradas llevan 3 minutos o más/);
  assert.match(html,/7 min 0 s/);assert.match(html,/por sí sola no demuestra una avería/);
  assert.equal((html.match(/class="rm-long-wait"/g)||[]).length,2);
  assert.equal(data.queue_players[0].username,'Recien llegado');
});
