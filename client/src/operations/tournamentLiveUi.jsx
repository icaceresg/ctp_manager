import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { getIntlLocale, translate } from '../i18n/runtime.js';
import { REASON_MAX, STATUSES, matchState, reasonCheck } from './tournamentLiveModel.js';

export const KEY_PREFIX = 'manager.tournamentLive.';
export const t = (key, values) => translate(KEY_PREFIX + key, values);

/** Translate the bridge's tournament errors and use localized copy for transport failures. */
export function tournamentLiveError(cause) {
  const message = cause?.message;
  if (typeof message === 'string' && message.startsWith(KEY_PREFIX)) {
    try { return translate(message); } catch { /* Unknown key: fall through to the generic copy. */ }
  }
  return t([401, 403].includes(cause?.status) ? 'error.forbidden' : 'error.unavailable');
}

export const statusLabel = status => t(`status.values.${STATUSES.includes(status) ? status : 'borrador'}`);
export const entrantName = entrant => entrant?.name || (entrant ? t('unknownEntrant') : t('tbd'));
export const stateLabel = match => t(`state.${matchState(match)}`);

const format = (value, options) => {
  if (!value) return '';
  try { return new Intl.DateTimeFormat(getIntlLocale(), options).format(new Date(value)); } catch { return ''; }
};
export const when = value => format(value, { timeZone: 'Europe/Madrid', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const clock = value => format(value, { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' });
export const clockSeconds = value => format(value, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Title of a playoff round or schedule row from the model's `name`. */
export function roundTitle(row) {
  if (!row) return '';
  if (row.name === 'matchday') return t('round.matchday', { round: row.round });
  if (row.name === 'ofN') {
    return [16, 32, 64, 128].includes(row.size) ? t(`round.of${row.size}`) : t('round.ofN', { size: row.size });
  }
  return t(`round.${row.name}`);
}
/** Label for a single match: group and matchday, or playoff round. */
export function matchRoundLabel(match, rounds) {
  if (!match) return '';
  if (match.phase === 'grupos') return t('round.groupMatchday', { group: match.group_label || '—', round: match.round });
  if (match.is_third_place) return t('round.third');
  return roundTitle(rounds.find(round => round.round === match.round));
}

export function StateBadge({ match }) {
  return <span className={`op-live-state is-${matchState(match)}`}>{stateLabel(match)}</span>;
}

/**
 * The reason travels with every action: it lives next to the confirm button,
 * offers ready-made sentences, counts what is missing and says why the button
 * is disabled. `onSubmit(reason, extra)` resolves to an error string or null.
 */
export function ReasonConfirm({ presets = [], defaultReason = '', submitLabel, danger = false, blockedReason = '', onSubmit, busy, secondary }) {
  const [reason, setReason] = useState(defaultReason), [error, setError] = useState(''), [working, setWorking] = useState(false);
  const check = reasonCheck(reason);
  const locked = busy || working;
  const why = blockedReason || (!check.ready ? (check.tooLong ? t('reason.tooLong', { max: REASON_MAX }) : t('reason.missing', { count: check.missing })) : '');
  async function submit(handler, blocked = why) {
    if (locked || blocked) return;
    setWorking(true); setError('');
    const problem = await handler(reason.trim());
    setWorking(false);
    if (problem) setError(problem); else setReason('');
  }
  return <div className="op-live-reason">
    <label className="op-field"><span>{t('reason.label')}</span>
      <textarea value={reason} rows={2} maxLength={REASON_MAX + 20} disabled={locked} placeholder={t('reason.placeholder')} onChange={event => setReason(event.target.value)} />
    </label>
    {presets.length > 0 && <div className="op-live-chips" role="group" aria-label={t('reason.presets')}>
      {presets.map(key => <button type="button" key={key} className="op-live-chip" disabled={locked} onClick={() => setReason(t(`presets.${key}`))}>{t(`presets.${key}`)}</button>)}
    </div>}
    <p className={`op-live-reason-state${check.ready ? ' is-ready' : ''}`} aria-live="polite">
      {check.ready ? <><CheckCircle2 size={14} /> {t('reason.ready')}</> : check.tooLong ? t('reason.tooLong', { max: REASON_MAX }) : t('reason.missing', { count: check.missing })}
    </p>
    {error && <p className="op-error" role="alert">{error}</p>}
    <div className="op-actions">
      <button type="button" className={`btn ${danger ? 'danger' : 'primary'}`} disabled={locked || Boolean(why)} onClick={() => void submit(onSubmit, blockedReason)}>
        {working ? t('applying') : submitLabel}</button>
      {secondary && <button type="button" className="btn" disabled={locked || !check.ready || secondary.disabled} onClick={() => void submit(secondary.onSubmit, !check.ready || secondary.disabled)}>{secondary.label}</button>}
    </div>
    {blockedReason && !locked && <p className="op-live-why">{blockedReason}</p>}
  </div>;
}
