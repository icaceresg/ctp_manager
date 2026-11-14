import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { createGuardTournamentReader } from './guardTournamentModel.js';

export function useGuardTournamentRead(id, owner) {
 const scope = `${owner ?? ''}:${id}`;
 const [state, setState] = useState({ scope, data: null, error: null, loading: true, receivedAt: 0, now: Date.now() });
 const reader = useRef(null);
 useEffect(() => {
  let mounted = true;
  setState({ scope, data: null, error: null, loading: true, receivedAt: 0, now: Date.now() });
  const loop = createGuardTournamentReader({
   read: signal => api.get(`/operations/matches/${encodeURIComponent(id)}/guard?include_events=false`, { signal }),
   publish: patch => { if (mounted) setState(value => ({ ...value, ...patch })); },
  });
  reader.current = loop;
  const visibility = () => loop.visibilityChanged();
  const clock = setInterval(() => { if (!document.hidden) setState(value => ({ ...value, now: Date.now() })); }, 1000);
  document.addEventListener('visibilitychange', visibility); loop.start();
  return () => { mounted = false; loop.stop(); if (reader.current === loop) reader.current = null; clearInterval(clock); document.removeEventListener('visibilitychange', visibility); };
 }, [scope, id]);
 const refresh = useCallback(force => reader.current?.refresh(force === true), []);
 return { ...(state.scope === scope ? state : { data: null, error: null, loading: true, receivedAt: 0, now: Date.now() }), refresh };
}
