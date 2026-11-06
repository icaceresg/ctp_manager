import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { teamArchiveSupported, teamIsArchived, activeAdministrationClubs, teamCloseCopy } from '../client/src/operations/teamArchiveContract.js';
import { teamRosterResponse, teamRosterProblem, TEAM_ROSTER_WRITES } from '../server/team-roster-contract.js';

const teamId = '39100000-0000-4000-8000-000000000001';
const team = { id: teamId, name: 'QA archive club', tag: 'QAA', logo: null, created_at: '2026-11-06T10:00:00Z' };
const raw = extra => ({ team: { ...team, ...extra }, members: [], requests: [], max_members: 6, revision: 'a'.repeat(32) });
let vite, views;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', logLevel: 'error' });
  views = await vite.ssrLoadModule('/src/operations/TeamRosterDialog.jsx');
});
after(async () => { await vite?.close(); });
const renderDanger = snapshot => renderToStaticMarkup(createElement(views.DangerPanel, { roster: snapshot, disabled: false, onDissolve: () => assert.fail('render never mutates a club') }));

test('legacy DTO has no archival marker and keeps its irreversible warning', () => {
  const legacy = teamRosterResponse(raw(), { action: 'get', team_id: teamId });
  assert.equal(Object.hasOwn(legacy.team, 'deleted_at'), false);
  assert.equal(teamArchiveSupported(legacy.team), false);
  const html = renderDanger(legacy);
  assert.match(html, /No se puede deshacer/);
  assert.match(html, /Disolver club definitivamente/);
  assert.doesNotMatch(html, /Archivar club|podrá recuperarlo/);
});

test('only an explicit validated391 marker offers archive copy and preserves the action enum', () => {
  const current = teamRosterResponse(raw({ deleted_at: null }), { action: 'get', team_id: teamId });
  assert.equal(Object.hasOwn(current.team, 'deleted_at'), true);
  assert.equal(teamArchiveSupported(current.team), true);
  assert.equal(teamIsArchived(current.team), false);
  const html = renderDanger(current);
  assert.match(html, /Archivar club/); assert.match(html, /Se conservan puntos, resultados/);
  assert.match(html, /CTP podrá recuperarlo/);
  assert.doesNotMatch(html, /No se puede deshacer|definitivamente|se retiran las inscripciones/);
  assert.match(html, /<button[^>]*disabled=""/);
  assert.deepEqual(TEAM_ROSTER_WRITES.dissolve, ['confirm_name']);
});

test('inherited, missing or malformed fields cannot claim recoverability', () => {
  assert.equal(teamArchiveSupported(Object.create({ deleted_at: null })), false);
  for (const deleted_at of [undefined, false, 0, '', 'tomorrow', {}, 'not-a-date']) {
    assert.equal(teamArchiveSupported({ deleted_at }), false);
    assert.throws(() => teamRosterResponse(raw({ deleted_at }), { action: 'get', team_id: teamId }), /unavailable/);
  }
  assert.equal(teamCloseCopy({}).help, 'manager.teamRoster.dissolveHelp');
});

test('normal club listings omit archived rows and leave legacy/active rows and history untouched', () => {
  const archived = { ...team, deleted_at: '2026-11-06T13:00:00+00:00', points: 450, passes: ['history'] };
  const rows = [team, { ...team, id: 'active391', deleted_at: null }, archived];
  const saved = structuredClone(rows);
  assert.deepEqual(activeAdministrationClubs(rows), rows.slice(0, 2));
  assert.deepEqual(rows, saved);
  const page = fs.readFileSync(new URL('../client/src/pages/AdministrationPage.jsx', import.meta.url), 'utf8');
  assert.match(page, /resource==='teams'\?activeAdministrationClubs/);
});

test('391 machine errors stay finite and every archive message has six matching catalogs', () => {
  const errors = { liveObligations: 'activeCompetition', inactive: 'inactive', restoreConflict: 'restoreConflict', directDeleteForbidden: 'directDeleteForbidden' };
  for (const [code, key] of Object.entries(errors)) assert.equal(teamRosterProblem(`teams.archive.${code}`), `manager.teamRoster.error.${key}`);
  assert.equal(teamRosterProblem('teams.archive.somethingPrivate'), null);
  const keys = [...Object.values(teamCloseCopy({ deleted_at: null })), ...Object.values(errors).map(key => `manager.teamRoster.error.${key}`)];
  const catalogs = Object.fromEntries(['es', 'en', 'fr', 'it', 'pt', 'de'].map(language => [language, JSON.parse(fs.readFileSync(new URL(`../client/src/i18n/locales/${language}.json`, import.meta.url), 'utf8'))]));
  for (const [language, catalog] of Object.entries(catalogs)) for (const key of keys) {
    assert.equal(typeof catalog[key], 'string', `${language}:${key}`);
    assert.deepEqual([...catalog[key].matchAll(/\{(\w+)\}/g)].map(m => m[1]), [...catalogs.en[key].matchAll(/\{(\w+)\}/g)].map(m => m[1]));
  }
});
