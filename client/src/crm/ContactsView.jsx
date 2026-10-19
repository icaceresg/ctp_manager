import { useEffect, useState } from 'react';
import { CheckCircle2, CircleSlash, Save } from 'lucide-react';
import { useApp } from '../context.jsx';
import { Spinner } from '../components/ui.jsx';
import { Badge, DataTable } from '../operations/ui.jsx';
import { dateTime } from '../operations/model.js';
import { AudienceFilters } from './AudienceFilters.jsx';
import { EMPTY_FILTERS, PASSES, ROLES, compactFilters, crm, localeName } from './model.js';

export function useDebounced(value, delay = 350) {
  const [current, setCurrent] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setCurrent(value), delay); return () => clearTimeout(timer); }, [value, delay]);
  return current;
}

/** Todas las personas de CTP con su consentimiento, idioma, equipos y pases. */
export function ContactsView({ initialFilters }) {
  const { toast } = useApp();
  const [filters, setFilters] = useState(initialFilters || EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [segmentName, setSegmentName] = useState('');
  const debounced = useDebounced(filters);
  const key = JSON.stringify(compactFilters(debounced));
  useEffect(() => { setPage(0); }, [key]);
  useEffect(() => {
    let current = true; setLoading(true); setError('');
    crm('contacts', { filters: compactFilters(debounced), page, limit: 25 }).then(value => { if (current) setResult(value); }).catch(failure => { if (current) setError(failure.message); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [key, page]);
  const saveSegment = async () => {
    try { await crm('segment.save', { name: segmentName.trim(), filters: compactFilters(filters) }); setSegmentName(''); toast('Segmento guardado.'); }
    catch (failure) { toast(failure.message, 'error'); }
  };
  const columns = [
    { key: 'username', title: 'Persona', render: row => <div><strong>{row.username}</strong><br /><small className="muted">{row.gamertag || '—'} · {ROLES[row.role] || row.role}</small></div> },
    { key: 'email', title: 'Correo', render: row => <span className="crm-email">{row.email || '—'} {row.email_confirmed ? <CheckCircle2 size={13} aria-label="Confirmado" className="crm-ok" /> : <CircleSlash size={13} aria-label="Sin confirmar" className="muted" />}</span> },
    { key: 'marketing_opt_in', title: 'Promocionales', render: row => <Badge value={row.marketing_opt_in ? 'active' : 'paused'}>{row.marketing_opt_in ? 'Aceptados' : 'No'}</Badge> },
    { key: 'locale', title: 'Idioma', render: row => localeName(row.locale) },
    { key: 'teams', title: 'Equipos', render: row => row.teams?.length ? row.teams.map(team => team.name).join(', ') : <span className="muted">Sin equipo</span> },
    { key: 'passes', title: 'Pases', render: row => <div className="crm-tags">{(row.passes || []).map(kind => <span key={kind} className="crm-tag active">{PASSES[kind] || kind}</span>)}{(row.past_passes || []).filter(kind => !(row.passes || []).includes(kind)).map(kind => <span key={kind} className="crm-tag" title="Estuvo en un club con este pase">{PASSES[kind] || kind} · antes</span>)}{!row.passes?.length && !row.past_passes?.length && <span className="muted">—</span>}</div> },
    { key: 'campaigns_received', title: 'Campañas', render: row => row.campaigns_received ?? 0 },
    { key: 'created_at', title: 'Alta', render: row => dateTime(row.created_at) },
  ];
  return <section className="op-card">
    <div className="op-section-title"><div><h2>Contactos</h2><p>{result ? `${result.total} personas con estos filtros` : 'Cargando…'}</p></div></div>
    <AudienceFilters value={filters} onChange={setFilters} />
    <div className="crm-row"><input aria-label="Nombre del segmento" placeholder="Nombre del segmento" maxLength={120} value={segmentName} onChange={event => setSegmentName(event.target.value)} /><button type="button" className="btn sm" disabled={!segmentName.trim()} onClick={saveSegment}><Save size={14} />Guardar filtros como segmento</button>{loading && <Spinner size={14} />}</div>
    {error && <p className="op-error" role="alert">{error}</p>}
    {result && <DataTable rows={result.items} columns={columns} empty="No hay personas con estos filtros" emptyDetail="Amplía la búsqueda o cambia los filtros." />}
    {result && <div className="op-actions"><button className="btn" disabled={loading || page === 0} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page + 1} de {Math.max(1, Math.ceil(result.total / 25))}</span><button className="btn" disabled={loading || !result.has_more} onClick={() => setPage(page + 1)}>Siguiente</button></div>}
  </section>;
}
