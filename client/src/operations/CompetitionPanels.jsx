import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, CalendarDays, Info, Network, RefreshCw, Settings2, Users } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { getIntlLocale, translate } from '../i18n/runtime.js';
import { Badge, DataTable, Empty, Field, FormDialog } from './ui.jsx';
import { DecisionPanel } from './DecisionPanel.jsx';
import { competitionErrorMessage, effectiveTournamentSeedMode, shouldLeaveDeletedTournament } from './competitionForm.js';
import { competitionDateTime } from './competitionTime.js';
import { tournamentState } from './tournamentState.js';
import TournamentForm from './TournamentForm.jsx';
import TournamentFormatPreview from './TournamentFormatPreview.jsx';
import TournamentScheduleScenarios from './TournamentScheduleScenarios.jsx';
import TournamentRegistrations from './TournamentRegistrations.jsx';
import { TournamentLivePanel } from './TournamentLiveDialog.jsx';
import './competition.css';

const t = (key, values) => translate(`manager.tournament.${key}`, values);
const statusLabel = status => translate(`manager.tournamentLive.status.values.${status}`);
const states = ['borrador', 'inscripcion_abierta', 'en_curso', 'finalizado', 'cancelado'];
const tabs = [['bracket', Network], ['teams', Users], ['settings', Settings2]];
const quickActions = ['tournament.update', 'tournament.generate', 'tournament.publish'];
const actions = {
  'tournament.status': 'status',
  'tournament.notify': 'notify',
  'tournament.unpublish': 'unpublish',
  'tournament.points': 'points',
  'tournament.delete': 'delete',
};
const isPending = command => !['acknowledged', 'cancelled'].includes(command.status);
const officialState = (tournament, now = Date.now()) => {
  const { key } = tournamentState(tournament, now);
  if (key === 'en_curso' && now < Date.parse(tournament.start_at)) return t('state.published');
  return ['hidden', 'open', 'published'].includes(key) ? t(`state.${key}`) : states.includes(key) ? statusLabel(key) : '—';
};

export function CompetitionPanel({ data, reload, can, me }) {
  const { toast } = useApp();
  const manage = Boolean(me?.is_admin || can?.('operaciones'));
  const liveControl = Boolean(me?.is_admin || can?.('arbitraje'));
  const [params, setParams] = useSearchParams();
  const target = params.get('tournament');
  const tab = tabs.some(([key]) => key === params.get('tab')) ? params.get('tab') : 'bracket';
  const [read, setRead] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [filter, setFilter] = useState({ query: '', status: '' });
  const [cursor, setCursor] = useState(null);
  const [pages, setPages] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [now, setNow] = useState(Date.now);
  const requestId = useRef(0);
  const configured = data.connection?.configured;
  const supports = type => data.connection?.supported_actions?.includes(type);
  const search = new URLSearchParams({
    resource: target ? 'tournament' : 'tournaments',
    ...(target ? { target_id: target } : { ...filter, ...(cursor ? { cursor } : {}), limit: '40' }),
  }).toString();
  const result = read?.search === search ? read.value : null;

  const load = useCallback(async () => {
    if (!configured) return;
    const request = ++requestId.current;
    setBusy(true);
    setError('');
    try {
      const next = await api.get(`/operations/competition?${search}`);
      if (request === requestId.current) setRead({ search, value: next });
    } catch (cause) {
      if (request === requestId.current) {
        setError(t('loadError'));
        if ([401, 403].includes(cause.status)) setRead(null);
      }
    } finally {
      if (request === requestId.current) setBusy(false);
    }
  }, [configured, search]);
  useEffect(() => {
    void load();
    return () => { ++requestId.current; };
  }, [load]);

  const tournament = result?.tournament;
  useEffect(() => setNow(Date.now()), [target]);
  useEffect(() => {
    if (!tournament) return;
    const boundaries = [tournament.registration_close_at, tournament.groups_published_at, tournament.bracket_published_at, tournament.start_at];
    const next = Math.min(...boundaries.map(Date.parse).filter(time => time > now));
    if (!Number.isFinite(next)) return;
    const delay = Math.max(0, Math.min(next - Date.now(), 86_400_000));
    const timer = setTimeout(() => setNow(Date.now()), delay + 20);
    return () => clearTimeout(timer);
  }, [tournament, now]);
  const matches = result?.matches ?? [];
  const participants = result?.participants ?? [];
  const pendingTournament = (data.commands || []).filter(command =>
    command.resource_type === 'tournament' && command.resource_id === tournament?.id && isPending(command));
  const structureLocked = Boolean(tournament && (
    !['borrador', 'inscripcion_abierta'].includes(tournament.status) ||
    tournament.groups_published_at || tournament.bracket_published_at || matches.length
  ));
  const blocked = type => busy || !supports(type) || pendingTournament.length > 0;
  const switchTab = key => setParams(previous => {
    const next = new URLSearchParams(previous);
    if (key === 'bracket') next.delete('tab');
    else next.set('tab', key);
    return next;
  });
  const showList = () => {
    setParams({});
    setCursor(null);
    setPages([]);
  };
  const changed = async () => {
    await load();
    setRefreshKey(value => value + 1);
  };
  const afterDecision = async (command, action) => {
    if (shouldLeaveDeletedTournament(command, action, target)) {
      showList();
      return;
    }
    await changed();
  };
  const applyNow = type => me?.is_admin && data.connection?.write_enabled && quickActions.includes(type);
  const prepare = async (type, row, payload) => {
    let command;
    try {
      ({ command } = await api.post('/operations/competition/commands', {
        type, target_id: row?.id, expected_version: row?.manager_version ?? 0, payload,
      }));
    } catch {
      throw new Error(t('prepareError'));
    }
    if (applyNow(type)) {
      try {
        await api.post(`/operations/integration/commands/${encodeURIComponent(command.id)}/send`, {});
        toast(t('saved'));
      } catch (cause) {
        // The queued command retains its idempotency key and can be retried in Decisions.
        toast(competitionErrorMessage(cause.message, t('pendingSend')), 'error');
      }
      await Promise.all([reload(), changed()]);
    } else {
      toast(t('proposalReady'));
      await reload();
    }
  };
  const refresh = () => void changed();
  const number = value => value == null ? '—' : new Intl.NumberFormat(getIntlLocale()).format(value);

  return <>
    <div className="op-section-title">
      <div>{target && <button type="button" className="op-text-button op-competition-back" onClick={showList}><ArrowLeft size={15} /> {t('back')}</button>}
        <h2>{tournament?.name || t('title')}</h2>
      </div>
      <div className="op-actions">
        <button type="button" className="btn" disabled={busy || !configured} onClick={refresh}><RefreshCw size={15} /> {t('refresh')}</button>
        {!target && manage && <button type="button" className="btn primary" disabled={blocked('tournament.create') || !result?.games?.length} onClick={() => setDialog({ type: 'tournament.create' })}>{t('create')}</button>}
      </div>
    </div>
    {!configured ? <Empty title={t('connectionPending')}>{t('connectionHelp')}</Empty> : <>
      {error && <p className="op-error" role="alert">{result ? t('stale') : error}</p>}
      {busy && !result && <p role="status">{t('loading')}</p>}
      {!target && <>
        <form className="op-filters" onSubmit={event => {
          event.preventDefault();
          setCursor(null);
          setPages([]);
          setFilter({ query, status });
        }}>
          <input aria-label={t('searchTournament')} placeholder={t('searchPlaceholder')} value={query} maxLength={120} onChange={event => setQuery(event.target.value)} />
          <select aria-label={t('state.label')} value={status} onChange={event => setStatus(event.target.value)}>
            <option value="">{t('state.all')}</option>
            {states.map(value => <option key={value} value={value}>{value === 'inscripcion_abierta' ? t('state.listed') : statusLabel(value)}</option>)}
          </select>
          <button className="btn" disabled={busy}>{t('search')}</button>
        </form>
        {result && <>
          <DataTable rows={result.items || []} empty={t('noTournaments')} emptyDetail="" regionLabel={t('title')} columns={[
            { key: 'name', title: t('name'), render: row => <Link className="op-text-button" to={`?tournament=${encodeURIComponent(row.id)}`}>{row.name}</Link> },
            { key: 'status', title: t('state.label'), render: row => <Badge value={row.status}>{officialState(row)}</Badge> },
            { key: 'start_at', title: t('start'), render: row => competitionDateTime(row.start_at) },
            { key: 'participants', title: t('slots'), render: row => `${number(row.participant_count ?? row.participants_count)} / ${number(row.max_participants)}` },
          ]} />
          {(pages.length > 0 || result.next_cursor) && <div className="op-actions">
            <button type="button" className="btn" disabled={busy || !pages.length} onClick={() => { setCursor(pages.at(-1)); setPages(value => value.slice(0, -1)); }}>{t('previous')}</button>
            <span>{t('page', { number: number(pages.length + 1) })}</span>
            <button type="button" className="btn" disabled={busy || !result.next_cursor} onClick={() => { setPages(value => [...value, cursor]); setCursor(result.next_cursor); }}>{t('next')}</button>
          </div>}
        </>}
        {(data.commands || []).some(command => command.resource_type === 'tournament' && isPending(command)) &&
          <DecisionPanel data={data} resourceType="tournament" reload={reload} onChanged={afterDecision} />}
      </>}
      {tournament && <>
        <div className="op-competition-facts">
          <Badge value={tournament.status}>{officialState(tournament, now)}</Badge>
          <span title={t('madrid')}><CalendarDays size={15} aria-hidden="true" />{t('closesOn', { date: competitionDateTime(tournament.registration_close_at) })}</span>
          <span title={t('madrid')}>{t('revealsOn', { date: competitionDateTime(tournament.groups_published_at || tournament.bracket_published_at || tournament.draw_visible_at || tournament.start_at) })}</span>
          <span title={t('madrid')}>{t('startsOn', { date: competitionDateTime(tournament.start_at) })}</span>
        </div>
        <nav className="op-dossier-nav" aria-label={t('navigation')}>
          {tabs.map(([key, Icon]) => <button key={key} type="button" className={tab === key ? 'is-active' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => switchTab(key)}>
            <Icon size={17} aria-hidden="true" />{t(`tabs.${key}`)}{key === 'teams' && <span>{number(participants.length)}</span>}
          </button>)}
        </nav>
        {pendingTournament.length > 0 && <DecisionPanel data={{ ...data, commands: pendingTournament }} resourceType="tournament" resourceId={tournament.id} reload={reload} onChanged={afterDecision} />}
        {tab === 'bracket' && <section className="op-card op-competition-draw">
          <DrawActions tournament={tournament} now={now} matches={matches} preview={result.format_preview} manage={manage} blocked={blocked} onAction={setDialog} />
          <TournamentFormatPreview preview={result.format_preview} grouped={tournament.has_group_stage} />
          {manage && <TournamentScheduleScenarios key={tournament.id} tournament={tournament} entrantCount={participants.length}
            canWrite={Boolean(me?.is_admin && data.connection?.write_enabled)} />}
          <TournamentLivePanel key={tournament.id} tournament={tournament} fallbackMatches={matches} fallbackGroupOrder={result.group_order} refreshKey={refreshKey}
            canEdit={liveControl} canWrite={Boolean(data.connection?.write_enabled)} onChanged={load} onParticipants={() => switchTab('teams')} />
        </section>}
        {tab === 'teams' && <TournamentRegistrations key={tournament.id} tournament={tournament} participants={participants} eligibleTeams={result.eligible_teams} liveControl={liveControl} canWrite={Boolean(data.connection?.write_enabled)} onChanged={load} />}
        {tab === 'settings' && <section className="op-card">
          <div className="op-section-title"><h3>{t('tabs.settings')}</h3>
            {manage && <button className="btn primary" type="button" disabled={blocked('tournament.update')} onClick={() => setDialog({ type: 'tournament.update', row: tournament })}><Settings2 size={16} />{t('edit')}</button>}
          </div>
          <dl className="op-settings">
            <div><dt>{t('game')}</dt><dd>{result.games?.find(game => game.id === tournament.game_id)?.name || '—'}{tournament.game_mode && ` · ${tournament.game_mode}`}</dd></div>
            <div><dt>{t('format')}</dt><dd>{t(tournament.has_group_stage ? 'formatGroups' : 'phase.direct')}</dd></div>
            <div><dt>{t('seed')}</dt><dd>{effectiveTournamentSeedMode(tournament) === 'random' ? t('seedRandom') : tournament.seeding_season ?? tournament.season
              ? t('seedPointsSeason', { number: number(tournament.seeding_season ?? tournament.season) }) : t('seedPoints')}</dd></div>
            <div><dt>{t('slots')}</dt><dd>{t('range', { min: number(tournament.min_participants), max: number(tournament.max_participants) })}</dd></div>
            <div><dt>{t('rosterSize')}</dt><dd>{t('range', { min: number(tournament.roster_min), max: number(tournament.roster_max) })}</dd></div>
          </dl>
          {tournament.description && <p>{tournament.description}</p>}
          {tournament.rules && <details><summary>{t('rules')}</summary><p className="op-competition-rules">{tournament.rules}</p></details>}
          {me?.is_admin && <div className="op-actions"><Link className="btn" to="/publicacion">{t('webPublication')} <ArrowUpRight size={15} /></Link></div>}
          {manage && <details className="op-details">
            <summary>{t('moreActions')}</summary>
            <div className="op-actions">{Object.entries(actions).filter(([type]) =>
              (type !== 'tournament.unpublish' || tournament.groups_published_at || tournament.bracket_published_at)).map(([type, key]) =>
              <button key={type} type="button" className="btn" disabled={blocked(type)} onClick={() => setDialog({ type, row: tournament })}>{t(`action.${key}`)}</button>
            )}</div>
          </details>}
          <Link className="op-text-button" to={`/operaciones/decisiones?${new URLSearchParams({ resource_type: 'tournament', resource_id: tournament.id, include_closed: '1' })}`}>{t('history')} <ArrowUpRight size={14} /></Link>
        </section>}
        {tab !== 'settings' && ['registration', 'fixture'].map(kind => (kind === 'registration' ? participants : matches)
          .filter(row => (data.commands || []).some(command => command.resource_type === kind && command.resource_id === row.id && isPending(command)))
          .map(row => <DecisionPanel key={row.id} data={data} resourceType={kind} resourceId={row.id} reload={reload} onChanged={load} />))}
      </>}
    </>}
    {dialog && (['tournament.create', 'tournament.update'].includes(dialog.type)
      ? <TournamentForm type={dialog.type} row={dialog.row} locked={structureLocked} games={result?.games || []} clubs={data.clubs || []} onClose={() => setDialog(null)} prepare={prepare} applyNow={applyNow(dialog.type)} />
      : <TournamentActionDialog action={dialog} onClose={() => setDialog(null)} prepare={prepare} applyNow={applyNow(dialog.type)} />)}
  </>;
}

function DrawActions({ tournament, now, matches, preview, manage, blocked, onAction }) {
  const hasGroups = matches.some(match => match.phase === 'grupos');
  const hasBracket = matches.some(match => match.phase === 'eliminacion');
  const groupsFinished = hasGroups && matches.filter(match => match.phase === 'grupos')
    .every(match => match.result_status === 'confirmed');
  const phase = tournament.has_group_stage
    ? (!tournament.groups_published_at || !groupsFinished ? 'groups' : 'playoffs')
    : 'direct';
  const hasFixtures = phase === 'groups' ? hasGroups : hasBracket;
  const published = phase === 'groups' ? tournament.groups_published_at : tournament.bracket_published_at;
  const label = t(`phase.${phase}`);
  const releaseScheduled = Date.parse(published) > now;
  const signupClosed = Date.parse(tournament.registration_close_at) <= now;
  const closed = ['finalizado', 'cancelado'].includes(tournament.status);
  const drawType = 'tournament.generate';
  const publishType = 'tournament.publish';
  return <div className="op-section-title">
    <div className="op-competition-draw-title"><h3>{t('tabs.bracket')}</h3>
      <span className="op-competition-info" tabIndex={0} aria-label={t('drawHelp')}><Info size={17} aria-hidden="true" /><span className="op-competition-tip" aria-hidden="true">{t('drawHelp')}</span></span>
    </div>
    <div className="op-actions">
      {published && <Badge value={releaseScheduled ? 'scheduled' : 'active'}>{releaseScheduled
        ? t('drawScheduled', { phase: label, date: competitionDateTime(published) })
        : t('drawPublished', { phase: label })}</Badge>}
      {!published && manage && !closed && <>
        <button type="button" className={hasFixtures ? 'btn' : 'btn primary'} disabled={blocked(drawType) || preview?.kind === 'unavailable'} onClick={() => onAction({ type: drawType, row: tournament, phase, redraw: hasFixtures })}>
          {t(hasFixtures ? 'redraw' : 'draw', { phase: label })}
        </button>
        {hasFixtures && <button type="button" className="btn primary" disabled={blocked(publishType) || !signupClosed}
          onClick={() => onAction({ type: publishType, row: tournament, phase: phase === 'groups' ? 'groups' : 'playoffs' })}>
          {t(signupClosed ? 'publishDraw' : 'publishAfterClose')}
        </button>}
      </>}
    </div>
  </div>;
}

function TournamentActionDialog({ action, onClose, prepare, applyNow }) {
  const { type, row, phase, redraw } = action;
  const key = actions[type];
  const generate = type === 'tournament.generate';
  const publish = type === 'tournament.publish';
  const revealAt = row?.draw_visible_at || row?.start_at;
  return <FormDialog title={generate ? t(redraw ? 'redraw' : 'draw', { phase: t(`phase.${phase}`) }) : publish ? t('publishDraw') : t(`action.${key}`)}
    onClose={onClose} submitLabel={applyNow ? t('apply') : t('prepare')}
    cancelLabel={translate('manager.tournamentLive.confirm.cancel')} closeLabel={translate('manager.tournamentLive.close')}
    help={!applyNow ? t('proposalHelp') : undefined}
    danger={type === 'tournament.delete'}
    submit={body => prepare(type, row, phase ? { phase } : body)}>
    {type === 'tournament.status' && <Field label={t('state.label')}><select name="status" defaultValue={row.status}>{states.map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></Field>}
    {type === 'tournament.notify' && <Field label={t('message')}><textarea name="text" rows={4} maxLength={2000} required /></Field>}
    {type === 'tournament.unpublish' && <Field label={t('phase.label')}><select name="phase">
      {row.groups_published_at && <option value="groups">{t('phase.groups')}</option>}
      {row.bracket_published_at && <option value="playoffs">{t('phase.playoffs')}</option>}
    </select></Field>}
    {type === 'tournament.delete' && <>
      <p className="op-error">{t('deleteHelp')}</p>
      <Field label={t('confirmName', { name: row.name })}><input name="confirm_name" required maxLength={120} autoComplete="off" /></Field>
    </>}
    {type === 'tournament.points' && <p>{t('pointsHelp')}</p>}
    {generate && <p>{t(redraw ? 'redrawHelp' : 'generateHelp')}</p>}
    {publish && <p>{Date.parse(revealAt) > Date.now()
      ? t('publishHelpScheduled', { date: competitionDateTime(revealAt) }) : t('publishHelpNow')}</p>}
    {key && <Field label={translate('manager.tournamentLive.reason.label')}><textarea name="reason" minLength={12} maxLength={500} rows={3} required /></Field>}
  </FormDialog>;
}
