import { NavLink, Outlet } from 'react-router-dom';
import { CalendarCheck, CalendarDays, Clapperboard, ListChecks, LogOut, Plus, ShieldCheck, SquareKanban, UserRound } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useData } from '../context.jsx';
import { dueWithin } from '../dates.js';
import { ContentEditor } from './ContentEditor.jsx';

export function BrandMark({ size = 30 }) {
  return <img className="brand-mark" src="/brand/favicon.svg" width={size} height={size} alt="" />;
}

const NAV = [
  { to: '/calendario', label: 'Calendario', icon: CalendarDays, section: 'calendario' },
  { to: '/escaleta', label: 'Escaleta', icon: Clapperboard, section: 'escaleta' },
  { to: '/recursos', label: 'Recursos', icon: ListChecks, section: 'recursos' },
  { to: '/disponibilidad', label: 'Disponibilidad', icon: CalendarCheck, section: 'disponibilidad' },
  { to: '/tablero', label: 'Tablero', icon: SquareKanban, section: 'tablero' },
];

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
  const roleNames = me.is_admin ? 'Administrador' : me.roles.map((r) => r.name).join(' · ') || 'Sin rol';

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <span>
            CTP <em>Manager</em>
          </span>
        </div>
        {can('calendario') && (
          <button className="btn primary block sidebar-new" onClick={() => openContent()}>
            <Plus size={16} /> Nueva publicación
          </button>
        )}
        <nav className="nav">
          {NAV.filter((item) => can(item.section)).map(({ to, label, icon: Icon, section }) => (
            <NavLink key={to} to={to}>
              <Icon size={18} />
              {label}
              {section === 'recursos' && <PendingBadge />}
            </NavLink>
          ))}
          {me.is_admin && (
            <NavLink to="/usuarios">
              <ShieldCheck size={18} />
              Usuarios y roles
            </NavLink>
          )}
        </nav>
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
      <main className="main">
        <Outlet />
      </main>
      {editor && (
        <ContentEditor key={editor.content?.id ?? `new-${editor.date ?? ''}`} content={editor.content} date={editor.date} onClose={closeContent} />
      )}
    </div>
  );
}
