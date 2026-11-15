import { useEffect, useState } from 'react';
import { RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { useLiveRead } from './useLiveRead.js';
import { LIVE_READ_INTERVALS } from './liveReadLoop.js';
import { getIntlLocale } from '../i18n/runtime.js';
import { TournamentLiveMatch } from './TournamentLiveMatchPage.jsx';
import { playoffRounds } from './tournamentLiveModel.js';
import { StateBadge, entrantName, matchRoundLabel, t, tournamentLiveError, when } from './tournamentLiveUi.jsx';

const POLL_MS = LIVE_READ_INTERVALS.arbitration;
const a = (key, values) => t(`arbitration.${key}`, values);
const requests = match => match.referee_requests ?? [];

export default function TournamentArbitration({ tournamentId, selectedMatchId, selectMatch, canWrite, refreshKey }) {
  const [matches, setMatches] = useState(null);
  const [query, setQuery] = useState('');
  const [requestsOnly, setRequestsOnly] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { load } = useLiveRead(`/operations/tournaments/${encodeURIComponent(tournamentId)}/live/arbitration`, {
    intervalMs: POLL_MS,
    onReset: () => { setMatches(null); setError(''); setLoading(true); },
    onValue: response => { setMatches(response.matches); setError(''); setLoading(false); },
    onError: cause => { if ([401, 403, 404].includes(cause?.status)) setMatches(null); setError(tournamentLiveError(cause)); setLoading(false); },
  });
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const all = matches ?? [];
  const { rounds } = playoffRounds(all);
  const requestedMatches = all.filter(match => requests(match).length > 0);
  const selected = all.find(match => match.id === selectedMatchId?.toLowerCase());
  const locale = getIntlLocale();
  const formatted = new Intl.NumberFormat(locale);
  const term = query.trim().toLocaleLowerCase(locale);
  const listed = (requestsOnly ? requestedMatches : [...requestedMatches, ...all.filter(match => !requests(match).length)])
    .filter(match => !term || [match.entrant_a?.name, match.entrant_b?.name].some(name => name?.toLocaleLowerCase(locale).includes(term)));
  const empty = all.length === 0 ? 'noMatches' : term ? 'noResults' : 'noRequests';

  return <div className="op-arbitration">
    <section className="op-card op-arbitration-queue" aria-labelledby="op-arbitration-queue-title">
      <header className="op-section-title">
        <h3 id="op-arbitration-queue-title">{a('matchList')}</h3>
        <button type="button" className="btn icon sm" disabled={loading} aria-label={t('refresh')} title={t('refresh')} onClick={() => void load()}>
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </header>
      <label className="op-arbitration-search">
        <Search size={15} aria-hidden="true" />
        <input type="search" aria-label={a('searchMatches')} placeholder={a('searchMatches')} value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      <div className="op-live-segment" role="group" aria-label={a('matchList')}>
        <button type="button" className={!requestsOnly ? 'is-active' : ''} aria-pressed={!requestsOnly} onClick={() => setRequestsOnly(false)}>{a('allMatches')}</button>
        <button type="button" className={requestsOnly ? 'is-active' : ''} aria-pressed={requestsOnly} onClick={() => setRequestsOnly(true)}>
          {a('requested')} <span className="op-live-count">{formatted.format(requestedMatches.length)}</span>
        </button>
      </div>
      {error && <p className="op-error" role="alert">{error}</p>}
      {!matches && !error && <p className="op-live-empty" role="status">{t('loading')}</p>}
      {matches && !listed.length && <p className="op-live-empty">{a(empty)}</p>}
      {listed.length > 0 && <ul className="op-arbitration-list">
        {listed.map(match => <li key={match.id}>
          <button type="button" className={`op-live-card is-row${selected?.id === match.id ? ' is-selected' : ''}${requests(match).length ? ' is-alert' : ''}`}
            aria-current={selected?.id === match.id ? 'true' : undefined} onClick={() => selectMatch(match.id)}>
            <span className="op-arbitration-match-label">
              {t('page.title', { a: entrantName(match.entrant_a), b: entrantName(match.entrant_b) })}
            </span>
            <span className="op-arbitration-match-meta">
              <small>{matchRoundLabel(match, rounds)} · {match.scheduled_at ? when(match.scheduled_at) : t('match.unscheduled')}</small>
              <StateBadge match={match} />
            </span>
            {requests(match).length > 0 && <span className="op-arbitration-request-count">
              <ShieldAlert size={14} aria-hidden="true" />{a('requestCount', { count: formatted.format(requests(match).length) })}
            </span>}
          </button>
        </li>)}
      </ul>}
    </section>
    {selected ? <TournamentLiveMatch key={selected.id} tournamentId={tournamentId} matchId={selected.id} canWrite={canWrite}
      onChanged={load} refreshKey={refreshKey} fallbackRounds={rounds} embedded /> : matches?.length > 0 && <p className="op-card op-live-empty">{a('chooseMatch')}</p>}
  </div>;
}
