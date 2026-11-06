import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Clock3, MessageSquare, Pencil, RefreshCw, Send, ShieldAlert, Swords, Trophy, Undo2 } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { chatCheck, currentStep, playoffRounds, scheduleLocked, stepChoices, systemNotice, vetoActions, vetoBlocked, vetoSlots, vetoTooEarly } from './tournamentLiveModel.js';
import { ReasonConfirm, StateBadge, clock, clockSeconds, entrantName, matchRoundLabel, statusLabel, t, tournamentLiveError, when } from './tournamentLiveUi.jsx';
import { ResultForm, RevertForm, ScheduleForm } from './TournamentLiveMatchPanel.jsx';
import './operations.css';
import './tournament-live.css';

const MATCH_POLL_MS = 5000;
const TOURNAMENT_POLL_MS = 15000;
const p = (key, values) => t(`page.${key}`, values);

/**
 * Referee page for one tournament match: score and result actions, the pick &
 * ban board (prepare, open, reset, correct a decision) and the match chat,
 * where staff write as themselves. Refreshes itself while the tab is visible.
 */
export default function TournamentLiveMatchPage() {
  const { tournamentId, matchId } = useParams();
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
    } catch (cause) { if (request === serial.current.match && !quiet) setError(tournamentLiveError(cause)); }
  }, [matchBase]);
  const loadLive = useCallback(async () => {
    const request = ++serial.current.live;
    try {
      const value = await api.get(liveBase);
      if (request === serial.current.live && value?.revision !== liveRef.current?.revision) setLive(value);
    } catch { /* The bracket view only feeds the result forms; the match view reports errors. */ }
  }, [liveBase]);
  useEffect(() => { void loadMatch(); void loadLive(); }, [loadMatch, loadLive]);
  useEffect(() => {
    const quiet = () => !document.hidden && !busyRef.current;
    const a = setInterval(() => { if (quiet()) void loadMatch({ quiet: true }); }, MATCH_POLL_MS);
    const b = setInterval(() => { if (quiet()) void loadLive(); }, TOURNAMENT_POLL_MS);
    return () => { clearInterval(a); clearInterval(b); };
  }, [loadMatch, loadLive]);

  /** Serialises writes; resolves to an error message or null. */
  const guard = useCallback(async (send, after) => {
    if (busyRef.current) return t('error.busy');
    setBusy(true); busyRef.current = true;
    try { await send(); await after?.(); return null; }
    catch (cause) {
      if (cause?.status === 409) { void loadMatch({ quiet: true }); void loadLive(); }
      return tournamentLiveError(cause);
    } finally { setBusy(false); busyRef.current = false; }
  }, [loadMatch, loadLive]);
  /** Pick & ban and chat go through the match endpoint with the match revision. */
  const matchAction = useCallback(body => guard(async () => {
    ++serial.current.match;
    const value = await api.post(matchBase, body.action === 'chat_send' ? body : { ...body, expected_revision: detailRef.current?.revision });
    setDetail(value); setUpdatedAt(new Date().toISOString());
    if (body.action !== 'chat_send') toast(t('toast.applied'));
  }, body.action === 'chat_send' ? undefined : loadLive), [guard, matchBase, toast, loadLive]);
  /** Result and schedule corrections use the tournament endpoint (the bracket re-advances). */
  const liveAction = useCallback(body => guard(async () => {
    if (!liveRef.current) throw new Error(t('error.unavailable'));
    ++serial.current.live;
    const value = await api.post(liveBase, { ...body, match_id: matchId, expected_revision: liveRef.current.revision });
    setLive(value); toast(t('toast.applied'));
  }, () => loadMatch({ quiet: true })), [guard, liveBase, matchId, toast, loadMatch]);

  const match = detail?.match;
  const rounds = useMemo(() => playoffRounds(live?.matches || []).rounds, [live]);
  const liveMatch = live?.matches?.find(item => item.id === match?.id) || null;
  const label = match ? (match.phase === 'grupos' || match.is_third_place || rounds.length ? matchRoundLabel(match, rounds) : t('round.number', { round: match.round })) : '';
  const back = `/operaciones/torneos?tournament=${encodeURIComponent(tournamentId)}`;

  if (!detail) return <div className="page wide op-page op-live-page">
    <Link className="btn ghost sm" to={back}><ArrowLeft size={15} /> {p('back')}</Link>
    {error ? <p className="op-error" role="alert">{error}</p> : <p role="status" className="op-live-empty">{t('loading')}</p>}
  </div>;

  return <div className="page wide op-page op-live-page">
    <header className="op-live-page-head">
      <Link className="btn ghost sm" to={back}><ArrowLeft size={15} /> {p('back')}</Link>
      <div className="op-live-page-title">
        <small>{detail.tournament.name} · {statusLabel(detail.tournament.status)} · {label}</small>
        <h1>{p('title', { a: entrantName(match.entrant_a), b: entrantName(match.entrant_b) })}</h1>
      </div>
      <div className="op-live-head">
        <StateBadge match={match} />
        {updatedAt && <small className="op-live-updated">{t('live.updated', { time: clockSeconds(updatedAt) })}</small>}
        <button type="button" className="btn sm" disabled={busy} onClick={() => { void loadMatch(); void loadLive(); }} aria-label={t('refresh')} title={t('refresh')}><RefreshCw size={14} /></button>
      </div>
    </header>
    {error && <p className="op-error" role="alert">{error}</p>}
    {match.started && <p className="op-notice"><ShieldAlert size={15} /> {p('started')}</p>}

    <div className="op-live-page-grid">
      <div className="op-live-page-main">
        <section className="op-card op-live-page-score" aria-label={p('score')}>
          <div className="op-live-score">
            {[['a', match.entrant_a, match.score_a], ['b', match.entrant_b, match.score_b]].map(([side, entrant, score]) =>
              <div key={side} className={`op-live-score-side${entrant && entrant.id === match.winner_id ? ' is-winner' : ''}`}><span>{entrantName(entrant)}</span><strong>{score ?? '–'}</strong></div>)}
          </div>
          <p className="op-live-meta">{t('match.bestOf', { count: match.best_of })} · {match.scheduled_at ? when(match.scheduled_at) : t('match.unscheduled')}</p>
        </section>
        <VetoBoard detail={detail} busy={busy} act={matchAction} />
        <MatchCorrections match={liveMatch} matches={live?.matches || []} rounds={rounds} status={live?.tournament.status} busy={busy} act={liveAction} />
      </div>
      <MatchChat messages={detail.messages} busy={busy} send={body => matchAction({ action: 'chat_send', body })} />
    </div>
  </div>;
}

function VetoBoard({ detail, busy, act }) {
  const { match, steps, pool, tournament } = detail;
  const [open, setOpen] = useState(null), [editing, setEditing] = useState(null);
  const status = ['ready', 'running', 'done'].includes(match.pick_ban_status) ? match.pick_ban_status : 'none';
  const blocked = vetoBlocked(match, tournament.status);
  const slots = vetoSlots(steps), turn = currentStep(steps);
  const side = value => entrantName(value === 'a' ? match.entrant_a : match.entrant_b);
  const done = async body => { const problem = await act(body); if (!problem) { setOpen(null); setEditing(null); } return problem; };

  return <section className="op-card op-live-veto" aria-labelledby="op-live-veto-title">
    <header className="op-section-title">
      <div><h2 id="op-live-veto-title"><Swords size={18} /> {p('veto.title')}</h2><p>{p(`veto.explain.${status}`)}</p></div>
      <span className={`op-live-state is-veto-${status}`}>{t(`veto.${status}`)}</span>
    </header>
    {status !== 'none' && <ul className="op-live-captains">
      {['a', 'b'].map(value => <li key={value} className={match[`pick_ban_ready_${value}`] ? 'is-ready' : ''}>
        {side(value)}: {p(match[`pick_ban_ready_${value}`] ? 'veto.captainReady' : 'veto.captainWaiting')}</li>)}
    </ul>}

    {blocked ? <p className="op-live-why">{p(`veto.blocked.${blocked}`)}</p> : <div className="op-live-veto-actions">
      {vetoActions(match).map(action => {
        const early = action === 'veto_start' && vetoTooEarly(match);
        return <div key={action} className={`op-live-veto-action${open === action ? ' is-open' : ''}`}>
          <button type="button" className={`btn ${action === 'veto_reset' ? '' : 'primary'}`} aria-expanded={open === action} disabled={busy}
            onClick={() => setOpen(open === action ? null : action)}>{p(`veto.actions.${action}.title`)}</button>
          {open === action && <div className="op-live-action-body">
            <p className="op-live-hint">{p(`veto.actions.${action}.help`)}</p>
            <ReasonConfirm busy={busy} danger={action === 'veto_reset'}
              presets={action === 'veto_reset' ? ['veto.disconnect', 'veto.mistake', 'veto.rules'] : action === 'veto_start' ? ['veto.late', 'veto.staff'] : ['veto.staff']}
              blockedReason={early ? p('veto.tooEarly', { time: when(match.scheduled_at) }) : ''}
              submitLabel={p(`veto.actions.${action}.apply`)} onSubmit={reason => done({ action, reason })} />
          </div>}
        </div>;
      })}
    </div>}

    {!slots.length ? <p className="op-live-empty">{p('veto.empty')}</p> : <ol className="op-live-slots">
      {slots.map(slot => <li key={slot.slot} className="op-live-slot">
        <header><strong>{p('veto.map', { slot: slot.slot })}</strong><span>{slot.mode}</span>
          {slot.map && <em>{slot.side ? p('veto.mapSummary', { map: slot.map, side: slot.side, team: side(slot.sideBy) }) : slot.map}</em>}</header>
        <ul>{slot.steps.map(step => {
          const current = turn?.id === step.id, isEditing = editing === step.id;
          const choices = isEditing ? stepChoices(step, steps, pool) : [];
          return <li key={step.id} className={`op-live-step is-${step.action}${current ? ' is-current' : ''}${step.map_name ? ' is-decided' : ''}`}>
            <span className="op-live-step-who">{p(`veto.step.${step.action}`, { team: side(step.actor_side) })}</span>
            <span className="op-live-step-value">{step.map_name || (current && status === 'running' ? <><Clock3 size={13} /> {step.deadline_at ? p('veto.deadline', { time: clock(step.deadline_at) }) : p('veto.current')}</> : p('veto.pending'))}
              {step.auto && <em>{p('veto.auto')}</em>}</span>
            {step.map_name && !blocked && <button type="button" className="btn ghost sm" disabled={busy} aria-expanded={isEditing}
              onClick={() => setEditing(isEditing ? null : step.id)}><Pencil size={13} /> {p('veto.change')}</button>}
            {isEditing && <StepEditor step={step} choices={choices} busy={busy} onSubmit={(map_name, reason) => done({ action: 'veto_set_step', step_index: step.step_index, map_name, reason })} />}
          </li>;
        })}</ul>
      </li>)}
    </ol>}
  </section>;
}

function StepEditor({ step, choices, busy, onSubmit }) {
  const [value, setValue] = useState('');
  return <div className="op-live-action-body op-live-step-editor">
    <p className="op-live-hint">{p('veto.changeHelp', { current: step.map_name })}</p>
    {!choices.length ? <p className="op-live-why">{p('veto.noChoices')}</p> : <>
      <div className="op-live-chips" role="radiogroup" aria-label={p('veto.choose')}>
        {choices.map(choice => <button type="button" role="radio" key={choice} aria-checked={value === choice} disabled={busy}
          className={`op-live-chip${value === choice ? ' is-active' : ''}`} onClick={() => setValue(choice)}>{choice}</button>)}
      </div>
      <ReasonConfirm busy={busy} presets={['veto.mistake', 'veto.rules']} blockedReason={!value ? p('veto.choose') : ''}
        submitLabel={value ? p('veto.apply', { value }) : p('veto.change')} onSubmit={reason => onSubmit(value, reason)} />
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

function MatchChat({ messages, busy, send }) {
  const [draft, setDraft] = useState(''), [error, setError] = useState('');
  const list = useRef(null), last = messages.at(-1)?.id;
  const check = chatCheck(draft);
  useEffect(() => { const node = list.current; if (node) node.scrollTop = node.scrollHeight; }, [last]);
  async function submit() {
    if (!check.ready || busy) return;
    setError('');
    const problem = await send(check.value);
    if (problem) setError(problem); else setDraft('');
  }
  return <section className="op-card op-live-chat" aria-labelledby="op-live-chat-title">
    <header className="op-section-title"><div><h2 id="op-live-chat-title"><MessageSquare size={18} /> {p('chat.title')}</h2><p>{p('chat.help')}</p></div></header>
    <ol className="op-live-chat-list" ref={list} aria-live="polite">
      {!messages.length && <li className="op-live-empty">{p('chat.empty')}</li>}
      {messages.map(message => {
        const notice = message.system ? systemNotice(message.body) : null;
        return <li key={message.id} className={message.system ? 'is-system' : ''}>
          <header><strong>{message.system ? p('chat.system') : message.author_name || p('chat.unknownAuthor')}</strong><time dateTime={message.created_at}>{when(message.created_at)}</time></header>
          <p>{notice ? p(`chat.notice.${notice}`) : message.body}</p>
        </li>;
      })}
    </ol>
    <div className="op-live-chat-compose">
      <textarea rows={3} value={draft} disabled={busy} placeholder={p('chat.placeholder')} aria-label={p('chat.placeholder')}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} />
      <div className="op-live-chat-bar">
        <small className={check.tooLong ? 'is-alert' : ''}>{check.tooLong ? p('chat.tooLong') : p('chat.hint', { count: check.left })}</small>
        <button type="button" className="btn primary sm" disabled={busy || !check.ready} onClick={() => void submit()}><Send size={14} /> {p('chat.send')}</button>
      </div>
      {error && <p className="op-error" role="alert">{error}</p>}
    </div>
  </section>;
}
