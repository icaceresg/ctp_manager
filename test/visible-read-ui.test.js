import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createServer } from 'vite';

let vite, OperationsPage, TicketChat, AppProvider;
const me = { id: 1, ctp_user_id: '10000000-0000-4000-8000-000000000001', auth_mode: 'ctp', ctp_role: 'admin', is_admin: true, sections: ['operaciones', 'arbitraje'] };
const noop = () => {};
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', logLevel: 'error' });
  ({ OperationsPage } = await vite.ssrLoadModule('/src/operations/OperationsPage.jsx'));
  ({ TicketChat } = await vite.ssrLoadModule('/src/operations/TicketChat.jsx'));
  ({ AppProvider } = await vite.ssrLoadModule('/src/context.jsx'));
});
after(async () => { await vite?.close(); });
const provider = child => createElement(AppProvider, { me, onLogout: noop, onMeChange: noop }, child);

test('Jornada renders the real page without a browser, session or server read during SSR', () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/operaciones/jornada'] }, provider(
    createElement(Routes, null, createElement(Route, { path: '/operaciones/:view', element: createElement(OperationsPage) })),
  )));
  assert.match(html, /Inicio/);
  assert.match(html, /Cargando operaciones/);
  assert.doesNotMatch(html, /No se han podido cargar/);
});

test('the real TicketChat keeps its safe initial state without document or HTTP during SSR', () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, provider(createElement(TicketChat, {
    incident: { id: '20000000-0000-4000-8000-000000000002' }, reload: noop,
  }))));
  assert.match(html, /Chat con el jugador/);
  assert.match(html, /Cargando conversación/);
  assert.doesNotMatch(html, /<form|<textarea/);
});
