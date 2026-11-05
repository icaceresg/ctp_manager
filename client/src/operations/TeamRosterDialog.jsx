import { useCallback, useEffect, useRef, useState } from 'react';
import { Crown, RefreshCw, Search, Trash2, UserMinus, UserPlus } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Modal } from '../components/ui.jsx';
import { Field } from './ui.jsx';
import { getIntlLocale, translate } from '../i18n/runtime.js';

const KEY_PREFIX = 'manager.teamRoster.';
/** Server errors arrive as `manager.teamRoster.error.*` keys; other failures keep their message. */
export function teamRosterError(cause) {
  const message = cause?.message;
  if (typeof message === 'string' && message.startsWith(KEY_PREFIX)) {
    try { return translate(message); } catch { /* Unknown key: fall through to the generic copy. */ }
  }
  return message || translate('manager.teamRoster.error.unavailable');
}
export const teamRoleLabel = role => translate(`manager.teamRoster.role.${['lider', 'jugador', 'suplente'].includes(role) ? role : 'jugador'}`);
const day = value => { try { return new Intl.DateTimeFormat(getIntlLocale(), { dateStyle: 'medium' }).format(new Date(value)); } catch { return ''; } };

/** Every roster action a club manager has in CTP, applied by CTP administration with an audited reason. */
export default function TeamRosterDialog({ club, onClose, onChanged }) {
  const { toast } = useApp();
  const [roster, setRoster] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [confirming, setConfirming] = useState(null);
  const [heir, setHeir] = useState(''), [dissolveName, setDissolveName] = useState('');
  const serial = useRef(0);

  const load = useCallback(async () => {
    const request = ++serial.current;
    setLoading(true);
    try { const value = await api.get(`/administration/clubs/${encodeURIComponent(club.id)}/roster`); if (request === serial.current) { setRoster(value); setError(''); } }
    catch (cause) { if (request === serial.current) setError(teamRosterError(cause)); }
    finally { if (request === serial.current) setLoading(false); }
  }, [club.id]);
  useEffect(() => { void load(); return () => { ++serial.current; }; }, [load]);

  const reasonReady = reason.trim().length >= 12;
  async function run(body, success) {
    if (!roster || busy) return;
    if (!reasonReady) { setError(translate('manager.teamRoster.error.reason')); return; }
    setBusy(true); setError('');
    try {
      const result = await api.post(`/administration/clubs/${encodeURIComponent(club.id)}/roster`, { ...body, expected_revision: roster.revision, reason: reason.trim() });
      setConfirming(null); setHeir('');
      if (result.dissolved) { toast(translate('manager.teamRoster.toast.dissolved', { name: roster.team.name })); onChanged?.(); onClose(); return; }
      setRoster(result);
      toast(result.applied ? success : translate('manager.teamRoster.toast.unchanged'));
      onChanged?.();
    } catch (cause) {
      setError(teamRosterError(cause));
      if (cause?.status === 409) void load();
    } finally { setBusy(false); }
  }

  const members = roster?.members || [], requests = roster?.requests || [];
  const leaders = members.filter(member => member.role === 'lider');
  const full = members.length >= (roster?.max_members || 6);
  const disabled = busy || loading || !roster;
  const name = member => member.username;

  return <Modal size="xl" title={translate('manager.teamRoster.title', { name: roster?.team.name || club.name })} onClose={busy ? undefined : onClose} closeLabel={translate('manager.teamRoster.close')}
    headerExtra={<button type="button" className="btn" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={14} /> {translate('manager.teamRoster.refresh')}</button>}>
    <div className="op-roster">
      <p className="op-help">{translate('manager.teamRoster.help')}</p>
      {roster && <p><strong>{roster.team.name}</strong> · {roster.team.tag} · {translate('manager.teamRoster.count', { count: members.length, max: roster.max_members })}
        {leaders.length > 0 && <> · {translate('manager.teamRoster.currentManager', { name: leaders.map(name).join(', ') })}</>}</p>}
      {loading && !roster && <p role="status">{translate('manager.teamRoster.loading')}</p>}
      {error && <p className="op-error" role="alert">{error}</p>}

      <Field label={translate('manager.teamRoster.reason')} hint={translate('manager.teamRoster.reasonHint')}>
        <textarea value={reason} onChange={event => setReason(event.target.value)} minLength={12} maxLength={500} rows={2} disabled={busy} />
      </Field>

      {roster && <>
        <section aria-labelledby="roster-members">
          <h3 id="roster-members">{translate('manager.teamRoster.members')}</h3>
          {!members.length ? <p className="muted">{translate('manager.teamRoster.noMembers')}</p> :
            <div className="op-table-wrap"><table className="op-table"><thead><tr>
              <th scope="col">{translate('manager.teamRoster.player')}</th><th scope="col">{translate('manager.teamRoster.roleColumn')}</th>
              <th scope="col">{translate('manager.teamRoster.joined')}</th><th scope="col">{translate('manager.teamRoster.actions')}</th>
            </tr></thead><tbody>{members.map(member => {
              const isLeader = member.role === 'lider';
              const soleLeader = isLeader && leaders.length === 1;
              const others = members.filter(other => other.user_id !== member.user_id);
              return <tr key={member.user_id}>
                <td><strong>{member.username}</strong></td>
                <td>{isLeader ? <span className="op-roster-leader"><Crown size={13} /> {teamRoleLabel('lider')}</span>
                  : <select aria-label={translate('manager.teamRoster.roleFor', { name: member.username })} value={member.role} disabled={disabled}
                    onChange={event => void run({ action: 'set_role', user_id: member.user_id, role: event.target.value }, translate('manager.teamRoster.toast.role', { name: member.username }))}>
                    <option value="jugador">{teamRoleLabel('jugador')}</option><option value="suplente">{teamRoleLabel('suplente')}</option>
                  </select>}</td>
                <td>{day(member.joined_at)}</td>
                <td><div className="op-actions">
                  {!soleLeader && <button type="button" className="btn" disabled={disabled} onClick={() => setConfirming({ kind: 'transfer', member })}><Crown size={14} /> {translate('manager.teamRoster.makeManager')}</button>}
                  <button type="button" className="btn danger" disabled={disabled || soleLeader && !others.length} title={soleLeader && !others.length ? translate('manager.teamRoster.lastMemberHint') : undefined}
                    onClick={() => { setHeir(''); setConfirming({ kind: 'remove', member, needsHeir: soleLeader }); }}><UserMinus size={14} /> {translate('manager.teamRoster.remove')}</button>
                </div></td>
              </tr>;
            })}</tbody></table></div>}
          {confirming && <div className="op-notice op-roster-confirm" role="group" aria-label={translate('manager.teamRoster.confirmTitle')}>
            {confirming.kind === 'transfer' && <p>{translate('manager.teamRoster.confirmTransfer', { name: confirming.member.username })}</p>}
            {confirming.kind === 'remove' && <p>{translate('manager.teamRoster.confirmRemove', { name: confirming.member.username })}</p>}
            {confirming.kind === 'move' && <p>{translate('manager.teamRoster.confirmMove', { name: confirming.candidate.username, from: confirming.candidate.team_name, to: roster.team.name })}</p>}
            {confirming.kind === 'remove' && confirming.needsHeir && <Field label={translate('manager.teamRoster.heir')} hint={translate('manager.teamRoster.heirHint')}>
              <select value={heir} onChange={event => setHeir(event.target.value)} disabled={busy}>
                <option value="">{translate('manager.teamRoster.chooseHeir')}</option>
                {members.filter(member => member.user_id !== confirming.member.user_id).map(member => <option key={member.user_id} value={member.user_id}>{member.username}</option>)}
              </select></Field>}
            <div className="op-actions">
              <button type="button" className={`btn ${confirming.kind === 'remove' ? 'danger' : 'primary'}`} disabled={busy || !reasonReady || confirming.needsHeir && !heir} onClick={() => {
                if (confirming.kind === 'transfer') void run({ action: 'transfer', user_id: confirming.member.user_id }, translate('manager.teamRoster.toast.transfer', { name: confirming.member.username }));
                if (confirming.kind === 'remove') void run({ action: 'remove', user_id: confirming.member.user_id, ...(confirming.needsHeir ? { new_leader_id: heir } : {}) }, translate('manager.teamRoster.toast.removed', { name: confirming.member.username }));
                if (confirming.kind === 'move') void run({ action: 'add', user_id: confirming.candidate.id, role: confirming.role, move: true }, translate('manager.teamRoster.toast.moved', { name: confirming.candidate.username }));
              }}>{translate('manager.teamRoster.confirm')}</button>
              <button type="button" className="btn" disabled={busy} onClick={() => setConfirming(null)}>{translate('manager.teamRoster.cancel')}</button>
            </div>
            {!reasonReady && <p className="muted">{translate('manager.teamRoster.reasonFirst')}</p>}
          </div>}
        </section>

        <AddPlayer disabled={disabled} full={full} teamId={roster.team.id} memberIds={members.map(member => member.user_id)}
          pendingIds={requests.map(request => request.user_id)}
          onAdd={(candidate, role) => void run({ action: 'add', user_id: candidate.id, role }, translate('manager.teamRoster.toast.added', { name: candidate.username }))}
          onMove={(candidate, role) => setConfirming({ kind: 'move', candidate, role })}
          onInvite={candidate => void run({ action: 'invite', user_id: candidate.id }, translate('manager.teamRoster.toast.invited', { name: candidate.username }))} />

        <section aria-labelledby="roster-requests">
          <h3 id="roster-requests">{translate('manager.teamRoster.requests')}</h3>
          {!requests.length ? <p className="muted">{translate('manager.teamRoster.noRequests')}</p> : <ul className="op-roster-list">{requests.map(request => <li key={request.id}>
            <span><strong>{request.username}</strong> · {translate(request.kind === 'invitacion' ? 'manager.teamRoster.kind.invitation' : 'manager.teamRoster.kind.application')} · {day(request.created_at)}</span>
            <span className="op-actions">
              <button type="button" className="btn primary" disabled={disabled || full} onClick={() => void run({ action: 'resolve_request', request_id: request.id, accept: true }, translate('manager.teamRoster.toast.accepted', { name: request.username }))}>{translate(request.kind === 'invitacion' ? 'manager.teamRoster.acceptInvitation' : 'manager.teamRoster.accept')}</button>
              <button type="button" className="btn" disabled={disabled} onClick={() => void run({ action: 'resolve_request', request_id: request.id, accept: false }, translate('manager.teamRoster.toast.rejected', { name: request.username }))}>{translate(request.kind === 'invitacion' ? 'manager.teamRoster.cancelInvitation' : 'manager.teamRoster.reject')}</button>
            </span>
          </li>)}</ul>}
        </section>

        <section className="op-roster-danger" aria-labelledby="roster-dissolve">
          <h3 id="roster-dissolve">{translate('manager.teamRoster.dissolveTitle')}</h3>
          <p>{translate('manager.teamRoster.dissolveHelp')}</p>
          <Field label={translate('manager.teamRoster.dissolveConfirm', { name: roster.team.name })}>
            <input value={dissolveName} onChange={event => setDissolveName(event.target.value)} autoComplete="off" spellCheck={false} maxLength={100} disabled={busy} />
          </Field>
          <button type="button" className="btn danger" disabled={disabled || !reasonReady || dissolveName.trim() !== roster.team.name}
            onClick={() => void run({ action: 'dissolve', confirm_name: dissolveName.trim() }, '')}><Trash2 size={14} /> {translate('manager.teamRoster.dissolve')}</button>
        </section>
      </>}
    </div>
  </Modal>;
}

function AddPlayer({ disabled, full, teamId, memberIds, pendingIds, onAdd, onMove, onInvite }) {
  const [query, setQuery] = useState(''), [rows, setRows] = useState([]), [searching, setSearching] = useState(false), [error, setError] = useState('');
  const [role, setRole] = useState('jugador');
  const serial = useRef(0);
  useEffect(() => {
    const request = ++serial.current, controller = new AbortController();
    setRows([]); setError('');
    if (query.trim().length < 3) { setSearching(false); return () => controller.abort(); }
    setSearching(true);
    const timer = setTimeout(() => void api.get(`/administration/team-roster/candidates?query=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
      .then(result => { if (request === serial.current) setRows(result.items); })
      .catch(cause => { if (request === serial.current && cause.name !== 'AbortError') setError(teamRosterError(cause)); })
      .finally(() => { if (request === serial.current) setSearching(false); }), 300);
    return () => { ++serial.current; clearTimeout(timer); controller.abort(); };
  }, [query]);
  return <section aria-labelledby="roster-add">
    <h3 id="roster-add">{translate('manager.teamRoster.addTitle')}</h3>
    {full && <p className="op-notice">{translate('manager.teamRoster.fullNotice')}</p>}
    <div className="op-form-grid">
      <Field label={translate('manager.teamRoster.search')}><div className="op-actions"><Search size={15} /><input value={query} maxLength={40} onChange={event => setQuery(event.target.value)}
        aria-label={translate('manager.teamRoster.search')} placeholder={translate('manager.teamRoster.searchPlaceholder')} /></div></Field>
      <Field label={translate('manager.teamRoster.addAs')}><select value={role} onChange={event => setRole(event.target.value)}>
        <option value="jugador">{teamRoleLabel('jugador')}</option><option value="suplente">{teamRoleLabel('suplente')}</option></select></Field>
    </div>
    {searching && <p role="status">{translate('manager.teamRoster.searching')}</p>}
    {error && <p className="op-error" role="alert">{error}</p>}
    {!searching && !error && query.trim().length >= 3 && !rows.length && <p className="muted">{translate('manager.teamRoster.noCandidates')}</p>}
    {rows.length > 0 && <ul className="op-roster-list">{rows.map(row => {
      const here = row.team_id === teamId || memberIds.includes(row.id);
      return <li key={row.id}>
        <span><strong>{row.username}</strong> · {here ? translate('manager.teamRoster.alreadyHere')
          : row.team_id ? translate('manager.teamRoster.inTeam', { team: row.team_name, role: teamRoleLabel(row.team_role) }) : translate('manager.teamRoster.free')}</span>
        {!here && <span className="op-actions">
          {row.team_id
            ? <button type="button" className="btn" disabled={disabled || full} onClick={() => onMove(row, role)}><UserPlus size={14} /> {translate('manager.teamRoster.moveHere')}</button>
            : <>
              <button type="button" className="btn primary" disabled={disabled || full} onClick={() => onAdd(row, role)}><UserPlus size={14} /> {translate('manager.teamRoster.addNow')}</button>
              <button type="button" className="btn" disabled={disabled || pendingIds.includes(row.id)} onClick={() => onInvite(row)}>{translate('manager.teamRoster.invite')}</button>
            </>}
        </span>}
      </li>;
    })}</ul>}
  </section>;
}
