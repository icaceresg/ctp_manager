import { useEffect, useState } from 'react';
import { ArrowUpRight, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Modal } from './ui.jsx';
import { navigationSearch } from '../navigation.js';

export function QuickNavigation({ items }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const onKey = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); setQuery(''); setOpen(value => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const results = navigationSearch(items, query);
  const close = () => setOpen(false);
  return <>
    <button type="button" className="manager-search-button" onClick={() => { setQuery(''); setOpen(true); }} aria-label="Buscar una herramienta del Manager"><Search size={16} /><span>Ir a…</span><kbd>Ctrl K</kbd></button>
    {open && <Modal title="¿Qué necesitas hacer?" onClose={close}>
      <form className="manager-tool-search" onSubmit={event => { event.preventDefault(); if (results.length) document.getElementById('manager-first-result')?.click(); }}>
        <label htmlFor="manager-tool-query">Buscar sección o herramienta</label>
        <input id="manager-tool-query" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Estadísticas, árbitro, turnos…" autoComplete="off" />
      </form>
      <div className="manager-search-results" aria-label="Herramientas disponibles">
        {results.map((item, index) => {
          const body = <><span><strong>{item.title}</strong><small>{item.group}</small></span><ArrowUpRight size={16} /></>;
          const id = index === 0 ? 'manager-first-result' : undefined;
          return item.href
            ? <a id={id} key={item.id} href={item.href} target="_blank" rel="noopener" onClick={close}>{body}</a>
            : <Link id={id} key={item.id} to={item.to} onClick={close}>{body}</Link>;
        })}
        {!results.length && <p role="status">No hay herramientas que coincidan. Prueba otro nombre.</p>}
      </div>
    </Modal>}
  </>;
}
