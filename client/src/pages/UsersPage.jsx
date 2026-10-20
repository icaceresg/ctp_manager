import { useState } from 'react';
import { Check, Pencil, Plus, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useData } from '../context.jsx';
import { EmptyState, Modal, Spinner } from '../components/ui.jsx';
import { SECTIONS, STAFF_KINDS, DEFAULT_ROLES } from '../../../shared/access.js';
import { StaffAccessPage } from './StaffAccessPage.jsx';

const dateTime = (ts) => (ts ? new Date(ts).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) : 'Nunca');

function UserModal({ user, roles, onClose, onSaved }) {
  const { me, toast, onMeChange } = useApp();
  const ctp = me.auth_mode === 'ctp';
  const editing = Boolean(user);
  const self = user?.id === me.id;
  const [form, setForm] = useState({
    name: user?.name || '',
    username: user?.username || '',
    password: '',
    is_admin: user?.is_admin || false,
    active: user ? user.active : true,
    role_ids: user?.roles.map((r) => r.id) || [],
  });
  const [busy, setBusy] = useState(false);
  const set = (field) => (value) => setForm((f) => ({ ...f, [field]: value }));
  const toggleRole = (id) =>
    setForm((f) => ({ ...f, role_ids: f.role_ids.includes(id) ? f.role_ids.filter((x) => x !== id) : [...f.role_ids, id] }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = ctp ? { role_ids: form.role_ids, active: form.active } : { ...form };
      if (editing && !body.password) delete body.password;
      if (editing) await api.patch(`/users/${user.id}`, body);
      else await api.post('/users', body);
      toast(editing ? 'Usuario actualizado.' : `Usuario "${form.username}" creado.`);
      if (self) onMeChange();
      onSaved();
      onClose();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`¿Borrar el usuario "${user.username}"? No se puede deshacer. (Si solo quieres quitarle el acceso, desactívalo.)`)) return;
    setBusy(true);
    try {
      await api.del(`/users/${user.id}`);
      toast('Usuario borrado.');
      onSaved();
      onClose();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  return (
    <Modal title={editing ? `Editar ${user.username}` : 'Nuevo usuario'} onClose={onClose}>
      <form onSubmit={save}>
        <div className="modal-body stack">
          {ctp && <p className="muted">Cuenta de CTP. Aquí solo se asignan secciones y acceso a Manager; su identidad y autoridad se comprueban en CTP.</p>}
          {!ctp && <>
          <div className="field">
            <label htmlFor="u-name">Nombre</label>
            <input id="u-name" className="input" value={form.name} maxLength={80} onChange={(e) => set('name')(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label htmlFor="u-user">Usuario</label>
            <input
              id="u-user"
              className="input"
              value={form.username}
              maxLength={32}
              autoCapitalize="none"
              spellCheck={false}
              onChange={(e) => set('username')(e.target.value)}
            />
            <span className="hint">Con el que inicia sesión: letras, números, punto, guion o guion bajo.</span>
          </div>
          <div className="field">
            <label htmlFor="u-pass">{editing ? 'Nueva contraseña (opcional)' : 'Contraseña'}</label>
            <input
              id="u-pass"
              className="input"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => set('password')(e.target.value)}
              placeholder={editing ? 'Déjala vacía para no cambiarla' : ''}
            />
            <span className="hint">
              Mínimo 8 caracteres. Pásasela a la persona por un canal privado; podrá cambiarla en "Mi cuenta".
            </span>
          </div>
          </>}

          <div className="field">
            <span className="label">Roles</span>
            {!ctp && <label className="checkbox role-option admin">
              <input type="checkbox" checked={form.is_admin} disabled={self} onChange={(e) => set('is_admin')(e.target.checked)} />
              <span>
                <strong>Administrador</strong>
                <span className="hint">Ve todas las secciones y gestiona usuarios y roles.</span>
              </span>
            </label>}
            {roles.filter((r) => STAFF_KINDS.some((kind) => kind.id === r.staff_kind)).map((r) => (
              <label key={r.id} className="checkbox role-option">
                <input type="checkbox" checked={form.role_ids.includes(r.id)} onChange={() => toggleRole(r.id)} />
                <span>
                  <strong>{r.name}</strong>
                  <span className="hint">
                    {r.sections.length
                      ? SECTIONS.filter((s) => r.sections.includes(s.id))
                          .map((s) => s.label)
                          .join(', ')
                      : 'Sin secciones'}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {editing && (
            <label className="checkbox">
              <input type="checkbox" checked={form.active} disabled={self} onChange={(e) => set('active')(e.target.checked)} />
              <span>Activo (si lo desactivas, no puede entrar y se cierran sus sesiones)</span>
            </label>
          )}
        </div>
        <div className="modal-footer">
          {editing && !self && !ctp && (
            <button type="button" className="btn ghost danger" onClick={remove} disabled={busy}>
              <Trash2 size={15} /> Borrar
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn primary" disabled={busy || !form.username || (!editing && !form.password)}>
            {busy && <Spinner size={15} />} {editing ? 'Guardar' : 'Crear usuario'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function UsersTab({ users, roles, reload }) {
  const { me } = useApp();
  const [modal, setModal] = useState(null);

  return (
    <>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {me.auth_mode === 'ctp' ? <p className="muted">El staff aparece al entrar con su cuenta CTP. La administración de cuentas se realiza en CTP.</p> : <button className="btn primary" onClick={() => setModal({})}>
          <UserPlus size={16} /> Nuevo usuario
        </button>}
      </div>
      <div className="card table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Roles</th>
              <th>Estado</th>
              <th>Último acceso</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.active ? '' : 'inactive'}>
                <td>
                  <strong>{u.name || u.username}</strong>
                  {u.id === me.id && <span className="muted small"> (tú)</span>}
                  <div className="code-inline">{u.username}</div>
                </td>
                <td>
                  <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                    {u.is_admin && <span className="role-chip admin">Administrador</span>}
                    {u.roles.map((r) => (
                      <span key={r.id} className="role-chip">
                        {r.name}
                      </span>
                    ))}
                    {!u.is_admin && !u.roles.length && <span className="muted small">Sin rol</span>}
                  </div>
                </td>
                <td>{u.active ? <span className="badge status-listo">Activo</span> : <span className="badge status-no_listo">Desactivado</span>}</td>
                <td className="muted small">{dateTime(u.last_login_at)}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn ghost sm" onClick={() => setModal({ user: u })}>
                    <Pencil size={14} /> Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal && <UserModal user={modal.user} roles={roles} onClose={() => setModal(null)} onSaved={reload} />}
    </>
  );
}

function RoleRow({ role, onChange, onDelete }) {
  const [name, setName] = useState(role.name);
  const toggle = (section) => {
    const sections = role.sections.includes(section) ? role.sections.filter((s) => s !== section) : [...role.sections, section];
    onChange(role, { sections });
  };
  return (
    <tr>
      <td>
        <input
          className="inline-input"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => (name.trim() && name !== role.name ? onChange(role, { name }) : setName(role.name))}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          aria-label="Nombre del rol"
        />
      </td>
      <td><select aria-label={`Función de staff de ${role.name}`} value={role.staff_kind || ''} onChange={(e) => onChange(role, { staff_kind: e.target.value })}><option value="" disabled>Requiere revisión</option>{STAFF_KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}</select>{!role.staff_kind && <small className="muted">Sin acceso hasta clasificarlo.</small>}</td>
      {SECTIONS.map((s) => (
        <td key={s.id} className="center">
          <input
            type="checkbox"
            className="big-check"
            checked={role.sections.includes(s.id)}
            onChange={() => toggle(s.id)}
            aria-label={`${role.name}: ${s.label}`}
          />
        </td>
      ))}
      <td className="center muted small">—</td>
      <td className="center muted small">{role.user_count}</td>
      <td style={{ textAlign: 'right' }}>
        {DEFAULT_ROLES.some((r) => r.staff_kind === role.staff_kind) && <button className="btn ghost sm" title="Aplicar los permisos recomendados de esta función" onClick={() => { if (window.confirm('¿Aplicar los permisos recomendados a todas las personas de este rol?')) onChange(role, { sections: DEFAULT_ROLES.find((r) => r.staff_kind === role.staff_kind).sections }); }}>Permisos recomendados</button>}
        <button className="btn ghost icon sm danger" onClick={() => onDelete(role)} aria-label={`Borrar el rol ${role.name}`} title="Borrar rol">
          <Trash2 size={15} />
        </button>
      </td>
    </tr>
  );
}

function RolesTab({ roles, reload }) {
  const { toast } = useApp();
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState('operations');

  async function run(fn, message) {
    try {
      await fn();
      if (message) toast(message);
    } catch (err) {
      toast(err.message, 'error');
    }
    reload();
  }

  const add = (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    run(() => api.post('/roles', { name: newName, staff_kind: newKind, sections: [] }), `Rol "${newName.trim()}" creado. Marca sus secciones.`);
    setNewName('');
  };

  return (
    <>
      <p className="muted">
        Solo el staff puede entrar en Manager. Clasifica cada rol y marca sus permisos. Los roles antiguos sin clasificar no conceden acceso; sus datos se conservan.
      </p>
      <div className="card table-card">
        <table className="data-table roles-table">
          <thead>
            <tr>
              <th>Rol</th>
              <th>Función de staff</th>
              {SECTIONS.map((s) => (
                <th key={s.id} className="center" title={s.description}>
                  {s.label}
                </th>
              ))}
              <th className="center">Usuarios y roles</th>
              <th className="center">Personas</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            <tr className="admin-row">
              <td>
                <span className="role-chip admin">
                  <ShieldCheck size={12} /> Administrador
                </span>
              </td>
              <td>Administración</td>
              {SECTIONS.map((s) => (
                <td key={s.id} className="center">
                  <Check size={16} className="gold" />
                </td>
              ))}
              <td className="center">
                <Check size={16} className="gold" />
              </td>
              <td className="center muted small">—</td>
              <td />
            </tr>
            {roles.map((r) => (
              <RoleRow
                key={`${r.id}-${r.name}`}
                role={r}
                onChange={(role, patch) => run(() => api.patch(`/roles/${role.id}`, patch))}
                onDelete={(role) => {
                  const who = role.user_count ? ` Se quitará a ${role.user_count} persona(s).` : '';
                  if (window.confirm(`¿Borrar el rol "${role.name}"?${who}`)) run(() => api.del(`/roles/${role.id}`), 'Rol borrado.');
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
      <form className="input-group" style={{ maxWidth: 420 }} onSubmit={add}>
        <select aria-label="Función del nuevo rol" value={newKind} onChange={(e) => setNewKind(e.target.value)}>{STAFF_KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}</select>
        <input className="input" placeholder="Nombre del nuevo rol (p. ej. DISEÑO)" value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)} />
        <button className="btn" disabled={!newName.trim()}>
          <Plus size={15} /> Añadir rol
        </button>
      </form>
    </>
  );
}

export function UsersPage() {
  const { me } = useApp();
  return me.auth_mode === 'ctp' ? <StaffAccessPage/> : <LocalUsersPage/>;
}

function LocalUsersPage() {
  const [tab, setTab] = useState('users');
  const { data, loading, reload } = useData(async () => {
    const [users, roles] = await Promise.all([api.get('/users'), api.get('/roles')]);
    return { users, roles };
  });

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="page-header">
        <div>
          <h1>Usuarios y roles</h1>
          <p>Acceso exclusivo del staff. Las cuentas de jugadores y clubes se gestionan en CTP.</p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'users'} className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>
          <Users size={15} /> Usuarios {data && <span className="tab-count">{data.users.length}</span>}
        </button>
        <button role="tab" aria-selected={tab === 'roles'} className={tab === 'roles' ? 'active' : ''} onClick={() => setTab('roles')}>
          <ShieldCheck size={15} /> Roles y permisos {data && <span className="tab-count">{data.roles.length}</span>}
        </button>
      </div>
      {loading && !data ? (
        <Spinner />
      ) : !data ? (
        <EmptyState icon={Users} title="No se han podido cargar los usuarios" />
      ) : tab === 'users' ? (
        <UsersTab users={data.users} roles={data.roles} reload={reload} />
      ) : (
        <RolesTab roles={data.roles} reload={reload} />
      )}
    </div>
  );
}
