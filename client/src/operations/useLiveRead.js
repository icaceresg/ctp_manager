import { useCallback, useEffect, useRef } from 'react';
import { useApp } from '../context.jsx';
import { api } from '../api.js';
import { createLiveReadLoop } from './liveReadLoop.js';

/** One bounded visible read per mounted authority/resource; never caches a response. */
export function useLiveRead(url, { intervalMs = 0, initial = true, enabled = true, blocked, onValue, onError, onReset }) {
  const { me } = useApp();
  const authority = useRef(me); authority.current = me;
  const callbacks = useRef(); callbacks.current = { blocked, onValue, onError, onReset };
  const active = useRef(null);
  useEffect(() => {
    callbacks.current.onReset?.();
    if (!enabled) return undefined;
    const actor = me;
    const controller = createLiveReadLoop({
      intervalMs, initial,
      visible: () => !document.hidden && authority.current === actor,
      blocked: () => callbacks.current.blocked?.() === true,
      read: signal => api.get(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) }),
      onValue: value => callbacks.current.onValue(value),
      onError: error => callbacks.current.onError?.(error),
    });
    active.current = controller;
    controller.start();
    const visibility = () => controller.visibilityChanged();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      controller.stop();
      document.removeEventListener('visibilitychange', visibility);
      if (active.current === controller) active.current = null;
    };
  }, [url, me, intervalMs, initial, enabled]);
  const load = useCallback(options => active.current?.load(options) ?? Promise.resolve(false), []);
  const cancel = useCallback(() => active.current?.cancel(), []);
  return { load, cancel };
}
