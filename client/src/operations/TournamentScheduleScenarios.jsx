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

function errorText(cause) {
  if (typeof cause?.message === 'string' && cause.message.startsWith(prefix)) return translate(cause.message);
  if (cause?.status === 409) return t('error.conflict');
  return t('error.unavailable');
}

function eliminationLabel(size, round) {
  const remaining = size / 2 ** (round - 1);
  return roundTitle({ name: { 2: 'final', 4: 'semi', 8: 'quarter' }[remaining] || 'ofN', size: remaining });
}

export default function TournamentScheduleScenarios({ tournament, entrantCount, canWrite }) {
  const [opened, setOpened] = useState(false);
  return <details className="op-scenario" onToggle={event => { if (event.currentTarget.open) setOpened(true); }}>
    <summary><CalendarClock size={16} aria-hidden="true" />{t('title')}</summary>
    {opened && <ScenarioEditor key={tournament.id} tournament={tournament} entrantCount={entrantCount} canWrite={canWrite} />}
  </details>;
}

function ScenarioEditor({ tournament, entrantCount, canWrite }) {
  const [count, setCount] = useState(Math.max(2, Math.min(256, entrantCount || tournament.max_participants || 16)));
  const [snapshot, setSnapshot] = useState(null);
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
  const path = `/operations/tournaments/${encodeURIComponent(tournament.id)}/scenarios/${count}`;
  const editable = canWrite && !['cancelado','finalizado'].includes(tournament.status);

  useEffect(() => {
    const request = new AbortController();
    setError(''); setNotice(''); setFill(''); setWorking(true);
    api.get(path, { signal: request.signal }).then(value => {
      if (request.signal.aborted) return;
      setSnapshot(value);
      setDraft(localDates(value.dates));
      setGroup(value.scenario?.groups[0]?.label || 'A');
      setRound(1);
      if (value.scenario && !value.scenario.groups.length) setStage('playoffs');
      if (!value.scenario && value.available_counts.length) {
        setCount(value.available_counts.reduce((nearest, candidate) =>
          Math.abs(candidate - count) < Math.abs(nearest - count) ? candidate : nearest));
      }
    }).catch(cause => { if (!request.signal.aborted) setError(errorText(cause)); })
      .finally(() => { if (!request.signal.aborted) setWorking(false); });
    return () => request.abort();
  }, [path, count, reload]);

  const scenario = snapshot?.entrant_count === count ? snapshot.scenario : null;
  const original = snapshot?.entrant_count === count ? localDates(snapshot.dates) : {};
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
      setDraft(localDates(result.dates));
      setNotice(t('saved'));
    } catch (cause) {
      setError(cause?.status ? errorText(cause) : cause.message);
    } finally { setWorking(false); }
  }

  const changeStage = next => { setStage(next); setRound(1); setFill(''); };
  const changeRound = next => { setRound(Number(next)); setFill(''); };
  const selectCount = next => { setCount(Number(next)); setDraft({}); };
  const changeFill = event => setFill(event.currentTarget.value);
  return <div className="op-scenario-body" aria-busy={working}>
    <p className="muted">{t('help')}</p>
    {snapshot?.available_counts.length > 0 && <label className="op-field op-scenario-count"><span>{t('entrants')}</span>
      <select value={count} disabled={working || dirty} onChange={event => selectCount(event.target.value)}>
        {!snapshot.available_counts.includes(count) && <option value={count}>{n(count)}</option>}
        {snapshot.available_counts.map(value => <option key={value} value={value}>{snapshot.saved_counts.includes(value)
          ? t('savedCount', { count: n(value) }) : n(value)}</option>)}
      </select>
    </label>}
    {working && !scenario && <p role="status">{t('loading')}</p>}
    {!working && snapshot?.available_counts.length === 0 && <p className="muted">{t('noCounts')}</p>}
    {error && <p role="alert" className="op-error">{error}</p>}
    {notice && <p role="status" className="op-notice">{notice}</p>}
    {error && <button className="btn sm" type="button" disabled={working} onClick={() => setReload(value => value + 1)}>{t('reload')}</button>}
    {scenario && <>
      <div className="op-scenario-meta">
        {groups.length > 0 && <span>{t('groupSizes', { sizes: new Intl.ListFormat(getIntlLocale()).format([...new Set(groups.map(item => item.seeds.length))].sort().map(size => n(size))) })}</span>}
        <span>{t('bracketSize', { size: n(scenario.bracket_size) })}</span>
        <span>{t('dated', { done: n(filled), total: n(scenario.fixtures.length) })}</span>
      </div>
      {groups.length > 0 && <div className="op-actions" aria-label={t('stage')}>
        <button className={`btn sm${stage === 'groups' ? ' primary' : ''}`} type="button" aria-pressed={stage === 'groups'} onClick={() => changeStage('groups')}>{t('groups')}</button>
        <button className={`btn sm${stage === 'playoffs' ? ' primary' : ''}`} type="button" aria-pressed={stage === 'playoffs'} onClick={() => changeStage('playoffs')}>{t('playoffs')}</button>
      </div>}
      <div className="op-scenario-toolbar">
        {stage === 'groups' && <label className="op-field"><span>{t('group')}</span><select value={group} onChange={event => { setGroup(event.target.value); changeRound(1); }}>
          {groups.map(item => <option key={item.label} value={item.label}>{t('groupOption', { group: item.label, count: n(item.seeds.length) })}</option>)}
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
