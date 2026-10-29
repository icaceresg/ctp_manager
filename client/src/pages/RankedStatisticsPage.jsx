import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChartColumnBig, Check, CircleAlert, Copy, Download, Minus, Printer, RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Spinner } from '../components/ui.jsx';
import { DataTable, Empty } from '../operations/ui.jsx';
import { dateTime } from '../operations/model.js';
import { canManageRanked, canReadRankedStatistics } from '../../../shared/access.js';
import {
  ACTIVITY_METRICS, AGE_BANDS, INTERACTION_KINDS, STATISTICS_PERIODS, WEEKDAYS,
  activitySeries, change, formatCompact, formatDate, formatDay, formatDecimal, formatHours, formatLongDay, formatMinutes,
  formatNumber, formatShare, heatLevel, hourRange, insights, interactionTotal, modeLabel, niceMaximum, periodTitle,
  platformLabel, rangeText, statisticsCsv, statisticsPeriod, summaryText,
} from './rankedStatisticsModel.js';
import '../operations/operations.css';
import './ranked-statistics.css';

function Delta({ current, previous }) {
  const value = change(current, previous);
  if (!value) return null;
  const Icon = value.direction === 'up' ? ArrowUp : value.direction === 'down' ? ArrowDown : Minus;
  return <span className={`rs-delta is-${value.direction}`}><Icon size={13} aria-hidden/>{value.label}<span className="sr-only"> frente al periodo anterior</span></span>;
}

export function StatisticsKpis({ data }) {
  const facts = insights(data), current = data.current, previous = data.previous;
  const tiles = [
    ['Partidas jugadas', formatNumber(current.matches_played), 'matches_played', `${formatMinutes(facts.averageMatchSeconds)} de media por partida`],
    ['Jugadores únicos', formatNumber(current.unique_players), 'unique_players', `${formatNumber(current.new_players)} nuevos · ${facts.returningShare} repite`],
    ['Horas de juego', formatHours(current.player_seconds), 'player_seconds', `${formatDecimal((facts.secondsPerPlayer || 0) / 3600)} h por jugador`],
    ['Interacciones', formatNumber(facts.interactions), null, `${formatDecimal(facts.interactionsPerMatch ?? 0)} por partida · ${formatNumber(current.messages)} mensajes`],
  ];
  return <section className="rs-kpis" aria-label="Cifras principales del periodo">{tiles.map(([title, value, key, detail]) => <div className="rs-kpi" key={title}>
    <span>{title}</span><strong>{value}</strong>
    {previous && <Delta current={key ? current[key] : facts.interactions} previous={key ? previous[key] : interactionTotal(previous)}/>}
    <small>{detail}</small>
  </div>)}</section>;
}

export function EngagementFacts({ data }) {
  const facts = insights(data), current = data.current;
  const items = [
    ['Pico de jugadores simultáneos', formatNumber(current.peak_concurrent_players), 'en partida a la vez'],
    ['Jugadores activos al día', formatDecimal(facts.averageDailyPlayers ?? 0), `de media · máximo ${formatNumber(current.peak_day_players)}`],
    ['Partidas por jugador', formatDecimal(facts.matchesPerPlayer ?? 0), 'participaciones de media'],
    ['Jugadores que repiten', facts.returningShare, 'jugaron 2 días o más'],
    ['Juego en grupo', facts.groupShare, 'de las participaciones, con amigos'],
    ['Duración media', formatMinutes(facts.averageMatchSeconds), 'por partida'],
    ['Juego limpio', facts.cleanShare, 'partidas sin disputa'],
    ['Partidas completadas', facts.completionShare, 'frente a canceladas o suspendidas'],
  ];
  return <section className="op-card rs-card" aria-labelledby="rs-engagement"><div className="op-section-title"><div><h2 id="rs-engagement">Compromiso de la comunidad</h2><p>Cómo juega la gente en el periodo seleccionado.</p></div></div>
    <dl className="rs-facts">{items.map(([title, value, detail]) => <div key={title}><dt>{title}</dt><dd><strong>{value}</strong><small>{detail}</small></dd></div>)}</dl>
  </section>;
}

const metricValue = (metric, value, weekly) => metric.key === 'hours' ? (value >= 100 ? formatNumber(Math.round(value)) : formatDecimal(value))
  : metric.key === 'players' && weekly ? formatDecimal(value) : formatNumber(value);

export function ActivityChart({ data, initialMetric = 'matches' }) {
  const [metricKey, setMetricKey] = useState(initialMetric), [active, setActive] = useState(null);
  const { weekly, metric, bars } = activitySeries(data.daily, metricKey);
  const maximum = niceMaximum(Math.max(0, ...bars.map(bar => bar.value)));
  const total = bars.reduce((sum, bar) => sum + bar.value, 0);
  const shown = active === null ? null : bars[active];
  const move = event => {
    if (!bars.length || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    setActive(index => event.key === 'Home' ? 0 : event.key === 'End' ? bars.length - 1
      : Math.min(bars.length - 1, Math.max(0, (index ?? bars.length) + (event.key === 'ArrowLeft' ? -1 : 1))));
  };
  const span = bar => weekly ? `Semana del ${formatDay(bar.from)} al ${formatDay(bar.to)}` : formatLongDay(bar.from);
  return <section className="op-card rs-card" aria-labelledby="rs-activity"><div className="op-section-title"><div><h2 id="rs-activity">Actividad {weekly ? 'semanal' : 'diaria'}</h2>
    <p>{metric.label} por {weekly ? 'semana (jugadores: media diaria)' : 'día'} · hora de Madrid</p></div>
    <div className="rs-segmented no-print" role="group" aria-label="Dato del gráfico">{ACTIVITY_METRICS.map(item => <button type="button" key={item.key} aria-pressed={item.key === metric.key} onClick={() => { setMetricKey(item.key); setActive(null); }}>{item.label}</button>)}</div></div>
    {!bars.length ? <Empty title="Sin días en este periodo">La actividad aparecerá cuando haya partidas confirmadas.</Empty> : <>
      <div className="rs-chart">
        <div className="rs-y-axis" aria-hidden>{[maximum, maximum / 2, 0].map(value => <span key={value}>{formatCompact(value)}</span>)}</div>
        <div className="rs-plot" tabIndex={0} role="img" onKeyDown={move} onBlur={() => setActive(null)} onPointerLeave={() => setActive(null)}
          aria-label={`${metric.label} por ${weekly ? 'semana' : 'día'}. Total ${metricValue(metric, total, false)}. Usa las flechas para recorrer los ${weekly ? 'semanas' : 'días'}.`}>
          <div className="rs-gridlines" aria-hidden><i/><i/><i/></div>
          <div className="rs-columns" style={{ gap: bars.length > 60 ? 1 : 2 }}>{bars.map((bar, index) => <div key={bar.key} className={`rs-column${active === index ? ' is-active' : ''}`} onPointerEnter={() => setActive(index)}>
            {bar.value > 0 && <i style={{ height: `${bar.value / maximum * 100}%` }}/>}
          </div>)}</div>
          {shown && <div className="rs-tooltip" role="status" style={{ left: `${(active + 0.5) / bars.length * 100}%` }}>
            <strong>{metricValue(metric, shown.value, weekly)}</strong><span>{metric.unit}</span><small>{span(shown)}</small>
          </div>}
        </div>
      </div>
      <div className="rs-x-axis" aria-hidden><span>{formatDay(bars[0].from)}</span>{bars.length > 2 && <span>{formatDay(bars[Math.floor(bars.length / 2)].from)}</span>}<span>{formatDay(bars.at(-1).to)}</span></div>
    </>}
  </section>;
}

export function HourHeatmap({ data }) {
  const cells = new Map(data.heatmap.map(cell => [`${cell.weekday}:${cell.hour}`, cell.matches]));
  const maximum = Math.max(0, ...data.heatmap.map(cell => cell.matches));
  const facts = insights(data), [active, setActive] = useState(null);
  const move = event => {
    const steps = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[event.key];
    if (!steps) return;
    event.preventDefault();
    setActive(cell => {
      const from = cell || { weekday: facts.peak?.weekday || 1, hour: facts.peak?.hour ?? 20 };
      return { weekday: Math.min(7, Math.max(1, from.weekday + steps[0])), hour: Math.min(23, Math.max(0, from.hour + steps[1])) };
    });
  };
  const shown = active ? { ...active, matches: cells.get(`${active.weekday}:${active.hour}`) || 0 } : null;
  return <section className="op-card rs-card" aria-labelledby="rs-hours"><div className="op-section-title"><div><h2 id="rs-hours">Cuándo se juega</h2><p>Partidas por día de la semana y hora de inicio · hora de Madrid</p></div></div>
    <p className="rs-readout" role="status">{shown ? <><strong>{formatNumber(shown.matches)} {shown.matches === 1 ? 'partida' : 'partidas'}</strong> · {WEEKDAYS[shown.weekday - 1]}, {hourRange(shown.hour)}</>
      : facts.peak ? <>Franja con más partidas: <strong>{WEEKDAYS[facts.peak.weekday - 1].toLowerCase()} de {hourRange(facts.peak.hour)}</strong> ({formatNumber(facts.peak.matches)})</> : 'Sin partidas en este periodo.'}</p>
    <div className="rs-heat-scroll"><div className="rs-heat" tabIndex={0} role="img" onKeyDown={move} onBlur={() => setActive(null)} onPointerLeave={() => setActive(null)}
      aria-label="Mapa de calor de partidas por día y hora. Usa las flechas para recorrer las franjas.">
      <span aria-hidden/>{Array.from({ length: 24 }, (_, hour) => <span className="rs-heat-hour" aria-hidden key={hour}>{hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}</span>)}
      {WEEKDAYS.map((day, index) => <div className="rs-heat-row" key={day}>
        <span className="rs-heat-day" aria-hidden>{day.slice(0, 3)}</span>
        {Array.from({ length: 24 }, (_, hour) => {
          const value = cells.get(`${index + 1}:${hour}`) || 0, selected = active?.weekday === index + 1 && active?.hour === hour;
          return <i key={hour} className={`rs-heat-cell level-${heatLevel(value, maximum)}${selected ? ' is-active' : ''}`} onPointerEnter={() => setActive({ weekday: index + 1, hour })}/>;
        })}
      </div>)}
    </div></div>
    <div className="rs-heat-legend" aria-hidden><span>Menos</span>{[1, 2, 3, 4, 5].map(level => <i key={level} className={`rs-heat-cell level-${level}`}/>)}<span>Más</span></div>
  </section>;
}

function BarList({ rows, total, label }) {
  const maximum = Math.max(1, ...rows.map(row => row.value));
  return <ul className="rs-bars" aria-label={label}>{rows.map(row => <li key={row.key} className={row.muted ? 'is-muted' : undefined}>
    <span className="rs-bar-label">{row.label}</span>
    <span className="rs-bar-track" aria-hidden>{row.value > 0 && <i style={{ width: `${row.value / maximum * 100}%` }}/>}</span>
    <span className="rs-bar-value"><strong>{formatNumber(row.value)}</strong>{total > 0 && <small>{formatShare(row.value, total)}</small>}</span>
  </li>)}</ul>;
}

export function ModesAndMaps({ data }) {
  const matches = data.current.matches_played, series = { hardpoint: 1, search_destroy: 2 };
  const modes = [...data.modes].sort((a, b) => (series[a.mode] || 9) - (series[b.mode] || 9));
  return <section className="op-card rs-card" aria-labelledby="rs-modes"><div className="op-section-title"><div><h2 id="rs-modes">Modos y mapas</h2><p>Partidas confirmadas del periodo.</p></div></div>
    {!matches ? <Empty title="Sin partidas confirmadas">El reparto aparecerá con la primera partida del periodo.</Empty> : <>
      <div className="rs-stack" aria-hidden>{modes.map(row => <i key={row.mode} className={`series-${series[row.mode] || 'other'}`} style={{ flexGrow: row.matches }}/>)}</div>
      <ul className="rs-legend">{modes.map(row => <li key={row.mode}><i className={`series-${series[row.mode] || 'other'}`} aria-hidden/><span>{modeLabel(row.mode)}</span><strong>{formatNumber(row.matches)}</strong><small>{formatShare(row.matches, matches)}</small></li>)}</ul>
      <h3 className="rs-subtitle">Mapas más jugados</h3>
      {data.maps.length ? <BarList label="Mapas más jugados" total={matches} rows={data.maps.map(row => ({ key: `${row.map_name}:${row.mode}`, label: <>{row.map_name} <small>{modeLabel(row.mode)}</small></>, value: row.matches }))}/>
        : <p className="muted rs-note">Las partidas del periodo no tienen mapa registrado.</p>}
    </>}
  </section>;
}

export function AudiencePanel({ data }) {
  const audience = data.audience, players = audience.players;
  const ages = AGE_BANDS.map(([band, title]) => ({ key: band, label: title, value: audience.age_bands.find(row => row.band === band)?.players || 0, muted: band === 'unknown' })).filter(row => row.value > 0);
  const reach = [['Aceptan comunicaciones comerciales', audience.marketing_opt_in], ['Con Discord vinculado', audience.discord], ['Con perfil de X (Twitter)', audience.twitter]];
  return <section className="op-card rs-card" aria-labelledby="rs-audience"><div className="op-section-title"><div><h2 id="rs-audience">Audiencia</h2><p>{formatNumber(players)} jugadores con al menos una partida en el periodo. Solo recuentos agregados.</p></div></div>
    {!players ? <Empty title="Sin jugadores en este periodo">La audiencia aparecerá con la primera partida confirmada.</Empty> : <div className="rs-audience">
      <div><h3 className="rs-subtitle">Edad</h3><BarList label="Jugadores por edad" total={players} rows={ages}/></div>
      <div><h3 className="rs-subtitle">Plataforma</h3><BarList label="Jugadores por plataforma" total={players} rows={audience.platforms.map(row => ({ key: row.platform, label: platformLabel(row.platform), value: row.players }))}/></div>
      <div><h3 className="rs-subtitle">Alcance directo</h3><ul className="rs-meters">{reach.map(([title, value]) => <li key={title}>
        <span>{title}</span><strong>{formatShare(value, players)}</strong><small>{formatNumber(value)} jugadores</small>
        <span className="rs-meter" aria-hidden><i style={{ width: `${value / players * 100}%` }}/></span>
      </li>)}</ul></div>
    </div>}
  </section>;
}

export function InteractionsPanel({ data }) {
  const current = data.current, total = interactionTotal(current);
  return <section className="op-card rs-card" aria-labelledby="rs-interactions"><div className="op-section-title"><div><h2 id="rs-interactions">Interacciones</h2><p>Acciones de los jugadores dentro de sus partidas: {formatNumber(total)} en total.</p></div></div>
    {!total ? <Empty title="Sin interacciones en este periodo">Aparecerán con los mensajes y votos de las partidas.</Empty>
      : <BarList label="Interacciones por tipo" total={total} rows={INTERACTION_KINDS.map(([key, title]) => ({ key, label: title, value: current[key] }))}/>}
  </section>;
}

export function AllTimePanel({ data }) {
  const totals = data.totals, facts = insights(data);
  const items = [
    ['Partidas jugadas', formatNumber(totals.matches_played)], ['Jugadores únicos', formatNumber(totals.unique_players)],
    ['Horas de juego', formatHours(totals.player_seconds)], ['Interacciones', formatNumber(interactionTotal(totals))],
    ['Cuentas registradas en CTP', formatNumber(data.registered_accounts)], ['Cuentas que han jugado Ranked', facts.activationShare],
  ];
  return <section className="op-card rs-card" aria-labelledby="rs-all-time"><div className="op-section-title"><div><h2 id="rs-all-time">Histórico de Ranked</h2>
    <p>{data.first_match_at ? `Desde la primera partida confirmada, el ${formatDate(data.first_match_at)}.` : 'Todavía no hay partidas confirmadas.'}</p></div></div>
    <dl className="rs-facts">{items.map(([title, value]) => <div key={title}><dt>{title}</dt><dd><strong>{value}</strong></dd></div>)}</dl>
  </section>;
}

function DailyTable({ data }) {
  return <details className="op-card rs-card rs-details no-print"><summary>Ver los datos diarios en una tabla</summary>
    <DataTable rows={[...data.daily].reverse()} empty="Sin días en este periodo" emptyDetail="No hay datos diarios disponibles." columns={[
      { key: 'day', title: 'Día', render: row => formatLongDay(row.day) }, { key: 'matches', title: 'Partidas', render: row => formatNumber(row.matches) },
      { key: 'players', title: 'Jugadores', render: row => formatNumber(row.players) }, { key: 'new_players', title: 'Nuevos', render: row => formatNumber(row.new_players) },
      { key: 'player_seconds', title: 'Horas de juego', render: row => formatHours(row.player_seconds) }, { key: 'interactions', title: 'Interacciones', render: row => formatNumber(row.interactions) },
    ]}/>
    {data.truncated.daily && <p className="op-notice">Se muestran los últimos 366 días. Las cifras del periodo incluyen todo el histórico.</p>}
  </details>;
}

export function Methodology() {
  return <details className="op-card rs-card rs-details"><summary>Cómo se calcula cada dato</summary><dl className="rs-method">
    <div><dt>Partidas jugadas</dt><dd>Partidas de Ranked con resultado confirmado que se cerraron en el periodo. No cuenta las canceladas ni las suspendidas.</dd></div>
    <div><dt>Jugadores únicos</dt><dd>Cuentas distintas que jugaron al menos una de esas partidas. Un jugador es nuevo si su primera partida confirmada está dentro del periodo.</dd></div>
    <div><dt>Horas de juego</dt><dd>Suma del tiempo de cada jugador en partida: desde que se forma la partida hasta el primer voto de resultado (o su cierre), con un máximo de 60 minutos por partida. Es una estimación a partir de CTP, no una medición del cliente de Call of Duty.</dd></div>
    <div><dt>Interacciones</dt><dd>Mensajes de los jugadores en el chat de su partida y sus votos de mapa, modo, resultado y cambio de mapa. Cada voto cuenta una vez aunque se cambie. No incluye mensajes del sistema ni del staff.</dd></div>
    <div><dt>Pico simultáneo</dt><dd>Máximo de jugadores en partidas confirmadas que coincidían en el tiempo. Las colas de búsqueda no se conservan y no se incluyen.</dd></div>
    <div><dt>Audiencia</dt><dd>Recuentos de los jugadores del periodo según su perfil: edad calculada con la fecha de nacimiento, plataforma principal y consentimiento comercial. Ningún dato personal sale de CTP.</dd></div>
    <div><dt>Periodos</dt><dd>Días naturales de Madrid. El periodo anterior tiene la misma duración y termina a la misma hora, para comparar días completos e incompletos por igual.</dd></div>
  </dl></details>;
}

export default function RankedStatisticsPage() {
  const { me } = useApp();
  const allowed = canReadRankedStatistics(me), actorKey = JSON.stringify([me?.id, me?.ctp_user_id, me?.ctp_role, me?.ctp_scopes]);
  const [params, setParams] = useSearchParams(), period = statisticsPeriod(params.get('periodo'));
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [seasonAvailable, setSeasonAvailable] = useState(true), [manualSummary, setManualSummary] = useState('');
  const request = useRef(0);
  const load = useCallback(async () => {
    if (!allowed) return;
    const serial = ++request.current;
    setBusy(true); setError('');
    try {
      const next = await api.get(`/operations/ranked/statistics?period=${encodeURIComponent(period)}`);
      if (request.current === serial) { setData({ snapshot: next, actorKey }); setSeasonAvailable(Boolean(next.season)); }
    } catch (cause) {
      if (request.current !== serial) return;
      setError(cause.message);
      if (period === 'season' && cause.status === 409) setSeasonAvailable(false);
      if ([401, 403].includes(cause.status)) setData(null);
    } finally { if (request.current === serial) setBusy(false); }
  }, [allowed, actorKey, period]);
  useEffect(() => { setData(null); setError(''); setManualSummary(''); setSeasonAvailable(true); }, [actorKey]);
  useEffect(() => { void load(); return () => { ++request.current; }; }, [load]);
  useEffect(() => { if (!notice) return undefined; const timer = setTimeout(() => setNotice(''), 2500); return () => clearTimeout(timer); }, [notice]);
  if (!allowed) return <Navigate to="/operaciones/jornada" replace/>;
  const choose = key => setParams(previous => { const next = new URLSearchParams(previous); key === '30d' ? next.delete('periodo') : next.set('periodo', key); return next; }, { replace: true });
  const shown = data?.actorKey === actorKey ? data.snapshot : null;
  const copy = async () => {
    const text = summaryText(shown);
    try { await navigator.clipboard.writeText(text); setManualSummary(''); setNotice('Resumen copiado'); }
    catch { setManualSummary(text); } // Some embedded browsers block the clipboard: show it to copy by hand.
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([statisticsCsv(shown)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = `ctp-ranked-estadisticas-${shown.period.key}-${shown.observed_at.slice(0, 10)}.csv`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const stale = shown && shown.period.key !== period;
  return <div className="page wide op-page rs-page">
    <header className="op-heading"><div><div className="op-eyebrow"><ChartColumnBig size={15}/> COMPETICIÓN · DATOS PARA MARCAS</div><h1>Estadísticas Ranked</h1>
      <p>Alcance, actividad y comunidad de Ranked con partidas confirmadas en CTP.</p></div>
      <div className="op-actions no-print">
        <button className="btn" disabled={!shown} onClick={() => void copy()}>{notice === 'Resumen copiado' ? <Check size={16}/> : <Copy size={16}/>} Copiar resumen</button>
        <button className="btn" disabled={!shown} onClick={download}><Download size={16}/> Descargar CSV</button>
        <button className="btn" disabled={!shown} onClick={() => window.print()}><Printer size={16}/> Imprimir o PDF</button>
        <button className="btn primary" disabled={busy} onClick={() => void load()}><RefreshCw size={16} className={busy ? 'spin' : ''}/> Actualizar</button>
      </div></header>
    <div className="rs-toolbar">
      <div className="rs-segmented no-print" role="group" aria-label="Periodo">{STATISTICS_PERIODS.map(item => {
        const disabled = item.key === 'season' && !seasonAvailable && period !== 'season';
        return <button type="button" key={item.key} aria-pressed={period === item.key} disabled={disabled} title={disabled ? 'No hay ninguna temporada activa' : item.title} onClick={() => choose(item.key)}>{item.label}</button>;
      })}</div>
      {shown && <p className="rs-range"><strong>{periodTitle(shown.period.key)}{shown.period.key === 'season' && shown.season ? ` · ${shown.season.name}` : ''}</strong> · {rangeText(shown)}{shown.previous ? ' · comparado con el periodo anterior' : ''} · hora de Madrid · lectura {dateTime(shown.observed_at)}</p>}
    </div>
    {notice && <p className="op-notice no-print" role="status">{notice}</p>}
    {manualSummary && <section className="op-card rs-card rs-summary no-print" aria-labelledby="rs-summary-title"><div className="op-section-title"><div><h2 id="rs-summary-title">Resumen para copiar</h2>
      <p>Este navegador no permite copiar automáticamente. Selecciona el texto y cópialo con Ctrl+C.</p></div><button className="btn" onClick={() => setManualSummary('')}>Cerrar</button></div>
      <textarea readOnly value={manualSummary} rows={manualSummary.split('\n').length + 1} onFocus={event => event.target.select()} autoFocus/>
    </section>}
    {error && <div className="op-error" role="alert"><CircleAlert size={18}/><span>{error}{shown ? ' Se muestran los últimos datos cargados.' : ''}</span><button className="btn" onClick={() => void load()} disabled={busy}>Reintentar</button></div>}
    {!shown ? busy ? <div className="op-loading"><Spinner/>Calculando estadísticas en CTP…</div> : !error && <Empty title="Sin datos disponibles">Pulsa Actualizar para consultar CTP.</Empty>
      : <div className={`rs-content${busy || stale ? ' is-refreshing' : ''}`} aria-busy={busy}>
        <StatisticsKpis data={shown}/>
        <EngagementFacts data={shown}/>
        <ActivityChart data={shown}/>
        <HourHeatmap data={shown}/>
        <AudiencePanel data={shown}/>
        <div className="rs-grid"><ModesAndMaps data={shown}/><InteractionsPanel data={shown}/></div>
        <AllTimePanel data={shown}/>
        <DailyTable data={shown}/>
        <Methodology/>
        {canManageRanked(me) && <p className="muted rs-note no-print">¿Necesitas el estado en directo? Consulta el <Link to="/ranked/monitor">monitor de Ranked</Link>.</p>}
      </div>}
  </div>;
}
