import {useEffect,useRef,useState} from 'react';
import {Bell,CheckCircle2,ExternalLink,RefreshCw,Radio} from 'lucide-react';
import {api} from '../api.js';
import {useApp} from '../context.jsx';
import StaffAlertsPanel from './StaffAlertsPanel.jsx';

const marker='manager.twitch.owner';
const ownerUrl=value=>{
  try{const url=new URL(value);return url.origin==='https://id.twitch.tv'&&url.pathname==='/oauth2/authorize'&&url.searchParams.get('redirect_uri')==='https://manager.playctp.com/administracion/integraciones?twitch_admin=1'&&url.searchParams.get('scope')==='channel:read:subscriptions'?url:null;}catch{return null;}
};
const notices={connected:'Cuenta de playctp autorizada.',cancelled:'Autorización cancelada.',unlinked:'Cuenta desvinculada.'};
export default function AdministrationIntegrations(){
  const {me}=useApp(),[data,setData]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const sequence=useRef(0),mounted=useRef(true),lock=useRef(false),started=useRef(false);
  async function refresh(){const serial=++sequence.current;try{const result=await api.get('/administration/integrations');if(mounted.current&&serial===sequence.current)setData(result);}catch(e){if(mounted.current&&serial===sequence.current)setError(e.message);}}
  useEffect(()=>{
    mounted.current=true;
    if(!started.current){started.current=true;void(async()=>{
      const url=new URL(window.location.href);
      if(url.searchParams.get('twitch_admin')==='1'){
        let saved;try{saved=JSON.parse(sessionStorage.getItem(marker)||'null');}catch{/* Invalid callbacks are rejected. */}
        const state=url.searchParams.get('state'),code=url.searchParams.get('code'),cancelled=url.searchParams.has('error');
        const valid=['state','code','error','scope','error_description','twitch_admin'].every(k=>url.searchParams.getAll(k).length<=1)&&/^[a-f0-9]{64}$/.test(state||'')&&saved?.state===state&&saved?.user===me.id&&saved.expires>Date.now()&&(cancelled?!code:!!code);
        for(const key of ['state','code','error','scope','error_description','twitch_admin'])url.searchParams.delete(key);
        window.history.replaceState(window.history.state,'',url.href);
        sessionStorage.removeItem(marker);
        if(!valid)setError('Esta autorización ha caducado o no pertenece a esta sesión. Vuelve a conectar Twitch.');
        else{
          setBusy(true);lock.current=true;
          try{await api.post('/administration/integrations/twitch',{action:cancelled?'cancel':'complete',state,...(cancelled?{}:{code})});if(mounted.current)setNotice(cancelled?notices.cancelled:notices.connected);}
          catch(e){if(mounted.current)setError(e.message);}finally{lock.current=false;if(mounted.current)setBusy(false);}
        }
      }
      if(mounted.current)await refresh();
    })();}else{void refresh();}
    return()=>{mounted.current=false;sequence.current++;};
  },[me.id]);
  async function connect(){
    if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');
    try{
      const result=await api.post('/administration/integrations/twitch',{action:'start'}),url=ownerUrl(result.url);
      if(!url)throw new Error('No se ha confirmado la dirección segura de Twitch.');
      sessionStorage.setItem(marker,JSON.stringify({state:url.searchParams.get('state'),user:me.id,expires:Date.now()+600000}));
      window.location.assign(url.href);
    }catch(e){setError(e.message);}finally{lock.current=false;if(mounted.current)setBusy(false);}
  }
  async function unlink(){
    if(lock.current||!window.confirm('¿Desvincular la cuenta de playctp? Se dejarán de comprobar nuevas suscripciones hasta volver a autorizarla.'))return;
    lock.current=true;setBusy(true);setError('');setNotice('');
    try{const result=await api.post('/administration/integrations/twitch',{action:'unlink'});setNotice(result.revocation_pending?'Cuenta desvinculada. La revocación del permiso en Twitch sigue pendiente.':notices.unlinked);await refresh();}catch(e){setError(e.message);}finally{lock.current=false;setBusy(false);}
  }
  const twitch=data?.twitch,push=data?.push,connected=twitch?.status==='connected';
  return <div className="stack">
    {error&&<p className="op-error" role="alert">{error}</p>}{notice&&<p className="op-notice" role="status">{notice}</p>}
    <StaffAlertsPanel key={me.id} user={me} snapshot={data?.staff_alerts} onSnapshot={staff_alerts=>setData(current=>({...current,staff_alerts}))}/>
    <section className="op-card stack"><div className="op-section-title"><h2><Radio size={20}/> Twitch · playctp</h2><button className="btn" disabled={busy} onClick={()=>void refresh()}><RefreshCw size={16}/> Actualizar</button></div>
      <p>Autoriza la cuenta del canal para comprobar las suscripciones de los jugadores. Sirve cualquier nivel de suscripción.</p>
      <p role="status">{!twitch?'Consultando conexión…':twitch.error?twitch.error:twitch.status==='config_pending'?'Configuración del servicio pendiente':connected?'Cuenta autorizada':twitch.status==='expired'?'Autorización caducada':'Cuenta sin autorizar'}{connected&&twitch.healthy&&<CheckCircle2 size={16}/>}</p>
      <div className="op-actions"><button className="btn primary" disabled={busy||!twitch?.configured} onClick={()=>void connect()}><ExternalLink size={16}/>{connected?'Volver a autorizar':'Conectar playctp'}</button>{(connected||twitch?.status==='expired')&&<button className="btn" disabled={busy} onClick={()=>void unlink()}>Desvincular</button>}</div>
      {twitch?.status==='config_pending'&&<details><summary>Configuración necesaria</summary><p>Falta habilitar el servicio o registrar la dirección de retorno de Manager en la aplicación de Twitch. Las claves se configuran en el servidor.</p><code style={{overflowWrap:'anywhere'}}>{data?.callback}</code></details>}
    </section>
    <section className="op-card stack"><h2><Bell size={20}/> Notificaciones push</h2><p role="status">{!push?'Consultando servicio…':push.error?push.error:push.enabled&&push.schedulerEnabled?'Entrega habilitada':'Entrega pendiente de configuración'}</p>
      {push&&!push.error&&<><div className="op-case-meta"><span>{push.devices??0} dispositivos</span><span>{push.queue?.pending??0} pendientes</span><span>{push.queue?.delivered??0} entregadas</span><span>{push.queue?.failed??0} fallidas</span></div>{push.lastRun&&<p className="muted">Última ejecución: {new Date(push.lastRun.at).toLocaleString('es-ES')} · {push.lastRun.ok?'Correcta':'Con incidencias'}</p>}<p className="muted">La autorización para recibir notificaciones la concede cada jugador en su propio dispositivo.</p></>}
    </section>
  </div>;
}
