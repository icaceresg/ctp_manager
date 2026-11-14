import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Info, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Modal } from '../components/ui.jsx';
import { DataTable, Field, FormDialog } from './ui.jsx';
import { getIntlLocale, translate } from '../i18n/runtime.js';
import { guardTournamentError, guardTournamentReport, guardTournamentView } from './guardTournamentModel.js';
import { useGuardTournamentRead } from './useGuardTournamentRead.js';
const t = (key, values) => translate(`manager.guardTournament.${key}`, values);
const dateTime = value => Number.isFinite(Date.parse(value ?? '')) ? new Intl.DateTimeFormat(getIntlLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const statusKeys = new Set(['ready','console_verified','guard_not_connected','signal_lost','controller_missing','camera_missing','capture_missing','unknown']);
const eventKeys = new Set(['paired','connected','reconnected','signal_changed','closed','match_started','console_exempted','console_revoked','tournament_enabled','tournament_disabled','lineup_selected']);
const statusLabel = state => t(`status.${statusKeys.has(state) ? state : 'unknown'}`);
const number=value=>Number.isSafeInteger(value)&&value>=0?new Intl.NumberFormat(getIntlLocale()).format(value):'—';
function PcReport({player,fresh,now}) {
 const report=guardTournamentReport(player,fresh,now);
 return <div className="op-guard-pc"><strong className={report.review===true?'op-guard-review':''}>{t(report.priorReview?'reportPriorReview':report.review===true?'reportReview':report.review===false?'reportNoAlert':'reportUnknown')}</strong>
  {report.current&&<><small>{t('reportProcesses',{count:number(report.processes),coverage:t(`coverage.${report.processCoverage}`)})}</small><small>{t('reportNetwork',{count:number(report.connections),coverage:t(`coverage.${report.networkCoverage}`)})}</small><small>{t('reportFiles',{count:number(report.files),coverage:t(`coverage.${report.fileCoverage}`)})}</small><small>{t('reportPackage',{status:t(`integrity.${report.integrity}`)})}</small><small>{t('reportRules',{count:number(report.ruleMatches)})}</small></>}
 </div>;
}

export function GuardPanel({ id }) {
 const { me } = useApp(); const scope = `${me.id}:${id}`;
 const read = useGuardTournamentRead(id, me.id); const state = read.data;
 const view = guardTournamentView(state, read.receivedAt, read.now, !!read.error);
 const [error, setError] = useState(null), [dialog, setDialog] = useState(null), [info, setInfo] = useState(false), [busy, setBusy] = useState(false);
 const [historyOpen, setHistoryOpen] = useState(false), [history, setHistory] = useState({ scope, data: [], loading: false, error: null, at: 0 });
 const historyAbort = useRef(null), historyEpoch = useRef(0), alive = useRef(true), writing = useRef(null);
 const pending = state?.commands?.find(command => ['pending','failed','sending','rejected'].includes(command.status));
 const mutable = !!state && view.fresh && !busy && !pending;
 const loadHistory = useCallback(async () => {
  if (document.hidden || historyAbort.current) return;
  const controller = new AbortController(); historyAbort.current = controller; const token = ++historyEpoch.current;
  const deadline = setTimeout(() => controller.abort(), 12000);
  setHistory(value => ({ ...value, scope, loading: true, error: null }));
  try {
   const next = await api.get(`/operations/matches/${encodeURIComponent(id)}/guard?include_events=true`, { signal: controller.signal });
   if (alive.current && token === historyEpoch.current && !controller.signal.aborted && !document.hidden && next.match_id === id) setHistory({ scope, data: next.events, loading: false, error: null, at: Date.now() });
  } catch (failure) {
   if (alive.current && token === historyEpoch.current) setHistory(value => ({ ...value, loading: false, error: guardTournamentError(failure) }));
  } finally { clearTimeout(deadline); if (historyAbort.current === controller) historyAbort.current = null; }
 }, [id, scope]);
 useEffect(() => {
  alive.current = true;
  return () => { alive.current = false; writing.current?.abort(); historyEpoch.current++; historyAbort.current?.abort(); historyAbort.current = null; };
 }, [scope]);
 useEffect(() => {
  const hide = () => { if (document.hidden) { historyEpoch.current++; historyAbort.current?.abort(); historyAbort.current = null; setHistory(value => ({ ...value, loading: false })); } };
  document.addEventListener('visibilitychange', hide);
  if (historyOpen) void loadHistory();
  return () => { document.removeEventListener('visibilitychange', hide); historyEpoch.current++; historyAbort.current?.abort(); historyAbort.current = null; };
 }, [historyOpen, loadHistory]);
 async function post(url, body) {
  const controller = new AbortController(); writing.current = controller;
  const deadline = setTimeout(() => controller.abort(), 15000);
  try { return await api.post(url, body, { signal: controller.signal }); }
  finally { clearTimeout(deadline); if (writing.current === controller) writing.current = null; }
 }
 async function send(command) {
  setBusy(true); setError(null);
  try { await post(`/operations/guard/commands/${command.id}/send`, {}); }
  catch (failure) { if (alive.current) setError(guardTournamentError(failure)); throw failure; }
  finally { if (alive.current) { setBusy(false); void read.refresh(true); } }
 }
 async function submit(body) {
  setBusy(true); setError(null);
  const snapshot = dialog;
  const payload = snapshot.type === 'guard.start' ? {} : snapshot.type === 'guard.exempt'
   ? { user_id: snapshot.player.user_id, approve: snapshot.player.state !== 'console_verified', reason: body.reason }
   : { enabled: body.enabled === 'true', controller_required: body.controller_required === 'true', capture_required: body.capture_required === 'true', reason: body.reason };
  try {
   const prepared = await post(`/operations/matches/${id}/guard/commands`, { type: snapshot.type, target_id: snapshot.target, expected_version: snapshot.version, payload });
   if (alive.current) { setDialog(null); await send(prepared.command); }
  } catch (failure) {
   // After a lost receipt, reconcile the existing identity from the pending
   // card instead of preparing a second command on the same resource.
   if (alive.current) { setDialog(null); setError(guardTournamentError(failure)); void read.refresh(true); }
   throw Error(t(`error.${guardTournamentError(failure)}`));
  } finally { if (alive.current) setBusy(false); }
 }
 const open = (type, player) => setDialog({ type, player, version: type === 'guard.configure' ? state.tournament_version : state.match_version, target: type === 'guard.configure' ? state.tournament_id : id, enabled: state.enabled, controller_required: state.enabled ? state.controller_required : true, capture_required: state.capture_required });
 const consoleAction = player => !state.started_at && <button className="btn" disabled={!mutable} onClick={() => open('guard.exempt', player)}>{t(player.state === 'console_verified' ? 'revokeConsole' : 'verifyConsole')}</button>;
 const hist = history.scope === scope ? history : { data: [], loading: false, error: null, at: 0 };
 return <section className="op-card op-guard" aria-label={t('title')}>
  <div className="op-section-title"><div><p className="op-guard-eyebrow">CTP Guard</p><h2><ShieldCheck size={19}/>{t('title')}</h2><p>{state?.started_at ? t('started', { at: dateTime(state.started_at) }) : state?.enabled ? t('readyCount', { count: view.ready }) : state ? t('notRequired') : t('loading')}</p></div>
   <div className="op-actions"><button className="btn" onClick={() => setInfo(true)} aria-label={t('info')}><Info size={16}/></button><button className="btn" onClick={() => { setError(null); void read.refresh(); if (historyOpen) void loadHistory(); }} disabled={busy || read.loading} aria-label={t('refresh')}><RefreshCw size={16} className={read.loading ? 'spin' : ''}/>{t('refresh')}</button>
    {state && !state.started_at && <button className="btn" onClick={() => open('guard.configure')} disabled={!mutable}>{t('configure')}</button>}
    {state?.enabled && !state.started_at && <button className="btn primary" disabled={!view.canStart || !mutable} onClick={() => open('guard.start')}>{t('start')}</button>}
   </div></div>
  <div className="op-guard-refresh"><span><Clock3 size={14}/>{t('currentTime', { time: new Intl.DateTimeFormat(getIntlLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(read.now)) })}</span><span>{t('refreshPolicy')}</span></div>
  {(error || read.error) && <p className="op-error" role="alert">{t(`error.${error || guardTournamentError(read.error)}`)}</p>}
  {state?.enabled && <>
   <div className={`op-guard-summary ${view.fresh ? '' : 'is-stale'}`} role="status"><strong>{view.canStart ? <CheckCircle2 size={18}/> : <AlertTriangle size={18}/>}{t(!view.fresh ? 'stale' : state.started_at ? 'monitoring' : view.canStart ? 'allReady' : 'waitingCount', { count: view.waiting })}</strong><p>{t(state.lineup_pending ? 'lineupPending' : 'presenceOnly')}</p></div>
   <div className="op-guard-meter" aria-hidden="true"><span style={{ width: `${view.ready / 8 * 100}%` }}/></div>
   <div className="op-guard-desktop"><DataTable rows={view.players} regionLabel={t('tableLabel')} empty={t('noPlayers')} emptyDetail={t('lineupPending')} columns={[
    { key: 'username', title: t('player') }, { key: 'side', title: t('team'), render: player => t('teamSide', { side: player.side.toUpperCase() }) },
    { key: 'state', title: t('status'), render: player => <span className={`op-guard-state ${player.ready ? 'ready' : ''}`}>{statusLabel(player.displayState)}</span> },
    { key: 'next', title: t('nextStep'), render: player => <small>{t(`next.${statusKeys.has(player.displayState) ? player.displayState : 'unknown'}`)}</small> },
    { key: 'pc', title: t('pcReport'), render: player => <PcReport player={player} fresh={view.fresh} now={read.now}/> },
    { key: 'last_seen_at', title: t('lastSignal'), render: player => dateTime(player.last_seen_at) },
    { key: 'action', title: t('console'), render: consoleAction },
   ]}/></div>
   <ul className="op-guard-players" aria-label={t('players')}>{view.players.map(player => <li key={player.user_id}><div><strong>{player.username}</strong><small>{t('teamSide', { side: player.side.toUpperCase() })}</small></div><p className={`op-guard-state ${player.ready ? 'ready' : ''}`}>{statusLabel(player.displayState)}</p><p>{t(`next.${statusKeys.has(player.displayState) ? player.displayState : 'unknown'}`)}</p><PcReport player={player} fresh={view.fresh} now={read.now}/><div><small>{t('lastSignal')} · {dateTime(player.last_seen_at)}</small>{consoleAction(player)}</div></li>)}</ul>
   <p className="op-guard-report-note">{t('reportHelp')}</p>
   <details className="op-guard-events" onToggle={event => setHistoryOpen(event.currentTarget.open)}><summary>{t('recentActivity')}</summary><p className="muted">{t('historyPolicy')}</p>{hist.loading && <p>{t('loadingHistory')}</p>}{hist.error && <p className="op-error" role="alert">{t(`error.${hist.error}`)}</p>}{hist.at > 0 && <small>{t('historyAt', { at: dateTime(new Date(hist.at).toISOString()) })}</small>}{!hist.loading && hist.at > 0 && !hist.data.length && <p>{t('emptyHistory')}</p>}<ol>{hist.data.map(event => <li key={event.id}><strong>{t(`event.${eventKeys.has(event.kind) ? event.kind : 'other'}`)}</strong> · {view.players.find(player => player.user_id === event.user_id)?.username || t('staff')} · {dateTime(event.created_at)}</li>)}</ol></details>
  </>}
  {pending && <div className="op-guard-pending" role="status"><p><strong>{t(`action.${pending.type.split('.')[1]}`)}</strong> · {t(pending.status === 'rejected' ? 'rejected' : pending.status === 'sending' ? 'sending' : 'pending')}</p><p>{t('pendingHelp')}</p>
   {['pending','failed','sending'].includes(pending.status) && <button className="btn" disabled={busy || pending.status === 'sending' && read.now - pending.updated_at < 30000} onClick={() => send(pending).catch(() => {})}>{t('retrySame')}</button>}
   {(pending.status === 'pending' && pending.attempts === 0 || pending.status === 'rejected') && <button className="btn" disabled={busy} onClick={async () => { setBusy(true); try { await post(`/operations/commands/${pending.id}/cancel`, { expected_updated_at: pending.updated_at }); } catch (failure) { setError(guardTournamentError(failure)); } finally { if (alive.current) { setBusy(false); void read.refresh(true); } } }}>{t('discard')}</button>}
  </div>}
  {dialog && <FormDialog title={t(dialog.type === 'guard.start' ? 'startTitle' : dialog.type === 'guard.exempt' ? dialog.player.state === 'console_verified' ? 'revokeConsole' : 'verifyConsole' : 'configureTitle')} onClose={() => setDialog(null)} submit={submit} submitLabel={t('confirm')} cancelLabel={t('cancel')} closeLabel={t('cancel')}>
   {dialog.player && <p><strong>{dialog.player.username}</strong></p>}{dialog.type === 'guard.start' ? <p>{t('startHelp')}</p> : <>
    {dialog.type === 'guard.configure' && <><Field label={t('requireGuard')}><select name="enabled" defaultValue={String(dialog.enabled)}><option value="true">{t('required')}</option><option value="false">{t('disabled')}</option></select></Field><Field label={t('requireController')}><select name="controller_required" defaultValue={String(dialog.controller_required)}><option value="true">{t('mandatory')}</option><option value="false">{t('notRequiredShort')}</option></select></Field><Field label={t('requireCapture')} hint={t('captureHelp')}><select name="capture_required" defaultValue={String(dialog.capture_required)}><option value="true">{t('mandatory')}</option><option value="false">{t('notRequiredShort')}</option></select></Field></>}
    <Field label={t('reason')} hint={t('reasonHelp')}><textarea name="reason" minLength={12} maxLength={160} required rows={3}/></Field></>}
  </FormDialog>}
  {info && <Modal title={t('infoTitle')} onClose={() => setInfo(false)} closeLabel={t('cancel')}><p>{t('infoSignals')}</p><p>{t('infoConsoles')}</p><p>{t('presenceOnly')}</p><p>{t('infoPrivacy')}</p></Modal>}
 </section>;
}
