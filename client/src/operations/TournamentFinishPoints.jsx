import { getIntlLocale, translate } from '../i18n/runtime.js';
import { Field } from './ui.jsx';

const FINISH_STAGES = ['champion', 'runnerUp', 'semifinals', 'third', 'fourth', 'quarterfinals', 'round16', 'round32', 'round64', 'round128', 'round256', 'groups'];
const label = (key, values) => translate(`manager.tournamentFinishPoints.${key}`, values);

export function finishPointsPayload(body, tournament) {
  if (body.points_credit_season === undefined) return {};
  const payload = {};
  const credit = body.points_credit_season ? Number(body.points_credit_season) : null;
  if (credit !== (tournament.points_credit_season ?? null)) payload.points_credit_season = credit;
  const prior = tournament.points_by_finish ?? {};
  const next = { ...prior };
  for (const stage of FINISH_STAGES) {
    const raw = body[`award_${stage}`];
    if (raw === undefined) continue;
    if (raw === '') delete next[stage];
    else next[stage] = Number(raw);
  }
  if (FINISH_STAGES.some(stage => prior[stage] !== next[stage])) payload.points_by_finish = next;
  return payload;
}

export default function TournamentFinishPoints({ tournament, groups, thirdPlace }) {
  const number = new Intl.NumberFormat(getIntlLocale());
  const stages = FINISH_STAGES.filter(stage => {
    if (stage === 'third' || stage === 'fourth') return thirdPlace;
    return stage !== 'groups' || groups;
  });
  return <details className="op-details">
    <summary>{label('title')}</summary>
    <div className="op-tournament-fields">
      <Field label={label('creditSeason')}>
        <select name="points_credit_season" defaultValue={tournament.points_credit_season ?? ''}>
          <option value="">{translate('manager.tournamentSettings.eventSeason')}</option>
          {[1, 2, 3, 4].map(season => <option key={season} value={season}>{translate('manager.tournamentSettings.seasonNumber', { number: number.format(season) })}</option>)}
        </select>
      </Field>
      <p className="muted">{label('help')}</p>
      <div className="op-tournament-series">
        {stages.map(stage => <Field key={stage} label={label(`finish.${stage}`)}>
          <input name={`award_${stage}`} type="number" min="0" max="1000000" step="1"
            defaultValue={tournament.points_by_finish?.[stage] ?? ''} placeholder={label('official')} />
        </Field>)}
      </div>
    </div>
  </details>;
}
