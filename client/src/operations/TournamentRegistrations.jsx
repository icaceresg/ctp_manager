import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Info, RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { getIntlLocale } from '../i18n/runtime.js';
import TournamentLiveParticipants from './TournamentLiveParticipants.jsx';
import { t, tournamentLiveError } from './tournamentLiveUi.jsx';
import './tournament-live.css';

export default function TournamentRegistrations({ tournament, participants, eligibleTeams = [], liveControl, canWrite = false, onChanged }) {
  const { toast } = useApp();
  const [live, setLive] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const serial = useRef(0);
  const writing = useRef(false);
  const base = `/operations/tournaments/${encodeURIComponent(tournament.id)}/live`;
  const current = live?.tournament.id === tournament.id ? live : null;

  const refresh = useCallback(async () => {
    if (!liveControl || writing.current) return;
    const request = ++serial.current;
    setLoading(true);
    try {
      const result = await api.get(base);
      if (request === serial.current) { setLive(result); setError(''); }
    } catch (cause) {
      if (request === serial.current) setError(tournamentLiveError(cause));
    } finally {
      if (request === serial.current) setLoading(false);
    }
  }, [base, liveControl]);

  useEffect(() => {
    void refresh();
    return () => { ++serial.current; };
  }, [refresh, tournament.manager_version]);

  async function run(body) {
    if (writing.current) return t('error.busy');
    if (!current) return t('error.unavailable');
    writing.current = true;
    ++serial.current;
    setBusy(true);
    setLoading(false);
    try {
      setLive(await api.post(base, { ...body, expected_revision: current.revision }));
      toast(t('toast.applied'));
      onChanged?.();
      return null;
    } catch (cause) {
      writing.current = false;
      if (cause?.status === 409) void refresh();
      return tournamentLiveError(cause);
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  const loadRoster = useCallback(async teamId => (await api.get(`${base}/registration-roster/${encodeURIComponent(teamId)}`)).members, [base]);
  const findEligibleTeams = useCallback(async query => (await api.get(`${base}/candidates?${new URLSearchParams({ query, eligibleTeams: '1' })}`)).eligible_teams, [base]);
  async function findCandidates(query) {
    try { return { items: (await api.get(`${base}/candidates?${new URLSearchParams({ query })}`)).items || [] }; }
    catch (cause) { return { error: tournamentLiveError(cause) }; }
  }
  const fallback = {
    tournament,
    eligible_teams: eligibleTeams,
    participants: participants.map(participant => ({
      ...participant,
      roster: (participant.roster || []).map(player => player.username || player.name).filter(Boolean),
      roster_ready: participant.entrant_kind === 'team' ? (participant.roster || []).length >= tournament.roster_min
        && (participant.roster || []).length <= tournament.roster_max && participant.roster.every(player => player.identity_ready) : null,
    })),
  };
  const registration = current || fallback;
  const pending = registration.participants.filter(participant => participant.entrant_kind === 'team' && participant.roster_ready === false).length;
  return <section className="op-card">
    <div className="op-section-title">
      <h3>{t('registration.title')} <span className="op-registration-info" tabIndex={0} aria-label={t('registration.help')}><Info size={15} aria-hidden="true" /><span aria-hidden="true">{t('registration.help')}</span></span></h3>
      {liveControl && <button type="button" className="btn sm" onClick={() => void refresh()} disabled={busy || loading} aria-label={t('refresh')} title={t('refresh')}><RefreshCw size={14} /></button>}
    </div>
    {loading && !current && <p className="muted" role="status">{t('loading')}</p>}
    {error && <p className="op-error" role="alert">{error}</p>}
    {pending > 0 && <p className="op-notice op-registration-pending-summary" role="status"><AlertTriangle size={16} aria-hidden="true" />
      {t('registration.pendingSummary', { count: new Intl.NumberFormat(getIntlLocale()).format(pending) })}
    </p>}
    <TournamentLiveParticipants key={tournament.id} live={registration} run={current && canWrite ? run : undefined} loadRoster={current && canWrite ? loadRoster : undefined} findCandidates={findCandidates} findEligibleTeams={liveControl ? findEligibleTeams : undefined} busy={busy} />
  </section>;
}
