import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {createServer} from 'vite';

// Render the actual workspace/detail/avatar composition. Only the loader is
// substituted with synthetic snapshots, deliberately retaining successful
// detail snapshots after the parent list has lost permission.
let vite,Page,AppProvider;
before(async()=>{
  vite=await createServer({plugins:[{name:'synthetic-safety-snapshots',enforce:'pre',load(id){if(id.split('?')[0].replaceAll('\\','/').endsWith('/pages/useSafetyResource.jsx'))return `export function useSafetyResource(key){return globalThis.__managerSafetySnapshots.get(key);}`;}}],server:{middlewareMode:true,watch:null,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
  ({default:Page}=await vite.ssrLoadModule('/src/pages/AdministrationSafetyPage.jsx'));({AppProvider}=await vite.ssrLoadModule('/src/context.jsx'));
});
after(async()=>{delete globalThis.__managerSafetySnapshots;await vite?.close();});
const noop=()=>{},scope={};
const ready=data=>({data,scope,loading:false,busy:false,error:null,needsRead:false,reload:noop,mutate:noop});
const render=(section,query)=>renderToStaticMarkup(createElement(AppProvider,{me:{id:1,is_admin:true,auth_mode:'ctp',ctp_role:'admin'}},createElement(MemoryRouter,{initialEntries:[`/?${query}`]},createElement(Page,{section}))));

test('a list reload or 401/403/404 unmounts the still-successful report/avatar subtree and its private controls',()=>{
  const id='synthetic-report',listKey=`moderation-list:${JSON.stringify(['pending',0])}`;
  const report={id,ticket_id:'synthetic-ticket',ticket_code:'CTP-QA',target_username:'PRIVATE_REPORT_SUBJECT',reason:'abuse',context:'user',status:'pending',version:1,details:'PRIVATE_REVIEW_EVIDENCE',evidence:{},created_at:'2026-10-27T08:00:00Z'};
  const avatar={report,user:{id:'synthetic-user',username:'PRIVATE_PROFILE_NAME',bio:'PRIVATE_PROFILE_BIO',manager_version:3},job:null,preview:{reported_avatar_url:null,current_avatar_url:null},eligibility:{matches_reported_avatar:true,avatar_present:true,can_remove:true}};
  globalThis.__managerSafetySnapshots=new Map([[listKey,ready({items:[report],total:1})],[`report:${id}`,ready({report})],[`avatar:${id}`,ready(avatar)]]);
  const before=render('moderacion',`reporte=${id}`);assert.ok(before.includes('PRIVATE_PROFILE_BIO'));assert.ok(before.includes('Motivo de la retirada del avatar'));
  for(const next of [{...ready(null),loading:true},...([401,403,404].map(status=>({...ready(null),error:Object.assign(Error('Synthetic list permission failure'),{status})})))]){
    globalThis.__managerSafetySnapshots.set(listKey,next);
    const html=render('moderacion',`reporte=${id}`);
    for(const text of ['PRIVATE_REPORT_SUBJECT','PRIVATE_REVIEW_EVIDENCE','PRIVATE_PROFILE_NAME','PRIVATE_PROFILE_BIO','Archivar reporte','Motivo de la retirada del avatar','Corregir nombre o biografía'])assert.equal(html.includes(text),false,text);
  }
});

test('a failed privacy list unmounts a previously successful erasure detail instead of retaining its subject or controls',()=>{
  const id='synthetic-ticket',job={ticket_id:id,state:'not_prepared',request:{ticket_id:id,username:'PRIVATE_ERASURE_SUBJECT',requested_at:'2026-10-27T08:00:00Z'}};
  globalThis.__managerSafetySnapshots=new Map([['erasure-list:0',ready({requests:[{request:job.request,job:null}],has_more:false})],[`erasure:${id}`,ready(job)]]);
  assert.ok(render('privacidad',`ticket=${id}`).includes('PRIVATE_ERASURE_SUBJECT'));
  globalThis.__managerSafetySnapshots.set('erasure-list:0',{...ready(null),error:Object.assign(Error('Synthetic list permission failure'),{status:403})});
  const html=render('privacidad',`ticket=${id}`);assert.equal(html.includes('PRIVATE_ERASURE_SUBJECT'),false);assert.equal(html.includes('Preparar eliminación'),false);assert.equal(html.includes('Conversación de privacidad'),false);
});
