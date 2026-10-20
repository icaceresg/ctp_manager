import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Activity, CalendarCheck, CalendarDays, Clapperboard, ListChecks, LogOut, Menu, Plus, ShieldCheck, SquareKanban, Trophy, Gift, UserRound, Users, ChartNoAxesCombined, History, Radio, Settings2, MessageSquare, Gavel, BadgeCheck, FileText } from 'lucide-react';
import { managerNavigation, ruletaNavigation } from '../navigation.js';
import { QuickNavigation } from './QuickNavigation.jsx';
import { api } from '../api.js';
import { useApp, useData } from '../context.jsx';
import { dueWithin } from '../dates.js';
import { ContentEditor } from './ContentEditor.jsx';

export function BrandMark({ size = 30 }) {
  return <img className="brand-mark" src="/brand/favicon.svg" width={size} height={size} alt="" />;
}

const ICONS = { jornada: Activity, torneos: Trophy, incidencias: ShieldCheck, turnos: Users, casters: FileText, realizacion: Radio, estadisticas: ChartNoAxesCombined, clubes: BadgeCheck, discord: MessageSquare, disciplina: Gavel, contenido: FileText, historico: History, decisiones: ListChecks, integracion: Settings2, usuarios: Users, calendario: CalendarDays, escaleta: Clapperboard, recursos: ListChecks, disponibilidad: CalendarCheck, tablero: SquareKanban, ruleta: Gift };

function PendingBadge() {
  const { data: withResources } = useData(() => api.get('/contents?with_resources=1'));
  // Recursos pendientes de lo que se publica en los próximos 7 días (o ya va con retraso).
  const pending = (withResources || [])
    .filter((c) => dueWithin(c, 7))
    .reduce((n, c) => n + c.resources.filter((r) => !r.done).length, 0);
  if (!pending) return null;
  return (
    <span className="count" title="Recursos pendientes para los próximos 7 días">
      {pending}
    </span>
  );
}

export function Layout() {
  const { me, can, openContent, editor, closeContent, onLogout } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => {
    window.scrollTo(0, 0);
    document.getElementById('manager-content')?.focus({ preventScroll: true });
    const title = managerNavigation(can, me.is_admin).find(item => item.to === location.pathname)?.title
      || (location.pathname.startsWith('/operaciones/partidos/') ? 'Ficha de partido' : location.pathname.startsWith('/crm/') ? 'CRM y correos' : location.pathname === '/cuenta' ? 'Mi cuenta' : 'Área de trabajo');
    document.title = `${title} · CTP Manager`;
  }, [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = event => { if (event.key === 'Escape') { setMenuOpen(false); document.querySelector('.mobile-nav-toggle')?.focus(); } };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menuOpen]);
  const items = [...managerNavigation(can, me.is_admin), ruletaNavigation(window.location.hostname)];
  const groups = [...new Set(items.map(item => item.group))];
  const roleNames = me.is_admin ? 'Administrador' : me.roles.map((r) => r.name).join(' · ') || 'Sin rol';

  return (
    <div className="app">
      <a className="manager-skip" href="#manager-content">Ir al contenido</a>
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <span>
            CTP <em>Manager</em>
          </span>
        </div>
        <QuickNavigation items={items} />
        <button type="button" className="mobile-nav-toggle" aria-label={menuOpen ? 'Cerrar menú del Manager' : 'Abrir menú del Manager'} aria-controls="manager-main-nav" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Menu size={20} /></button>
        <nav id="manager-main-nav" className={`nav ${menuOpen ? 'is-open' : ''}`} aria-label="Navegación principal">
          {groups.map(group => <details key={group} className="manager-nav-group" open={group === 'Trabajo diario' || items.some(item => item.group === group && location.pathname === item.to)}>
            <summary>{group}</summary>
            {items.filter(item => item.group === group).map(item => { const Icon = ICONS[item.id] || ListChecks; if (item.href) return <a key={item.id} href={item.href} target="_blank" rel="noopener"><Icon size={17} /><span>{item.title}</span></a>; return <NavLink key={item.id} to={item.to}><Icon size={17} /><span>{item.title}</span>{item.id === 'recursos' && <PendingBadge />}</NavLink>; })}
          </details>)}
        </nav>
        {can('calendario') && <button className="btn block sidebar-new" onClick={() => openContent()}><Plus size={16} /> Nueva publicación</button>}
        <div className="sidebar-footer">
          <NavLink to="/cuenta" className="user-chip" title="Mi cuenta">
            <span className="user-avatar">
              <UserRound size={16} />
            </span>
            <span className="user-info">
              <strong>{me.name}</strong>
              <span>{roleNames}</span>
            </span>
          </NavLink>
          <button className="btn ghost icon" onClick={onLogout} title="Cerrar sesión" aria-label="Cerrar sesión">
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main id="manager-content" className="main" tabIndex={-1}>
        <Outlet />
      </main>
      {editor && (
        <ContentEditor key={editor.content?.id ?? `new-${editor.date ?? ''}`} content={editor.content} date={editor.date} onClose={closeContent} />
      )}
    </div>
  );
}
