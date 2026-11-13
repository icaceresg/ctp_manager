import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('tournament chat keeps player text and team identity while localizing official notices', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom',
    logLevel: 'error',
  });
  const priorDocument = globalThis.document;
  try {
    const { default: Chat } = await vite.ssrLoadModule('/src/operations/TournamentMatchChat.jsx');
    globalThis.document = { documentElement: { lang: 'en' } };
    const requestBody = 'Se ha solicitado asistencia del árbitro (ticket CTP-123).';
    const fixture = (id, body, author_side = null, system = false) => ({
      id, body, author_side, system, author_name: 'Same name', author_key: author_side,
      created_at: '2026-11-13T13:00:00Z',
    });
    const html = renderToStaticMarkup(createElement(Chat, {
      match: { entrant_a: { name: 'Equipo A' }, entrant_b: { name: 'Équipe B' } },
      messages: [
        fixture('a1', requestBody, 'a'),
        fixture('a2', '<script>fixture</script>', 'a'),
        fixture('b1', 'User text', 'b'),
        fixture('s1', requestBody, null, true),
        fixture('s2', 'tournaments.staff.vetoDecision', null, true),
      ],
      canWrite: false,
    }));
    assert.match(html, /class="is-team-a"><header>.*?Equipo A/);
    assert.match(html, /class="is-team-a is-continued"><p>&lt;script&gt;fixture&lt;\/script&gt;<\/p>/);
    assert.match(html, /class="is-team-b"><header>.*?Équipe B/);
    assert.match(html, /Se ha solicitado asistencia del árbitro \(ticket CTP-123\)\./);
    assert.match(html, /Referee assistance was requested \(ticket CTP-123\)\./);
    assert.doesNotMatch(html, /tournaments\.staff\.vetoDecision/);
    assert.doesNotMatch(html, /<textarea/);
  } finally {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
    await vite.close();
  }
});
