import { useId, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Activity, CircleAlert, Clock3, Cpu, Database, HardDrive, MemoryStick, RefreshCw, Server, ShieldCheck, Users } from 'lucide-react';
import { useApp } from '../context.jsx';
import { Spinner } from '../components/ui.jsx';
import { DataTable, Empty } from '../operations/ui.jsx';
import { useMetricsSnapshot } from './useMetricsSnapshot.js';
import { ALERT_LABELS, ROUTE_LABELS, SERVICE_LABELS, chartSegments, metricBytes, metricNumber, metricPercent, metricSeconds, metricTime, metricsAllowedHost, metricsHistory, numeric } from './metricsModel.js';
import '../operations/operations.css';
import './metrics.css';

const ENVIRONMENT_LABELS = { pre: 'PRE', prod: 'PROD', host: 'Servidor' };
const tone = (value, warning, critical) => !numeric(value) ? '' : value >= critical ? 'is-critical' : value >= warning ? 'is-warning' : '';
const available = (source, key) => source?.available === true ? source[key] : null;
const totalBytes = (total, availableBytes) => numeric(total) && numeric(availableBytes) && total >= availableBytes ? total - availableBytes : null;
const byteRate = value => numeric(value) ? `${metricBytes(value)}/s` : 'Sin datos';

function Metric({ label, value, detail, icon: Icon, status = '' }) {
  return <div className={`op-metric metrics-stat ${status}`}><span>{Icon && <Icon size={16} aria-hidden />}{label}</span><strong>{value}</strong>{detail && <small className="muted">{detail}</small>}</div>;
}

function Capacity({ label, percent, detail, icon: Icon, warning = 85, critical = 95 }) {
  return <div className={`metrics-capacity ${tone(percent, warning, critical)}`}>
    <span className="metrics-capacity-label"><Icon size={16} aria-hidden />{label}</span><strong>{metricPercent(percent)}</strong>
    {numeric(percent) ? <div className="metrics-capacity-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, percent)}><i style={{ width: `${Math.min(100, percent)}%` }} /></div> : <div className="metrics-capacity-track is-unavailable" aria-hidden />}
    <small>{detail}</small>
  </div>;
}

function Facts({ rows }) {
  return <dl className="metrics-facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function TimeChart({ title, description, history, series, percent = false, intervalSeconds = 60 }) {
  const id = useId();
  const values = history.flatMap(row => series.map(item => row[item.key])).filter(numeric);
  const pointsAvailable = history.filter(row => series.some(item => numeric(row[item.key]))).length;
  const maximum = percent ? 100 : Math.max(1, ...values);
  const ready = pointsAvailable >= 2 && Date.parse(history.at(-1)?.at) > Date.parse(history[0]?.at);
  return <section className="op-card metrics-chart-card">
    <div className="op-section-title"><div><h2>{title}</h2><p>{description}</p></div></div>
    <ul className="metrics-legend">{series.map(item => <li key={item.key}><i style={{ background: item.color }} />{item.label}</li>)}</ul>
    {ready ? <div className="metrics-plot">
      <div className="metrics-chart-axis"><span>{metricNumber(maximum)}{percent ? ' %' : ''}</span><span>0</span></div>
      <svg className="metrics-chart" viewBox="0 0 640 150" preserveAspectRatio="none" role="img" aria-labelledby={`${id}-title ${id}-description`}>
        <title id={`${id}-title`}>{title}</title><desc id={`${id}-description`}>{description}. Hora de Madrid. Los huecos corresponden a muestras no disponibles.</desc>
        {[10, 66, 122].map(y => <line key={y} x1="4" x2="636" y1={y} y2={y} className="metrics-chart-grid" />)}
        {series.map(item => <g key={item.key} fill="none" stroke={item.color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          {chartSegments(history, item.key, maximum, intervalSeconds).map((segment, index) => segment.length > 1
            ? <path key={index} d={segment.map((point, i) => `${i ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')} />
            : <circle key={index} cx={segment[0].x} cy={segment[0].y} r="2.5" fill={item.color} stroke="none" />)}
        </g>)}
      </svg>
      <div className="metrics-chart-times"><time dateTime={history[0]?.at}>{metricTime(history[0]?.at, true)}</time><time dateTime={history.at(-1)?.at}>{metricTime(history.at(-1)?.at, true)}</time></div>
    </div> : <div className="metrics-chart-empty"><Activity size={24} aria-hidden /><strong>Sin datos suficientes</strong><p>La tendencia aparecerá al disponer de dos muestras. No se dibujan valores estimados.</p></div>}
  </section>;
}

function AlertList({ alerts }) {
  if (!alerts.length) return <div className="metrics-alerts-clear"><ShieldCheck size={17} aria-hidden /><span>Sin alertas en esta lectura.</span></div>;
  return <div className="metrics-alerts" aria-label="Alertas de monitorización">{alerts.map((alert, index) => <article className={`metrics-alert is-${alert.severity}`} key={`${alert.code}-${alert.scope}-${index}`}>
    <CircleAlert size={18} aria-hidden /><div><strong>{ALERT_LABELS[alert.code] || 'Señal de monitorización'}</strong><span>{ENVIRONMENT_LABELS[alert.scope] || 'Servidor'}{numeric(alert.value) ? ` · Lectura ${metricNumber(alert.value)}` : ''}{numeric(alert.threshold) ? ` · Umbral ${metricNumber(alert.threshold)}` : ''}</span></div><small>{alert.severity === 'critical' ? 'Revisar' : alert.severity === 'warning' ? 'Atención' : 'Información'}</small>
  </article>)}</div>;
}

/** Aggregates only. Rendering this view does not fetch, create a session or execute a game action. */
export function MetricsDashboard({ data, environment, setEnvironment, hours, setHours }) {
  const host = data.host || {}, selected = data.environments?.[environment] || {};
  const traffic = selected.traffic, activity = selected.activity, database = selected.database;
  const history = metricsHistory(data.history, data.generatedAt, hours);
  const interval = numeric(data.source?.intervalSeconds) && data.source.intervalSeconds > 0 ? data.source.intervalSeconds : 60;
  const services = (data.services || []).filter(row => row.environment === environment || row.environment === 'host');
  const scopedAlerts = (data.alerts || []).filter(alert => alert.scope === environment || alert.scope === 'host');
  const coverage = traffic?.coverageFrom || data.source?.collectionStartedAt;
  return <>
    <div className="metrics-filter-bar">
      <div className="metrics-segmented" role="group" aria-label="Entorno de la actividad y el tráfico">{['pre', 'prod'].map(value => <button key={value} type="button" aria-pressed={environment === value} onClick={() => setEnvironment(value)}>{ENVIRONMENT_LABELS[value]}</button>)}</div>
      <p>Actividad y tráfico de <strong>{ENVIRONMENT_LABELS[environment]}</strong> · recursos del servidor compartido</p>
      <label>Gráficas<select value={hours} onChange={event => setHours(Number(event.target.value))}>{[1, 6, 24].map(value => <option key={value} value={value}>Últimas {value === 1 ? '1 hora' : `${value} horas`}</option>)}</select></label>
    </div>
    <AlertList alerts={scopedAlerts} />
    <section className="op-card metrics-server-card">
      <div className="op-section-title"><div><h2><Server size={20} aria-hidden />Servidor compartido</h2><p>Recursos de la VPS que aloja PRE y PROD.</p></div><span className="metrics-pill">{metricNumber(host.cpuCores, 0)} CPU</span></div>
      <div className="metrics-capacities">
        <Capacity label="CPU en uso" percent={host.cpuPercent} icon={Cpu} detail={`Espera de disco: ${metricPercent(host.iowaitPercent)}`} />
        <Capacity label="Memoria en uso" percent={host.memoryUsedPercent} icon={MemoryStick} detail={`${metricBytes(host.memoryAvailableBytes)} disponibles de ${metricBytes(host.memoryTotalBytes)}`} />
        <Capacity label="Disco en uso" percent={host.diskUsedPercent} icon={HardDrive} detail={`${metricBytes(host.diskFreeBytes)} libres de ${metricBytes(host.diskTotalBytes)}`} />
        <Capacity label="Swap en uso" percent={host.swapUsedPercent} icon={Database} warning={60} critical={90} detail={`${metricBytes(host.swapUsedBytes)} de ${metricBytes(host.swapTotalBytes)}`} />
      </div>
      <Facts rows={[
        ['Carga 1 / 5 / 15 min', [host.load1, host.load5, host.load15].map(value => metricNumber(value, 2)).join(' / ')],
        ['Memoria usada', metricBytes(totalBytes(host.memoryTotalBytes, host.memoryAvailableBytes))],
        ['Entrada / salida de swap', `${byteRate(host.swapInBytesPerSec)} · ${byteRate(host.swapOutBytesPerSec)}`],
        ['Presión CPU / memoria / disco · 10 s', [host.pressureCpu10, host.pressureMem10, host.pressureIo10].map(metricPercent).join(' / ')],
        ['Eventos OOM · 24 h', metricNumber(host.oomEvents24h, 0)], ['Servicios del sistema fallidos', metricNumber(host.failedUnitsCount, 0)],
      ]} />
      <p className="metrics-footnote">CPU del servidor: 100 % representa el conjunto de sus núcleos. La swap ocupada no indica por sí sola un fallo: revisa también su actividad y la memoria disponible.</p>
    </section>

    <div className="metrics-chart-grid-layout">
      <TimeChart title="CPU y memoria" description="Porcentaje de uso del servidor compartido" history={history} intervalSeconds={interval} percent series={[{ key: 'cpuPercent', label: 'CPU', color: '#d4a843' }, { key: 'memoryUsedPercent', label: 'Memoria', color: '#60b7c7' }]} />
      <TimeChart title={`Tráfico de ${ENVIRONMENT_LABELS[environment]}`} description="Peticiones/min (media del intervalo)" history={history} intervalSeconds={interval} series={[{ key: `${environment}Requests`, label: 'HTTP', color: '#d4a843' }, { key: `${environment}5xx`, label: 'Errores 5xx', color: '#ef7184' }]} />
    </div>

    <section className="op-card">
      <div className="op-section-title"><div><h2>Tráfico HTTP · {ENVIRONMENT_LABELS[environment]}</h2><p>{traffic?.available ? `Cobertura desde ${metricTime(coverage)} · hora de Madrid${traffic.partial ? ' · intervalo parcial' : ''}` : 'La fuente de tráfico no está disponible en esta lectura.'}</p></div><span className="metrics-pill">{traffic?.partial ? 'Cobertura parcial' : 'Logs del servidor'}</span></div>
      <div className="op-metrics metrics-traffic-stats">
        <Metric label="Peticiones · 5 min" value={metricNumber(available(traffic, 'requests5m'), 0)} icon={Activity} />
        <Metric label="Peticiones · 1 h" value={metricNumber(available(traffic, 'requests1h'), 0)} />
        <Metric label="Peticiones · 24 h" value={metricNumber(available(traffic, 'requests24h'), 0)} />
        <Metric label="Documentos HTML · 24 h" value={metricNumber(available(traffic, 'documents24h'), 0)} detail="Cargas atendidas por el servidor" />
      </div>
      <Facts rows={[
        ['Tráfico transferido · 24 h', metricBytes(available(traffic, 'bytes24h'))], ['Peticiones de bots · 24 h', metricNumber(available(traffic, 'bots24h'), 0)],
        ['Respuestas 4xx · 24 h', metricNumber(available(traffic, 'errors4xx24h'), 0)], ['Errores 5xx · 24 h', metricNumber(available(traffic, 'errors5xx24h'), 0)],
        ['Latencia p50', numeric(available(traffic, 'p50Ms')) ? `${metricNumber(traffic.p50Ms)} ms` : 'Sin datos'], ['Latencia p95', numeric(available(traffic, 'p95Ms')) ? `${metricNumber(traffic.p95Ms)} ms` : 'Sin datos'],
      ]} />
      <p className="metrics-footnote">Las peticiones se calculan con los logs ya existentes. No son visitantes únicos. Las cargas HTML no incluyen las navegaciones internas de la web sin recarga; no equivalen a todas las páginas vistas. Los totales y latencias conservan su intervalo de 24 h aunque cambies las gráficas.</p>
    </section>

    <section className="op-card">
      <div className="op-section-title"><div><h2>Jugadores y cuentas · {ENVIRONMENT_LABELS[environment]}</h2><p>{activity?.available ? 'Actividad agregada de CTP; no expone cuentas ni datos personales.' : 'La actividad de CTP no está disponible en esta lectura.'}</p></div><Users size={20} aria-hidden /></div>
      <div className="op-metrics">
        <Metric label="Jugadores buscando" value={metricNumber(available(activity, 'waitingPlayers'), 0)} icon={Users} detail="Presencia vigente en las colas" />
        <Metric label="Jugadores en partida" value={metricNumber(available(activity, 'activePlayers'), 0)} detail="Participantes de Ranked activas" />
        <Metric label="Partidas activas" value={metricNumber(available(activity, 'activeMatches'), 0)} />
        <Metric label="Partidas cerradas · 24 h" value={metricNumber(available(activity, 'closedMatches24h'), 0)} />
      </div>
      <Facts rows={[
        ['Cuentas registradas', metricNumber(available(activity, 'accounts'), 0)], ['Cuentas confirmadas', metricNumber(available(activity, 'confirmedAccounts'), 0)],
        ['Registros · 24 h', metricNumber(available(activity, 'registrations24h'), 0)], ['Cuentas con acceso · 24 h', metricNumber(available(activity, 'signIns24h'), 0)], ['Cuentas con acceso · 5 min', metricNumber(available(activity, 'signIns5m'), 0)],
      ]} />
      <p className="metrics-footnote">Las cuentas con acceso cuentan cuentas diferentes cuyo último acceso está dentro del intervalo; no son el número de sesiones ni los usuarios conectados. Los jugadores buscando o en partida se leen del estado real de Ranked.</p>
    </section>

    <div className="metrics-chart-grid-layout">
      <TimeChart title={`Actividad Ranked · ${ENVIRONMENT_LABELS[environment]}`} description="Jugadores con presencia vigente" history={history} intervalSeconds={interval} series={[{ key: `${environment}ActivePlayers`, label: 'En partida', color: '#d4a843' }, { key: `${environment}WaitingPlayers`, label: 'Buscando', color: '#60b7c7' }]} />
      <TimeChart title="Disco y swap" description="Porcentaje de uso del servidor compartido" history={history} intervalSeconds={interval} percent series={[{ key: 'diskUsedPercent', label: 'Disco', color: '#60b7c7' }, { key: 'swapUsedPercent', label: 'Swap', color: '#c294cf' }]} />
    </div>

    <section className="op-card">
      <div className="op-section-title"><div><h2>Base de datos · {ENVIRONMENT_LABELS[environment]}</h2><p>{database?.available ? 'Conexiones y transacciones en la última lectura.' : 'La base de datos no está disponible en esta lectura.'}</p></div><Database size={20} aria-hidden /></div>
      <div className="op-metrics">
        <Metric label="Conexiones" value={metricNumber(available(database, 'connections'), 0)} detail={`Máximo configurado: ${metricNumber(available(database, 'maxConnections'), 0)}`} />
        <Metric label="Conexiones activas" value={metricNumber(available(database, 'active'), 0)} />
        <Metric label="Esperando bloqueos" value={metricNumber(available(database, 'waitingLocks'), 0)} />
        <Metric label="Transacciones inactivas" value={metricNumber(available(database, 'idleInTransaction'), 0)} />
      </div>
      <Facts rows={[
        ['Tamaño de la base', metricBytes(available(database, 'databaseBytes'))], ['Transacción más larga', metricSeconds(available(database, 'longestTransactionSeconds'))], ['Deadlocks acumulados', metricNumber(available(database, 'deadlocks'), 0)],
      ]} />
    </section>

    <section className="op-card">
      <div className="op-section-title"><div><h2>Tráfico por familia · 24 h</h2><p>Agrupación de rutas de {ENVIRONMENT_LABELS[environment]}; no se muestran direcciones ni identificadores.</p></div></div>
      <DataTable rows={traffic?.available ? selected.routes || [] : []} empty="Sin datos de rutas disponibles" emptyDetail="Se mostrarán al disponer de tráfico agregado dentro de la cobertura de la fuente." columns={[
        { key: 'family', title: 'Familia', render: row => ROUTE_LABELS[row.family] || 'Otros' }, { key: 'count', title: 'Peticiones', render: row => metricNumber(row.count, 0) }, { key: 'errors5xx', title: 'Errores 5xx', render: row => metricNumber(row.errors5xx, 0) }, { key: 'p95Ms', title: 'Latencia p95', render: row => numeric(row.p95Ms) ? `${metricNumber(row.p95Ms)} ms` : 'Sin datos' },
      ]} />
    </section>

    <section className="op-card">
      <div className="op-section-title"><div><h2>Servicios · {ENVIRONMENT_LABELS[environment]}</h2><p>Se incluyen los servicios compartidos del servidor.</p></div></div>
      <DataTable rows={services} empty="Sin datos de servicios disponibles" emptyDetail="Los recursos se mostrarán cuando haya una lectura válida del servidor." columns={[
        { key: 'name', title: 'Servicio', render: row => <strong className="metrics-service-name">{row.name}</strong> }, { key: 'environment', title: 'Entorno', render: row => ENVIRONMENT_LABELS[row.environment] || 'Servidor' },
        { key: 'status', title: 'Estado', render: row => <span className={`metrics-service-status ${['failed', 'unhealthy', 'restarting'].includes(row.status) ? 'is-warning' : ''}`}>{SERVICE_LABELS[row.status] || 'Sin estado'}</span> },
        { key: 'cpuPercent', title: 'CPU', render: row => metricPercent(row.cpuPercent) }, { key: 'memoryBytes', title: 'Memoria', render: row => metricBytes(row.memoryBytes) }, { key: 'memoryLimitBytes', title: 'Límite memoria', render: row => metricBytes(row.memoryLimitBytes) },
        { key: 'restarts', title: 'Reinicios', render: row => metricNumber(row.restarts, 0) }, { key: 'oomKilled', title: 'OOM', render: row => row.oomKilled === true ? 'Sí' : row.oomKilled === false ? 'No' : 'Sin datos' },
      ]} />
      <p className="metrics-footnote">CPU por servicio: 100 % equivale a un núcleo, por lo que un proceso puede superar ese valor. Reinicios y deadlocks son contadores acumulados de su fuente; no representan necesariamente eventos de las últimas 24 h.</p>
    </section>
    <footer className="metrics-source-note"><ShieldCheck size={16} aria-hidden /><p>Consulta privada y de solo lectura. Sin direcciones IP, correos, identificadores de jugadores ni rutas completas. Recopilación desde {metricTime(data.source?.collectionStartedAt)} · retención de {metricNumber(data.source?.retentionHours, 0)} h.</p></footer>
  </>;
}

export default function MetricsPage() {
  const { me } = useApp();
  const allowed = me?.is_admin === true && metricsAllowedHost(window.location.hostname);
  const actorKey = `${me?.id || ''}:${me?.ctp_user_id || ''}:${me?.is_admin === true}`;
  const [environment, setEnvironment] = useState('prod'), [hours, setHours] = useState(6);
  const { data, error, busy, hidden, refresh } = useMetricsSnapshot(allowed, actorKey);
  if (!allowed) return <Navigate to="/operaciones/jornada" replace />;
  return <div className="page wide op-page metrics-page">
    <header className="op-heading"><div><div className="op-eyebrow"><Activity size={15} aria-hidden />SUPERVISIÓN PRIVADA</div><h1>Tráfico y servidor</h1><p>Recursos, actividad Ranked y peticiones HTTP de PRE y PROD.</p></div><div className="op-actions"><span className="metrics-pill"><ShieldCheck size={13} aria-hidden />Solo lectura · Manager PRE</span><button className="btn primary" type="button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={16} className={busy ? 'spin' : ''} aria-hidden />Actualizar</button></div></header>
    <div className={`op-connection ${data?.stale || error ? 'is-stale' : ''}`} role="status"><span className={`metrics-live-dot ${data?.stale || error || !data ? 'is-stale' : ''}`} /><span>{data ? `${data.stale || error ? 'Última lectura conservada' : 'Última lectura'} · ${metricTime(data.generatedAt)} · Madrid` : busy ? 'Consultando monitorización…' : 'Sin lectura disponible'}</span><span className="op-connection-mode"><Clock3 size={13} aria-hidden />{hidden ? 'Actualización pausada mientras la pestaña está oculta' : 'Actualización cada 60 s'}</span></div>
    {error && <div className="op-error" role="alert"><CircleAlert size={18} aria-hidden /><span>{error}{data ? ' Se conserva la última lectura correcta.' : ''}</span><button type="button" className="btn" disabled={busy} onClick={() => void refresh()}>Reintentar</button></div>}
    {data?.stale && !error && <p className="op-notice">La fuente no ha enviado una lectura reciente. Estos datos pueden estar desactualizados.</p>}
    {data?.available === false && <p className="op-notice">La lectura es parcial. Cada sección indica los datos que están disponibles.</p>}
    {!data ? busy ? <div className="op-loading"><Spinner />Leyendo métricas agregadas…</div> : !error && <Empty title="Sin lectura disponible">La monitorización aparecerá cuando esté habilitada y exista una muestra válida.</Empty> : <MetricsDashboard data={data} environment={environment} setEnvironment={setEnvironment} hours={hours} setHours={setHours} />}
  </div>;
}
