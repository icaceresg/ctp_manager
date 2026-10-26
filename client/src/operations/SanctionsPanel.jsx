import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Ban, Clock3, Gavel, Megaphone, RefreshCw, Search, UserRound } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Modal, Spinner } from '../components/ui.jsx';
import { Badge, DataTable, Empty, Field, FormDialog } from './ui.jsx';
import { dateTime } from './model.js';
import { DURATIONS, KIND_LABELS, ROLE_LABELS, SCOPE_ACTIONS, SCOPE_LABELS, WARNING_DAYS, isStaffRole, periodLabel, remainingLabel, sanctionPeriod } from './sanctionsModel.js';
import './sanctions.css';

const TABS = [
  { id: 'activas', title: 'Sancionados ahora' },
  { id: 'usuarios', title: 'Usuarios' },
  { id: 'recursos', title: 'Recursos' },
  { id: 'recientes', title: 'Últimas decisiones' },
];

/** Re-render every 30 s so the remaining time stays current without reloading. */
function useNow(interval = 30000) {
  const [, setTick] = useState(0);
  useEffect(() => { const timer = setInterval(() => setTick(tick => tick + 1), interval); return () => clearInterval(timer); }, [interval]);
  // Read the clock on every render: a sanction applied a moment ago is already in force.
  return Date.now();
}

function useRemote(url) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(url) });
  const sequence = useRef(0);
  const load = useCallback(async () => {
    if (!url) return;
    const current = ++sequence.current;
    setState(previous => ({ ...previous, loading: true, error: null }));
    try { const data = await api.get(url); if (current === sequence.current) setState({ data, error: null, loading: false }); }
    catch (error) { if (current === sequence.current) setState(previous => ({ data: [401, 403].includes(error.status) ? null : previous.data, error, loading: false })); }
  }, [url]);
  useEffect(() => { load(); return () => { sequence.current++; }; }, [load]);
  return { ...state, reload: load };
}

export function SanctionsPanel({ data }) {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(item => item.id === params.get('tab')) ? params.get('tab') : 'activas';
  const userId = params.get('user');
  const configured = Boolean(data.connection?.configured);
  const writable = configured && Boolean(data.connection?.write_enabled);
  const overview = useRemote(configured ? '/operations/discipline/overview' : null);
  const [dialog, setDialog] = useState(null);
  const now = useNow();
  const change = (key, value) => setParams(previous => { const next = new URLSearchParams(previous); value ? next.set(key, value) : next.delete(key); if (key === 'tab') { next.delete('buscar'); next.delete('page'); } if (key === 'buscar') next.delete('page'); return next; }, { replace: key !== 'user' });
  const openUser = id => change('user', id);
  const refresh = () => { overview.reload(); setDialog(null); };
  const active = (overview.data?.active || []).filter(item => item.kind !== 'warning');
  const warnings = (overview.data?.active || []).filter(item => item.kind === 'warning');
  const counts = { activas: active.length, recursos: overview.data?.appeals?.length || 0 };

  if (!configured) return <Empty title="Conexión con CTP pendiente">Las sanciones se leen y se aplican directamente en CTP. Configura la conexión para usarlas.</Empty>;
  return <div className="sx-page">
    <p className="muted sx-intro">Sanciona o amonesta a cualquier cuenta de CTP. Se aplica al momento y el jugador recibe el aviso en la web.</p>
    {!writable && <p className="op-notice">El envío de cambios oficiales está desactivado en este Manager. Puedes consultar, pero no sancionar.</p>}
    <div className="sx-tabs">
      <nav className="op-dossier-nav" aria-label="Secciones de sanciones">
        {TABS.map(item => <button type="button" key={item.id} className={tab === item.id ? 'is-active' : ''} aria-current={tab === item.id ? 'page' : undefined} onClick={() => change('tab', item.id === 'activas' ? '' : item.id)}>{item.title}{Boolean(counts[item.id]) && <span>{counts[item.id]}</span>}</button>)}
      </nav>
      <button className="btn ghost icon" title="Volver a consultar las sanciones en CTP" aria-label="Volver a consultar las sanciones en CTP" onClick={overview.reload} disabled={overview.loading}><RefreshCw size={16} className={overview.loading ? 'spin' : ''} /></button>
    </div>
    {overview.error && <p className="op-error" role="alert">{overview.error.message}{overview.data ? ' Se conserva la última consulta.' : ''}</p>}
    {tab === 'usuarios' ? <UsersTab params={params} change={change} openUser={openUser} writable={writable} setDialog={setDialog} now={now} />
      : overview.loading && !overview.data ? <div className="op-loading"><Spinner size={22} /> Consultando sanciones en CTP…</div>
      : overview.data && <>
        {tab === 'activas' && <>
          <SanctionTable rows={active} now={now} openUser={openUser} writable={writable} setDialog={setDialog} empty="Nadie tiene ahora una sanción temporal" emptyDetail="Las suspensiones y los bloqueos de Ranked vigentes aparecerán aquí con el tiempo que les queda." />
          <section className="op-card"><div className="op-section-title"><div><h3>Amonestaciones vigentes</h3><p>Avisos sin restricción que el jugador tiene en su perfil.</p></div><span className="op-count">{warnings.length}</span></div>
            <SanctionTable rows={warnings} now={now} openUser={openUser} writable={writable} setDialog={setDialog} compact empty="Sin amonestaciones vigentes" emptyDetail="Usa «Amonestar» desde la pestaña Usuarios para enviar un aviso a un jugador." /></section>
        </>}
        {tab === 'recursos' && <SanctionTable rows={overview.data.appeals} now={now} openUser={openUser} writable={writable} setDialog={setDialog} appeals empty="No hay recursos pendientes" emptyDetail="Cuando un jugador recurra una sanción desde su perfil, aparecerá aquí para que otro árbitro lo resuelva." />}
        {tab === 'recientes' && <SanctionTable rows={overview.data.recent} now={now} openUser={openUser} writable={writable} setDialog={setDialog} history empty="Todavía no hay decisiones" emptyDetail="Aquí se listan las últimas sanciones, amonestaciones y bloqueos de Ranked." />}
      </>}
    {userId && <UserHistory key={userId} id={userId} onClose={() => change('user', '')} writable={writable} setDialog={setDialog} now={now} />}
    {dialog && <ActionDialog dialog={dialog} onClose={() => setDialog(null)} onDone={refresh} />}
  </div>;
}

function Subject({ item, openUser }) {
  if (item.subject_type === 'club') return <span><small className="muted">Club</small><br /><strong>{item.subject_name || 'Club sin nombre'}</strong></span>;
  return <button type="button" className="op-text-button" onClick={() => openUser(item.subject_id)}>{item.subject_name || 'Cuenta sin nombre'}</button>;
}
function Measure({ item }) {
  return <span className="sx-measure"><span className={`sx-kind sx-kind-${item.kind}`}>{KIND_LABELS[item.kind]}</span>{item.kind === 'suspension' && <small>{item.scopes.map(scope => SCOPE_LABELS[scope]).join(' · ')}</small>}{item.kind === 'ranked_ban' && item.minutes && <small>{item.lifted ? 'Levantado antes de tiempo' : `${item.minutes} min impuestos`}</small>}</span>;
}
function Remaining({ item, now }) {
  const period = sanctionPeriod(item, now);
  if (period === 'scheduled') return <span className="sx-remaining is-scheduled"><Clock3 size={13} /> Empieza en {remainingLabel(Date.parse(item.starts_at) - now)}</span>;
  if (period === 'active') return <span className="sx-remaining" title={`Hasta ${dateTime(item.ends_at)}`}><Clock3 size={13} /> {remainingLabel(Date.parse(item.ends_at) - now)}<small>hasta {dateTime(item.ends_at)}</small></span>;
  return <Badge value={period === 'revoked' ? 'revoked' : 'expired'}>{periodLabel(period)}</Badge>;
}
function Actions({ item, writable, setDialog, now }) {
  const period = sanctionPeriod(item, now);
  const live = period === 'active' || period === 'scheduled';
  return <div className="op-actions">
    {item.appeal_status === 'pending' && period !== 'revoked' && <button className="btn sm primary" disabled={!writable} onClick={() => setDialog({ type: 'review', item })}>Resolver recurso</button>}
    {item.source === 'sanction' && live && <button className="btn sm" disabled={!writable} onClick={() => setDialog({ type: 'revoke', item })}>Revocar</button>}
    {item.source === 'ranked_ban' && period === 'active' && <button className="btn sm" disabled={!writable} onClick={() => setDialog({ type: 'lift', item })}>Levantar</button>}
  </div>;
}
function SanctionTable({ rows, now, openUser, writable, setDialog, empty, emptyDetail, compact = false, appeals = false, history = false }) {
  const columns = [
    { key: 'subject', title: 'Jugador', render: item => <Subject item={item} openUser={openUser} /> },
    ...(compact ? [] : [{ key: 'measure', title: 'Medida', render: item => <Measure item={item} /> }]),
    { key: 'time', title: history ? 'Estado' : compact ? 'Visible' : 'Le queda', render: item => <Remaining item={item} now={now} /> },
    { key: 'reason', title: appeals ? 'Motivo y recurso' : 'Motivo', render: item => <div className="sx-reason"><p>{item.reason}</p>{appeals && item.appeal_reason && <blockquote className="op-quote"><small>Recurso del jugador · {dateTime(item.appealed_at)}</small><br />{item.appeal_reason}</blockquote>}</div> },
    { key: 'by', title: history ? 'Fecha' : 'Impuesta por', render: item => history ? <span>{dateTime(item.created_at)}<br /><small className="muted">{item.issued_by_name || 'Staff CTP'}</small></span> : item.issued_by_name || 'Staff CTP' },
    { key: 'actions', title: 'Acciones', render: item => <Actions item={item} writable={writable} setDialog={setDialog} now={now} /> },
  ];
  return <DataTable rows={rows} columns={columns} empty={empty} emptyDetail={emptyDetail} />;
}

function UsersTab({ params, change, openUser, writable, setDialog, now }) {
  const query = params.get('buscar') || '';
  const page = Math.max(0, Number(params.get('page')) || 0);
  const [search, setSearch] = useState(query);
  useEffect(() => setSearch(query), [query]);
  useEffect(() => { const timer = setTimeout(() => { if (search.trim() !== query) change('buscar', search.trim()); }, 350); return () => clearTimeout(timer); }, [search]);
  const users = useRemote(`/operations/discipline/users?${new URLSearchParams({ q: query, page: String(page) })}`);
  const result = users.data;
  const pages = result ? Math.max(1, Math.ceil(result.total / result.limit)) : 1;
  const setPage = value => change('page', value > 0 ? String(value) : '');
  return <section className="op-card">
    <div className="op-section-title"><div><h3>Todas las cuentas de CTP</h3><p>Busca por nombre de usuario, gamertag o ActivisionID. Abre una cuenta para ver su historial.</p></div>{result && <span className="op-count">{result.total} {result.total === 1 ? 'cuenta' : 'cuentas'}</span>}</div>
    <div className="op-filters"><label className="sx-search"><Search size={15} /><input aria-label="Buscar usuario de CTP" placeholder="Nombre, gamertag o ActivisionID…" value={search} maxLength={120} onChange={event => setSearch(event.target.value)} /></label>{query && <button className="btn" onClick={() => { setSearch(''); change('buscar', ''); }}>Limpiar</button>}</div>
    {users.error && <p className="op-error" role="alert">{users.error.message}</p>}
    {users.loading && !result ? <div className="op-loading"><Spinner size={20} /> Buscando cuentas…</div> : result && <>
      <DataTable rows={result.items} empty={query ? 'Ninguna cuenta coincide con la búsqueda' : 'Sin cuentas'} emptyDetail="Prueba con otra parte del nombre o del gamertag." columns={[
        { key: 'user', title: 'Cuenta', render: user => <button type="button" className="sx-user" onClick={() => openUser(user.id)}><Avatar value={user.avatar} /><span><strong>{user.username}</strong><small>{[user.gamertag, user.platform].filter(Boolean).join(' · ')}</small></span></button> },
        { key: 'role', title: 'Rol', render: user => ROLE_LABELS[user.role] || user.role },
        { key: 'state', title: 'Situación', render: user => <UserState user={user} now={now} /> },
        { key: 'actions', title: 'Acciones', render: user => {
          const staff = isStaffRole(user.role);
          const title = staff ? 'El staff no se sanciona desde Manager' : undefined;
          return <div className="op-actions">
            <button className="btn sm" onClick={() => openUser(user.id)}>Historial{user.history ? ` · ${user.history}` : ''}</button>
            <button className="btn sm" title={title} disabled={!writable || staff} onClick={() => setDialog({ type: 'suspension', user })}><Ban size={14} /> Sancionar</button>
            <button className="btn sm" title={title} disabled={!writable || staff} onClick={() => setDialog({ type: 'warning', user })}><Megaphone size={14} /> Amonestar</button>
          </div>;
        } },
      ]} />
      {pages > 1 && <div className="op-actions sx-pager"><button className="btn" disabled={users.loading || page === 0} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page + 1} de {pages}</span><button className="btn" disabled={users.loading || page + 1 >= pages} onClick={() => setPage(page + 1)}>Siguiente</button></div>}
    </>}
  </section>;
}

function Avatar({ value }) {
  // CTP avatars are an emoji or an uploaded image; only show safe HTTPS images.
  let image = null;
  try { const url = new URL(value); if (url.protocol === 'https:') image = url.href; } catch { /* emoji or empty */ }
  if (image) return <img className="sx-avatar" src={image} alt="" width="32" height="32" loading="lazy" referrerPolicy="no-referrer" />;
  return <span className="sx-avatar" aria-hidden="true">{typeof value === 'string' && value.length <= 8 ? value : <UserRound size={16} />}</span>;
}
function UserState({ user, now }) {
  if (user.restricted_until && Date.parse(user.restricted_until) > now) return <span className="sx-state is-restricted"><Ban size={13} /> Sancionado · le quedan {remainingLabel(Date.parse(user.restricted_until) - now)}</span>;
  if (user.warnings) return <span className="sx-state is-warned"><Megaphone size={13} /> {user.warnings} {user.warnings === 1 ? 'amonestación' : 'amonestaciones'}</span>;
  return <span className="sx-state">Sin sanciones activas</span>;
}

function UserHistory({ id, onClose, writable, setDialog, now }) {
  const history = useRemote(`/operations/discipline/users/${encodeURIComponent(id)}`);
  const user = history.data?.user;
  const staff = user && isStaffRole(user.role);
  return <Modal title={user ? `Historial de ${user.username}` : 'Historial de sanciones'} onClose={onClose} size="xl">
    <div className="sx-history">
      {history.loading && !history.data && <div className="op-loading"><Spinner size={20} /> Cargando historial…</div>}
      {history.error && <p className="op-error" role="alert">{history.error.message}<button className="btn sm" onClick={history.reload}>Reintentar</button></p>}
      {user && <>
        <header className="sx-history-head">
          <Avatar value={user.avatar} />
          <div><h3>{user.username}</h3><p className="muted">{[user.gamertag, user.platform, ROLE_LABELS[user.role] || user.role].filter(Boolean).join(' · ')}{user.created_at ? ` · alta ${dateTime(user.created_at)}` : ''}</p>
            {history.data.clubs.length > 0 && <p className="sx-clubs">{history.data.clubs.map(club => <span key={club.id || club.name}>{club.name}{club.role === 'lider' ? ' · líder' : ''}</span>)}</p>}</div>
          {!user.closed && <div className="op-actions sx-history-actions">
            <button className="btn primary" disabled={!writable || staff} onClick={() => setDialog({ type: 'suspension', user, after: history.reload })}><Ban size={15} /> Sancionar</button>
            <button className="btn" disabled={!writable || staff} onClick={() => setDialog({ type: 'warning', user, after: history.reload })}><Megaphone size={15} /> Amonestar</button>
          </div>}
        </header>
        {user.closed && <p className="op-notice">Esta cuenta está cerrada. Se conserva su historial.</p>}
        {staff && <p className="op-notice">Es una cuenta de staff. Su disciplina no se gestiona desde Manager.</p>}
        {history.data.items.length ? <ol className="sx-timeline">{history.data.items.map(item => <HistoryItem key={item.id} item={item} now={now} writable={writable} setDialog={dialog => setDialog({ ...dialog, after: history.reload })} />)}</ol>
          : <Empty title="Sin sanciones ni amonestaciones">Esta cuenta no tiene ningún registro disciplinario en CTP.</Empty>}
      </>}
    </div>
  </Modal>;
}
function HistoryItem({ item, now, writable, setDialog }) {
  const period = sanctionPeriod(item, now);
  return <li className={`sx-entry sx-entry-${item.kind} is-${period}`}>
    <div className="sx-entry-head"><span className={`sx-kind sx-kind-${item.kind}`}>{KIND_LABELS[item.kind]}</span>{item.subject_type === 'club' && <span className="op-badge">Club · {item.subject_name}</span>}<Badge value={period === 'active' ? 'active' : period === 'scheduled' ? 'pending' : 'closed'}>{periodLabel(period)}</Badge>{item.appeal_status !== 'none' && <Badge value={item.appeal_status === 'pending' ? 'appealed' : 'closed'}>{{ pending: 'Recurso pendiente', upheld: 'Recurso desestimado', revoked: 'Recurso estimado' }[item.appeal_status]}</Badge>}</div>
    <p className="sx-entry-reason">{item.reason}</p>
    <p className="sx-entry-meta">{item.kind === 'suspension' && <>{item.scopes.map(scope => SCOPE_LABELS[scope]).join(' · ')} · </>}{dateTime(item.starts_at)} → {dateTime(item.ends_at)}{period === 'active' && <> · <strong>le quedan {remainingLabel(Date.parse(item.ends_at) - now)}</strong></>} · {item.issued_by_name || 'Staff CTP'}{item.lifted && ' · levantado antes de tiempo'}</p>
    {item.appeal_reason && <blockquote className="op-quote"><small>Recurso · {dateTime(item.appealed_at)}</small><br />{item.appeal_reason}</blockquote>}
    {item.review_reason && <p className="sx-entry-meta">Resolución{item.reviewed_by_name ? ` de ${item.reviewed_by_name}` : ''}: {item.review_reason}</p>}
    {item.revoke_reason && item.revoke_reason !== item.review_reason && <p className="sx-entry-meta">Revocada{item.revoked_by_name ? ` por ${item.revoked_by_name}` : ''}: {item.revoke_reason}</p>}
    <Actions item={item} writable={writable} setDialog={setDialog} now={now} />
  </li>;
}

const isoAfter = (ms, from = Date.now()) => new Date(from + ms).toISOString();
function toLocalInput(ms) { const date = new Date(ms); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); return date.toISOString().slice(0, 16); }

function ActionDialog({ dialog, onClose, onDone }) {
  const { toast } = useApp();
  const requestId = useRef(crypto.randomUUID());
  const [duration, setDuration] = useState('1d');
  const [scopes, setScopes] = useState(['ranked']);
  const finish = (message, result) => { toast(result?.replayed ? 'CTP ya había aplicado esta decisión.' : message); dialog.after?.(); onDone(); };
  const send = (path, body) => api.post(`/operations/discipline${path}`, { request_id: requestId.current, ...body });
  const { type, item, user } = dialog;
  if (type === 'suspension' || type === 'warning') {
    const warning = type === 'warning';
    return <FormDialog title={warning ? `Amonestar a ${user.username}` : `Sancionar a ${user.username}`} submitLabel={warning ? 'Enviar amonestación' : 'Aplicar sanción'} onClose={onClose}
      help={warning ? 'El jugador recibe una notificación y ve el mensaje en su perfil. No le impide jugar.' : 'Se aplica al momento en CTP: si está buscando partida sale de la cola y verá el motivo y el tiempo restante al pulsar «Buscar partida». No se expulsa a nadie de un partido ya empezado.'}
      submit={async body => {
        const now = Date.now();
        let ends;
        if (warning) ends = isoAfter(Number(body.days) * 86400000, now);
        else if (duration === 'custom') { const until = Date.parse(body.until); if (!Number.isFinite(until)) throw new Error('Indica hasta cuándo dura la sanción.'); ends = new Date(until).toISOString(); }
        else ends = isoAfter(DURATIONS.find(option => option.id === duration).ms, now);
        if (!warning && !scopes.length) throw new Error('Elige al menos un área de la suspensión.');
        const result = await send('/sanctions', { user_id: user.id, restriction: warning ? 'warning' : 'competition_suspend', scopes: warning ? [] : scopes, starts_at: new Date(now).toISOString(), ends_at: ends, reason: body.reason });
        finish(warning ? 'Amonestación enviada al jugador.' : 'Sanción aplicada en CTP.', result);
      }}>
      {!warning && <fieldset className="op-scopes"><legend>Qué no podrá hacer</legend>
        {Object.entries(SCOPE_ACTIONS).map(([scope, title]) => <label key={scope} className="op-check"><input type="checkbox" checked={scopes.includes(scope)} onChange={event => setScopes(current => event.target.checked ? [...current, scope] : current.filter(value => value !== scope))} />{title}</label>)}
      </fieldset>}
      {!warning && <Field label="Duración"><select value={duration} onChange={event => setDuration(event.target.value)}>{DURATIONS.map(option => <option key={option.id} value={option.id}>{option.title}</option>)}<option value="custom">Hasta una fecha…</option></select></Field>}
      {!warning && duration === 'custom' && <Field label="Hasta"><input name="until" type="datetime-local" required min={toLocalInput(Date.now() + 60000)} defaultValue={toLocalInput(Date.now() + 86400000)} /></Field>}
      {warning && <Field label="Visible en su perfil durante"><select name="days" defaultValue="30">{WARNING_DAYS.map(days => <option key={days} value={days}>{days === 365 ? '1 año' : `${days} días`}</option>)}</select></Field>}
      <Field label={warning ? 'Mensaje para el jugador' : 'Motivo (lo verá el jugador)'} hint="Entre 12 y 2000 caracteres. Escribe con claridad: se muestra tal cual."><textarea name="reason" rows={5} required minLength={12} maxLength={2000} /></Field>
    </FormDialog>;
  }
  if (type === 'revoke') return <FormDialog title="Revocar sanción" submitLabel="Revocar ahora" onClose={onClose} help="Deja de aplicarse al momento y el jugador recibe un aviso. Queda registrada en su historial como revocada."
    submit={async body => finish('Sanción revocada.', await send(`/sanctions/${encodeURIComponent(item.id)}/revoke`, { expected_version: item.version, reason: body.reason }))}>
    <SummaryLine item={item} /><Field label="Motivo de la revocación"><textarea name="reason" rows={4} required minLength={12} maxLength={2000} /></Field>
  </FormDialog>;
  if (type === 'review') return <FormDialog title="Resolver recurso" submitLabel="Resolver" onClose={onClose} help="Debe resolverlo un árbitro distinto de quien sancionó. El jugador recibe la resolución en su perfil."
    submit={async body => finish(body.decision === 'revoke' ? 'Recurso estimado: sanción revocada.' : 'Recurso desestimado: la sanción se mantiene.', await send(`/sanctions/${encodeURIComponent(item.id)}/review`, { expected_version: item.version, decision: body.decision, reason: body.reason }))}>
    <SummaryLine item={item} />{item.appeal_reason && <blockquote className="op-quote"><small>Recurso del jugador</small><br />{item.appeal_reason}</blockquote>}
    <Field label="Decisión"><select name="decision"><option value="uphold">Mantener la sanción</option><option value="revoke">Estimar el recurso y revocarla</option></select></Field>
    <Field label="Explicación para el jugador"><textarea name="reason" rows={4} required minLength={12} maxLength={2000} /></Field>
  </FormDialog>;
  if (type === 'lift') return <FormDialog title="Levantar bloqueo de Ranked" submitLabel="Levantar ahora" onClose={onClose} help="El jugador podrá volver a buscar partida en Ranked inmediatamente."
    submit={async body => finish('Bloqueo de Ranked levantado.', await send(`/bans/${encodeURIComponent(item.id)}/lift`, { reason: body.reason }))}>
    <SummaryLine item={item} /><Field label="Motivo"><textarea name="reason" rows={3} required minLength={12} maxLength={500} /></Field>
  </FormDialog>;
  return null;
}
function SummaryLine({ item }) {
  return <p className="sx-summary"><Gavel size={15} /><span><strong>{item.subject_name || 'Jugador'}</strong> · {KIND_LABELS[item.kind]}{item.kind === 'suspension' ? ` (${item.scopes.map(scope => SCOPE_LABELS[scope]).join(', ')})` : ''} · hasta {dateTime(item.ends_at)}</span></p>;
}
