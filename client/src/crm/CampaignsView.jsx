import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { useApp, useData } from '../context.jsx';
import { Spinner } from '../components/ui.jsx';
import { Badge, DataTable } from '../operations/ui.jsx';
import { dateTime } from '../operations/model.js';
import { AB_MODES, CAMPAIGN_STATES, crm, localeName, percent, totals } from './model.js';

const BADGE = { draft: 'pending', scheduled: 'waiting', testing: 'in_progress', sending: 'in_progress', sent: 'approved', cancelled: 'cancelled' };

export function CampaignsView() {
  const { toast } = useApp();
  const navigate = useNavigate();
  const [state, setState] = useState('');
  const [page, setPage] = useState(0);
  const { data, loading, error, reload } = useData(() => crm('campaigns', { page, limit: 20, ...(state ? { state } : {}) }), [page, state]);
  const duplicate = async row => { try { const copy = await crm('campaign.duplicate', { id: row.id }); toast('Campaña duplicada como borrador.'); navigate(`/crm/campanas/${copy.id}`); } catch (failure) { toast(failure.message, 'error'); } };
  const remove = async row => {
    if (!window.confirm(`¿Eliminar la campaña «${row.name}»?`)) return;
    try { await crm('campaign.delete', { id: row.id }); toast('Campaña eliminada.'); reload(); } catch (failure) { toast(failure.message, 'error'); }
  };
  const columns = [
    { key: 'name', title: 'Campaña', render: row => <div><Link to={`/crm/campanas/${row.id}`}><strong>{row.name}</strong></Link><br /><small className="muted">{AB_MODES[row.ab_mode]} · {(row.locales || []).map(localeName).join(', ')}</small></div> },
    { key: 'state', title: 'Estado', render: row => <Badge value={BADGE[row.state]}>{CAMPAIGN_STATES[row.state] || row.state}</Badge> },
    { key: 'when', title: 'Envío', render: row => row.dispatched_at ? dateTime(row.dispatched_at) : row.scheduled_at ? `Programada · ${dateTime(row.scheduled_at)}` : '—' },
    { key: 'delivered', title: 'Entregados', render: row => { const t = totals(row.stats); return t.recipients ? `${t.delivered || 0} / ${t.recipients}` : '—'; } },
    { key: 'opened', title: 'Aperturas', render: row => { const t = totals(row.stats); return percent(t.opened, t.delivered); } },
    { key: 'clicked', title: 'Clics', render: row => { const t = totals(row.stats); return percent(t.clicked, t.delivered); } },
    { key: 'actions', title: 'Acciones', render: row => <div className="op-actions"><Link className="btn sm" to={`/crm/campanas/${row.id}`}>{row.state === 'draft' ? 'Editar' : 'Ver informe'}</Link><button type="button" className="btn sm" aria-label={`Duplicar ${row.name}`} onClick={() => duplicate(row)}><Copy size={14} /></button>{['draft', 'cancelled'].includes(row.state) && !row.dispatched_at && <button type="button" className="btn sm danger" aria-label={`Eliminar ${row.name}`} onClick={() => remove(row)}><Trash2 size={14} /></button>}</div> },
  ];
  return <section className="op-card">
    <div className="op-section-title"><div><h2>Campañas</h2><p>{data ? `${data.total} campañas` : 'Cargando…'}</p></div><Link className="btn primary" to="/crm/campanas/nueva"><Plus size={16} />Nueva campaña</Link></div>
    <div className="crm-row"><select aria-label="Filtrar por estado" value={state} onChange={event => { setState(event.target.value); setPage(0); }}><option value="">Todos los estados</option>{Object.entries(CAMPAIGN_STATES).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select>{loading && <Spinner size={14} />}</div>
    {error && <p className="op-error" role="alert">{error.message}</p>}
    {data && <DataTable rows={data.items} columns={columns} empty="Todavía no hay campañas" emptyDetail="Crea la primera campaña promocional." />}
    {data && <div className="op-actions"><button className="btn" disabled={loading || page === 0} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page + 1}</span><button className="btn" disabled={loading || !data.has_more} onClick={() => setPage(page + 1)}>Siguiente</button></div>}
  </section>;
}
