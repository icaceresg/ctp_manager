import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CalendarClock, ChevronDown, Layers, Repeat, Trophy, Undo2, X } from 'lucide-react';
import { BEST_OF, dependentMatches, isComplete, needsAttention, nextMatches, playoffRounds, scheduleLocked, slotsLocked, toLocalInput, addMinutes, fromLocalInput, validScores, winsNeeded } from './tournamentLiveModel.js';
import { ReasonConfirm, StateBadge, entrantName, matchRoundLabel, t, when } from './tournamentLiveUi.jsx';

/**
 * Everything staff can do with one match, one action at a time. Each action
 * explains what happens, shows why it is unavailable and asks for its reason
 * next to its own confirm button.
 */
export default function TournamentLiveMatchPanel({ tournamentId, match, matches, participants, run, busy, onClose }) {
  const [open, setOpen] = useState(match.result_status === 'disputed' || match.result_status === 'pending' ? 'result' : null);
  const { rounds } = playoffRounds(matches);
  const label = matchRoundLabel(match, rounds);
  const complete = isComplete(match);
  const actions = [
    { id: 'result', icon: Trophy, title: match.winner_id ? t('actions.result.rectify') : t('actions.result.title'), help: t('actions.result.help'),
      blocked: !complete ? t('actions.blocked.incomplete') : '' },
    { id: 'schedule', icon: CalendarClock, title: t('actions.schedule.title'), help: t('actions.schedule.help'),
      blocked: scheduleLocked(match) ? t('actions.blocked.played') : '' },
    { id: 'series', icon: Layers, title: t('actions.series.title'), help: t('actions.series.help', { count: match.best_of }),
      blocked: slotsLocked(match) ? t('actions.blocked.started') : '' },
    { id: 'revert', icon: Undo2, title: t('actions.revert.title'), help: t('actions.revert.help'),
      blocked: !match.winner_id ? t('actions.blocked.unplayed') : '' },
    { id: 'slots', icon: Repeat, title: t('actions.slots.title'), help: t('actions.slots.help'), advanced: true,
      blocked: slotsLocked(match) ? t('actions.blocked.started') : '' },
  ];
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

    <Link className="btn primary op-live-open" to={`/operaciones/torneos/${encodeURIComponent(tournamentId)}/partidos/${encodeURIComponent(match.id)}`} target="_blank" rel="noopener noreferrer">
      {t('panel.openPage')} <ArrowUpRight size={15} /></Link>
    <p className="op-live-hint">{t('panel.openPageHelp')}</p>
    {needsAttention(match) && <p className="op-notice">{t(match.result_status === 'disputed' ? 'panel.disputed' : 'panel.reported')}</p>}

    <h3 className="op-live-panel-title">{t('panel.actions')}</h3>
    <ul className="op-live-actions">
      {actions.map(action => {
        const Icon = action.icon, expanded = open === action.id;
        return <li key={action.id} className={`${expanded ? 'is-open' : ''}${action.blocked ? ' is-blocked' : ''}`}>
          <button type="button" className="op-live-action" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : action.id)}>
            <Icon size={17} /><span><strong>{action.title}{action.advanced && <em>{t('actions.advanced')}</em>}</strong><small>{action.blocked || action.help}</small></span><ChevronDown size={16} />
          </button>
          {expanded && <div className="op-live-action-body">
            {action.blocked ? <p className="op-live-why">{action.blocked}</p> : <>
              {action.id === 'result' && <ResultForm match={match} matches={matches} rounds={rounds} busy={busy} act={act} />}
              {action.id === 'schedule' && <ScheduleForm match={match} busy={busy} act={act} />}
              {action.id === 'series' && <SeriesForm match={match} busy={busy} act={act} />}
              {action.id === 'revert' && <RevertForm match={match} matches={matches} rounds={rounds} busy={busy} act={act} />}
              {action.id === 'slots' && <SlotsForm match={match} matches={matches} rounds={rounds} participants={participants} busy={busy} act={act} />}
            </>}
          </div>}
        </li>;
      })}
    </ul>
  </aside>;
}

function Consequences({ match, matches, rounds, winner }) {
  const { winner: next, loser } = nextMatches(match, matches);
  const undone = dependentMatches(match, matches);
  return <ul className="op-live-effects">
    {winner && <li>{t('effects.winner', { name: entrantName(winner) })}</li>}
    {winner && next && <li>{t('effects.advances', { round: matchRoundLabel(next, rounds), position: next.position })}</li>}
    {winner && loser && <li>{t('effects.thirdPlace')}</li>}
    {match.phase === 'grupos' && <li>{t('effects.groupTable')}</li>}
    {undone.length > 0 && <li className="is-warning">{t('effects.undone', { count: undone.length })}</li>}
  </ul>;
}

export function ResultForm({ match, matches, rounds, busy, act }) {
  const options = validScores(match.best_of);
  const current = options.findIndex(([a, b]) => a === match.score_a && b === match.score_b);
  const [choice, setChoice] = useState(match.winner_id ? -1 : current);
  const score = options[choice];
  const winner = score ? (score[0] > score[1] ? match.entrant_a : match.entrant_b) : null;
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
      blockedReason={!score ? t('result.choose') : choice === current && match.winner_id ? t('result.same') : ''}
      submitLabel={score ? t(match.winner_id ? 'result.rectifyTo' : 'result.saveAs', { a: score[0], b: score[1] }) : t('result.save')}
      onSubmit={reason => act({ action: 'set_result', maps_a: score[0], maps_b: score[1], reason })} />
  </>;
}

export function RevertForm({ match, matches, rounds, busy, act }) {
  return <>
    <Consequences match={match} matches={matches} rounds={rounds} winner={null} />
    <p className="op-live-hint">{t('revert.explain')}</p>
    <ReasonConfirm busy={busy} danger presets={['revert.wrong', 'result.typo']} submitLabel={t('revert.apply')}
      onSubmit={reason => act({ action: 'revert_result', reason })} />
  </>;
}

export function ScheduleForm({ match, busy, act }) {
  const [value, setValue] = useState(toLocalInput(match.scheduled_at));
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const unchanged = fromLocalInput(value) === (match.scheduled_at ? new Date(match.scheduled_at).toISOString() : null);
  return <>
    <label className="op-field"><span>{t('schedule.label')}</span>
      <input type="datetime-local" value={value} disabled={busy} onChange={event => setValue(event.target.value)} />
      <small>{t('schedule.hint', { zone })}</small></label>
    {value && <div className="op-live-chips">{[-15, 15, 30, 60].map(minutes => <button type="button" key={minutes} className="op-live-chip" disabled={busy} onClick={() => setValue(addMinutes(value, minutes))}>
      {t(minutes < 0 ? 'schedule.earlier' : 'schedule.later', { minutes: Math.abs(minutes) })}</button>)}</div>}
    <p className="op-live-hint">{t('schedule.notify')}</p>
    <ReasonConfirm busy={busy} presets={['schedule.agreed', 'schedule.delay', 'schedule.plan']}
      blockedReason={!value ? t('schedule.choose') : unchanged ? t('schedule.same') : ''} submitLabel={t('schedule.save')}
      onSubmit={reason => act({ action: 'schedule_match', scheduled_at: fromLocalInput(value), reason })}
      secondary={match.scheduled_at ? { label: t('schedule.clear'), onSubmit: reason => act({ action: 'schedule_match', scheduled_at: null, reason }) } : undefined} />
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

function SlotsForm({ match, matches, rounds, participants, busy, act }) {
  const [side, setSide] = useState('a'), [mode, setMode] = useState('replace'), [target, setTarget] = useState('');
  const current = side === 'a' ? match.entrant_a : match.entrant_b;
  const swapOptions = matches.filter(other => !slotsLocked(other)).flatMap(other => ['a', 'b']
    .filter(otherSide => !(other.id === match.id && otherSide === side))
    .map(otherSide => ({ value: `${other.id}:${otherSide}`, label: t('slots.slot', { round: matchRoundLabel(other, rounds), position: other.position, name: entrantName(otherSide === 'a' ? other.entrant_a : other.entrant_b) }) })));
  const body = () => {
    if (mode === 'replace') return { action: 'replace_entrant', side, participant_id: target === 'empty' ? null : target };
    const [other_match_id, other_side] = target.split(':');
    return { action: 'swap_entrants', side, other_match_id, other_side };
  };
  return <>
    <div className="op-live-segment" role="radiogroup" aria-label={t('slots.side')}>
      {['a', 'b'].map(value => <button type="button" role="radio" key={value} aria-checked={side === value} className={side === value ? 'is-active' : ''} onClick={() => { setSide(value); setTarget(''); }}>
        {entrantName(value === 'a' ? match.entrant_a : match.entrant_b)}</button>)}
    </div>
    <div className="op-live-segment" role="radiogroup" aria-label={t('slots.mode')}>
      {['replace', 'swap'].map(value => <button type="button" role="radio" key={value} aria-checked={mode === value} className={mode === value ? 'is-active' : ''} onClick={() => { setMode(value); setTarget(''); }}>{t(`slots.modes.${value}`)}</button>)}
    </div>
    <p className="op-live-hint">{t(mode === 'replace' ? 'slots.replaceHelp' : 'slots.swapHelp', { name: entrantName(current) })}</p>
    <select aria-label={t(mode === 'replace' ? 'slots.choose' : 'slots.target')} value={target} disabled={busy} onChange={event => setTarget(event.target.value)}>
      <option value="">{t(mode === 'replace' ? 'slots.choose' : 'slots.target')}</option>
      {mode === 'replace' ? <><option value="empty">{t('slots.empty')}</option>
        {participants.map(participant => <option key={participant.id} value={participant.id}>{participant.name || t('unknownEntrant')}</option>)}</>
        : swapOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    <ReasonConfirm busy={busy} presets={['slots.seeding', 'slots.withdrawal']} blockedReason={!target ? t('slots.pick') : ''}
      submitLabel={t(mode === 'replace' ? 'slots.replace' : 'slots.swap')} onSubmit={reason => act({ ...body(), reason })} />
  </>;
}
