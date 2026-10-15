import { useCallback, useEffect, useRef } from 'react';
import { createAutosaveQueue } from './autosave.js';

/** Stable writer for one mounted editor; callers render errors and retry. */
export function useDebouncedSave(save, onStatus, delay = 600) {
  const saveRef = useRef(save);
  const statusRef = useRef(onStatus);
  const mounted = useRef(false);
  saveRef.current = save;
  statusRef.current = onStatus;
  const queueRef = useRef(null);
  if (!queueRef.current) queueRef.current = createAutosaveQueue({
    save: patch => saveRef.current(patch),
    onStatus: (status, error) => { if (mounted.current) statusRef.current?.(status, error); },
    delay,
  });
  const schedule = useCallback(patch => queueRef.current.schedule(patch), []);
  const flush = useCallback(() => queueRef.current.flush(), []);
  useEffect(() => {
    mounted.current = true;
    const warn = event => {
      if (!queueRef.current.getState().pending) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      mounted.current = false;
      window.removeEventListener('beforeunload', warn);
      void queueRef.current.flush();
    };
  }, []);
  return [schedule, flush, flush];
}
