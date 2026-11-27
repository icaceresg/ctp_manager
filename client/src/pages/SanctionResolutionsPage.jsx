import { useEffect, useRef, useState } from 'react';
import { Download, FileText, Pencil, Plus, Save } from 'lucide-react';
import { api } from '../api.js';
import { getIntlLocale, translate } from '../i18n/runtime.js';
import {
  SANCTION_NAME_LENGTH, SANCTION_PAGE_SIZE, SANCTION_PDF_BYTES, SANCTION_PDF_TYPE,
  SANCTION_SCOPES, SANCTION_TEXT_LENGTH, sanctionFileName,
} from '../../../shared/sanction-resolutions.js';
import '../operations/operations.css';
import './sanction-resolutions.css';

const endpoint = '/administration/sanction-resolutions';
const scopeNames = { ranked: 'manager.sanctionResolutions.ranked', circuit: 'manager.sanctionResolutions.circuit' };
const keyFor = key => 'manager.sanctionResolutions.' + key;
const label = (key, values) => translate(keyFor(key), values);
const dateLabel = value => new Intl.DateTimeFormat(getIntlLocale(), { dateStyle: 'medium', timeZone: 'UTC' })
  .format(new Date(value + 'T00:00:00Z'));

function editValues(item) {
  return {
    id: item?.id ?? crypto.randomUUID(),
    version: item?.version ?? 0,
    scope: item?.scope ?? 'ranked',
    player_name: item?.player_name ?? '',
    reason: item?.reason ?? '',
    starts_on: item?.starts_on ?? '',
    ends_on: item?.ends_on ?? '',
    indefinite: Boolean(item && item.ends_on === null),
    comments: item?.comments ?? '',
    published: Boolean(item?.published_at),
  };
}

async function encodePdf(file) {
  if (await file.slice(0, 5).text() !== '%PDF-') return null;
  const content_base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  return { name: file.name, content_base64 };
}

function ResolutionEditor({ item, onCancel, onSaved }) {
  const [values, setValues] = useState(() => editValues(item));
  // undefined keeps the current document, null removes it, and File replaces it.
  const [file, setFile] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const heading = useRef(null);
  const fileInput = useRef(null);

  useEffect(() => heading.current?.focus(), []);

  function set(key, value) {
    setValues(previous => ({ ...previous, [key]: value }));
  }

  function pickFile(event) {
    const chosen = event.target.files?.[0];
    if (!chosen) return;
    if (!sanctionFileName(chosen.name) || chosen.size > SANCTION_PDF_BYTES || (chosen.type && chosen.type !== SANCTION_PDF_TYPE)) {
      event.target.value = '';
      setFile(undefined);
      setError('invalidPdf');
      return;
    }
    setError('');
    setFile(chosen);
  }

  function resetFile(value) {
    if (fileInput.current) fileInput.current.value = '';
    setFile(value);
    setError('');
    setDownloadError('');
  }

  async function save(event) {
    event.preventDefault();
    setError('');
    const { version, indefinite, ...form } = values;
    if (!form.player_name.trim() || !form.reason.trim()) {
      setError('invalidFields');
      return;
    }
    if (!indefinite && (!form.ends_on || form.ends_on < form.starts_on)) {
      setError('invalidDates');
      return;
    }

    setBusy(true);
    try {
      let document = file;
      if (file) {
        document = await encodePdf(file).catch(() => null);
        if (!document) {
          setError('invalidPdf');
          return;
        }
      }
      await api.post(endpoint, {
        ...form, expected_version: version, ends_on: indefinite ? null : form.ends_on,
        ...(file === undefined ? {} : { document }),
      });
      onSaved(form.published);
    } catch (problem) {
      setError(({ 403: 'forbidden', 409: 'conflict', 413: 'invalidPdf', 422: 'invalidFields' })[problem.status] || 'saveFailed');
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    setDownloading(true);
    setDownloadError('');
    try {
      const { document } = await api.get(endpoint + '/' + item.id + '/document');
      if (!document) {
        setDownloadError('downloadFailed');
        return;
      }
      const bytes = Uint8Array.from(atob(document.content_base64), char => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: SANCTION_PDF_TYPE }));
      const link = window.document.createElement('a');
      link.href = url;
      link.download = document.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setDownloadError('downloadFailed');
    } finally {
      setDownloading(false);
    }
  }

  const savedDocument = file === undefined && Boolean(item?.document_name);

  return (
    <section className="op-card" aria-labelledby="sanction-editor-title">
      <div className="op-section-title">
        <h2 id="sanction-editor-title" ref={heading} tabIndex={-1}>{label(item ? 'edit' : 'new')}</h2>
      </div>
      <form onSubmit={save} aria-busy={busy}>
        <fieldset className="sanction-editor" disabled={busy}>
          <div className="op-form-grid sanction-editor-grid">
            <label className="op-field">{label('player')}
              <input required maxLength={SANCTION_NAME_LENGTH} value={values.player_name} onChange={event => set('player_name', event.target.value)} />
            </label>
            <label className="op-field">{label('scope')}
              <select value={values.scope} onChange={event => set('scope', event.target.value)}>
                {SANCTION_SCOPES.map(scope => <option key={scope} value={scope}>{translate(scopeNames[scope])}</option>)}
              </select>
            </label>
            <label className="op-field">{label('startsOn')}
              <input type="date" required max="9999-12-31" value={values.starts_on} onChange={event => set('starts_on', event.target.value)} />
            </label>
            <label className="op-field">{label('endsOn')}
              <input type="date" required={!values.indefinite} disabled={values.indefinite}
                min={values.starts_on || undefined} max="9999-12-31" value={values.indefinite ? '' : values.ends_on}
                onChange={event => set('ends_on', event.target.value)} />
            </label>
          </div>
          <label className="op-check"><input type="checkbox" checked={values.indefinite} onChange={event => set('indefinite', event.target.checked)} />{label('indefinite')}</label>
          <label className="op-field">{label('reason')}
            <textarea rows={4} required maxLength={SANCTION_TEXT_LENGTH} value={values.reason} onChange={event => set('reason', event.target.value)} />
          </label>
          <label className="op-field">{label('comments')}
            <textarea rows={3} maxLength={SANCTION_TEXT_LENGTH} value={values.comments} onChange={event => set('comments', event.target.value)} />
          </label>
          <label className="op-field">{label('document')}
            <input ref={fileInput} type="file" accept=".pdf,application/pdf" onChange={pickFile} aria-describedby="sanction-pdf-hint" />
            <small id="sanction-pdf-hint">{label('documentHelp')}</small>
          </label>
          {(savedDocument || file) && <div className="sanction-document">
            {savedDocument && <span>{item.document_name}</span>}
            <div className="btn-row">
              {savedDocument && <button className="btn sm" type="button" disabled={downloading} onClick={download}>
                <Download size={15} aria-hidden />{label(downloading ? 'downloading' : 'download')}
              </button>}
              <button className="btn ghost sm" type="button" onClick={() => resetFile(null)}>{label('removeDocument')}</button>
            </div>
          </div>}
          {item?.document_name && file !== undefined && <div>
            <button className="btn ghost sm" type="button" onClick={() => resetFile(undefined)}>{label('restoreDocument')}</button>
          </div>}
          {downloadError && <p className="op-error" role="alert">{label(downloadError)}</p>}
          <label className="op-field">{label('visibility')}
            <select value={values.published ? 'published' : 'draft'} onChange={event => set('published', event.target.value === 'published')}>
              <option value="draft">{label('draft')}</option>
              <option value="published">{label('published')}</option>
            </select>
            <small>{label('visibilityHelp')}</small>
          </label>
          {error && <p className="op-error" role="alert">{label(error)}</p>}
          <div className="btn-row">
            <button className="btn primary" type="submit"><Save size={16} aria-hidden />{label(busy ? 'saving' : 'save')}</button>
            <button className="btn ghost" type="button" onClick={onCancel}>{label('cancel')}</button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}

export default function SanctionResolutionsPage() {
  const [editing, setEditing] = useState(null);
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(false);
    api.get(endpoint + '?offset=' + offset, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setItems(result.items); })
      .catch(() => { if (!controller.signal.aborted) setLoadError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [offset, refresh]);

  function open(item = null) {
    setNotice('');
    setEditing({ item });
  }

  function saved(published) {
    setEditing(null);
    setNotice(published ? 'savedPublished' : 'savedDraft');
    setOffset(0);
    setRefresh(value => value + 1);
  }

  return (
    <div className="page op-page">
      <header className="op-heading">
        <div><h1>{label('title')}</h1><p>{label('description')}</p></div>
        {!editing && <button className="btn primary" type="button" onClick={() => open()}>
          <Plus size={17} aria-hidden />{label('new')}
        </button>}
      </header>
      {notice && <p className="op-notice" role="status">{label(notice)}</p>}
      {editing ? <ResolutionEditor item={editing.item} onCancel={() => {
        setEditing(null);
        setRefresh(value => value + 1);
      }} onSaved={saved} /> : (
        <section className="op-card" aria-label={label('title')} aria-busy={loading}>
          {loading ? <p role="status" className="muted">{label('loading')}</p>
            : loadError ? <div className="op-error" role="alert"><span>{label('loadFailed')}</span>
              <button type="button" className="btn sm" onClick={() => setRefresh(value => value + 1)}>{label('retry')}</button></div>
            : items.length === 0 ? <div className="op-empty"><FileText size={26} aria-hidden /><p>{label('empty')}</p></div>
            : <div className="op-table-wrap"><table className="op-table">
              <thead><tr>
                {['player', 'scope', 'duration', 'visibility', 'actions'].map(key => <th scope="col" key={key}>{label(key)}</th>)}
              </tr></thead>
              <tbody>{items.slice(0, SANCTION_PAGE_SIZE).map(item => <tr key={item.id}>
                <td className="sanction-player"><strong>{item.player_name}</strong></td>
                <td>{translate(scopeNames[item.scope])}</td>
                <td>{item.ends_on
                  ? label('dateRange', { start: dateLabel(item.starts_on), end: dateLabel(item.ends_on) })
                  : label('noEndRange', { start: dateLabel(item.starts_on) })}</td>
                <td><span className={'op-badge' + (item.published_at ? ' op-state-active' : '')}>{label(item.published_at ? 'published' : 'draft')}</span></td>
                <td><button type="button" className="btn sm" onClick={() => open(item)} aria-label={label('editPlayer', { player: item.player_name })}>
                  <Pencil size={15} aria-hidden />{label('edit')}
                </button></td>
              </tr>)}</tbody>
            </table></div>}
          {!loading && !loadError && (offset > 0 || items.length > SANCTION_PAGE_SIZE) && <div className="btn-row">
            <button type="button" className="btn ghost sm" disabled={offset === 0} onClick={() => setOffset(value => value - SANCTION_PAGE_SIZE)}>{label('previous')}</button>
            <button type="button" className="btn ghost sm" disabled={items.length <= SANCTION_PAGE_SIZE} onClick={() => setOffset(value => value + SANCTION_PAGE_SIZE)}>{label('next')}</button>
          </div>}
        </section>
      )}
    </div>
  );
}
