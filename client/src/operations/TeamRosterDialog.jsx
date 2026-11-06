import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Crown, Inbox, RefreshCw, Search, Settings2, ShieldAlert, Trash2, Upload, UserMinus, UserPlus, Users } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Modal } from '../components/ui.jsx';
import { Field } from './ui.jsx';
import { getIntlLocale, translate } from '../i18n/runtime.js';
import { prepareWebImage, WEB_IMAGE_SPECS } from '../webImageUpload.js';

const KEY_PREFIXES = ['manager.teamRoster.', 'manager.clubProfile.'];
/** Server errors arrive as translation keys; other failures keep their message. */
export function teamRosterError(cause) {
  const message = cause?.message;
  if (typeof message === 'string' && KEY_PREFIXES.some(prefix => message.startsWith(prefix))) {
    try { return translate(message); } catch { /* Unknown key: fall through to the generic copy. */ }
  }
  return message || translate('manager.teamRoster.error.unavailable');
}
export const teamRoleLabel = role => translate(`manager.teamRoster.role.${['lider', 'jugador', 'suplente'].includes(role) ? role : 'jugador'}`);
const day = value => { try { return new Intl.DateTimeFormat(getIntlLocale(), { dateStyle: 'medium' }).format(new Date(value)); } catch { return ''; } };
const names = list => { try { return new Intl.ListFormat(getIntlLocale(), { type: 'conjunction' }).format(list.map(member => member.username)); } catch { return list.map(member => member.username).join(', '); } };
const initialOf = name => [...name][0]?.toUpperCase() || '?';
// The audited reason is remembered for this browser session so a series of edits needs it once.
let rememberedReason = '';

/**
 * "Gestionar equipo": every action a club manager has in CTP plus the club profile,
 * applied by CTP administration. Roster changes ask for an audited reason in a
 * confirmation that states the consequences (other club, current manager…).
 */
export default function TeamRosterDialog({ club, onClose, onChanged }) {
  const { toast } = useApp();
  const [roster, setRoster] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [tab, setTab] = useState('roster'), [pending, setPending] = useState(null), [busy, setBusy] = useState(false);
  const serial = useRef(0);

  const load = useCallback(async () => {
    const request = ++serial.current;
    setLoading(true);
    try { const value = await api.get(`/administration/clubs/${encodeURIComponent(club.id)}/roster`); if (request === serial.current) { setRoster(value); setError(''); } }
    catch (cause) { if (request === serial.current) setError(teamRosterError(cause)); }
    finally { if (request === serial.current) setLoading(false); }
  }, [club.id]);
  useEffect(() => { void load(); return () => { ++serial.current; }; }, [load]);

  /** Runs one or more roster writes in order; each uses the revision returned by the previous one. */
  async function run(steps, reason, success) {
    let current = roster, result = null, applied = false;
    for (const step of steps) {
      result = await api.post(`/administration/clubs/${encodeURIComponent(club.id)}/roster`, { ...step, expected_revision: current.revision, reason });
      if (result.dissolved) break;
      current = result; applied = applied || result.applied;
      setRoster(result);
    }
    rememberedReason = reason;
    if (result?.dissolved) { toast(translate('manager.teamRoster.toast.dissolved', { name: roster.team.name })); onChanged?.(); onClose(); return; }
    toast(applied ? success : translate('manager.teamRoster.toast.unchanged'));
    onChanged?.();
  }
  async function confirm(reason, extra) {
    if (!pending || busy) return;
    setBusy(true);
    try { await run(pending.steps(extra), reason, pending.success); setPending(null); }
    catch (cause) { setPending(current => current && { ...current, error: teamRosterError(cause) }); if (cause?.status === 409) void load(); }
    finally { setBusy(false); }
  }

  const members = roster?.members || [], requests = roster?.requests || [];
  const leaders = members.filter(member => member.role === 'lider');
  const full = members.length >= (roster?.max_members || 6);
  const disabled = busy || loading || !roster;
  const ask = action => setPending({ ...action, error: '' });

  const actions = {
    makeManager: member => ask({
      title: translate('manager.teamAdmin.makeManagerTitle'), message: translate('manager.teamAdmin.makeManagerBody', { name: member.username }),
      warnings: leaders.length ? [translate('manager.teamAdmin.warn.hasManager', { name: names(leaders) })] : [],
      steps: () => [{ action: 'transfer', user_id: member.user_id }], success: translate('manager.teamRoster.toast.transfer', { name: member.username }),
    }),
    removeManager: member => ask({
      title: translate('manager.teamAdmin.removeManagerTitle'), message: translate('manager.teamAdmin.removeManagerBody', { name: member.username }),
      warnings: [translate('manager.teamAdmin.warn.managerRequired')],
      heir: { label: translate('manager.teamAdmin.newManager'), options: members.filter(other => other.user_id !== member.user_id) },
      steps: heir => [{ action: 'transfer', user_id: heir }], success: translate('manager.teamAdmin.toast.managerRemoved', { name: member.username }),
    }),
    kick: member => {
      const soleLeader = member.role === 'lider' && leaders.length === 1;
      ask({
        title: translate('manager.teamAdmin.kickTitle'), message: translate('manager.teamRoster.confirmRemove', { name: member.username }), danger: true,
        warnings: soleLeader ? [translate('manager.teamAdmin.warn.kickManager', { name: member.username })] : [],
        heir: soleLeader ? { label: translate('manager.teamRoster.heir'), options: members.filter(other => other.user_id !== member.user_id) } : null,
        steps: heir => [{ action: 'remove', user_id: member.user_id, ...(soleLeader ? { new_leader_id: heir } : {}) }],
        success: translate('manager.teamRoster.toast.removed', { name: member.username }), confirmLabel: translate('manager.teamAdmin.kick'),
      });
    },
    setRole: (member, role) => ask({
      title: translate('manager.teamAdmin.roleTitle'), message: translate('manager.teamAdmin.roleBody', { name: member.username, role: teamRoleLabel(role) }), warnings: [],
      steps: () => [{ action: 'set_role', user_id: member.user_id, role }], success: translate('manager.teamRoster.toast.role', { name: member.username }),
    }),
    add: (candidate, role) => {
      const warnings = [];
      if (candidate.team_id) warnings.push(translate('manager.teamAdmin.warn.inOtherTeam', { name: candidate.username, team: candidate.team_name, role: teamRoleLabel(candidate.team_role) }));
      if (candidate.team_id && candidate.team_role === 'lider') warnings.push(translate('manager.teamAdmin.warn.otherTeamManager', { team: candidate.team_name }));
      if (role === 'lider' && leaders.length) warnings.push(translate('manager.teamAdmin.warn.hasManager', { name: names(leaders) }));
      ask({
        title: translate(candidate.team_id ? 'manager.teamAdmin.moveTitle' : 'manager.teamAdmin.addTitle'),
        message: translate(candidate.team_id ? 'manager.teamAdmin.moveBody' : 'manager.teamAdmin.addBody',
          { name: candidate.username, from: candidate.team_name || '', to: roster.team.name, role: teamRoleLabel(role) }), warnings,
        steps: () => [{ action: 'add', user_id: candidate.id, role: role === 'lider' ? 'jugador' : role, ...(candidate.team_id ? { move: true } : {}) },
          ...(role === 'lider' ? [{ action: 'transfer', user_id: candidate.id }] : [])],
        success: translate(candidate.team_id ? 'manager.teamRoster.toast.moved' : 'manager.teamRoster.toast.added', { name: candidate.username }),
        confirmLabel: translate(candidate.team_id ? 'manager.teamAdmin.moveAnyway' : 'manager.teamAdmin.add'),
      });
    },
    invite: candidate => ask({
      title: translate('manager.teamAdmin.inviteTitle'), message: translate('manager.teamAdmin.inviteBody', { name: candidate.username, team: roster.team.name }), warnings: [],
      steps: () => [{ action: 'invite', user_id: candidate.id }], success: translate('manager.teamRoster.toast.invited', { name: candidate.username }),
    }),
    resolve: (request, accept) => ask({
      title: translate(accept ? 'manager.teamAdmin.acceptTitle' : 'manager.teamAdmin.rejectTitle'),
      message: translate(accept ? 'manager.teamAdmin.acceptBody' : 'manager.teamAdmin.rejectBody', { name: request.username }), warnings: [],
      steps: () => [{ action: 'resolve_request', request_id: request.id, accept }],
      success: translate(accept ? 'manager.teamRoster.toast.accepted' : 'manager.teamRoster.toast.rejected', { name: request.username }),
    }),
    dissolve: confirmName => ask({
      title: translate('manager.teamRoster.dissolveTitle'), message: translate('manager.teamRoster.dissolveHelp'), danger: true, warnings: [],
      steps: () => [{ action: 'dissolve', confirm_name: confirmName }], success: '', confirmLabel: translate('manager.teamRoster.dissolve'),
    }),
  };

  const tabs = [
    ['roster', Users, translate('manager.teamAdmin.tab.roster', { count: members.length, max: roster?.max_members || 6 })],
    ['profile', Settings2, translate('manager.teamAdmin.tab.profile')],
    ['requests', Inbox, translate('manager.teamAdmin.tab.requests', { count: requests.length })],
    ['danger', ShieldAlert, translate('manager.teamAdmin.tab.danger')],
  ];
  const logo = roster?.profile?.logo_url;

  return <Modal size="xl" title={translate('manager.teamAdmin.title', { name: roster?.team.name || club.name })} onClose={busy ? undefined : onClose} closeLabel={translate('manager.teamRoster.close')}
    headerExtra={<button type="button" className="btn" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={14} /> {translate('manager.teamRoster.refresh')}</button>}>
    <div className="op-roster ta-workspace">
      {loading && !roster && <p role="status">{translate('manager.teamRoster.loading')}</p>}
      {error && <p className="op-error" role="alert">{error}</p>}
      {roster && <>
        <header className="ta-summary">
          <div className="ta-logo" aria-hidden>{logo ? <img src={logo} alt="" /> : <span>{roster.team.tag}</span>}</div>
          <div className="ta-summary-text">
            <strong>{roster.team.name}</strong> <span className="muted">[{roster.team.tag}]</span>
            <div className="ta-chips">
              <span className="ta-chip">{translate('manager.teamRoster.count', { count: members.length, max: roster.max_members })}</span>
              {leaders.length ? <span className="ta-chip is-accent"><Crown size={13} aria-hidden /> {translate('manager.teamRoster.currentManager', { name: names(leaders) })}</span>
                : <span className="ta-chip is-warn"><AlertTriangle size={13} aria-hidden /> {translate('manager.teamAdmin.noManager')}</span>}
              {requests.length > 0 && <span className="ta-chip">{translate('manager.teamAdmin.pendingCount', { count: requests.length })}</span>}
            </div>
          </div>
        </header>
        <div className="ta-tabs" role="tablist" aria-label={translate('manager.teamAdmin.sections')}>
          {tabs.map(([id, Icon, label]) => <button key={id} type="button" role="tab" id={`ta-tab-${id}`} aria-selected={tab === id} aria-controls={`ta-panel-${id}`}
            className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={15} aria-hidden /> {label}</button>)}
        </div>

        <div role="tabpanel" id={`ta-panel-${tab}`} aria-labelledby={`ta-tab-${tab}`} className="op-roster">
          {tab === 'roster' && <RosterPanel members={members} leaders={leaders} full={full} disabled={disabled} actions={actions} roster={roster} requests={requests} />}
          {tab === 'profile' && <ProfilePanel roster={roster} onSaved={() => { void load(); onChanged?.(); }} />}
          {tab === 'requests' && <RequestsPanel requests={requests} full={full} disabled={disabled} actions={actions} />}
          {tab === 'danger' && <DangerPanel roster={roster} disabled={disabled} onDissolve={actions.dissolve} />}
        </div>
      </>}
    </div>
    {pending && <ConfirmAction action={pending} busy={busy} onCancel={() => setPending(null)} onConfirm={confirm} />}
  </Modal>;
}

function Person({ name, children }) {
  return <span className="ta-person"><span className="ta-avatar" aria-hidden>{initialOf(name)}</span><span><strong>{name}</strong>{children && <><br />{children}</>}</span></span>;
}

function RosterPanel({ members, leaders, full, disabled, actions, roster, requests }) {
  return <>
    <section className="ta-card" aria-labelledby="ta-manager">
      <h3 id="ta-manager"><Crown size={15} aria-hidden /> {translate('manager.teamAdmin.managerTitle')}</h3>
      <p className="muted">{translate('manager.teamAdmin.managerHelp')}</p>
      {leaders.length ? <ul className="ta-people">{leaders.map(member => <li key={member.user_id}>
        <Person name={member.username} />
        <span className="op-actions">
          <button type="button" className="btn" disabled={disabled || members.length < 2} title={members.length < 2 ? translate('manager.teamAdmin.onlyMemberHint') : undefined}
            onClick={() => actions.removeManager(member)}>{translate('manager.teamAdmin.removeManager')}</button>
        </span>
      </li>)}</ul> : <p className="ta-warning"><AlertTriangle size={15} aria-hidden /> {translate('manager.teamAdmin.noManagerHelp')}</p>}
    </section>

    <section aria-labelledby="ta-members">
      <h3 id="ta-members">{translate('manager.teamRoster.members')}</h3>
      {!members.length ? <p className="muted">{translate('manager.teamRoster.noMembers')}</p> : <ul className="ta-people">{members.map(member => {
        const isLeader = member.role === 'lider', soleLeader = isLeader && leaders.length === 1, alone = members.length === 1;
        return <li key={member.user_id}>
          <Person name={member.username}><small className="muted">{translate('manager.teamAdmin.joined', { date: day(member.joined_at) })}</small></Person>
          <span className="op-actions">
            {isLeader ? <span className="ta-chip is-accent"><Crown size={13} aria-hidden /> {teamRoleLabel('lider')}</span>
              : <select aria-label={translate('manager.teamRoster.roleFor', { name: member.username })} value={member.role} disabled={disabled}
                onChange={event => actions.setRole(member, event.target.value)}>
                <option value="jugador">{teamRoleLabel('jugador')}</option><option value="suplente">{teamRoleLabel('suplente')}</option>
              </select>}
            {!isLeader && <button type="button" className="btn" disabled={disabled} onClick={() => actions.makeManager(member)}><Crown size={14} aria-hidden /> {translate('manager.teamRoster.makeManager')}</button>}
            <button type="button" className="btn danger" disabled={disabled || soleLeader && alone} title={soleLeader && alone ? translate('manager.teamRoster.lastMemberHint') : undefined}
              onClick={() => actions.kick(member)}><UserMinus size={14} aria-hidden /> {translate('manager.teamAdmin.kick')}</button>
          </span>
        </li>;
      })}</ul>}
    </section>

    <AddPlayer disabled={disabled} full={full} teamId={roster.team.id} memberIds={members.map(member => member.user_id)}
      pendingIds={requests.map(request => request.user_id)} hasManager={leaders.length > 0} onAdd={actions.add} onInvite={actions.invite} />
  </>;
}

function AddPlayer({ disabled, full, teamId, memberIds, pendingIds, hasManager, onAdd, onInvite }) {
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
  return <section className="ta-card" aria-labelledby="roster-add">
    <h3 id="roster-add"><UserPlus size={15} aria-hidden /> {translate('manager.teamRoster.addTitle')}</h3>
    {full && <p className="ta-warning"><AlertTriangle size={15} aria-hidden /> {translate('manager.teamRoster.fullNotice')}</p>}
    <div className="op-form-grid">
      <Field label={translate('manager.teamRoster.search')}><span className="ta-search"><Search size={15} aria-hidden /><input value={query} maxLength={40} onChange={event => setQuery(event.target.value)}
        aria-label={translate('manager.teamRoster.search')} placeholder={translate('manager.teamRoster.searchPlaceholder')} /></span></Field>
      <Field label={translate('manager.teamRoster.addAs')} hint={role === 'lider' && hasManager ? translate('manager.teamAdmin.addAsManagerHint') : undefined}>
        <select value={role} onChange={event => setRole(event.target.value)}>
          <option value="jugador">{teamRoleLabel('jugador')}</option><option value="suplente">{teamRoleLabel('suplente')}</option><option value="lider">{teamRoleLabel('lider')}</option>
        </select></Field>
    </div>
    {searching && <p role="status">{translate('manager.teamRoster.searching')}</p>}
    {error && <p className="op-error" role="alert">{error}</p>}
    {!searching && !error && query.trim().length >= 3 && !rows.length && <p className="muted">{translate('manager.teamRoster.noCandidates')}</p>}
    {rows.length > 0 && <ul className="ta-people">{rows.map(row => {
      const here = row.team_id === teamId || memberIds.includes(row.id), invited = pendingIds.includes(row.id);
      return <li key={row.id} className={row.team_id && !here ? 'is-warn' : undefined}>
        <Person name={row.username}>
          {here ? <small className="muted">{translate('manager.teamAdmin.status.here')}</small>
            : row.team_id ? <small className="ta-warn-text"><AlertTriangle size={12} aria-hidden /> {translate('manager.teamAdmin.status.inTeam', { team: row.team_name, role: teamRoleLabel(row.team_role) })}</small>
              : <small className="ta-ok-text">{translate('manager.teamAdmin.status.free')}</small>}
        </Person>
        {!here && <span className="op-actions">
          {row.team_id
            ? <button type="button" className="btn" disabled={disabled || full} onClick={() => onAdd(row, role)}><UserPlus size={14} aria-hidden /> {translate('manager.teamRoster.moveHere')}</button>
            : <>
              <button type="button" className="btn primary" disabled={disabled || full} onClick={() => onAdd(row, role)}><UserPlus size={14} aria-hidden /> {translate('manager.teamAdmin.add')}</button>
              <button type="button" className="btn" disabled={disabled || invited} title={invited ? translate('manager.teamRoster.error.requestPending') : undefined} onClick={() => onInvite(row)}>{translate('manager.teamRoster.invite')}</button>
            </>}
        </span>}
      </li>;
    })}</ul>}
  </section>;
}

function RequestsPanel({ requests, full, disabled, actions }) {
  return <section aria-labelledby="roster-requests">
    <h3 id="roster-requests">{translate('manager.teamRoster.requests')}</h3>
    <p className="muted">{translate('manager.teamAdmin.requestsHelp')}</p>
    {full && requests.length > 0 && <p className="ta-warning"><AlertTriangle size={15} aria-hidden /> {translate('manager.teamRoster.fullNotice')}</p>}
    {!requests.length ? <p className="muted">{translate('manager.teamRoster.noRequests')}</p> : <ul className="ta-people">{requests.map(request => <li key={request.id}>
      <Person name={request.username}><small className="muted">{translate(request.kind === 'invitacion' ? 'manager.teamRoster.kind.invitation' : 'manager.teamRoster.kind.application')} · {day(request.created_at)}</small></Person>
      <span className="op-actions">
        <button type="button" className="btn primary" disabled={disabled || full} onClick={() => actions.resolve(request, true)}>{translate(request.kind === 'invitacion' ? 'manager.teamRoster.acceptInvitation' : 'manager.teamRoster.accept')}</button>
        <button type="button" className="btn" disabled={disabled} onClick={() => actions.resolve(request, false)}>{translate(request.kind === 'invitacion' ? 'manager.teamRoster.cancelInvitation' : 'manager.teamRoster.reject')}</button>
      </span>
    </li>)}</ul>}
  </section>;
}

function DangerPanel({ roster, disabled, onDissolve }) {
  const [typed, setTyped] = useState('');
  return <section className="op-roster-danger" aria-labelledby="roster-dissolve">
    <h3 id="roster-dissolve"><Trash2 size={15} aria-hidden /> {translate('manager.teamRoster.dissolveTitle')}</h3>
    <p>{translate('manager.teamRoster.dissolveHelp')}</p>
    <Field label={translate('manager.teamRoster.dissolveConfirm', { name: roster.team.name })}>
      <input value={typed} onChange={event => setTyped(event.target.value)} autoComplete="off" spellCheck={false} maxLength={100} disabled={disabled} />
    </Field>
    <div><button type="button" className="btn danger" disabled={disabled || typed.trim() !== roster.team.name} onClick={() => onDissolve(typed.trim())}>
      <Trash2 size={14} aria-hidden /> {translate('manager.teamRoster.dissolve')}</button></div>
  </section>;
}

/** One confirmation for every roster write: what happens, the warnings, an optional new manager and the audited reason. */
function ConfirmAction({ action, busy, onCancel, onConfirm }) {
  const [reason, setReason] = useState(rememberedReason), [heir, setHeir] = useState('');
  const trimmed = reason.trim().length;
  const ready = trimmed >= 12 && trimmed <= 500 && (!action.heir || heir);
  return <Modal title={action.title} onClose={busy ? undefined : onCancel} closeLabel={translate('manager.teamRoster.cancel')}>
    <form className="op-roster" onSubmit={event => { event.preventDefault(); if (ready && !busy) void onConfirm(reason.trim(), heir); }}>
      <p>{action.message}</p>
      {action.warnings.map(warning => <p key={warning} className="ta-warning" role="note"><AlertTriangle size={15} aria-hidden /> {warning}</p>)}
      {action.heir && (action.heir.options.length ? <Field label={action.heir.label} hint={translate('manager.teamRoster.heirHint')}>
        <select value={heir} onChange={event => setHeir(event.target.value)} disabled={busy} required>
          <option value="">{translate('manager.teamRoster.chooseHeir')}</option>
          {action.heir.options.map(member => <option key={member.user_id} value={member.user_id}>{member.username}</option>)}
        </select></Field> : <p className="op-error">{translate('manager.teamAdmin.onlyMemberHint')}</p>)}
      <Field label={translate('manager.teamRoster.reason')} hint={translate('manager.teamAdmin.reasonHint', { count: trimmed })}>
        <textarea value={reason} onChange={event => setReason(event.target.value)} minLength={12} maxLength={500} rows={2} disabled={busy} required autoFocus />
      </Field>
      {action.error && <p className="op-error" role="alert">{action.error}</p>}
      <div className="op-actions">
        <button type="submit" className={`btn ${action.danger ? 'danger' : 'primary'}`} disabled={busy || !ready}>{busy ? translate('manager.teamAdmin.applying') : action.confirmLabel || translate('manager.teamRoster.confirm')}</button>
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>{translate('manager.teamRoster.cancel')}</button>
      </div>
    </form>
  </Modal>;
}

const COLOR = /^#[0-9A-Fa-f]{6}$/;
const PROFILE_TEXT = ['name', 'tag', 'description', 'tagline', 'primary_color', 'secondary_color'];
const normal = (key, value) => key === 'tag' || key.endsWith('_color') ? value.trim().toUpperCase() : value.trim();

/** Name, tag, description and club page identity. Saves only what changed, with the version read. */
function ProfilePanel({ roster, onSaved }) {
  const { toast } = useApp();
  const profile = roster.profile;
  const initial = useCallback(() => ({ name: roster.team.name, tag: roster.team.tag, description: profile?.description ?? '', tagline: profile?.tagline ?? '',
    primary_color: profile?.primary_color ?? '#D4A843', secondary_color: profile?.secondary_color ?? '#F5F1E8' }), [roster, profile]);
  const [form, setForm] = useState(initial), [images, setImages] = useState({}), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [legacyVersion, setLegacyVersion] = useState(null);
  useEffect(() => { setForm(initial()); setImages({}); }, [initial]);
  // Before CTP 372 the roster carries no profile: read the club version to keep name and tag editable.
  useEffect(() => {
    if (profile) return undefined;
    let active = true;
    api.get(`/administration?${new URLSearchParams({ resource: 'team', target_id: roster.team.id })}`)
      .then(result => { const row = result.items?.find(item => item.id === roster.team.id); if (active) setLegacyVersion(row?.manager_version ?? null); })
      .catch(cause => { if (active) setError(teamRosterError(cause)); });
    return () => { active = false; };
  }, [profile, roster.team.id]);
  const version = profile?.manager_version ?? legacyVersion;
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const base = initial();
  const changes = {};
  for (const key of profile ? PROFILE_TEXT : ['name', 'tag']) if (normal(key, form[key]) !== normal(key, base[key])) changes[key] = normal(key, form[key]);
  for (const [key, value] of Object.entries(images)) changes[key] = value === null ? null : value.path;
  const dirty = Object.keys(changes).length > 0;
  const setImage = key => value => setImages(current => { const next = { ...current }; if (value === undefined) delete next[key]; else next[key] = value; return next; });

  async function save(event) {
    event.preventDefault();
    if (!dirty || busy || !version) return;
    setBusy(true); setError('');
    try {
      const result = await api.patch(`/administration/clubs/${encodeURIComponent(roster.team.id)}`, { expected_version: version, changes });
      toast(result.changed?.length ? translate('manager.teamAdmin.toast.profileSaved', { name: result.name }) : translate('manager.teamRoster.toast.unchanged'));
      onSaved();
    } catch (cause) { setError(teamRosterError(cause)); if (cause?.status === 409) onSaved(); }
    finally { setBusy(false); }
  }

  return <form className="op-roster" onSubmit={save}>
    <p className="muted">{translate('manager.teamAdmin.profileHelp')}</p>
    <section className="ta-card" aria-labelledby="ta-identity">
      <h3 id="ta-identity">{translate('manager.teamAdmin.identity')}</h3>
      <div className="op-form-grid">
        <Field label={translate('manager.teamAdmin.name')} hint={translate('manager.teamAdmin.nameHint')}>
          <input value={form.name} onChange={event => set('name', event.target.value)} required minLength={3} maxLength={24} disabled={busy} /></Field>
        <Field label={translate('manager.teamAdmin.tag')} hint={translate('manager.teamAdmin.tagHint')}>
          <input value={form.tag} onChange={event => set('tag', event.target.value.toUpperCase())} required minLength={2} maxLength={8} pattern="[A-Za-z0-9]{2,8}" disabled={busy} /></Field>
      </div>
      {profile && <Field label={translate('manager.teamAdmin.description')} hint={translate('manager.teamAdmin.charCount', { count: [...form.description].length, max: 2000 })}>
        <textarea value={form.description} onChange={event => set('description', event.target.value)} maxLength={2000} rows={4} disabled={busy} /></Field>}
    </section>

    {profile ? <section className="ta-card" aria-labelledby="ta-page">
      <h3 id="ta-page">{translate('manager.teamAdmin.page')}</h3>
      {!['team_pass', 'semi_team_pass'].includes(profile.program) && <p className="ta-warning" role="note"><AlertTriangle size={15} aria-hidden /> {translate('manager.teamAdmin.pageProgramNotice')}</p>}
      <div className="ta-images">
        <ImagePicker kind="logo" teamId={roster.team.id} label={translate('manager.teamAdmin.logo')} hint={translate('manager.images.logoHint')} accept="image/png"
          current={profile.logo_url} hasCurrent={profile.has_logo} value={images.logo_path} disabled={busy} onChange={setImage('logo_path')} />
        <ImagePicker kind="cover" teamId={roster.team.id} label={translate('manager.teamAdmin.cover')} hint={translate('manager.images.coverHint')} accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif"
          current={profile.cover_url} hasCurrent={profile.has_cover} value={images.cover_path} disabled={busy} onChange={setImage('cover_path')} />
      </div>
      <Field label={translate('manager.teamAdmin.tagline')} hint={translate('manager.teamAdmin.charCount', { count: [...form.tagline].length, max: 80 })}>
        <input value={form.tagline} onChange={event => set('tagline', event.target.value)} maxLength={80} disabled={busy} /></Field>
      <div className="op-form-grid">
        {['primary_color', 'secondary_color'].map(key => {
          const label = translate(key === 'primary_color' ? 'manager.teamAdmin.primaryColor' : 'manager.teamAdmin.secondaryColor');
          return <Field key={key} label={label}><span className="ta-color">
            <input type="color" value={COLOR.test(form[key]) ? form[key].toLowerCase() : '#000000'} onChange={event => set(key, event.target.value.toUpperCase())} disabled={busy} aria-label={label} />
            <input value={form[key]} onChange={event => set(key, event.target.value)} maxLength={7} pattern="#[0-9A-Fa-f]{6}" disabled={busy} aria-label={label} />
          </span></Field>;
        })}
      </div>
    </section> : <p className="ta-warning" role="note"><AlertTriangle size={15} aria-hidden /> {translate('manager.teamAdmin.profileUnavailable')}</p>}

    {error && <p className="op-error" role="alert">{error}</p>}
    <div className="op-actions">
      <button type="submit" className="btn primary" disabled={busy || !dirty || !version}>{busy ? translate('manager.teamAdmin.saving') : translate('manager.teamAdmin.save')}</button>
      <button type="button" className="btn" disabled={busy || !dirty} onClick={() => { setForm(initial()); setImages({}); setError(''); }}>{translate('manager.teamAdmin.discard')}</button>
      {dirty && <small className="muted">{translate('manager.teamAdmin.unsaved')}</small>}
    </div>
  </form>;
}

/** Uploads through the validated club image relay; the path is saved with the profile. */
function ImagePicker({ kind, teamId, label, hint, accept, current, hasCurrent, value, disabled, onChange }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const shown = value === undefined ? current : value?.url ?? null;
  const present = value === undefined ? hasCurrent : value !== null;
  async function pick(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setBusy(true); setError('');
    try {
      const prepared = await prepareWebImage(file, WEB_IMAGE_SPECS[kind]);
      const result = await api.post('/administration/web-publication/upload', { team_id: teamId, kind, content_type: prepared.contentType, base64: prepared.base64, request_id: crypto.randomUUID() });
      onChange({ path: result.path, url: result.url || URL.createObjectURL(prepared.blob) });
    } catch (cause) { setError(teamRosterError(cause)); } finally { setBusy(false); }
  }
  return <div className={`ta-image is-${kind}${value !== undefined ? ' is-changed' : ''}`}>
    <div className="ta-image-frame">{shown ? <img src={shown} alt="" /> : <span className="muted">{translate(present ? 'manager.teamAdmin.imageSaved' : 'manager.teamAdmin.noImage')}</span>}</div>
    <div className="ta-image-actions"><strong>{label}</strong><small className="muted">{hint}</small>
      <span className="op-actions">
        <label className="btn sm"><Upload size={14} aria-hidden /> {busy ? translate('manager.teamAdmin.uploading') : translate('manager.teamAdmin.changeImage')}
          <input type="file" accept={accept} hidden disabled={disabled || busy} onChange={pick} /></label>
        {present && <button type="button" className="btn ghost sm" disabled={disabled || busy} onClick={() => onChange(null)}>{translate('manager.teamAdmin.removeImage')}</button>}
        {value !== undefined && <button type="button" className="btn ghost sm" disabled={disabled || busy} onClick={() => onChange(undefined)}>{translate('manager.teamAdmin.undoImage')}</button>}
      </span>
      {error && <small className="op-error" role="alert">{error}</small>}</div>
  </div>;
}
