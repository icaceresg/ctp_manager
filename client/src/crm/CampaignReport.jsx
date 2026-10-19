import { useEffect, useState } from 'react';
import { RefreshCw, Trophy, XCircle, Undo2 } from 'lucide-react';
import { useApp } from '../context.jsx';
import { Spinner } from '../components/ui.jsx';
import { Badge, DataTable } from '../operations/ui.jsx';
import { dateTime } from '../operations/model.js';
import { RECIPIENT_STATES, crm, localeName, percent, totals } from './model.js';

/** Resultados por variante, decisión del ganador y lista de destinatarios. */
export function CampaignReport({ campaign, onChanged }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState({ variant: '', state: '', page: 0 });
  const [recipients, setRecipients] = useState(null);
  const [winnerConfirm, setWinnerConfirm] = useState('');
  const load = () => crm('campaign.recipients', { id: campaign.id, limit: 25, ...filter }).then(setRecipients).catch(failure => toast(failure.message, 'error'));
  useEffect(() => { load(); }, [campaign.id, campaign.version, JSON.stringify(filter)]);
  const act = async (action, data, message) => {
    setBusy(true);
    try { const value = await crm(action, { id: campaign.id, ...data }); toast(message(value)); await onChanged(); }
    catch (failure) { toast(failure.message, 'error'); } finally { setBusy(false); }
  };
  const all = totals(campaign.stats);
  const variants = Object.keys(campaign.stats || {}).sort();
  return <section className="op-card">
    <div className="op-section-title"><div><h2>Resultados</h2><p>{campaign.scheduled_at && campaign.state === 'scheduled' ? `Programada para ${dateTime(campaign.scheduled_at)}` : campaign.dispatched_at ? `Envío iniciado ${dateTime(campaign.dispatched_at)}${campaign.completed_at ? ` · completado ${dateTime(campaign.completed_at)}` : ''}` : 'Pendiente de envío'}</p></div>
      <div className="op-actions"><button className="btn sm" disabled={busy} onClick={onChanged}><RefreshCw size={14} />Actualizar</button>
        {campaign.state === 'scheduled' && <button className="btn sm" disabled={busy} onClick={() => act('campaign.unschedule', {}, () => 'Programación anulada. La campaña vuelve a borrador.')}><Undo2 size={14} />Volver a borrador</button>}
        {['scheduled', 'testing', 'sending'].includes(campaign.state) && <button className="btn sm danger" disabled={busy} onClick={() => window.confirm('¿Cancelar la campaña? Los correos que aún no han salido no se enviarán.') && act('campaign.cancel', {}, () => 'Campaña cancelada.')}><XCircle size={14} />Cancelar envío</button>}
      </div></div>
    <div className="op-metrics">
      {[['Destinatarios', all.recipients ?? 0], ['En cola', all.queued ?? 0], ['Entregados', all.delivered ?? 0], ['Aperturas', `${all.opened ?? 0} · ${percent(all.opened, all.delivered)}`], ['Clics', `${all.clicked ?? 0} · ${percent(all.clicked, all.delivered)}`], ['No enviados / fallidos', `${(all.suppressed ?? 0) + (all.failed ?? 0)}`]].map(([title, value]) => <div className="op-metric" key={title}><span>{title}</span><strong>{value}</strong></div>)}
    </div>
    {variants.length > 1 && <div className="crm-variants">{variants.map(v => { const s = campaign.stats[v]; return <div key={v} className={`crm-variant ${campaign.winner === v ? 'winner' : ''}`}>
      <h4>Variante {v}{campaign.winner === v && <span className="crm-tag active"><Trophy size={12} />Ganadora</span>}</h4>
      <p>{s.delivered} entregados de {s.recipients}</p><p>Aperturas: <strong>{percent(s.opened, s.delivered)}</strong> · Clics: <strong>{percent(s.clicked, s.delivered)}</strong></p>
      {campaign.state === 'testing' && <label className="op-check"><input type="radio" name="winner" checked={winnerConfirm === v} onChange={() => setWinnerConfirm(v)} />Elegir {v} como ganadora</label>}
    </div>; })}</div>}
    {campaign.state === 'testing' && <div className="op-notice">El grupo de prueba ({campaign.ab_test_percent} %) ya está recibiendo las dos variantes. Cuando tengas datos suficientes, elige la ganadora: se enviará al resto de la audiencia con consentimiento vigente.
      <div className="op-actions"><button className="btn primary" disabled={busy || !winnerConfirm} onClick={() => window.confirm(`¿Enviar la variante ${winnerConfirm} al resto de la audiencia?`) && act('campaign.winner', { variant: winnerConfirm, confirm_id: campaign.id }, value => `Variante ${winnerConfirm} en marcha: ${value.queued ?? 0} correos más en cola.`)}><Trophy size={14} />Enviar ganadora al resto</button></div></div>}
    <h3>Destinatarios</h3>
    <div className="crm-row">
      <select aria-label="Variante" value={filter.variant} onChange={event => setFilter({ ...filter, variant: event.target.value, page: 0 })}><option value="">Todas las variantes</option><option value="A">Variante A</option><option value="B">Variante B</option></select>
      <select aria-label="Estado" value={filter.state} onChange={event => setFilter({ ...filter, state: event.target.value, page: 0 })}><option value="">Todos los estados</option>{Object.entries(RECIPIENT_STATES).map(([key, title]) => <option key={key} value={key}>{title}</option>)}<option value="opened">Han abierto</option><option value="clicked">Han hecho clic</option></select>
      {!recipients && <Spinner size={14} />}
    </div>
    {recipients && <DataTable rows={recipients.items} empty="Sin destinatarios en esta vista" emptyDetail="Los destinatarios aparecen cuando empieza el envío." columns={[
      { key: 'username', title: 'Persona', render: row => <div><strong>{row.username}</strong><br /><small className="muted">{row.email}</small></div> },
      { key: 'variant', title: 'Variante', render: row => `${row.variant}${row.phase === 'test' ? ' · prueba' : ''}` },
      { key: 'locale', title: 'Idioma', render: row => localeName(row.locale) },
      { key: 'state', title: 'Estado', render: row => <Badge value={row.state === 'delivered' ? 'approved' : row.state === 'queued' ? 'pending' : 'rejected'}>{RECIPIENT_STATES[row.state]}{row.error_code ? ` · ${row.error_code}` : ''}</Badge> },
      { key: 'delivered_at', title: 'Entregado', render: row => row.delivered_at ? dateTime(row.delivered_at) : '—' },
      { key: 'opened_at', title: 'Apertura', render: row => row.opened_at ? `${dateTime(row.opened_at)} (${row.open_count})` : '—' },
      { key: 'clicked_at', title: 'Clic', render: row => row.clicked_at ? `${dateTime(row.clicked_at)} (${row.click_count})` : '—' },
    ]} />}
    {recipients && <div className="op-actions"><button className="btn" disabled={filter.page === 0} onClick={() => setFilter({ ...filter, page: filter.page - 1 })}>Anterior</button><span>Página {filter.page + 1} de {Math.max(1, Math.ceil(recipients.total / 25))}</span><button className="btn" disabled={!recipients.has_more} onClick={() => setFilter({ ...filter, page: filter.page + 1 })}>Siguiente</button></div>}
    <p className="muted crm-hint">Las aperturas dependen de que el cliente de correo cargue imágenes, así que son una estimación. Los clics se registran con enlaces de seguimiento.</p>
  </section>;
}
