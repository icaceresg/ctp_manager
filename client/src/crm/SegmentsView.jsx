import { useState } from 'react';
import { Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useApp, useData } from '../context.jsx';
import { Modal, Spinner } from '../components/ui.jsx';
import { DataTable } from '../operations/ui.jsx';
import { dateTime } from '../operations/model.js';
import { AudienceFilters } from './AudienceFilters.jsx';
import { EMPTY_FILTERS, compactFilters, crm, filtersSummary } from './model.js';

/** Segmentos guardados: filtros reutilizables para contactos y campañas. */
export function SegmentsView({ onOpenContacts }) {
  const { toast } = useApp();
  const { data, loading, reload } = useData(() => crm('segments'), []);
  const [editing, setEditing] = useState(null);
  const [counts, setCounts] = useState({});
  const count = async segment => {
    setCounts(current => ({ ...current, [segment.id]: '…' }));
    try { const value = await crm('audience', { filters: segment.filters }); setCounts(current => ({ ...current, [segment.id]: `${value.total} personas · ${value.reachable} con promocionales y correo confirmado` })); }
    catch (failure) { setCounts(current => ({ ...current, [segment.id]: failure.message })); }
  };
  const remove = async segment => {
    if (!window.confirm(`¿Eliminar el segmento «${segment.name}»? Las campañas ya creadas conservan sus filtros.`)) return;
    try { await crm('segment.delete', { id: segment.id }); toast('Segmento eliminado.'); reload(); } catch (failure) { toast(failure.message, 'error'); }
  };
  const columns = [
    { key: 'name', title: 'Segmento', render: row => <strong>{row.name}</strong> },
    { key: 'filters', title: 'Criterios', render: row => <span className="crm-summary">{filtersSummary(row.filters)}</span> },
    { key: 'count', title: 'Tamaño', render: row => counts[row.id] ? <small>{counts[row.id]}</small> : <button type="button" className="btn sm" onClick={() => count(row)}>Calcular</button> },
    { key: 'updated_at', title: 'Actualizado', render: row => dateTime(row.updated_at) },
    { key: 'actions', title: 'Acciones', render: row => <div className="op-actions"><button type="button" className="btn sm" onClick={() => onOpenContacts(row.filters)}><Users size={14} />Ver contactos</button><button type="button" className="btn sm" aria-label={`Editar ${row.name}`} onClick={() => setEditing({ ...row, filters: { ...EMPTY_FILTERS, ...row.filters } })}><Pencil size={14} /></button><button type="button" className="btn sm danger" aria-label={`Eliminar ${row.name}`} onClick={() => remove(row)}><Trash2 size={14} /></button></div> },
  ];
  return <section className="op-card">
    <div className="op-section-title"><div><h2>Segmentos</h2><p>Grupos de personas definidos por filtros. Se recalculan en cada consulta y en el momento del envío.</p></div><button className="btn primary" onClick={() => setEditing({ name: '', filters: EMPTY_FILTERS })}><Plus size={16} />Nuevo segmento</button></div>
    {loading && !data ? <Spinner /> : <DataTable rows={data?.items || []} columns={columns} empty="Todavía no hay segmentos" emptyDetail="Crea uno aquí o guarda los filtros desde Contactos." />}
    {editing && <SegmentDialog segment={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
  </section>;
}

function SegmentDialog({ segment, onClose, onSaved }) {
  const { toast } = useApp();
  const [name, setName] = useState(segment.name);
  const [filters, setFilters] = useState(segment.filters);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await crm('segment.save', { ...(segment.id ? { id: segment.id } : {}), name: name.trim(), filters: compactFilters(filters) }); toast('Segmento guardado.'); onSaved(); }
    catch (failure) { toast(failure.message, 'error'); } finally { setBusy(false); }
  };
  return <Modal title={segment.id ? 'Editar segmento' : 'Nuevo segmento'} onClose={busy ? undefined : onClose} size="xl" footer={<><button className="btn" disabled={busy} onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !name.trim()} onClick={save}>{busy && <Spinner size={14} />}Guardar segmento</button></>}>
    <label className="op-field"><span>Nombre</span><input value={name} maxLength={120} onChange={event => setName(event.target.value)} /></label>
    <AudienceFilters value={filters} onChange={setFilters} />
  </Modal>;
}
