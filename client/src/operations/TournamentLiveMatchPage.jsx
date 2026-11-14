import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Clock3, Pencil, RefreshCw, ShieldAlert, Swords, Trophy, Undo2, Users } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { getIntlLocale } from '../i18n/runtime.js';
import { canEditVetoStep, currentStep, playoffRounds, scheduleLocked, stepChoices, stepSwapChoices, vetoActions, vetoBlocked, vetoSlots, vetoTooEarly } from './tournamentLiveModel.js';
import { ReasonConfirm, StateBadge, clock, clockSeconds, entrantName, matchRoundLabel, statusLabel, t, tournamentLiveError, when } from './tournamentLiveUi.jsx';
import { ResultForm, RevertForm, ScheduleForm } from './TournamentLiveMatchPanel.jsx';
import TournamentMatchChat from './TournamentMatchChat.jsx';
import PlayerLiveBadge from './PlayerLiveBadge.jsx';
import './operations.css';
import './tournament-live.css';

const MATCH_POLL_MS = 5000;
const TOURNAMENT_POLL_MS = 15000;
const p = (key, values) => t(`page.${key}`, values);
const a = (key, values) => t(`arbitration.${key}`, values);
const SIDES = ['a', 'b'];

/**
 * Referee page for one tournament match: score and result actions, the pick &
 * ban board (prepare, open, reset, correct a decision) and the match chat,
 * where staff write as themselves. Refreshes itself while the tab is visible.
 */
export default function TournamentLiveMatchPage() {
  const { tournamentId, matchId } = useParams();
  return <TournamentLiveMatch key={`${tournamentId}:${matchId}`} tournamentId={tournamentId} matchId={matchId} />;
}

export function TournamentLiveMatch({ tournamentId, matchId, canWrite = true, onChanged, refreshKey, embedded = false }) {
  const { toast } = useApp();
  const [detail, setDetail] = useState(null), [live, setLive] = useState(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [updatedAt, setUpdatedAt] = useState(null);
  const busyRef = useRef(false), detailRef = useRef(null), liveRef = useRef(null), serial = useRef({ match: 0, live: 0 });
  busyRef.current = busy; detailRef.current = detail; liveRef.current = live;
  const liveBase = `/operations/tournaments/${encodeURIComponent(tournamentId)}/live`;
  const matchBase = `${liveBase}/matches/${encodeURIComponent(matchId)}`;

  const loadMatch = useCallback(async ({ quiet = false } = {}) => {
    const request = ++serial.current.match;
    try {
      const value = await api.get(matchBase);
      if (request !== serial.current.match) return;
      setDetail(value); setUpdatedAt(new Date().toISOString()); setError('');
    } catch (cause) {
      if (request !== serial.current.match) return;
      const denied = [401, 403, 404].includes(cause?.status);
      if (denied) setDetail(null);
      if (denied || !quiet) setError(tournamentLiveError(cause));
    }
  }, [matchBase]);
  const loadLive = useCallback(async () => {
    const request = ++serial.current.live;
    try {
      const value = await api.get(liveBase);
      if (request === serial.current.live && value?.revision !== liveRef.current?.revision) setLive(value);
    } catch { /* The bracket view only feeds the result forms; the match view reports errors. */ }
  }, [liveBase]);
  useEffect(() => {
    if (!busyRef.current) { void loadMatch(); void loadLive(); }
    return () => { ++serial.current.match; ++serial.current.live; };
  }, [loadMatch, loadLive, refreshKey]);
  useEffect(() => {
    const quiet = () => !document.hidden && !busyRef.current;
    const a = setInterval(() => { if (quiet()) void loadMatch({ quiet: true }); }, MATCH_POLL_MS);
    const b = setInterval(() => { if (quiet()) void loadLive(); }, TOURNAMENT_POLL_MS);
    return () => { clearInterval(a); clearInterval(b); };
  }, [loadMatch, loadLive]);

  /** Serialises writes; resolves to an error message or null. */
  const guard = useCallback(async (send, after) => {
    if (!canWrite) return t('error.writesDisabled');
    if (busyRef.current) return t('error.busy');
    setBusy(true); busyRef.current = true;
    try { await send(); await after?.(); return null; }
    catch (cause) {
      if (cause?.status === 409) { void loadMatch({ quiet: true }); void loadLive(); }
      return tournamentLiveError(cause);
    } finally { setBusy(false); busyRef.current = false; }
  }, [canWrite, loadMatch, loadLive]);
  /** Pick & ban and chat go through the match endpoint with the match revision. */
  const matchAction = useCallback(body => guard(async () => {
    ++serial.current.match;
    const value = await api.post(matchBase, body.action === 'chat_send' ? body : { ...body, expected_revision: detailRef.current?.revision });
    setDetail(value); setUpdatedAt(new Date().toISOString());
    if (body.action !== 'chat_send') toast(t('toast.applied'));
  }, body.action === 'chat_send' ? undefined : () => Promise.all([loadLive(), onChanged?.({ quiet: true })])), [guard, matchBase, toast, loadLive, onChanged]);
  /** Result and schedule corrections use the tournament endpoint (the bracket re-advances). */
  const liveAction = useCallback(body => guard(async () => {
    if (!liveRef.current) throw new Error(t('error.unavailable'));
    ++serial.current.live;
    const value = await api.post(liveBase, { ...body, match_id: matchId, expected_revision: liveRef.current.revision });
    setLive(value); toast(t('toast.applied'));
  }, () => Promise.all([loadMatch({ quiet: true }), onChanged?.({ quiet: true })])), [guard, liveBase, matchId, toast, loadMatch, onChanged]);

  const match = detail?.match;
  const rounds = useMemo(() => playoffRounds(live?.matches || []).rounds, [live]);
  const liveMatch = live?.matches?.find(item => item.id === match?.id) || null;
  const label = match ? (match.phase === 'grupos' || match.is_third_place || rounds.length ? matchRoundLabel(match, rounds) : t('round.number', { round: match.round })) : '';
  const back = `/operaciones/torneos?tournament=${encodeURIComponent(tournamentId)}&tab=arbitration&arbitrationMatch=${encodeURIComponent(matchId)}`;
  const className = embedded ? 'op-live-page is-embedded' : 'page wide op-page op-live-page';
  const Heading = embedded ? 'h3' : 'h1';

  if (!detail) return <div className={className}>
    {!embedded && <Link className="btn ghost sm" to={back}><ArrowLeft size={15} aria-hidden="true" /> {p('back')}</Link>}
    {error ? <div className="op-arbitration-load-error"><p className="op-error" role="alert">{error}</p>
      <button type="button" className="btn sm" onClick={() => { void loadMatch(); void loadLive(); }}><RefreshCw size={14} aria-hidden="true" />{t('refresh')}</button></div>
      : <p role="status" className="op-live-empty">{a('loadingMatch')}</p>}
  </div>;

  return <div className={className}>
    <header className="op-live-page-head">
      {!embedded && <Link className="btn ghost sm" to={back}><ArrowLeft size={15} aria-hidden="true" /> {p('back')}</Link>}
      <div className="op-live-page-title">
        <small>{embedded ? label : <>{detail.tournament.name} · {statusLabel(detail.tournament.status)} · {label}</>}</small>
        <Heading>{p('title', { a: entrantName(match.entrant_a), b: entrantName(match.entrant_b) })}</Heading>
      </div>
      <div className="op-live-head">
        <StateBadge match={match} />
        {updatedAt && <small className="op-live-updated">{t('live.updated', { time: clockSeconds(updatedAt) })}</small>}
        <button type="button" className="btn sm" disabled={busy} onClick={() => { void loadMatch(); void loadLive(); }} aria-label={t('refresh')} title={t('refresh')}><RefreshCw size={14} /></button>
      </div>
    </header>
    {error && <p className="op-error" role="alert">{error}</p>}
    {!canWrite && <p className="op-notice">{t('error.writesDisabled')}</p>}
    {match.started && <p className="op-notice"><ShieldAlert size={15} /> {p('started')}</p>}

    <RefereeRequests requests={detail.referee_requests ?? []} />
    <div className="op-live-page-grid">
      <section className="op-card op-live-page-score" aria-label={p('score')}>
        <div className="op-live-score">
          {[['a', match.entrant_a, match.score_a], ['b', match.entrant_b, match.score_b]].map(([side, entrant, score]) =>
            <div key={side} className={`op-live-score-side${entrant && entrant.id === match.winner_id ? ' is-winner' : ''}`}><span>{entrantName(entrant)}</span><strong>{score ?? '–'}</strong></div>)}
        </div>
        <p className="op-live-meta">{t('match.bestOf', { count: match.best_of })} · {match.scheduled_at ? when(match.scheduled_at) : t('match.unscheduled')}</p>
      </section>
      <MatchRosters match={match} roster={detail.roster} />
      <TournamentMatchChat match={match} messages={detail.messages} canWrite={canWrite} busy={busy} send={body => matchAction({ action: 'chat_send', body })} />
      <VetoBoard detail={detail} busy={busy || !canWrite} act={matchAction} />
      {canWrite && <MatchCorrections match={liveMatch} matches={live?.matches || []} rounds={rounds} status={live?.tournament.status} busy={busy} act={liveAction} />}
    </div>
  </div>;
}

function VetoBoard({ detail, busy, act }) {
  const { match, steps, pool, tournament } = detail;
  const [open, setOpen] = useState(null), [editing, setEditing] = useState(null);
  const status = ['ready', 'running', 'done'].includes(match.pick_ban_status) ? match.pick_ban_status : 'none';
  const manual = status === 'running' && match.pick_ban_manual_referee;
  const blocked = vetoBlocked(match, tournament.status);
  const slots = vetoSlots(steps), turn = currentStep(steps);
  const side = value => entrantName(value === 'a' ? match.entrant_a : match.entrant_b);
  const done = async body => { const problem = await act(body); if (!problem) { setOpen(null); setEditing(null); } return problem; };

  return <section className="op-card op-live-veto" aria-labelledby="op-live-veto-title">
    <header className="op-section-title">
      <div><h2 id="op-live-veto-title"><Swords size={18} /> {p('veto.title')}</h2><p>{p(`veto.explain.${manual ? 'manual' : status}`)}</p></div>
      <span className={`op-live-state is-veto-${status}`}>{t(`veto.${status}`)}</span>
    </header>
    {status !== 'none' && <ul className="op-live-captains">
      {['a', 'b'].map(value => <li key={value} className={match[`pick_ban_ready_${value}`] ? 'is-ready' : ''}>
        {p(match[`pick_ban_ready_${value}`] ? 'veto.teamReady' : 'veto.teamWaiting', { team: side(value) })}</li>)}
    </ul>}

    {blocked ? <p className="op-live-why">{p(`veto.blocked.${blocked}`)}</p> : <div className="op-live-veto-actions">
      {vetoActions(match).map(action => {
        const early = (action === 'veto_start' || action === 'startManual') && vetoTooEarly(match);
        return <div key={action} className={`op-live-veto-action${open === action ? ' is-open' : ''}`}>
          <button type="button" className={`btn ${action === 'veto_reset' ? '' : 'primary'}`} aria-expanded={open === action} disabled={busy}
            onClick={() => setOpen(open === action ? null : action)}>{p(`veto.actions.${action}.title`)}</button>
          {open === action && <div className="op-live-action-body">
            <p className="op-live-hint">{p(`veto.actions.${action}.help`)}</p>
            <ReasonConfirm busy={busy} danger={action === 'veto_reset'}
              presets={action === 'veto_reset' ? ['veto.disconnect', 'veto.mistake', 'veto.rules'] : action === 'veto_start' ? ['veto.late', 'veto.staff'] : ['veto.staff']}
              blockedReason={early ? p('veto.tooEarly', { time: when(match.scheduled_at) }) : ''}
              submitLabel={p(`veto.actions.${action}.apply`)} onSubmit={reason => done({ ...vetoRequest(action), reason })} />
          </div>}
        </div>;
      })}
    </div>}

    {!slots.length ? <p className="op-live-empty">{p('veto.empty')}</p> : <ol className="op-live-slots">
      {slots.map(slot => <li key={slot.slot} className="op-live-slot">
        <header><strong>{p('veto.map', { slot: slot.slot })}</strong><span>{slot.mode}</span>
          {slot.map && <em>{slot.side ? p('veto.mapSummary', { map: slot.map, side: slot.side, team: side(slot.sideBy) }) : slot.map}</em>}</header>
        <ul>{slot.steps.map(step => {
          const current = turn?.id === step.id;
          const editable = !blocked && canEditVetoStep(step, turn, status);
          const isEditing = editable && editing === step.id;
          const choices = isEditing ? stepChoices(step, steps, pool) : [];
          const swaps = isEditing ? stepSwapChoices(step, steps, pool) : [];
          return <li key={step.id} className={`op-live-step is-${step.action}${current ? ' is-current' : ''}${step.map_name ? ' is-decided' : ''}`}>
            <span className="op-live-step-who">{step.automatic_map ? p('veto.remainingMap') : p(`veto.step.${step.action}`, { team: side(step.actor_side) })}</span>
            <span className="op-live-step-value">{step.map_name || (current && status === 'running' ? <><Clock3 size={13} /> {step.deadline_at ? p('veto.deadline', { time: clock(step.deadline_at) }) : p('veto.current')}</> : p('veto.pending'))}
              {step.auto && !step.automatic_map && <em>{p('veto.auto')}</em>}</span>
            {editable && <button type="button" className="btn ghost sm" disabled={busy} aria-expanded={isEditing}
              onClick={() => setEditing(isEditing ? null : step.id)}><Pencil size={13} /> {p(step.map_name ? 'veto.change' : 'veto.record')}</button>}
            {isEditing && <StepEditor key={`${step.id}:${step.map_name ?? ''}`} step={step} choices={choices} swaps={swaps} busy={busy}
              onSubmit={(selection, reason) => done({ action: 'veto_set_step', step_index: step.step_index, ...selection, reason })} />}
          </li>;
        })}</ul>
      </li>)}
    </ol>}
  </section>;
}

function vetoRequest(action) {
  if (action === 'startManual') return { action: 'veto_start', manual_referee: true };
  if (action === 'takeControl' || action === 'resumeTeams') return { action: 'veto_set_control', manual_referee: action === 'takeControl' };
  return { action };
}

function StepEditor({ step, choices, swaps, busy, onSubmit }) {
  const [value, setValue] = useState('');
  const swap = swaps.find(other => other.map_name === value);
  const selected = choices.includes(value) || Boolean(swap);
  const number = new Intl.NumberFormat(getIntlLocale());
  return <div className="op-live-action-body op-live-step-editor">
    <p className="op-live-hint">{step.map_name ? p('veto.changeHelp', { current: step.map_name }) : p('veto.recordHelp')}</p>
    {!choices.length && !swaps.length ? <p className="op-live-why">{p('veto.noChoices')}</p> : <>
      <div className="op-live-chips" role="radiogroup" aria-label={p('veto.choose')}>
        {choices.map(choice => <button type="button" role="radio" key={choice} aria-checked={value === choice} disabled={busy}
          className={`op-live-chip${value === choice ? ' is-active' : ''}`} onClick={() => setValue(choice)}>{choice}</button>)}
        {swaps.map(other => <button type="button" role="radio" key={other.id} aria-checked={swap?.id === other.id} disabled={busy}
          className={`op-live-chip${swap?.id === other.id ? ' is-active' : ''}`} onClick={() => setValue(other.map_name)}>
          {p('veto.swapOption', { value: other.map_name, turn: number.format(other.step_index) })}</button>)}
      </div>
      {swap && <p className="op-live-hint">{p('veto.swapHelp', { previous: step.map_name, turn: number.format(swap.step_index) })}</p>}
      <ReasonConfirm busy={busy} presets={step.map_name ? ['veto.mistake', 'veto.rules'] : ['veto.chat', 'veto.rules']} blockedReason={selected ? '' : p('veto.choose')}
        submitLabel={swap ? p('veto.swapApply') : selected ? p(step.map_name ? 'veto.apply' : 'veto.recordValue', { value }) : p(step.map_name ? 'veto.change' : 'veto.record')}
        onSubmit={reason => onSubmit({ map_name: value, ...(swap ? { swap_step_index: swap.step_index } : {}) }, reason)} />
    </>}
  </div>;
}

function MatchCorrections({ match, matches, rounds, status, busy, act }) {
  const [open, setOpen] = useState(null);
  if (!match) return null;
  const actions = [
    ['result', Trophy, match.winner_id ? t('actions.result.rectify') : t('actions.result.title'), !match.entrant_a || !match.entrant_b ? t('actions.blocked.incomplete') : ''],
    ['schedule', Clock3, t('actions.schedule.title'), ['cancelado', 'finalizado'].includes(status) ? t('error.closed') : scheduleLocked(match) ? t('error.matchStarted') : ''],
    ['revert', Undo2, t('actions.revert.title'), !match.winner_id ? t('actions.blocked.unplayed') : ''],
  ];
  const done = async body => { const problem = await act(body); if (!problem) setOpen(null); return problem; };
  return <section className="op-card" aria-labelledby="op-live-corrections">
    <header className="op-section-title"><div><h2 id="op-live-corrections"><Trophy size={18} /> {p('corrections.title')}</h2><p>{p('corrections.help')}</p></div></header>
    <ul className="op-live-actions">
      {actions.map(([id, Icon, title, blocked]) => <li key={id} className={`${open === id ? 'is-open' : ''}${blocked ? ' is-blocked' : ''}`}>
        <button type="button" className="op-live-action" aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>
          <Icon size={17} /><span><strong>{title}</strong><small>{blocked || t(`actions.${id}.help`)}</small></span>
        </button>
        {open === id && <div className="op-live-action-body">
          {blocked ? <p className="op-live-why">{blocked}</p> : <>
            {id === 'result' && <ResultForm match={match} matches={matches} rounds={rounds} busy={busy} act={done} />}
            {id === 'schedule' && <ScheduleForm match={match} busy={busy} act={done} />}
            {id === 'revert' && <RevertForm match={match} matches={matches} rounds={rounds} busy={busy} act={done} />}
          </>}
        </div>}
      </li>)}
    </ul>
  </section>;
}

function RefereeRequests({ requests }) {
  if (!requests.length) return null;
  return <section className="op-card op-arbitration-requests" aria-labelledby="op-arbitration-requests-title">
    <header className="op-section-title"><h3 id="op-arbitration-requests-title"><ShieldAlert size={16} aria-hidden="true" /> {a('requestsTitle')}</h3></header>
    <ul>{requests.map(request => <li key={request.id}>
      <time dateTime={request.created_at}>{when(request.created_at)}</time>
      <Link className="btn sm" to={`/operaciones/incidencias?case=${encodeURIComponent(request.id)}`}>
        {a('openTicket', { code: request.code })}<ArrowUpRight size={14} aria-hidden="true" />
      </Link>
    </li>)}</ul>
  </section>;
}

function MatchRosters({ match, roster }) {
  return <section className="op-card op-arbitration-roster-card" aria-labelledby="op-arbitration-rosters-title">
    <header className="op-section-title"><h3 id="op-arbitration-rosters-title"><Users size={16} aria-hidden="true" /> {a('rosters')}</h3></header>
    <div className="op-arbitration-rosters">{SIDES.map(side => {
      const players = roster?.[side] ?? [];
      return <div key={side} className={`op-arbitration-roster is-team-${side}`}>
        <h4>{entrantName(match[`entrant_${side}`])}</h4>
        {players.length > 0 ? <ul>{players.map(player => <li key={player.user_id}><span>{player.name || p('chat.unknownAuthor')}</span><PlayerLiveBadge userId={player.user_id} name={player.name || p('chat.unknownAuthor')} /></li>)}</ul>
          : <p>{t('participants.rosterEmpty')}</p>}
      </div>;
    })}</div>
  </section>;
}
