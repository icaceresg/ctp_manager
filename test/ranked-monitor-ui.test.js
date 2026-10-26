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
  vite=await createServer({server:{middlewareMode:true,watch:null},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
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
test('queue table renders exact accounts, original waits, whole groups and safe admin edit links',()=>{
  const data=monitorPeopleAndMapsFixture(),html=render('RankedQueuePlayers',{data,me:{is_admin:true,auth_mode:'ctp',ctp_role:'admin'}});
  assert.equal(bodyRows(html),3);assert.match(html,/SinNumeros/);assert.match(html,/50 s/);
  assert.equal((html.match(/Grupo 1 · 2 personas/g)||[]).length,2);
  assert.match(html,/\/administracion\/usuarios\?edit=30000000-0000-4000-8000-000000000001(?:&amp;|&#x26;)returnTo=%2Franked%2Fmonitor/);
  assert.equal((html.match(/Editar persona/g)||[]).length,3);
});
test('queue selection filters rows without losing groups and referees see no account editor',()=>{
  const data=monitorPeopleAndMapsFixture(),queue2='10000000-0000-4000-8000-000000000002';
  data.queue_players[0].queue_id=queue2;data.queue_players[0].queue_title='Otra cola';
  const html=render('RankedQueuePlayers',{data,queue:data.queues[0].id,me:{is_admin:false,auth_mode:'ctp',ctp_role:'referee'}});
  assert.equal(bodyRows(html),2);assert.doesNotMatch(html,/SinNumeros|Editar persona|administracion\/usuarios/);
  assert.equal((html.match(/Grupo 1 · 2 personas/g)||[]).length,2);
  const empty=render('RankedQueuePlayers',{data,queue:'no-selected-rows'});assert.match(empty,/No hay personas buscando/);
});
test('player and map names are escaped as content instead of interpreted as markup',()=>{
  const data=monitorPeopleAndMapsFixture();data.queue_players[0].username='<img src=x onerror=alert(1)>';data.map_plays[0].map_name='<script>bad()</script>';
  assert.doesNotMatch(render('RankedQueuePlayers',{data}),/<img src=x/);
  assert.match(render('RankedQueuePlayers',{data}),/&lt;img/);
  assert.doesNotMatch(render('RankedMapPlays',{data}),/<script>/);
});
