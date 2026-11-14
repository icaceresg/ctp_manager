import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('the live link is accessible, localized and cannot render arbitrary URLs', async () => {
  const vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', logLevel: 'error' });
  const priorDocument = globalThis.document;
  try {
    const { PlayerLiveLink } = await vite.ssrLoadModule('/src/operations/PlayerLiveBadge.jsx');
    for (const [lang, expected] of [['es', 'EN DIRECTO'], ['en', 'LIVE'], ['fr', 'EN DIRECT'], ['it', 'IN DIRETTA'], ['pt', 'EM DIRETO'], ['de', 'LIVE']]) {
      globalThis.document = { documentElement: { lang } };
      const html = renderToStaticMarkup(createElement(PlayerLiveLink, { channel: 'qa_player', name: '<QA & player>' }));
      assert.match(html, /href="https:\/\/www\.twitch\.tv\/qa_player"/);
      assert.match(html, /target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"/);
      assert.ok(html.includes(expected)); assert.ok(html.includes('&lt;QA &amp; player&gt;'));
      assert.doesNotMatch(html, /manager\.playerLive\./);
    }
    for (const channel of [undefined, null, '', '//other.test', 'https://twitch.tv/player', 'foo?secret=bar'])
      assert.equal(renderToStaticMarkup(createElement(PlayerLiveLink, { channel, name: 'QA' })), '');
  } finally {
    if (priorDocument === undefined) delete globalThis.document; else globalThis.document = priorDocument;
    await vite.close();
  }
});

test('club, arbitration and caster rosters use immutable player IDs, never nickname matching', async () => {
  const root = new URL('../client/src/operations/', import.meta.url);
  const club = await readFile(new URL('TeamRosterDialog.jsx', root), 'utf8');
  const arbitration = await readFile(new URL('TournamentLiveMatchPage.jsx', root), 'utf8');
  const caster = await readFile(new URL('OperationsPage.jsx', root), 'utf8');
  assert.match(club, /<Person name=\{member\.username\} userId=\{member\.user_id\}/);
  assert.match(arbitration, /<PlayerLiveBadge userId=\{player\.user_id\}/);
  assert.match(caster, /<PlayerLiveBadge userId=\{p\.user_id \|\| p\.player_id \|\| p\.id\}/);
  const badge = await readFile(new URL('PlayerLiveBadge.jsx', root), 'utf8');
  assert.match(badge, /api\.get\('\/operations\/player-live', \{ signal \}\)/);
  assert.doesNotMatch(badge, /api\.get\([^\n]*userId|api\.twitch\.tv|helix/i);
});
