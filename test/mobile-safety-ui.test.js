import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {createServer} from 'vite';

let vite,views;
before(async()=>{vite=await createServer({server:{middlewareMode:true,watch:null,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});views=await vite.ssrLoadModule('/src/pages/AdministrationSafetyPage.jsx');});
after(async()=>{await vite?.close();});
const render=(component,props)=>renderToStaticMarkup(createElement(MemoryRouter,null,createElement(component,props)));
const noop=()=>{};
const baseJob=()=>({job_id:'123',ticket_id:'ticket-fixture',state:'blocked_policy',phase:'external',version:3,retryable:false,blocked_reasons:['external_evidence_policy_required'],request:{username:'Player fixture',requested_at:'2026-10-27T08:00:00Z'},progress:{database_sanitized:true,auth_closed:true,storage_verified:true,external_verified:false,confirmation_state:null}});
test('UGC report evidence is escaped and every decision has an editable bounded reason',()=>{
  const html=render(views.ModerationReportView,{report:{id:'report-fixture',target_username:'Player fixture',ticket_id:'ticket-fixture',ticket_code:'CTP-123',context:'message',reason:'abuse',status:'pending',details:'Synthetic report',evidence:{message:'<img src=x onerror=alert(1)>'}},reason:'',busy:false,locked:false,onReason:noop,onAction:noop});
  assert.equal(html.includes('<img src=x'),false);assert.ok(html.includes('&lt;img src=x'));assert.ok(html.includes('maxLength="500"'));assert.ok(html.includes('Retirar mensaje'));assert.ok(html.includes('Archivar reporte'));assert.ok(html.includes('Ticket CTP-123'));
});
test('blocked or awaiting-confirmation erasure never looks completed or exposes a clear checkbox',()=>{
  const blocked=render(views.ErasureJobView,{job:baseJob(),typed:'',busy:false,onTyped:noop,onAction:noop});
  assert.ok(blocked.includes('Requiere decisión de conservación'));assert.ok(blocked.includes('decisión documentada'));assert.ok(blocked.includes('Comprobar Manager y PC Check'));assert.equal(blocked.includes('Completada el'),false);assert.equal(blocked.includes('type="checkbox"'),false);
  const pending=baseJob();Object.assign(pending,{state:'awaiting_confirmation',phase:'confirmation',blocked_reasons:[],progress:{...pending.progress,external_verified:true,confirmation_state:'queued'}});
  const html=render(views.ErasureJobView,{job:pending,typed:'',busy:false,onTyped:noop,onAction:noop});
  assert.ok(html.includes('confirmación final sigue pendiente'));assert.equal(html.includes('Procesar datos y archivos'),false);assert.equal(html.includes('Completada el'),false);
});
test('preparing privacy requires the exact account name and no guessed request versions in the UI',()=>{
  const value={...baseJob(),job_id:undefined,state:'not_prepared'};
  const html=render(views.ErasureJobView,{job:value,typed:'wrong-name',busy:false,onTyped:noop,onAction:noop});
  assert.match(html,/disabled=""[^>]*>Preparar eliminación/);assert.ok(html.includes('no se puede deshacer'));assert.equal(html.includes('expected_request_version'),false);
});
