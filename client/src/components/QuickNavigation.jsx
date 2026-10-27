import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Modal } from './ui.jsx';
import { navigationSearch } from '../navigation.js';
import { useApp } from '../context.jsx';
import { api } from '../api.js';
import {createGlobalSearch,globalSearchContext,globalSearchInitial,globalSearchKey,globalSearchQuery} from '../globalSearch.js';

export function QuickSearchGroup({title,state,onClose,firstId}){
  const copy={waiting:'Preparando búsqueda…',loading:'Buscando…',forbidden:'Tu cuenta no tiene permiso para esta búsqueda.',session:'Tu sesión necesita volver a validarse.',error:'No se ha podido consultar esta fuente. Reintenta la búsqueda.',idle:'Escribe al menos dos caracteres.',hint:'Para localizar una partida, pega su ID completo.'};
  return <section aria-label={title}><h3>{title}</h3><div className="manager-search-results">
    {state.status==='ready'?state.items.length?state.items.map((item,index)=><Link id={index===0?firstId:undefined} key={item.id} to={item.to} onClick={onClose}><span><strong>{item.title}</strong><small>{item.type}{item.detail?' · '+item.detail:''}</small></span><ArrowUpRight size={16}/></Link>):<p role="status">Sin coincidencias en esta fuente.</p>:<p role={['error','session'].includes(state.status)?'alert':'status'}>{copy[state.status]}</p>}
  </div></section>;
}

export function QuickNavigation({ items }) {
  const {me,can}=useApp();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [remote,setRemote]=useState(null),[retry,setRetry]=useState(0);
  const search=useRef(null);if(!search.current)search.current=createGlobalSearch(api.get);
  const context=globalSearchContext(me,can),key=globalSearchKey(context,query),normalized=globalSearchQuery(query);
  const current=remote?.key===key?remote:globalSearchInitial(context,query);
  useEffect(()=>{
    search.current.cancel();
    if(!open)return;
    let request;
    const timer=setTimeout(()=>{request=search.current.run(context,query,setRemote);},350);
    return()=>{clearTimeout(timer);request?.cancel();search.current.cancel();};
  },[open,key,retry]);
  useEffect(() => {
    const onKey = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); setQuery(''); setOpen(value => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const results = navigationSearch(items, query).slice(0,5);
  const close = () => {search.current.cancel();setOpen(false);setRemote(null);};
  const firstRemote=['players','tickets','lobby'].find(kind=>current[kind].status==='ready'&&current[kind].items.length);
  return <>
    <button type="button" className="manager-search-button" onClick={() => { setQuery(''); setRemote(null);setOpen(true); }} aria-label="Buscar jugadores, incidencias, partidas o herramientas"><Search size={16} /><span>Buscar…</span><kbd>Ctrl K</kbd></button>
    {open && <Modal title="¿Qué necesitas hacer?" onClose={close}>
      <form className="manager-tool-search" onSubmit={event => { event.preventDefault(); document.getElementById('manager-first-result')?.click(); }}>
        <label htmlFor="manager-tool-query">Buscar jugador, incidencia, ID de partida o herramienta</label>
        <input id="manager-tool-query" type="search" value={query} maxLength={120} onChange={event => setQuery(event.target.value)} placeholder="Nickname, Activision ID, ticket o ID de partida…" autoComplete="off" />
      </form>
      <h3>Herramientas</h3><div className="manager-search-results" aria-label="Herramientas disponibles">
        {results.map((item, index) => {
          const body = <><span><strong>{item.title}</strong><small>{item.group}</small></span><ArrowUpRight size={16} /></>;
          const id = index === 0 ? 'manager-first-result' : undefined;
          return item.href
            ? <a id={id} key={item.id} href={item.href} target="_blank" rel="noopener noreferrer" onClick={close}>{body}</a>
            : <Link id={id} key={item.id} to={item.to} onClick={close}>{body}</Link>;
        })}
        {!results.length && <p role="status">No hay herramientas que coincidan. Prueba otro nombre.</p>}
      </div>
      {current.error&&<p role="alert">{current.error}</p>}
      {normalized!==null&&normalized.length<2&&<p role="status">Escribe al menos dos caracteres para buscar personas e incidencias. Aquí se muestran hasta cinco herramientas de tu cuenta.</p>}
      {normalized!==null&&normalized.length>=2&&<>
        <QuickSearchGroup title="Jugadores CTP" state={current.players} onClose={close} firstId={!results.length&&firstRemote==='players'?'manager-first-result':undefined}/>
        <QuickSearchGroup title="Incidencias" state={current.tickets} onClose={close} firstId={!results.length&&firstRemote==='tickets'?'manager-first-result':undefined}/>
        <p className="muted">Incidencias: búsqueda en copias sincronizadas y registros locales del Manager; no consulta todos los tickets en directo.</p>
        <QuickSearchGroup title="Partida por ID" state={current.lobby} onClose={close} firstId={!results.length&&firstRemote==='lobby'?'manager-first-result':undefined}/>
        {['players','tickets','lobby'].some(kind=>['error','session'].includes(current[kind].status))&&<button type="button" className="btn" onClick={()=>setRetry(value=>value+1)}>Reintentar búsqueda</button>}
      </>}
    </Modal>}
  </>;
}
