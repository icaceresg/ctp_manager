import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Network, RefreshCw, Users } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Modal } from '../components/ui.jsx';
import { LIVE_STATUS_TRANSITIONS, counts } from './tournamentLiveModel.js';
import { ReasonConfirm, clockSeconds, statusLabel, t, tournamentLiveError } from './tournamentLiveUi.jsx';
import TournamentLiveBracket from './TournamentLiveBracket.jsx';
import TournamentLiveMatchPanel from './TournamentLiveMatchPanel.jsx';
import TournamentLiveSchedule from './TournamentLiveSchedule.jsx';
import TournamentLiveParticipants from './TournamentLiveParticipants.jsx';
import './tournament-live.css';

const POLL_MS = 10000;
const TABS = [['bracket', Network], ['schedule', CalendarClock], ['participants', Users]];

/**
 * Live tournament control for CTP administrators and referees: a bracket that
 * refreshes itself, a panel per match, a timetable planner and the entrant
 * list. Every change applies at once in CTP and is audited with its reason.
 */
export default function TournamentLiveDialog({ tournament, onClose, onChanged }) {
  const { toast } = useApp();
  const [live, setLive] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [tab, setTab] = useState('bracket'), [selectedId, setSelectedId] = useState(null);
  const [auto, setAuto] = useState(true), [updatedAt, setUpdatedAt] = useState(null), [statusOpen, setStatusOpen] = useState(false);
  const serial = useRef(0), liveRef = useRef(null), busyRef = useRef(false);
  liveRef.current = live; busyRef.current = busy;
  const base = `/operations/tournaments/${encodeURIComponent(tournament.id)}/live`;

  const load = useCallback(async ({ quiet = false } = {}) => {
    const request = ++serial.current;
    if (!quiet) setLoading(true);
    try {
      const value = await api.get(base);
      if (request !== serial.current) return;
      if (value?.revision !== liveRef.current?.revision) setLive(value);
      setUpdatedAt(new Date().toISOString()); setError('');
    } catch (cause) { if (request === serial.current && !quiet) setError(tournamentLiveError(cause)); }
    finally { if (!quiet) setLoading(false); }
  }, [base]);
  useEffect(() => { void load(); return () => { ++serial.current; }; }, [load]);
  // Live mode: refresh while the tab is visible and no change is being sent.
  useEffect(() => {
    if (!auto) return undefined;
    const timer = setInterval(() => { if (!document.hidden && !busyRef.current) void load({ quiet: true }); }, POLL_MS);
    return () => clearInterval(timer);
  }, [auto, load]);

  /** One audited write. Resolves to an error message, or null when applied. */
  const post = useCallback(async body => {
    const current = liveRef.current;
    if (!current) return t('error.unavailable');
    ++serial.current; // A refresh in flight must not overwrite the new state.
    try {
      const result = await api.post(base, { ...body, expected_revision: current.revision });
      liveRef.current = result; setLive(result); setUpdatedAt(new Date().toISOString());
      return null;
    } catch (cause) {
      if (cause?.status === 409 || cause?.message === 'manager.tournamentLive.error.conflict') void load({ quiet: true });
      return tournamentLiveError(cause);
    }
  }, [base, load]);
  const run = useCallback(async body => {
    if (busyRef.current) return t('error.busy');
    setBusy(true);
    const problem = await post(body);
    setBusy(false);
    if (!problem) { toast(t('toast.applied')); onChanged?.(); }
    return problem;
  }, [post, toast, onChanged]);
  /** Several writes in order (timetable); stops at the first refusal. */
  const runMany = useCallback(async (bodies, onProgress) => {
    if (busyRef.current) return t('error.busy');
    setBusy(true);
    let problem = null, done = 0;
    for (const body of bodies) {
      problem = await post(body);
      if (problem) break;
      onProgress?.(++done);
    }
    setBusy(false);
    if (done) { toast(t('toast.scheduled', { count: done })); onChanged?.(); }
    return problem ? t('error.partial', { done, total: bodies.length, problem }) : null;
  }, [post, toast, onChanged]);
  const findCandidates = useCallback(async query => {
    try { return { items: (await api.get(`${base}/candidates?${new URLSearchParams({ query })}`)).items || [] }; }
    catch (cause) { return { error: tournamentLiveError(cause) }; }
  }, [base]);

  const matches = live?.matches || [];
  const totals = useMemo(() => counts(matches), [matches]);
  const selected = matches.find(match => match.id === selectedId) || null;
  const status = live?.tournament.status;
  const title = t('title', { name: live?.tournament.name || tournament.name });

  return <Modal size="xl op-live-modal" title={title} onClose={busy ? undefined : onClose} closeLabel={t('close')}
    headerExtra={<div className="op-live-head">
      {status && <button type="button" className={`op-live-status is-${status}`} aria-expanded={statusOpen} onClick={() => setStatusOpen(value => !value)} title={t('status.change')}>{statusLabel(status)}</button>}
      <label className="op-live-auto"><input type="checkbox" checked={auto} onChange={event => setAuto(event.target.checked)} />
        <span className={`op-live-pulse${auto ? ' is-on' : ''}`} aria-hidden="true" />{t('live.toggle')}</label>
      {updatedAt && <small className="op-live-updated">{t('live.updated', { time: clockSeconds(updatedAt) })}</small>}
      <button type="button" className="btn sm" disabled={loading || busy} onClick={() => void load()} aria-label={t('refresh')} title={t('refresh')}><RefreshCw size={14} /></button>
    </div>}>
    <div className="op-live">
      {loading && !live && <p role="status" className="op-live-empty">{t('loading')}</p>}
      {error && <p className="op-error" role="alert">{error}</p>}
      {live && <>
        {statusOpen && <StatusControl status={status} busy={busy} run={async body => { const problem = await run(body); if (!problem) setStatusOpen(false); return problem; }} onClose={() => setStatusOpen(false)} />}
        <div className="op-live-summary">
          <span>{t('summary.done', { done: totals.confirmed, total: totals.total })}</span>
          <span className={totals.live ? 'is-live' : ''}>{t('summary.live', { count: totals.live })}</span>
          <span className={totals.attention ? 'is-alert' : ''}>{t('summary.attention', { count: totals.attention })}</span>
          <span>{t('summary.participants', { count: live.participants.length })}</span>
        </div>
        <nav className="op-live-tabs" role="tablist" aria-label={t('tabs.label')}>
          {TABS.map(([id, Icon]) => <button type="button" role="tab" key={id} aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}><Icon size={15} /> {t(`tabs.${id}`)}</button>)}
        </nav>
        {tab === 'bracket' && <div className={`op-live-split${selected ? ' has-panel' : ''}`}>
          <TournamentLiveBracket matches={matches} totals={totals} selectedId={selectedId} onSelect={setSelectedId} />
          {selected && <TournamentLiveMatchPanel key={selected.id} tournamentId={tournament.id} match={selected} matches={matches} participants={live.participants} run={run} busy={busy} onClose={() => setSelectedId(null)} />}
        </div>}
        {tab === 'schedule' && <TournamentLiveSchedule matches={matches} tournament={live.tournament} runMany={runMany} busy={busy} />}
        {tab === 'participants' && <TournamentLiveParticipants live={live} run={run} findCandidates={findCandidates} busy={busy} />}
      </>}
    </div>
  </Modal>;
}

function StatusControl({ status, busy, run, onClose }) {
  const transitions = LIVE_STATUS_TRANSITIONS[status] || [];
  const [next, setNext] = useState('');
  const reopening = value => status === 'finalizado' && value === 'en_curso';
  const describe = value => t(`status.describe.${reopening(value) ? 'reopen' : value}`);
  const presets = { en_curso: [reopening(next) ? 'status.reopen' : 'status.start'], finalizado: ['status.end'], cancelado: ['status.cancel'] }[next] || [];
  return <section className="op-live-status-panel" aria-label={t('status.change')}>
    <header><h3>{t('status.change')}</h3><button type="button" className="btn ghost sm" onClick={onClose}>{t('confirm.cancel')}</button></header>
    <p className="op-live-hint">{t('status.current', { status: statusLabel(status) })}</p>
    {!transitions.length ? <p className="op-live-why">{t('status.none')}</p> : <>
      <div className="op-live-scores" role="radiogroup" aria-label={t('status.choose')}>
        {transitions.map(value => <button type="button" role="radio" key={value} aria-checked={next === value} disabled={busy}
          className={`op-live-score-option is-wide${next === value ? ' is-active' : ''}`} onClick={() => setNext(value)}>
          <strong>{statusLabel(value)}</strong><small>{describe(value)}</small></button>)}
      </div>
      <ReasonConfirm busy={busy} danger={next === 'cancelado'} presets={presets}
        blockedReason={!next ? t('status.choose') : ''} submitLabel={next ? t('status.apply', { status: statusLabel(next) }) : t('status.change')}
        onSubmit={reason => run({ action: 'set_status', status: next, reason })} />
    </>}
  </section>;
}
