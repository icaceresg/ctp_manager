import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createServer } from 'vite';

let vite, Access, Provider;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', logLevel: 'error' });
  Access = (await vite.ssrLoadModule('/src/pages/StaffAccessPage.jsx')).RankedStatisticsAccess;
  Provider = (await vite.ssrLoadModule('/src/context.jsx')).AppProvider;
});
after(async () => { await vite?.close(); });
const account = { id: '24000000-0000-4000-8000-000000000003', username: 'Fixture reader', role: 'player',
  staff_kind: 'executive', staff_enabled: true, email_confirmed: true, ranked_statistics_enabled: false };
const render = (changes = {}, disabled = false) => renderToStaticMarkup(createElement(MemoryRouter, null,
  createElement(Provider, { me: { id: 1, ctp_user_id: '24000000-0000-4000-8000-000000000001' } },
    createElement(Access, { account: { ...account, ...changes }, disabled, saved: async () => {} }))));

test('individual statistics permission has a distinct unchecked control and clear aggregate-only purpose', () => {
  const html = render();
  assert.match(html, /type="checkbox"/); assert.doesNotMatch(html, /checked=""/);
  assert.match(html, /Ver estadísticas Ranked/); assert.match(html, /Solo datos agregados; no concede arbitraje/);
  assert.doesNotMatch(html, /<select|Cambiar función|staff-kind/);
  assert.match(render({ ranked_statistics_enabled: true }), /checked=""/);
  assert.match(render({}, true), /disabled=""/);
});

test('inactive staff, unconfirmed users and existing moderator roles receive no unnecessary individual toggle', () => {
  for (const changes of [{ staff_enabled: false }, { email_confirmed: false }, { role: 'admin' }, { role: 'referee' }]) {
    const html = render(changes); assert.doesNotMatch(html, /type="checkbox"/);
    assert.match(html, changes.role ? /Incluido en su función/ : /Requiere staff activo y cuenta confirmada/);
  }
});
