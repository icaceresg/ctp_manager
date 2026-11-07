import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { api } from '../api.js';
import { getIntlLocale, translate } from '../i18n/runtime.js';
import { competitionDateInput, competitionDateToIso } from './competitionTime.js';
import { roundTitle } from './tournamentLiveUi.jsx';
import './tournamentScheduleScenarios.css';

const prefix = 'manager.tournamentScenario.';
const t = (key, values) => translate(`${prefix}${key}`, values);
const localDates = dates => Object.fromEntries(Object.entries(dates).map(([key, value]) => [key, competitionDateInput(value)]));
const OTHER_EXACT = 'other-exact';

function errorText(cause) {
  if (typeof cause?.message === 'string' && cause.message.startsWith(prefix)) return translate(cause.message);
  if (cause?.status === 409) return t('error.conflict');
  return t('error.unavailable');
}

function eliminationLabel(size, round) {
  const remaining = size / 2 ** (round - 1);
  return roundTitle({ name: { 2: 'final', 4: 'semi', 8: 'quarter' }[remaining] || 'ofN', size: remaining });
}

function scenarioSelection(value) {
  return value.range_key == null ? String(value.entrant_count) : `range-${value.range_key}`;
}

function formatCounts(counts, number, list) {
  const runs = [];
  for (const count of counts) {
    const current = runs.at(-1);
    if (current && count === current[1] + 1) current[1] = count;
    else runs.push([count, count]);
  }
  return list.format(runs.map(([first, last]) => first === last ? number(first) : `${number(first)}–${number(last)}`));
}

export default function TournamentScheduleScenarios({ tournament, entrantCount, canWrite }) {
  const [opened, setOpened] = useState(false);
  return <details className="op-scenario" onToggle={event => { if (event.currentTarget.open) setOpened(true); }}>
    <summary><CalendarClock size={16} aria-hidden="true" />{t('title')}</summary>
    {opened && <ScenarioEditor key={tournament.id} tournament={tournament} entrantCount={entrantCount} canWrite={canWrite} />}
  </details>;
}

function ScenarioEditor({ tournament, entrantCount, canWrite }) {
  const [startCount] = useState(() => Math.max(2, Math.min(256, entrantCount || tournament.max_participants || 16)));
  const [selection, setSelection] = useState(() => tournament.has_group_stage
    ? `range-${startCount === 11 ? 11 : Math.max(2, 2 ** Math.floor(Math.log2(startCount - 1)))}` : String(startCount));
  const [snapshot, setSnapshot] = useState(null);
  const [savedRanges, setSavedRanges] = useState([]);
  const [showExact, setShowExact] = useState(false);
  const [draft, setDraft] = useState({});
  const [stage, setStage] = useState(tournament.has_group_stage ? 'groups' : 'playoffs');
  const [group, setGroup] = useState('A');
  const [round, setRound] = useState(1);
  const [fill, setFill] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const numbers = new Intl.NumberFormat(getIntlLocale());
  const n = value => numbers.format(value);
  const lists = new Intl.ListFormat(getIntlLocale());
  const rangeMode = selection.startsWith('range-');
  const path = `/operations/tournaments/${encodeURIComponent(tournament.id)}/scenarios/${encodeURIComponent(selection)}`;
  const editable = canWrite && !['cancelado','finalizado'].includes(tournament.status);

  useEffect(() => {
    const request = new AbortController();
    setError(''); setNotice(''); setFill(''); setWorking(true);
    api.get(path, { signal: request.signal }).then(value => {
      if (request.signal.aborted) return;
      setSnapshot(value);
      if (value.range_key != null) setSavedRanges(value.saved_ranges);
      setDraft(localDates(value.dates));
      setGroup(value.scenario?.groups[0]?.label || 'A');
      setRound(1);
      if (value.scenario && !value.scenario.groups.length) setStage('playoffs');
      if (!value.scenario && value.available_counts.length) {
        const target = rangeMode ? startCount : Number(selection);
        const nearest = value.available_counts.reduce((best, candidate) =>
          Math.abs(candidate - target) < Math.abs(best - target) ? candidate : best);
        const range = rangeMode && value.available_ranges.find(entry => entry.counts.includes(nearest));
        setSelection(range ? `range-${range.key}` : String(nearest));
      }
    }).catch(cause => { if (!request.signal.aborted) setError(errorText(cause)); })
      .finally(() => { if (!request.signal.aborted) setWorking(false); });
    return () => request.abort();
  }, [path, rangeMode, selection, startCount, reload]);

  const current = snapshot && scenarioSelection(snapshot) === selection;
  const scenario = current && !(showExact && rangeMode) ? snapshot.scenario : null;
  const original = current ? localDates(snapshot.dates) : {};
  const filled = Object.values(draft).filter(Boolean).length;
  const dirty = Object.keys({ ...original, ...draft }).some(key => (original[key] || '') !== (draft[key] || ''));
  const groups = scenario?.groups ?? [];
  const selectedGroup = groups.find(item => item.label === group);
  const groupFixtures = scenario?.fixtures.filter(fixture => fixture.group_label === group) ?? [];
  const groupDays = [...new Set(groupFixtures.map(fixture => fixture.round))];
  const day = groupDays.includes(round) ? round : groupDays[0];
  const visible = scenario?.fixtures.filter(fixture => stage === 'groups' ? fixture.group_label === group && fixture.round === day
    : fixture.phase === 'eliminacion' && (round === 0 ? fixture.is_third_place : !fixture.is_third_place && fixture.round === round)) ?? [];
  const knockoutRounds = [...new Set(scenario?.fixtures.filter(fixture => fixture.phase === 'eliminacion' && !fixture.is_third_place).map(fixture => fixture.round))];
  const hasThird = scenario?.fixtures.some(fixture => fixture.is_third_place);
  const resting = selectedGroup?.seeds.filter(seed => !visible.some(fixture => fixture.seed_a === seed || fixture.seed_b === seed)) ?? [];

  async function save() {
    if (!snapshot || working || !editable) return;
    setWorking(true); setError(''); setNotice('');
    try {
      const dates = Object.fromEntries(Object.entries(draft).filter(([, value]) => value).map(([key, value]) => [
        key, new Date(competitionDateToIso(value, snapshot.dates[key])).toISOString(),
      ]));
      const result = await api.put(path, { dates, expected_version: snapshot.version, tournament_version: snapshot.tournament_version });
      setSnapshot(result);
      if (result.range_key != null) setSavedRanges(result.saved_ranges);
      setDraft(localDates(result.dates));
      setNotice(t('saved'));
    } catch (cause) {
      setError(cause?.status ? errorText(cause) : cause.message);
    } finally { setWorking(false); }
  }

  const changeStage = next => { setStage(next); setRound(1); setFill(''); };
  const changeRound = next => { setRound(Number(next)); setFill(''); };
  const selectScenario = next => { setSelection(next); setDraft({}); };
  const changeFill = event => setFill(event.currentTarget.value);
  const exactOption = value => <option key={value} value={value}>{snapshot.saved_counts.includes(value)
    ? t('savedCount', { count: n(value) }) : n(value)}</option>;
  const rangeOption = entry => {
    const label = entry.key === 11 ? t('specialOption', { count: n(11) }) : t('rangeOption', { counts: formatCounts(entry.counts, n, lists) });
    return <option key={entry.key} value={`range-${entry.key}`}>
      {savedRanges.includes(entry.key) ? t('rangeSaved', { label }) : label}
    </option>;
  };
  const validSelection = snapshot && (rangeMode ? snapshot.available_ranges.some(entry => `range-${entry.key}` === selection)
    : snapshot.available_counts.includes(Number(selection)));
  const compactExact = Boolean(snapshot?.available_ranges.length);
  const savedExact = snapshot?.available_counts.filter(value => snapshot.saved_counts.includes(value)
    || (!showExact && String(value) === selection)) ?? [];
  function changeScope(event) {
    const next = event.target.value;
    setShowExact(next === OTHER_EXACT);
    if (next !== OTHER_EXACT) selectScenario(next);
  }
  return <div className="op-scenario-body" aria-busy={working}>
    <p className="muted">{t(tournament.has_group_stage ? 'rangeHelp' : 'help')}</p>
    {snapshot?.available_counts.length > 0 && <label className="op-field op-scenario-count"><span>{t(tournament.has_group_stage ? 'scope' : 'entrants')}</span>
      <select value={showExact && compactExact ? OTHER_EXACT : selection} disabled={working || dirty} onChange={changeScope}>
        {!validSelection && <option value={selection}>{t('loading')}</option>}
        {snapshot.available_ranges.length > 0 && <optgroup label={t('rangeGroup')}>{snapshot.available_ranges.map(rangeOption)}</optgroup>}
        {compactExact ? <optgroup label={t('exactGroup')}>
          {savedExact.map(exactOption)}
          <option value={OTHER_EXACT}>{t('otherExact')}</option>
        </optgroup>
          : snapshot.available_counts.map(exactOption)}
      </select>
    </label>}
    {showExact && compactExact && <label className="op-field op-scenario-count"><span>{t('entrants')}</span>
      <select value={rangeMode ? '' : selection} disabled={working || dirty} onChange={event => selectScenario(event.target.value)}>
        <option value="" disabled>{t('chooseExact')}</option>
        {snapshot.available_counts.map(exactOption)}
      </select>
    </label>}
    {working && !scenario && <p role="status">{t('loading')}</p>}
    {!working && snapshot?.available_counts.length === 0 && <p className="muted">{t('noCounts')}</p>}
    {error && <p role="alert" className="op-error">{error}</p>}
    {notice && <p role="status" className="op-notice">{notice}</p>}
    {error && <button className="btn sm" type="button" disabled={working} onClick={() => setReload(value => value + 1)}>{t('reload')}</button>}
    {scenario && <>
      <div className="op-scenario-meta">
        {groups.length > 0 && <span>{t('groupSizes', { sizes: lists.format([...new Set(groups.map(item => item.seeds.length))].sort().map(size => n(size))) })}</span>}
        <span>{t('bracketSize', { size: n(scenario.bracket_size) })}</span>
        <span>{t('dated', { done: n(filled), total: n(scenario.fixtures.length) })}</span>
      </div>
      {groups.length > 0 && <div className="op-actions" aria-label={t('stage')}>
        <button className={`btn sm${stage === 'groups' ? ' primary' : ''}`} type="button" aria-pressed={stage === 'groups'} onClick={() => changeStage('groups')}>{t('groups')}</button>
        <button className={`btn sm${stage === 'playoffs' ? ' primary' : ''}`} type="button" aria-pressed={stage === 'playoffs'} onClick={() => changeStage('playoffs')}>{t('playoffs')}</button>
      </div>}
      <div className="op-scenario-toolbar">
        {stage === 'groups' && <label className="op-field"><span>{t(rangeMode ? 'groupTemplate' : 'group')}</span><select value={group} onChange={event => { setGroup(event.target.value); changeRound(1); }}>
          {groups.map(item => <option key={item.label} value={item.label}>{rangeMode ? t('groupTemplateOption', { count: n(item.seeds.length) })
            : t('groupOption', { group: item.label, count: n(item.seeds.length) })}</option>)}
        </select></label>}
        <label className="op-field"><span>{t(stage === 'groups' ? 'matchday' : 'round')}</span>
          <select value={stage === 'groups' ? day : round} onChange={event => changeRound(event.target.value)}>
            {stage === 'groups' ? groupDays.map(value => <option key={value} value={value}>{t('matchdayOption', { round: n(value) })}</option>)
              : knockoutRounds.map(value => <option key={value} value={value}>{eliminationLabel(scenario.bracket_size, value)}</option>)}
            {stage === 'playoffs' && hasThird && <option value={0}>{roundTitle({ name: 'third' })}</option>}
          </select>
        </label>
      </div>
      {stage === 'groups' && resting.length === 1 && visible.length > 0 && <p className="muted">{t('rest', { seed: n(resting[0]) })}</p>}
      {editable && visible.length > 1 && <div className="op-scenario-toolbar">
        <label className="op-field"><span>{t('fill')}</span><input type="datetime-local" value={fill}
          min={competitionDateInput(snapshot.start_at)} disabled={working} onInput={changeFill} onChange={changeFill} /></label>
        <button className="btn sm" type="button" disabled={!fill || working} onClick={() => setDraft(current => ({ ...current,
          ...Object.fromEntries(visible.map(fixture => [fixture.key, fill])),
        }))}>{t('fillAction')}</button>
      </div>}
      <div className="op-scenario-fixtures">
        {visible.map(fixture => {
          const changeTime = event => {
            const value = event.currentTarget.value;
            setDraft(current => ({ ...current, [fixture.key]: value }));
          };
          return <label className="op-field op-scenario-fixture" key={fixture.key}>
          <span>{fixture.is_third_place ? roundTitle({ name: 'third' }) : t('match', { position: n(fixture.position) })}
            {' · '}{translate('manager.tournamentLive.match.bestOf', { count: n(fixture.best_of) })}</span>
          <small>{fixture.seed_a && fixture.seed_b ? t('pair', { a: n(fixture.seed_a), b: n(fixture.seed_b) }) : t('pendingPair')}</small>
          <input type="datetime-local" value={draft[fixture.key] || ''} min={competitionDateInput(snapshot.start_at)}
            disabled={!editable || working} onInput={changeTime} onChange={changeTime} />
          </label>;
        })}
      </div>
      {editable && <div className="op-actions op-scenario-actions">
        {dirty && <button className="btn sm" type="button" disabled={working} onClick={() => { setDraft(original); setError(''); }}>{t('discard')}</button>}
        <button className="btn primary sm" type="button" disabled={!dirty || working} onClick={save}>{t('save')}</button>
      </div>}
    </>}
  </div>;
}
