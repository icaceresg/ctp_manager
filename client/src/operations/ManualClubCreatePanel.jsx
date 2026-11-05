import { useEffect, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Field, FormDialog } from './ui.jsx';
import { canSendCommand } from './model.js';
import { translate } from '../i18n/runtime.js';

const clubCreateError = cause => cause?.status ? cause.message : translate('manager.clubCreate.failed');

/** A registered account may lead one club. Other clubs require another account. */
export function ManualClubCreatePanel({ data, me, reload, mutate }) {
  const { toast } = useApp();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!me?.is_admin) return null;
  const supported = data.connection?.supported_actions?.includes('club.create');
  const pending = (data.commands || []).filter(command => command.type === 'club.create' && ['pending', 'failed', 'rejected', 'sending'].includes(command.status));
  const retired = pending.filter(command => !command.payload.leader_id || Object.hasOwn(command.payload, 'administrator_id'));
  const commands = pending.filter(command => !retired.includes(command));
  async function send(command) {
    setBusy(true); setError('');
    try { await api.post(`/operations/integration/commands/${command.id}/send`, {}); toast(translate('manager.clubCreate.created')); await reload(); }
    catch (cause) { setError(clubCreateError(cause)); } finally { setBusy(false); }
  }
  async function create(payload) {
    let command;
    try { ({command}=await api.post('/operations/clubs/create', { type: 'club.create', payload })); }
    catch (cause) { throw new Error(clubCreateError(cause)); }
    setError('');
    try { await api.post(`/operations/integration/commands/${command.id}/send`, {}); toast(translate('manager.clubCreate.createdNamed', {name:payload.name})); }
    catch (cause) { setError(translate('manager.clubCreate.createUnconfirmed', {name:payload.name,detail:clubCreateError(cause)})); }
    await reload();
  }
  return <section className="op-card"><div className="op-section-title"><div><h2>{translate('manager.clubCreate.createTitle')}</h2><p>{translate('manager.clubCreate.createDescription')}</p></div><button className="btn primary" disabled={busy || !supported} onClick={() => setOpen(true)}><Plus size={15} /> {translate('manager.clubCreate.createTitle')}</button></div>
    {!supported && <p className="muted">{translate('manager.clubCreate.createUnavailable')}</p>}
    {error && <p className="op-error" role="alert">{error}</p>}
    {retired.map(command => <div className="op-notice" key={command.id}><strong>{command.payload.name}</strong><p>{translate('manager.clubCreate.retiredProposal')}</p>{(command.status === 'pending' && command.attempts === 0 || command.status === 'rejected' && command.attempts === 1 && command.result?.rejected_confirmed) && <button className="btn" disabled={busy} onClick={() => void mutate('post', `/commands/${command.id}/cancel`, { expected_updated_at: command.updated_at }, translate('manager.clubCreate.discarded'))}>{translate('manager.clubCreate.discard')}</button>}</div>)}
    {commands.map(command => <div className="op-notice" key={command.id}><strong>{translate('manager.clubCreate.pendingCreation', {name:command.payload.name,tag:command.payload.tag})}</strong><p>{command.payload.reason}</p>{command.last_error && <p>{command.last_error}</p>}<div className="op-actions"><button className="btn gold" disabled={busy || !canSendCommand(command, data.connection?.write_enabled, supported)} onClick={() => void send(command)}>{translate('manager.clubCreate.createSubmit')}</button>{(command.status === 'pending' && command.attempts === 0 || command.status === 'rejected' && command.attempts === 1 && command.result?.rejected_confirmed) && <button className="btn" disabled={busy} onClick={() => void mutate('post', `/commands/${command.id}/cancel`, { expected_updated_at: command.updated_at }, translate('manager.clubCreate.discarded'))}>{translate('manager.clubCreate.discard')}</button>}</div></div>)}
    {open && <CreateClubForm onClose={() => setOpen(false)} submit={create} />}
  </section>;
}
export function CreateClubForm({ onClose, submit }) {
  const [query, setQuery] = useState(''), [manager, setManager] = useState(null), [candidates, setCandidates] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const serial = useRef(0);
  useEffect(() => {
    const request = ++serial.current, controller=new AbortController(); setCandidates([]); setError('');
    if (query.trim().length < 3 || manager) { setBusy(false); return; }
    setBusy(true); const timer = setTimeout(() => {
      const path=`/operations/clubs/candidates?query=${encodeURIComponent(query.trim())}`;
      void api.get(path,{signal:controller.signal}).then(result => { if (request === serial.current) setCandidates(result); }).catch(cause => { if (request === serial.current && cause.name!=='AbortError') setError(clubCreateError(cause)); }).finally(() => { if (request === serial.current) setBusy(false); });
    }, 300);
    return () => { ++serial.current; controller.abort(); clearTimeout(timer); };
  }, [query, manager]);
  return <FormDialog title={translate('manager.clubCreate.createTitle')} onClose={onClose} submitLabel={translate('manager.clubCreate.createSubmit')} cancelLabel={translate('manager.clubCreate.cancel')} closeLabel={translate('manager.clubCreate.close')} help={translate('manager.clubCreate.help')} submit={async input => {
    if (!manager) throw new Error(translate('manager.clubCreate.selectResponsible'));
    await submit({ name: input.name.trim(), tag: input.tag.trim().toUpperCase(), leader_id:manager.id, reason:input.reason });
  }}><Field label={translate('manager.clubCreate.clubName')}><input name="name" required minLength={3} maxLength={24} /></Field><Field label={translate('manager.clubCreate.tag')} hint={translate('manager.clubCreate.tagHint')}><input name="tag" required minLength={2} maxLength={8} pattern="[A-Za-z0-9]{2,8}" /></Field>
    <Field label={translate('manager.clubCreate.responsible')}><div className="op-actions"><Search size={15} /><input aria-label={translate('manager.clubCreate.searchLabel')} value={query} maxLength={40} onChange={event => { setQuery(event.target.value); setManager(null); }} placeholder={translate('manager.clubCreate.searchPlaceholder')} /></div></Field>
    {busy && <p role="status">{translate('manager.clubCreate.searching')}</p>}{error && <p className="op-error" role="alert">{error}</p>}
    {manager ? <p className="op-notice">{translate('manager.clubCreate.selectedResponsible', {name:manager.username})}</p> : <div className="op-actions">{candidates.map(candidate => <button type="button" className="btn" key={candidate.id} onClick={() => { setManager(candidate); setQuery(candidate.username); }}>{candidate.username}</button>)}</div>}
    {!busy && !manager && query.trim().length >= 3 && !candidates.length && !error && <p className="muted">{translate('manager.clubCreate.noCompetitiveCandidates')}</p>}
    <Field label={translate('manager.clubCreate.reason')}><textarea name="reason" required minLength={12} maxLength={500} rows={3} /></Field>
  </FormDialog>;
}
