import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CalendarClock, ChevronDown, Layers, Repeat, Trophy, Undo2, X } from 'lucide-react';
import { BEST_OF, isComplete, needsAttention, nextMatches, playoffRounds, resultChangeLock, scheduleLocked, slotsLocked, validScores, winsNeeded } from './tournamentLiveModel.js';
import { competitionDateInput, competitionDateToIso } from './competitionTime.js';
import { translate } from '../i18n/runtime.js';
import { ReasonConfirm, StateBadge, entrantName, matchRoundLabel, t, when } from './tournamentLiveUi.jsx';

/**
 * Everything staff can do with one match, one action at a time. Each action
 * explains what happens, shows why it is unavailable and asks for its reason
 * next to its own confirm button.
 */
export default function TournamentLiveMatchPanel({ tournamentId, match, matches, participants, run, busy, onClose, onParticipants, initialAction, canOpenMatch = true, canAssignOpening, status }) {
  const [open, setOpen] = useState(initialAction ?? (match.result_status === 'disputed' || match.result_status === 'pending' ? 'result' : null));
  const { rounds } = playoffRounds(matches);
  const label = matchRoundLabel(match, rounds);
  const complete = isComplete(match);
  const closed = ['cancelado', 'finalizado'].includes(status);
  const placement = canAssignOpening && match.phase !== 'grupos' && match.round === 1 && !match.is_third_place && !complete;
  const actions = run ? [
    { id: 'result', icon: Trophy, title: match.winner_id ? t('actions.result.rectify') : t('actions.result.title'), help: t('actions.result.help'),
      blocked: !complete ? t('actions.blocked.incomplete') : '' },
    { id: 'schedule', icon: CalendarClock, title: t('actions.schedule.title'), help: t('actions.schedule.help'),
      blocked: closed ? t('error.closed') : scheduleLocked(match) ? t('error.matchStarted') : '' },
    { id: 'series', icon: Layers, title: t('actions.series.title'), help: t('actions.series.help', { count: match.best_of }),
      blocked: closed ? t('error.closed') : slotsLocked(match) ? t('error.matchStarted') : '' },
    { id: 'revert', icon: Undo2, title: t('actions.revert.title'), help: t('actions.revert.help'),
      blocked: !match.winner_id ? t('actions.blocked.unplayed') : '' },
    ...(placement ? [{ id: 'slots', icon: Repeat, title: t('bracket.assignSlot'),
      blocked: closed ? t('error.closed') : slotsLocked(match) ? t('error.matchStarted') : '' }] : []),
  ] : [];
  // A finished action closes so the panel shows the new state of the match.
  const act = async body => {
    const problem = await run({ ...body, match_id: match.id });
    if (!problem) setOpen(null);
    return problem;
  };

  return <aside className="op-live-panel" aria-label={t('panel.title')}>
    <header className="op-live-panel-head">
      <div><small>{label} · {t('panel.position', { position: match.position })}</small><StateBadge match={match} /></div>
      <button type="button" className="btn ghost icon sm" onClick={onClose} aria-label={t('panel.close')}><X size={16} /></button>
    </header>
    <div className="op-live-score">
      {[['a', match.entrant_a, match.score_a], ['b', match.entrant_b, match.score_b]].map(([side, entrant, score]) =>
        <div key={side} className={`op-live-score-side${entrant && entrant.id === match.winner_id ? ' is-winner' : ''}`}><span>{entrantName(entrant)}</span><strong>{score ?? '–'}</strong></div>)}
    </div>
    <p className="op-live-meta">{t('match.bestOf', { count: match.best_of })} · {match.scheduled_at ? when(match.scheduled_at) : t('match.unscheduled')} · {t(`veto.${['running', 'done', 'ready'].includes(match.pick_ban_status) ? match.pick_ban_status : 'none'}`)}</p>

    {canOpenMatch && <Link className="btn op-live-open" to={`/operaciones/torneos?tournament=${encodeURIComponent(tournamentId)}&tab=arbitration&arbitrationMatch=${encodeURIComponent(match.id)}`}>
      {t('panel.openPage')} <ArrowUpRight size={15} /></Link>}
    {needsAttention(match) && <p className="op-notice">{t(match.result_status === 'disputed' ? 'panel.disputed' : 'panel.reported')}</p>}

    {actions.length > 0 && <h3 className="op-live-panel-title">{t('panel.actions')}</h3>}
    <ul className="op-live-actions">
      {actions.map(action => {
        const Icon = action.icon, expanded = open === action.id;
        return <li key={action.id} className={`${expanded ? 'is-open' : ''}${action.blocked ? ' is-blocked' : ''}`}>
          <button type="button" className="op-live-action" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : action.id)}>
            <Icon size={17} /><span><strong>{action.title}</strong></span><ChevronDown size={16} />
          </button>
          {expanded && <div className="op-live-action-body" title={action.help}>
            {action.blocked ? <p className="op-live-why">{action.blocked}</p> : <>
              {action.id === 'result' && <ResultForm match={match} matches={matches} rounds={rounds} busy={busy} act={act} />}
              {action.id === 'schedule' && <ScheduleForm match={match} busy={busy} act={act} />}
              {action.id === 'series' && <SeriesForm match={match} busy={busy} act={act} />}
              {action.id === 'revert' && <RevertForm match={match} matches={matches} rounds={rounds} busy={busy} act={act} />}
              {action.id === 'slots' && <SlotsForm match={match} matches={matches} participants={participants} busy={busy} act={act} onParticipants={onParticipants} />}
            </>}
          </div>}
        </li>;
      })}
    </ul>
  </aside>;
}

function Consequences({ match, matches, rounds, winner }) {
  const { winner: next, loser } = nextMatches(match, matches);
  const advances = winner && winner.id !== match.winner_id;
  return <ul className="op-live-effects">
    {winner && <li>{t('effects.winner', { name: entrantName(winner) })}</li>}
    {advances && next && <li>{t('effects.advances', { round: matchRoundLabel(next, rounds), position: next.position })}</li>}
    {advances && loser && <li>{t('effects.thirdPlace')}</li>}
    {match.phase === 'grupos' && <li>{t('effects.groupTable')}</li>}
  </ul>;
}

export function ResultForm({ match, matches, rounds, busy, act }) {
  const options = validScores(match.best_of);
  const current = options.findIndex(([a, b]) => a === match.score_a && b === match.score_b);
  const [choice, setChoice] = useState(match.winner_id ? -1 : current);
  const score = options[choice];
  const winner = score ? (score[0] > score[1] ? match.entrant_a : match.entrant_b) : null;
  const lock = score && resultChangeLock(match, matches, winner);
  return <>
    <p className="op-live-hint">{t('result.pick', { wins: winsNeeded(match.best_of) })}</p>
    <div className="op-live-scores" role="radiogroup" aria-label={t('result.title')}>
      {options.map(([a, b], index) => <button type="button" role="radio" aria-checked={choice === index} key={`${a}-${b}`} disabled={busy}
        className={`op-live-score-option${choice === index ? ' is-active' : ''}${index === current && match.winner_id ? ' is-current' : ''}`} onClick={() => setChoice(index)}>
        <strong>{a} – {b}</strong><small>{entrantName(a > b ? match.entrant_a : match.entrant_b)}</small>
      </button>)}
    </div>
    {score && <Consequences match={match} matches={matches} rounds={rounds} winner={winner} />}
    <ReasonConfirm busy={busy} presets={['result.reported', 'result.evidence', 'result.typo', 'result.forfeit']}
      blockedReason={!score ? t('result.choose') : choice === current && match.winner_id ? t('result.same') : lock ? t(`error.${lock}`) : ''}
      submitLabel={score ? t(match.winner_id ? 'result.rectifyTo' : 'result.saveAs', { a: score[0], b: score[1] }) : t('result.save')}
      onSubmit={reason => act({ action: 'set_result', maps_a: score[0], maps_b: score[1], reason })} />
  </>;
}

export function RevertForm({ match, matches, rounds, busy, act }) {
  const lock = resultChangeLock(match, matches, null);
  return <>
    <Consequences match={match} matches={matches} rounds={rounds} winner={null} />
    <p className="op-live-hint">{t('revert.explain')}</p>
    <ReasonConfirm busy={busy} danger presets={['revert.wrong', 'result.typo']} submitLabel={t('revert.apply')}
      blockedReason={lock ? t(`error.${lock}`) : ''}
      onSubmit={reason => act({ action: 'revert_result', reason })} />
  </>;
}

export function ScheduleForm({ match, busy, act }) {
  const [original] = useState(match.scheduled_at);
  const [value, setValue] = useState(competitionDateInput(match.scheduled_at));
  const refreshed = original !== match.scheduled_at;
  let iso = null;
  if (value) {
    try { iso = competitionDateToIso(value, original); } catch { /* Show the date error beside the save action. */ }
  }
  const unchanged = iso && match.scheduled_at && Date.parse(iso) === Date.parse(match.scheduled_at);
  return <>
    <label className="op-field"><span>{t('schedule.madrid')}</span>
      <input type="datetime-local" defaultValue={value} disabled={busy} onInput={event => setValue(event.currentTarget.value)} /></label>
    <ReasonConfirm busy={busy} defaultReason={t('presets.schedule.plan')}
      blockedReason={refreshed ? t('error.conflict') : !value ? t('schedule.choose') : !iso ? translate('manager.tournament.invalidDate') : unchanged ? t('schedule.same') : ''}
      submitLabel={t('schedule.save')}
      onSubmit={reason => act({ action: 'schedule_match', scheduled_at: iso, reason })}
      secondary={match.scheduled_at ? { label: t('schedule.clear'), disabled: refreshed, onSubmit: reason => act({ action: 'schedule_match', scheduled_at: null, reason }) } : undefined} />
  </>;
}

function SeriesForm({ match, busy, act }) {
  const [bestOf, setBestOf] = useState(match.best_of);
  return <>
    <div className="op-live-scores" role="radiogroup" aria-label={t('actions.series.title')}>
      {BEST_OF.map(value => <button type="button" role="radio" aria-checked={bestOf === value} key={value} disabled={busy}
        className={`op-live-score-option${bestOf === value ? ' is-active' : ''}`} onClick={() => setBestOf(value)}>
        <strong>{t('match.bestOf', { count: value })}</strong><small>{t('series.wins', { count: winsNeeded(value) })}</small></button>)}
    </div>
    <ReasonConfirm busy={busy} presets={['series.rules', 'series.time']} blockedReason={bestOf === match.best_of ? t('series.same') : ''}
      submitLabel={t('series.apply', { count: bestOf })} onSubmit={reason => act({ action: 'set_best_of', best_of: bestOf, reason })} />
  </>;
}

function SlotsForm({ match, matches, participants, busy, act, onParticipants }) {
  const [target, setTarget] = useState('');
  const side = match.entrant_a ? 'b' : 'a';
  const positioned = new Set(matches.filter(item => item.phase !== 'grupos').flatMap(item => [item.entrant_a, item.entrant_b])
    .filter(Boolean).map(entrant => `${entrant.kind}:${entrant.id}`));
  const available = participants.filter(person => !positioned.has(`${person.entrant_kind}:${person.entrant_id}`)
    && (person.entrant_kind === 'user' || person.access?.length));
  const selected = available.some(person => person.id === target);
  return <>
    <select aria-label={t('slots.choose')} value={selected ? target : ''} disabled={busy} onChange={event => setTarget(event.target.value)}>
      <option value="">{t('slots.choose')}</option>
      {available.map(participant => <option key={participant.id} value={participant.id}>{participant.name || t('unknownEntrant')}</option>)}
    </select>
    {onParticipants && <button type="button" className="op-text-button" onClick={onParticipants}>{t('tabs.participants')}</button>}
    <ReasonConfirm busy={busy} defaultReason={t('presets.slots.drawAdjustment')} blockedReason={!selected ? t('slots.pick') : ''}
      submitLabel={t('bracket.applySwap')} onSubmit={reason => act({ action: 'replace_entrant', side, participant_id: target, reason })} />
  </>;
}
