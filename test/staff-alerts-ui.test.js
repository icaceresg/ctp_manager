import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {createServer} from 'vite';
import {staffAlertsAttempt,staffAlertPath,staffAlertError} from '../client/src/pages/staffAlertsModel.js';
const id='247abcde-0000-4000-8000-000000000001',other='247abcde-0000-4000-8000-000000000002';
const date='2026-10-27T12:00:00Z';
const snapshot=()=>({available:true,observed_at:date,version:1,providers:[{provider:'discord',enabled:false},{provider:'telegram',enabled:false}],counts:{pending:2,claimed:0,dispatching:0,sent:1,uncertain:1,failed:0,cancelled:0},recent:[{id,event_kind:'ticket.opened',resource_kind:'ticket',resource_id:other,link_id:other,created_at:date,provider:'discord',status:'uncertain',attempts:1,error_code:'delivery_uncertain'}]});
let vite,views;
before(async()=>{vite=await createServer({server:{middlewareMode:true,watch:null,hmr:false,ws:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});views=await vite.ssrLoadModule('/src/pages/StaffAlertsPanel.jsx');});
after(async()=>{await vite?.close();});
const render=value=>renderToStaticMarkup(createElement(MemoryRouter,null,createElement(views.StaffAlertsStatus,{snapshot:value})));

test('pending configuration retains the exact payload and nonce; edits require resolving the pending attempt',()=>{
 const input={version:1,enabled:{discord:true,telegram:false},reason:'Activar avisos para el staff'};let generated=0;
 const first=staffAlertsAttempt(null,input,()=>{generated++;return id;});
 assert.equal(staffAlertsAttempt(first,input,()=>{throw new Error('must not regenerate');}),first);assert.equal(generated,1);
 assert.equal(first.request_id,id);assert.equal(first.expected_version,1);
 for(const changed of [{...input,version:2},{...input,enabled:{discord:false,telegram:false}},{...input,reason:'Un cambio de motivo distinto'}])assert.throws(()=>staffAlertsAttempt(first,changed),/pendiente/);
 for(const invalid of [{...input,reason:'corto'},{...input,version:0},{...input,enabled:{discord:true}}])assert.throws(()=>staffAlertsAttempt(null,invalid));
});

test('alert navigation uses only internal canonical ticket or lobby identities and errors never render raw text',()=>{
 assert.equal(staffAlertPath({resource_kind:'ticket',link_id:id}),`/operaciones/incidencias?case=${id}&state=all`);
 assert.match(staffAlertPath({resource_kind:'ranked_dispute',link_id:id}),new RegExp('^/ranked/partidas/'+id));
 for(const row of [{resource_kind:'ticket',link_id:'https://private.invalid/#token'},{resource_kind:'other',link_id:id},{resource_kind:'ticket',link_id:id+'/other'}])assert.equal(staffAlertPath(row),null);
 assert.equal(staffAlertError('PRIVATE SQL token'),'Motivo no disponible');
});

test('status renders explicit unknown/loading states and never invents zero counters for unavailable data',()=>{
 assert.match(render(undefined),/Consultando avisos/);
 const unavailable=render({available:false,counts:{pending:0},recent:[]});assert.match(unavailable,/sin lectura/);assert.doesNotMatch(unavailable,/staff-alert-counts|No hay entregas recientes/);
 const html=render(snapshot());assert.match(html,/Discord/);assert.match(html,/Telegram/);assert.match(html,/Desactivado/);assert.match(html,/Inciertas/);
 assert.match(html,/no se reenvían automáticamente/);assert.match(html,/Comprobar|Comprueba/);assert.match(html,/Hasta 30 entregas/);assert.match(html,/Abrir ticket/);
 assert.doesNotMatch(html,/>Reintentar|>Enviar|PRIVATE|token|destination/);
});

test('the PRE canary is labelled as a test and links to integrations instead of a fictitious case',()=>{
 const row={id,event_kind:'staff.canary',resource_kind:'canary',resource_id:other,link_id:other,created_at:date,provider:'telegram',status:'sent',attempts:1,error_code:null};
 assert.equal(staffAlertPath(row),'/administracion/integraciones');
 assert.equal(staffAlertPath({...row,event_kind:'ticket.opened'}),null);
 assert.equal(staffAlertPath({...row,resource_kind:'ticket'}),null);
 assert.equal(staffAlertPath({...row,resource_id:id}),null);
 const html=render({...snapshot(),recent:[row]});
 assert.match(html,/PRE · prueba automática de avisos/);assert.match(html,/Ver integraciones/);
 assert.match(html,/href="\/administracion\/integraciones"/);
 assert.doesNotMatch(html,/Abrir partida|Abrir ticket|case=|ranked\/partidas/);
});

test('panel is administrator-only and offers configuration without provider secrets, test sends or retrying deliveries',()=>{
 const renderPanel=user=>renderToStaticMarkup(createElement(MemoryRouter,null,createElement(views.default,{user,snapshot:snapshot(),onSnapshot(){}})));
 assert.equal(renderPanel({id:2,is_admin:false}),'');
 const html=renderPanel({id:1,is_admin:true});assert.match(html,/Guardar configuración/);assert.match(html,/Motivo del cambio/);assert.match(html,/minLength="12"/i);assert.match(html,/maxLength="500"/i);
 assert.doesNotMatch(html,/type="password"|name="token"|Webhook|Bot token|>Enviar prueba|>Reintentar entrega/);
});
