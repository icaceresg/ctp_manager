import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite, views;
before(async()=>{
  // Real JSX, fixture props, no API calls and no mutation of a real match.
  vite=await createServer({server:{middlewareMode:true,watch:null},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
  views=await vite.ssrLoadModule('/src/pages/RankedLobbyPage.jsx');
});
after(async()=>{await vite?.close();});
const lobby={id:'10000000-0000-4000-8000-000000000001',status:'disputed'};
const render=(name,props)=>renderToStaticMarkup(createElement(views[name],props));
test('each open dispute offers a local jump to its own arbitration section only when allowed',()=>{
  const disputes=[{username:'Jugador',side:'a',resolved:false,reason:'Resultado revisable',created_at:'2026-10-26T12:00:00Z'},
    {username:'Otro',side:'b',resolved:true,reason:'Ya resuelto',created_at:'2026-10-26T12:00:01Z'}];
  const html=render('RankedDisputes',{lobby,disputes,open:1,canDecide:true});
  assert.equal((html.match(/href="#ranked-decision"/g)||[]).length,1);
  assert.match(html,/Resultado revisable/);assert.match(html,/Resolver esta partida/);
  assert.doesNotMatch(render('RankedDisputes',{lobby,disputes,open:1,canDecide:false}),/href="#ranked-decision"/);
});
test('opening arbitration chooses no winner or cancellation and keeps its submit disabled',()=>{
  const html=render('RankedDecision',{lobby,players:[{side:'a',username:'Equipo de A'},{side:'b',username:'Equipo de B'}],onApplied:()=>assert.fail('must not apply during render')});
  assert.match(html,/id="ranked-decision"/);assert.match(html,/tabindex="-1"/);
  assert.doesNotMatch(html,/checked(?:=""|=|\s|>)/);
  assert.match(html,/<button[^>]*type="submit"[^>]*disabled=""[^>]*>Selecciona una decisión<\/button>/);
  assert.match(html,/Equipo de A/);assert.match(html,/Equipo de B/);
});
test('a pending map allows only a deliberate cancellation, and dispute content remains escaped',()=>{
  const html=render('RankedDecision',{lobby:{...lobby,status:'voting'},players:[],onApplied:()=>{}});
  assert.equal((html.match(/type="radio"[^>]*disabled=""/g)||[]).length,2);
  assert.doesNotMatch(html,/checked(?:=""|=|\s|>)/);
  const disputed=render('RankedDisputes',{lobby,disputes:[{username:'<script>x</script>',side:'b',reason:'<a href="javascript:x">bad</a>',created_at:'2026-10-26T12:00:00Z',resolved:false}],open:1,canDecide:true});
  assert.doesNotMatch(disputed,/<script>|href="javascript:/);assert.match(disputed,/&lt;script&gt;/);
});
