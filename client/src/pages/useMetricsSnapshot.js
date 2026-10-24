import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { METRICS_REFRESH_MS } from './metricsModel.js';
import { METRICS_SCHEMA_VERSION } from '../../../shared/metrics-contract.js';

export function useMetricsSnapshot(allowed, actorKey) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [hidden, setHidden] = useState(() => document.hidden);
  const current = useRef(null), request = useRef(0);
  const load = useCallback(async () => {
    if (!allowed || document.hidden || current.current) return;
    const controller = new AbortController(), serial = ++request.current;
    current.current = controller; setBusy(true);
    try {
      const next = await api.get('/administration/metrics', { signal: controller.signal });
      if (serial !== request.current || controller.signal.aborted) return;
      if (next?.schemaVersion !== METRICS_SCHEMA_VERSION || typeof next.generatedAt !== 'string' || !Number.isFinite(Date.parse(next.generatedAt)) || !next.environments || !Array.isArray(next.history)) throw new Error('Respuesta de métricas no disponible.');
      setData(next); setError('');
    } catch (cause) {
      if (serial !== request.current || controller.signal.aborted) return;
      if ([401, 403].includes(cause.status)) { setData(null); setError('Tu cuenta ya no tiene acceso a estas métricas.'); }
      else setError(cause.status === 404 ? 'La monitorización todavía no está habilitada en este Manager.' : 'No se ha podido actualizar la monitorización.');
    } finally { if (serial === request.current) { current.current = null; setBusy(false); } }
  }, [allowed, actorKey]);
  useEffect(() => {
    setData(null); setError(''); void load();
    const visible = () => {
      setHidden(document.hidden);
      if (document.hidden) { ++request.current; current.current?.abort(); current.current = null; setBusy(false); }
      else void load();
    };
    const timer = setInterval(() => { if (!document.hidden) void load(); }, METRICS_REFRESH_MS);
    document.addEventListener('visibilitychange', visible);
    return () => { ++request.current; current.current?.abort(); current.current = null; clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [load]);
  return { data, error, busy, hidden, refresh: load };
}
