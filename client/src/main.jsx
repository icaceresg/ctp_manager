import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/saira-condensed/600.css';
import '@fontsource/saira-condensed/700.css';
import '@fontsource/saira-condensed/800.css';
import '@fontsource/jetbrains-mono/500.css';
import { UNAUTHORIZED_EVENT, api } from './api.js';
import { AppProvider } from './context.jsx';
import { Layout } from './components/Layout.jsx';
import { EmptyState, Spinner } from './components/ui.jsx';
import { Login } from './pages/Login.jsx';
import { CalendarPage } from './pages/CalendarPage.jsx';
import { RundownPage } from './pages/RundownPage.jsx';
import { ResourcesPage } from './pages/ResourcesPage.jsx';
import { AccountPage } from './pages/AccountPage.jsx';
import { UsersPage } from './pages/UsersPage.jsx';
import { AvailabilityPage } from './pages/AvailabilityPage.jsx';
import { BoardPage } from './pages/BoardPage.jsx';
import { OperationsPage } from './operations/OperationsPage.jsx';
import { OP_SECTIONS } from './operations/model.js';
import { canAccess } from '../../shared/access.js';
import { Lock } from 'lucide-react';
import './styles.css';

const SECTION_ROUTES = [
  { section: 'calendario', path: '/calendario' },
  { section: 'escaleta', path: '/escaleta' },
  { section: 'recursos', path: '/recursos' },
  { section: 'disponibilidad', path: '/disponibilidad' },
  { section: 'tablero', path: '/tablero' },
];

function NoAccess() {
  return (
    <div className="page">
      <div className="card">
        <EmptyState icon={Lock} title="Aún no tienes secciones asignadas">
          Pide a un administrador que te asigne un rol para empezar a trabajar.
        </EmptyState>
      </div>
    </div>
  );
}

function NotFound({ home }) {
  return <div className="page"><EmptyState icon={Lock} title="Esta página no está disponible" action={<Link className="btn primary" to={home}>Volver a mi área de trabajo</Link>}>El enlace puede estar incompleto o haber cambiado. Puedes buscar la herramienta en «Ir a…».</EmptyState></div>;
}

function App() {
  const [auth, setAuth] = useState(null);

  const check = useCallback(() => {
    api
      .get('/auth/status')
      .then(setAuth)
      .catch(() => setAuth({ error: true }));
  }, []);

  useEffect(() => {
    check();
    window.addEventListener(UNAUTHORIZED_EVENT, check);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, check);
  }, [check]);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    check();
  }, [check]);

  if (!auth) {
    return (
      <div className="center-screen">
        <Spinner size={24} />
      </div>
    );
  }
  if (auth.error) {
    return (
      <div className="center-screen">
        <div className="card card-body stack" style={{ maxWidth: 420, textAlign: 'center' }}>
          <h2>No se puede conectar con el servidor</h2>
          <p className="muted">Comprueba que la ventana de CTP Manager sigue abierta y recarga la página.</p>
          <button className="btn primary" onClick={check}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }
  if (!auth.authenticated) return <Login setup={!auth.setup && auth.provider !== 'ctp'} provider={auth.provider} onDone={check} />;

  const me = auth.user;
  const hasOperations = OP_SECTIONS.some((section) => canAccess(me, section));
  const home = hasOperations ? '/operaciones/jornada' : SECTION_ROUTES.find((r) => canAccess(me, r.section))?.path || '/sin-acceso';
  const guard = (section, element) => (canAccess(me, section) ? element : <Navigate to={home} replace />);

  return (
    <AppProvider me={me} onLogout={logout} onMeChange={check}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to={home} replace />} />
          <Route path="operaciones" element={<Navigate to="/operaciones/jornada" replace />} />
          <Route path="operaciones/:view" element={hasOperations ? <OperationsPage /> : <Navigate to={home} replace />} />
          <Route path="operaciones/partidos/:matchId" element={hasOperations ? <OperationsPage /> : <Navigate to={home} replace />} />
          <Route path="calendario" element={guard('calendario', <CalendarPage />)} />
          <Route path="escaleta" element={guard('escaleta', <RundownPage />)} />
          <Route path="escaleta/:id" element={guard('escaleta', <RundownPage />)} />
          <Route path="recursos" element={guard('recursos', <ResourcesPage />)} />
          <Route path="disponibilidad" element={guard('disponibilidad', <AvailabilityPage />)} />
          <Route path="tablero" element={guard('tablero', <BoardPage />)} />
          <Route path="usuarios" element={me.is_admin ? <UsersPage /> : <Navigate to={home} replace />} />
          <Route path="cuenta" element={<AccountPage />} />
          <Route path="sin-acceso" element={<NoAccess />} />
          <Route path="*" element={<NotFound home={home} />} />
        </Route>
      </Routes>
    </AppProvider>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
