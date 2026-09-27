import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCog, CircleCheck, CircleX, Clapperboard, Plus, Trash2, User, UsersRound } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useData } from '../context.jsx';
import { capitalize, parseKey, todayKey } from '../dates.js';
import { EmptyState, Modal, Spinner } from '../components/ui.jsx';

const STATUS_LABEL = { disponible: 'Disponible', no_disponible: 'No disponible' };
const NEXT_STATUS = { none: 'disponible', disponible: 'no_disponible', no_disponible: null };
const cellKey = (userId, date) => `${userId}|${date}`;

const dayFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
const shortFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
const dayLabel = (date) => capitalize(dayFmt.format(parseKey(date)).replace('.', ''));
const shortDay = (date) => `${parseKey(date).getDate()}/${parseKey(date).getMonth() + 1}`;

/**
 * Agrupa los días en eventos: días seguidos con el mismo nombre forman un
 * evento. Los días "no principales" se etiquetan como previos o posteriores.
 */
function groupEvents(days) {
  const groups = [];
  for (const d of days) {
    const last = groups.at(-1);
    const prev = last?.days.at(-1);
    const consecutive = prev && (parseKey(d.date) - parseKey(prev.date)) / 86_400_000 <= 1.5;
    if (last && last.event === d.event && consecutive) last.days.push(d);
    else groups.push({ event: d.event, days: [d] });
  }
  for (const g of groups) {
    const mains = g.days.filter((d) => d.main).map((d) => d.date);
    for (const d of g.days) {
      if (d.main) d.tag = null;
      else d.tag = mains.length && d.date > mains.at(-1) ? 'Día posterior' : 'Día previo';
    }
    const first = g.days[0].date;
    const last = g.days.at(-1).date;
    g.range =
      first === last
        ? shortFmt.format(parseKey(first))
        : `${parseKey(first).getDate()}–${shortFmt.format(parseKey(last))}`;
    g.key = first;
  }
  return groups;
}

function EventDaysEditor({ days, onClose, onChanged }) {
  const { toast } = useApp();
  const [form, setForm] = useState({ date: '', event: '', main: true });
  const [busy, setBusy] = useState(false);
  const names = [...new Set(days.map((d) => d.event))];

  async function run(fn) {
    setBusy(true);
    try {
      onChanged(await fn());
      return true;
    } catch (err) {
      toast(err.message, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const add = async (e) => {
    e.preventDefault();
    if (await run(() => api.post('/availability/days', form))) setForm((f) => ({ ...f, date: '' }));
  };

  return (
    <Modal title="Días de evento" onClose={onClose} size="md">
      <div className="modal-body stack">
        <p className="muted small">
          Solo se pide disponibilidad para estos días. Los días previos o posteriores aparecen entre paréntesis en la
          tabla del equipo.
        </p>
        <ul className="event-days-list">
          {days.map((d) => (
            <li key={d.date}>
              <span className="nowrap">{d.main ? dayLabel(d.date) : `(${dayLabel(d.date)})`}</span>
              <span className="muted">
                {d.event}
                {!d.main && ' · previo/posterior'}
              </span>
              <span className="spacer" />
              <button
                className="btn ghost icon sm danger"
                disabled={busy}
                aria-label={`Quitar ${d.date}`}
                onClick={() => run(() => api.del(`/availability/days/${d.date}`))}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
          {!days.length && <li className="muted">No hay días de evento.</li>}
        </ul>
        <form className="event-day-form" onSubmit={add}>
          <input type="date" className="input" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} aria-label="Fecha" />
          <input
            className="input"
            required
            list="event-names"
            placeholder="Evento (p. ej. Major)"
            maxLength={60}
            value={form.event}
            onChange={(e) => setForm({ ...form, event: e.target.value })}
            aria-label="Evento"
          />
          <datalist id="event-names">
            {names.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <label className="checkbox small">
            <input type="checkbox" checked={!form.main} onChange={(e) => setForm({ ...form, main: !e.target.checked })} />
            <span>Día previo o posterior</span>
          </label>
          <button className="btn primary" disabled={busy}>
            <Plus size={15} /> Añadir
          </button>
        </form>
      </div>
    </Modal>
  );
}

function MyAvailability({ groups, entries, me, events, onSave }) {
  const today = todayKey();
  return (
    <div className="stack lg">
      {groups.map((g) => (
        <section key={g.key} className="card event-card">
          <div className="card-header">
            <h2>{g.event}</h2>
            <span className="muted">{g.range}</span>
          </div>
          <ul className="event-day-rows">
            {g.days.map((d) => {
              const entry = entries.get(cellKey(me.id, d.date));
              const dayEvents = events.get(d.date) || [];
              return (
                <li key={d.date} className={`${d.date < today ? 'past' : ''} ${entry?.status || ''}`}>
                  <div className="event-day-info">
                    <strong>{dayLabel(d.date)}</strong>
                    {d.tag && <span className="day-tag">{d.tag}</span>}
                    {dayEvents.map((r) => (
                      <span key={r.id} className="avail-event">
                        <Clapperboard size={12} /> {r.time && `${r.time} · `}
                        {r.title}
                      </span>
                    ))}
                  </div>
                  <div className="event-day-actions">
                    {['disponible', 'no_disponible'].map((s) => (
                      <button
                        key={s}
                        className={`answer ${s} ${entry?.status === s ? 'on' : ''}`}
                        aria-pressed={entry?.status === s}
                        onClick={() => onSave(me.id, d.date, entry?.status === s ? null : s)}
                      >
                        {s === 'disponible' ? <CircleCheck size={15} /> : <CircleX size={15} />} {STATUS_LABEL[s]}
                      </button>
                    ))}
                    <NoteInput entry={entry} onSave={(note) => onSave(me.id, d.date, entry.status, note)} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function NoteInput({ entry, onSave }) {
  const [note, setNote] = useState(entry?.note || '');
  useEffect(() => setNote(entry?.note || ''), [entry?.note]);
  const commit = () => entry && note.trim() !== (entry.note || '') && onSave(note.trim());
  return (
    <input
      className="input sm note-input"
      placeholder={entry ? 'Nota (opcional)' : 'Marca primero si puedes'}
      disabled={!entry}
      maxLength={200}
      value={note}
      onChange={(e) => setNote(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      aria-label="Nota"
    />
  );
}

function TeamTable({ groups, users, entries, me, events, onSave }) {
  const today = todayKey();
  const allDays = groups.flatMap((g) => g.days);
  const canEdit = (userId) => userId === me.id || me.is_admin;

  return (
    <div className="card avail-team-wrap">
      <table className="avail-team">
        <thead>
          <tr>
            <th className="who" rowSpan={2}>
              Persona
            </th>
            {groups.map((g) => (
              <th key={g.key} colSpan={g.days.length} className="event-head">
                {g.event}
              </th>
            ))}
          </tr>
          <tr>
            {allDays.map((d) => (
              <th
                key={d.date}
                className={`${d.main ? '' : 'secondary'} ${events.get(d.date) ? 'event' : ''} ${d.date < today ? 'past' : ''}`}
                title={`${dayLabel(d.date)}${d.tag ? ` · ${d.tag}` : ''}${events.get(d.date) ? ` · Escaleta: ${events.get(d.date).map((r) => r.title).join(', ')}` : ''}`}
              >
                <span className="wd">{dayLabel(d.date).slice(0, 3)}</span>
                <span className="dn">{d.main ? shortDay(d.date) : `(${shortDay(d.date)})`}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className={u.id === me.id ? 'me' : ''}>
              <th className="who">
                {u.name}
                {u.id === me.id && <span className="muted small"> (tú)</span>}
              </th>
              {allDays.map((d) => {
                const entry = entries.get(cellKey(u.id, d.date));
                const editable = canEdit(u.id);
                return (
                  <td
                    key={d.date}
                    className={`avail-cell ${entry?.status || ''} ${editable ? 'editable' : ''} ${d.date < today ? 'past' : ''}`}
                    title={`${u.name} · ${dayLabel(d.date)} · ${entry ? STATUS_LABEL[entry.status] : 'sin responder'}${entry?.note ? ` · ${entry.note}` : ''}${editable ? ' (clic para cambiar)' : ''}`}
                    onClick={() => editable && onSave(u.id, d.date, NEXT_STATUS[entry?.status || 'none'])}
                  >
                    {entry?.status === 'disponible' ? '✓' : entry?.status === 'no_disponible' ? '✗' : ''}
                    {entry?.note && <span className="dot" />}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th className="who">Disponibles</th>
            {allDays.map((d) => {
              const n = users.filter((u) => entries.get(cellKey(u.id, d.date))?.status === 'disponible').length;
              return (
                <td key={d.date} className={`total ${n ? 'some' : ''}`}>
                  {n}/{users.length}
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function AvailabilityPage() {
  const { me, can, toast } = useApp();
  const { data, loading, setData } = useData(() => api.get('/availability'));
  // Directos programados (escaletas) de esos días, si el usuario puede verlas.
  const { data: rundowns } = useData(() => (can('escaleta') ? api.get('/rundowns') : []));
  const [view, setView] = useState(null);
  const [entries, setEntries] = useState(new Map());
  const [editingDays, setEditingDays] = useState(false);

  useEffect(() => {
    if (data) setEntries(new Map(data.entries.map((e) => [cellKey(e.user_id, e.date), e])));
  }, [data]);

  const groups = useMemo(() => groupEvents((data?.days || []).map((d) => ({ ...d }))), [data]);
  const events = useMemo(() => Map.groupBy((rundowns || []).filter((r) => r.date), (r) => r.date), [rundowns]);

  const save = useCallback(
    async (userId, date, status, note) => {
      const key = cellKey(userId, date);
      const before = entries.get(key);
      const nextNote = note ?? before?.note ?? '';
      setEntries((m) => {
        const next = new Map(m);
        if (status) next.set(key, { user_id: userId, date, status, note: nextNote });
        else next.delete(key);
        return next;
      });
      try {
        await api.put(`/availability/${date}`, { status, note: nextNote, ...(userId !== me.id ? { user_id: userId } : {}) });
      } catch (err) {
        toast(err.message, 'error');
        setEntries((m) => {
          const next = new Map(m);
          if (before) next.set(key, before);
          else next.delete(key);
          return next;
        });
      }
    },
    [entries, me.id, toast],
  );

  if (loading && !data) return <Spinner />;
  if (!data) return null;

  const effectiveView = view || (data.me_in_team ? 'mine' : 'team');
  const answered = data.days.filter((d) => entries.has(cellKey(me.id, d.date))).length;
  const available = data.days.filter((d) => entries.get(cellKey(me.id, d.date))?.status === 'disponible').length;

  return (
    <div className="page" style={{ maxWidth: 1180 }}>
      <div className="page-header">
        <div>
          <h1>Disponibilidad</h1>
          <p>Marca si puedes en cada día de evento de la temporada.</p>
        </div>
        <div className="btn-row">
          {me.is_admin && (
            <button className="btn" onClick={() => setEditingDays(true)}>
              <CalendarCog size={15} /> Días de evento
            </button>
          )}
          <div className="segmented">
            {data.me_in_team && (
              <button className={effectiveView === 'mine' ? 'active' : ''} onClick={() => setView('mine')}>
                <User size={14} /> La mía
              </button>
            )}
            <button className={effectiveView === 'team' ? 'active' : ''} onClick={() => setView('team')}>
              <UsersRound size={14} /> Equipo
            </button>
          </div>
        </div>
      </div>

      {effectiveView === 'mine' && data.days.length > 0 && (
        <div className="card card-body stack" style={{ gap: 8 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>
              Has respondido {answered} de {data.days.length} días
            </strong>
            <span className="muted small">
              {available} disponible{available === 1 ? '' : 's'}
            </span>
          </div>
          <div className="progress">
            <div style={{ width: `${(answered / data.days.length) * 100}%` }} />
          </div>
        </div>
      )}

      {!data.days.length ? (
        <div className="card">
          <EmptyState icon={CalendarCog} title="No hay días de evento">
            {me.is_admin ? 'Añádelos con el botón "Días de evento".' : 'Un administrador tiene que añadirlos.'}
          </EmptyState>
        </div>
      ) : effectiveView === 'mine' ? (
        <MyAvailability groups={groups} entries={entries} me={me} events={events} onSave={save} />
      ) : data.users.length ? (
        <>
          <TeamTable groups={groups} users={data.users} entries={entries} me={me} events={events} onSave={save} />
          <div className="legend">
            <span>
              <i className="dot-av yes" /> Disponible
            </span>
            <span>
              <i className="dot-av no" /> No disponible
            </span>
            <span>
              <i className="dot-av" /> Sin responder
            </span>
            <span>(entre paréntesis) día previo o posterior</span>
            {can('escaleta') && (
              <span>
                <Clapperboard size={12} /> Línea dorada: día con escaleta
              </span>
            )}
            <span style={{ marginLeft: 'auto' }}>
              {me.is_admin ? 'Haz clic en una casilla para cambiarla.' : 'Haz clic en tus casillas para cambiarlas.'}
            </span>
          </div>
        </>
      ) : (
        <div className="card">
          <EmptyState icon={UsersRound} title="Nadie tiene todavía esta sección">
            Asigna el rol CASTER (u otro rol con la sección Disponibilidad) a las personas del equipo en "Usuarios y roles".
          </EmptyState>
        </div>
      )}

      {editingDays && (
        <EventDaysEditor days={data.days} onClose={() => setEditingDays(false)} onChanged={(days) => setData((d) => ({ ...d, days }))} />
      )}
    </div>
  );
}
