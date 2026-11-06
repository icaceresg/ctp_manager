import { useMemo, useState } from 'react';
import { ChevronDown, Search, UserPlus } from 'lucide-react';
import { ReasonConfirm, t } from './tournamentLiveUi.jsx';

/**
 * Compact entrant list. Who advances is corrected from the bracket (results),
 * so this view only registers or withdraws entrants that are not yet in it.
 */
export default function TournamentLiveParticipants({ live, run, findCandidates, busy }) {
  const { participants = [], matches = [], tournament } = live;
  const [filter, setFilter] = useState(''), [openId, setOpenId] = useState(null), [adding, setAdding] = useState(false);
  const inBracket = participant => matches.some(match => [match.entrant_a, match.entrant_b].some(entrant => entrant && entrant.kind === participant.entrant_kind && entrant.id === participant.entrant_id));
  const shown = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return query ? participants.filter(participant => String(participant.name || '').toLowerCase().includes(query)) : participants;
  }, [participants, filter]);

  return <div className="op-live-people">
    <p className="op-help">{t('people.help')}</p>
    <div className="op-live-toolbar">
      <label className="op-live-search"><Search size={15} /><input value={filter} maxLength={40} placeholder={t('people.filter')} aria-label={t('people.filter')} onChange={event => setFilter(event.target.value)} /></label>
      <span className="op-live-count-text">{t('people.count', { count: participants.length, max: tournament.max_participants ?? '—' })}</span>
      <button type="button" className="btn" aria-expanded={adding} onClick={() => setAdding(value => !value)}><UserPlus size={15} /> {t('add.title')}</button>
    </div>
    {adding && <AddParticipant run={run} findCandidates={findCandidates} busy={busy} />}
    {!participants.length ? <p className="op-live-empty">{t('participants.empty')}</p> : !shown.length ? <p className="op-live-empty">{t('search.empty')}</p> :
      <ul className="op-live-people-list">
        {shown.map(participant => {
          const expanded = openId === participant.id, placed = inBracket(participant);
          return <li key={participant.id} className={expanded ? 'is-open' : ''}>
            <button type="button" className="op-live-person" aria-expanded={expanded} onClick={() => setOpenId(expanded ? null : participant.id)}>
              <strong>{participant.name || t('unknownEntrant')}</strong>
              <small>{t(`kind.${participant.entrant_kind}`)}{participant.seed != null && ` · ${t('participants.seed', { seed: participant.seed })}`} · {t('people.roster', { count: participant.roster.length })}</small>
              {placed && <span className="op-live-tag">{t('participants.inBracket')}</span>}
              <ChevronDown size={15} />
            </button>
            {expanded && <div className="op-live-action-body">
              <p className="op-live-hint">{participant.roster.length ? participant.roster.join(', ') : t('participants.rosterEmpty')}</p>
              {placed ? <p className="op-live-why">{t('people.placed')}</p> : <>
                <p className="op-live-hint">{t('people.removeHelp')}</p>
                <ReasonConfirm busy={busy} danger presets={['participants.remove']} submitLabel={t('participants.remove')}
                  onSubmit={reason => run({ action: 'remove_participant', participant_id: participant.id, reason })} />
              </>}
            </div>}
          </li>;
        })}
      </ul>}
  </div>;
}

function AddParticipant({ run, findCandidates, busy }) {
  const [query, setQuery] = useState(''), [items, setItems] = useState(null), [error, setError] = useState(''), [searching, setSearching] = useState(false), [chosen, setChosen] = useState(null);
  async function search(event) {
    event.preventDefault();
    if (query.trim().length < 3) { setError(t('error.query')); return; }
    setSearching(true); setError('');
    const result = await findCandidates(query.trim());
    setSearching(false);
    if (result.error) setError(result.error); else { setItems(result.items); setChosen(null); }
  }
  return <section className="op-live-add" aria-label={t('add.title')}>
    <p className="op-live-hint">{t('add.help')}</p>
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
