import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {createServer} from 'vite';

let vite,views,page,context;
before(async()=>{
  // Actual JSX, synthetic session props, SSR only: effects issue no requests.
  vite=await createServer({server:{middlewareMode:true,watch:null,hmr:false,ws:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
  views=await vite.ssrLoadModule('/src/operations/PcCheckPanel.jsx');
  page=await vite.ssrLoadModule('/src/pages/PcCheckPage.jsx');
  context=await vite.ssrLoadModule('/src/context.jsx');
});
after(async()=>{await vite?.close();});
const id='abcdefab-cdef-4abc-8def-abcdefabcdef';
const render=search=>renderToStaticMarkup(createElement(MemoryRouter,{initialEntries:['/pc-checks'+search]},createElement(views.PcCheckPanel,{me:{id:1,name:'Árbitro sintético'},can:section=>section==='arbitraje'})));

test('PC Check accepts one canonical CTP UUID from the player dossier and rejects malformed or duplicate filters',()=>{
  assert.deepEqual(views.pcCheckPlayerFilter(new URLSearchParams()),{userId:null,error:null});
  assert.deepEqual(views.pcCheckPlayerFilter(new URLSearchParams({user_id:id.toUpperCase()})),{userId:id,error:null});
  for(const search of ['user_id=', 'user_id=not-a-player',`user_id=${id}&user_id=${id}`,`user_id[]=${id}`]) {
    const filter=views.pcCheckPlayerFilter(new URLSearchParams(search));
    assert.equal(filter.userId,null);assert.match(filter.error,/No se han consultado otros expedientes/);
  }
});

test('a filtered PC Check list identifies its player, returns to the dossier and fixes the create identity to that player',()=>{
  const html=render('?user_id='+id.toUpperCase());
  assert.match(html,new RegExp(`href="/jugadores/${id}"`));
  const input=html.match(/<input[^>]*name="playerId"[^>]*>/)?.[0];
  assert.ok(input);assert.match(input,/readOnly=""/i);assert.match(input,new RegExp(`value="${id}"`));
  assert.match(html,/señales|hallazgos/i);assert.match(html,/no aplican sanciones/);
  assert.doesNotMatch(html,/accessToken|evidence_ciphertext/);
});

test('invalid player URLs remain explicit and never present a general list or creation form',()=>{
  const html=render('?user_id=invalid');
  assert.match(html,/role="alert"/);assert.match(html,/No se han consultado otros expedientes/);
  assert.doesNotMatch(html,/name="playerId"|Cargando expedientes|Sin expedientes disponibles/);
});

test('the dedicated route supplies the current staff context to the PC panel',()=>{
  for(const me of [{id:1,name:'Admin local',is_admin:true},{id:2,name:'Árbitro local',is_admin:false,sections:['arbitraje']}]){
    const html=renderToStaticMarkup(createElement(MemoryRouter,{initialEntries:['/pc-checks?user_id='+id]},
      createElement(context.AppProvider,{me},createElement(page.default))));
    assert.match(html,/Revisiones PC/);assert.match(html,/Crear expediente y asignación/);
    assert.match(html,new RegExp(`value="${id}"`));assert.ok(html.includes(me.name));
  }
});
