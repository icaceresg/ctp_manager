import { useState } from 'react';
import { Info } from 'lucide-react';
import { getIntlLocale, translate } from '../i18n/runtime.js';
import { competitionDateInput, competitionDateToIso } from './competitionTime.js';
import { effectiveTournamentSeedMode, tournamentPresentationPayload } from './competitionForm.js';
import { roundTitle } from './tournamentLiveUi.jsx';
import TournamentFinishPoints, { finishPointsPayload } from './TournamentFinishPoints.jsx';
import { Field, FormDialog } from './ui.jsx';
import './tournamentSettings.css';

const t = (key, values) => translate(`manager.tournamentSettings.${key}`, values);
const PLATFORMS = ['PC','PlayStation','Xbox','Switch','Movil','Otra'];
const LANGUAGES = ['es','en','it','fr','pt','de'];
const BEST_OF = [1,3,5,7,9];
const PLAYOFF_ROUNDS = [256,128,64,32,16,8,4,2];

function formatRound(round) {
  if (round === 'groups') return translate('manager.tournamentLive.bracket.stages.groups');
  if (round === 'third') return roundTitle({ name: 'third' });
  const name = { 2: 'final', 4: 'semi', 8: 'quarter' }[round] || 'ofN';
  return roundTitle({ name, size: round });
}

function roundFallback(tournament, round) {
  if (round === 'groups') return tournament.best_of_groups ?? 3;
  if (Number(round) === 2) return tournament.best_of_final ?? 7;
  return tournament.best_of_playoffs ?? 5;
}

function InfoLabel({ label, help }) {
  return <span className="op-tournament-info-label">{label}
    <span className="op-tournament-info" tabIndex={0} aria-label={help}>
      <Info size={15} aria-hidden="true" />
      <span aria-hidden="true" className="op-tournament-tooltip">{help}</span>
    </span>
  </span>;
}

function DateField({ field, tournament, required = false, help }) {
  return <Field label={help ? <InfoLabel label={t(field)} help={help} /> : t(field)}>
    <input name={field} type="datetime-local" defaultValue={competitionDateInput(tournament[field])} required={required} />
  </Field>;
}

function TournamentSeries({ tournament, groups, thirdPlace, disabled }) {
  const rounds = [...(groups ? ['groups'] : []), ...PLAYOFF_ROUNDS, ...(thirdPlace ? ['third'] : [])];
  const numbers = new Intl.NumberFormat(getIntlLocale());
  return <fieldset className="op-tournament-fieldset" disabled={disabled}>
    <legend><InfoLabel label={t('series')} help={t('seriesHelp')} /></legend>
    <div className="op-tournament-series">
      {rounds.map(round => <Field key={round} label={formatRound(round)}>
        <select name={`series_${round}`} defaultValue={tournament.best_of_by_round?.[round] ?? roundFallback(tournament, round)}>
          {BEST_OF.map(count => <option key={count} value={count}>
            {translate('manager.tournamentLive.match.bestOf', { count: numbers.format(count) })}
          </option>)}
        </select>
      </Field>)}
    </div>
  </fieldset>;
}

function settingsPayload(body, defaults, groups, thirdPlace, points, locked) {
  const payload = { ...tournamentPresentationPayload(body, defaults.description_i18n), ...finishPointsPayload(body, defaults) };
  const current = defaults.best_of_by_round ?? {};
  const bestOfByRound = { ...current };
  for (const round of ['groups', ...PLAYOFF_ROUNDS, 'third']) {
    if (body[`series_${round}`] === undefined) continue;
    const bestOf = Number(body[`series_${round}`]);
    if (bestOf === (current[round] ?? roundFallback(defaults, round))) continue;
    if (bestOf === roundFallback(defaults, round)) delete bestOfByRound[round];
    else bestOfByRound[round] = bestOf;
  }
  if (!defaults.id || JSON.stringify(current) !== JSON.stringify(bestOfByRound)) payload.best_of_by_round = bestOfByRound;
  if (body.seeding_mode && body.seeding_mode !== defaults.seeding_mode) payload.seeding_mode = body.seeding_mode;
  if (body.seeding_season !== undefined) {
    const season = body.seeding_season === '' ? null : Number(body.seeding_season);
    if (season !== (defaults.seeding_season ?? null)) payload.seeding_season = season;
  }
  if (body.start_at) {
    for (const key of ['start_at','registration_close_at','registration_open_at']) {
      payload[key] = body[key] ? competitionDateToIso(body[key], defaults[key]) : null;
    }
    if (Date.parse(payload.registration_close_at) >= Date.parse(payload.start_at)
      || Date.parse(payload.registration_open_at) >= Date.parse(payload.registration_close_at)) throw new Error(t('error.dateOrder'));
  }
  if (body.draw_visible_at !== undefined) {
    const visibleAt = body.draw_visible_at ? competitionDateToIso(body.draw_visible_at, defaults.draw_visible_at) : null;
    if (visibleAt && (Date.parse(visibleAt) < Date.parse(payload.registration_close_at ?? defaults.registration_close_at)
      || Date.parse(visibleAt) > Date.parse(payload.start_at ?? defaults.start_at))) {
      throw new Error(translate('tournaments.staff.drawVisibilityWindow'));
    }
    if (visibleAt !== (defaults.draw_visible_at ?? null)) payload.draw_visible_at = visibleAt;
  }
  if (locked) return payload;

  for (const key of ['game_id','game_mode','participant_type','kind','region']) payload[key] = body[key];
  for (const key of ['max_participants','min_participants','roster_min','roster_max','pick_ban_turn_seconds']) payload[key] = Number(body[key]);
  payload.season = body.season ? Number(body.season) : null;
  payload.has_group_stage = groups;
  payload.has_third_place_match = thirdPlace;
  if (!defaults.id) {
    payload.best_of_groups = defaults.best_of_groups;
    payload.best_of_playoffs = defaults.best_of_playoffs;
    payload.best_of_final = defaults.best_of_final;
  }
  payload.format = 'eliminacion_simple';
  payload.platforms = PLATFORMS.filter(platform => body[`platform_${platform}`] === 'on');
  if (!payload.platforms.length) throw new Error(t('error.platforms'));
  if (payload.min_participants > payload.max_participants) throw new Error(t('error.participantRange'));
  if (payload.roster_min > payload.roster_max) throw new Error(t('error.rosterRange'));
  if (['cup','major'].includes(payload.kind) && payload.season === null) throw new Error(t('error.season'));
  payload.pick_ban_mode_rotation = body.pick_ban_mode_rotation.split(',').map(value => value.trim()).filter(Boolean);
  if (payload.pick_ban_mode_rotation.length > 9 || payload.pick_ban_mode_rotation.some(mode => mode.length > 60)) throw new Error(t('error.vetoModes'));
  payload.points_per_position = points.map(point => ({ position: point.position, label: point.label.trim(), points: Number(point.points) }));
  if (payload.points_per_position.some(point => !point.label)) throw new Error(t('error.pointLabel'));
  return payload;
}

export default function TournamentForm({ type, row, games = [], clubs = [], locked, applyNow, onClose, prepare }) {
  const isNew = type === 'tournament.create';
  const defaults = {
    name: '', game_id: games[0]?.id ?? '', game_mode: '', participant_type: 'equipo', kind: 'personalizado',
    season: 1, max_participants: 16, min_participants: 2, roster_min: 4, roster_max: 6,
    ...(isNew && { best_of_groups: 3, best_of_playoffs: 3, best_of_final: 5, best_of_by_round: { 4: 5 } }),
    ...row,
    seeding_mode: effectiveTournamentSeedMode(row),
  };
  const [groups, setGroups] = useState(Boolean(defaults.has_group_stage));
  const [seedMode, setSeedMode] = useState(defaults.seeding_mode);
  const numbers = new Intl.NumberFormat(getIntlLocale());
  const [thirdPlace, setThirdPlace] = useState(Boolean(defaults.has_third_place_match));
  const [points, setPoints] = useState(defaults.points_per_position ?? []);
  const [kind, setKind] = useState(defaults.kind);
  const circuitPoints = kind === 'cup' || kind === 'major';
  const closed = ['finalizado', 'cancelado'].includes(defaults.status);
  const seedingLocked = closed || defaults.status === 'en_curso' || defaults.groups_published_at || defaults.bracket_published_at;
  const revealLocked = closed || [defaults.groups_published_at, defaults.bracket_published_at]
    .some(value => value && Date.parse(value) <= Date.now());
  const localNames = new Intl.DisplayNames(getIntlLocale(), { type: 'language' });
  const platforms = defaults.platforms?.length ? defaults.platforms : ['PC','PlayStation','Xbox'];
  const availablePosition = Array.from({ length: 64 }, (_, index) => index + 1).find(position => !points.some(point => point.position === position));
  const setPoint = (position, values) => setPoints(current => current.map(point => point.position === position ? { ...point, ...values } : point));

  return <FormDialog title={t(isNew ? 'create' : 'title')} onClose={onClose} submitLabel={t(applyNow ? 'save' : 'prepare')}
    cancelLabel={translate('manager.tournamentLive.confirm.cancel')} closeLabel={translate('manager.tournamentLive.close')}
    submit={async body => {
      try { await prepare(type, row, settingsPayload(body, defaults, groups, thirdPlace, points, locked)); }
      catch (error) {
        if (error.message === 'manager.tournamentSettings.error.invalidFormat') throw new Error(t('error.invalidFormat'));
        throw error;
      }
    }}>
    <Field label={t('name')}><input name="name" defaultValue={defaults.name} required minLength={3} maxLength={120} /></Field>

    {!locked && <fieldset className="op-tournament-fieldset">
      <legend>{t('general')}</legend>
      <div className="op-form-grid">
        <Field label={t('game')}><select name="game_id" defaultValue={defaults.game_id} required>
          {games.map(game => <option key={game.id} value={game.id}>{game.name}</option>)}
        </select></Field>
        <Field label={t('game_mode')}><input name="game_mode" defaultValue={defaults.game_mode} required maxLength={60} /></Field>
        <Field label={t('kind')}><select name="kind" value={kind} onChange={event => setKind(event.target.value)}>
          {['cup','major','personalizado','fuera_de_circuito','champ','champs'].map(kind => <option key={kind} value={kind}>{t(`kinds.${kind}`)}</option>)}
        </select></Field>
        <Field label={t('season')}><input name="season" type="number" min="1" max="4" defaultValue={defaults.season ?? ''} /></Field>
      </div>
    </fieldset>}

    {(!seedingLocked || !revealLocked) && <fieldset className="op-tournament-fieldset">
      <legend>{t('dates')}</legend>
      <div className="op-form-grid">
        {!seedingLocked && <>
          <DateField field="registration_open_at" tournament={defaults} />
          <DateField field="registration_close_at" tournament={defaults} required />
          <DateField field="start_at" tournament={defaults} required />
        </>}
        {!revealLocked && <DateField field="draw_visible_at" tournament={defaults} help={t('drawVisibilityHelp')} />}
      </div>
    </fieldset>}

    <fieldset className="op-tournament-fieldset">
      <legend>{t('format')}</legend>
      {locked && <small className="muted">{t('shapeLocked')}</small>}
      <div className="op-form-grid">
        <Field label={<InfoLabel label={t('seeding')} help={t(seedingLocked ? 'seedingLocked' : 'seedingHelp')} />}>
          <select name="seeding_mode" value={seedMode} onChange={event => setSeedMode(event.target.value)} disabled={Boolean(seedingLocked)}>
            <option value="random">{t('seedingRandom')}</option>
            <option value="season_points">{t('seedingPoints')}</option>
          </select>
        </Field>
        {seedMode === 'season_points' && <Field label={<InfoLabel label={t('seedingSeason')} help={t('seedingSeasonHelp')} />}>
          <select name="seeding_season" defaultValue={defaults.seeding_season ?? ''} disabled={Boolean(seedingLocked)}>
            <option value="">{t('eventSeason')}</option>
            {[1, 2, 3, 4].map(season => <option key={season} value={season}>{t('seasonNumber', { number: numbers.format(season) })}</option>)}
          </select>
        </Field>}
        {!locked && <>
          <label className="op-check"><input type="checkbox" checked={groups} onChange={e => setGroups(e.target.checked)} />{t('groupsEnabled')}</label>
          <label className="op-check"><input type="checkbox" checked={thirdPlace} onChange={e => setThirdPlace(e.target.checked)} />{t('thirdEnabled')}</label>
        </>}
      </div>
    </fieldset>
    <TournamentSeries tournament={defaults} groups={groups} thirdPlace={thirdPlace} disabled={closed} />
    {circuitPoints && <TournamentFinishPoints tournament={defaults} groups={groups} thirdPlace={thirdPlace} />}

    {!locked && <details className="op-details"><summary>{t('registration')}</summary>
      <div className="op-form-grid">
        <Field label={t('participant_type')}><select name="participant_type" defaultValue={defaults.participant_type}>
          {['equipo','individual','ambos'].map(kind => <option key={kind} value={kind}>{t(`participants.${kind}`)}</option>)}
        </select></Field>
        {[
          ['min_participants',2,256], ['max_participants',2,256], ['roster_min',1,12], ['roster_max',1,12],
        ].map(([key,min,max]) => <Field key={key} label={t(key)}><input name={key} type="number" min={min} max={max} defaultValue={defaults[key]} required /></Field>)}
        <Field label={t('region')}><input name="region" defaultValue={defaults.region ?? ''} maxLength={80} /></Field>
      </div>
      <fieldset className="op-tournament-fieldset"><legend>{t('platforms')}</legend><div className="op-actions">
        {PLATFORMS.map(platform => <label key={platform} className="op-check">
          <input type="checkbox" name={`platform_${platform}`} defaultChecked={platforms.includes(platform)} />
          {['Movil','Otra'].includes(platform) ? t(`platform.${platform}`) : platform}
        </label>)}
      </div></fieldset>
    </details>}

    <details className="op-details"><summary>{t('publication')}</summary>
      <div className="op-tournament-fields">
        <Field label={t('description')}><textarea name="description" defaultValue={defaults.description ?? ''} maxLength={5000} rows={3} /></Field>
        <Field label={t('rules')}><textarea name="rules" defaultValue={defaults.rules ?? ''} maxLength={10000} rows={4} /></Field>
        <div className="op-form-grid">
          <Field label={t('host_club_id')}><select name="host_club_id" defaultValue={defaults.host_club_id ?? ''}>
            <option value="">{t('ctpBrand')}</option>
            {clubs.filter(club => club.verified || club.id === defaults.host_club_id).map(club => <option key={club.id} value={club.id}>{club.name}</option>)}
          </select></Field>
          <Field label={t('banner')}><input name="banner" defaultValue={defaults.banner ?? 'CTP'} maxLength={64} /></Field>
          {[['image_url',defaults.image_url], ['rules_pdf_url',defaults.rules_pdf_url], ['stream_url',defaults.stream_url]].map(([key,value]) => <Field key={key} label={t(key)}>
            <input name={key} defaultValue={value ?? ''} maxLength={2000} />
          </Field>)}
        </div>
        <Field label={t('contact_info')}><textarea name="contact_info" defaultValue={defaults.contact_info ?? ''} rows={2} maxLength={2000} /></Field>
        <details className="op-details"><summary>{t('translations')}</summary><div className="op-form-grid">
          {LANGUAGES.map(locale => <Field key={locale} label={localNames.of(locale)}>
            <textarea name={`description_${locale}`} defaultValue={defaults.description_i18n?.[locale] ?? ''} rows={3} maxLength={5000} />
          </Field>)}
        </div></details>
      </div>
    </details>

    {!locked && <details className="op-details"><summary>{t('vetoAndPoints')}</summary>
      <div className="op-tournament-fields">
        <div className="op-form-grid">
          <Field label={t('pick_ban_mode_rotation')}><input name="pick_ban_mode_rotation" defaultValue={(defaults.pick_ban_mode_rotation ?? []).join(', ')} maxLength={550} /></Field>
          <Field label={t('pick_ban_turn_seconds')}><input name="pick_ban_turn_seconds" type="number" min="5" max="300" defaultValue={defaults.pick_ban_turn_seconds ?? 20} required /></Field>
        </div>
        {!circuitPoints && <><p className="muted">{t('pointsHelp')}</p>
        {points.map(point => <div className="op-form-grid" key={point.position}>
          <Field label={t('pointsPosition', { position: new Intl.NumberFormat(getIntlLocale()).format(point.position) })}>
            <input value={point.label} maxLength={120} required onChange={e => setPoint(point.position, { label: e.target.value })} />
          </Field>
          <Field label={t('points')}><input type="number" value={point.points} min="0" max="1000000" required onChange={e => setPoint(point.position, { points: e.target.value })} /></Field>
          <button type="button" className="btn" onClick={() => setPoints(current => current.filter(item => item.position !== point.position))}>{t('removePosition')}</button>
        </div>)}
        <button type="button" className="btn" disabled={points.length >= 32 || !availablePosition}
          onClick={() => setPoints(current => [...current, { position: availablePosition, label: '', points: 0 }].sort((a,b) => a.position - b.position))}>{t('addPosition')}</button>
        </>}
      </div>
    </details>}
  </FormDialog>;
}
