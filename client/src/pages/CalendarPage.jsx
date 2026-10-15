import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Clapperboard, Lightbulb, Plus } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useData } from '../context.jsx';
import { PLATFORMS, PLATFORM_IDS, STATUSES } from '../../../shared/catalog.js';
import { WEEKDAYS_SHORT, addDays, formatMonth, isSameDay, parseKey, startOfDay, startOfWeek, toKey, todayKey } from '../dates.js';
import { LoadError, OwnerBadge, PlatformIcon, PlatformList, ResourceProgress, StatusBadge } from '../components/ui.jsx';

const VIEW_KEY = 'mrm:calendarView';
const MAX_CHIPS = 3;
const UNSCHEDULED = 'unscheduled';

function readView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'week' ? 'week' : 'month';
  } catch {
    return 'month';
  }
}

function sortByTime(a, b) {
  return (a.time || '99:99').localeCompare(b.time || '99:99') || a.id - b.id;
}

/** Tarjeta pequeña para las celdas del mes. */
function ContentChip({ content, onOpen, onDrag }) {
  return (
    <button
      className={`cal-chip status-${content.status}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', String(content.id));
        e.dataTransfer.effectAllowed = 'move';
        onDrag(content);
      }}
      onDragEnd={() => onDrag(null)}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(content);
      }}
      title={[content.title, content.time, content.owner && `Responsable: ${content.owner}`].filter(Boolean).join(' · ')}
    >
      <PlatformList platforms={content.platforms} size={11} />
      {content.time && <span className="t">{content.time}</span>}
      <span className="s">{content.title}</span>
    </button>
  );
}

/** Tarjeta completa para la vista semanal y la lista de ideas. */
function ContentCard({ content, onOpen, onDrag }) {
  return (
    <button
      className={`content-card status-${content.status}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', String(content.id));
        e.dataTransfer.effectAllowed = 'move';
        onDrag(content);
      }}
      onDragEnd={() => onDrag(null)}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(content);
      }}
    >
      <span className="content-card-title">{content.title}</span>
      {content.description && <span className="content-card-desc">{content.description}</span>}
      <span className="content-card-meta">
        <StatusBadge status={content.status} />
        {content.time && <span className="muted small">{content.time}</span>}
        <OwnerBadge owner={content.owner} />
        <span className="spacer" />
        <ResourceProgress resources={content.resources} />
        <PlatformList platforms={content.platforms} withFormat size={12} />
      </span>
    </button>
  );
}

function RundownChip({ rundown, onOpen }) {
  return (
    <button
      className="cal-chip rundown"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(rundown);
      }}
      title={`Escaleta: ${rundown.title}`}
    >
      <Clapperboard size={12} />
      {rundown.time && <span className="t">{rundown.time}</span>}
      <span className="s">{rundown.title}</span>
    </button>
  );
}

export function CalendarPage() {
  const { openContent, toast, bump, can } = useApp();
  const navigate = useNavigate();
  const [view, setView] = useState(readView);
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [platformFilter, setPlatformFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [dropTarget, setDropTarget] = useState(null);
  const dragging = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* sin almacenamiento local: no pasa nada */
    }
  }, [view]);

  const range = useMemo(() => {
    if (view === 'week') return { start: startOfWeek(cursor), days: 7 };
    return { start: startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1)), days: 42 };
  }, [view, cursor]);
  const fromKey = toKey(range.start);
  const toKeyExclusive = toKey(addDays(range.start, range.days));

  const contentsRequest = useData(() => api.get(`/contents?from=${fromKey}&to=${toKeyExclusive}`), [fromKey, toKeyExclusive]);
  const ideasRequest = useData(() => api.get('/contents?unscheduled=1'));
  // Las escaletas solo se muestran a quien tiene acceso a esa sección.
  const rundownsRequest = useData(() => (can('escaleta') ? api.get('/rundowns') : []));
  const ownersRequest = useData(() => api.get('/owners'));
  const { data: contents } = contentsRequest;
  const { data: ideas } = ideasRequest;
  const { data: rundowns } = rundownsRequest;
  const { data: owners } = ownersRequest;
  const requests = [contentsRequest, ideasRequest, rundownsRequest, ownersRequest];
  const loadError = requests.find(request => request.error)?.error;
  const refreshing = requests.some(request => request.loading);
  const retry = () => Promise.allSettled(requests.map(request => request.reload()));

  const matches = (c) =>
    (statusFilter === 'all' || c.status === statusFilter) &&
    (ownerFilter === 'all' || c.owner === ownerFilter) &&
    (!platformFilter.length || c.platforms.some((p) => platformFilter.includes(p.platform)));

  const byDay = useMemo(() => {
    const map = new Map();
    for (const c of (contents || []).filter(matches)) {
      if (!map.has(c.date)) map.set(c.date, []);
      map.get(c.date).push(c);
    }
    for (const list of map.values()) list.sort(sortByTime);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contents, statusFilter, ownerFilter, platformFilter]);

  const rundownsByDay = useMemo(() => Map.groupBy((rundowns || []).filter((r) => r.date), (r) => r.date), [rundowns]);
  const visibleIdeas = (ideas || []).filter(matches);

  const startDrag = (content) => {
    dragging.current = content;
    if (!content) setDropTarget(null);
  };

  async function moveTo(date) {
    const content = dragging.current;
    dragging.current = null;
    setDropTarget(null);
    if (!content || content.date === date) return;
    try {
      await api.patch(`/contents/${content.id}`, { date });
      toast(date ? `"${content.title}" movida a ${parseKey(date).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}.` : `"${content.title}" pasa a ideas sin fecha.`);
    } catch (err) {
      toast(err.message, 'error');
    }
    bump();
  }

  const dropProps = (key, date) => ({
    onDragOver: (e) => {
      if (!dragging.current) return;
      e.preventDefault();
      if (dropTarget !== key) setDropTarget(key);
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setDropTarget((t) => (t === key ? null : t));
    },
    onDrop: (e) => {
      e.preventDefault();
      moveTo(date);
    },
  });

  const openRundown = (r) => navigate(`/escaleta/${r.id}`);
  const openCard = (content) => openContent({ content });
  const days = Array.from({ length: range.days }, (_, i) => addDays(range.start, i));
  const today = new Date();

  const shift = (dir) => {
    if (view === 'week') setCursor((c) => addDays(c, dir * 7));
    else setCursor((c) => new Date(c.getFullYear(), c.getMonth() + dir, 1));
  };

  const weekEnd = addDays(range.start, 6);
  const shortMonth = (d) => d.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '');
  const title =
    view === 'month'
      ? formatMonth(cursor)
      : weekEnd.getMonth() === range.start.getMonth()
        ? `${range.start.getDate()} – ${weekEnd.getDate()} ${formatMonth(weekEnd)}`
        : `${range.start.getDate()} ${shortMonth(range.start)} – ${weekEnd.getDate()} ${shortMonth(weekEnd)} ${weekEnd.getFullYear()}`;

  const togglePlatform = (id) => setPlatformFilter((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));

  return (
    <div className="page wide">
      <div className="page-header">
        <div>
          <h1>Calendario de contenido</h1>
          <p>Haz clic en un día para crear una publicación. Arrastra las tarjetas para cambiarlas de día.</p>
        </div>
        <button className="btn primary" onClick={() => openContent()}>
          <Plus size={16} /> Nueva publicación
        </button>
      </div>

      <LoadError error={loadError} onRetry={retry} busy={refreshing} hasData={contents !== null || ideas !== null} />
      {refreshing && <p className="muted small" role="status">Actualizando calendario…</p>}
      <div className="calendar-layout" aria-busy={refreshing}>
        <div className="card calendar-card">
          <div className="card-header cal-toolbar">
            <div className="row" style={{ gap: 4 }}>
              <button className="btn icon sm" onClick={() => shift(-1)} aria-label="Anterior">
                <ChevronLeft size={16} />
              </button>
              <button className="btn icon sm" onClick={() => shift(1)} aria-label="Siguiente">
                <ChevronRight size={16} />
              </button>
              <button className="btn sm" onClick={() => setCursor(startOfDay(new Date()))}>
                Hoy
              </button>
            </div>
            <h2>{title}</h2>
            <span className="spacer" />
            <div className="filter-chips" role="group" aria-label="Filtrar por red">
              {PLATFORM_IDS.map((id) => (
                <button
                  key={id}
                  className={`filter-chip ${platformFilter.includes(id) ? 'on' : ''}`}
                  aria-pressed={platformFilter.includes(id)}
                  onClick={() => togglePlatform(id)}
                  title={`Mostrar solo ${PLATFORMS[id].label}`}
                >
                  <PlatformIcon platform={id} size={13} />
                </button>
              ))}
            </div>
            <select className="select sm" style={{ width: 'auto' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filtrar por estado">
              <option value="all">Todos los estados</option>
              {STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            {owners?.length > 0 && (
              <select className="select sm" style={{ width: 'auto' }} value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} aria-label="Filtrar por responsable">
                <option value="all">Todos los responsables</option>
                {owners.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            )}
            <div className="segmented">
              <button className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>
                Mes
              </button>
              <button className={view === 'week' ? 'active' : ''} onClick={() => setView('week')}>
                Semana
              </button>
            </div>
          </div>

          {view === 'month' ? (
            <div className="cal-month">
              {WEEKDAYS_SHORT.map((d) => (
                <div key={d} className="cal-head">
                  {d}
                </div>
              ))}
              {days.map((day) => {
                const key = toKey(day);
                const items = byDay.get(key) || [];
                const dayRundowns = rundownsByDay.get(key) || [];
                const chips = [...dayRundowns.map((r) => ({ type: 'rundown', r })), ...items.map((c) => ({ type: 'content', c }))];
                const classes = [
                  'cal-day',
                  day.getMonth() !== cursor.getMonth() && 'other',
                  isSameDay(day, today) && 'today',
                  key < todayKey() && 'past',
                  dropTarget === key && 'drop',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <div key={key} className={classes} onClick={() => openContent({ date: key })} {...dropProps(key, key)}>
                    <span className="cal-num">{day.getDate()}</span>
                    {chips.slice(0, MAX_CHIPS).map((x) =>
                      x.type === 'rundown' ? (
                        <RundownChip key={`r${x.r.id}`} rundown={x.r} onOpen={openRundown} />
                      ) : (
                        <ContentChip key={x.c.id} content={x.c} onOpen={openCard} onDrag={startDrag} />
                      ),
                    )}
                    {chips.length > MAX_CHIPS && (
                      <button
                        className="cal-more btn ghost sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCursor(day);
                          setView('week');
                        }}
                      >
                        +{chips.length - MAX_CHIPS} más
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="cal-week-cols">
              {days.map((day, i) => {
                const key = toKey(day);
                const items = byDay.get(key) || [];
                const dayRundowns = rundownsByDay.get(key) || [];
                return (
                  <div
                    key={key}
                    className={`cal-col ${isSameDay(day, today) ? 'today' : ''} ${dropTarget === key ? 'drop' : ''}`}
                    onClick={() => openContent({ date: key })}
                    {...dropProps(key, key)}
                  >
                    <div className="cal-col-head">
                      <span>{WEEKDAYS_SHORT[i]}</span>
                      <span className="d">{day.getDate()}</span>
                    </div>
                    {dayRundowns.map((r) => (
                      <RundownChip key={`r${r.id}`} rundown={r} onOpen={openRundown} />
                    ))}
                    {items.map((c) => (
                      <ContentCard key={c.id} content={c} onOpen={openCard} onDrag={startDrag} />
                    ))}
                    <span className="cal-col-add">
                      <Plus size={14} /> Añadir
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <aside className={`card ideas-panel ${dropTarget === UNSCHEDULED ? 'drop' : ''}`} {...dropProps(UNSCHEDULED, null)}>
          <div className="card-header">
            <div className="row" style={{ gap: 8 }}>
              <Lightbulb size={16} />
              <h2>Ideas sin fecha</h2>
            </div>
            <button className="btn ghost icon sm" onClick={() => openContent()} aria-label="Nueva idea" title="Nueva idea">
              <Plus size={16} />
            </button>
          </div>
          <div className="ideas-list">
            {visibleIdeas.map((c) => (
              <ContentCard key={c.id} content={c} onOpen={openCard} onDrag={startDrag} />
            ))}
            {!visibleIdeas.length && (
              <p className="muted small" style={{ padding: '4px 2px' }}>
                {ideas?.length ? 'Ninguna idea coincide con los filtros.' : 'Guarda aquí ideas sin fecha y arrástralas al calendario cuando decidas cuándo publicarlas.'}
              </p>
            )}
          </div>
        </aside>
      </div>

      <div className="legend">
        {STATUSES.map((s) => (
          <span key={s.id}>
            <i className={`dot status-${s.id}`} /> {s.label}
          </span>
        ))}
        {can('escaleta') && (
          <span>
            <Clapperboard size={12} /> Escaleta
          </span>
        )}
      </div>
    </div>
  );
}
