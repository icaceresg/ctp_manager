import { getIntlLocale, translate } from '../i18n/runtime.js';
import { roundTitle } from './tournamentLiveUi.jsx';

const t = (key, values) => translate(`manager.tournamentPreview.${key}`, values);
const label = size => roundTitle({ name: { 2: 'final', 4: 'semi', 8: 'quarter' }[size] || 'ofN', size });

export default function TournamentFormatPreview({ preview, grouped }) {
  if (!preview && !grouped) return null;
  const number = new Intl.NumberFormat(getIntlLocale());
  const n = value => number.format(value);
  const summary = preview?.kind === 'groups' ? <>
    <span>{t('groups', { groups: n(preview.group_count), entrants: n(preview.entrants) })}</span>
    {preview.entrants === 11 && preview.group_sizes.includes(6)
      ? <span>{t('elevenGroups')}</span>
      : preview.group_sizes.includes(5) && <span>{t('distribution', {
      fours: n(preview.group_sizes.filter(size => size === 4).length),
      fives: n(preview.group_sizes.filter(size => size === 5).length),
    })}</span>}
    <span>{t('qualified', { count: n(preview.bracket_size), round: label(preview.bracket_size) })}</span>
    <span>{t('direct', { count: n(preview.direct_per_group) })}</span>
    {preview.extra_slots > 0 && <span>{t('extra', { count: n(preview.extra_slots), position: n(preview.extra_position) })}</span>}
  </> : preview?.kind === 'direct' ? <span>{t('directBracket', { count: n(preview.bracket_size), round: label(preview.bracket_size) })}</span>
    : preview?.kind === 'unavailable' ? <span className="muted">{t(`unavailable.${preview.reason}`, { count: n(preview.entrants) })}</span> : null;

  return <div className="op-competition-format">
    {summary && <div className="op-competition-format-summary">{summary}</div>}
    {grouped && <details className="op-details">
      <summary>{t('rules')}</summary>
      <div className="op-competition-format-help">
        <p>{t('groupsHelp')}</p>
        <p>{t('elevenHelp')}</p>
        <p>{t('qualificationHelp')}</p>
        <p>{t('seedingHelp')}</p>
        <dl className="op-competition-scenarios">
          {[8, 16, 32, 64, 128].map(size => <div key={size}>
            <dt>{t('scenarioRange', { min: n(size + 1), max: n(size * 2) })}</dt>
            <dd>{t('qualified', { count: n(size), round: label(size) })}</dd>
          </div>)}
        </dl>
      </div>
    </details>}
  </div>;
}
