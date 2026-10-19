import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Mail, RefreshCw } from 'lucide-react';
import { useApp, useData } from '../context.jsx';
import { Spinner } from '../components/ui.jsx';
import { dateTime } from '../operations/model.js';
import { ContactsView } from '../crm/ContactsView.jsx';
import { SegmentsView } from '../crm/SegmentsView.jsx';
import { CampaignsView } from '../crm/CampaignsView.jsx';
import { CampaignEditor } from '../crm/CampaignEditor.jsx';
import { TemplatesView, TemplateEditor } from '../crm/TemplatesView.jsx';
import { CAMPAIGN_STATES, EMPTY_FILTERS, crm } from '../crm/model.js';
import '../operations/operations.css';
import '../crm/crm.css';

const SECTIONS = [['resumen', 'Resumen'], ['contactos', 'Contactos'], ['segmentos', 'Segmentos'], ['campanas', 'Campañas'], ['transaccionales', 'Transaccionales']];

/** CRM de comunicaciones. Solo administración CTP; los datos viven en CTP. */
export default function CrmPage() {
  const { section = 'resumen', id } = useParams();
  const { me } = useApp();
  const navigate = useNavigate();
  const [contactFilters, setContactFilters] = useState(null);
  if (!me?.is_admin) return <Navigate to="/operaciones/jornada" replace />;
  if (!SECTIONS.some(([key]) => key === section)) return <Navigate to="/crm/resumen" replace />;
  const openContacts = filters => { setContactFilters({ ...EMPTY_FILTERS, ...filters }); navigate('/crm/contactos'); };
  return <div className="page wide op-page crm-page">
    <header className="op-heading"><div><div className="op-eyebrow"><Mail size={15} /> CRM Y COMUNICACIONES</div><h1>{SECTIONS.find(([key]) => key === section)[1]}</h1></div></header>
    <nav className="op-tabs" aria-label="CRM">{SECTIONS.map(([key, title]) => <Link key={key} className={section === key ? 'active' : ''} aria-current={section === key ? 'page' : undefined} to={`/crm/${key}`}>{title}</Link>)}</nav>
    {section === 'resumen' && <Overview />}
    {section === 'contactos' && <ContactsView key={JSON.stringify(contactFilters)} initialFilters={contactFilters} />}
    {section === 'segmentos' && <SegmentsView onOpenContacts={openContacts} />}
    {section === 'campanas' && (id ? <CampaignEditor key={id} id={id} /> : <CampaignsView />)}
    {section === 'transaccionales' && (id ? <TemplateEditor key={id} templateKey={decodeURIComponent(id)} /> : <TemplatesView />)}
  </div>;
}

function Overview() {
  const { data, loading, error, reload } = useData(() => crm('overview'), []);
  if (loading && !data) return <div className="op-loading"><Spinner />Cargando CRM…</div>;
  if (error && !data) return <div className="op-error" role="alert">{error.message}<button className="btn" onClick={reload}>Reintentar</button></div>;
  const campaigns = data?.campaigns || {};
  return <>
    <div className="op-metrics">
      <Link className="op-metric" to="/crm/contactos"><span>Personas en CTP</span><strong>{data.contacts}</strong></Link>
      <div className="op-metric"><span>Con correos promocionales</span><strong>{data.opted_in}</strong></div>
      <div className="op-metric"><span>Alcanzables (consentimiento y correo confirmado)</span><strong>{data.reachable}</strong></div>
      <Link className="op-metric" to="/crm/campanas"><span>Campañas enviadas</span><strong>{campaigns.sent ?? 0}</strong></Link>
      <Link className="op-metric" to="/crm/campanas"><span>Programadas o en curso</span><strong>{(campaigns.scheduled ?? 0) + (campaigns.testing ?? 0) + (campaigns.sending ?? 0)}</strong></Link>
      <Link className="op-metric" to="/crm/transaccionales"><span>Transaccionales personalizados</span><strong>{data.templates_customized}</strong></Link>
    </div>
    <section className="op-card">
      <div className="op-section-title"><h2>Cómo funciona</h2><button className="btn sm" disabled={loading} onClick={reload}><RefreshCw size={14} />Actualizar</button></div>
      <ul className="crm-list">
        <li><strong>Contactos y segmentos:</strong> todas las cuentas de CTP con su idioma, consentimiento, equipos y pases (actuales o anteriores: Team Pass, Season Pass, Circuit Pass y entradas de torneo).</li>
        <li><strong>Campañas:</strong> un contenido por idioma (cada persona recibe el suyo), editor visual o HTML con imágenes, pruebas A/B, envío de prueba, envío inmediato o programado y seguimiento de aperturas y clics.</li>
        <li><strong>Consentimiento:</strong> solo reciben campañas las cuentas con la casilla de correos promocionales activada y el correo confirmado. Darse de baja anula los envíos pendientes.</li>
        <li><strong>Transaccionales:</strong> los avisos de actividad y los correos de cuenta de Supabase Auth se editan con el mismo editor. Si no hay personalización, se usa el texto revisado por defecto.</li>
      </ul>
      <p className="muted crm-hint">Borradores: {campaigns.draft ?? 0} · Canceladas: {campaigns.cancelled ?? 0}{data.defaults_synced_at ? ` · Textos por defecto sincronizados ${dateTime(data.defaults_synced_at)}` : ' · El worker de correo aún no ha sincronizado los textos por defecto'}</p>
      <div className="op-actions"><Link className="btn primary" to="/crm/campanas/nueva">Nueva campaña</Link><Link className="btn" to="/crm/contactos">Ver contactos</Link><Link className="btn" to="/crm/transaccionales">Editar transaccionales</Link></div>
    </section>
    {Object.keys(campaigns).length > 0 && <p className="muted">{Object.entries(campaigns).map(([state, count]) => `${CAMPAIGN_STATES[state] || state}: ${count}`).join(' · ')}</p>}
  </>;
}
