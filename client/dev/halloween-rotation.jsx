/** Real Manager panel with explicitly synthetic, in-memory control data. */
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/saira-condensed/700.css';
import RankedEventPanel from '../src/pages/RankedEventPanel.jsx';
import '../src/styles.css';
import '../src/operations/operations.css';

if(!import.meta.env.DEV||!['localhost','127.0.0.1','[::1]'].includes(window.location.hostname))throw new Error('Local development fixture only');
const fixed=['Mumbai','Munition','Reactor U92','Rooftops','Silkworm'],interval=1200000;
let enabled=true,revision=1,unavailable=false,offset=Date.parse('2026-10-28T12:10:00Z')-Date.now();
const counts={get:0,post:0,changes:0},receipts=new Map(),serverNow=()=>Date.now()+offset;
const originalFetch=window.fetch;
function snapshot(){
 const now=serverNow(),slot=Math.floor(now/interval),active=slot%2===0?'Sentry':'Lithium';
 const stamp=new Date(now).toISOString();
 return{schema_version:1,event_id:'hw-2026',enabled,theme:'halloween',xp_multiplier:1,streak_bonus:0.5,starts_at:null,ends_at:null,revision,server_time:stamp,
  map_rotation:{schema_version:1,event_id:'hw-2026',enabled,interval_seconds:1200,frozen:false,
   active_map:enabled?active:null,next_map:enabled?(active==='Sentry'?'Lithium':'Sentry'):null,
   slot_starts_at:enabled?new Date(slot*interval).toISOString():null,next_rotation_at:enabled?new Date((slot+1)*interval).toISOString():null,
   observed_at:stamp,fixed_maps:[...fixed],active_pool:enabled?[...fixed,active]:['Coal','Lotus',...fixed]}};
}
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
window.fetch=async(input,options={})=>{
 const url=new URL(typeof input==='string'?input:input.url,window.location.href);
 if(url.origin!==window.location.origin||url.pathname!=='/api/administration/ranked-event')throw new Error('The local fixture accepts no other API or external destination');
 if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
 const method=options.method||'GET';
 if(method==='GET'){counts.get++;return unavailable?reply({error:'Lectura no disponible: error simulado en DEV.'},503):reply(snapshot());}
 if(method!=='POST')return reply({error:'Método no permitido en la simulación.'},405);
 counts.post++;const body=JSON.parse(options.body||'{}');
 if(receipts.has(body.request_id))return reply(receipts.get(body.request_id));
 if(body.action!=='configure'||typeof body.enabled!=='boolean'||body.expected_version!==revision||typeof body.request_id!=='string'
  ||typeof body.reason!=='string'||body.reason.trim().length<12)return reply({error:'Revisa la revisión y el motivo de la simulación.'},409);
 enabled=body.enabled;revision++;counts.changes++;const result={...snapshot(),request_id:body.request_id};receipts.set(body.request_id,result);return reply(result);
};
const refreshPanel=()=>document.querySelector('.ranked-event-panel .op-section-title button')?.click();
const boundary=()=>{
 let target=(Math.floor(serverNow()/interval)+1)*interval-3000;if(target<=serverNow())target+=interval;
 offset=target-Date.now();refreshPanel();
};
window.ctpManagerHalloweenFixture={stats:()=>({...counts}),snapshot,boundary};

function Fixture(){
 const [failed,setFailed]=useState(false),isAdmin=new URLSearchParams(location.search).get('role')!=='referee';
 return <main style={{maxWidth:1050,margin:'0 auto',padding:20}}>
  <h1 style={{fontSize:26}}>Halloween · Manager DEV</h1>
  <p style={{color:'#e2bd8a',lineHeight:1.7}}>Datos sintéticos y API en memoria. Este ejemplo no inicia una sesión de staff, no conecta con CTP y no cambia PRE ni PROD.</p>
  <div style={{display:'flex',gap:10,flexWrap:'wrap',margin:'20px 0'}}>
   <button className="btn" style={{maxWidth:'100%',whiteSpace:'normal'}} onClick={boundary}>Ver el próximo cambio en 3 segundos</button>
   <button className="btn" style={{maxWidth:'100%',whiteSpace:'normal'}} onClick={()=>{offset+=interval;refreshPanel();}}>Adelantar 20 minutos</button>
   <button className="btn" style={{maxWidth:'100%',whiteSpace:'normal'}} onClick={()=>{unavailable=!unavailable;setFailed(unavailable);refreshPanel();}}>{failed?'Restablecer lectura simulada':'Simular error de lectura'}</button>
  </div>
  {!isAdmin&&<p role="status">Perfil sintético de árbitro: el control de administración no se muestra ni consulta la API.</p>}
  <RankedEventPanel user={{id:1,is_admin:isAdmin}}/>
 </main>;
}
const root=createRoot(document.getElementById('root'));root.render(<Fixture/>);
if(import.meta.hot)import.meta.hot.dispose(()=>{root.unmount();window.fetch=originalFetch;delete window.ctpManagerHalloweenFixture;});
