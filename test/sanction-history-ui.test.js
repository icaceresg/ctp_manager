import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { buildSanctionHistory } from '../client/src/operations/sanctionHistoryModel.js';
import { sanctionHistoryFixture, HISTORY_NOW, HISTORY_PLAYER } from './fixtures/sanction-history.js';

let vite, View;
before(async () => {
  // Render real JSX against synthetic props; no API or shared DEV requests.
  vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', logLevel: 'error' });
  ({ SanctionHistoryView: View } = await vite.ssrLoadModule('/src/operations/PlayerSanctionHistory.jsx'));
});
after(async () => { await vite?.close(); });
const render = state => renderToStaticMarkup(createElement(View, { state, now: HISTORY_NOW,
  onRetry: () => assert.fail('SSR must not request or apply a sanction') }));
const ready = raw => ({ status: 'ready', userId: HISTORY_PLAYER, history: buildSanctionHistory(raw, HISTORY_PLAYER, HISTORY_NOW) });

test('the form distinguishes loading, failed history and verified absence without claiming a clean record', () => {
  const loading = render({ status: 'loading', userId: HISTORY_PLAYER });
  assert.match(loading, /aria-busy="true"/); assert.match(loading, /Consultando antecedentes/);
  assert.doesNotMatch(loading, /No constan|ninguna sanción|<dd>/);
  const error = render({ status: 'error', userId: HISTORY_PLAYER, message: 'No se pudo consultar el historial.' });
  assert.match(error, /role="alert"/); assert.match(error, /Reintentar historial/);
  assert.doesNotMatch(error, /No constan|ninguna sanción|<dd>/);
  const raw = sanctionHistoryFixture();
  const empty = render(ready({ ...raw, clubs: [], items: [] }));
  assert.match(empty, /No constan medidas personales/); assert.match(empty, /ninguna sanción nueva se aplica automáticamente/);
});

test('the immediate summary shows personal counts and names lifted, revoked and club records accurately', () => {
  const raw = sanctionHistoryFixture();
  // Put lifted and revoked records among the three initially visible rows.
  raw.items = [raw.items[0], raw.items[2], raw.items[3], raw.items[1], raw.items[4], raw.items[5]];
  const html = render(ready(raw));
  assert.match(html, /<dt>Activas<\/dt><dd>1<\/dd>/);
  assert.match(html, /<dt>Previas<\/dt><dd>1<\/dd>/);
  assert.match(html, /<dt>Amonestaciones<\/dt><dd>2<\/dd>/);
  assert.match(html, /Levantado antes de tiempo; no está activo/);
  assert.match(html, /Revocada: no cuenta como medida previa/);
  assert.match(html, /Medidas de clubes vinculados \(1\)/);
  assert.match(html, /Ver otros 2 registros personales/);
  assert.equal((html.match(/class="sx-history-record is-/g) || []).length, 3);
  assert.equal((html.match(/aria-expanded="false"/g) || []).length, 2);
  assert.doesNotMatch(html, /Medida de club: no es una sanción personal/);
  assert.doesNotMatch(html, /Amonestación sintética programada para el futuro/);
  assert.match(html, /aria-label="Últimos antecedentes personales"/);
  assert.match(html, /tabindex="0"/);
  assert.doesNotMatch(html, /Reincidencia|Recomendamos sancionar|type="submit"/i);
});

test('display names and complete long reasons remain text, with dates and duration present', () => {
  const raw = sanctionHistoryFixture(); raw.user.username = '<img src=x onerror=alert(1)>';
  raw.items[0].reason = '<script>alert("synthetic")</script>' + ' razón documentada'.repeat(20);
  raw.items[0].issued_by_name = '<button onclick=alert(1)>Staff</button>';
  const html = render(ready(raw));
  assert.match(html, /&lt;img src=x onerror/); assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Ver motivo completo/); assert.match(html, /dateTime="2026-11-02T12:00:00Z"/i);
  assert.match(html, /Hasta/); assert.match(html, /3 d/);
  assert.doesNotMatch(html, /<script>|<img src=x|<button onclick=/);
});

test('the capped response explicitly warns that previous history may be missing', () => {
  const raw = sanctionHistoryFixture();
  raw.items = Array.from({ length: 500 }, (_, i) => ({ ...raw.items[0], id: `22000000-0000-4000-8000-${String(i).padStart(12, '0')}` }));
  const html = render(ready(raw));
  assert.match(html, /hasta 500 registros recientes/); assert.match(html, /recuentos son parciales/);
  assert.equal((html.match(/class="sx-history-record is-/g) || []).length, 3);
  assert.match(html, /Ver otros 497 registros personales/);
});
