import { useState } from 'react';
import { CalendarDays, Check, ListChecks, Plus, X } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useData } from '../context.jsx';
import { dueWithin, formatWhen, todayKey } from '../dates.js';
import { EmptyState, OwnerBadge, PlatformList, Spinner, StatusBadge } from '../components/ui.jsx';

// Periodos: incluyen siempre lo atrasado, que es lo más urgente.
const PERIODS = [
  { id: '7', label: '7 días', days: 7 },
  { id: '30', label: '30 días', days: 30 },
  { id: 'all', label: 'Todo', days: null },
];

function ResourceGroup({ content, filter, onUpdated }) {
  const { toast, openContent, bump, can } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const done = content.resources.filter((r) => r.done).length;
  const visible = filter === 'pending' ? content.resources.filter((r) => !r.done) : content.resources;
  const overdue = content.date && content.date < todayKey() && done < content.resources.length;

  async function run(fn) {
    setBusy(true);
    try {
      onUpdated(await fn());
      bump(); // actualiza el contador de pendientes del menú
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const add = () => {
    const value = text.trim();
    if (!value) return;
    run(() => api.post(`/contents/${content.id}/resources`, { text: value }));
    setText('');
  };

  return (
    <section className="card resource-group">
      <div className="card-header">
        <div style={{ minWidth: 0 }}>
          {can('calendario') ? (
            <button className="link-button" onClick={() => openContent({ content })}>
              {content.title}
            </button>
          ) : (
            <span className="link-button static">{content.title}</span>
          )}
          <div className="row small muted" style={{ gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
            <span className={`row ${overdue ? 'overdue' : ''}`} style={{ gap: 4 }}>
              <CalendarDays size={13} /> {formatWhen(content.date, content.time)}
              {overdue && ' · atrasado'}
            </span>
            <StatusBadge status={content.status} />
            <OwnerBadge owner={content.owner} />
            <PlatformList platforms={content.platforms} withFormat size={12} />
          </div>
        </div>
        <div className="resource-count">
          <span className={done === content.resources.length ? 'complete' : ''}>
            {done}/{content.resources.length}
          </span>
          <div className="progress" style={{ width: 80 }}>
            <div style={{ width: `${(done / content.resources.length) * 100}%` }} />
          </div>
        </div>
      </div>
      <ul className="checklist-edit resource-list">
        {visible.map((r) => (
          <li key={r.id} className={r.done ? 'done' : ''}>
            <label className="checkbox">
              <input type="checkbox" checked={r.done} disabled={busy} onChange={(e) => run(() => api.patch(`/resources/${r.id}`, { done: e.target.checked }))} />
              <span>{r.text}</span>
            </label>
            <button className="btn ghost icon sm" aria-label={`Quitar ${r.text}`} disabled={busy} onClick={() => run(() => api.del(`/resources/${r.id}`))}>
              <X size={14} />
            </button>
          </li>
        ))}
        {!visible.length && (
          <li className="muted small" style={{ gap: 6 }}>
            <Check size={14} /> Todo listo
          </li>
        )}
      </ul>
      <div className="resource-add">
        <input
          className="input sm"
          placeholder="Añadir recurso…"
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn sm icon" onClick={add} disabled={!text.trim() || busy} aria-label="Añadir recurso">
          <Plus size={15} />
        </button>
      </div>
    </section>
  );
}

export function ResourcesPage() {
  const { openContent, can } = useApp();
  const [filter, setFilter] = useState('pending');
  const [period, setPeriod] = useState('30');
  const [owner, setOwner] = useState('all');
  const { data, loading, setData } = useData(() => api.get('/contents?with_resources=1'));

  const days = PERIODS.find((p) => p.id === period).days;
  const inScope = (data || []).filter((c) => (days === null || dueWithin(c, days)) && (owner === 'all' || c.owner === owner));
  const owners = [...new Set((data || []).map((c) => c.owner).filter(Boolean))].sort();
  const total = inScope.reduce((n, c) => n + c.resources.length, 0);
  const done = inScope.reduce((n, c) => n + c.resources.filter((r) => r.done).length, 0);
  const groups = filter === 'pending' ? inScope.filter((c) => c.resources.some((r) => !r.done)) : inScope;

  const replace = (updated) => setData((list) => list.map((c) => (c.id === updated.id ? updated : c)).filter((c) => c.resources.length));

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-header">
        <div>
          <h1>Recursos necesarios</h1>
          <p>Todo lo que hay que preparar para cada publicación. Márcalo como listo cuando lo tengas.</p>
        </div>
      </div>

      <div className="filter-bar">
        <div className="segmented" role="group" aria-label="Periodo">
          {PERIODS.map((p) => (
            <button key={p.id} className={period === p.id ? 'active' : ''} onClick={() => setPeriod(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        {owners.length > 0 && (
          <select className="select sm" style={{ width: 'auto' }} value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Filtrar por responsable">
            <option value="all">Todos los responsables</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        )}
        <span className="spacer" />
        <div className="segmented" role="group" aria-label="Mostrar">
          <button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>
            Pendientes ({total - done})
          </button>
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            Todos ({total})
          </button>
        </div>
      </div>
      {days !== null && <p className="muted small" style={{ marginTop: -10 }}>Publicaciones de los próximos {days} días, más las atrasadas.</p>}

      {total > 0 && (
        <div className="card card-body stack" style={{ gap: 8 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>
              {done} de {total} recursos listos
            </strong>
            <span className="muted small">{Math.round((done / total) * 100)}%</span>
          </div>
          <div className="progress">
            <div style={{ width: `${(done / total) * 100}%` }} />
          </div>
        </div>
      )}

      {loading && !data ? (
        <Spinner />
      ) : groups.length ? (
        groups.map((c) => <ResourceGroup key={c.id} content={c} filter={filter} onUpdated={replace} />)
      ) : (
        <div className="card">
          <EmptyState
            icon={ListChecks}
            title={data?.length ? '¡Todo listo!' : 'Aún no hay recursos'}
            action={
              !data?.length ? (
                can('calendario') && <button className="btn primary" onClick={() => openContent()}>
                  <Plus size={15} /> Nueva publicación
                </button>
              ) : (
                (period !== 'all' || owner !== 'all') && (
                  <button
                    className="btn"
                    onClick={() => {
                      setPeriod('all');
                      setOwner('all');
                    }}
                  >
                    Ver todo
                  </button>
                )
              )
            }
          >
            {data?.length
              ? days !== null
                ? `No queda nada pendiente en los próximos ${days} días.`
                : 'No queda nada pendiente con estos filtros.'
              : 'Añade recursos necesarios (música, b-roll, miniaturas…) desde cada publicación y aparecerán aquí.'}
          </EmptyState>
        </div>
      )}
    </div>
  );
}
