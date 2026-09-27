import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Check, Clapperboard, Copy, Eye, GripVertical, Pencil, Plus, Printer, Timer, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useData } from '../context.jsx';
import { formatDayKey, formatDuration, parseDuration } from '../dates.js';
import { EmptyState, Spinner } from '../components/ui.jsx';

const LAST_KEY = 'mrm:lastRundown';
const SAVE_DELAY = 600;

function remember(id) {
  try {
    localStorage.setItem(LAST_KEY, String(id));
  } catch {
    /* ignorar */
  }
}

function recall() {
  try {
    return Number(localStorage.getItem(LAST_KEY)) || null;
  } catch {
    return null;
  }
}

/**
 * Guarda con retardo mientras se escribe y fuerza el guardado al salir.
 * Devuelve [schedule(patch), flush()].
 */
function useDebouncedSave(save, onStatus) {
  const pending = useRef(null);
  const timer = useRef(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const patch = pending.current;
    pending.current = null;
    if (!patch) return;
    onStatus?.('saving');
    try {
      await saveRef.current(patch);
      onStatus?.('saved');
    } catch (err) {
      onStatus?.('error', err);
    }
  }, [onStatus]);

  const schedule = useCallback(
    (patch) => {
      pending.current = { ...pending.current, ...patch };
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY);
    },
    [flush],
  );

  useEffect(() => () => void flush(), [flush]);
  return [schedule, flush];
}

function fitHeight(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

/** Textarea que crece con el texto, y se reajusta si cambia el ancho de la ventana. */
function AutoTextarea({ value, onChange, onBlur, placeholder, className, ...rest }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (ref.current) fitHeight(ref.current);
  }, [value]);
  useEffect(() => {
    const el = ref.current;
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      fitHeight(el);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={className}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      {...rest}
    />
  );
}

function PartRow({ part, index, total, start, autoFocus, onStatus, onDurationChange, onMove, onAddBelow, onDelete, dragHandlers, dropState }) {
  const { toast } = useApp();
  const [fields, setFields] = useState({ title: part.title, content: part.content, notes: part.notes });
  const [durationText, setDurationText] = useState(formatDuration(part.duration));
  const [dragEnabled, setDragEnabled] = useState(false);
  const titleRef = useRef(null);

  const [schedule, flush] = useDebouncedSave(
    (patch) =>
      api.patch(`/parts/${part.id}`, patch).catch((err) => {
        // Si la parte se acaba de borrar, los cambios pendientes ya no importan.
        if (err.status !== 404) throw err;
      }),
    onStatus,
  );

  useEffect(() => {
    if (autoFocus) titleRef.current?.focus();
  }, [autoFocus]);

  const change = (field) => (value) => {
    setFields((f) => ({ ...f, [field]: value }));
    schedule({ [field]: value });
  };

  const commitDuration = () => {
    const seconds = parseDuration(durationText);
    if (seconds === null) {
      toast('Duración no válida. Usa mm:ss (p. ej. 1:30), 90s o 5m.', 'error');
      setDurationText(formatDuration(part.duration));
      return;
    }
    setDurationText(formatDuration(seconds));
    if (seconds !== part.duration) {
      onDurationChange(part.id, seconds);
      schedule({ duration: seconds });
      flush();
    }
  };

  return (
    <li
      className={`part-row ${dropState || ''}`}
      draggable={dragEnabled}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(part.id));
        dragHandlers.onStart(part.id);
      }}
      onDragEnd={() => {
        setDragEnabled(false);
        dragHandlers.onEnd();
      }}
      onDragOver={(e) => dragHandlers.onOver(e, part.id)}
      onDrop={(e) => dragHandlers.onDrop(e, part.id)}
    >
      <div className="part-rail">
        <span
          className="drag-handle"
          title="Arrastra para reordenar"
          onMouseDown={() => setDragEnabled(true)}
          onMouseUp={() => setDragEnabled(false)}
        >
          <GripVertical size={16} />
        </span>
        <span className="part-num">{index + 1}</span>
      </div>
      <div className="part-body">
        <div className="part-head">
          <span className="part-start" title="Minuto en el que empieza esta parte">
            {formatDuration(start)}
          </span>
          <input
            ref={titleRef}
            className="part-title"
            value={fields.title}
            placeholder="Título de la parte"
            maxLength={200}
            onChange={(e) => change('title')(e.target.value)}
            onBlur={flush}
            aria-label={`Título de la parte ${index + 1}`}
          />
          <label className="part-duration" title="Duración (mm:ss, 90s, 5m…)">
            <Timer size={14} />
            <input
              value={durationText}
              onChange={(e) => setDurationText(e.target.value)}
              onBlur={commitDuration}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              aria-label={`Duración de la parte ${index + 1}`}
            />
          </label>
          <div className="part-actions">
            <button className="btn ghost icon sm" onClick={() => onMove(part.id, -1)} disabled={index === 0} aria-label="Subir" title="Subir">
              <ArrowUp size={15} />
            </button>
            <button className="btn ghost icon sm" onClick={() => onMove(part.id, 1)} disabled={index === total - 1} aria-label="Bajar" title="Bajar">
              <ArrowDown size={15} />
            </button>
            <button className="btn ghost icon sm" onClick={() => onAddBelow(part.id)} aria-label="Añadir parte debajo" title="Añadir parte debajo">
              <Plus size={15} />
            </button>
            <button className="btn ghost icon sm danger" onClick={() => onDelete(part, fields)} aria-label="Eliminar parte" title="Eliminar parte">
              <Trash2 size={15} />
            </button>
          </div>
        </div>
        <div className="part-fields">
          <div className="part-field">
            <span className="part-label">Contenido</span>
            <AutoTextarea className="part-text" value={fields.content} placeholder="Qué se dice o se hace en esta parte…" onChange={change('content')} onBlur={flush} />
          </div>
          <div className="part-field">
            <span className="part-label">Notas</span>
            <AutoTextarea className="part-text" value={fields.notes} placeholder="Plano, música, grafismos, recursos…" onChange={change('notes')} onBlur={flush} />
          </div>
        </div>
      </div>
    </li>
  );
}

/** Vista de solo lectura (también es la que se imprime). */
function RundownTable({ rundown, starts }) {
  return (
    <div className="rundown-table-wrap">
      <table className="rundown-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Inicio</th>
            <th>Parte</th>
            <th>Duración</th>
            <th>Contenido</th>
            <th>Notas</th>
          </tr>
        </thead>
        <tbody>
          {rundown.parts.map((p, i) => (
            <tr key={p.id}>
              <td className="num">{i + 1}</td>
              <td className="num">{formatDuration(starts[i])}</td>
              <td className="strong">{p.title || <span className="muted">Sin título</span>}</td>
              <td className="num">{formatDuration(p.duration)}</td>
              <td className="pre">{p.content}</td>
              <td className="pre muted">{p.notes}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>Total</td>
            <td className="num">{formatDuration(rundown.parts.reduce((s, p) => s + p.duration, 0))}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function RundownEditor({ id, list, onListChange }) {
  const { toast } = useApp();
  const navigate = useNavigate();
  const [rundown, setRundown] = useState(null);
  const [meta, setMeta] = useState(null);
  const [mode, setMode] = useState('edit');
  const [status, setStatus] = useState('idle');
  const [focusPartId, setFocusPartId] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);

  const onStatus = useCallback(
    (s, err) => {
      setStatus(s);
      if (s === 'error') toast(err.message, 'error');
      if (s === 'saved') onListChange();
    },
    [toast, onListChange],
  );

  useEffect(() => {
    let cancelled = false;
    setRundown(null);
    api
      .get(`/rundowns/${id}`)
      .then((r) => {
        if (cancelled) return;
        setRundown(r);
        setMeta({ title: r.title, date: r.date || '', time: r.time || '', description: r.description });
        remember(r.id);
      })
      .catch((err) => {
        if (cancelled) return;
        toast(err.message, 'error');
        navigate('/escaleta', { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [id, toast, navigate]);

  const [scheduleMeta, flushMeta] = useDebouncedSave((patch) => api.put(`/rundowns/${id}`, patch), onStatus);

  const starts = useMemo(() => {
    let acc = 0;
    return (rundown?.parts || []).map((p) => {
      const s = acc;
      acc += p.duration;
      return s;
    });
  }, [rundown]);

  if (!rundown || !meta) return <Spinner />;

  const total = rundown.parts.reduce((s, p) => s + p.duration, 0);

  const changeMeta = (field) => (value) => {
    const next = { ...meta, [field]: value };
    if (field === 'date' && !value) next.time = '';
    setMeta(next);
    if (field === 'title' && !value.trim()) return; // se valida al salir del campo
    scheduleMeta({ [field]: value || null, ...(field === 'date' && !value ? { time: null } : {}) });
  };

  const run = async (fn) => {
    setStatus('saving');
    try {
      const r = await fn();
      if (r?.parts) setRundown(r);
      setStatus('saved');
      onListChange();
      return r;
    } catch (err) {
      setStatus('error');
      toast(err.message, 'error');
      return null;
    }
  };

  const addPart = async (after) => {
    const r = await run(() => api.post(`/rundowns/${id}/parts`, { title: '', after }));
    if (r) {
      const idx = after ? r.parts.findIndex((p) => p.id === after) + 1 : r.parts.length - 1;
      setFocusPartId(r.parts[idx]?.id);
    }
  };

  const saveOrder = (parts) => {
    setRundown((r) => ({ ...r, parts }));
    run(() => api.put(`/rundowns/${id}/order`, { ids: parts.map((p) => p.id) }));
  };

  const movePart = (partId, dir) => {
    const parts = [...rundown.parts];
    const i = parts.findIndex((p) => p.id === partId);
    const j = i + dir;
    if (j < 0 || j >= parts.length) return;
    [parts[i], parts[j]] = [parts[j], parts[i]];
    saveOrder(parts);
  };

  const deletePart = (part, fields) => {
    const hasText = fields.title.trim() || fields.content.trim() || fields.notes.trim();
    if (hasText && !window.confirm(`¿Eliminar la parte "${fields.title || 'sin título'}"?`)) return;
    run(() => api.del(`/parts/${part.id}`));
  };

  const dragHandlers = {
    onStart: (partId) => setDragId(partId),
    onEnd: () => {
      setDragId(null);
      setOverId(null);
    },
    onOver: (e, partId) => {
      if (!dragId) return;
      e.preventDefault();
      if (overId !== partId) setOverId(partId);
    },
    onDrop: (e, targetId) => {
      e.preventDefault();
      if (!dragId || dragId === targetId) return;
      const parts = [...rundown.parts];
      const from = parts.findIndex((p) => p.id === dragId);
      const [moved] = parts.splice(from, 1);
      const to = parts.findIndex((p) => p.id === targetId);
      // Si se arrastra hacia abajo, queda detrás del destino; hacia arriba, delante.
      parts.splice(from <= to ? to + 1 : to, 0, moved);
      setDragId(null);
      setOverId(null);
      saveOrder(parts);
    },
  };

  const dropStateFor = (partId) => {
    if (partId === dragId) return 'dragging';
    if (partId !== overId || !dragId) return '';
    const from = rundown.parts.findIndex((p) => p.id === dragId);
    const to = rundown.parts.findIndex((p) => p.id === partId);
    return from < to ? 'drop-below' : 'drop-above';
  };

  const duplicate = async () => {
    await flushMeta();
    const copy = await run(() => api.post(`/rundowns/${id}/duplicate`));
    if (copy) {
      toast('Escaleta duplicada.');
      navigate(`/escaleta/${copy.id}`);
    }
  };

  const remove = async () => {
    if (!window.confirm(`¿Eliminar la escaleta "${rundown.title}" y todas sus partes? No se puede deshacer.`)) return;
    try {
      await api.del(`/rundowns/${id}`);
      toast('Escaleta eliminada.');
      onListChange();
      const next = list.find((r) => r.id !== rundown.id);
      navigate(next ? `/escaleta/${next.id}` : '/escaleta', { replace: true });
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const create = async () => {
    try {
      const r = await api.post('/rundowns', {});
      onListChange();
      navigate(`/escaleta/${r.id}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="page rundown-page">
      <div className="page-header no-print">
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <Clapperboard size={22} />
          <select className="select" style={{ width: 'auto', minWidth: 220, fontWeight: 600 }} value={id} onChange={(e) => navigate(`/escaleta/${e.target.value}`)} aria-label="Elegir escaleta">
            {list.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
          <button className="btn" onClick={create}>
            <Plus size={15} /> Nueva escaleta
          </button>
        </div>
        <div className="btn-row">
          <span className="save-status" aria-live="polite">
            {status === 'saving' && (
              <>
                <Spinner size={13} /> Guardando…
              </>
            )}
            {status === 'saved' && (
              <>
                <Check size={13} /> Guardado
              </>
            )}
          </span>
          <div className="segmented">
            <button className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>
              <Pencil size={13} /> Editar
            </button>
            <button className={mode === 'view' ? 'active' : ''} onClick={() => setMode('view')}>
              <Eye size={13} /> Ver
            </button>
          </div>
          <button className="btn icon" onClick={() => window.print()} title="Imprimir" aria-label="Imprimir">
            <Printer size={16} />
          </button>
          <button className="btn icon" onClick={duplicate} title="Duplicar escaleta" aria-label="Duplicar escaleta">
            <Copy size={16} />
          </button>
          <button className="btn icon danger" onClick={remove} title="Eliminar escaleta" aria-label="Eliminar escaleta">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <section className="card rundown-meta">
        <input
          className="title-input"
          value={meta.title}
          maxLength={200}
          placeholder="Título de la escaleta"
          onChange={(e) => changeMeta('title')(e.target.value)}
          onBlur={() => {
            if (!meta.title.trim()) {
              setMeta((m) => ({ ...m, title: rundown.title }));
              toast('La escaleta necesita un título.', 'error');
            } else flushMeta();
          }}
          aria-label="Título de la escaleta"
          readOnly={mode === 'view'}
        />
        <div className="rundown-meta-row">
          <label className="row small" style={{ gap: 6 }}>
            <span className="muted">Fecha</span>
            <input type="date" className="input sm" value={meta.date} onChange={(e) => changeMeta('date')(e.target.value)} disabled={mode === 'view'} />
          </label>
          <label className="row small" style={{ gap: 6 }}>
            <span className="muted">Hora</span>
            <input type="time" className="input sm" value={meta.time} onChange={(e) => changeMeta('time')(e.target.value)} disabled={mode === 'view' || !meta.date} />
          </label>
          <span className="spacer" />
          <span className="rundown-summary">
            {rundown.parts.length} {rundown.parts.length === 1 ? 'parte' : 'partes'} · <Timer size={14} /> <strong>{formatDuration(total)}</strong>
          </span>
        </div>
        {mode === 'edit' ? (
          <>
            <AutoTextarea
              className="part-text"
              value={meta.description}
              placeholder="Descripción u objetivo (opcional)"
              onChange={changeMeta('description')}
              onBlur={flushMeta}
            />
            {meta.description && <p className="pre muted print-only">{meta.description}</p>}
          </>
        ) : (
          meta.description && <p className="pre muted">{meta.description}</p>
        )}
        {meta.date && <span className="muted small print-only">{formatDayKey(meta.date, { long: true })}{meta.time ? `, ${meta.time}` : ''}</span>}
      </section>

      {mode === 'edit' ? (
        <div className="no-print">
          <ol className="part-list">
            {rundown.parts.map((p, i) => (
              <PartRow
                key={p.id}
                part={p}
                index={i}
                total={rundown.parts.length}
                start={starts[i]}
                autoFocus={p.id === focusPartId}
                onStatus={onStatus}
                onDurationChange={(partId, duration) =>
                  setRundown((r) => ({ ...r, parts: r.parts.map((x) => (x.id === partId ? { ...x, duration } : x)) }))
                }
                onMove={movePart}
                onAddBelow={addPart}
                onDelete={deletePart}
                dragHandlers={dragHandlers}
                dropState={dropStateFor(p.id)}
              />
            ))}
          </ol>
          {!rundown.parts.length && <EmptyState icon={Clapperboard} title="Esta escaleta no tiene partes" />}
          <button className="btn add-part" onClick={() => addPart()}>
            <Plus size={15} /> Añadir parte
          </button>
        </div>
      ) : (
        <RundownTable rundown={rundown} starts={starts} />
      )}

      {mode === 'edit' && (
        <div className="print-only">
          <RundownTable rundown={rundown} starts={starts} />
        </div>
      )}
    </div>
  );
}

export function RundownPage() {
  const { id } = useParams();
  const { toast } = useApp();
  const navigate = useNavigate();
  const { data: list, reload } = useData(() => api.get('/rundowns'));
  const [creating, setCreating] = useState(false);

  if (!list) return <Spinner />;

  if (!id) {
    if (list.length) {
      const last = recall();
      const target = list.find((r) => r.id === last) || list[0];
      return <Navigate to={`/escaleta/${target.id}`} replace />;
    }
    return (
      <div className="page">
        <div className="page-header">
          <div>
            <h1>Escaleta</h1>
            <p>Organiza por partes un vídeo, directo o programa: qué pasa en cada bloque y cuánto dura.</p>
          </div>
        </div>
        <div className="card">
          <EmptyState
            icon={Clapperboard}
            title="Aún no tienes ninguna escaleta"
            action={
              <button
                className="btn primary"
                disabled={creating}
                onClick={async () => {
                  setCreating(true);
                  try {
                    const r = await api.post('/rundowns', {});
                    await reload();
                    navigate(`/escaleta/${r.id}`);
                  } catch (err) {
                    toast(err.message, 'error');
                    setCreating(false);
                  }
                }}
              >
                <Plus size={15} /> Crear escaleta
              </button>
            }
          >
            Empieza con una plantilla (intro, bloque y cierre) y modifícala a tu gusto.
          </EmptyState>
        </div>
      </div>
    );
  }

  return <RundownEditor key={id} id={Number(id)} list={list} onListChange={reload} />;
}
