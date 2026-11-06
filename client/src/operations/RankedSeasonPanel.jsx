import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { getIntlLocale, translate } from '../i18n/runtime.js';
import { Field, FormDialog } from './ui.jsx';
import { canSendCommand } from './model.js';
import './operations.css';

const t = (key, values) => translate(`manager.rankedSeasons.${key}`, values);
const formatDate = value => new Intl.DateTimeFormat(getIntlLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const localDate = value => {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const number = value => new Intl.NumberFormat(getIntlLocale()).format(value);

export function RankedSeasonsPage() {
  return <div className="page wide op-page">
    <header className="op-heading"><div><Link className="op-text-button op-competition-back" to="/ranked/monitor"><ArrowLeft size={15} /> {t('back')}</Link>
      <h1>{t('title')}</h1>
    </div></header>
    <RankedSeasonPanel />
  </div>;
}

function RankedSeasonPanel() {
  const [state, setState] = useState(null);
  const [connection, setConnection] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);
  const serial = useRef(0);
  const load = useCallback(async () => {
    const request = ++serial.current;
    setError('');
    setBusy(true);
    try {
      const status = await api.get('/operations/integration');
      if (request !== serial.current) return;
      setConnection(status);
      if (!status.configured || !status.supported_actions?.includes('ranked.season.schedule')) {
        setState(null);
        return;
      }
      const next = await api.get('/operations/ranked');
      if (request === serial.current) setState(next);
    } catch (cause) {
      if (request === serial.current) {
        setError(t('loadError'));
        if ([401, 403].includes(cause.status)) setState(null);
      }
    } finally {
      if (request === serial.current) setBusy(false);
    }
  }, []);
  useEffect(() => { void load(); return () => { ++serial.current; }; }, [load]);

  const supports = type => connection?.supported_actions?.includes(type);
  const command = state?.commands.find(item => ['pending', 'failed', 'sending', 'rejected'].includes(item.status));
  const schedule = 'ranked.season.schedule';
  const update = 'ranked.season.update';
  const cancel = 'ranked.season.cancel';
  const modifiable = !busy && !command && Date.parse(state?.scheduled?.starts_at) > Date.now();
  async function act(action) {
    setBusy(true);
    setError('');
    try {
      if (action === 'send') await api.post(`/operations/integration/commands/${command.id}/send`, {});
      else await api.post(`/operations/commands/${command.id}/cancel`, { expected_updated_at: command.updated_at });
      await load();
    } catch {
      await load();
      setError(t(action === 'send' ? 'sendError' : 'discardError'));
    }
  }
  return <section className="op-card">
    <div className="op-section-title"><p>{t('resetRule')}</p>
      <button type="button" className="btn" onClick={() => void load()} disabled={busy}><RefreshCw size={15} /> {t('refresh')}</button>
    </div>
    {connection && (!connection.configured || !supports(schedule)) && <p className="op-notice">{t('unavailable')}</p>}
    {busy && !state && <p role="status">{t('loading')}</p>}
    {error && <p className="op-error" role="alert">{error}</p>}
    {state && <>
      <div className="op-section-title">
        <div><h2>{state.current.name}</h2>
          <p>{t('endsOn', { date: state.current.ends_at ? formatDate(state.current.ends_at) : t('noDate') })}</p>
          <p>{t('activity', { matches: number(state.active_matches), players: number(state.waiting_players) })}</p>
        </div>
        <button type="button" className="btn gold" onClick={() => setOpen(schedule)} disabled={busy || !!state.scheduled || !!command}><CalendarDays size={15} /> {t('schedule')}</button>
      </div>
      {state.scheduled && <div className="op-notice">
        <strong>{state.scheduled.name}</strong>
        <p>{t('window', { start: formatDate(state.scheduled.starts_at), end: formatDate(state.scheduled.ends_at) })}</p>
        <div className="op-actions">
          <button type="button" className="btn" disabled={!modifiable || !supports(update)} onClick={() => setOpen(update)}>{t('update')}</button>
          <button type="button" className="btn" disabled={!modifiable || !supports(cancel)} onClick={() => setOpen(cancel)}>{t('cancel')}</button>
        </div>
      </div>}
      {command && <div className="op-notice">
        <strong>{t('pending', { action: command.type === cancel ? t('cancel') : command.payload.name })}</strong>
        {command.payload.starts_at && <p>{t('window', { start: formatDate(command.payload.starts_at), end: formatDate(command.payload.ends_at) })}</p>}
        <p>{command.payload.reason}</p>
        <div className="op-actions">
          <button type="button" className="btn gold" disabled={busy || !canSendCommand(command, connection?.write_enabled, supports(command.type))} onClick={() => void act('send')}>{t('send')}</button>
          {(command.status === 'pending' && command.attempts === 0 || command.status === 'rejected' && command.attempts === 1 && command.result?.rejected_confirmed) &&
            <button type="button" className="btn" disabled={busy} onClick={() => void act('discard')}>{t('discard')}</button>}
        </div>
      </div>}
    </>}
    {open && state && <FormDialog title={t(open === cancel ? 'cancel' : open === update ? 'update' : 'schedule')}
      onClose={() => setOpen(null)} submitLabel={t('prepare')} help={t('proposalHelp')}
      cancelLabel={translate('manager.tournamentLive.confirm.cancel')} closeLabel={translate('manager.tournamentLive.close')}
      submit={async input => {
        const target = open === schedule ? state.current : state.scheduled;
        try {
          await api.post('/operations/ranked/commands', {
            type: open, target_id: target.id, expected_version: target.manager_version,
            payload: open === cancel ? { reason: input.reason } : {
              name: input.name, starts_at: new Date(input.starts_at).toISOString(), ends_at: new Date(input.ends_at).toISOString(), reason: input.reason,
            },
          });
        } catch { throw new Error(t('prepareError')); }
        await load();
      }}>
      {open !== cancel && <>
        <Field label={t('name')}><input name="name" required maxLength={120} defaultValue={open === update ? state.scheduled.name : t('defaultName', { number: state.current.sequence + 1 })} /></Field>
        <Field label={t('startLocal')}><input name="starts_at" type="datetime-local" required defaultValue={open === update ? localDate(state.scheduled.starts_at) : ''} /></Field>
        <Field label={t('endLocal')}><input name="ends_at" type="datetime-local" required defaultValue={open === update ? localDate(state.scheduled.ends_at) : ''} /></Field>
      </>}
      <Field label={translate('manager.tournamentLive.reason.label')}><textarea name="reason" minLength={12} maxLength={500} required rows={3} /></Field>
      <p>{t(open === cancel ? 'cancelHelp' : 'queueRule')}</p>
    </FormDialog>}
  </section>;
}
