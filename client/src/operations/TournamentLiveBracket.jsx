import { useMemo, useState } from 'react';
import { groupStage, isLive, needsAttention, playoffRounds, rowTimes } from './tournamentLiveModel.js';
import { StateBadge, clock, entrantName, roundTitle, t, when } from './tournamentLiveUi.jsx';

const FILTERS = ['all', 'attention', 'live'];
const matchesFilter = (match, filter) => filter === 'all' || (filter === 'attention' ? needsAttention(match) : isLive(match));

/** Graphical bracket and groups. Selecting a match opens its panel beside the bracket. */
export default function TournamentLiveBracket({ matches, totals, selectedId, onSelect }) {
  const groups = useMemo(() => groupStage(matches), [matches]);
  const playoffs = useMemo(() => playoffRounds(matches), [matches]);
  const hasPlayoffs = playoffs.rounds.length > 0;
  const playoffStarted = playoffs.rounds.some(round => round.matches.some(match => match.entrant_a || match.entrant_b));
  const [stage, setStage] = useState(groups.length && !playoffStarted ? 'groups' : 'playoffs');
  const [filter, setFilter] = useState('all');
  const [compactChoice, setCompact] = useState(null);
  const firstRound = playoffs.rounds[0]?.matches.length || 0;
  const compact = compactChoice ?? firstRound > 16;
  const shown = groups.length && (!hasPlayoffs || stage === 'groups') ? 'groups' : 'playoffs';

  if (!matches.length) return <p className="op-live-empty">{t('bracket.empty')}</p>;
  return <div className="op-live-board">
    <div className="op-live-toolbar">
      {groups.length > 0 && hasPlayoffs && <div className="op-live-segment" role="tablist" aria-label={t('bracket.stage')}>
        {['groups', 'playoffs'].map(value => <button type="button" role="tab" key={value} aria-selected={shown === value} className={shown === value ? 'is-active' : ''} onClick={() => setStage(value)}>{t(`bracket.stages.${value}`)}</button>)}
      </div>}
      <div className="op-live-segment" role="group" aria-label={t('bracket.filter')}>
        {FILTERS.map(value => <button type="button" key={value} aria-pressed={filter === value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>
          {t(`bracket.filters.${value}`)}{value !== 'all' && <span className="op-live-count">{value === 'attention' ? totals.attention : totals.live}</span>}</button>)}
      </div>
      {shown === 'playoffs' && <label className="op-check op-live-compact"><input type="checkbox" checked={compact} onChange={event => setCompact(event.target.checked)} /> {t('bracket.compact')}</label>}
    </div>
    <p className="op-live-hint">{t('bracket.help')}</p>
    {shown === 'groups'
      ? <GroupsView groups={groups} filter={filter} selectedId={selectedId} onSelect={onSelect} />
      : <PlayoffView playoffs={playoffs} filter={filter} compact={compact} selectedId={selectedId} onSelect={onSelect} />}
    <Legend />
  </div>;
}

function PlayoffView({ playoffs, filter, compact, selectedId, onSelect }) {
  const { rounds, third, regular } = playoffs;
  if (!rounds.length) return <p className="op-live-empty">{t('bracket.noPlayoffs')}</p>;
  return <div className={`op-live-tree${regular ? ' is-regular' : ''}${compact ? ' is-compact' : ''}`}>
    {rounds.map((round, index) => {
      const times = rowTimes(round);
      return <div className={`op-live-col${index < rounds.length - 1 ? ' is-link' : ''}${index > 0 ? ' is-fed' : ''}`} key={round.key}>
        <header><strong>{roundTitle(round)}</strong><small>{t('bracket.roundMeta', { count: round.matches.length })}{times.kind !== 'none' && ` · ${clock(times.first)}`}</small></header>
        <div className="op-live-col-body">
          {round.matches.map(match => <div className="op-live-cell" key={match.id}>
            <MatchCard match={match} dim={!matchesFilter(match, filter)} selected={match.id === selectedId} onSelect={onSelect} compact={compact} />
          </div>)}
        </div>
      </div>;
    })}
    {third && <div className="op-live-col" key="third">
      <header><strong>{t('round.third')}</strong><small>{t('bracket.roundMeta', { count: 1 })}{third.scheduled_at && ` · ${clock(third.scheduled_at)}`}</small></header>
      <div className="op-live-col-body"><div className="op-live-cell">
        <MatchCard match={third} dim={!matchesFilter(third, filter)} selected={third.id === selectedId} onSelect={onSelect} compact={compact} />
      </div></div>
    </div>}
  </div>;
}

function GroupsView({ groups, filter, selectedId, onSelect }) {
  return <div className="op-live-groups">
    {groups.map(group => <section className="op-live-group" key={group.label} aria-label={t('round.group', { group: group.label })}>
      <header><strong>{t('round.group', { group: group.label })}</strong><small>{t('bracket.groupMeta', { done: group.matches.filter(match => match.winner_id).length, total: group.matches.length })}</small></header>
      {group.standings.length > 0 && <table className="op-live-table">
        <thead><tr><th scope="col">#</th><th scope="col">{t('groups.entrant')}</th><th scope="col">{t('groups.wins')}</th><th scope="col">{t('groups.losses')}</th><th scope="col">{t('groups.maps')}</th></tr></thead>
        <tbody>{group.standings.map((row, index) => <tr key={`${row.entrant.kind}:${row.entrant.id}`}><td>{index + 1}</td><td>{entrantName(row.entrant)}</td><td>{row.wins}</td><td>{row.losses}</td><td>{row.mapsFor}–{row.mapsAgainst}</td></tr>)}</tbody>
      </table>}
      {group.rounds.map(round => <div className="op-live-matchday" key={round.round}>
        <h4>{t('round.matchday', { round: round.round })}</h4>
        {round.matches.map(match => <MatchCard key={match.id} match={match} row dim={!matchesFilter(match, filter)} selected={match.id === selectedId} onSelect={onSelect} />)}
      </div>)}
    </section>)}
  </div>;
}

function MatchCard({ match, selected, dim, onSelect, compact = false, row = false }) {
  const sides = [['a', match.entrant_a, match.score_a], ['b', match.entrant_b, match.score_b]];
  const label = t('bracket.openMatch', { a: entrantName(match.entrant_a), b: entrantName(match.entrant_b) });
  return <button type="button" aria-pressed={selected} aria-label={label} title={label} onClick={() => onSelect(selected ? null : match.id)}
    className={`op-live-card${selected ? ' is-selected' : ''}${dim ? ' is-dim' : ''}${row ? ' is-row' : ''}${needsAttention(match) ? ' is-alert' : ''}`}>
    {sides.map(([side, entrant, score]) => <span key={side} className={`op-live-side${entrant && match.winner_id === entrant.id ? ' is-winner' : ''}${!entrant ? ' is-empty' : ''}`}>
      <span className="op-live-name">{entrantName(entrant)}</span><strong>{score ?? ''}</strong>
    </span>)}
    {!compact && <span className="op-live-foot"><StateBadge match={match} /><small>{match.scheduled_at ? when(match.scheduled_at) : t('match.unscheduled')}</small></span>}
  </button>;
}

function Legend() {
  return <ul className="op-live-legend" aria-label={t('bracket.legend')}>
    {['disputed', 'reported', 'veto', 'playing', 'ready', 'waiting', 'confirmed'].map(state => <li key={state}><span className={`op-live-dot is-${state}`} />{t(`state.${state}`)}</li>)}
  </ul>;
}
