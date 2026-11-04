import { useEffect, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Field, FormDialog } from './ui.jsx';
import { canSendCommand } from './model.js';
import { translate } from '../i18n/runtime.js';
import { teamAdminError } from './teamAdministrators.js';

/** A responsible administrator is not inserted into a competitive roster. */
export function ManualClubCreatePanel({ data, me, reload, mutate }) {
  const { toast } = useApp();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!me?.is_admin) return null;
  const supported = data.connection?.supported_actions?.includes('club.create');
  const commands = (data.commands || []).filter(command => command.type === 'club.create' && ['pending', 'failed', 'rejected', 'sending'].includes(command.status));
  async function send(command) {
    setBusy(true); setError('');
    try { await api.post(`/operations/integration/commands/${command.id}/send`, {}); toast(translate('manager.teamAdmins.created')); await reload(); }
    catch (cause) { setError(teamAdminError(cause)); } finally { setBusy(false); }
  }
  async function create(payload) {
    let command;
    try { ({command}=await api.post('/operations/clubs/create', { type: 'club.create', payload })); }
    catch (cause) { throw new Error(teamAdminError(cause)); }
    setError('');
    try { await api.post(`/operations/integration/commands/${command.id}/send`, {}); toast(translate('manager.teamAdmins.createdNamed', {name:payload.name})); }
    catch (cause) { setError(translate('manager.teamAdmins.createUnconfirmed', {name:payload.name,detail:teamAdminError(cause)})); }
    await reload();
  }
  return <section className="op-card"><div className="op-section-title"><div><h2>{translate('manager.teamAdmins.createTitle')}</h2><p>{translate('manager.teamAdmins.createDescription')}</p></div><button className="btn primary" disabled={busy || !supported} onClick={() => setOpen(true)}><Plus size={15} /> {translate('manager.teamAdmins.createTitle')}</button></div>
    {!supported && <p className="muted">{translate('manager.teamAdmins.createUnavailable')}</p>}
    {error && <p className="op-error" role="alert">{error}</p>}
    {commands.map(command => <div className="op-notice" key={command.id}><strong>{translate('manager.teamAdmins.pendingCreation', {name:command.payload.name,tag:command.payload.tag})}</strong><p>{command.payload.reason}</p>{command.last_error && <p>{command.last_error}</p>}<div className="op-actions"><button className="btn gold" disabled={busy || !canSendCommand(command, data.connection?.write_enabled, supported)} onClick={() => void send(command)}>{translate('manager.teamAdmins.createSubmit')}</button>{(command.status === 'pending' && command.attempts === 0 || command.status === 'rejected' && command.attempts === 1 && command.result?.rejected_confirmed) && <button className="btn" disabled={busy} onClick={() => void mutate('post', `/commands/${command.id}/cancel`, { expected_updated_at: command.updated_at }, translate('manager.teamAdmins.discarded'))}>{translate('manager.teamAdmins.discard')}</button>}</div></div>)}
    {open && <CreateClubForm onClose={() => setOpen(false)} submit={create} />}
  </section>;
}
export function CreateClubForm({ onClose, submit }) {
  const [mode,setMode] = useState('administrative');
  const [query, setQuery] = useState(''), [manager, setManager] = useState(null), [candidates, setCandidates] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const serial = useRef(0);
  useEffect(() => {
    const request = ++serial.current, controller=new AbortController(); setCandidates([]); setError('');
    if (query.trim().length < 3 || manager) { setBusy(false); return; }
    setBusy(true); const timer = setTimeout(() => {
      const path=mode==='administrative'?`/administration/team-administrators/candidates?query=${encodeURIComponent(query.trim())}`:`/operations/clubs/candidates?query=${encodeURIComponent(query.trim())}`;
      void api.get(path,{signal:controller.signal}).then(result => { if (request === serial.current) setCandidates(mode==='administrative'?result.items.map(row=>({id:row.user_id,username:row.username})):result); }).catch(cause => { if (request === serial.current && cause.name!=='AbortError') setError(teamAdminError(cause)); }).finally(() => { if (request === serial.current) setBusy(false); });
    }, 300);
    return () => { ++serial.current; controller.abort(); clearTimeout(timer); };
  }, [query, manager, mode]);
  return <FormDialog title={translate('manager.teamAdmins.createTitle')} onClose={onClose} submitLabel={translate('manager.teamAdmins.createSubmit')} cancelLabel={translate('manager.teamAdmins.cancel')} closeLabel={translate('manager.teamAdmins.close')} help={translate(mode==='administrative'?'manager.teamAdmins.createAdminHelp':'manager.teamAdmins.createPlayerHelp')} submit={async input => {
    if (!manager) throw new Error(translate('manager.teamAdmins.selectResponsible'));
    await submit({ name: input.name.trim(), tag: input.tag.trim().toUpperCase(),
      ...(mode==='administrative'?{leader_id:null,administrator_id:manager.id}:{leader_id:manager.id}),reason:input.reason });
  }}><Field label={translate('manager.teamAdmins.clubName')}><input name="name" required minLength={3} maxLength={24} /></Field><Field label={translate('manager.teamAdmins.tag')} hint={translate('manager.teamAdmins.tagHint')}><input name="tag" required minLength={2} maxLength={8} pattern="[A-Za-z0-9]{2,8}" /></Field>
    <Field label={translate('manager.teamAdmins.responsibilityType')}><select value={mode} onChange={event=>{setMode(event.target.value);setQuery('');setManager(null);}}><option value="administrative">{translate('manager.teamAdmins.administrativeMode')}</option><option value="competitive">{translate('manager.teamAdmins.competitiveMode')}</option></select></Field>
    <Field label={translate('manager.teamAdmins.responsible')}><div className="op-actions"><Search size={15} /><input aria-label={translate('manager.teamAdmins.searchLabel')} value={query} maxLength={40} onChange={event => { setQuery(event.target.value); setManager(null); }} placeholder={translate('manager.teamAdmins.searchPlaceholder')} /></div></Field>
    {busy && <p role="status">{translate('manager.teamAdmins.searching')}</p>}{error && <p className="op-error" role="alert">{error}</p>}
    {manager ? <p className="op-notice">{translate('manager.teamAdmins.selectedResponsible', {name:manager.username})}</p> : <div className="op-actions">{candidates.map(candidate => <button type="button" className="btn" key={candidate.id} onClick={() => { setManager(candidate); setQuery(candidate.username); }}>{candidate.username}</button>)}</div>}
    {!busy && !manager && query.trim().length >= 3 && !candidates.length && !error && <p className="muted">{translate(mode==='administrative'?'manager.teamAdmins.noCandidates':'manager.teamAdmins.noCompetitiveCandidates')}</p>}
    <Field label={translate('manager.teamAdmins.reason')}><textarea name="reason" required minLength={12} maxLength={500} rows={3} /></Field>
  </FormDialog>;
}
