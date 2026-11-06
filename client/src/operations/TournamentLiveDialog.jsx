import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { LIVE_STATUS_TRANSITIONS, counts } from './tournamentLiveModel.js';
import { ReasonConfirm, statusLabel, t, tournamentLiveError } from './tournamentLiveUi.jsx';
import TournamentLiveBracket from './TournamentLiveBracket.jsx';
import TournamentLiveMatchPanel from './TournamentLiveMatchPanel.jsx';
import './tournament-live.css';

const POLL_MS = 10000;
const EMPTY = [];

function competitionMatch(row) {
  const side = letter => row[`entrant_${letter}_id`] ? {
    id: row[`entrant_${letter}_id`],
    kind: row[`entrant_${letter}_kind`],
    name: row[`team_${letter}_name`],
  } : null;
  return { ...row, entrant_a: side('a'), entrant_b: side('b') };
}

export function TournamentLivePanel({ tournament, onChanged, onParticipants, canEdit = false, canWrite = true, fallbackMatches = EMPTY, fallbackGroupOrder, refreshKey }) {
  const { toast } = useApp();
  const [live, setLive] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const serial = useRef(0), liveRef = useRef(null), busyRef = useRef(false);
  const base = `/operations/tournaments/${encodeURIComponent(tournament.id)}/live`;
  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!canEdit) return;
    const request = ++serial.current;
    if (!quiet) setLoading(true);
    try {
      const value = await api.get(base);
      if (request !== serial.current) return;
      if (value.revision !== liveRef.current?.revision
        || JSON.stringify(value.group_order) !== JSON.stringify(liveRef.current?.group_order)) {
        liveRef.current = value;
        setLive(value);
      }
      setError('');
    } catch (cause) {
      if (request === serial.current && !quiet) setError(tournamentLiveError(cause));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [base, canEdit]);

  useEffect(() => { void load(); return () => { ++serial.current; }; }, [load, tournament.manager_version, refreshKey]);
  useEffect(() => {
    if (!canEdit) return undefined;
    const timer = setInterval(() => { if (!document.hidden && !busyRef.current) void load({ quiet: true }); }, POLL_MS);
    return () => clearInterval(timer);
  }, [canEdit, load]);

  const run = useCallback(async body => {
    if (busyRef.current) return t('error.busy');
    const current = liveRef.current;
    if (!current) return t('error.unavailable');
    busyRef.current = true;
    setBusy(true);
    ++serial.current; // A refresh in flight must not overwrite the new state.
    try {
      const result = await api.post(base, { ...body, expected_revision: body.expected_revision ?? current.revision });
      liveRef.current = result;
      setLive(result);
      toast(t('toast.applied'));
      onChanged?.();
      return null;
    } catch (cause) {
      if (cause?.status === 409 || cause?.message === 'manager.tournamentLive.error.conflict') void load({ quiet: true });
      return tournamentLiveError(cause);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [base, load, onChanged, toast]);

  const fallback = useMemo(() => fallbackMatches.map(competitionMatch), [fallbackMatches]);
  const matches = live?.matches ?? fallback;
  const totals = useMemo(() => counts(matches), [matches]);
  const selected = matches.find(match => match.id === selection?.id);
  const status = live?.tournament.status ?? tournament.status;
  const edit = live && canEdit && canWrite ? run : undefined;
  const select = (id, action) => setSelection(previous => id ? { id, action, key: (previous?.key ?? 0) + 1 } : null);

  return <div className="op-live is-inline">
    {(matches.length > 0 || canEdit) && <div className="op-live-toolbar">
      <div className="op-live-summary">
        {matches.length > 0 && <span>{t('summary.done', { done: totals.confirmed, total: totals.total })}</span>}
      </div>
      {edit && LIVE_STATUS_TRANSITIONS[status]?.length > 0 && <button type="button" className={`op-live-status is-${status}`}
        disabled={busy} aria-expanded={statusOpen} aria-label={t('status.change')} onClick={() => setStatusOpen(value => !value)}>{t('status.change')}</button>}
      {canEdit && <button type="button" className="btn icon sm" disabled={loading || busy} onClick={() => void load()} aria-label={t('refresh')} title={t('refresh')}><RefreshCw size={14} /></button>}
    </div>}
    {statusOpen && edit && <StatusControl status={status} busy={busy} run={edit} onClose={() => setStatusOpen(false)} />}
    {loading && !live && !matches.length && <p role="status" className="op-live-empty">{t('loading')}</p>}
    {error && <p className="op-error" role="alert">{error}</p>}
    {(!loading || matches.length > 0) && <div className={`op-live-split${selected ? ' has-panel' : ''}`}>
      <TournamentLiveBracket matches={matches} participants={live?.participants} standingsOrder={live?.group_order ?? fallbackGroupOrder} totals={totals} selectedId={selection?.id} onSelect={select}
        run={edit} revision={live?.revision} busy={busy} status={status}
        canPlaceGroups={live?.tournament.can_add_registration === true && Date.now() < Date.parse(live.tournament.start_at)}
        onParticipants={onParticipants} />
      {selected && <TournamentLiveMatchPanel key={selection.key} tournamentId={tournament.id} match={selected} matches={matches}
        participants={live?.participants ?? EMPTY} run={edit} busy={busy} onClose={() => select(null)}
        initialAction={selection.action} canOpenMatch={canEdit} canAssignOpening={!tournament.has_group_stage}
        status={status} onParticipants={onParticipants} />}
    </div>}
  </div>;
}

function StatusControl({ status, busy, run, onClose }) {
  const [next, setNext] = useState('');
  const transitions = LIVE_STATUS_TRANSITIONS[status] ?? EMPTY;
  const selected = transitions.includes(next);
  const reasonKey = next === 'en_curso' ? (status === 'finalizado' ? 'reopen' : 'start') : next === 'finalizado' ? 'end' : next === 'cancelado' ? 'cancel' : '';
  return <section className="op-live-status-panel" aria-label={t('status.change')}>
    <header><h3>{t('status.change')}</h3><button type="button" className="btn ghost sm" disabled={busy} onClick={onClose}>{t('confirm.cancel')}</button></header>
    <label className="op-field"><span>{t('status.choose')}</span>
      <select value={selected ? next : ''} disabled={busy} onChange={event => setNext(event.target.value)}>
        <option value="">{t('status.choose')}</option>
        {transitions.map(value => <option value={value} key={value}>{statusLabel(value)}</option>)}
      </select>
    </label>
    {selected && <ReasonConfirm key={next} busy={busy} danger={next === 'cancelado'} defaultReason={reasonKey ? t(`presets.status.${reasonKey}`) : ''}
      submitLabel={t('status.apply', { status: statusLabel(next) })} onSubmit={async reason => {
        const problem = await run({ action: 'set_status', status: next, reason });
        if (!problem) onClose();
        return problem;
      }} />}
  </section>;
}

export default TournamentLivePanel;
