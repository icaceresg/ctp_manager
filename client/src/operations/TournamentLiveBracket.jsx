import { useMemo, useRef, useState } from 'react';
import { CalendarClock, ChevronRight, GripVertical, Info } from 'lucide-react';
import { groupStage, isLive, needsAttention, playoffRounds, scheduleLocked, slotsLocked } from './tournamentLiveModel.js';
import { competitionDateTime } from './competitionTime.js';
import { ReasonConfirm, StateBadge, entrantName, roundTitle, t } from './tournamentLiveUi.jsx';

const FILTERS = ['all', 'attention', 'live'];
const matchesFilter = (match, filter) => filter === 'all' || (filter === 'attention' ? needsAttention(match) : isLive(match));

/** Graphical bracket and groups. Selecting a match opens its panel beside the bracket. */
export default function TournamentLiveBracket({ matches, participants, standingsOrder, totals, selectedId, onSelect, run, revision, busy, status, canPlaceGroups, onParticipants }) {
  const groups = useMemo(() => groupStage(matches, standingsOrder), [matches, standingsOrder]);
  const playoffs = useMemo(() => playoffRounds(matches), [matches]);
  const hasPlayoffs = playoffs.rounds.length > 0;
  const playoffStarted = playoffs.rounds.some(round => round.matches.some(match => match.entrant_a || match.entrant_b));
  const [stage, setStage] = useState(null);
  const [filter, setFilter] = useState('all');
  const [compactChoice, setCompact] = useState(null);
  const [source, setSource] = useState(null);
  const [pending, setPending] = useState(null);
  const [placement, setPlacement] = useState(null);
  const [dragging, setDragging] = useState(null);
  const dragSource = useRef(null);
  const firstRound = playoffs.rounds[0]?.matches.length || 0;
  const compact = compactChoice ?? firstRound > 16;
  const shown = groups.length && (!hasPlayoffs || (stage ?? (playoffStarted ? 'playoffs' : 'groups')) === 'groups') ? 'groups' : 'playoffs';
  const canEdit = Boolean(run) && !['cancelado', 'finalizado'].includes(status);
  const canSwap = canEdit && !busy && !pending && !placement;
  const participantIds = useMemo(() => new Map(participants?.map(person => [`${person.entrant_kind}:${person.entrant_id}`, person.id])), [participants]);
  const drawn = useMemo(() => new Set(matches.flatMap(match => [match.entrant_a, match.entrant_b])
    .filter(Boolean).map(entrant => `${entrant.kind}:${entrant.id}`)), [matches]);
  const unplaced = participants?.filter(person => !drawn.has(`${person.entrant_kind}:${person.entrant_id}`)
    && (person.entrant_kind === 'user' || person.access?.length)) || [];
  const assignable = canPlaceGroups && canEdit && !playoffStarted && !pending && !placement && unplaced.length > 0;
  const canExpandFive = participants?.length === 11 && groups.length === 2 && groups.every(group => group.standings.length === 5);

  function prepare(from, to) {
    if (!canSwap || !from?.entrant || from.key === to.key || from.stage !== to.stage || from.revision !== revision
      || (from.stage === 'groups' && from.group === to.group)) return;
    const body = from.stage === 'groups'
      ? { action: 'swap_group_entrants', participant_id: from.participantId, other_participant_id: to.participantId }
      : { action: 'swap_entrants', match_id: from.matchId, side: from.side, other_match_id: to.matchId, other_side: to.side };
    setPending({ from, to, body, revision });
    setSource(null);
  }

  function slotControl(slot, content) {
    const current = dragging || source;
    const active = current?.revision === revision ? current : null;
    const same = active?.key === slot.key;
    const target = active?.stage === slot.stage && !same && (slot.stage !== 'groups' || active.group !== slot.group);
    if (!canSwap || (!slot.entrant && !target)) return content;
    return <button type="button" className={`op-live-slot-button${same ? ' is-origin' : ''}${target ? ' is-target' : ''}`}
      aria-pressed={same} aria-label={t('bracket.moveSlot', { name: entrantName(slot.entrant) })} title={t('bracket.moveSlot', { name: entrantName(slot.entrant) })}
      draggable={Boolean(slot.entrant)} onClick={() => target ? prepare(source, slot) : setSource(same ? null : { ...slot, revision })}
      onDragStart={event => {
        const from = { ...slot, revision };
        dragSource.current = from;
        setDragging(from);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', entrantName(slot.entrant));
      }} onDragEnd={() => { dragSource.current = null; setDragging(null); }}
      onDragOver={event => {
        if (!dragSource.current || !target) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }} onDrop={event => {
        event.preventDefault();
        prepare(dragSource.current, slot);
        dragSource.current = null;
        setDragging(null);
      }}>
      <GripVertical size={12} aria-hidden="true" />{content}
    </button>;
  }

  const groupSlot = (group, entrant, content) => {
    const participantId = participantIds.get(`${entrant.kind}:${entrant.id}`);
    return !playoffStarted && participantId && !group.matches.some(slotsLocked)
      ? slotControl({ key: participantId, stage: 'groups', group: group.label, entrant, participantId }, content) : content;
  };
  const playoffSlot = (match, side, entrant, content) => match.round === 1 && !match.is_third_place && !slotsLocked(match)
    ? slotControl({ key: `${match.id}:${side}`, stage: 'playoffs', entrant, matchId: match.id, side }, content) : content;

  if (!matches.length) return <p className="op-live-empty">{t('bracket.empty')}</p>;
  return <div className="op-live-board">
    <div className="op-live-toolbar">
      {groups.length > 0 && hasPlayoffs && <div className="op-live-segment" role="tablist" aria-label={t('bracket.stage')}>
        {['groups', 'playoffs'].map(value => <button type="button" role="tab" key={value} aria-selected={shown === value} className={shown === value ? 'is-active' : ''} onClick={() => { setStage(value); setSource(null); }}>{t(`bracket.stages.${value}`)}</button>)}
      </div>}
      <div className="op-live-segment" role="group" aria-label={t('bracket.filter')}>
        {FILTERS.map(value => <button type="button" key={value} aria-pressed={filter === value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>
          {t(`bracket.filters.${value}`)}{value !== 'all' && <span className="op-live-count">{value === 'attention' ? totals.attention : totals.live}</span>}</button>)}
      </div>
      {shown === 'playoffs' && <label className="op-check op-live-compact"><input type="checkbox" checked={compact} onChange={event => setCompact(event.target.checked)} /> {t('bracket.compact')}</label>}
      {canEdit && <span className="op-live-info" tabIndex={0} aria-label={t('bracket.editHelp')} title={t('bracket.editHelp')}><Info size={16} aria-hidden="true" /></span>}
    </div>
    {source?.revision === revision && source && !pending && <div className="op-live-swap" role="status">
      <span>{t('bracket.chooseTarget', { name: entrantName(source.entrant) })}</span>
      <button className="btn ghost sm" type="button" onClick={() => setSource(null)}>{t('confirm.cancel')}</button>
    </div>}
    {pending && <section className="op-live-swap">
      <header><strong>{t(pending.to.entrant ? 'bracket.confirmSwap' : 'bracket.confirmMove', { a: entrantName(pending.from.entrant), b: entrantName(pending.to.entrant) })}</strong>
        <button className="btn ghost sm" type="button" disabled={busy} onClick={() => setPending(null)}>{t('confirm.cancel')}</button></header>
      <ReasonConfirm busy={busy} defaultReason={t('presets.slots.drawAdjustment')}
        blockedReason={!canEdit || revision !== pending.revision ? t('error.conflict') : ''} submitLabel={t('bracket.applySwap')}
        onSubmit={async reason => {
          const problem = await run({ ...pending.body, reason, expected_revision: pending.revision });
          if (!problem) setPending(null);
          return problem;
        }} />
    </section>}
    {placement && <PlaceInGroup key={placement.label} placement={placement} participants={unplaced} busy={busy}
      blocked={!canPlaceGroups || !canEdit || placement.revision !== revision} run={run}
      onClose={() => setPlacement(null)} onParticipants={onParticipants} />}
    {shown === 'groups' && assignable && !canExpandFive && !groups.some(group => group.standings.length === 4) &&
      <p className="op-live-why">{t('error.groupFull')}</p>}
    {shown === 'groups'
      ? <GroupsView groups={groups} filter={filter} selectedId={selectedId} onSelect={onSelect} groupSlot={groupSlot} canEdit={canEdit}
        onPlace={assignable ? label => { setSource(null); setPlacement({ label, revision }); } : undefined} canExpandFive={canExpandFive} busy={busy} />
      : <PlayoffView playoffs={playoffs} filter={filter} compact={compact} selectedId={selectedId} onSelect={onSelect} playoffSlot={playoffSlot} canEdit={canEdit} />}
    <Legend />
  </div>;
}

function PlaceInGroup({ placement, participants, busy, blocked, run, onClose, onParticipants }) {
  const [id, setId] = useState('');
  const selected = participants.some(person => person.id === id);
  return <section className="op-live-swap">
    <header><strong>{t('bracket.placeGroupTitle', { group: placement.label })}</strong>
      <button type="button" className="btn ghost sm" disabled={busy} onClick={onClose}>{t('confirm.cancel')}</button></header>
    <label className="op-field"><span>{t('bracket.unplaced')}</span>
      <select value={selected ? id : ''} disabled={busy || blocked} onChange={event => setId(event.target.value)}>
        <option value="">{t('slots.choose')}</option>
        {participants.map(person => <option key={person.id} value={person.id}>{person.name || t('unknownEntrant')}</option>)}
      </select>
    </label>
    {onParticipants && <button type="button" className="op-text-button" onClick={onParticipants}>{t('tabs.participants')}</button>}
    <ReasonConfirm busy={busy} defaultReason={t('presets.slots.drawAdjustment')}
      blockedReason={blocked ? t('error.conflict') : !selected ? t('slots.pick') : ''} submitLabel={t('bracket.placeGroup')}
      onSubmit={async reason => {
        const problem = await run({ action: 'place_group_entrant', participant_id: id, group_label: placement.label, reason, expected_revision: placement.revision });
        if (!problem) onClose();
        return problem;
      }} />
  </section>;
}

function PlayoffView({ playoffs, filter, compact, selectedId, onSelect, playoffSlot, canEdit }) {
  const { rounds, third, regular } = playoffs;
  if (!rounds.length) return <p className="op-live-empty">{t('bracket.noPlayoffs')}</p>;
  return <div className={`op-live-tree${regular ? ' is-regular' : ''}${compact ? ' is-compact' : ''}`}>
    {rounds.map((round, index) => {
      return <div className={`op-live-col${index < rounds.length - 1 ? ' is-link' : ''}${index > 0 ? ' is-fed' : ''}`} key={round.key}>
        <header><strong>{roundTitle(round)}</strong><small>{t('bracket.roundMeta', { count: round.matches.length })}</small></header>
        <div className="op-live-col-body">
          {round.matches.map(match => <div className="op-live-cell" key={match.id}>
            <MatchCard match={match} dim={!matchesFilter(match, filter)} selected={match.id === selectedId} onSelect={onSelect} compact={compact} renderSlot={playoffSlot} canEdit={canEdit} />
          </div>)}
        </div>
      </div>;
    })}
    {third && <div className="op-live-col" key="third">
      <header><strong>{t('round.third')}</strong><small>{t('bracket.roundMeta', { count: 1 })}</small></header>
      <div className="op-live-col-body"><div className="op-live-cell">
        <MatchCard match={third} dim={!matchesFilter(third, filter)} selected={third.id === selectedId} onSelect={onSelect} compact={compact} canEdit={canEdit} />
      </div></div>
    </div>}
  </div>;
}

function GroupsView({ groups, filter, selectedId, onSelect, groupSlot, canEdit, onPlace, canExpandFive, busy }) {
  return <div className="op-live-groups">
    {groups.map(group => <section className="op-live-group" key={group.label} aria-label={t('round.group', { group: group.label })}>
      <header><strong>{t('round.group', { group: group.label })}</strong><small>{t('bracket.groupMeta', { done: group.matches.filter(match => match.winner_id).length, total: group.matches.length })}</small></header>
      {group.standings.length > 0 && <table className="op-live-table">
        <thead><tr><th scope="col">#</th><th scope="col">{t('groups.entrant')}</th><th scope="col">{t('groups.wins')}</th><th scope="col">{t('groups.losses')}</th><th scope="col">{t('groups.maps')}</th></tr></thead>
        <tbody>{group.standings.map((row, index) => <tr key={`${row.entrant.kind}:${row.entrant.id}`}><td>{index + 1}</td><td>{groupSlot(group, row.entrant, <span className="op-live-name">{entrantName(row.entrant)}</span>)}</td><td>{row.wins}</td><td>{row.losses}</td><td>{row.mapsFor}–{row.mapsAgainst}</td></tr>)}</tbody>
      </table>}
      {onPlace && (group.standings.length === 4 || canExpandFive) && <button type="button" className="btn sm" disabled={busy} onClick={() => onPlace(group.label)}>{t('bracket.placeGroup')}</button>}
      <details open={filter !== 'all' || group.matches.some(match => match.id === selectedId) || undefined}>
        <summary>{t('bracket.groupFixtures')}</summary>
        {group.rounds.map(round => {
          const playing = new Set(round.matches.flatMap(match => [match.entrant_a, match.entrant_b])
            .filter(Boolean).map(entrant => `${entrant.kind}:${entrant.id}`));
          const rest = group.standings.length === 5 && playing.size === 4
            ? group.standings.find(({ entrant }) => !playing.has(`${entrant.kind}:${entrant.id}`))?.entrant : null;
          return <div className="op-live-matchday" key={round.round}>
            <div className="op-live-matchday-head">
              <h4>{t('round.matchday', { round: round.round })}</h4>
              {rest && <small>{t('round.resting', { name: entrantName(rest) })}</small>}
            </div>
            {round.matches.map(match => <MatchCard key={match.id} match={match} row dim={!matchesFilter(match, filter)} selected={match.id === selectedId} onSelect={onSelect} canEdit={canEdit} />)}
          </div>;
        })}
      </details>
    </section>)}
  </div>;
}

function MatchCard({ match, selected, dim, onSelect, compact = false, row = false, renderSlot, canEdit }) {
  const sides = [['a', match.entrant_a, match.score_a], ['b', match.entrant_b, match.score_b]];
  const label = t('bracket.openMatch', { a: entrantName(match.entrant_a), b: entrantName(match.entrant_b) });
  const time = match.scheduled_at ? competitionDateTime(match.scheduled_at) : t('match.unscheduled');
  const scheduleLabel = t('bracket.editTime', { a: entrantName(match.entrant_a), b: entrantName(match.entrant_b) });
  return <div className={`op-live-card${selected ? ' is-selected' : ''}${dim ? ' is-dim' : ''}${row ? ' is-row' : ''}${needsAttention(match) ? ' is-alert' : ''}`}>
    {sides.map(([side, entrant, score]) => {
      const name = <span className="op-live-name">{entrantName(entrant)}</span>;
      return <span key={side} className={`op-live-side${entrant && match.winner_id === entrant.id ? ' is-winner' : ''}${!entrant ? ' is-empty' : ''}`}>
        {renderSlot ? renderSlot(match, side, entrant, name) : name}<strong>{score ?? ''}</strong>
      </span>;
    })}
    <div className="op-live-foot">
      {canEdit && !scheduleLocked(match) && onSelect
        ? <button className="op-live-time" type="button" aria-label={scheduleLabel} title={scheduleLabel} onClick={() => onSelect(match.id, 'schedule')}><CalendarClock size={13} /><small>{time}</small></button>
        : <small className="op-live-time" title={time}>{time}</small>}
      {onSelect && <button type="button" className="op-live-open-match" aria-pressed={selected} aria-label={label} title={label} onClick={() => onSelect(selected ? null : match.id)}><ChevronRight size={16} /></button>}
    </div>
    {!compact && <StateBadge match={match} />}
  </div>;
}

function Legend() {
  return <ul className="op-live-legend" aria-label={t('bracket.legend')}>
    {['disputed', 'reported', 'veto', 'playing', 'ready', 'waiting', 'confirmed'].map(state => <li key={state}><span className={`op-live-dot is-${state}`} />{t(`state.${state}`)}</li>)}
  </ul>;
}
