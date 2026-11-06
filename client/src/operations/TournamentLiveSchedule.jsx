import { useMemo, useState } from 'react';
import { Wand2 } from 'lucide-react';
import { autoFill, scheduleChanges, scheduleLocked, scheduleRows, toLocalInput, rowTimes, addMinutes } from './tournamentLiveModel.js';
import { ReasonConfirm, clock, roundTitle, t, when } from './tournamentLiveUi.jsx';

/**
 * Timetable by group matchday and playoff round. Rows come from the generated
 * matches, so 4, 12, 16, 33 or 128 entrants and 3, 4 or 5 matchdays all work
 * the same way. Staff set a start per row (optionally staggered), review the
 * preview and save every change with one reason.
 */
export default function TournamentLiveSchedule({ matches, tournament, runMany, busy }) {
  const rows = useMemo(() => scheduleRows(matches), [matches]);
  const [plan, setPlan] = useState({});
  const [first, setFirst] = useState(() => {
    const pending = rows.find(row => row.matches.some(match => !scheduleLocked(match)));
    return toLocalInput(pending?.matches.find(match => match.scheduled_at)?.scheduled_at || tournament.start_at);
  });
  const [gap, setGap] = useState(60);
  const [progress, setProgress] = useState(null);
  const changes = useMemo(() => scheduleChanges(rows, plan), [rows, plan]);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const update = (key, patch) => setPlan(current => ({ ...current, [key]: { stagger: 0, ...current[key], ...patch } }));

  if (!rows.length) return <p className="op-live-empty">{t('planner.empty')}</p>;
  async function save(reason) {
    setProgress({ done: 0, total: changes.length });
    const problem = await runMany(changes.map(change => ({ action: 'schedule_match', match_id: change.match_id, scheduled_at: change.scheduled_at, reason })),
      done => setProgress({ done, total: changes.length }));
    setProgress(null);
    if (!problem) setPlan({});
    return problem;
  }

  return <div className="op-live-planner">
    <p className="op-help">{t('planner.help')}</p>
    <section className="op-live-autofill" aria-label={t('planner.auto.title')}>
      <h3><Wand2 size={16} /> {t('planner.auto.title')}</h3>
      <div className="op-live-autofill-grid">
        <label className="op-field"><span>{t('planner.auto.first')}</span><input type="datetime-local" value={first} disabled={busy} onChange={event => setFirst(event.target.value)} /></label>
        <label className="op-field"><span>{t('planner.auto.gap')}</span><input type="number" min="0" max="720" step="5" value={gap} disabled={busy} onChange={event => setGap(Number(event.target.value))} /></label>
        <button type="button" className="btn" disabled={busy || !first} onClick={() => setPlan(current => {
          const filled = autoFill(rows, first, gap);
          return Object.fromEntries(rows.map(row => [row.key, { stagger: current[row.key]?.stagger ?? 0, ...filled[row.key] }]));
        })}>{t('planner.auto.apply')}</button>
      </div>
      <small>{t('planner.auto.hint', { zone })}</small>
    </section>

    <div className="op-live-rows" role="table" aria-label={t('planner.title')}>
      <div className="op-live-row is-head" role="row">
        <span role="columnheader">{t('planner.columns.round')}</span><span role="columnheader">{t('planner.columns.now')}</span>
        <span role="columnheader">{t('planner.columns.start')}</span><span role="columnheader">{t('planner.columns.stagger')}</span><span role="columnheader">{t('planner.columns.preview')}</span>
      </div>
      {rows.map((row, index) => {
        const entry = plan[row.key] || {}, times = rowTimes(row);
        const open = row.matches.filter(match => !scheduleLocked(match));
        const last = entry.start && open.length ? addMinutes(entry.start, (open.length - 1) * (Number(entry.stagger) || 0)) : '';
        const stageChanged = index > 0 && rows[index - 1].stage !== row.stage;
        return <div className={`op-live-row${stageChanged ? ' is-stage' : ''}${entry.start ? ' is-planned' : ''}`} role="row" key={row.key}>
          <span role="cell"><strong>{roundTitle(row)}</strong><small>{t(`bracket.stages.${row.stage}`)} · {t('planner.matches', { count: row.matches.length })}{open.length < row.matches.length && ` · ${t('planner.locked', { count: row.matches.length - open.length })}`}</small></span>
          <span role="cell">{times.kind === 'none' ? <em>{t('planner.unscheduled')}</em> : times.kind === 'single' ? when(times.first) : t('planner.range', { first: when(times.first), last: clock(times.last) })}
            {times.kind !== 'none' && times.missing > 0 && <small>{t('planner.missing', { count: times.missing })}</small>}</span>
          <span role="cell"><input type="datetime-local" aria-label={t('planner.startFor', { round: roundTitle(row) })} value={entry.start || ''} disabled={busy || !open.length}
            onChange={event => update(row.key, { start: event.target.value })} /></span>
          <span role="cell"><select aria-label={t('planner.staggerFor', { round: roundTitle(row) })} value={entry.stagger ?? 0} disabled={busy || open.length < 2}
            onChange={event => update(row.key, { stagger: Number(event.target.value) })}>
            {[0, 10, 15, 20, 30, 45, 60, 90].map(minutes => <option key={minutes} value={minutes}>{minutes ? t('planner.every', { minutes }) : t('planner.together')}</option>)}
          </select></span>
          <span role="cell">{entry.start ? (last && last !== entry.start ? t('planner.range', { first: when(entry.start), last: clock(last) }) : when(entry.start)) : '—'}
            {entry.start && <button type="button" className="op-text-button" disabled={busy} onClick={() => setPlan(current => { const next = { ...current }; delete next[row.key]; return next; })}>{t('planner.undo')}</button>}</span>
        </div>;
      })}
    </div>

    <section className="op-live-save" aria-label={t('planner.save')}>
      <h3>{changes.length ? t('planner.summary', { count: changes.length }) : t('planner.nothing')}</h3>
      {changes.length > 0 && <p className="op-live-hint">{t('planner.notify')}</p>}
      {progress && <div className="op-live-progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
        <span style={{ width: `${Math.round(progress.done / Math.max(progress.total, 1) * 100)}%` }} /><small>{t('planner.progress', { done: progress.done, total: progress.total })}</small></div>}
      {changes.length > 0 || progress
        ? <ReasonConfirm busy={busy} presets={['schedule.plan', 'schedule.delay', 'schedule.agreed']}
          submitLabel={t('planner.apply', { count: changes.length })} onSubmit={save} />
        : <p className="op-live-hint">{t('planner.nothingHint')}</p>}
    </section>
  </div>;
}
