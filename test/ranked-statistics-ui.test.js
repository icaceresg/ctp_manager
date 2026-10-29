import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createServer } from 'vite';
import { statisticsFixture } from './fixtures/ranked-statistics.js';

let vite, views;
before(async () => {
  // Compile the real JSX and render the report sections from the local fixture.
  vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', logLevel: 'error' });
  views = await vite.ssrLoadModule('/src/pages/RankedStatisticsPage.jsx');
});
after(async () => { await vite?.close(); });
const render = (view, props) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(views[view], props)));

test('headline tiles show the sellable figures with their change against the previous period', () => {
  const data = statisticsFixture('30d'), html = render('StatisticsKpis', { data });
  for (const title of ['Partidas jugadas', 'Jugadores únicos', 'Horas de juego', 'Interacciones']) assert.match(html, new RegExp(title));
  assert.match(html, new RegExp(`<strong>${data.current.matches_played}</strong>`));
  assert.match(html, /20 min de media por partida/);
  assert.match(html, /frente al periodo anterior/);
  const all = render('StatisticsKpis', { data: statisticsFixture('all') });
  assert.doesNotMatch(all, /frente al periodo anterior/, 'no comparison without a previous window');
});

test('activity chart draws one bar per day, labels its scale and offers every metric', () => {
  const data = statisticsFixture('30d'), html = render('ActivityChart', { data });
  assert.equal((html.match(/class="rs-column"/g) || []).length, 30);
  assert.match(html, /Actividad diaria/);
  for (const metric of ['Partidas', 'Jugadores', 'Horas de juego', 'Interacciones', 'Jugadores nuevos']) assert.match(html, new RegExp(`>${metric}</button>`));
  assert.match(html, /aria-pressed="true"[^>]*>Partidas</);
  assert.match(html, /Usa las flechas/);
  const hours = render('ActivityChart', { data, initialMetric: 'hours' });
  assert.match(hours, /Horas de juego por día/);
});

test('heatmap shows the busiest slot, seven days of 24 hours and an ordered legend', () => {
  const data = statisticsFixture('30d'), html = render('HourHeatmap', { data });
  assert.equal((html.match(/class="rs-heat-cell level-/g) || []).length, 7 * 24 + 5);
  assert.match(html, /Franja con más partidas: <strong>[a-zé]+ de 21:00–22:00<\/strong>/);
  assert.match(html, /level-5/);
  assert.match(html, /Menos.*Más/s);
});

test('audience lists age bands in order, platforms and direct reach without personal data', () => {
  const data = statisticsFixture('30d'), html = render('AudiencePanel', { data });
  const order = ['Menores de 18', '18 a 24 años', '25 a 34 años', 'Sin fecha de nacimiento'].map(label => html.indexOf(label));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.equal(order.every(index => index > 0), true);
  assert.match(html, /PlayStation/);
  assert.match(html, /Aceptan comunicaciones comerciales/);
  assert.match(html, /Solo recuentos agregados/);
  const empty = statisticsFixture('30d'); empty.audience = { ...empty.audience, players: 0 };
  assert.match(render('AudiencePanel', { data: empty }), /Sin jugadores en este periodo/);
});

test('modes, maps and interactions carry labels, counts and shares', () => {
  const data = statisticsFixture('30d');
  const modes = render('ModesAndMaps', { data });
  assert.match(modes, /Punto caliente/); assert.match(modes, /Buscar y destruir/); assert.match(modes, /Mapas más jugados/); assert.match(modes, /Coal/);
  assert.match(modes, /series-1/); assert.match(modes, /series-2/);
  const interactions = render('InteractionsPanel', { data });
  for (const label of ['Mensajes en el chat de partida', 'Votos de mapa', 'Votos de modo', 'Votos de resultado', 'Votos para cambiar de mapa']) assert.match(interactions, new RegExp(label));
  assert.match(interactions, /50 %/); // messages are half of all interactions in the fixture
});

test('map names from CTP are escaped as content', () => {
  const data = statisticsFixture('30d'); data.maps[0].map_name = '<img src=x onerror=alert(1)>';
  const html = render('ModesAndMaps', { data });
  assert.doesNotMatch(html, /<img src=x/); assert.match(html, /&lt;img src=x/);
});

test('methodology states what each figure means, including the estimated play time', () => {
  const html = render('Methodology', {});
  assert.match(html, /resultado confirmado/); assert.match(html, /máximo de 60 minutos/); assert.match(html, /no una medición del cliente/);
  assert.match(html, /Ningún dato personal sale de CTP/);
});

test('all-time panel shows accounts and the share that has played Ranked', () => {
  const data = statisticsFixture('30d'), html = render('AllTimePanel', { data });
  assert.match(html, /Cuentas registradas en CTP/); assert.match(html, /50 %/); assert.match(html, /primera partida confirmada/);
});
