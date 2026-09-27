import { useEffect, useRef, useState } from 'react';
import { Copy, Plus, Save, Trash2, X } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { DEFAULT_OWNERS, DEFAULT_STATUS, PLATFORMS, PLATFORM_IDS, STATUSES, sortPlatforms } from '../../../shared/catalog.js';
import { tweetLength } from '../../../shared/tweet.js';
import { Modal, PlatformIcon, Spinner } from './ui.jsx';

let keySeq = 0;
const withKey = (r) => ({ key: ++keySeq, text: r.text, done: Boolean(r.done) });

function emptyForm(date) {
  return {
    title: '',
    status: DEFAULT_STATUS,
    owner: '',
    date: date || '',
    time: '',
    platforms: [],
    description: '',
    copy: '',
    notes: '',
    resources: [],
  };
}

function fromContent(c) {
  return {
    title: c.title,
    status: c.status,
    owner: c.owner || '',
    date: c.date || '',
    time: c.time || '',
    platforms: c.platforms,
    description: c.description,
    copy: c.copy,
    notes: c.notes,
    resources: c.resources.map(withKey),
  };
}

const snapshot = (form) => JSON.stringify({ ...form, resources: form.resources.map((r) => [r.text, r.done]) });

function CopyCounters({ copy, platforms }) {
  const counters = [...new Set(platforms.map((p) => p.platform))]
    .filter((id) => PLATFORMS[id].copyLimit)
    .map((id) => {
      const length = id === 'x' ? tweetLength(copy) : Array.from(copy).length;
      return { id, length, limit: PLATFORMS[id].copyLimit };
    });
  return (
    <span className="copy-counters">
      {counters.map((c) => (
        <span key={c.id} className={`counter ${c.length > c.limit ? 'over' : ''}`} title={`Límite de ${PLATFORMS[c.id].label}`}>
          <PlatformIcon platform={c.id} size={12} /> {c.length}/{c.limit.toLocaleString('es-ES')}
        </span>
      ))}
      {!counters.length && <span className="counter">{Array.from(copy).length} caracteres</span>}
    </span>
  );
}

function ResourceChecklist({ resources, onChange }) {
  const [text, setText] = useState('');
  const done = resources.filter((r) => r.done).length;

  const add = () => {
    const value = text.trim();
    if (!value) return;
    onChange([...resources, withKey({ text: value, done: false })]);
    setText('');
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="label">Recursos necesarios</span>
        {resources.length > 0 && (
          <span className="muted small">
            {done}/{resources.length} listos
          </span>
        )}
      </div>
      {resources.length > 0 && (
        <div className="progress">
          <div style={{ width: `${(done / resources.length) * 100}%` }} />
        </div>
      )}
      <ul className="checklist-edit">
        {resources.map((r) => (
          <li key={r.key} className={r.done ? 'done' : ''}>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={r.done}
                onChange={(e) => onChange(resources.map((x) => (x.key === r.key ? { ...x, done: e.target.checked } : x)))}
              />
              <span>{r.text}</span>
            </label>
            <button className="btn ghost icon sm" aria-label={`Quitar ${r.text}`} onClick={() => onChange(resources.filter((x) => x.key !== r.key))}>
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>
      <div className="input-group">
        <input
          className="input"
          placeholder="Añadir recurso (música, b-roll, miniatura…)"
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button className="btn icon" onClick={add} disabled={!text.trim()} aria-label="Añadir recurso">
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}

/** Crea o edita una tarjeta de contenido para redes. */
export function ContentEditor({ content, date, onClose }) {
  const { toast, bump, openContent } = useApp();
  const editing = Boolean(content);
  const [form, setForm] = useState(() => (content ? fromContent(content) : emptyForm(date)));
  const [saving, setSaving] = useState(null);
  const initial = useRef(snapshot(form));
  const titleRef = useRef(null);
  const [owners, setOwners] = useState(DEFAULT_OWNERS);

  useEffect(() => {
    api
      .get('/owners')
      .then((list) => setOwners([...new Set([...DEFAULT_OWNERS, ...list])]))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!editing) titleRef.current?.focus();
  }, [editing]);

  const set = (field) => (value) => setForm((f) => ({ ...f, [field]: value }));
  const dirty = () => snapshot(form) !== initial.current;

  const requestClose = () => {
    if (saving) return;
    if (dirty() && !window.confirm('Tienes cambios sin guardar. ¿Cerrar de todos modos?')) return;
    onClose();
  };

  // Una red puede ir en varios formatos (p. ej. Carrusel + Story). Activar la
  // red marca su primer formato; quitar su último formato la desactiva.
  const togglePlatform = (id) =>
    setForm((f) => {
      const on = f.platforms.some((p) => p.platform === id);
      const platforms = on
        ? f.platforms.filter((p) => p.platform !== id)
        : [...f.platforms, { platform: id, format: Object.keys(PLATFORMS[id].formats)[0] }];
      return { ...f, platforms: sortPlatforms(platforms) };
    });

  const toggleFormat = (id, format) =>
    setForm((f) => {
      const on = f.platforms.some((p) => p.platform === id && p.format === format);
      const platforms = on
        ? f.platforms.filter((p) => !(p.platform === id && p.format === format))
        : [...f.platforms, { platform: id, format }];
      return { ...f, platforms: sortPlatforms(platforms) };
    });

  async function save() {
    if (!form.title.trim()) {
      toast('Ponle un título a la publicación.', 'error');
      titleRef.current?.focus();
      return;
    }
    setSaving('save');
    try {
      const body = { ...form, date: form.date || null, time: form.date ? form.time || null : null };
      if (editing) await api.put(`/contents/${content.id}`, body);
      else await api.post('/contents', body);
      toast(editing ? 'Cambios guardados.' : 'Publicación creada.');
      bump();
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(null);
    }
  }

  async function remove() {
    if (!window.confirm(`¿Eliminar "${content.title}"? No se puede deshacer.`)) return;
    setSaving('delete');
    try {
      await api.del(`/contents/${content.id}`);
      toast('Publicación eliminada.');
      bump();
      onClose();
    } catch (err) {
      toast(err.message, 'error');
      setSaving(null);
    }
  }

  async function duplicate() {
    if (dirty() && !window.confirm('La copia se hace de la versión guardada, sin tus cambios actuales. ¿Continuar?')) return;
    setSaving('duplicate');
    try {
      const copy = await api.post(`/contents/${content.id}/duplicate`);
      toast('Copia creada.');
      bump();
      openContent({ content: copy });
    } catch (err) {
      toast(err.message, 'error');
      setSaving(null);
    }
  }

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <Modal title={editing ? 'Editar publicación' : 'Nueva publicación'} onClose={requestClose} size="xl">
      <div className="editor-grid">
        <div className="editor-main">
          <input
            ref={titleRef}
            className="title-input"
            placeholder="Título de la publicación"
            value={form.title}
            maxLength={200}
            onChange={(e) => set('title')(e.target.value)}
            aria-label="Título"
          />

          <div className="field">
            <span className="label">Redes y formato</span>
            <div className="platform-picker">
              {PLATFORM_IDS.map((id) => {
                const selected = form.platforms.filter((p) => p.platform === id).map((p) => p.format);
                return (
                  <div key={id} className={`platform-option ${selected.length ? 'selected' : ''}`}>
                    <button className="platform-toggle" aria-pressed={selected.length > 0} onClick={() => togglePlatform(id)}>
                      <PlatformIcon platform={id} size={16} />
                      {PLATFORMS[id].label}
                    </button>
                    {selected.length > 0 && (
                      <div className="format-chips" role="group" aria-label={`Formatos en ${PLATFORMS[id].label}`}>
                        {Object.entries(PLATFORMS[id].formats).map(([value, label]) => (
                          <button
                            key={value}
                            className={`format-chip ${selected.includes(value) ? 'on' : ''}`}
                            aria-pressed={selected.includes(value)}
                            onClick={() => toggleFormat(id, value)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="field">
            <label htmlFor="c-desc">¿Qué se va a publicar?</label>
            <textarea
              id="c-desc"
              className="textarea"
              rows={4}
              placeholder="Idea, guion o descripción del contenido: qué se ve, qué se cuenta, cómo se monta…"
              value={form.description}
              onChange={(e) => set('description')(e.target.value)}
            />
          </div>

          <div className="field">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <label htmlFor="c-copy">Copy / texto del post</label>
              <CopyCounters copy={form.copy} platforms={form.platforms} />
            </div>
            <textarea
              id="c-copy"
              className="textarea"
              rows={4}
              placeholder="Texto que acompaña a la publicación, hashtags, menciones…"
              value={form.copy}
              onChange={(e) => set('copy')(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="c-notes">Notas</label>
            <textarea id="c-notes" className="textarea" rows={2} value={form.notes} onChange={(e) => set('notes')(e.target.value)} />
          </div>
        </div>

        <aside className="editor-side">
          <div className="field">
            <span className="label">Estado</span>
            <div className="status-picker" role="radiogroup" aria-label="Estado">
              {STATUSES.map((s) => (
                <button
                  key={s.id}
                  role="radio"
                  aria-checked={form.status === s.id}
                  className={`status-pill status-${s.id} ${form.status === s.id ? 'active' : ''}`}
                  onClick={() => set('status')(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="c-owner">Responsable</label>
            <input
              id="c-owner"
              className="input"
              list="owner-options"
              placeholder="Diseño, Edición, RRSS…"
              maxLength={60}
              value={form.owner}
              onChange={(e) => set('owner')(e.target.value)}
            />
            <datalist id="owner-options">
              {owners.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </div>

          <div className="field">
            <span className="label">Fecha de publicación</span>
            <div className="input-group">
              <input type="date" className="input" value={form.date} onChange={(e) => set('date')(e.target.value)} aria-label="Fecha" />
              <input
                type="time"
                className="input"
                style={{ maxWidth: 120 }}
                value={form.time}
                disabled={!form.date}
                onChange={(e) => set('time')(e.target.value)}
                aria-label="Hora (opcional)"
              />
            </div>
            {form.date ? (
              <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setForm((f) => ({ ...f, date: '', time: '' }))}>
                Quitar fecha (pasa a ideas sin fecha)
              </button>
            ) : (
              <span className="hint">Sin fecha aparece en "Ideas sin fecha", junto al calendario.</span>
            )}
          </div>

          <ResourceChecklist resources={form.resources} onChange={set('resources')} />
        </aside>
      </div>

      <div className="modal-footer">
        {editing && (
          <>
            <button className="btn ghost danger" onClick={remove} disabled={Boolean(saving)}>
              {saving === 'delete' ? <Spinner size={15} /> : <Trash2 size={15} />} Eliminar
            </button>
            <button className="btn ghost" onClick={duplicate} disabled={Boolean(saving)}>
              {saving === 'duplicate' ? <Spinner size={15} /> : <Copy size={15} />} Duplicar
            </button>
          </>
        )}
        <span className="spacer" />
        <span className="muted small hide-mobile">Ctrl + Enter para guardar</span>
        <button className="btn" onClick={requestClose} disabled={Boolean(saving)}>
          Cancelar
        </button>
        <button className="btn primary" onClick={save} disabled={Boolean(saving)}>
          {saving === 'save' ? <Spinner size={15} /> : <Save size={15} />} Guardar
        </button>
      </div>
    </Modal>
  );
}
