import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { canAccess } from '../../shared/access.js';

const AppContext = createContext(null);

export function useApp() {
  return useContext(AppContext);
}

/**
 * Estado global: el usuario conectado (me), avisos (toasts), el editor de
 * tarjetas y un contador "version" que las páginas usan para recargar sus
 * datos cuando algo cambia.
 */
export function AppProvider({ children, me, onLogout, onMeChange }) {
  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [editor, setEditor] = useState(null);
  const toastId = useRef(0);

  const toast = useCallback((message, type = 'success') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 6000 : 3000);
  }, []);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const value = useMemo(
    () => ({
      me,
      can: (section) => canAccess(me, section),
      onMeChange,
      version,
      bump,
      toast,
      onLogout,
      editor,
      // openContent({ content }) edita una tarjeta; openContent({ date }) crea una en ese día.
      openContent: (opts = {}) => setEditor(opts),
      closeContent: () => setEditor(null),
    }),
    [me, onMeChange, version, bump, toast, onLogout, editor],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.type === 'error' ? <CircleAlert size={18} /> : <CircleCheck size={18} />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}

/** Carga datos del servidor y los recarga cuando cambia "version" o las deps. */
export function useData(loader, deps = []) {
  const { version, toast } = useApp();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async () => {
    try {
      setData(await loaderRef.current());
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, ...deps]);

  useEffect(() => {
    reload();
  }, [reload, version]);

  return { data, loading, reload, setData };
}
