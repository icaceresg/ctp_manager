import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Pencil, Search, UserPlus } from 'lucide-react';
import { getIntlLocale } from '../i18n/runtime.js';
import { ReasonConfirm, t, tournamentLiveError } from './tournamentLiveUi.jsx';
import './tournament-registrations.css';

/**
 * Compact entrant list. Who advances is corrected from the bracket (results),
 * so this view only registers or withdraws entrants that are not yet in it.
 */
export default function TournamentLiveParticipants({ live, run, findCandidates, loadRoster, findEligibleTeams, busy }) {
  const { participants = [], eligible_teams = [], matches = [], tournament } = live;
  const [filter, setFilter] = useState(''), [openId, setOpenId] = useState(null), [adding, setAdding] = useState(false);
  const [editor, setEditor] = useState(null);
  const [teamSearch, setTeamSearch] = useState(null);
  const number = new Intl.NumberFormat(getIntlLocale());
  const query = filter.trim();
  const hasMoreTeams = eligible_teams.length === 512 && Boolean(findEligibleTeams);
  useEffect(() => {
    if (!hasMoreTeams || query.length < 3) return undefined;
    let active = true;
    const timer = setTimeout(() => {
      findEligibleTeams(query).then(items => { if (active) setTeamSearch({ query, items }); })
        .catch(cause => { if (active) setTeamSearch({ query, items: [], error: tournamentLiveError(cause) }); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [query, hasMoreTeams, findEligibleTeams, live.revision]);
  const search = hasMoreTeams && query === teamSearch?.query ? teamSearch : null;
  const inBracket = participant => matches.some(match => [match.entrant_a, match.entrant_b].some(entrant => entrant && entrant.kind === participant.entrant_kind && entrant.id === participant.entrant_id));
  const shown = useMemo(() => {
    const matchName = query.toLocaleLowerCase(getIntlLocale());
    const registeredTeamIds = new Set(participants.filter(p => p.entrant_kind === 'team').map(p => p.entrant_id));
    const teams = new Map([...eligible_teams, ...(search?.items || [])].filter(team => !registeredTeamIds.has(team.id)).map(team => [team.id, team]));
    const rows = [
      ...participants.map(participant => ({ ...participant, registered: true })),
      ...Array.from(teams.values(), team => ({ ...team, entrant_id: team.id, entrant_kind: 'team', roster: [], registered: false })),
    ];
    return matchName ? rows.filter(participant => String(participant.name || '').toLocaleLowerCase(getIntlLocale()).includes(matchName)) : rows;
  }, [participants, eligible_teams, query, search]);
  const showAddPlayer = run && tournament.can_add_registration && tournament.participant_type !== 'equipo';

  return <div className="op-live-people">
    <div className="op-live-toolbar">
      <label className="op-live-search"><Search size={15} aria-hidden="true" /><input value={filter} maxLength={40} placeholder={t('people.filter')} aria-label={t('people.filter')} onChange={event => setFilter(event.target.value)} /></label>
      <span className="op-live-count-text">{t('people.count', { count: number.format(participants.length), max: tournament.max_participants == null ? '—' : number.format(tournament.max_participants) })}</span>
      {showAddPlayer && <button type="button" className="btn" aria-expanded={adding} onClick={() => setAdding(value => !value)}><UserPlus size={15} aria-hidden="true" /> {t('add.title')}</button>}
    </div>
    {adding && showAddPlayer && <AddParticipant run={run} findCandidates={findCandidates} busy={busy} />}
    {search?.error && <p className="op-error" role="alert">{search.error}</p>}
    {!shown.length ? <p className="op-live-empty">{t(hasMoreTeams && query.length >= 3 && !search ? 'loading' : query ? 'search.empty' : 'participants.empty')}</p> :
      <ul className="op-live-people-list">
        {shown.map(participant => {
          const expanded = openId === participant.id, placed = participant.registered && inBracket(participant);
          const canAdd = !participant.registered && tournament.can_add_registration;
          const canEdit = participant.registered && participant.can_edit_roster;
          return <li key={participant.id} className={expanded ? 'is-open' : ''}>
            <button type="button" className="op-live-person op-registration-person" aria-expanded={expanded} onClick={() => { setOpenId(expanded ? null : participant.id); setEditor(null); }}>
              <strong>{participant.name || t('unknownEntrant')}</strong>
              <span className="op-registration-badges">
                <span className={`op-live-tag${participant.registered ? ' op-registration-good' : ''}`}>{t(participant.registered ? 'registration.registered' : 'registration.notRegistered')}</span>
                {participant.access?.map(kind => <span key={kind} className="op-live-tag">{t(`registration.access.${kind}`)}</span>)}
                {participant.access?.length === 0 && <span className="op-live-tag op-registration-warning">{t('registration.access.none')}</span>}
                {participant.registered && participant.roster_ready != null && <span className={`op-live-tag ${participant.roster_ready ? 'op-registration-good' : 'op-registration-warning'}`}>{t(participant.roster_ready ? 'registration.rosterReady' : 'registration.rosterPending')}</span>}
                {placed && <span className="op-live-tag">{t('participants.inBracket')}</span>}
              </span>
              <ChevronDown size={15} aria-hidden="true" />
            </button>
            {expanded && <div className="op-live-action-body">
              {participant.registered && participant.entrant_kind === 'team' && <>
                <small className="muted">{t('people.roster', { count: number.format(participant.roster.length) })}</small>
                {participant.roster.length ? <ul className="op-registration-names">{participant.roster.map((name, index) => <li key={`${name}:${index}`}>{name}</li>)}</ul> : <p className="muted">{t('participants.rosterEmpty')}</p>}
              </>}
              {loadRoster && (canAdd || canEdit) && editor !== participant.id && <button type="button" className="btn" disabled={busy} title={canEdit ? t('registration.editRosterHelp') : undefined} onClick={() => setEditor(participant.id)}>
                {canAdd ? <UserPlus size={15} aria-hidden="true" /> : <Pencil size={15} aria-hidden="true" />} {t(canAdd ? 'add.title' : 'registration.editRoster')}
              </button>}
              {loadRoster && (canAdd || canEdit) && editor === participant.id && <RosterEditor participant={participant} tournament={tournament} loadRoster={loadRoster} run={run} busy={busy} onClose={() => setEditor(null)} />}
              {run && participant.registered && !placed && editor !== participant.id && <details className="op-details">
                <summary>{t('participants.remove')}</summary>
                <ReasonConfirm busy={busy} danger presets={['participants.remove']} submitLabel={t('participants.remove')}
                  onSubmit={reason => run({ action: 'remove_participant', participant_id: participant.id, reason })} />
              </details>}
            </div>}
          </li>;
        })}
      </ul>}
  </div>;
}

function RosterEditor({ participant, tournament, loadRoster, run, busy, onClose }) {
  const [members, setMembers] = useState(null);
  const [selected, setSelected] = useState([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const teamId = participant.entrant_id;
  const min = tournament.roster_min;
  const max = tournament.roster_max;
  const number = new Intl.NumberFormat(getIntlLocale());
  useEffect(() => {
    let active = true;
    loadRoster(teamId).then(items => {
      if (!active) return;
      setMembers(items);
      setSelected(items.filter(item => item.selected && item.available).map(item => item.id));
    }).catch(cause => { if (active) setError(tournamentLiveError(cause)); });
    return () => { active = false; };
  }, [loadRoster, teamId]);
  const ready = selected.length >= min && selected.length <= max;
  return <section className="op-registration-editor" aria-label={t('registration.editRoster')}>
    <button type="button" className="btn ghost sm" onClick={onClose} disabled={busy}>{t('confirm.cancel')}</button>
    {!participant.registered && <label className="op-check">
      <input type="checkbox" checked={pending} onChange={event => setPending(event.target.checked)} disabled={busy} />
      {t('registration.addPending')}
    </label>}
    {!pending && (error ? <p className="op-error" role="alert">{error}</p> : !members ? <p role="status">{t('loading')}</p> :
      <fieldset className="op-registration-options" disabled={busy}>
        <legend>{t('registration.selectRoster', { min: number.format(min), max: number.format(max) })}</legend>
        {members.length ? members.map(member => {
          const checked = selected.includes(member.id);
          return <label key={member.id} className="op-check">
            <input type="checkbox" checked={checked} disabled={!member.available || (!checked && selected.length >= max)}
              onChange={() => setSelected(current => checked ? current.filter(id => id !== member.id) : [...current, member.id])} />
            {member.name}{!member.available && <small className="muted">{t('registration.playerUnavailable')}</small>}
          </label>;
        }) : <p className="muted">{t('registration.emptyClub')}</p>}
      </fieldset>)}
    {(pending || members) && <ReasonConfirm busy={busy} presets={[participant.registered ? 'participants.roster' : 'participants.add']}
        blockedReason={pending || ready ? '' : t('registration.selectRoster', { min: number.format(min), max: number.format(max) })}
        submitLabel={participant.registered ? t('registration.saveRoster') : t('add.apply', { name: participant.name })}
        onSubmit={async reason => {
          const problem = await run({ action: participant.registered ? 'set_registration_roster' : 'add_team_registration', team_id: teamId, member_ids: pending ? [] : selected, reason });
          if (!problem) onClose();
          return problem;
        }} />}
  </section>;
}

function AddParticipant({ run, findCandidates, busy }) {
  const [query, setQuery] = useState(''), [items, setItems] = useState(null), [error, setError] = useState(''), [searching, setSearching] = useState(false), [chosen, setChosen] = useState(null);
  async function search(event) {
    event.preventDefault();
    if (query.trim().length < 3) { setError(t('error.query')); return; }
    setSearching(true); setError('');
    const result = await findCandidates(query.trim());
    setSearching(false);
    if (result.error) setError(result.error); else { setItems(result.items.filter(item => item.kind === 'user')); setChosen(null); }
  }
  return <section className="op-live-add" aria-label={t('add.title')}>
    <form className="op-actions" onSubmit={search}>
      <input aria-label={t('search.label')} placeholder={t('search.placeholder')} value={query} maxLength={40} disabled={searching || busy} onChange={event => setQuery(event.target.value)} />
      <button className="btn" disabled={searching || busy}><Search size={14} /> {t('search.button')}</button>
    </form>
    {error && <p className="op-error" role="alert">{error}</p>}
    {items && (!items.length ? <p className="op-live-empty">{t('search.empty')}</p> : <div className="op-live-scores" role="radiogroup" aria-label={t('search.label')}>
      {items.map(item => <button type="button" role="radio" key={item.kind + item.id} aria-checked={chosen === item} disabled={item.registered || busy}
        className={`op-live-score-option${chosen === item ? ' is-active' : ''}`} onClick={() => setChosen(item)}>
        <strong>{item.name}</strong><small>{t(`kind.${item.kind}`)}{item.registered && ` · ${t('search.registered')}`}</small></button>)}
    </div>)}
    {chosen && <ReasonConfirm busy={busy} presets={['participants.add']} submitLabel={t('add.apply', { name: chosen.name })}
      onSubmit={async reason => { const problem = await run({ action: 'add_participant', entrant_kind: chosen.kind, entrant_id: chosen.id, reason }); if (!problem) { setChosen(null); setItems(null); setQuery(''); } return problem; }} />}
  </section>;
}
