import test, {after, before} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {createServer} from 'vite';

let vite, tickets, incidents, AppProvider;
const ticketId='10000000-0000-4000-8000-000000000001';
const authorId='20000000-0000-4000-8000-000000000002';
const staffId='30000000-0000-4000-8000-000000000003';
const matchId='40000000-0000-4000-8000-000000000004';
const me={id:1,ctp_user_id:staffId,is_admin:false,auth_mode:'ctp',ctp_role:'referee',sections:['arbitraje']};
const returnTo=`/operaciones/incidencias?bucket=mine&case=${ticketId}`;
const noop=()=>{};
const thread=()=>({
  viewer_id:staffId,can_change_status:true,
  ticket:{id:ticketId,status:'abierto',author:{id:authorId,username:'Autor exacto',activision_id:'IDSinNumeros'},assigned:{id:'50000000-0000-4000-8000-000000000005',username:'Otro árbitro'},proof_url:'https://proof.example.test/clip?a=1&b=2'},
  messages:[{id:'message-1',author_name:'Jugador',body:'<img src=x onerror=alert(1)>',created_at:'2026-10-26T10:00:00Z',is_staff:false}],events:[],
});
before(async()=>{
  // Compile and render the actual JSX against synthetic records only. Effects
  // never run in SSR: no HTTP requests, staff session or player action occurs.
  vite=await createServer({server:{middlewareMode:true,watch:null,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
  tickets=await vite.ssrLoadModule('/src/operations/TicketChat.jsx');
  incidents=await vite.ssrLoadModule('/src/operations/ReviewPanels.jsx');
  ({AppProvider}=await vite.ssrLoadModule('/src/context.jsx'));
});
after(async()=>{await vite?.close();});
const renderThread=(value,operator=me)=>renderToStaticMarkup(createElement(MemoryRouter,null,createElement(tickets.TicketThreadView,{thread:value,me:operator,returnTo,busy:false,error:'',text:'',onReload:noop,onAction:noop,onSend:noop,onTextChange:noop})));
const renderIncident=record=>{
  const data={incidents:[record],matches:[],staff:[],commands:[],connection:{configured:false}};
  return renderToStaticMarkup(createElement(MemoryRouter,{initialEntries:[returnTo]},createElement(AppProvider,{me,onLogout:noop,onMeChange:noop},createElement(incidents.IncidentsPanel,{data,me,mutate:noop,reload:noop}))));
};

test('ticket proof opens explicitly with isolated navigation and no remote embedding',()=>{
  const html=renderThread(thread());
  assert.match(html,/<a[^>]+href="https:\/\/proof\.example\.test\/clip\?a=1&amp;b=2"[^>]+target="_blank"[^>]+rel="noopener noreferrer nofollow ugc"/);
  assert.match(html,/Ver prueba adjunta/);
  assert.doesNotMatch(html,/<iframe|<video|<img|<embed|<object/);
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
  for(const proof_url of [null,'javascript:alert(1)','https://user:pass@proof.example.test/clip','//proof.example.test/clip','https://proof.example.test/\nclip']) {
    const value=thread();value.ticket.proof_url=proof_url;
    assert.doesNotMatch(renderThread(value),/Ver prueba adjunta|href="(?:javascript:|\/\/proof)/);
  }
});

test('referees reach only the canonical ticket author and keep the case return context',()=>{
  const html=renderThread(thread());
  assert.match(html,new RegExp(`href="/jugadores/${authorId}\\?returnTo=%2Foperaciones%2Fincidencias%3Fbucket%3Dmine%26case%3D${ticketId}"`));
  assert.match(html,/Ver ficha de Autor exacto/);
  assert.match(html,/Responsable/);
  assert.match(html,/<strong>Otro árbitro<\/strong>/);
  assert.match(html,/Hacerme cargo/);
  assert.doesNotMatch(html,/administracion\/usuarios/);
  const other=renderThread(thread(),{id:2,is_admin:false,auth_mode:'ctp',ctp_role:'staff',ctp_user_id:staffId,sections:['arbitraje']});
  assert.doesNotMatch(other,/Ver ficha de|\/jugadores\//);
  const malformed=thread();malformed.ticket.author.id='javascript:alert(1)';
  assert.doesNotMatch(renderThread(malformed),/Ver ficha de|\/jugadores\//);
});

test('official tickets expose their own assignment and internal priority instead of a second local assume control',()=>{
  const html=renderIncident({id:ticketId,source:'ctp',kind:'support',title:'Cambio de Activision',status:'open',priority:'normal',created_at:'2026-10-26T10:00:00Z',reporter_name:'Autor exacto',assigned_name:'Otro árbitro',version:1});
  assert.doesNotMatch(html,/Asumir caso/);
  assert.match(html,/Prioridad interna/);
  assert.match(html,/Chat con el jugador/);
  assert.match(html,/Añadir nota/);
});

test('Ranked disputes keep one result decision destination while internal and tournament cases retain their controls',()=>{
  const base={id:ticketId,title:'Disputa',status:'open',priority:'normal',created_at:'2026-10-26T10:00:00Z',version:1,match_id:matchId};
  const ranked=renderIncident({...base,source:'ctp',kind:'ranked'});
  assert.match(ranked,/Abrir partida y resolver/);
  assert.match(ranked,new RegExp(`/ranked/partidas/${matchId}\\?focus=decision`));
  assert.doesNotMatch(ranked,/Preparar resolución/);
  assert.match(ranked,/Añadir nota/);
  const internal=renderIncident({...base,source:'manager',kind:'internal'});
  assert.match(internal,/Asumir caso/);
  assert.match(internal,/Preparar resolución/);
  assert.doesNotMatch(internal,/Abrir partida y resolver/);
  const tournament=renderIncident({...base,source:'ctp',kind:'tournament'});
  assert.match(tournament,/Preparar resolución/);
  assert.doesNotMatch(tournament,/Abrir partida y resolver/);
  assert.match(tournament,/Partido vinculado/);
  assert.match(tournament,new RegExp(`href="/operaciones/partidos/${matchId}"`));
  const unlinked=renderIncident({...base,source:'ctp',kind:'support',match_id:null,reason:`https://playctp.com/es/ranked?lobby=${matchId}`});
  assert.doesNotMatch(unlinked,/Partido vinculado|href="\/operaciones\/partidos\//);
});
