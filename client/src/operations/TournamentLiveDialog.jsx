import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Modal } from '../components/ui.jsx';
import { Field } from './ui.jsx';
import { getIntlLocale, translate } from '../i18n/runtime.js';

const KEY_PREFIX = 'manager.tournamentLive.';
const t = (key, values) => translate(KEY_PREFIX + key, values);
/** Server errors arrive as `manager.tournamentLive.error.*` keys; other failures keep their message. */
export function tournamentLiveError(cause) {
  const message = cause?.message;
  if (typeof message === 'string' && message.startsWith(KEY_PREFIX)) {
    try { return translate(message); } catch { /* Unknown key: fall through to the generic copy. */ }
  }
  return message || t('error.unavailable');
}
/** Same transitions CTP accepts in manager_tournament_live. */
export const LIVE_STATUS_TRANSITIONS = Object.freeze({
  borrador: ['inscripcion_abierta', 'cancelado'], inscripcion_abierta: ['en_curso', 'cancelado'],
  en_curso: ['finalizado', 'cancelado'], finalizado: ['en_curso'], cancelado: [],
});
const STATUSES = ['borrador', 'inscripcion_abierta', 'en_curso', 'finalizado', 'cancelado'];
const statusLabel = status => t(`status.values.${STATUSES.includes(status) ? status : 'borrador'}`);
const resultLabel = status => t(`result.state.${['none', 'pending', 'disputed', 'confirmed'].includes(status) ? status : 'none'}`);
const when = value => { try { return new Intl.DateTimeFormat(getIntlLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); } catch { return ''; } };
const localInput = value => { if (!value) return ''; const d = new Date(value); return Number.isFinite(d.getTime()) ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''; };
const entrantName = entrant => entrant?.name || (entrant ? t('unknownEntrant') : t('tbd'));
const played = match => Boolean(match.winner_id) || match.result_status !== 'none';
const slotsLocked = match => played(match) || ['running', 'done'].includes(match.veto_status);

function roundLabel(match, maxRound) {
  if (match.phase === 'grupos') return t('round.group', { group: match.group_label || '—', round: match.round });
  if (match.is_third_place) return t('round.third');
  if (match.round === maxRound) return t('round.final');
  if (match.round === maxRound - 1) return t('round.semi');
  return t('round.number', { round: match.round });
}

/** Live tournament control for CTP administrators and referees: every change applies at once and is audited. */
export default function TournamentLiveDialog({ tournament, onClose, onChanged }) {
  const { toast } = useApp();
  const [live, setLive] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [confirming, setConfirming] = useState(null);
  const [selectedId, setSelectedId] = useState(null), [nextStatus, setNextStatus] = useState('');
  const [search, setSearch] = useState({ purpose: null, participant: null, query: '', items: null, busy: false });
  const serial = useRef(0);

  const load = useCallback(async () => {
    const request = ++serial.current;
    setLoading(true);
    try { const value = await api.get(`/operations/tournaments/${encodeURIComponent(tournament.id)}/live`); if (request === serial.current) { setLive(value); setError(''); } }
    catch (cause) { if (request === serial.current) setError(tournamentLiveError(cause)); }
    finally { if (request === serial.current) setLoading(false); }
  }, [tournament.id]);
  useEffect(() => { void load(); return () => { ++serial.current; }; }, [load]);

  const reasonReady = reason.trim().length >= 12;
  async function run(body) {
    if (!live || busy) return;
    if (!reasonReady) { setError(t('error.reason')); return; }
    setBusy(true); setError('');
    try {
      const result = await api.post(`/operations/tournaments/${encodeURIComponent(tournament.id)}/live`, { ...body, expected_revision: live.revision, reason: reason.trim() });
      setLive(result); setConfirming(null); setSearch({ purpose: null, participant: null, query: '', items: null, busy: false });
      toast(t('toast.applied')); onChanged?.();
    } catch (cause) {
      setError(tournamentLiveError(cause));
      if (cause?.status === 409) void load();
    } finally { setBusy(false); }
  }
  async function findCandidates(event) {
    event.preventDefault();
    const query = search.query.trim();
    if (query.length < 3) { setError(t('error.query')); return; }
    setSearch(current => ({ ...current, busy: true }));
    try {
      const value = await api.get(`/operations/tournaments/${encodeURIComponent(tournament.id)}/live/candidates?${new URLSearchParams({ query })}`);
      setSearch(current => ({ ...current, items: value.items, busy: false })); setError('');
    } catch (cause) { setError(tournamentLiveError(cause)); setSearch(current => ({ ...current, busy: false })); }
  }

  const matches = live?.matches || [], participants = live?.participants || [];
  const maxRound = Math.max(0, ...matches.filter(m => m.phase !== 'grupos' && !m.is_third_place).map(m => m.round));
  const selected = matches.find(m => m.id === selectedId) || null;
  const rounds = useMemo(() => {
    const groups = new Map();
    for (const match of matches) {
      const key = match.phase === 'grupos' ? `g:${match.group_label}:${match.round}` : match.is_third_place ? 'third' : `r:${match.round}`;
      if (!groups.has(key)) groups.set(key, { key, label: roundLabel(match, maxRound), items: [] });
      groups.get(key).items.push(match);
    }
    return [...groups.values()];
  }, [matches, maxRound]);
  const inBracket = participant => matches.some(m => [m.entrant_a, m.entrant_b].some(e => e && e.kind === participant.entrant_kind && e.id === participant.entrant_id));
  const disabled = busy || loading || !live;
  const status = live?.tournament.status;
  const transitions = LIVE_STATUS_TRANSITIONS[status] || [];
  const ask = (body, message) => setConfirming({ body, message });

  return <Modal size="xl" title={t('title', { name: live?.tournament.name || tournament.name })} onClose={busy ? undefined : onClose} closeLabel={t('close')}
    headerExtra={<button type="button" className="btn" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={14} /> {t('refresh')}</button>}>
    <div className="op-roster op-live">
      <p className="op-help">{t('help')}</p>
      {loading && !live && <p role="status">{t('loading')}</p>}
      {error && <p className="op-error" role="alert">{error}</p>}
      <Field label={t('reason')} hint={t('reasonHint')}>
        <textarea value={reason} onChange={event => setReason(event.target.value)} minLength={12} maxLength={500} rows={2} disabled={busy} />
      </Field>
      {confirming && <div className="op-roster-danger op-roster-confirm" role="alertdialog" aria-label={t('confirm.title')}>
        <p>{confirming.message}</p>
        <div className="op-actions"><button type="button" className="btn danger" disabled={disabled || !reasonReady} onClick={() => void run(confirming.body)}>{t('confirm.apply')}</button>
          <button type="button" className="btn" disabled={busy} onClick={() => setConfirming(null)}>{t('confirm.cancel')}</button></div>
      </div>}

      {live && <>
        <section>
          <h3>{t('status.label')}</h3>
          <p>{t('status.current', { status: statusLabel(status) })}</p>
          {transitions.length ? <div className="op-actions">
            <select aria-label={t('status.label')} value={nextStatus} onChange={event => setNextStatus(event.target.value)} disabled={disabled}>
              <option value="">{t('status.choose')}</option>
              {transitions.map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}
            </select>
            <button type="button" className="btn" disabled={disabled || !nextStatus || !reasonReady}
              onClick={() => ask({ action: 'set_status', status: nextStatus }, t('confirm.status', { status: statusLabel(nextStatus) }))}>{t('status.apply')}</button>
          </div> : <p className="muted">{t('status.none')}</p>}
        </section>

        <section>
          <h3>{t('bracket.title')}</h3>
          {!matches.length ? <p className="muted">{t('bracket.empty')}</p> : <>
            <p className="muted">{t('bracket.help')}</p>
            <div className="op-live-bracket">
              {rounds.map(round => <div key={round.key} className="op-live-round">
                <h4>{round.label}</h4>
                {round.items.map(match => <button type="button" key={match.id} aria-pressed={match.id === selectedId}
                  className={`op-live-match${match.id === selectedId ? ' is-selected' : ''}`} onClick={() => setSelectedId(match.id === selectedId ? null : match.id)}>
                  {[['a', match.entrant_a, match.score_a], ['b', match.entrant_b, match.score_b]].map(([side, entrant, score]) =>
                    <span key={side} className={`op-live-slot${entrant && entrant.id === match.winner_id ? ' is-winner' : ''}`}><span>{entrantName(entrant)}</span><strong>{score ?? '–'}</strong></span>)}
                  <small>{resultLabel(match.result_status)} · {t('match.bestOf', { count: match.best_of })}{match.scheduled_at ? ` · ${when(match.scheduled_at)}` : ''}</small>
                </button>)}
              </div>)}
            </div>
          </>}
        </section>

        {selected && <MatchEditor key={selected.id + live.revision} match={selected} label={roundLabel(selected, maxRound)} matches={matches} participants={participants}
          maxRound={maxRound} disabled={disabled} reasonReady={reasonReady} run={run} ask={ask} />}

        <section>
          <h3>{t('participants.title', { count: participants.length, max: live.tournament.max_participants ?? '—' })}</h3>
          {!participants.length ? <p className="muted">{t('participants.empty')}</p> : <ul className="op-roster-list">
            {participants.map(participant => <li key={participant.id}>
              <div><strong>{participant.name || t('unknownEntrant')}</strong> · {t(`kind.${participant.entrant_kind}`)}{participant.seed != null && <> · {t('participants.seed', { seed: participant.seed })}</>}
                {inBracket(participant) && <> · <span className="muted">{t('participants.inBracket')}</span></>}<br />
                <small className="muted">{participant.roster.length ? participant.roster.join(', ') : t('participants.rosterEmpty')}</small></div>
              <div className="op-actions">
                <button type="button" className="btn" disabled={disabled} onClick={() => setSearch({ purpose: 'substitute', participant, query: '', items: null, busy: false })}>{t('participants.substitute')}</button>
                <button type="button" className="btn" disabled={disabled || !reasonReady}
                  onClick={() => ask({ action: 'disqualify', participant_id: participant.id }, t('confirm.disqualify', { name: participant.name || t('unknownEntrant') }))}>{t('participants.disqualify')}</button>
                <button type="button" className="btn" disabled={disabled || !reasonReady || inBracket(participant)}
                  onClick={() => ask({ action: 'remove_participant', participant_id: participant.id }, t('confirm.remove', { name: participant.name || t('unknownEntrant') }))}>{t('participants.remove')}</button>
              </div>
            </li>)}
          </ul>}
          <div className="op-actions"><button type="button" className="btn" disabled={disabled} onClick={() => setSearch({ purpose: 'add', participant: null, query: '', items: null, busy: false })}>{t('add.title')}</button></div>
        </section>

        {search.purpose && <section className="op-roster-confirm">
          <h3>{search.purpose === 'add' ? t('add.title') : t('substitute.title', { name: search.participant?.name || t('unknownEntrant') })}</h3>
          {search.purpose === 'substitute' && <p className="muted">{t('substitute.help')}</p>}
          <form className="op-actions" onSubmit={findCandidates}>
            <input aria-label={t('search.label')} placeholder={t('search.placeholder')} value={search.query} maxLength={40}
              onChange={event => setSearch(current => ({ ...current, query: event.target.value }))} disabled={search.busy || busy} />
            <button className="btn" disabled={search.busy || busy}><Search size={14} /> {t('search.button')}</button>
            <button type="button" className="btn" disabled={busy} onClick={() => setSearch({ purpose: null, participant: null, query: '', items: null, busy: false })}>{t('confirm.cancel')}</button>
          </form>
          {search.items && (!search.items.length ? <p className="muted">{t('search.empty')}</p> : <ul className="op-roster-list">
            {search.items.filter(item => search.purpose === 'add' || item.kind === search.participant?.entrant_kind).map(item => <li key={item.kind + item.id}>
              <span><strong>{item.name}</strong> · {t(`kind.${item.kind}`)}{item.registered && <> · <span className="muted">{t('search.registered')}</span></>}</span>
              <button type="button" className="btn primary" disabled={disabled || !reasonReady || item.registered}
                onClick={() => void run(search.purpose === 'add'
                  ? { action: 'add_participant', entrant_kind: item.kind, entrant_id: item.id }
                  : { action: 'substitute_participant', participant_id: search.participant.id, entrant_id: item.id })}>
                {search.purpose === 'add' ? t('add.apply', { name: item.name }) : t('substitute.apply', { name: item.name })}</button>
            </li>)}
          </ul>)}
        </section>}
      </>}
    </div>
  </Modal>;
}

function MatchEditor({ match, label, matches, participants, maxRound, disabled, reasonReady, run, ask }) {
  const wins = (match.best_of + 1) / 2;
  const [mapsA, setMapsA] = useState(match.score_a ?? 0), [mapsB, setMapsB] = useState(match.score_b ?? 0);
  const [slots, setSlots] = useState({ a: '', b: '' }), [swapTarget, setSwapTarget] = useState(''), [bestOf, setBestOf] = useState(match.best_of);
  const [schedule, setSchedule] = useState(localInput(match.scheduled_at));
  const locked = slotsLocked(match);
  const scoreValid = Math.max(mapsA, mapsB) === wins && Math.min(mapsA, mapsB) < wins;
  const complete = Boolean(match.entrant_a && match.entrant_b);
  const swapOptions = matches.filter(other => !slotsLocked(other)).flatMap(other => ['a', 'b']
    .filter(side => !(other.id === match.id && side === 'a'))
    .map(side => ({ value: `${other.id}:${side}`, label: t('swap.slot', { round: roundLabel(other, maxRound), position: other.position, side: side.toUpperCase(), name: entrantName(side === 'a' ? other.entrant_a : other.entrant_b) }) })));
  const gate = disabled || !reasonReady;

  return <section className="op-live-editor" aria-label={t('match.title')}>
    <h3>{t('match.title')} · {label} · {entrantName(match.entrant_a)} – {entrantName(match.entrant_b)}</h3>
    <p className="muted">{resultLabel(match.result_status)} · {t('match.bestOf', { count: match.best_of })} · {match.scheduled_at ? t('match.scheduled', { date: when(match.scheduled_at) }) : t('match.unscheduled')}</p>

    <div className="op-live-block">
      <h4>{t('result.title')}</h4>
      <p className="muted">{t('result.help')}</p>
      <div className="op-form-grid">
        <Field label={t('result.maps', { name: entrantName(match.entrant_a) })}><input type="number" min="0" max={wins} value={mapsA} onChange={event => setMapsA(Number(event.target.value))} disabled={disabled || !complete} /></Field>
        <Field label={t('result.maps', { name: entrantName(match.entrant_b) })}><input type="number" min="0" max={wins} value={mapsB} onChange={event => setMapsB(Number(event.target.value))} disabled={disabled || !complete} /></Field>
      </div>
      {!complete && <p className="muted">{t('result.incomplete')}</p>}
      <div className="op-actions">
        <button type="button" className="btn primary" disabled={gate || !complete || !scoreValid}
          onClick={() => void run({ action: 'set_result', match_id: match.id, maps_a: mapsA, maps_b: mapsB })}>{match.winner_id ? t('result.rectify') : t('result.save')}</button>
        {match.winner_id && <button type="button" className="btn" disabled={gate} onClick={() => ask({ action: 'revert_result', match_id: match.id }, t('confirm.revert'))}>{t('result.revert')}</button>}
      </div>
      {complete && !scoreValid && <p className="muted">{t('result.scoreHint', { wins })}</p>}
    </div>

    <div className="op-live-block">
      <h4>{t('slots.title')}</h4>
      {locked ? <p className="muted">{t('slots.locked')}</p> : <>
        {['a', 'b'].map(side => <div key={side} className="op-actions">
          <span>{t(side === 'a' ? 'slots.sideA' : 'slots.sideB')}: <strong>{entrantName(side === 'a' ? match.entrant_a : match.entrant_b)}</strong></span>
          <select aria-label={t(side === 'a' ? 'slots.sideA' : 'slots.sideB')} value={slots[side]} disabled={disabled} onChange={event => setSlots(current => ({ ...current, [side]: event.target.value }))}>
            <option value="">{t('slots.choose')}</option><option value="empty">{t('slots.empty')}</option>
            {participants.map(participant => <option key={participant.id} value={participant.id}>{participant.name || t('unknownEntrant')}</option>)}
          </select>
          <button type="button" className="btn" disabled={gate || !slots[side]}
            onClick={() => void run({ action: 'replace_entrant', match_id: match.id, side, participant_id: slots[side] === 'empty' ? null : slots[side] })}>{t('slots.replace')}</button>
        </div>)}
        <div className="op-actions">
          <select aria-label={t('swap.target')} value={swapTarget} disabled={disabled} onChange={event => setSwapTarget(event.target.value)}>
            <option value="">{t('swap.target')}</option>
            {swapOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button type="button" className="btn" disabled={gate || !swapTarget} onClick={() => {
            const [otherId, otherSide] = swapTarget.split(':');
            void run({ action: 'swap_entrants', match_id: match.id, side: 'a', other_match_id: otherId, other_side: otherSide });
          }}>{t('swap.applyA')}</button>
          <button type="button" className="btn" disabled={gate || !swapTarget || swapTarget === `${match.id}:b`} onClick={() => {
            const [otherId, otherSide] = swapTarget.split(':');
            void run({ action: 'swap_entrants', match_id: match.id, side: 'b', other_match_id: otherId, other_side: otherSide });
          }}>{t('swap.applyB')}</button>
        </div>
      </>}
    </div>

    <div className="op-form-grid">
      <div className="op-live-block">
        <h4>{t('schedule.title')}</h4>
        <Field label={t('schedule.label')} hint={t('schedule.hint')}><input type="datetime-local" value={schedule} onChange={event => setSchedule(event.target.value)} disabled={disabled || match.result_status === 'confirmed'} /></Field>
        <div className="op-actions">
          <button type="button" className="btn" disabled={gate || !schedule || match.result_status === 'confirmed'}
            onClick={() => void run({ action: 'schedule_match', match_id: match.id, scheduled_at: new Date(schedule).toISOString() })}>{t('schedule.save')}</button>
          {match.scheduled_at && <button type="button" className="btn" disabled={gate || match.result_status === 'confirmed'}
            onClick={() => void run({ action: 'schedule_match', match_id: match.id, scheduled_at: null })}>{t('schedule.clear')}</button>}
        </div>
      </div>
      <div className="op-live-block">
        <h4>{t('series.title')}</h4>
        {locked ? <p className="muted">{t('series.locked')}</p> : <div className="op-actions">
          <select aria-label={t('series.title')} value={bestOf} disabled={disabled} onChange={event => setBestOf(Number(event.target.value))}>
            {[1, 3, 5, 7, 9].map(value => <option key={value} value={value}>{t('match.bestOf', { count: value })}</option>)}
          </select>
          <button type="button" className="btn" disabled={gate || bestOf === match.best_of} onClick={() => void run({ action: 'set_best_of', match_id: match.id, best_of: bestOf })}>{t('series.apply')}</button>
        </div>}
      </div>
    </div>
  </section>;
}
